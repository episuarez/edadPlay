#!/bin/sh
set -e

# Optional cookies passed as a base64 secret (HF Spaces secrets are strings).
if [ -n "$COOKIES_B64" ]; then
    echo "$COOKIES_B64" | base64 -d > /tmp/cookies.txt
    export COOKIES_FILE=/tmp/cookies.txt
fi

node /opt/bgutil/server/build/main.js --port 4416 &

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-7860}"
