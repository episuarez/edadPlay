// Client-side audio analysis using Web Audio (OfflineAudioContext).
// The whole track is decoded once, downmixed to mono 22050 Hz, K-weighted
// per ITU-R BT.1770 (highpass + high-shelf biquads) and measured in 400 ms
// short-term loudness windows, EBU R128 style.
//
// Absolute dB SPL cannot be known from a file (it depends on the playback
// device and volume), so loudness is scored RELATIVE to the programme's own
// integrated loudness: sudden jumps ("sustos") are what startles a child.
//
// Per 60 s interval it produces:
// - picosVolumen ...... max short-term loudness minus integrated loudness (dB)
// - densidadSonora .... salient sound onsets per minute (energy-flux peaks)

const SR = 22050;
const ST_WINDOW = 0.4; // s, short-term loudness window
const ST_HOP = 0.1; // s
const ONSET_FRAME = 0.05; // s
const ONSET_MIN_GAP = 1.0; // s between counted events
const GATE_DB = 40; // ignore windows more than this below the loudest

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1) + 0.5));
  return sorted[i];
}

function downmixMono(buffer) {
  const n = buffer.length;
  const mono = new Float32Array(n);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < n; i++) mono[i] += data[i];
  }
  const k = 1 / buffer.numberOfChannels;
  for (let i = 0; i < n; i++) mono[i] *= k;
  return mono;
}

async function kWeight(mono) {
  const ctx = new OfflineAudioContext(1, mono.length, SR);
  const buf = ctx.createBuffer(1, mono.length, SR);
  buf.copyToChannel(mono, 0);

  const source = ctx.createBufferSource();
  source.buffer = buf;

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 38;
  highpass.Q.value = 0.5;

  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 1681;
  shelf.gain.value = 4;

  source.connect(highpass).connect(shelf).connect(ctx.destination);
  source.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

function shortTermLoudness(signal) {
  const win = Math.round(ST_WINDOW * SR);
  const hop = Math.round(ST_HOP * SR);
  const frames = [];
  for (let start = 0; start + win <= signal.length; start += hop) {
    let energy = 0;
    for (let i = start; i < start + win; i++) energy += signal[i] * signal[i];
    const ms = energy / win;
    frames.push({ t: start / SR, db: 10 * Math.log10(ms + 1e-12) });
  }
  return frames;
}

function detectOnsets(signal) {
  const frame = Math.round(ONSET_FRAME * SR);
  const env = [];
  for (let start = 0; start + frame <= signal.length; start += frame) {
    let energy = 0;
    for (let i = start; i < start + frame; i++) energy += signal[i] * signal[i];
    env.push(Math.sqrt(energy / frame));
  }

  const flux = [];
  for (let i = 1; i < env.length; i++) flux.push(Math.max(0, env[i] - env[i - 1]));

  const sorted = [...flux].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p90 = percentile(sorted, 0.9);
  const peak = env.reduce((m, v) => Math.max(m, v), 0);
  // Absolute floor (3% of peak envelope) keeps numeric noise on steady
  // signals from registering as onsets.
  const threshold = Math.max(median + 1.5 * (p90 - median), 0.03 * peak);

  const onsets = [];
  let last = -Infinity;
  for (let i = 0; i < flux.length; i++) {
    const t = (i + 1) * ONSET_FRAME;
    if (flux[i] > threshold && t - last >= ONSET_MIN_GAP) {
      onsets.push(t);
      last = t;
    }
  }
  return onsets;
}

export async function analyzeAudioFile(file, { intervalSec = 60, onProgress = () => {} } = {}) {
  const arrayBuffer = await file.arrayBuffer();
  onProgress(0.1);

  let buffer;
  try {
    const decodeCtx = new OfflineAudioContext(1, 1, SR);
    buffer = await decodeCtx.decodeAudioData(arrayBuffer);
  } catch {
    return null; // no audio track or undecodable codec
  }
  onProgress(0.4);

  const mono = downmixMono(buffer);
  const weighted = await kWeight(mono);
  onProgress(0.6);

  const st = shortTermLoudness(weighted);
  const dbs = st.map((f) => f.db).sort((a, b) => a - b);
  const loudest = dbs[dbs.length - 1] ?? 0;
  const gated = st.filter((f) => f.db > loudest - GATE_DB);
  const integrated = gated.length
    ? 10 * Math.log10(gated.reduce((s, f) => s + 10 ** (f.db / 10), 0) / gated.length)
    : loudest;

  const gatedSorted = gated.map((f) => f.db).sort((a, b) => a - b);
  const lra = +(percentile(gatedSorted, 0.95) - percentile(gatedSorted, 0.10)).toFixed(2);

  onProgress(0.8);
  const onsets = detectOnsets(mono);
  onProgress(0.95);

  const duration = buffer.length / SR;
  let nIntervals = Math.max(1, Math.ceil(duration / intervalSec));
  // Merge a degenerate tail interval (< 5 s) into the previous one, matching
  // the video analyzer's bucketing.
  if (nIntervals > 1 && duration - (nIntervals - 1) * intervalSec < 5) nIntervals -= 1;
  const intervals = [];
  for (let i = 0; i < nIntervals; i++) {
    const start = i * intervalSec;
    const end = i === nIntervals - 1 ? duration : (i + 1) * intervalSec;
    const minutes = Math.max((end - start) / 60, 1 / 60);

    const stIn = st.filter((f) => f.t >= start && f.t < end && f.db > loudest - GATE_DB);
    const maxSt = stIn.length ? Math.max(...stIn.map((f) => f.db)) : integrated;
    const onsetsIn = onsets.filter((t) => t >= start && t < end).length;

    intervals.push({
      start,
      end,
      picosVolumen: +Math.max(0, maxSt - integrated).toFixed(2),
      densidadSonora: +(onsetsIn / minutes).toFixed(2),
    });
  }

  onProgress(1);
  return { duration, integrated: +integrated.toFixed(2), lra, intervals };
}
