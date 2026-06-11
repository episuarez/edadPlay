# Contributing

Static web app, vanilla JavaScript, zero dependencies and no build step. You need:

- **Python 3** (or any static file server) for local serving
- A Chromium-based browser for full testing (`requestVideoFrameCallback`)
- **Docker** only if you touch the backend

## Setup

```bash
git clone https://github.com/episuarez/edadPlay
cd edadPlay/docs
python -m http.server 8000
# http://localhost:8000
```

## Dev loop

Edit files under `docs/`, refresh the browser. Test with short videos —
analysis takes roughly ¼ of the video duration and the tab must stay visible.

Backend:

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --port 8000          # quick loop
docker build -t edadplay-backend .    # what HF Spaces actually runs
```

## Code style

- Vanilla ES modules. No frameworks, no bundlers, no new dependencies without
  strong justification (the zero-dependency frontend is a feature).
- Design tokens live in `docs/css/styles.css` and mirror `design/desgin.pen`.
- UI copy in Spanish; code, comments and commits in English.
- Age thresholds in `docs/js/scoring.js` must cite a source or be explicitly
  flagged `evidence: false` — the UI tells users which thresholds are
  heuristic. Calibration data and studies to back them are very welcome.

## Commit format

[Conventional Commits](https://www.conventionalcommits.org/). Subject <= 50 chars. Body explains *why*, not what.

```
feat: add per-zone flash detection
fix: merge degenerate tail interval into previous segment
docs: add HF Spaces deploy guide
```

No references to AI tools in commit messages.

## Branch model

- `main` — stable; GitHub Pages deploys from `/docs` on every push
- Feature branches → PR → squash merge to main

## Pull requests

- Describe *what* and *why* in the PR body
- One logical change per PR
- For analyzer changes, include before/after measurements on a known video
  (synthetic ffmpeg clips are fine — see the test patterns in git history)
