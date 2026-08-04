import base64
import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from engrove_worker.app import app
from engrove_worker.datasets import (
    ArtifactUpload,
    DatasetRequest,
    _same_storage_origin,
    process_dataset,
)


def test_csv_to_parquet_and_xy_derivation() -> None:
    headers = {"x-engrove-internal-secret": "engrove_internal_dev_only"}
    with TestClient(app) as client:
        tabular = client.post(
            "/internal/v1/process-dataset",
            headers=headers,
            json={
                "dataset_type": "tabular",
                "source_base64": base64.b64encode(b"time,force\n0,10\n1,12\n").decode(),
            },
        )
        assert tabular.status_code == 200
        parsed = tabular.json()
        columns = parsed["schema"]["columns"]
        xy = client.post(
            "/internal/v1/process-dataset",
            headers=headers,
            json={
                "dataset_type": "xy",
                "source_base64": parsed["parquetBase64"],
                "source_schema": parsed["schema"],
                "parameters": {
                    "xColumnId": columns[0]["id"],
                    "yColumnId": columns[1]["id"],
                    "xDimension": "time",
                    "xUnit": "s",
                    "yDimension": "force",
                    "yUnit": "N",
                },
            },
        )
    assert parsed["rowCount"] == 2
    assert parsed["statistics"]["columns"][columns[1]["id"]]["maximum"] == 12
    assert xy.status_code == 200
    assert xy.json()["rowCount"] == 2


def test_presigned_storage_contract_streams_artifacts_without_base64(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = b"time,force\n0,10\n1,12\n"
    checksum = hashlib.sha256(source).hexdigest()
    uploaded: dict[str, bytes] = {}

    def download(
        _url: str,
        destination: Path,
        expected_size: int,
        expected_checksum: str,
        _max_source_bytes: int,
        _allowed_storage_endpoint: str,
    ) -> None:
        assert expected_size == len(source)
        assert expected_checksum == checksum
        destination.write_bytes(source)

    def upload(path: Path, artifact: ArtifactUpload, _allowed_storage_endpoint: str) -> None:
        uploaded[artifact.content_type] = path.read_bytes()

    monkeypatch.setattr("engrove_worker.datasets._download_source", download)
    monkeypatch.setattr("engrove_worker.datasets._upload_artifact", upload)
    result = process_dataset(
        DatasetRequest.model_validate(
            {
                "dataset_type": "tabular",
                "source_url": "http://localhost:9000/source?signature=test",
                "source_size_bytes": len(source),
                "source_checksum": checksum,
                "artifact_uploads": {
                    "parquet": {
                        "url": "http://localhost:9000/parquet?signature=test",
                        "content_type": "application/vnd.apache.parquet",
                    },
                    "preview": {
                        "url": "http://localhost:9000/preview?signature=test",
                        "content_type": "application/json",
                    },
                },
            }
        )
    )
    assert result["rowCount"] == 2
    assert "parquetBase64" not in result
    assert {artifact["kind"] for artifact in result["artifacts"]} == {"parquet", "preview"}
    assert uploaded["application/json"].startswith(b"[")
    assert uploaded["application/vnd.apache.parquet"].startswith(b"PAR1")


@pytest.mark.parametrize(
    ("url", "allowed"),
    [
        ("http://minio:9000/object?signature=test", True),
        ("http://attacker.invalid:9000/object", False),
        ("http://minio:9001/object", False),
        ("http://user@minio:9000/object", False),
        ("http://minio:9000/object#fragment", False),
    ],
)
def test_presigned_urls_are_restricted_to_the_configured_storage_origin(
    url: str, allowed: bool
) -> None:
    assert _same_storage_origin(url, "http://minio:9000") is allowed
