import base64

from fastapi.testclient import TestClient

from engrove_worker.app import app


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
