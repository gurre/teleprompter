// VoicePrompter prompts a presenter who has gone quiet, like a theatre
// prompter: a short cue first, then the phrase, then nothing until they
// speak again.
//
// The ladder only starts over when the presenter is heard, never because the
// follower moved. A prompt that leaks into the microphone can move the
// follower, but it cannot cause the next prompt, so the prompter can never
// read the script to itself.
const VoicePrompter = (() => {
  const SENTENCE = 2; // × the wait before a sentence start: a pause there is often deliberate
  const PARAGRAPH = 3; // × the wait before a paragraph start
  const CUE_WORDS = 3; // most words in a cue
  const CONTENT = 4; // characters that make a word worth cueing on ("future", not "the")
  const PHRASE_WORDS = 4; // most words in a phrase
  const PHRASE_LEAST = 3; // a phrase shorter than this runs on into the next sentence

  function create() {
    return { word: null, level: 0, armed: false, armedAt: 0 };
  }

  // wait is how many seconds of quiet before word i count as a stall; after
  // is the presenter's setting. It looks at word i + 1 too: the last word
  // before a pause is often not recognized, so a pause at the end of a
  // sentence would otherwise get the shorter wait meant for mid-sentence.
  function wait(words, i, after) {
    return after * Math.max(factor(words[i]), factor(words[i + 1]));
  }

  function factor(w) {
    if (!w) return 1;
    return w.paraStart ? PARAGRAPH : w.sentenceStart ? SENTENCE : 1;
  }

  // cue returns [i, j]: from word i up to the first content word, at most
  // CUE_WORDS words. A lone "the" says nothing; "the future" does.
  function cue(words, i) {
    let j = i;
    while (j < i + CUE_WORDS - 1 && j < words.length - 1 && words[j].norm.length < CONTENT) j++;
    return [i, j];
  }

  // phrase returns [i, j]: up to PHRASE_WORDS words, ending before the next
  // sentence, unless that would leave fewer than PHRASE_LEAST words.
  function phrase(words, i) {
    const last = Math.min(i + PHRASE_WORDS - 1, words.length - 1);
    for (let k = i + 1; k <= last; k++) {
      if (words[k].sentenceStart) return [i, k - i >= PHRASE_LEAST ? k - 1 : last];
    }
    return [i, last];
  }

  // step advances the ladder and returns { state, say }, where say is the
  // [from, to] words to say now or null.
  //
  // next is the word to prompt, or null while prompting is not possible
  // (not started, paused, lost, a prompt playing). When it becomes possible
  // again the ladder is armed: quiet counts from then, so resuming never
  // prompts at once. quietSince is when the presenter was last heard (or a
  // prompt ended); spoke is true when they were heard since the last prompt.
  function step(s, { next, now, quietSince, spoke, words, after }) {
    if (next === null) return { state: { ...s, armed: false }, say: null };
    let st = s.armed ? s : { ...s, armed: true, armedAt: now };
    if (spoke) st = { ...st, word: next, level: 0 };
    const quiet = now - Math.max(quietSince, st.armedAt);
    if (st.level === 0 && quiet >= wait(words, next, after)) {
      return { state: { ...st, word: next, level: 1 }, say: cue(words, next) };
    }
    if (st.level === 1 && quiet >= wait(words, st.word, after)) {
      return { state: { ...st, level: 2 }, say: phrase(words, st.word) };
    }
    return { state: st, say: null };
  }

  // text is words [from, to] as written, punctuation included, so the voice
  // keeps the script's intonation.
  function text(words, [from, to]) {
    return words
      .slice(from, to + 1)
      .map((w, k) => (k && !w.joined ? ' ' : '') + w.text)
      .join('');
  }

  // ---- Speaker: says prompts aloud ------------------------------------------

  const VOICE = /^Samantha\b/; // the only voice prompts are said in
  const SURE_START = 4; // s after which a prompt that has not started never will
  const SURE_END = (words) => 2 + words / 2; // s after its start that a prompt has surely ended

  // speaker says prompts in the Samantha voice. onChange is called when its
  // state() changes after it is created: the voices load (late in Chrome),
  // or a prompt fails or plays again. Chrome empties its voice list while it
  // speaks and fills it again, so the voice is kept once found.
  //
  // window() is when the current or last prompt played, in seconds on the
  // performance clock, end Infinity while it plays: sound then is the prompt,
  // not the presenter. Chrome sometimes never reports the end of an
  // utterance, so a prompt also ends on a timer; otherwise prompting would
  // wait for it for the rest of the talk.
  function speaker(onChange) {
    const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    let voice = null;
    let loaded = false; // the browser has listed its voices
    let failure = ''; // why the last prompt did not play
    let current = null; // the prompt playing; kept, or Chrome may drop its events
    let timer = 0;
    let span = { start: -Infinity, end: -Infinity };
    const now = () => performance.now() / 1000;

    function find() {
      const voices = synth.getVoices();
      loaded = loaded || voices.length > 0;
      const found = voices.filter((v) => VOICE.test(v.name));
      voice = found.find((v) => /Premium|Enhanced/.test(v.name)) ?? found[0] ?? voice;
    }

    function finish(u) {
      if (current !== u) return;
      clearTimeout(timer);
      current = null;
      span = { start: span.start, end: now() };
    }

    function fail(u, why) {
      if (current !== u) return; // replaced by a later prompt: not a failure
      console.error(`voice prompter: ${why}`);
      failure = why;
      finish(u);
      onChange();
    }

    // stop silences the prompt playing, if any. It lets go of it first, so
    // the error the browser reports for it does not count as a failure.
    function stop() {
      if (current) finish(current);
      if (synth.speaking || synth.pending) synth.cancel();
    }

    // Voices already loaded are found now, without onChange: the caller is
    // still constructing the speaker.
    if (synth) {
      synth.addEventListener('voiceschanged', () => {
        find();
        onChange();
      });
      find();
    }

    return {
      available: () => Boolean(voice),
      // state is { kind, detail }: kind is 'loading' (voices not listed
      // yet), 'missing' (no Samantha, or no speech at all), 'failed' (the
      // last prompt did not play; detail says why) or 'ready'.
      state() {
        if (!synth) return { kind: 'missing', detail: 'this browser cannot speak' };
        if (!voice) return loaded ? { kind: 'missing', detail: 'the Samantha voice is not installed' } : { kind: 'loading', detail: '' };
        if (failure) return { kind: 'failed', detail: failure };
        return { kind: 'ready', detail: voice.name };
      },
      // say interrupts any prompt still playing. Callers check available().
      // A prompt that errors or never starts is reported through state().
      say(line) {
        if (!voice) throw new Error('voice prompter: no Samantha voice to say a prompt with');
        stop();
        // Chrome can be left paused after the audio device changes
        // (earphones switching to call mode for the microphone).
        if (synth.paused) synth.resume();
        const u = new SpeechSynthesisUtterance(line);
        u.voice = voice;
        u.lang = voice.lang;
        current = u;
        span = { start: now(), end: Infinity };
        u.onstart = () => {
          if (current !== u) return;
          clearTimeout(timer);
          timer = setTimeout(() => finish(u), SURE_END(line.split(/\s+/).length) * 1000);
          if (failure) {
            failure = '';
            onChange();
          }
        };
        u.onend = () => finish(u);
        u.onerror = (e) => fail(u, `the browser would not speak (${e.error})`);
        timer = setTimeout(() => fail(u, 'nothing played: the browser did not start speaking'), SURE_START * 1000);
        synth.speak(u);
      },
      stop,
      // unlock says nothing, inside a click or key press, so the browser
      // lets later prompts play without one. Callers check available().
      unlock() {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        synth.speak(u);
      },
      speaking: () => span.end === Infinity,
      window: () => span,
    };
  }

  return { create, wait, cue, phrase, step, text, speaker };
})();

if (typeof module !== 'undefined') module.exports = VoicePrompter;
