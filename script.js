// Script turns pasted text into paragraphs of display words. Each word carries
// a normalized form so the voice follower can compare it with recognized speech.
const Script = (() => {
  // A word ending like this ends a sentence: . ! ? or … before any closing
  // quotes or brackets.
  const SENTENCE_END = /[.!?…]["'”’»)\]]*$/;

  // normalize lowercases, folds accents (NFKD splits off the marks, which the
  // filter then drops) and keeps only letters and digits, so "Don't," in the
  // script equals "don't" from the recognizer.
  function normalize(token) {
    return token
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }

  // pieces splits a token after hyphens and dashes, because the recognizer
  // says "state of the art", not "stateoftheart". Punctuation-only pieces
  // stay glued to their neighbour. Returns [] for punctuation-only tokens.
  function pieces(raw) {
    const out = [];
    let carry = '';
    for (const part of raw.split(/(?<=[-‐‑‒–—])/)) {
      if (normalize(part)) {
        out.push(carry + part);
        carry = '';
      } else if (out.length) out[out.length - 1] += part;
      else carry += part;
    }
    if (carry && out.length) out[out.length - 1] += carry;
    return out;
  }

  // parse splits on blank lines into paragraphs and keeps single newlines as
  // line breaks. Punctuation-only tokens ("—", "...") are glued to a
  // neighbouring word so every word stays matchable. Words split from one
  // token are marked joined (shown without a space before them).
  function parse(text) {
    const words = [];
    const paragraphs = [];
    for (const block of text.split(/\n\s*\n/)) {
      const start = words.length;
      let pending = '';
      let pendingBreak = false;
      block.split('\n').forEach((line, lineNo) => {
        let lineBreak = lineNo > 0;
        for (const raw of line.trim().split(/\s+/)) {
          if (!raw) continue;
          const parts = pieces(raw);
          if (!parts.length) {
            if (words.length > start && !lineBreak) words[words.length - 1].text += ' ' + raw;
            else {
              pending += raw + ' ';
              pendingBreak = pendingBreak || lineBreak;
            }
            continue;
          }
          parts.forEach((part, k) => {
            words.push({
              text: k === 0 ? pending + part : part,
              norm: normalize(part),
              para: paragraphs.length,
              lineBreak: k === 0 && words.length > start && (lineBreak || pendingBreak),
              joined: k > 0,
            });
          });
          pending = '';
          pendingBreak = false;
          lineBreak = false;
        }
      });
      if (pending && words.length > start) words[words.length - 1].text += ' ' + pending.trim();
      if (words.length > start) paragraphs.push({ start, end: words.length });
    }
    // Where paragraphs and sentences begin, once every word's text is final.
    words.forEach((w, i) => {
      w.paraStart = i === 0 || w.para !== words[i - 1].para;
      w.sentenceStart = w.paraStart || SENTENCE_END.test(words[i - 1].text);
    });
    return { words, paragraphs };
  }

  return { normalize, parse };
})();

if (typeof module !== 'undefined') module.exports = Script;
