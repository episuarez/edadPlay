# 🎬 EdadPlay – Analizador Audiovisual Infantil

**EdadPlay** analiza vídeos y recomienda la edad mínima adecuada según criterios
científicos de estimulación visual y auditiva. Pensada para padres, educadores y
creadores de contenido.

**La versión actual funciona 100 % en el navegador** (carpeta `docs/`): el vídeo
nunca sale de tu dispositivo, no hay servidores, no hay colas y el coste de
infraestructura es cero. Se publica con GitHub Pages.

---

## 🚀 Qué mide

| Métrica | Base |
|---|---|
| Cortes visuales/min | Lillard & Peterson (2011), Hinten et al. (2025) |
| Destellos/s (fotosensibilidad) | WCAG 2.3.1 (límite de 3 flashes/s) |
| Picos de volumen (dB sobre la media) | ITU-R BT.1770 / EBU R128 (ponderación K) |
| Densidad sonora (eventos/min) | Christakis et al., PNAS (2018) |
| Movimiento en pantalla | Heurístico |
| Complejidad visual (densidad de bordes) | Heurístico |

El vídeo se divide en tramos de 60 s; cada tramo recibe la edad de su métrica más
restrictiva y la clasificación global es el percentil 90 de los tramos. Superar el
límite de destellos genera siempre una advertencia de fotosensibilidad.
La metodología completa, con referencias, está en la propia página.

## 📥 Uso

1. Abre la web (GitHub Pages) o `docs/index.html` servido en local:
   ```bash
   cd docs
   python -m http.server 8000
   # http://localhost:8000
   ```
2. Arrastra un archivo de vídeo (MP4, WebM, MOV) o pega la URL directa de un
   archivo de vídeo.
3. Espera el análisis (≈ ¼ de la duración del vídeo) con la pestaña visible.

> **Nota sobre YouTube/Vimeo:** esas plataformas no permiten descargar el archivo
> desde otra web (CORS). Descarga el vídeo en tu dispositivo y súbelo: el análisis
> es idéntico y 100 % local.

## 🌐 Publicar con GitHub Pages

1. Repositorio → **Settings → Pages**.
2. *Source*: `Deploy from a branch`; *Branch*: `main`, carpeta `/docs`.
3. Guardar. La web queda en `https://<usuario>.github.io/<repo>/`.

## 📗 Estructura

```
edadPlay
├── docs/                  # Aplicación web (GitHub Pages)
│   ├── index.html         # Inicio + resultados (SPA)
│   ├── css/styles.css     # Design system (tokens del diseño .pen)
│   └── js/
│       ├── main.js            # Tabs, modos, orquestación y render
│       ├── insights.js        # Textos generados por datos (veredicto, consejos…)
│       ├── video-analyzer.js  # Cortes, movimiento, complejidad, flashes
│       ├── audio-analyzer.js  # Loudness (BT.1770) y eventos sonoros
│       ├── scoring.js         # Umbrales por edad y reglas de agregación
│       └── config.js          # URL del backend opcional (YouTube)
├── backend/               # Backend OPCIONAL para la pestaña YouTube
│   ├── main.py            # FastAPI + yt-dlp (streaming, sin almacenar nada)
│   ├── Dockerfile
│   └── requirements.txt
├── design/desgin.pen      # Diseño de referencia (Pencil)
├── app.py / core.py       # (Legado) versión Streamlit
└── requirements.txt       # (Legado) dependencias Python
```

## ▶️ Backend opcional de YouTube

La web funciona 100 % sin servidores. La pestaña «YouTube» necesita un pequeño
backend (`backend/`) que descarga el vídeo con yt-dlp y lo transmite al
navegador (no almacena nada). Para activarlo:

1. Despliega `backend/` (Docker) en cualquier host.
2. Pon su URL en `docs/js/config.js` → `BACKEND_URL`.
3. Limita `ALLOWED_ORIGINS` a tu dominio de GitHub Pages.

Coste por vídeo ≈ ancho de banda (30–80 MB a 480p). CPU irrelevante (no se
transcodifica). Despliegue recomendado: **Oracle Cloud Always Free** (0 €,
10 TB/mes) — guía paso a paso en [`backend/DEPLOY_ORACLE.md`](backend/DEPLOY_ORACLE.md).

Anti-bloqueo incluido: PO Token provider (bgutil) para IPs de datacenter,
cadena de clientes de respaldo (`mweb`, `web_safari`, `tv_embedded`),
autoactualización de yt-dlp cada 12 h y cookies opcionales. Soporta YouTube,
Vimeo, Dailymotion, TikTok, Twitch y cientos de sitios más (Instagram y
Facebook no: requieren login).

## 🐍 Versión Streamlit (legado)

La versión original en Python/Streamlit se conserva como referencia:

```bash
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```
