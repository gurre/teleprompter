// Timing estimates how long the rest of the talk takes and formats durations
// for the on-stage HUD.
const Timing = (() => {
  const DEFAULT_WPM = 140; // typical presenting pace
  const MIN_SAMPLE_MS = 15000; // measured pace is trusted after this much talking
  const MIN_SAMPLE_WORDS = 20;

  // remainingMs estimates time left for wordsLeft words. Given a rate
  // (words/s, as auto-scroll knows exactly) it uses that; otherwise the
  // speaker's overall pace since the timer started (wordsDone in elapsedMs,
  // pauses included), once there is enough of it, else DEFAULT_WPM.
  function remainingMs({ wordsLeft, rate = null, wordsDone = 0, elapsedMs = 0 }) {
    if (rate !== null) return rate > 0 ? (wordsLeft / rate) * 1000 : Infinity;
    const measured = elapsedMs >= MIN_SAMPLE_MS && wordsDone >= MIN_SAMPLE_WORDS;
    const wpm = measured ? wordsDone / (elapsedMs / 60000) : DEFAULT_WPM;
    return (wordsLeft / wpm) * 60000;
  }

  // parseTarget reads a target length typed as m:ss, h:mm:ss or minutes.
  // Empty means no target (0); anything else unreadable is NaN.
  function parseTarget(text) {
    const s = text.trim();
    if (!s) return 0;
    if (!/^\d+(:[0-5]\d){0,2}$/.test(s)) return NaN;
    const parts = s.split(':').map(Number);
    if (parts.length === 1) return parts[0] * 60000;
    return parts.reduce((acc, x) => acc * 60 + x, 0) * 1000;
  }

  // targetRate is the pace (units per second) that uses up what is left
  // exactly at the target, or Infinity without a target, once it has passed,
  // or with nothing left (there is nothing to pace).
  function targetRate({ targetMs, elapsedMs, left }) {
    const remaining = targetMs - elapsedMs;
    if (!targetMs || remaining <= 0 || left <= 0) return Infinity;
    return left / (remaining / 1000);
  }

  // slackMs is how early (positive) or late (negative) the talk is set to end.
  function slackMs(targetMs, elapsedMs, leftMs) {
    return targetMs - elapsedMs - leftMs;
  }

  // Readouts. Estimates are noisy; a timer on stage must not flicker back
  // and forth. Pass null as prev to start a readout over after something
  // that really changes it (slowing down, jumping back, restarting).

  // countDown never rises: it pauses while the estimate goes up and skips
  // down with it.
  function countDown(prev, value) {
    return prev === null ? value : Math.min(prev, value);
  }

  // countUp never falls.
  function countUp(prev, value) {
    return prev === null ? value : Math.max(prev, value);
  }

  // steady moves in whole steps, and only once value is a full step away from
  // what is shown, so noise around a boundary cannot make it flicker.
  function steady(prev, value, step) {
    return prev === null || Math.abs(value - prev) >= step ? Math.round(value / step) * step : prev;
  }

  // format renders ms as m:ss, or h:mm:ss from one hour.
  function format(ms) {
    if (!Number.isFinite(ms)) return '–:––';
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  return { remainingMs, format, parseTarget, targetRate, slackMs, countDown, countUp, steady, DEFAULT_WPM };
})();

if (typeof module !== 'undefined') module.exports = Timing;
