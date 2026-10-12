// Follower locates the speaker in the script from the last few recognized
// words. It only ever moves forward: when it is ahead of the speaker, nothing
// behind the cursor can match, so it waits for the speaker to catch up. Only a
// manual clicker jump moves the cursor back.
//
// Because a forward move cannot be undone, evidence is strict: a match must
// end on a word heard since the last match (re-reading old words would count
// the same evidence twice), and the further the move, the more in-order words
// must agree. The search is bounded so a phrase repeated much later in the
// script cannot pull the prompter away.
const Follower = (() => {
  const SAID_CONTEXT = 3; // script words before a stretch used to align it
  const DEFAULTS = {
    tail: 6, // spoken words considered
    ahead: 60, // furthest forward move, in words
    // [max distance in words, in-order words that must agree]
    evidence: [[4, 2], [15, 4], [Infinity, 5]],
  };

  // match returns the index of the script word the speaker most likely just
  // said, strictly after cursor, or null when no candidate is convincing.
  // cursor is the last matched index (-1 before the first match). script and
  // spoken are normalized words; fresh is how many of the last spoken words
  // were heard since the last match.
  function match(script, cursor, spoken, fresh = Infinity, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const tail = spoken.slice(-o.tail);
    const firstAnchor = Math.max(0, tail.length - 2, tail.length - fresh);
    if (firstAnchor >= tail.length || tail.length < o.evidence[0][1]) return null;
    const hi = Math.min(script.length - 1, cursor + o.ahead);
    let best = null;
    for (let end = Math.max(0, cursor + 1); end <= hi; end++) {
      const s = score(script, end, tail, firstAnchor);
      if (s < needed(o.evidence, end - cursor)) continue;
      if (!best || s > best.s) best = { end, s }; // ties keep the nearest
    }
    return best ? best.end : null;
  }

  // step advances follow state { cursor, pending } on new speech and returns
  // the next state. A move within NEAR words commits at once. A longer move
  // is only a candidate (pending) until the next fresh word continues it, so
  // an ad-lib that happens to echo a later passage cannot pull the prompter
  // there; a genuine skip commits one word later.
  function step(state, script, spoken, fresh, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const last = spoken[spoken.length - 1];
    if (state.pending !== null && fresh > 0) {
      for (let k = 1; k <= 2; k++) {
        if (script[state.pending + k] === last) return { cursor: state.pending + k, pending: null };
      }
    }
    const next = match(script, state.cursor, spoken, fresh, o);
    if (next === null) return fresh > 0 ? { ...state, pending: null } : state;
    if (next - state.cursor <= o.evidence[0][0]) return { cursor: next, pending: null };
    return { cursor: state.cursor, pending: next };
  }

  // said returns which script words in [from, to] the speaker said, by
  // aligning what was heard with that stretch of script in order (a few
  // words before it too, so the context lines up). Recall practice uses it
  // to tell a recalled word from a missed one.
  function said(script, from, to, heard) {
    const lo = Math.max(0, from - SAID_CONTEXT);
    const seg = script.slice(lo, to + 1);
    const table = [new Array(seg.length + 1).fill(0)];
    for (let i = 1; i <= heard.length; i++) {
      table.push([0]);
      for (let j = 1; j <= seg.length; j++) {
        table[i][j] = heard[i - 1] === seg[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
    const found = [];
    for (let i = heard.length, j = seg.length; i > 0 && j > 0; ) {
      if (heard[i - 1] === seg[j - 1]) {
        if (lo + j - 1 >= from) found.push(lo + j - 1);
        i--;
        j--;
      } else if (table[i - 1][j] >= table[i][j - 1]) i--;
      else j--;
    }
    return found.reverse();
  }

  function needed(evidence, distance) {
    return evidence.find(([max]) => distance <= max)[1];
  }

  // score counts the words shared in order by the tail and the script ending
  // at end. script[end] must equal a tail word at or after firstAnchor (one of
  // the last two, and fresh), which tolerates a misheard final word while
  // keeping the match anchored on new speech.
  function score(script, end, tail, firstAnchor) {
    let best = 0;
    for (let j = tail.length - 1; j >= firstAnchor; j--) {
      if (tail[j] !== script[end]) continue;
      const from = Math.max(0, end - (j + 2)); // room for two skipped script words
      best = Math.max(best, 1 + lcs(tail.slice(0, j), script.slice(from, end)));
    }
    return best;
  }

  function lcs(a, b) {
    let prev = new Array(b.length + 1).fill(0);
    for (const x of a) {
      const row = [0];
      for (let k = 0; k < b.length; k++) row.push(x === b[k] ? prev[k] + 1 : Math.max(prev[k + 1], row[k]));
      prev = row;
    }
    return prev[b.length];
  }

  return { match, step, said, DEFAULTS };
})();

if (typeof module !== 'undefined') module.exports = Follower;
