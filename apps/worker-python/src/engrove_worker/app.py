import logging
import platform
import shutil
import tempfile
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pyarrow as pa  # type: ignore[import-untyped]
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pythonjsonlogger.json import JsonFormatter

from . import __version__
from .config import get_settings
from .datasets import DatasetRequest, process_dataset

logger = logging.getLogger("engrove.worker")
handler = logging.StreamHandler()
handler.setFormatter(JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s %(request_id)s"))
logger.addHandler(handler)
logger.setLevel(get_settings().log_level.upper())

accepting_requests = True


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    global accepting_requests
    for stale_directory in Path(tempfile.gettempdir()).glob("engrove-dataset-*"):
        if stale_directory.is_dir():
            shutil.rmtree(stale_directory, ignore_errors=True)
    accepting_requests = True
    logger.info("python worker ready", extra={"request_id": "startup"})
    yield
    accepting_requests = False
    logger.info("python worker stopped", extra={"request_id": "shutdown"})


app = FastAPI(title="Engrove scientific worker", version=__version__, lifespan=lifespan)


@app.middleware("http")
async def correlation_middleware(request: Request, call_next: Any) -> JSONResponse:
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    return response


def health(request: Request, status: str = "ok") -> dict[str, str]:
    return {
        "service": "engrove-worker-python",
        "status": status,
        "version": get_settings().engrove_version,
        "timestamp": datetime.now(UTC).isoformat(),
        "requestId": request.state.request_id,
    }


@app.get("/health/live")
async def live(request: Request) -> dict[str, str]:
    return health(request)


@app.get("/health/ready", response_model=None)
async def ready(request: Request) -> JSONResponse | dict[str, str]:
    if not accepting_requests:
        return JSONResponse(status_code=503, content=health(request, "not_ready"))
    return health(request)


@app.get("/internal/v1/capabilities")
async def capabilities(
    request: Request,
    x_engrove_internal_secret: str | None = Header(default=None),
) -> dict[str, object]:
    expected = get_settings().internal_service_secret.get_secret_value()
    if x_engrove_internal_secret != expected:
        raise HTTPException(status_code=401, detail={"code": "INTERNAL_AUTH_REQUIRED"})
    return {
        **health(request),
        "pythonVersion": platform.python_version(),
        "parsers": ["csv-v1", "xy-v1"],
    }


@app.post("/internal/v1/process-dataset")
def process_dataset_request(
    request: Request,
    payload: DatasetRequest,
    x_engrove_internal_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    expected = get_settings().internal_service_secret.get_secret_value()
    if x_engrove_internal_secret != expected:
        raise HTTPException(status_code=401, detail={"code": "INTERNAL_AUTH_REQUIRED"})
    try:
        settings = get_settings()
        return process_dataset(
            payload,
            allowed_storage_endpoint=str(settings.s3_endpoint),
            max_source_bytes=settings.max_dataset_source_bytes,
        )
    except (ValueError, pa.ArrowException) as error:
        raise HTTPException(
            status_code=422,
            detail={"code": "DATASET_PARSE_FAILED", "message": str(error)[:500]},
        ) from error
