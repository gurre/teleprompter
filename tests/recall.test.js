const test = require('node:test');
const assert = require('node:assert/strict');
const Recall = require('../recall.js');
const Script = require('../script.js');

const TEXT = [
  'Good evening everyone and thank you for coming tonight. We are here to talk about the future of energy and why it matters to every one of us.',
  'Ten years ago solar panels were expensive curiosities. Today they are the cheapest source of electricity ever built! Who would have guessed?',
  'But cheap power is only half the story. Storage, transmission and markets decide whether that power reaches your kitchen.',
].join('\n\n');
const { words } = Script.parse(TEXT);

// seeded returns a repeatable random number generator.
function seeded(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

const PERCENTS = Array.from({ length: 18 }, (_, k) => 10 + 5 * k); // the slider: 10..95

test('the first word of every paragraph is always shown', () => {
  for (const p of PERCENTS) {
    for (let seed = 1; seed <= 5; seed++) {
      const hidden = Recall.hide(words, p, seeded(seed));
      words.forEach((w, i) => w.paraStart && assert.equal(hidden[i], false, `${p}% word ${i}`));
    }
  }
});

test('sentence starts are shown below 80% and hidden from 80% up', () => {
  const sentenceStarts = words.map((w, i) => (w.sentenceStart && !w.paraStart ? i : -1)).filter((i) => i >= 0);
  assert.equal(sentenceStarts.length, 4);
  for (const p of PERCENTS.filter((p) => p < 80)) {
    const hidden = Recall.hide(words, p, seeded(p));
    for (const i of sentenceStarts) assert.equal(hidden[i], false, `${p}% hid sentence start ${i}`);
  }
  for (let seed = 1; seed <= 5; seed++) {
    const at80 = Recall.hide(words, 80, seeded(seed));
    assert.ok(sentenceStarts.some((i) => at80[i]), 'some sentence starts hidden at 80%');
  }
  const at90 = Recall.hide(words, 90, seeded(3));
  assert.ok(sentenceStarts.some((i) => at90[i]), 'some sentence starts hidden at 90%');
  const at95 = Recall.hide(words, 95, seeded(3));
  assert.ok(sentenceStarts.filter((i) => at95[i]).length > sentenceStarts.filter((i) => at90[i]).length / 2);
});

test('about the chosen share of words is hidden', () => {
  const paraStarts = words.filter((w) => w.paraStart).length;
  const sentenceStarts = words.filter((w) => w.sentenceStart && !w.paraStart).length;
  for (const p of PERCENTS) {
    const count = Recall.hide(words, p, seeded(p)).filter(Boolean).length;
    const want = Math.round((p / 100) * words.length);
    const room = words.length - paraStarts - (p < 80 ? sentenceStarts : 0); // what the rules allow
    assert.equal(count, Math.min(want, room), `${p}%`);
  }
});

test('which words are hidden changes from run to run', () => {
  const a = Recall.hide(words, 40, seeded(1)).join();
  const b = Recall.hide(words, 40, seeded(2)).join();
  assert.notEqual(a, b);
  assert.equal(Recall.hide(words, 40, seeded(1)).join(), a, 'same randomness, same words');
});

test('with short sentences, sentence starts make up the share once allowed', () => {
  const short = Script.parse('Go now. We run. You hide. They seek. I wait. She sings. He sleeps. It ends.\n\nAll done. Back home. Lights off.').words;
  for (const p of [80, 85, 90, 95]) {
    const count = Recall.hide(short, p, seeded(p)).filter(Boolean).length;
    const room = short.length - short.filter((w) => w.paraStart).length;
    assert.equal(count, Math.min(Math.round((p / 100) * short.length), room), `${p}%`);
  }
});
