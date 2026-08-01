import base64
import hashlib
import json
from io import BytesIO
from typing import Any

import pyarrow as pa  # type: ignore[import-untyped]
import pyarrow.compute as pc  # type: ignore[import-untyped]
import pyarrow.csv as arrow_csv  # type: ignore[import-untyped]
import pyarrow.parquet as parquet  # type: ignore[import-untyped]
from pydantic import BaseModel, Field, model_validator


class DatasetRequest(BaseModel):
    dataset_type: str = Field(pattern="^(tabular|xy)$")
    source_base64: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    source_schema: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_xy(self) -> "DatasetRequest":
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


def process_dataset(request: DatasetRequest) -> dict[str, Any]:
    source = base64.b64decode(request.source_base64, validate=True)
    if request.dataset_type == "tabular":
        delimiter = str(request.parameters.get("delimiter", ","))
        if len(delimiter) != 1:
            raise ValueError("CSV_DELIMITER_INVALID")
        table = arrow_csv.read_csv(
            pa.BufferReader(source), parse_options=arrow_csv.ParseOptions(delimiter=delimiter)
        )
        schema, statistics = describe(table)
    else:
        table = parquet.read_table(BytesIO(source))
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
    output = pa.BufferOutputStream()
    parquet.write_table(table, output, compression="zstd")
    artifact = output.getvalue().to_pybytes()
    preview = [
        {key: scalar(value) for key, value in row.items()}
        for row in table.slice(0, 100).to_pylist()
    ]
    return {
        "schema": schema,
        "statistics": statistics,
        "rowCount": table.num_rows,
        "preview": preview,
        "previewJson": json.dumps(preview, separators=(",", ":")),
        "parquetBase64": base64.b64encode(artifact).decode(),
        "parquetChecksum": hashlib.sha256(artifact).hexdigest(),
        "parserVersion": "pyarrow-csv-v1" if request.dataset_type == "tabular" else "pyarrow-xy-v1",
    }
