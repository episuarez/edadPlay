// Client-side video analysis. No ffmpeg, no uploads — the file never leaves
// the browser.
//
// Strategy:
// 1. Fast path: play the file muted at high speed in a tiny on-DOM <video>
//    and sample every presented frame via requestVideoFrameCallback.
// 2. Fallback: if the browser presented too few frames (headless, throttled
//    or unusual codecs), re-run a deterministic seek-based pass at fixed
//    steps. That pass cannot sample fast enough for WCAG flash detection,
//    so `flashes` is reported as null ("not evaluated") in that mode.
//
// Per 60 s interval it produces:
// - cortes/min ........ shot cuts via luminance-histogram correlation drop
// - movimiento ........ mean inter-frame luminance change inside shots (0-100)
// - complejidad ....... Sobel edge density (0-100)
// - flashes ........... max flashes/s per WCAG 2.3.1 (simplified, 3x3 zones)

const W = 160;
const H = 90;
const HIST_BINS = 32;
const CUT_CORRELATION = 0.6; // below this, consecutive histograms = shot cut
const MAX_PAIR_GAP = 0.6; // s of media time; larger gaps are not comparable
const COMPLEXITY_PERIOD = 0.5; // s between edge-density samples
const FLASH_DELTA = 0.1; // relative luminance swing that counts as a transition
const FLASH_DARK = 0.8; // at least one side of the swing must be below this
const PLAYBACK_RATE = 4;
const SEEK_STEP = 1 / 3; // s, fallback sampling step
const MIN_PAIR_COVERAGE = 0.5; // of duration; below this the fast path failed

function luminanceData(ctx, video) {
  ctx.drawImage(video, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);
  const luma = new Float32Array(W * H);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
  }
  return luma;
}

function histogram(luma) {
  const hist = new Float32Array(HIST_BINS);
  for (let i = 0; i < luma.length; i++) {
    hist[Math.min(HIST_BINS - 1, (luma[i] * HIST_BINS) | 0)]++;
  }
  return hist;
}

function correlation(a, b) {
  let sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / a.length, mb = sb / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 1 : num / den;
}

function meanAbsDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

function edgeDensity(luma) {
  let edges = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -luma[i - W - 1] - 2 * luma[i - 1] - luma[i + W - 1]
               + luma[i - W + 1] + 2 * luma[i + 1] + luma[i + W + 1];
      const gy = -luma[i - W - 1] - 2 * luma[i - W] - luma[i - W + 1]
               + luma[i + W - 1] + 2 * luma[i + W] + luma[i + W + 1];
      if (Math.abs(gx) + Math.abs(gy) > 0.5) edges++;
    }
  }
  return (100 * edges) / ((W - 2) * (H - 2));
}

function zoneLuminances(luma) {
  const zones = new Float32Array(9);
  const counts = new Float32Array(9);
  const zw = W / 3, zh = H / 3;
  for (let y = 0; y < H; y++) {
    const zy = Math.min(2, (y / zh) | 0);
    for (let x = 0; x < W; x++) {
      const z = zy * 3 + Math.min(2, (x / zw) | 0);
      zones[z] += luma[y * W + x];
      counts[z]++;
    }
  }
  for (let z = 0; z < 9; z++) zones[z] /= counts[z];
  return zones;
}

// Max flashes in any sliding 1 s window, evaluated PER ZONE: a single
// full-frame cut hits all 9 zones at the same timestamp and must count as
// one transition, not nine. A flash = 2 opposing transitions.
function maxFlashesPerSecond(zoneTransitions, start, end) {
  let best = 0;
  for (const all of zoneTransitions) {
    const times = all.filter((t) => t >= start && t < end);
    if (times.length < 2) continue;
    let lo = 0;
    for (let hi = 0; hi < times.length; hi++) {
      while (times[hi] - times[lo] > 1.0) lo++;
      best = Math.max(best, hi - lo + 1);
    }
  }
  return best / 2;
}

// Accumulates per-interval statistics frame by frame.
class FrameCollector {
  constructor(duration, intervalSec, { flashEnabled }) {
    this.duration = duration;
    this.intervalSec = intervalSec;
    this.flashEnabled = flashEnabled;
    let n = Math.max(1, Math.ceil(duration / intervalSec));
    // Merge a degenerate tail interval (< 5 s) into the previous one.
    if (n > 1 && duration - (n - 1) * intervalSec < 5) n -= 1;
    this.acc = Array.from({ length: n }, (_, i) => ({
      start: i * intervalSec,
      end: i === n - 1 ? duration : (i + 1) * intervalSec,
      cuts: 0,
      motionSum: 0,
      motionN: 0,
      complexitySum: 0,
      complexityN: 0,
    }));
    this.prevLuma = null;
    this.prevHist = null;
    this.prevT = -1;
    this.lastComplexityT = -COMPLEXITY_PERIOD;
    this.zoneState = Array.from({ length: 9 }, () => ({ ref: null, dir: 0, times: [] }));
    this.pairedTime = 0; // media seconds covered by comparable frame pairs
  }

  process(ctx, video, t) {
    if (t <= this.prevT) return;
    const luma = luminanceData(ctx, video);
    const hist = histogram(luma);
    const idx = Math.min(this.acc.length - 1, (t / this.intervalSec) | 0);
    const slot = this.acc[idx];
    const gap = this.prevT >= 0 ? t - this.prevT : Infinity;

    if (this.prevHist && gap <= MAX_PAIR_GAP) {
      this.pairedTime += gap;
      if (correlation(this.prevHist, hist) < CUT_CORRELATION) {
        slot.cuts++;
      } else {
        slot.motionSum += meanAbsDiff(this.prevLuma, luma) * 100;
        slot.motionN++;
      }
    }

    if (t - this.lastComplexityT >= COMPLEXITY_PERIOD) {
      slot.complexitySum += edgeDensity(luma);
      slot.complexityN++;
      this.lastComplexityT = t;
    }

    // Flash transitions per zone (WCAG 2.3.1 simplified: a transition is a
    // luminance swing >= 0.1 reversing direction, with its dark side < 0.8).
    if (this.flashEnabled) {
      if (gap <= MAX_PAIR_GAP) {
        const zones = zoneLuminances(luma);
        for (let z = 0; z < 9; z++) {
          const s = this.zoneState[z];
          if (s.ref === null) { s.ref = zones[z]; continue; }
          const delta = zones[z] - s.ref;
          const dir = Math.sign(delta);
          if (Math.abs(delta) >= FLASH_DELTA && Math.min(zones[z], s.ref) < FLASH_DARK) {
            if (dir !== 0 && dir !== s.dir) {
              s.times.push(t);
              s.dir = dir;
            }
            s.ref = zones[z];
          } else if (dir !== 0 && dir === s.dir) {
            s.ref = zones[z]; // keep tracking the extreme in this direction
          }
        }
      } else {
        for (const s of this.zoneState) { s.ref = null; s.dir = 0; }
      }
    }

    this.prevLuma = luma;
    this.prevHist = hist;
    this.prevT = t;
  }

  coverage() {
    return this.pairedTime / Math.max(this.duration, 0.001);
  }

  intervals() {
    const zoneTransitions = this.zoneState.map((s) => s.times.sort((a, b) => a - b));
    return this.acc.map((slot) => {
      const minutes = Math.max((slot.end - slot.start) / 60, 1 / 60);
      return {
        start: slot.start,
        end: slot.end,
        cortes: +(slot.cuts / minutes).toFixed(2),
        movimiento: slot.motionN ? +(slot.motionSum / slot.motionN).toFixed(2) : 0,
        complejidad: slot.complexityN ? +(slot.complexitySum / slot.complexityN).toFixed(2) : 0,
        flashes: this.flashEnabled
          ? +maxFlashesPerSecond(zoneTransitions, slot.start, slot.end).toFixed(2)
          : null,
      };
    });
  }
}

function makeVideoElement(url) {
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  // Attached to the DOM so the browser composites it and
  // requestVideoFrameCallback fires per presented frame.
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
  document.body.appendChild(video);
  return video;
}

async function waitMetadata(video) {
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('El navegador no puede decodificar este formato de vídeo.'));
  });
}

async function playbackPass(video, ctx, collector, duration, onProgress) {
  video.playbackRate = PLAYBACK_RATE;
  await video.play();

  await new Promise((resolve, reject) => {
    video.onerror = () => reject(new Error('Error de decodificación durante el análisis.'));
    video.onended = resolve;

    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      const loop = (_now, metadata) => {
        if (video.ended) return;
        try {
          collector.process(ctx, video, metadata.mediaTime);
          onProgress(Math.min(1, metadata.mediaTime / duration));
        } catch (e) {
          reject(e);
          return;
        }
        video.requestVideoFrameCallback(loop);
      };
      video.requestVideoFrameCallback(loop);
    } else {
      const timer = setInterval(() => {
        if (video.ended) { clearInterval(timer); return; }
        try {
          collector.process(ctx, video, video.currentTime);
          onProgress(Math.min(1, video.currentTime / duration));
        } catch (e) {
          clearInterval(timer);
          reject(e);
        }
      }, 33);
      video.addEventListener('ended', () => clearInterval(timer), { once: true });
    }
  });
}

async function seekPass(video, ctx, collector, duration, onProgress) {
  video.pause();
  for (let t = 0; t < duration; t += SEEK_STEP) {
    const target = Math.min(t, Math.max(0, duration - 0.05));
    await new Promise((resolve, reject) => {
      video.onseeked = resolve;
      video.onerror = () => reject(new Error('Error de decodificación durante el análisis.'));
      video.currentTime = target;
    });
    collector.process(ctx, video, target);
    onProgress(Math.min(1, t / duration));
  }
}

export async function analyzeVideoFile(file, { intervalSec = 60, onProgress = () => {} } = {}) {
  const url = URL.createObjectURL(file);
  const video = makeVideoElement(url);

  try {
    await waitMetadata(video);
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('No se pudo determinar la duración del vídeo.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let collector = new FrameCollector(duration, intervalSec, { flashEnabled: true });
    await playbackPass(video, ctx, collector, duration, (p) => onProgress(p * 0.95));

    let degraded = false;
    if (collector.coverage() < MIN_PAIR_COVERAGE) {
      // The browser presented too few frames; redo with deterministic seeks.
      degraded = true;
      collector = new FrameCollector(duration, intervalSec, { flashEnabled: false });
      await seekPass(video, ctx, collector, duration, (p) => onProgress(p * 0.95));
    }

    onProgress(1);
    return { duration, degraded, intervals: collector.intervals() };
  } finally {
    video.pause();
    video.remove();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
