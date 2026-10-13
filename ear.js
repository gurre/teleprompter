// Ear reads the script into the presenter's earphones a few words ahead of
// them, like a broadcast ear prompter: they hear a phrase and say it.
//
// The presenter sets the tempo. Each utterance is said a little faster than
// their measured pace, faster still when they have caught up with the
// voice, and the voice never reads more than lead words past where they
// are: when they pause, it waits for them. When they talk from memory and
// pass it, it drops what it was saying and goes on from them.
//
// A voice that leaks into the microphone would be recognized, move the
// follower, and so give itself room to read on: it would read the talk to
// itself. Words recognized too soon after the voice said them are suspect;
// the voice then holds still, and if the follower stops with it, it was
// hearing itself.
const Ear = (() => {
  const WPS = 2.9; // words/s a voice says at rate 1, until measured
  const MIN_WPS = 1; // a measurement outside these is not the voice's pace
  const MAX_WPS = 6;
  const MIN_RATE = 0.6; // slower or faster than this is hard to follow
  const MAX_RATE = 1.6;
  const BRISK = 1.3; // × the presenter's pace the voice reads at
  const CATCH_UP = 1.6; // × their pace when they have caught up with it
  const CHUNK = 3; // fewest words worth an utterance, unless a clause ends sooner
  const CHUNK_MAX = 8; // most words in one utterance
  const LEARN = 0.3; // weight of a new measurement of the voice's pace
  const WARM = 2; // first utterances (Bluetooth waking up) are not measured
  const TIMES = 16; // words whose time is kept for the echo guard
  const REPEAT = 0.3; // s, least time to hear a word and start saying it
  const SUSPECT = 3; // of the last RECENT matches, this many early start a probe
  const RECENT = 4;
  const SETTLE = 1; // s after the voice stops during which a match may still be its echo
  const PROBE = 2.5; // s the voice holds still to tell echo from presenter
  const STRIKES = 2; // probes in a row the follower stood still: echo
  const RETRIGGER = 8; // s; a suspicion this long after a probe starts strikes over
  const CLAUSE = /[,;:.!?…]["'”’»)\]]*$/;
  const VOICE = /^Samantha\b/; // the only voice it reads in

  // create starts with the voice having said nothing past word said.
  function create(said = -1) {
    return { said, saying: null, wps: WPS, utterances: 0, times: [], early: [], probe: null, strikes: 0, probedAt: -Infinity };
  }

  // next returns the words to say now, { from, to, rate }, or null to wait.
  // presenter is the word they are on; pace their speaking rate (words/s);
  // lead how many words ahead of them the voice may be. It starts at the
  // presenter if they have overtaken the voice, so they never hear what they
  // have said. An utterance runs to a clause end, or is at least CHUNK
  // words: waiting for room for a few words keeps the voice from saying one
  // word at a time.
  function next(s, { presenter, pace, lead, words }) {
    if (s.saying || s.probe) return null;
    const from = Math.max(s.said + 1, presenter);
    const room = presenter + lead - from;
    if (from >= words.length || room <= 0) return null;
    const last = Math.min(words.length - 1, from + Math.min(room, CHUNK_MAX) - 1);
    let to = from;
    while (to < last && !ends(words, to)) to++;
    if (to - from + 1 < Math.min(CHUNK, lead) && !ends(words, to)) return null;
    return { from, to, rate: rate(s, from - presenter, pace, lead) };
  }

  // rate reads a little faster than the presenter speaks (BRISK): the
  // voice gains on them, and the lead, not its tempo, sets how far ahead it
  // is. It then pauses between phrases instead of falling behind, and the
  // pauses also hide the moment each utterance takes to start. Steadily it
  // starts an utterance lead − CHUNK words ahead of them; closer than that
  // they are catching up, and it speeds up to CATCH_UP as they reach it.
  function rate(s, ahead, pace, lead) {
    if (Number.isNaN(pace)) throw new Error('talk in ear: the presenter’s pace is not a number');
    const steady = Math.max(1, lead - Math.min(CHUNK, lead));
    const speedUp = ahead < steady ? CATCH_UP - (CATCH_UP - BRISK) * (ahead / steady) : BRISK;
    return clamp((pace * speedUp) / s.wps, MIN_RATE, MAX_RATE);
  }

  // ends is true when word i ends a clause: punctuation, or a new sentence
  // or paragraph after it. The end of the script ends one too.
  function ends(words, i) {
    return i === words.length - 1 || CLAUSE.test(words[i].text) || words[i + 1].sentenceStart;
  }

  // started records the utterance the speaker was given at time at (s).
  // Until it ends, each word is reckoned said at an even share of the time
  // it should take: its echo is heard while it still plays.
  function started(s, { from, to, rate }, at) {
    const times = s.times.filter((t) => t.word < from || t.word > to);
    for (let w = from; w <= to; w++) times.push({ word: w, at: at + (w - from + 1) / (s.wps * rate) });
    return { ...s, saying: { from, to, rate, at }, times: times.slice(-TIMES) };
  }

  // began records when the utterance playing was heard to start (s): its
  // words are reckoned said from then, not from when it was given. Echo is
  // timed from the sound.
  function began(s, start) {
    if (!s.saying) return s;
    const { from, to, at } = s.saying;
    const times = s.times.map((t) => (t.word >= from && t.word <= to ? { ...t, at: t.at + start - at } : t));
    return { ...s, saying: { ...s.saying, at: start }, times };
  }

  // overtake drops the utterance playing once the presenter has passed the
  // word the voice is on: they are talking from memory, faster than it
  // reads, and what it is saying is behind them. The voice goes on from
  // where they are. Words it had not reached were never said, so their
  // times are forgotten: the presenter saying them is not its echo. Returns
  // s unchanged while the voice is ahead.
  function overtake(s, presenter, now) {
    if (!s.saying) return s;
    const { from, to, rate, at } = s.saying;
    const voice = Math.min(to, from + Math.floor((now - at) * s.wps * rate));
    if (presenter <= voice) return s;
    return { ...s, saying: null, times: s.times.filter((t) => t.word <= voice || t.word > to) };
  }

  // ended records that the utterance played from start to end (s). The
  // voice has now said its words, each at an even share of the time, and
  // its pace at rate 1 is measured again.
  function ended(s, start, end) {
    const { from, to, rate } = s.saying;
    const n = to - from + 1;
    const span = end - start;
    const times = s.times.filter((t) => t.word < from || t.word > to);
    for (let k = 0; k < n; k++) times.push({ word: from + k, at: start + ((k + 1) / n) * span });
    const utterances = s.utterances + 1;
    const measured = span > 0 ? n / span / rate : NaN;
    const ok = utterances > WARM && measured >= MIN_WPS && measured <= MAX_WPS;
    return { ...s, said: Math.max(s.said, to), saying: null, utterances, wps: ok ? s.wps + LEARN * (measured - s.wps) : s.wps, times: times.slice(-TIMES) };
  }

  // halt forgets an utterance that was stopped before it ended: its words
  // are said again when the voice goes on.
  function halt(s) {
    return { ...s, saying: null };
  }

  // jump moves the voice to word presenter after a manual jump. What it
  // knew about the old place no longer applies; its pace still does.
  function jump(s, presenter) {
    return { ...create(presenter - 1), wps: s.wps, utterances: s.utterances };
  }

  // heard records that the follower moved to word at time at (s), and
  // returns the state, with a probe started when it looks like echo. A word
  // recognized within latency + REPEAT of the voice saying it was not
  // repeated by the presenter: there was no time to. One recognized before
  // the voice said it is the presenter reading ahead: echo cannot come
  // first. A presenter who knows the script can say words with the voice,
  // so suspicion alone decides nothing; it starts a probe. Moving during a
  // probe, after SETTLE, is the presenter talking while the voice is still.
  function heard(s, word, at, latency) {
    if (s.probe) {
      return at - s.probe.at >= SETTLE ? { ...s, probe: null, strikes: 0, early: [] } : s;
    }
    const said = s.times.find((t) => t.word === word);
    const early = [...s.early, Boolean(said) && at >= said.at && at - said.at < latency + REPEAT].slice(-RECENT);
    if (early.filter(Boolean).length < SUSPECT) return { ...s, early };
    const strikes = at - s.probedAt > RETRIGGER ? 0 : s.strikes;
    return { ...s, early: [], saying: null, probe: { at }, strikes };
  }

  // check ends a probe that has run PROBE seconds without the presenter
  // moving, and returns { state, echo }. After STRIKES such probes in a row
  // the voice is hearing itself.
  function check(s, now) {
    if (!s.probe || now - s.probe.at < PROBE) return { state: s, echo: false };
    const strikes = s.strikes + 1;
    return { state: { ...s, probe: null, strikes, probedAt: now }, echo: strikes >= STRIKES };
  }

  // text is words [from, to] as written, punctuation included, so the voice
  // keeps the script's intonation.
  function text(words, from, to) {
    return words
      .slice(from, to + 1)
      .map((w, k) => (k && !w.joined ? ' ' : '') + w.text)
      .join('');
  }

  // choose picks the Samantha voice to read in: a premium or enhanced one
  // before the basic one, one on this machine before one over the network
  // (less delay before each utterance). Returns null without Samantha.
  function choose(voices) {
    const score = (v) => (/premium|enhanced/i.test(`${v.name} ${v.voiceURI}`) ? 2 : 0) + (v.localService ? 1 : 0);
    let best = null;
    for (const v of voices) if (VOICE.test(v.name) && (!best || score(v) > score(best))) best = v;
    return best;
  }

  // ---- Speaker: says utterances aloud ---------------------------------------

  const SURE_START = 4; // s after which an utterance that has not started never will
  const SURE_RETRY = 1.2; // s, the same once an utterance has played: it is given again
  const AFTER_CANCEL = 0.04; // s between a cancel and the next utterance
  const SURE_END = (words, rate) => 2 + (2 * words) / rate; // s after its start it has surely ended

  // speaker says utterances in the Samantha voice. onChange is called when
  // state() changes: the voices load (late in Chrome). Chrome empties its
  // voice list while it speaks and fills it again, so the voice is kept once
  // found. Chrome sometimes never reports the end of an utterance, so one
  // also ends on a timer; otherwise the voice would wait for it for the rest
  // of the talk.
  function speaker(onChange) {
    const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    let voice = null;
    let loaded = false; // the browser has listed its voices
    let current = null; // the utterance playing; kept, or Chrome may drop its events
    let proven = false; // an utterance has started playing
    let cancelledAt = -Infinity; // s, when speech was last cancelled
    let timer = 0;
    const now = () => performance.now() / 1000;

    function find() {
      const voices = synth.getVoices();
      loaded = loaded || voices.length > 0;
      voice = choose(voices) ?? voice;
    }

    // stop silences the utterance playing, if any. It cancels even when the
    // queue looks idle: Safari can report an utterance just given to it as
    // neither speaking nor pending.
    function stop() {
      clearTimeout(timer);
      current = null;
      cancelledAt = now();
      synth?.cancel();
    }

    // Voices already listed (Safari) are found now, without onChange: the
    // caller is still creating the speaker.
    if (synth) {
      synth.addEventListener('voiceschanged', () => {
        find();
        onChange();
      });
      find();
    }

    // look finds Samantha if she is not found yet: Safari can list its
    // voices late without saying so.
    function look() {
      if (synth && !voice) find();
    }

    return {
      available() {
        look();
        return Boolean(voice);
      },
      // state is { kind, detail }: kind is 'loading' (voices not listed
      // yet), 'missing' (no Samantha, or no speech at all) or 'ready'
      // (detail names the voice).
      state() {
        if (!synth) return { kind: 'missing', detail: 'this browser cannot speak' };
        look();
        if (voice) return { kind: 'ready', detail: voice.name };
        return loaded ? { kind: 'missing', detail: 'the Samantha voice is not installed' } : { kind: 'loading', detail: '' };
      },
      // say says line at rate, stopping any utterance still playing, and
      // calls began(start) when it is heard to start, ended(start, end) when
      // it has played, halted() when something else interrupted it (an
      // audio device change, another page's speech), or failed(why) when it
      // did not play. One stopped with stop() calls none. Browsers can lose
      // an utterance given in the same moment as a cancel, so after one it
      // is given a moment later; one that does not start is given once more
      // before it fails. Callers check available().
      say(line, rate, { began, ended, halted, failed }) {
        if (!voice) throw new Error('talk in ear: no voice to read with');
        const recent = current !== null || synth.speaking || synth.pending || now() - cancelledAt < AFTER_CANCEL;
        stop();
        const attempt = (tries, wait) => {
          // Chrome can be left paused after the audio device changes.
          if (synth.paused) synth.resume();
          const u = new SpeechSynthesisUtterance(line);
          u.voice = voice;
          u.lang = voice.lang;
          u.rate = rate;
          current = u;
          let start = now();
          const done = (report) => {
            if (current !== u) return;
            clearTimeout(timer);
            current = null;
            report();
          };
          u.onstart = () => {
            if (current !== u) return;
            proven = true;
            start = now();
            began(start);
            clearTimeout(timer);
            timer = setTimeout(() => done(() => ended(start, now())), SURE_END(line.split(/\s+/).length, rate) * 1000);
          };
          u.onend = () => done(() => ended(start, now()));
          u.onerror = (e) => {
            if (e.error === 'interrupted' || e.error === 'canceled') return done(halted);
            done(() => failed(`the browser would not speak (${e.error})`));
          };
          // Until a first utterance has played, starting can take seconds
          // (earphones waking up, a premium voice loading); after, a short
          // wait tells a lost one.
          const sure = tries === 1 && proven ? SURE_RETRY : SURE_START;
          timer = setTimeout(() => {
            if (current !== u) return;
            if (tries > 1) return done(() => failed('nothing played: the browser did not start speaking'));
            stop();
            attempt(tries + 1, true);
          }, sure * 1000);
          if (!wait) return synth.speak(u);
          setTimeout(() => current === u && synth.speak(u), AFTER_CANCEL * 1000);
        };
        attempt(1, recent);
      },
      stop,
      // unlock says a silent word, inside a click or key press, so the
      // browser lets later utterances play without one. Whitespace alone
      // may never reach the speech engine.
      unlock() {
        if (!synth) return;
        const u = new SpeechSynthesisUtterance('.');
        u.volume = 0;
        synth.speak(u);
      },
      speaking: () => current !== null,
    };
  }

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  return { create, next, started, began, overtake, ended, halt, jump, heard, check, text, choose, speaker };
})();

if (typeof module !== 'undefined') module.exports = Ear;
