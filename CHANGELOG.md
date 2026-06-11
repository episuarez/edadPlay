# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — 2026-06-11

Full rewrite: from a Streamlit server app to a 100% client-side web app.

### Added
- Browser-based analysis pipeline (no uploads): video decoding via
  `requestVideoFrameCallback` with a deterministic seek fallback, audio via
  `OfflineAudioContext`
- WCAG 2.3.1 flash detection (per-zone luminance) with explicit
  photosensitivity warning
- ITU-R BT.1770 K-weighted loudness; scores sudden loudness jumps instead of
  fake absolute dB
- 90th-percentile aggregation across 60 s segments (replaces the mode, which
  could rate a half-intense video as toddler-safe)
- Basic/expert modes, per-minute timeline, intense moments, distribution
  donut, per-metric sparklines and data-driven verdict/advice copy
- Downloadable self-contained HTML report
- Source tabs: local file, direct URL, and platform URLs (YouTube, Vimeo,
  TikTok…) through an optional backend
- Optional FastAPI + yt-dlp backend for Hugging Face Spaces with PO Token
  provider, Chrome TLS impersonation, client fallback chain and yt-dlp
  self-updates
- Methodology section with citations (Lillard & Peterson 2011, Hinten et al.
  2025, Christakis et al. 2018, WCAG, EBU R128, WHO, AAP)

### Changed
- License: CC0 → MIT
- Streamlit app (`app.py`, `core.py`) kept as legacy reference

## [0.1.0] — 2025-03-29

### Added
- Initial Streamlit application: cuts/min, visual complexity, RMS volume and
  onset density with per-minute classification
