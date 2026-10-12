// Voice wraps the browser's speech recognition and streams the most recent
// spoken words, interim results included so the prompter reacts mid-phrase.
// Recognition ends on its own after silence or about a minute; while active it
// restarts with a short backoff. Errors that retrying cannot fix stop it.
const Voice = (() => {
  const TAIL = 8; // words handed to the follower per result
  const USED_TAIL = 2; // consumed words remembered to recognize them again; finding a
  // later repeat of them only makes fewer words fresh, so short is safe
  const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

  // Errors that will not go away by retrying, with what to tell the presenter.
  const FATAL = {
    'not-allowed': 'microphone blocked — allow it in the browser',
    'service-not-allowed': 'speech service not allowed (Safari: turn on Dictation)',
    'language-not-supported': 'speech language not supported',
    'audio-capture': 'no microphone found',
  };

  function supported() {
    return Boolean(Recognition);
  }

  // create returns { start, stop, reset, consume, active }. onWords receives
  // the last normalized words and how many of them are fresh (heard since the
  // last consume()); onState receives ('listening' | 'stopped' | 'error',
  // message).
  function create({ lang, normalize, onWords, onState }) {
    if (!Recognition) throw new Error('speech recognition is not supported in this browser');
    let rec = null;
    let wanted = false;
    let failures = 0;
    let timer = 0;
    let latest = { index: -1, words: 0 }; // last result seen and its word count
    let skip = { index: -1, words: 0 }; // results up to here were heard before reset()
    let total = 0; // words heard this session
    let used = 0; // of which consumed
    let delivered = []; // the words last handed to onWords
    let usedTail = []; // the last words consumed, to find them again

    function begin() {
      const r = new Recognition();
      rec = r;
      latest = { index: -1, words: 0 };
      skip = { index: -1, words: 0 };
      total = used = 0;
      usedTail = [];
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onstart = () => onState('listening');
      r.onresult = (e) => {
        failures = 0;
        const words = heard(e.results);
        delivered = words;
        if (words.length) onWords(words, freshCount(words));
      };
      r.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        if (FATAL[e.error]) wanted = false;
        else failures++;
        onState('error', FATAL[e.error] ?? `speech recognition: ${e.error}`);
      };
      r.onend = () => {
        if (rec === r) rec = null;
        if (!wanted) return onState('stopped');
        timer = setTimeout(begin, Math.min(2000, 100 * 2 ** failures));
      };
      r.start();
    }

    // heard returns the last TAIL words of the session, leaving out what was
    // said before the last reset(), and counts the session's words. Interim
    // results are revised in place, so the count can shift by a word.
    function heard(results) {
      const words = [];
      total = 0;
      for (let i = results.length - 1; i >= 0; i--) {
        let said = split(results[i][0].transcript);
        total += said.length;
        if (i === results.length - 1) latest = { index: i, words: said.length };
        if (i < skip.index || words.length >= TAIL) continue;
        if (i === skip.index) said = said.slice(skip.words);
        words.unshift(...said);
      }
      return words.slice(-TAIL);
    }

    // freshCount says how many of words were heard since consume(). It finds
    // the consumed words in the tail, so a revision that splits or merges an
    // earlier word ("cannot" → "can not") does not make an old word look
    // new. When they are gone (revised, or much said since), it counts.
    function freshCount(words) {
      for (let end = words.length; usedTail.length && end >= usedTail.length; end--) {
        if (usedTail.every((w, k) => words[end - usedTail.length + k] === w)) return words.length - end;
      }
      return Math.max(0, total - used);
    }

    // split matches the script's word boundaries: hyphens and dashes
    // separate words, as they do in Script.parse.
    function split(transcript) {
      return transcript.split(/[\s\-‐‑‒–—]+/).map(normalize).filter(Boolean);
    }

    return {
      start() {
        if (wanted) return;
        wanted = true;
        failures = 0;
        if (!rec) begin();
      },
      stop() {
        wanted = false;
        clearTimeout(timer);
        if (rec) rec.abort();
        else onState('stopped');
      },
      // reset forgets what was heard so far, so words spoken before a manual
      // jump cannot pull the follower back to where it was. Recognition keeps
      // running, so the words after the jump are not lost.
      reset() {
        skip = { ...latest };
        used = total;
        usedTail = [];
      },
      // consume marks everything heard so far as used by a match, so the
      // same words can never count as evidence again.
      consume() {
        used = total;
        usedTail = delivered.slice(-USED_TAIL);
      },
      active() {
        return wanted;
      },
    };
  }

  return { supported, create };
})();

if (typeof module !== 'undefined') module.exports = Voice;
