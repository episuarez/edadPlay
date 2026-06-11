// Data-driven copy for the results view: verdict, summary, advice, tips,
// intense moments, confidence and per-metric captions.

import { BANDS, METRICS, METRIC_KEYS, bandIndexFor, summarizeMetric } from './scoring.js';

const DRIVER_PHRASES = {
  cortes: 'ritmo de edición muy rápido',
  movimiento: 'mucho movimiento continuo en pantalla',
  complejidad: 'imágenes muy cargadas de elementos',
  flashes: 'destellos de luz intensos',
  picosVolumen: 'subidas de volumen frecuentes',
  densidadSonora: 'muchos estímulos sonoros sostenidos',
};

const VERDICT_TITLES = [
  'Apto incluso para los más pequeños',
  'Mejor a partir de 4 años',
  'Mejor a partir de 7 años',
  'Mejor a partir de 13 años',
];

const CALM_SUMMARY = 'Ritmo pausado, volumen estable y pocos estímulos. Un contenido tranquilo que no satura la atención.';

export function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Metrics whose sustained (p90) value demands the final band.
export function findDrivers(intervals, overallIndex) {
  if (overallIndex === 0) return [];
  const drivers = [];
  for (const key of METRIC_KEYS) {
    const summary = summarizeMetric(intervals, key);
    if (summary != null && bandIndexFor(key, summary) >= overallIndex) drivers.push(key);
  }
  return drivers;
}

export function verdictTitle(overallIndex) {
  return VERDICT_TITLES[overallIndex];
}

export function verdictSummary(drivers, overallIndex) {
  if (overallIndex === 0 || !drivers.length) return CALM_SUMMARY;
  const phrases = drivers.map((k) => DRIVER_PHRASES[k]);
  let joined;
  if (phrases.length === 1) joined = phrases[0];
  else joined = `${phrases.slice(0, -1).join(', ')} y ${phrases[phrases.length - 1]}`;
  const cap = joined.charAt(0).toUpperCase() + joined.slice(1);
  const target = BANDS[overallIndex] === '13+' ? '13 años' : `${BANDS[overallIndex].split('-')[0]} años`;
  return `${cap}. Para menores de ${target} resulta agotador para la atención.`;
}

export function confidence(intervals) {
  const n = intervals.length;
  if (n >= 8) return `Confianza alta · ${n} tramos`;
  if (n >= 4) return `Confianza media · ${n} tramos`;
  return `Confianza baja · vídeo corto (${n} ${n === 1 ? 'tramo' : 'tramos'})`;
}

// First time range where the WCAG flash limit is exceeded.
export function flashViolationRange(intervals) {
  const limit = METRICS.flashes.thresholds[2];
  const bad = intervals.filter((iv) => (iv.metrics.flashes ?? 0) > limit);
  if (!bad.length) return null;
  return { start: bad[0].start, end: bad[bad.length - 1].end, count: bad.length };
}

export function warningText(range) {
  return `Supera los 3 destellos por segundo (WCAG 2.3.1) entre ${formatTime(range.start)} y ${formatTime(range.end)}. `
    + 'No recomendado para personas con epilepsia fotosensible, a cualquier edad.';
}

export function advice(drivers, overallIndex, flashRange) {
  if (overallIndex === 0) {
    return 'Contenido tranquilo. Aun así, mejor verlo acompañado, con el volumen moderado y sin alargar la sesión.';
  }
  const parts = [];
  if (drivers.includes('picosVolumen') || drivers.includes('densidadSonora')) {
    parts.push('baja el volumen');
  }
  parts.push('acompáñalos');
  let text = `Si lo van a ver peques, ${parts.join(', ')}`;
  if (flashRange) {
    text += ` y evita el tramo ${formatTime(flashRange.start)}–${formatTime(flashRange.end)}`;
  }
  text += '.';
  if (drivers.includes('cortes') || drivers.includes('movimiento') || overallIndex >= 2) {
    text += ' Mejor no verlo justo antes de dormir.';
  }
  return text;
}

export function buildTips(drivers, overallIndex, flashRange) {
  const tips = [
    { title: 'Verlo acompañado', desc: 'Comentar lo que pasa reduce el impacto de los estímulos.' },
    { title: 'Volumen por debajo de 75 dB', desc: 'Escucha segura infantil según la OMS.' },
  ];
  if (flashRange) {
    tips.push({
      title: `Saltar el tramo ${formatTime(flashRange.start)}–${formatTime(flashRange.end)}`,
      desc: 'Concentra los destellos y los picos de volumen.',
    });
  }
  if (drivers.includes('cortes') || drivers.includes('movimiento') || overallIndex >= 2) {
    tips.push({ title: 'No justo antes de dormir', desc: 'El ritmo rápido activa en lugar de relajar.' });
  }
  while (tips.length < 4) {
    tips.push(
      { title: 'Pausas cada 20–30 minutos', desc: 'Descansar la vista y moverse equilibra la sesión.' },
      { title: 'Alternar con juego sin pantalla', desc: 'La OMS recomienda priorizar el juego activo.' },
    );
  }
  return tips.slice(0, 4);
}

const MOMENT_DESCRIPTIONS = {
  cortes: (v) => `${Math.round(v)} cortes de plano en un solo minuto`,
  picosVolumen: (v) => `Subida brusca de volumen (+${v} dB)`,
  flashes: (v) => `Destellos sobre el límite (${v}/s)`,
  densidadSonora: (v) => `${Math.round(v)} sonidos llamativos en un minuto`,
  movimiento: () => 'Movimiento continuo muy elevado',
  complejidad: () => 'Imagen muy cargada de elementos',
};

export function intenseMoments(intervals, overallIndex, maxItems = 3) {
  const candidates = intervals
    .filter((iv) => iv.rating.bandIndex > 0 && iv.rating.bandIndex >= overallIndex)
    .sort((a, b) => b.rating.bandIndex - a.rating.bandIndex
      || intensityScore(b) - intensityScore(a))
    .slice(0, maxItems);

  return candidates.map((iv) => {
    const key = iv.rating.drivenBy;
    const value = iv.metrics[key];
    return {
      start: iv.start,
      end: iv.end,
      bandIndex: iv.rating.bandIndex,
      description: key ? MOMENT_DESCRIPTIONS[key](value) : 'Tramo intenso',
    };
  });
}

// 0..1.5 — how far the interval's worst metric exceeds the 7-12 threshold.
export function intensityScore(interval) {
  let worst = 0;
  for (const key of METRIC_KEYS) {
    const v = interval.metrics[key];
    if (v == null) continue;
    worst = Math.max(worst, Math.min(1.5, v / METRICS[key].thresholds[2]));
  }
  return worst;
}

export function metricCaption(key, summary, intervals) {
  const def = METRICS[key];
  if (summary == null) return 'No evaluado en este análisis';
  const idx = bandIndexFor(key, summary);

  if (key === 'flashes' && summary > def.thresholds[2]) {
    return 'Límite WCAG 2.3.1: 3/s · genera advertencia explícita';
  }
  if (idx === 0) {
    return `Por debajo de todos los umbrales · ${def.evidence ? 'sin riesgo conocido' : 'umbral heurístico'}`;
  }

  const limit = def.thresholds[idx - 1];
  const exceeding = intervals.filter((iv) => {
    const v = iv.metrics[key];
    return v != null && v > limit;
  }).length;
  const sustained = exceeding > intervals.length / 2;
  const qualifier = sustained ? 'lo supera de forma sostenida' : 'lo supera en algunos tramos';
  return `Umbral ${BANDS[idx - 1]}: ≤ ${limit}${key === 'picosVolumen' ? ' dB' : ''} · ${qualifier}`;
}
