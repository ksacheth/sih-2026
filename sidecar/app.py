# Placeholder sidecar service. The PII-detection pipeline (GLiNER) is owned
# by the sidecar workstream; this keeps `docker compose up` working and the
# app health check passing until that lands.
from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health():
    return {"status": "ok", "service": "sidecar", "model_loaded": False}
