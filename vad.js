// Vad tells when the presenter is audibly speaking, from the microphone's
// loudness. Speech recognition reports words late and in bursts; the level
// meter reacts within a frame, so the prompter can glide only while the
// presenter talks and stop as soon as they pause.
const Vad = (() => {
  const RATIO = 3; // voiced when louder than the noise floor by ~10 dB
  const MIN_LEVEL = 0.003; // RMS below this is silence however quiet the room
  const FLOOR_RISE = 1; // per second; the floor follows the room up slowly
  const HANGOVER = 0.2; // s voiced keeps reading true after the level drops
  const SPAN = 10; // s of history kept

  // ---- Detector: loudness → voiced, against an adaptive noise floor --------

  function createDetector() {
    return { floor: MIN_LEVEL, voicedUntil: -Infinity };
  }

  // detect returns the next detector state, whether t is voiced (speech,
  // with gaps between words bridged by HANGOVER) and whether the level is
  // loud right now (no hangover). The noise
  // floor drops to any quieter level at once and rises slowly, so the gaps
  // between syllables keep it at the room's level during speech.
  function detect(d, level, t, dt) {
    const floor = Math.max(MIN_LEVEL, Math.min(level, d.floor * Math.exp(FLOOR_RISE * dt)));
    const loud = level > MIN_LEVEL && level > floor * RATIO;
    const voicedUntil = loud ? t + HANGOVER : d.voicedUntil;
    return { state: { floor, voicedUntil }, voiced: t <= voicedUntil, loud };
  }

  // ---- Log: when speech happened ------------------------------------------

  function createLog() {
    return [];
  }

  // record appends the interval [t0, t1] and drops what is older than SPAN.
  function record(log, t0, t1, voiced) {
    const last = log[log.length - 1];
    if (last && last.voiced === voiced && last.t1 >= t0 - 1e-6) last.t1 = t1;
    else log.push({ t0, t1, voiced });
    while (log.length && log[0].t1 < t1 - SPAN) log.shift();
    return log;
  }

  // voicedBetween returns the seconds of speech within [a, b].
  function voicedBetween(log, a, b) {
    let sum = 0;
    for (const f of log) if (f.voiced) sum += Math.max(0, Math.min(b, f.t1) - Math.max(a, f.t0));
    return sum;
  }

  // lastOnset returns when speech last resumed after at least minSilence
  // seconds of silence, or null.
  function lastOnset(log, minSilence) {
    for (let i = log.length - 1; i > 0; i--) {
      const f = log[i];
      const before = log[i - 1];
      if (f.voiced && !before.voiced && before.t1 - before.t0 >= minSilence) return f.t0;
    }
    return null;
  }

  // ---- Microphone ----------------------------------------------------------

  // open starts a level meter on the microphone; level() returns RMS in 0..1.
  // It fails (and releases the microphone) if audio cannot actually run, for
  // example a suspended AudioContext, rather than reporting silence forever.
  async function open() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let ctx = null;
    try {
      ctx = new AudioContext();
      if (ctx.state !== 'running') await ctx.resume();
      if (ctx.state !== 'running') throw new Error(`audio is ${ctx.state}`);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      return {
        level() {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const x of buf) sum += x * x;
          return Math.sqrt(sum / buf.length);
        },
        // running is false once the system takes the audio away (Safari
        // interrupts it when another app grabs the microphone).
        running() {
          return ctx.state === 'running';
        },
        close() {
          stream.getTracks().forEach((t) => t.stop());
          ctx.close();
        },
      };
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      ctx?.close();
      throw err;
    }
  }

  return { createDetector, detect, createLog, record, voicedBetween, lastOnset, open, HANGOVER };
})();

if (typeof module !== 'undefined') module.exports = Vad;
