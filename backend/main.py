"""Optional download helper for EdadPlay.

Streams a video from YouTube/Vimeo/TikTok/etc. (<=480p) to the browser with
CORS headers so the client-side analyzer can process it locally. Nothing is
stored server-side: yt-dlp writes to stdout and the response streams through.

Reliability layers against YouTube bot-detection on datacenter IPs:
1. PO Token provider sidecar (bgutil) — set POT_PROVIDER_URL.
2. Player-client fallback chain (default -> mweb/web_safari/tv_embedded).
3. Optional cookies file — set COOKIES_FILE (export with a throwaway account).
4. yt-dlp self-update every 12 h (most breakages are version-related).

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000
"""

import asyncio
import contextlib
import os
import shutil
import sys

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
MAX_DURATION = int(os.environ.get("MAX_DURATION_SECONDS", "3600"))
COOKIES_FILE = os.environ.get("COOKIES_FILE", "")
POT_PROVIDER_URL = os.environ.get("POT_PROVIDER_URL", "")
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "3"))
UPDATE_INTERVAL = 12 * 3600

FORMAT = "best[ext=mp4][height<=480]/best[height<=480]/best"

semaphore = asyncio.Semaphore(MAX_CONCURRENT)
app = FastAPI(title="EdadPlay fetch helper")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


async def self_update_loop():
    """yt-dlp breaks when YouTube changes; staying current fixes most errors."""
    while True:
        with contextlib.suppress(Exception):
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-m", "pip", "install", "-q", "-U",
                "yt-dlp[default]", "bgutil-ytdlp-pot-provider",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.wait()
        await asyncio.sleep(UPDATE_INTERVAL)


@app.on_event("startup")
async def startup():
    asyncio.create_task(self_update_loop())


def base_args() -> list[str]:
    args = [
        "yt-dlp", "--quiet", "--no-warnings", "--no-playlist",
        "--match-filter", f"duration<={MAX_DURATION}",
        "--socket-timeout", "20",
        "-f", FORMAT,
        "-o", "-",
    ]
    if COOKIES_FILE and os.path.exists(COOKIES_FILE):
        args += ["--cookies", COOKIES_FILE]
    if POT_PROVIDER_URL:
        args += ["--extractor-args", f"youtubepot-bgutilhttp:base_url={POT_PROVIDER_URL}"]
    return args


# Attempt chain: default first (POT plugin engages automatically), then an
# explicit multi-client fallback recommended by the yt-dlp PO Token guide.
ATTEMPT_EXTRA_ARGS = [
    [],
    ["--extractor-args", "youtube:player_client=default,mweb,web_safari,tv_embedded"],
]


def classify_error(stderr: str) -> HTTPException:
    s = stderr.lower()
    if "confirm you" in s and "bot" in s or "sign in to confirm" in s:
        return HTTPException(503, "La plataforma está bloqueando temporalmente las descargas desde este "
                                  "servidor. Prueba de nuevo en unos minutos o descarga el vídeo y usa «Archivo local».")
    if "private video" in s or "login required" in s or "members-only" in s or "sign in" in s:
        return HTTPException(403, "El vídeo es privado o requiere iniciar sesión en la plataforma.")
    if "not available in your country" in s or "geo restricted" in s or "blocked it in your country" in s:
        return HTTPException(451, "El vídeo no está disponible en la región del servidor (restricción geográfica).")
    if "unsupported url" in s:
        return HTTPException(400, "Esa web no está soportada. Funciona con YouTube, Vimeo, Dailymotion, "
                                  "TikTok, Twitch y cientos de sitios más.")
    if "video unavailable" in s or "404" in s:
        return HTTPException(404, "El vídeo no existe o ha sido retirado.")
    if "match-filter" in s or not s.strip():
        return HTTPException(413, f"El vídeo supera la duración máxima permitida ({MAX_DURATION // 60} min).")
    return HTTPException(502, f"No se pudo obtener el vídeo: {stderr[-300:]}")


@app.get("/api/health")
async def health():
    version = ""
    if shutil.which("yt-dlp"):
        proc = await asyncio.create_subprocess_exec(
            "yt-dlp", "--version", stdout=asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        version = out.decode().strip()
    return {
        "ok": bool(version),
        "ytdlp": version,
        "pot_provider": bool(POT_PROVIDER_URL),
        "cookies": bool(COOKIES_FILE and os.path.exists(COOKIES_FILE)),
    }


@app.get("/api/fetch")
async def fetch(url: str = Query(..., max_length=500)):
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "URL no válida")
    if shutil.which("yt-dlp") is None:
        raise HTTPException(500, "yt-dlp no disponible en el servidor")

    async with semaphore:
        last_error: HTTPException | None = None

        for extra in ATTEMPT_EXTRA_ARGS:
            proc = await asyncio.create_subprocess_exec(
                *base_args(), *extra, url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            first = await proc.stdout.read(64 * 1024)
            if first:
                async def stream(p=proc, head=first):
                    yield head
                    while True:
                        chunk = await p.stdout.read(256 * 1024)
                        if not chunk:
                            break
                        yield chunk
                    await p.wait()

                return StreamingResponse(stream(), media_type="video/mp4")

            stderr = (await proc.stderr.read()).decode(errors="replace")
            await proc.wait()
            last_error = classify_error(stderr)
            # Only the bot-detection error benefits from trying another client.
            if last_error.status_code != 503:
                break

        raise last_error or HTTPException(502, "Fallo desconocido")
