# Single-container image for Hugging Face Spaces (Docker SDK).
# Bundles the FastAPI download helper and the bgutil PO Token provider
# (Node) in one image, since Spaces run exactly one container.

FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg curl ca-certificates git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# bgutil POT provider server (anti bot-detection for datacenter IPs)
RUN git clone --single-branch --branch 1.3.1 --depth 1 \
        https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
    && cd /opt/bgutil/server && npm ci && npx tsc

COPY main.py entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV POT_PROVIDER_URL=http://127.0.0.1:4416 \
    PORT=7860

EXPOSE 7860
CMD ["./entrypoint.sh"]
