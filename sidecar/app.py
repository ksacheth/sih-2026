import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any
from fastapi import FastAPI, HTTPException, status

from schemas import (
    ExtractRequest,
    ExtractResponse,
    HealthResponse,
    MAX_TEXT_CHARS,
)
from runtime import predict_windowed, DEADLINE_S

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("sidecar")

MODEL_ID = "urchade/gliner_small-v2.1"


def load_gliner_model(model_id: str) -> tuple[Any, str]:
    """Loads GLiNER weights and returns (model, device). Injectable in tests so
    the lifespan never touches the network or real weights."""
    import torch
    from gliner import GLiNER

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Loading {model_id} on device: {device}")
    model = GLiNER.from_pretrained(model_id).to(device)
    logger.info(f"GLiNER model loaded successfully on {device}")
    return model, device


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing GLiNER model...")
    device = "cpu"
    model = None

    try:
        model, device = load_gliner_model(MODEL_ID)
    except Exception as e:
        # No mock mode: without weights /extract returns 503 and /health reports
        # unready, so orchestrators see a degraded sidecar instead of a false healthy one.
        logger.warning(
            f"Could not load GLiNER weights at startup ({e}). "
            f"/extract will return 503 and /health will report ready=false until weights are available."
        )

    app.state.model = model
    app.state.device = device
    app.state.infer_lock = threading.Lock()
    yield
    app.state.model = None
    logger.info("GLiNER model unloaded")


app = FastAPI(
    title="GLiNER NER Sidecar",
    description="Contextual PII Entity Extraction Microservice",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
def health():
    is_ready = getattr(app.state, "model", None) is not None
    if not is_ready:
        # A model-less sidecar must not report healthy: the Docker healthcheck and
        # the app's /api/health probe would otherwise treat it as fully available.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="model_not_loaded",
        )
    device = getattr(app.state, "device", "cpu")
    return HealthResponse(
        status="ok",
        model="gliner_small-v2.1",
        ready=True,
        device=device,
    )


@app.post("/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest):
    model = getattr(app.state, "model", None)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="model_loading",
        )

    start_t = time.monotonic()
    text = req.text[:MAX_TEXT_CHARS]
    text_truncated = len(req.text) > MAX_TEXT_CHARS

    # Inference is serialized, so the lock wait counts against the same
    # cooperative deadline as the forward passes: a queued request can never
    # exceed DEADLINE_S from arrival, staying inside the 15s client timeout.
    acquired = app.state.infer_lock.acquire(timeout=DEADLINE_S)
    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="inference_busy",
        )
    try:
        remaining = DEADLINE_S - (time.monotonic() - start_t)
        entities, is_partial = predict_windowed(
            model=model,
            text=text,
            threshold=req.threshold,
            deadline_s=max(remaining, 0.0),
        )
    finally:
        app.state.infer_lock.release()

    elapsed_ms = int((time.monotonic() - start_t) * 1000)
    # Log safe metrics only (no raw text or PII)
    logger.info(
        f"Extraction completed: chars={len(text)} truncated={text_truncated} "
        f"entities={len(entities)} partial={is_partial} time_ms={elapsed_ms}"
    )

    return ExtractResponse(
        entities=entities,
        textTruncated=text_truncated,
        partial=is_partial,
    )


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ.get("SIDECAR_PORT", "8000"))
    uvicorn.run(app, host=host, port=port, workers=1)
