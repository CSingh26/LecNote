FROM node:22-bookworm-slim AS web-build

WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim-bookworm

LABEL org.opencontainers.image.source="https://github.com/CSingh26/LecNote" \
      org.opencontainers.image.description="Local lecture transcription and OpenAI study notes" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LN_DATA_DIR=/data \
    HF_HOME=/data/models \
    MPLCONFIGDIR=/data/matplotlib

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libgomp1 tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
COPY LICENSE ./
COPY lecnote/ ./lecnote/
RUN pip install --no-cache-dir . \
    && useradd --uid 10001 --create-home lecnote \
    && mkdir -p /data \
    && chown lecnote:lecnote /data
COPY --from=web-build /build/web/dist/ ./web/dist/

USER lecnote
EXPOSE 8765
CMD ["uvicorn", "lecnote.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8765"]
