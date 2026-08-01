from fastapi.testclient import TestClient

from engrove_worker.app import app


def test_health_is_public_and_correlated() -> None:
    with TestClient(app) as client:
        response = client.get("/health/live", headers={"x-request-id": "test-request"})
    assert response.status_code == 200
    assert response.json()["requestId"] == "test-request"
    assert response.headers["x-request-id"] == "test-request"


def test_capabilities_require_internal_authentication() -> None:
    with TestClient(app) as client:
        rejected = client.get("/internal/v1/capabilities")
        accepted = client.get(
            "/internal/v1/capabilities",
            headers={"x-engrove-internal-secret": "engrove_internal_dev_only"},
        )
    assert rejected.status_code == 401
    assert accepted.status_code == 200
    assert accepted.json()["parsers"] == ["csv-v1", "xy-v1"]
