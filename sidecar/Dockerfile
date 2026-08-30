# Multi-stage build for the GLiNER-small FastAPI sidecar.
# Uses uv with a committed lockfile (reproducible, CPU-only torch) and bakes
# the model weights into the image so first run needs zero network calls.
FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS builder

ENV UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install locked dependencies into the project venv (dev group excluded)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Pre-download GLiNER weights during build to bake into the image
ENV HF_HOME=/models/huggingface
RUN uv run --no-sync python -c "from gliner import GLiNER; GLiNER.from_pretrained('urchade/gliner_small-v2.1')"

# Runtime stage
FROM python:3.11-slim AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    PATH="/app/.venv/bin:$PATH" \
    SIDECAR_HOST=0.0.0.0 \
    SIDECAR_PORT=8000

# Copy the locked venv, the pre-downloaded weights, and the application code
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /models/huggingface /models/huggingface
COPY schemas.py runtime.py app.py ./

# Dedicated non-root user: the service needs read access to /app and /models only
RUN useradd --create-home --uid 10001 sidecar \
 && chown -R sidecar:sidecar /app /models
USER sidecar

EXPOSE 8000

# start_period must cover the model load (~10-30s from baked weights on slow disks)
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
