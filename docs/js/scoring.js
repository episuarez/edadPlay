// Age-rating model: metric thresholds per age band and aggregation rules.
//
// Evidence-based thresholds (see index.html#metodologia for citations):
// - cortes/min: Lillard & Peterson (2011) measured pacing as cuts/min.
//   Caillou (~1.8 cuts/min) was harmless for preschoolers, SpongeBob
//   (~5.5 cuts/min) impaired executive function in 4-year-olds.
// - flashes/s: WCAG 2.3.1 / ITU-R BT.1702 set 3 flashes/s as the
//   photosensitive-seizure safety limit at any age.
// - picos de volumen: absolute SPL cannot be measured from a file, so we
//   score sudden loudness jumps relative to the programme's own integrated
//   loudness (ITU-R BT.1770 K-weighting, EBU R128 style).
//
// Heuristic thresholds (calibrated, flagged with evidence:false in the UI):
// movimiento, complejidad, densidadSonora.

export const BANDS = ['0-3', '4-6', '7-12', '13+'];

export const BAND_COLORS = {
  '0-3': '#20a05f',
  '4-6': '#7cb342',
  '7-12': '#f39c12',
  '13+': '#e74c3c',
};

export const METRICS = {
  cortes: {
    label: 'Cortes visuales',
    unit: 'cortes/min',
    thresholds: [2, 4, 8],
    evidence: true,
    description: 'Cambios de plano por minuto. El ritmo de edición rápido se asocia con peor función ejecutiva inmediata en preescolares.',
  },
  movimiento: {
    label: 'Movimiento en pantalla',
    unit: 'índice 0-100',
    thresholds: [5, 10, 18],
    evidence: false,
    description: 'Cantidad media de cambio entre fotogramas consecutivos dentro del mismo plano. Aproxima el dinamismo visual continuo.',
  },
  complejidad: {
    label: 'Complejidad visual',
    unit: 'índice 0-100',
    thresholds: [8, 14, 22],
    evidence: false,
    description: 'Densidad de bordes por fotograma (detalle y saturación de elementos en escena).',
  },
  flashes: {
    label: 'Destellos',
    unit: 'flashes/s (máx)',
    thresholds: [0.5, 1.5, 3],
    evidence: true,
    description: 'Parpadeos de luminancia por segundo. Más de 3/s incumple WCAG 2.3.1 y supone riesgo fotosensible a cualquier edad.',
  },
  picosVolumen: {
    label: 'Picos de volumen',
    unit: 'dB sobre media',
    thresholds: [6, 9, 12],
    evidence: true,
    description: 'Salto máximo de sonoridad a corto plazo respecto a la sonoridad media del vídeo (sustos, golpes de efecto).',
  },
  densidadSonora: {
    label: 'Densidad sonora',
    unit: 'eventos/min',
    thresholds: [5, 10, 20],
    evidence: false,
    description: 'Eventos sonoros salientes por minuto (apariciones bruscas de sonido por encima del nivel habitual del vídeo).',
  },
};

export const METRIC_KEYS = Object.keys(METRICS);

// Returns band index (0..3) required by a metric value.
export function bandIndexFor(metricKey, value) {
  if (value == null || Number.isNaN(value)) return 0;
  const t = METRICS[metricKey].thresholds;
  for (let i = 0; i < t.length; i++) {
    if (value <= t[i]) return i;
  }
  return t.length; // 13+
}

// Per-interval rating: the strictest metric decides.
export function classifyInterval(metricValues) {
  const perMetric = {};
  let worst = 0;
  let worstKey = null;
  for (const key of METRIC_KEYS) {
    const idx = bandIndexFor(key, metricValues[key]);
    perMetric[key] = idx;
    if (idx > worst) {
      worst = idx;
      worstKey = key;
    }
  }
  return { perMetric, bandIndex: worst, drivenBy: worstKey };
}

// Global rating: 90th percentile of interval ratings, so sustained intensity
// dominates while a single outlier interval does not. A photosensitivity
// violation (>3 flashes/s) always escalates to 13+ with an explicit warning.
export function overallRating(intervals) {
  const indices = intervals.map((iv) => iv.rating.bandIndex).sort((a, b) => a - b);
  const p90 = indices[Math.min(indices.length - 1, Math.floor(0.9 * (indices.length - 1) + 0.999))];

  const flashLimit = METRICS.flashes.thresholds[2];
  const flashViolation = intervals.some((iv) => (iv.metrics.flashes ?? 0) > flashLimit);

  const warnings = [];
  if (flashViolation) {
    warnings.push({
      type: 'fotosensibilidad',
      text: 'El vídeo supera los 3 destellos por segundo (WCAG 2.3.1). Riesgo de crisis fotosensibles a cualquier edad. No recomendado para personas con epilepsia fotosensible.',
    });
  }

  const maxIdx = indices[indices.length - 1];
  if (maxIdx > p90) {
    warnings.push({
      type: 'picos',
      text: 'Algunos momentos puntuales del vídeo son más intensos que la clasificación global. Revisa la línea de tiempo.',
    });
  }

  const bandIndex = flashViolation ? BANDS.length - 1 : p90;
  return { bandIndex, band: BANDS[bandIndex], warnings, flashViolation };
}

// Summary value per metric across intervals: 90th percentile too,
// consistent with the global rule.
export function summarizeMetric(intervals, key) {
  const values = intervals
    .map((iv) => iv.metrics[key])
    .filter((v) => v != null && !Number.isNaN(v))
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const i = Math.min(values.length - 1, Math.floor(0.9 * (values.length - 1) + 0.999));
  return values[i];
}
