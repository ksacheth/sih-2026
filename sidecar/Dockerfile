FROM python:3.11-slim AS model
WORKDIR /opt/model
RUN pip install --no-cache-dir gliner==0.2.19 "huggingface_hub<1.0"
RUN python -c "from gliner import GLiNER; GLiNER.from_pretrained('urchade/gliner_small-v2.1')"

FROM python:3.11-slim
WORKDIR /app
COPY --from=model /root/.cache/huggingface /root/.cache/huggingface
COPY sidecar/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY sidecar/app.py .
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "15"]