// Recall picks words to hide for memorization practice. The first word of a
// paragraph is always shown, so you know where you are. The first word of a
// sentence is a strong cue too: it is never hidden below SENTENCE_FROM
// percent, and phased in from there (a third of its share at 80%, two thirds
// at 85%) up to its full share at SENTENCE_FULL.
const Recall = (() => {
  const SENTENCE_FROM = 80;
  const SENTENCE_FULL = 90;

  // hide returns, per word, whether to hide it, so that about percent of all
  // words are hidden (fewer when the rules leave too few to hide). words come
  // from Script.parse; random returns numbers in [0, 1).
  function hide(words, percent, random = Math.random) {
    const share = percent / 100;
    const step = (SENTENCE_FULL - SENTENCE_FROM) / 2; // the slider's 5% steps
    const ramp = percent < SENTENCE_FROM ? 0 : Math.min((percent - SENTENCE_FROM + step) / (SENTENCE_FULL - SENTENCE_FROM + step), 1);
    const inner = [];
    const starts = [];
    words.forEach((w, i) => {
      if (!w.paraStart) (w.sentenceStart ? starts : inner).push(i);
    });
    shuffle(inner, random);
    shuffle(starts, random);
    const total = Math.round(share * words.length);
    let fromStarts = Math.round(ramp * share * starts.length);
    const fromInner = Math.max(0, Math.min(inner.length, total - fromStarts));
    // Sentence starts make up what inner words cannot, once they are allowed.
    if (ramp > 0) fromStarts = Math.min(starts.length, Math.max(fromStarts, total - fromInner));
    const hidden = new Array(words.length).fill(false);
    for (const i of inner.slice(0, fromInner)) hidden[i] = true;
    for (const i of starts.slice(0, fromStarts)) hidden[i] = true;
    return hidden;
  }

  function shuffle(xs, random) {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
  }

  return { hide, SENTENCE_FROM, SENTENCE_FULL };
})();

if (typeof module !== 'undefined') module.exports = Recall;
