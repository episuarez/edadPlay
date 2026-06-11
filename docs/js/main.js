import { analyzeVideoFile } from './video-analyzer.js';
import { analyzeAudioFile } from './audio-analyzer.js';
import {
  BANDS, METRICS, METRIC_KEYS, classifyInterval, overallRating, summarizeMetric,
} from './scoring.js';
import {
  formatTime, findDrivers, verdictTitle, verdictSummary, confidence,
  flashViolationRange, warningText, advice, buildTips, intenseMoments,
  intensityScore, metricCaption,
} from './insights.js';
import { BACKEND_URL } from './config.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const BAND_VAR = ['var(--age-0-3)', 'var(--age-4-6)', 'var(--age-7-12)', 'var(--age-13)'];
const BAND_LABELS = ['0–3', '4–6', '7–12', '13+'];

const METRIC_ICONS = {
  cortes: 'scissors',
  movimiento: 'move',
  complejidad: 'scan-eye',
  flashes: 'zap',
  picosVolumen: 'volume-2',
  densidadSonora: 'audio-waveform',
};

let mode = 'basico';
let activeTab = 'file';
let lastReport = null;

function icons() {
  window.lucide?.createIcons();
}

function agePillHTML(bandIndex, label, small = false) {
  return `<span class="age-pill band-${bandIndex}${small ? ' small' : ''}"><span class="dot"></span>${label}</span>`;
}

/* ================= Static home content ================= */

const AGE_CARD_DATA = [
  { band: 0, label: '0–3 años', big: 'Evitar', caption: 'Mejor sin pantallas' },
  { band: 1, label: '4–6 años', big: '≤ 1 h', caption: 'Supervisada por un adulto' },
  { band: 2, label: '7–12 años', big: '1–2 h', caption: 'Con pausas y acompañamiento' },
  { band: 3, label: '13+ años', big: 'Equilibrado', caption: 'Autonomía con criterio' },
];

function thresholdRows(bandIdx) {
  const rows = [
    ['Cortes / min', 'cortes', ''],
    ['Destellos / s', 'flashes', ''],
    ['Picos de volumen', 'picosVolumen', ' dB'],
    ['Eventos sonoros / min', 'densidadSonora', ''],
  ];
  return rows.map(([label, key, suffix]) => {
    const t = METRICS[key].thresholds;
    let value;
    if (bandIdx < 3) value = `≤ ${String(t[bandIdx]).replace('.', ',')}${suffix}`;
    else value = key === 'flashes' ? '> 3 · aviso' : `> ${t[2]}${suffix}`;
    return `<div class="threshold-row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
  }).join('');
}

function renderAgeCards() {
  $('#age-cards').innerHTML = AGE_CARD_DATA.map((c) => `
    <div class="tile age-card">
      <div>${agePillHTML(c.band, c.label)}</div>
      <div>
        <div class="big-value">${c.big}</div>
        <p class="big-caption">${c.caption}</p>
      </div>
      <div class="threshold-list">${thresholdRows(c.band)}</div>
    </div>`).join('');
}

const METH_CARDS = [
  {
    icon: 'scissors', title: 'Cortes visuales',
    friendly: 'Cuántas veces cambia el plano por minuto. Un ritmo demasiado rápido agota la atención de los más pequeños.',
    base: 'Lillard & Peterson (2011): ~5,5 cortes/min redujeron la función ejecutiva en niños de 4 años; ~1–2 cortes/min no. Confirmado por metaanálisis de 2025 (Hinten et al.).',
  },
  {
    icon: 'zap', title: 'Destellos',
    friendly: 'Cambios bruscos de luz que pueden resultar molestos o, en casos extremos, peligrosos.',
    base: 'WCAG 2.3.1 simplificada: más de 3 destellos/s puede provocar crisis en personas con epilepsia fotosensible. Si se supera, EdadPlay siempre avisa.',
  },
  {
    icon: 'volume-2', title: 'Picos de volumen',
    friendly: 'Sustos y golpes de efecto: subidas de sonido muy por encima de la media del propio vídeo.',
    base: 'Sonoridad con filtro K de ITU-R BT.1770 (estándar de TV, base de EBU R128) en ventanas de 400 ms. La OMS sitúa la escucha segura infantil por debajo de 75 dB.',
  },
  {
    icon: 'audio-waveform', title: 'Densidad sonora',
    friendly: 'Cuántos sonidos llamativos por minuto bombardean el oído: efectos, golpes, exclamaciones.',
    base: 'Christakis et al. (PNAS 2018): la estimulación audiovisual excesiva en edades tempranas se vincula con problemas posteriores de atención.',
  },
  {
    icon: 'move', title: 'Movimiento en pantalla',
    friendly: 'Cuánto se mueve la imagen dentro de un mismo plano: una charla tranquila no es una persecución.',
    base: 'Cambio medio de luminancia entre fotogramas del mismo plano. Umbral heurístico.',
  },
  {
    icon: 'scan-eye', title: 'Complejidad visual',
    friendly: 'Cuántos elementos compiten a la vez por la atención en pantalla.',
    base: 'Densidad de bordes (operador Sobel) por fotograma. Umbral heurístico.',
  },
];

function renderMethCards() {
  $('#meth-cards').innerHTML = METH_CARDS.map((c) => `
    <div class="tile meth-card">
      <div class="meth-top">
        <span class="icon-wrap md"><i data-lucide="${c.icon}"></i></span>
        <h3>${c.title}</h3>
      </div>
      <p class="meth-friendly">${c.friendly}</p>
      <div class="base-wrap">
        <span class="base-label">BASE CIENTÍFICA</span>
        <p class="base-text">${c.base}</p>
      </div>
    </div>`).join('');
}

const REFERENCES = [
  ['Lillard & Peterson (2011)', "The Immediate Impact of Different Types of Television on Young Children's Executive Function. Pediatrics.", 'https://doi.org/10.1542/peds.2010-1919'],
  ['Hinten et al. (2025)', "Meta-Analytic Review of Media Exposure on Children's Attention and Executive Functions. Developmental Science.", 'https://onlinelibrary.wiley.com/doi/10.1111/desc.70069'],
  ['Christakis et al. (2018)', 'How early media exposure may affect cognitive function. PNAS.', 'https://www.pnas.org/doi/10.1073/pnas.1711548115'],
  ['W3C — WCAG 2.1, SC 2.3.1', 'Three Flashes or Below Threshold.', 'https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html'],
  ['ITU-R BT.1770 / EBU R128', 'Medición de sonoridad de programas.', 'https://tech.ebu.ch/docs/r/r128.pdf'],
  ['OMS (2019)', 'Guidelines on physical activity, sedentary behaviour and sleep for children under 5.', 'https://apps.who.int/iris/handle/10665/311664'],
  ['OMS — Make Listening Safe', 'Escucha segura infantil: < 75 dB.', 'https://cdn.who.int/media/docs/default-source/documents/health-topics/deafness-and-hearing-loss/monograph-on-noise-exposure-limit-for-children-in-recreational-settings.pdf'],
  ['AAP (2016)', 'Media and Young Minds. Pediatrics.', 'https://publications.aap.org/pediatrics/article/138/5/e20162591/60321/Media-and-Young-Minds'],
];

function renderRefs() {
  $('#refs-grid').innerHTML = REFERENCES.map(([title, desc, url]) => `
    <a class="ref-card" href="${url}" target="_blank" rel="noopener">
      <i data-lucide="external-link"></i>
      <span>
        <span class="ref-title">${title}</span>
        <p class="ref-desc">${desc}</p>
      </span>
    </a>`).join('');
}

/* ================= Input: tabs, mode, sources ================= */

function showError(message) {
  const box = $('#error-box');
  box.textContent = message;
  box.hidden = false;
}

function clearError() {
  $('#error-box').hidden = true;
}

function setTab(tab) {
  activeTab = tab;
  $$('.source-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#panel-file').hidden = tab !== 'file';
  $('#panel-url').hidden = tab !== 'url';
  $('#panel-youtube').hidden = tab !== 'youtube';
  if (tab === 'youtube' && !BACKEND_URL) {
    $('#youtube-hint').textContent = 'Sin servidor de descarga configurado: YouTube no permite acceder al vídeo desde otra web. '
      + 'Descarga el vídeo en tu dispositivo y usa «Archivo local» — el análisis es idéntico.';
  }
}

function setMode(m) {
  mode = m;
  $$('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  applyMode();
}

function applyMode() {
  const expert = mode === 'experto';
  $$('.expert-only').forEach((el) => { el.hidden = !expert; });
  $('#basic-tips-section').hidden = expert;
}

function setProgress(videoP, audioP, label) {
  const p = Math.round((videoP * 0.8 + audioP * 0.2) * 100);
  $('#progress-bar').style.width = `${p}%`;
  $('#progress-label').textContent = label || `Analizando… ${p}%`;
}

function startProgress(label) {
  clearError();
  $('#progress-wrap').hidden = false;
  $('#analyze-btn').disabled = true;
  setProgress(0, 0, label);
}

function stopProgress() {
  $('#progress-wrap').hidden = true;
  $('#analyze-btn').disabled = false;
}

/* ================= Analysis flows ================= */

let pendingFile = null;

async function analyze(file) {
  startProgress('Preparando análisis…');
  const t0 = performance.now();
  let videoP = 0;
  let audioP = 0;

  try {
    const [videoResult, audioResult] = await Promise.all([
      analyzeVideoFile(file, { onProgress: (p) => { videoP = p; setProgress(videoP, audioP); } }),
      analyzeAudioFile(file, { onProgress: (p) => { audioP = p; setProgress(videoP, audioP); } }),
    ]);

    const intervals = videoResult.intervals.map((vi, i) => {
      const ai = audioResult?.intervals[i];
      const metrics = {
        cortes: vi.cortes,
        movimiento: vi.movimiento,
        complejidad: vi.complejidad,
        flashes: vi.flashes,
        picosVolumen: ai ? ai.picosVolumen : null,
        densidadSonora: ai ? ai.densidadSonora : null,
      };
      return { start: vi.start, end: vi.end, metrics, rating: classifyInterval(metrics) };
    });

    const overall = overallRating(intervals);
    const elapsed = (performance.now() - t0) / 1000;
    renderResults({
      fileName: file.name,
      duration: videoResult.duration,
      intervals,
      overall,
      elapsed,
      degraded: videoResult.degraded,
      hasAudio: audioResult !== null,
    });
  } catch (e) {
    showError(e.message || 'Error inesperado durante el análisis.');
  } finally {
    stopProgress();
  }
}

const STREAMING_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|tiktok\.com|instagram\.com|facebook\.com|twitch\.tv|reddit\.com|twitter\.com|x\.com)$/i;

async function fetchAsFile(fetchUrl, displayName, label) {
  startProgress(label);
  const resp = await fetch(fetchUrl, { mode: 'cors' });
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.json()).detail || ''; } catch { /* not JSON */ }
    throw new Error(detail || `El servidor respondió ${resp.status}.`);
  }
  const blob = await resp.blob();
  return new File([blob], displayName, { type: blob.type || 'video/mp4' });
}

async function analyzeDirectUrl(rawUrl) {
  clearError();
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    showError('La URL no es válida.');
    return;
  }
  if (STREAMING_HOSTS.test(url.hostname)) {
    setTab('youtube');
    $('#youtube-input').value = rawUrl;
    analyzeYoutube(rawUrl);
    return;
  }
  try {
    const file = await fetchAsFile(url, decodeURIComponent(url.pathname.split('/').pop() || 'video'), 'Descargando vídeo…');
    await analyze(file);
  } catch (e) {
    stopProgress();
    showError('No se pudo descargar la URL. El origen debe permitir CORS y apuntar a un archivo de vídeo. '
      + `Alternativa: descarga el vídeo y usa «Archivo local». Detalle: ${e.message}`);
  }
}

async function analyzeYoutube(rawUrl) {
  clearError();
  if (!rawUrl) { showError('Pega un enlace de YouTube o Vimeo.'); return; }
  if (!BACKEND_URL) {
    showError('Esta instalación no tiene servidor de descarga configurado. YouTube no permite acceder al vídeo '
      + 'desde otra web: descarga el vídeo en tu dispositivo y usa «Archivo local».');
    return;
  }
  try {
    const file = await fetchAsFile(
      `${BACKEND_URL.replace(/\/$/, '')}/api/fetch?url=${encodeURIComponent(rawUrl)}`,
      'video_online.mp4',
      'Obteniendo vídeo de la plataforma… (puede tardar un poco)',
    );
    await analyze(file);
  } catch (e) {
    stopProgress();
    showError(`${e.message} Alternativa que siempre funciona: descarga el vídeo y usa «Archivo local».`);
  }
}

function runAnalysis() {
  if (activeTab === 'file') {
    if (pendingFile) analyze(pendingFile);
    else $('#file-input').click();
  } else if (activeTab === 'url') {
    const v = $('#url-input').value.trim();
    if (v) analyzeDirectUrl(v);
    else showError('Pega la URL directa de un archivo de vídeo.');
  } else {
    analyzeYoutube($('#youtube-input').value.trim());
  }
}

/* ================= Results rendering ================= */

function renderResults(data) {
  const { fileName, duration, intervals, overall, elapsed, degraded, hasAudio } = data;
  const overallIndex = overall.bandIndex;
  const drivers = findDrivers(intervals, overallIndex);
  const flashRange = overall.flashViolation ? flashViolationRange(intervals) : null;

  $('#r-file').textContent = `${fileName} · ${formatTime(duration)}`;
  $('#r-done').textContent = `Analizado en ${formatTime(elapsed)} · 100 % local`;

  const circle = $('#r-age-circle');
  circle.textContent = BAND_LABELS[overallIndex];
  circle.style.background = BAND_VAR[overallIndex];
  circle.style.color = '#fff';

  $('#r-confidence').textContent = confidence(intervals);
  $('#r-verdict-title').textContent = verdictTitle(overallIndex);

  let summary = verdictSummary(drivers, overallIndex);
  if (degraded) summary += ' (Modo de compatibilidad: destellos no evaluados.)';
  if (!hasAudio) summary += ' (Sin pista de audio analizable.)';
  $('#r-verdict-summary').textContent = summary;

  const warningTile = $('#r-warning');
  if (flashRange) {
    warningTile.hidden = false;
    $('#r-warning-text').textContent = warningText(flashRange);
  } else {
    warningTile.hidden = true;
  }

  $('#r-advice').textContent = advice(drivers, overallIndex, flashRange);

  renderTimeline(intervals);
  renderMoments(intervals, overallIndex);
  renderMetricCards(intervals);
  renderDonut(intervals);

  const tips = buildTips(drivers, overallIndex, flashRange);
  const tipHTML = tips.map((t) => `
    <div class="tip">
      <i data-lucide="circle-check"></i>
      <span><span class="tip-title">${t.title}</span><p class="tip-desc">${t.desc}</p></span>
    </div>`).join('');
  $('#r-tips').innerHTML = tipHTML;
  $('#r-tips-basic').innerHTML = tipHTML;

  lastReport = data;
  window.__edadplayReport = data;
  $('#view-home').hidden = true;
  $('#view-results').hidden = false;
  applyMode();
  icons();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderTimeline(intervals) {
  const bars = $('#r-bars');
  bars.innerHTML = intervals.map((iv) => {
    const h = Math.round(15 + Math.min(1.5, intensityScore(iv)) / 1.5 * 85);
    const band = iv.rating.bandIndex;
    const driver = iv.rating.drivenBy ? ` · ${METRICS[iv.rating.drivenBy].label.toLowerCase()}` : '';
    return `<span class="bar" style="height:${h}%;background:${BAND_VAR[band]}"
      title="${formatTime(iv.start)}–${formatTime(iv.end)} · ${BAND_LABELS[band]}${driver}"></span>`;
  }).join('');

  const total = intervals[intervals.length - 1].end;
  const n = Math.min(5, Math.max(2, Math.round(total / 120) + 1));
  const labels = [];
  for (let i = 0; i < n; i++) labels.push(formatTime((total * i) / (n - 1)));
  $('#r-xlabels').innerHTML = labels.map((l) => `<span>${l}</span>`).join('');
}

function renderMoments(intervals, overallIndex) {
  const moments = intenseMoments(intervals, overallIndex);
  const tile = $('#r-moments-tile');
  if (!moments.length) {
    tile.querySelector('#r-moments').innerHTML = '<p class="tl-sub">Sin momentos destacables: intensidad estable.</p>';
    return;
  }
  $('#r-moments').innerHTML = moments.map((m) => `
    <div class="moment">
      <div class="moment-top">
        <span class="moment-time">${formatTime(m.start)}–${formatTime(m.end)}</span>
        ${agePillHTML(m.bandIndex, BAND_LABELS[m.bandIndex], true)}
      </div>
      <p class="moment-desc">${m.description}</p>
    </div>`).join('');
}

function renderMetricCards(intervals) {
  $('#r-metrics').innerHTML = METRIC_KEYS.map((key) => {
    const def = METRICS[key];
    const summary = summarizeMetric(intervals, key);
    const values = intervals.map((iv) => iv.metrics[key] ?? 0);
    const max = Math.max(...values, 1e-6);
    const maxIdx = values.indexOf(Math.max(...values));

    let bandIdx = 0;
    if (summary != null) {
      bandIdx = def.thresholds.findIndex((t) => summary <= t);
      if (bandIdx === -1) bandIdx = def.thresholds.length;
    }
    const isFlashWarn = key === 'flashes' && summary != null && summary > def.thresholds[2];
    const pillLabel = isFlashWarn ? 'Aviso' : BAND_LABELS[bandIdx];

    const sparkBars = values.slice(0, 16).map((v, i) => {
      const h = Math.max(4, Math.round((v / max) * 46));
      const color = i === maxIdx ? `background:${BAND_VAR[bandIdx]}` : '';
      return `<span style="height:${h}px;${color}"></span>`;
    }).join('');

    const display = summary == null ? '—'
      : (key === 'picosVolumen' ? `+${String(summary).replace('.', ',')}` : String(summary).replace('.', ','));

    return `
      <div class="tile metric-card">
        <div class="mc-top">
          <span class="mc-title"><i data-lucide="${METRIC_ICONS[key]}"></i> ${def.label}</span>
          ${agePillHTML(bandIdx, pillLabel, true)}
        </div>
        <div class="mc-mid">
          <div>
            <div class="mc-value">${display}</div>
            <p class="mc-unit">${def.unit}</p>
          </div>
          <div class="sparkline">${sparkBars}</div>
        </div>
        <div class="mc-caption">${metricCaption(key, summary, intervals)}</div>
      </div>`;
  }).join('');
}

function renderDonut(intervals) {
  const counts = [0, 0, 0, 0];
  for (const iv of intervals) counts[iv.rating.bandIndex]++;
  const total = intervals.length;

  let acc = 0;
  const stops = [];
  for (let b = 3; b >= 0; b--) {
    if (!counts[b]) continue;
    const from = (acc / total) * 360;
    acc += counts[b];
    const to = (acc / total) * 360;
    stops.push(`${BAND_VAR[b]} ${from.toFixed(1)}deg ${to.toFixed(1)}deg`);
  }
  $('#r-donut').style.background = `conic-gradient(${stops.join(', ')})`;
  $('#r-donut-num').textContent = total;

  $('#r-dist').innerHTML = [3, 2, 1, 0]
    .filter((b) => counts[b] > 0)
    .map((b) => `
      <div class="dist-row">
        <span class="dist-left"><span class="dot" style="background:${BAND_VAR[b]}"></span>${BAND_LABELS[b]}</span>
        <span class="dist-value">${counts[b]} ${counts[b] === 1 ? 'tramo' : 'tramos'} · ${Math.round((counts[b] / total) * 100)} %</span>
      </div>`).join('');
}

/* ================= Report download ================= */

function downloadReport() {
  if (!lastReport) return;
  const { fileName, duration, intervals, overall, elapsed } = lastReport;
  const overallIndex = overall.bandIndex;
  const drivers = findDrivers(intervals, overallIndex);
  const flashRange = overall.flashViolation ? flashViolationRange(intervals) : null;

  const rows = intervals.map((iv) => `
    <tr><td>${formatTime(iv.start)}–${formatTime(iv.end)}</td><td>${BAND_LABELS[iv.rating.bandIndex]}</td>
    ${METRIC_KEYS.map((k) => `<td>${iv.metrics[k] ?? '—'}</td>`).join('')}</tr>`).join('');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Informe EdadPlay — ${fileName}</title>
<style>body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;color:#1C1233}
h1{color:#7B61FF}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #ddd;padding:6px 8px;text-align:center}
th{background:#F4F1FB}.badge{display:inline-block;background:${['#2FB67C', '#8BC34A', '#F5A524', '#F0426B'][overallIndex]};color:#fff;padding:6px 18px;border-radius:999px;font-size:22px;font-weight:700}</style></head><body>
<h1>🎬 Informe EdadPlay</h1>
<p><strong>${fileName}</strong> · duración ${formatTime(duration)} · analizado en ${formatTime(elapsed)} · 100 % local</p>
<p>Edad recomendada: <span class="badge">${BAND_LABELS[overallIndex]}</span></p>
<p>${verdictSummary(drivers, overallIndex)}</p>
${flashRange ? `<p style="color:#B22650"><strong>⚠ ${warningText(flashRange)}</strong></p>` : ''}
<p><em>${advice(drivers, overallIndex, flashRange)}</em></p>
<h2>Detalle por tramos</h2>
<table><tr><th>Tramo</th><th>Edad</th>${METRIC_KEYS.map((k) => `<th>${METRICS[k].label}</th>`).join('')}</tr>${rows}</table>
<p style="font-size:12px;color:#9A94AD">Herramienta orientativa: no sustituye el criterio de padres o profesionales. Metodología y referencias en la aplicación EdadPlay.</p>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `edadplay-informe-${fileName.replace(/\.[^.]+$/, '')}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ================= Wiring ================= */

function resetToHome() {
  $('#view-results').hidden = true;
  $('#view-home').hidden = false;
  pendingFile = null;
  $('#file-input').value = '';
  $('.drop-title').textContent = 'Arrastra un vídeo aquí o haz clic para seleccionar';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const dropzone = $('#dropzone');
dropzone.addEventListener('click', () => $('#file-input').click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragging'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragging');
  const file = e.dataTransfer.files[0];
  if (file) { pendingFile = file; analyze(file); }
});
$('#file-input').addEventListener('change', () => {
  const file = $('#file-input').files[0];
  if (file) {
    pendingFile = file;
    $('.drop-title').textContent = `Seleccionado: ${file.name}`;
  }
});

$$('.source-tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
$$('.mode-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('#analyze-btn').addEventListener('click', runAnalysis);
$('#url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAnalysis(); });
$('#youtube-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runAnalysis(); });

$$('[data-new-analysis]').forEach((b) => b.addEventListener('click', resetToHome));
$('#logo-link').addEventListener('click', (e) => { e.preventDefault(); resetToHome(); });
$$('[data-scroll-top]').forEach((b) => b.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' })));
$('#download-report').addEventListener('click', downloadReport);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !$('#progress-wrap').hidden) {
    $('#progress-label').textContent = 'Mantén esta pestaña visible: el navegador pausa el análisis en segundo plano.';
  }
});

renderAgeCards();
renderMethCards();
renderRefs();
setTab('file');
icons();
