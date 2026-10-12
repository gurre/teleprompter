// Pace turns a word position into a steady, predictable glide, and turns
// sparse, late speech matches into that word position.
//
// A match arrives some time after the word was spoken (recognizer latency) and
// the scroller trails its target (easing). Pace measures the speaker's rate
// and the recognizer's latency, and projects ahead by rate × (latency + easing)
// words, so the word being said right now sits on the reading line.
//
// The projection only advances for time the speaker was audibly talking
// (when a voice activity log is available and believable), so it stops when
// they pause. It never runs more than COAST seconds of speech past the last
// match: when it gets ahead it waits for the speaker.
const Pace = (() => {
  const LATENCY = 0.6; // s, initial guess at word-to-match delay
  const MIN_LATENCY = 0.15;
  const MAX_LATENCY = 1.5;
  const LATENCY_SAMPLES = 9; // median of this many onset measurements
  const EASE = 0.25; // s the scroller trails its target (Scroller TAU)
  const COAST = 0.6; // s of speech it may project past latency without a match
  const INITIAL_RATE = 140 / 60; // words/s before anything is measured
  const MIN_RATE = 0.8;
  const MAX_RATE = 5;
  const WINDOW = 5; // s of matches the rate is measured over
  const MIN_SPAN = 1; // s of matches needed before trusting a measurement
  const PAUSE = 1.5; // s without a match that ends a run of speech
  const MAX_SKIP = 8; // words; a longer jump is a skip, not speaking pace
  const MIN_SPEECH_SHARE = 0.65; // a run of speech is at least this voiced
  const SMOOTH = 5; // words either side the glide speed is averaged over
  const JUMP = 3; // words; a longer highlight move is a jump, not speech
  const LEAD = 2; // words past the last recognized the highlight is, while talking
  const LOOK_FORWARD = 1; // words further the projection may take it
  const DWELL = 0.5; // of a word's duration, the least a highlight step lasts

  function create(rate = INITIAL_RATE, latency = LATENCY) {
    return { index: null, at: 0, rate, latency, history: [], samples: [], trusted: true };
  }

  // observe records that word index was matched at time at (seconds). Rate is
  // the least-squares slope of the matches within a run of speech, so pauses,
  // skips and bursts of results do not distort it.
  //
  // speech is a clock that only runs while the presenter is audibly talking
  // (seconds); with it, pauses between sentences do not dilute the rate.
  // Without a voice activity log it is wall time. A run of speech is mostly
  // voiced, so if the speech clock says otherwise the level meter is
  // misjudging the room: trusted turns false and wall time is used instead.
  //
  // onset, when given, is when the speaker resumed after a pause and this is
  // the first match since. The words from onset to this match took
  // (index − previous index) / rate to say; what remains is latency.
  function observe(s, index, at, onset = null, speech = at) {
    const step = s.index === null ? Infinity : index - s.index;
    const broken = at - s.at > PAUSE || step > MAX_SKIP;
    const history = broken ? [] : s.history.filter((h) => at - h.at <= WINDOW);
    history.push({ index, at, speech });
    const wallSpan = at - history[0].at;
    const trusted = wallSpan < MIN_SPAN ? s.trusted : speech - history[0].speech >= MIN_SPEECH_SHARE * wallSpan;
    const rate = wallSpan >= MIN_SPAN ? clamp(slope(history, trusted ? 'speech' : 'at'), MIN_RATE, MAX_RATE) : s.rate;

    let { latency, samples } = s;
    if (onset !== null && step >= 1 && step <= MAX_SKIP) {
      const sample = at - onset - step / rate;
      if (sample > 0 && sample < 2 * MAX_LATENCY) {
        samples = [...samples, sample].slice(-LATENCY_SAMPLES);
        latency = clamp(median(samples), MIN_LATENCY, MAX_LATENCY);
      }
    }
    return { index, at, rate, latency, history, samples, trusted };
  }

  // lookahead is how many words the speaker is ahead of the last match by the
  // time the screen shows it, while they keep talking. cap (words/s) is the
  // pace that ends the talk on its target time: the projection never runs
  // faster, so a presenter who is ahead of schedule sees the text hold back.
  function lookahead(s, cap = Infinity) {
    return pace(s, cap) * (s.latency + EASE);
  }

  // pace is the speaking rate the projection uses: measured, held to cap.
  function pace(s, cap = Infinity) {
    return Math.min(s.rate, Math.max(cap, MIN_RATE));
  }

  // predict returns the fractional index of the word being said at time t
  // (seconds), or null before the first match. Word i spans [i, i + 1).
  // voiced is the seconds of speech since the matched word was said
  // (at − latency); without a believable voice activity log, assume
  // continuous speech. cap is as for lookahead.
  function predict(s, t, voiced = t - s.at + s.latency, cap = Infinity) {
    if (s.index === null) return null;
    return s.index + 1 + pace(s, cap) * (Math.min(Math.max(voiced, 0), s.latency + COAST) + EASE);
  }

  // highlightWord is the word to mark for the presenter, given the glide's
  // position spoken: the next word after the last one recognized, or further
  // when the projection says they are there already. The projection carries
  // the scroller's easing lead, which the highlight does not need. While
  // the presenter is talking it is rounded, so the mark moves on halfway
  // through a word, a small look forward; when they are silent it rests on
  // the next word to say. It stays tied to what was recognized: while the
  // presenter talks, recognition runs behind them, so the mark is at least
  // LEAD words past the last recognized word; when they are silent, at least
  // the next one. It is never more than LOOK_FORWARD beyond LEAD, so a
  // projection that runs ahead of the voice cannot pull it away. At the end
  // of the script it stays on the last word.
  function highlightWord(s, spoken, wordCount, cap = Infinity, talking = true) {
    if (s.index === null) return null;
    const said = spoken - pace(s, cap) * EASE;
    const word = talking ? Math.round(said) : Math.floor(said);
    const least = s.index + (talking ? LEAD : 1);
    return Math.min(wordCount - 1, s.index + LEAD + LOOK_FORWARD, Math.max(least, word));
  }

  // stepHighlight moves the shown highlight toward target one word at a
  // time, holding each word at least half a word's duration at the speaking
  // rate, so a burst of recognized words reads as quick steps rather than a
  // skip. A move of more than JUMP words (a clicker jump, a skipped sentence)
  // goes straight there. sinceStep is the seconds since the last step.
  function stepHighlight(shown, target, sinceStep, rate) {
    if (target === null || target <= shown) return shown;
    if (shown < 0 || target - shown > JUMP) return target;
    return sinceStep >= DWELL / rate ? shown + 1 : shown;
  }

  // offset maps a fractional word index to a scroll offset so the text glides
  // instead of stepping: each line sits on the reading line when its middle
  // word is being said. The speed is averaged over SMOOTH words either side,
  // so a short last line plus a paragraph gap does not make the text surge.
  // It never decreases as f grows. lines is ascending [{ start, top }] ending
  // with a sentinel { start: wordCount, top: bottom }.
  function offset(lines, f) {
    let sum = 0;
    for (let k = -SMOOTH; k <= SMOOTH; k++) sum += lineOffset(lines, f + k);
    return sum / (2 * SMOOTH + 1);
  }

  // indexAt is the inverse of offset: the smallest word position whose offset
  // reaches y. Used to continue gliding from wherever a manual jump landed.
  function indexAt(lines, y) {
    let lo = -SMOOTH;
    let hi = lines[lines.length - 1].start + SMOOTH;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (offset(lines, mid) < y) lo = mid;
      else hi = mid;
    }
    return hi;
  }

  // lineOffset interpolates linearly between the moments each line's middle
  // word is said.
  function lineOffset(lines, f) {
    const last = lines.length - 1;
    const mid = (i) => (i === last ? lines[i].start : (lines[i].start + lines[i + 1].start) / 2);
    if (f >= mid(last)) return lines[last].top;
    let lo = 0;
    let hi = last - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (mid(m) <= f) lo = m;
      else hi = m - 1;
    }
    const progress = (f - mid(lo)) / (mid(lo + 1) - mid(lo)); // < 0 before the first line's middle
    return lines[lo].top + progress * (lines[lo + 1].top - lines[lo].top);
  }

  // slope is the least-squares words per second against clock ('at' or 'speech').
  function slope(points, clock) {
    const n = points.length;
    const mt = points.reduce((a, p) => a + p[clock], 0) / n;
    const mi = points.reduce((a, p) => a + p.index, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of points) {
      num += (p[clock] - mt) * (p.index - mi);
      den += (p[clock] - mt) ** 2;
    }
    return num / den;
  }

  function median(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  return { create, observe, lookahead, pace, predict, highlightWord, stepHighlight, offset, indexAt, LATENCY, EASE, COAST, INITIAL_RATE };
})();

if (typeof module !== 'undefined') module.exports = Pace;
