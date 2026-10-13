const test = require('node:test');
const assert = require('node:assert/strict');
const VoicePrompter = require('../voice-prompter.js');
const Script = require('../script.js');

const { words } = Script.parse(
  'Good evening everyone. Thank you for coming to the talk tonight about the future of energy.\n\nWe will start now.',
);
const AFTER = 3;
const text = ([from, to]) => words.slice(from, to + 1).map((w) => w.norm).join(' ');

// run steps the ladder at 10 Hz from t0 to t1. input(t, said) returns the
// step's input apart from words, after and now; said is what was said so far,
// as [{ t, say }].
function run(input, t0, t1, state = VoicePrompter.create(), said = []) {
  for (let t = t0; t <= t1 + 1e-9; t = Math.round((t + 0.1) * 10) / 10) {
    const r = VoicePrompter.step(state, { words, after: AFTER, now: t, ...input(t, said) });
    state = r.state;
    if (r.say) said.push({ t, say: r.say });
  }
  return { state, said };
}

test('a silence shorter than the wait says nothing; at the wait the cue comes', () => {
  const quiet = () => ({ next: 5, quietSince: 0, spoke: false });
  assert.deepEqual(run(quiet, 0, 2.9).said, []);
  const { said } = run(quiet, 0, 3);
  assert.equal(said.length, 1);
  assert.equal(said[0].t, 3);
  assert.equal(text(said[0].say), 'for coming');
});

test('a stall gets the cue, then the phrase, then nothing however long it lasts', () => {
  // Each prompt plays for a second (next is null meanwhile); quiet then
  // counts from its end.
  const { said } = run((t, so) => {
    const playingUntil = so.length ? so[so.length - 1].t + 1 : 0;
    return { next: t < playingUntil ? null : 7, quietSince: playingUntil, spoke: false };
  }, 0, 120);
  assert.deepEqual(said.map((s) => text(s.say)), ['to the talk', 'to the talk tonight']);
});

test('a prompt that moves the follower cannot cause another prompt', () => {
  // Leaked prompts are recognized: next jumps past each prompted word, but
  // the presenter is never heard, so spoke stays false.
  let next = 7;
  const said = [];
  let state = VoicePrompter.create();
  for (let t = 0; t <= 120; t = Math.round((t + 0.1) * 10) / 10) {
    const r = VoicePrompter.step(state, { words, after: AFTER, now: t, next, quietSince: 0, spoke: false });
    state = r.state;
    if (r.say) {
      said.push(r.say);
      next = r.say[1] + 1;
    }
  }
  assert.equal(said.length, 2);
  assert.equal(said[1][0], 7, 'the phrase starts at the word that was cued');
});

test('being heard starts the ladder over at the new word', () => {
  const first = run(() => ({ next: 5, quietSince: 0, spoke: false }), 0, 30);
  assert.equal(first.said.length, 2);
  // The presenter speaks at 30–31 and stops; the follower moved to word 11.
  // Heard since the last prompt: until the next one is said.
  const { said } = run((t, so) => ({ next: 11, quietSince: so.length ? so[so.length - 1].t : 31, spoke: !so.length }), 30.1, 60, first.state);
  assert.deepEqual(said.map((s) => [s.t, text(s.say)]), [[34, 'about'], [37, 'about the future of']]);
});

test('a stall before a new paragraph waits three times as long', () => {
  const { said } = run(() => ({ next: 16, quietSince: 0, spoke: false }), 0, 3 * AFTER);
  assert.deepEqual(said.map((s) => [s.t, text(s.say)]), [[3 * AFTER, 'we will']]);
});

test('after a cue asked for (R), quiet brings the phrase, and speaking starts over', () => {
  // R said the cue at word 6 at t = 0; the ladder is on level 1 there.
  const asked = { ...VoicePrompter.create(), word: 6, level: 1, armed: true, armedAt: 0 };
  const quiet = run(() => ({ next: 6, quietSince: 0, spoke: false }), 0, 10, asked);
  assert.deepEqual(quiet.said.map((s) => [s.t, text(s.say)]), [[AFTER, 'coming to the talk']]);
  const heard = run(() => ({ next: 8, quietSince: 0, spoke: true }), 0, 0, asked);
  assert.equal(heard.state.level, 0, 'heard: the ladder starts over at the new word');
});

test('arming never prompts at once, however long the silence before', () => {
  // Quiet for a minute before prompting became possible (paused, not started).
  assert.deepEqual(run(() => ({ next: 5, quietSince: -60, spoke: false }), 0, 2.9).said, []);
  // Possible, then not (Space), then possible again: quiet counts from then.
  const { said } = run((t) => ({ next: t >= 1 && t < 10 ? null : 5, quietSince: -60, spoke: false }), 0, 12.9);
  assert.deepEqual(said, []);
});

test('the wait is longer before a sentence or a paragraph, or one word short of it', () => {
  assert.equal(VoicePrompter.wait(words, 5, AFTER), AFTER, 'mid-sentence');
  assert.equal(VoicePrompter.wait(words, 3, AFTER), 2 * AFTER, 'sentence start');
  assert.equal(VoicePrompter.wait(words, 2, AFTER), 2 * AFTER, 'last word of a sentence, maybe said but not heard');
  assert.equal(VoicePrompter.wait(words, 16, AFTER), 3 * AFTER, 'paragraph start');
  assert.equal(VoicePrompter.wait(words, 15, AFTER), 3 * AFTER, 'last word of a paragraph');
  assert.equal(VoicePrompter.wait(words, words.length - 1, AFTER), AFTER, 'last word');
});

test('a cue runs to the first content word, at most three words', () => {
  assert.equal(text(VoicePrompter.cue(words, 7)), 'to the talk');
  assert.equal(text(VoicePrompter.cue(words, 3)), 'thank');
  assert.equal(text(VoicePrompter.cue(words, 18)), 'start');
  assert.equal(text(VoicePrompter.cue(words, 19)), 'now', 'stops at the end of the script');
  for (let i = 0; i < words.length; i++) {
    const [from, to] = VoicePrompter.cue(words, i);
    assert.equal(from, i);
    assert.ok(to - from < 3, `cue at ${i} is ${to - from + 1} words`);
    assert.ok(to - from === 2 || to === words.length - 1 || words[to].norm.length >= 4, `cue at ${i} ends on "${words[to].norm}"`);
  }
});

test('a prompt is said as written, punctuation and hyphens included', () => {
  const { words: w } = Script.parse('It is state-of-the-art. Really.');
  assert.equal(VoicePrompter.text(w, [1, 6]), 'is state-of-the-art. Really.');
  assert.equal(VoicePrompter.text(words, [13, 15]), 'future of energy.');
  assert.equal(VoicePrompter.text(words, [0, 0]), 'Good', 'one word');
  assert.equal(VoicePrompter.text(words, [words.length - 1, words.length - 1]), 'now.', 'the last word');
});

test('a phrase is at most four words and stays in its sentence unless too short', () => {
  assert.equal(text(VoicePrompter.phrase(words, 6)), 'coming to the talk');
  assert.equal(text(VoicePrompter.phrase(words, 13)), 'future of energy');
  assert.equal(text(VoicePrompter.phrase(words, 14)), 'of energy we will', 'two words left run on');
  assert.equal(text(VoicePrompter.phrase(words, 18)), 'start now', 'stops at the end of the script');
  for (let i = 0; i < words.length; i++) {
    const [from, to] = VoicePrompter.phrase(words, i);
    assert.equal(from, i);
    assert.ok(to - from < 4, `phrase at ${i} is ${to - from + 1} words`);
    const crossing = words.slice(from + 1, to + 1).findIndex((w) => w.sentenceStart);
    if (crossing !== -1) assert.ok(crossing < 2, `phrase at ${i} crosses a sentence after ${crossing + 1} words`);
  }
});
