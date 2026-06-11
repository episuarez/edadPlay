# Despliegue en Hugging Face Spaces

Resultado: backend en `https://<usuario>-edadplay-backend.hf.space` con HTTPS
automático, 0 €/mes (CPU basic: 2 vCPU, 16 GB RAM).

## 1. Crear el Space (2 minutos)

1. Cuenta en [huggingface.co](https://huggingface.co/join) (gratis, sin tarjeta).
2. [Nuevo Space](https://huggingface.co/new-space):
   - **Space name**: `edadplay-backend`
   - **License**: la que uses en el repo (MIT/GPL…)
   - **SDK**: **Docker** → *Blank*
   - **Hardware**: **CPU basic · Free**
   - **Visibility**: **Public**

## 2. Subir los archivos del backend

Opción A — web (más fácil): en la pestaña **Files** del Space → *Add file* →
*Upload files* y sube estos 5 archivos de la carpeta `backend/`:

```
Dockerfile
entrypoint.sh
main.py
requirements.txt
README.md      (lleva la cabecera YAML que configura el Space — sobrescribe el creado por defecto)
```

Opción B — git:

```bash
git clone https://huggingface.co/spaces/<usuario>/edadplay-backend
cp backend/Dockerfile backend/entrypoint.sh backend/main.py backend/requirements.txt backend/README.md edadplay-backend/
cd edadplay-backend && git add -A && git commit -m "Add EdadPlay backend" && git push
# usuario: tu usuario HF · contraseña: un Access Token (Settings → Access Tokens → write)
```

El Space construye la imagen solo (~3–5 min la primera vez; compila el
provider de PO Tokens).

## 3. Configurar variables

En el Space → **Settings**:

- **Variables** → `ALLOWED_ORIGINS` = `https://<tuusuario>.github.io`
- **Secrets** (opcional, capa extra anti-bloqueo) → `COOKIES_B64` = contenido
  de `cookies.txt` en base64 (`base64 -w0 cookies.txt`), exportado de una
  cuenta de YouTube **desechable**. Caduca en ~2 semanas.

Cambiar variables reinicia el Space automáticamente.

## 4. Comprobar

`https://<usuario>-edadplay-backend.hf.space/api/health` debe devolver:

```json
{"ok": true, "ytdlp": "20xx.xx.xx", "pot_provider": true, "cookies": false}
```

## 5. Conectar el frontend

En `docs/js/config.js`:

```js
export const BACKEND_URL = 'https://<usuario>-edadplay-backend.hf.space';
```

Commit + push → GitHub Pages se actualiza y la pestaña YouTube queda activa.

## Detalle importante: el Space duerme

El plan gratuito pausa el Space tras **48 h sin peticiones**. La siguiente
petición lo despierta sola, pero tarda ~30–60 s (el frontend ya avisa de que
puede tardar). Para mantenerlo siempre despierto: monitor gratuito de
[UptimeRobot](https://uptimerobot.com) haciendo ping a `/api/health` cada
30 minutos.

## Anti-bloqueo de YouTube (ya incluido)

| Capa | Qué hace |
|---|---|
| PO Token provider (bgutil) | Tokens de "prueba de origen" — solución oficial de yt-dlp para IPs de datacenter |
| Cadena de clientes | Reintenta con `mweb`, `web_safari`, `tv_embedded` si el cliente por defecto recibe el bloqueo |
| Autoactualización | yt-dlp se actualiza solo cada 12 h dentro del contenedor |
| Cookies (`COOKIES_B64`) | Capa más fuerte si los bloqueos persisten |

## Otras plataformas

Funcionan bien desde datacenter: **Vimeo, Dailymotion, Twitch (VODs), TikTok,
Reddit, X/Twitter** y cientos más. No soportados sin login: Instagram,
Facebook. YouTube es el único con bloqueo activo; de ahí las capas de arriba.
