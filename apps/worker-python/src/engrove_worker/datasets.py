import base64
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from urllib.parse import urlsplit

import httpx
import pyarrow as pa  # type: ignore[import-untyped]
import pyarrow.compute as pc  # type: ignore[import-untyped]
import pyarrow.csv as arrow_csv  # type: ignore[import-untyped]
import pyarrow.parquet as parquet  # type: ignore[import-untyped]
from pydantic import BaseModel, Field, model_validator

DEFAULT_MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_ENCODED_SOURCE_LENGTH = ((DEFAULT_MAX_SOURCE_BYTES + 2) // 3) * 4


class ArtifactUpload(BaseModel):
    url: str = Field(min_length=1, max_length=8192)
    content_type: str = Field(min_length=1, max_length=160)


class ArtifactUploads(BaseModel):
    parquet: ArtifactUpload
    preview: ArtifactUpload


class DatasetRequest(BaseModel):
    dataset_type: str = Field(pattern="^(tabular|xy)$")
    source_base64: str | None = Field(default=None, max_length=MAX_ENCODED_SOURCE_LENGTH)
    source_url: str | None = Field(default=None, min_length=1, max_length=8192)
    source_size_bytes: int | None = Field(default=None, gt=0, le=DEFAULT_MAX_SOURCE_BYTES)
    source_checksum: str | None = Field(default=None, pattern="^[a-f0-9]{64}$")
    artifact_uploads: ArtifactUploads | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    source_schema: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_xy(self) -> "DatasetRequest":
        if (self.source_base64 is None) == (self.source_url is None):
            raise ValueError("DATASET_SOURCE_REQUIRED")
        if self.source_url and (
            self.source_size_bytes is None
            or self.source_checksum is None
            or self.artifact_uploads is None
        ):
            raise ValueError("DATASET_STREAM_CONTRACT_INCOMPLETE")
        if self.dataset_type == "xy" and self.source_schema is None:
            raise ValueError("XY_SOURCE_SCHEMA_REQUIRED")
        return self


def column_id(index: int, name: str) -> str:
    return hashlib.sha256(f"csv-column-v1\0{index}\0{name}".encode()).hexdigest()[:24]


def scalar(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return str(value)


def describe(
    table: pa.Table, units: dict[str, dict[str, Any]] | None = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    columns: list[dict[str, Any]] = []
    statistics: dict[str, Any] = {"columns": {}}
    for index, field in enumerate(table.schema):
        identifier = column_id(index, field.name)
        unit = (units or {}).get(identifier, {})
        columns.append({"id": identifier, "name": field.name, "dataType": str(field.type), **unit})
        values = table.column(index)
        item: dict[str, Any] = {"nullCount": values.null_count}
        if (
            pa.types.is_integer(field.type)
            or pa.types.is_floating(field.type)
            or pa.types.is_decimal(field.type)
        ):
            item["minimum"] = scalar(pc.min(values).as_py())
            item["maximum"] = scalar(pc.max(values).as_py())
            item["mean"] = scalar(pc.mean(values).as_py())
        statistics["columns"][identifier] = item
    return {"columns": columns}, statistics


def _same_storage_origin(url: str, endpoint: str) -> bool:
    target = urlsplit(url)
    allowed = urlsplit(endpoint)
    return (
        target.scheme in {"http", "https"}
        and target.scheme == allowed.scheme
        and target.hostname == allowed.hostname
        and target.port == allowed.port
        and target.username is None
        and target.password is None
        and not target.fragment
    )


def _download_source(
    url: str,
    destination: Path,
    expected_size: int,
    expected_checksum: str,
    max_source_bytes: int,
    allowed_storage_endpoint: str,
) -> None:
    if not _same_storage_origin(url, allowed_storage_endpoint):
        raise ValueError("DATASET_SOURCE_ORIGIN_INVALID")
    digest = hashlib.sha256()
    size = 0
    with (
        httpx.Client(follow_redirects=False, timeout=120.0) as client,
        client.stream("GET", url) as response,
        destination.open("wb") as output,
    ):
        response.raise_for_status()
        for chunk in response.iter_bytes(1024 * 1024):
            size += len(chunk)
            if size > max_source_bytes:
                raise ValueError("DATASET_SOURCE_TOO_LARGE")
            digest.update(chunk)
            output.write(chunk)
    if size != expected_size:
        raise ValueError("DATASET_SOURCE_SIZE_MISMATCH")
    if digest.hexdigest() != expected_checksum:
        raise ValueError("DATASET_SOURCE_CHECKSUM_MISMATCH")


def _upload_artifact(
    path: Path,
    upload: ArtifactUpload,
    allowed_storage_endpoint: str,
) -> None:
    if not _same_storage_origin(upload.url, allowed_storage_endpoint):
        raise ValueError("DATASET_ARTIFACT_ORIGIN_INVALID")
    with path.open("rb") as content, httpx.Client(follow_redirects=False, timeout=120.0) as client:
        response = client.put(
            upload.url,
            content=content,
            headers={
                "content-type": upload.content_type,
                "content-length": str(path.stat().st_size),
            },
        )
        response.raise_for_status()


def _file_checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def process_dataset(
    request: DatasetRequest,
    allowed_storage_endpoint: str = "http://localhost:9000",
    max_source_bytes: int = DEFAULT_MAX_SOURCE_BYTES,
) -> dict[str, Any]:
    with TemporaryDirectory(prefix="engrove-dataset-") as directory:
        work = Path(directory)
        source_path = work / "source"
        if request.source_url:
            _download_source(
                request.source_url,
                source_path,
                request.source_size_bytes or 0,
                request.source_checksum or "",
                max_source_bytes,
                allowed_storage_endpoint,
            )
        else:
            source = base64.b64decode(request.source_base64 or "", validate=True)
            if len(source) > max_source_bytes:
                raise ValueError("DATASET_SOURCE_TOO_LARGE")
            source_path.write_bytes(source)

        result = _process_source(request, source_path, work)
        if request.artifact_uploads:
            parquet_path = work / "result.parquet"
            preview_path = work / "preview.json"
            _upload_artifact(
                parquet_path,
                request.artifact_uploads.parquet,
                allowed_storage_endpoint,
            )
            _upload_artifact(
                preview_path,
                request.artifact_uploads.preview,
                allowed_storage_endpoint,
            )
            result["artifacts"] = [
                {
                    "kind": "parquet",
                    "checksum": _file_checksum(parquet_path),
                    "sizeBytes": parquet_path.stat().st_size,
                },
                {
                    "kind": "preview",
                    "checksum": _file_checksum(preview_path),
                    "sizeBytes": preview_path.stat().st_size,
                },
            ]
        else:
            parquet_bytes = (work / "result.parquet").read_bytes()
            preview_json = (work / "preview.json").read_text()
            result.update(
                {
                    "previewJson": preview_json,
                    "parquetBase64": base64.b64encode(parquet_bytes).decode(),
                    "parquetChecksum": hashlib.sha256(parquet_bytes).hexdigest(),
                }
            )
        return result


def _process_source(request: DatasetRequest, source_path: Path, work: Path) -> dict[str, Any]:
    if request.dataset_type == "tabular":
        delimiter = str(request.parameters.get("delimiter", ","))
        if len(delimiter) != 1:
            raise ValueError("CSV_DELIMITER_INVALID")
        table = arrow_csv.read_csv(
            str(source_path), parse_options=arrow_csv.ParseOptions(delimiter=delimiter)
        )
        schema, statistics = describe(table)
    else:
        table = parquet.read_table(str(source_path))
        source_columns = request.source_schema["columns"] if request.source_schema else []
        by_id = {column["id"]: column for column in source_columns}
        x = by_id.get(request.parameters.get("xColumnId"))
        y = by_id.get(request.parameters.get("yColumnId"))
        if not x or not y:
            raise ValueError("DATASET_COLUMN_NOT_FOUND")
        table = table.select([x["name"], y["name"]])
        units = {
            column_id(0, x["name"]): {
                "dimension": request.parameters.get("xDimension"),
                "unit": request.parameters.get("xUnit"),
                "role": "x",
            },
            column_id(1, y["name"]): {
                "dimension": request.parameters.get("yDimension"),
                "unit": request.parameters.get("yUnit"),
                "role": "y",
            },
        }
        schema, statistics = describe(table, units)
    parquet_path = work / "result.parquet"
    parquet.write_table(table, parquet_path, compression="zstd")
    preview = [
        {key: scalar(value) for key, value in row.items()}
        for row in table.slice(0, 100).to_pylist()
    ]
    preview_json = json.dumps(preview, separators=(",", ":"))
    (work / "preview.json").write_text(preview_json)
    return {
        "schema": schema,
        "statistics": statistics,
        "rowCount": table.num_rows,
        "preview": preview,
        "parserVersion": "pyarrow-csv-v1" if request.dataset_type == "tabular" else "pyarrow-xy-v1",
    }
