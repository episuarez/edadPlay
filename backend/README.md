---
title: EdadPlay Backend
emoji: 🎬
colorFrom: purple
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
---

# EdadPlay — backend de descarga

Servidor opcional para la pestaña «YouTube» de [EdadPlay](https://github.com/episuarez/edadPlay):
descarga el vídeo (≤480p) con yt-dlp y lo transmite al navegador, donde se
analiza en local. No almacena nada.

Endpoints:

- `GET /api/health` — estado, versión de yt-dlp, POT provider y cookies.
- `GET /api/fetch?url=…` — stream del vídeo con cabeceras CORS.

Variables (Settings del Space):

- `ALLOWED_ORIGINS` — restringe CORS, p. ej. `https://tuusuario.github.io`.
- `MAX_DURATION_SECONDS` — duración máxima (def. 3600).
- `COOKIES_B64` (secret) — `cookies.txt` en base64 de una cuenta desechable,
  como capa extra anti-bloqueo de YouTube.

Anti-bloqueo incluido: PO Token provider (bgutil) en el propio contenedor,
cadena de clientes de respaldo de yt-dlp y autoactualización cada 12 h.

Despliegue paso a paso: ver `DEPLOY_HF.md` en el repositorio principal.
