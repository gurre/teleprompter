const test = require('node:test');
const assert = require('node:assert/strict');
const Vad = require('../vad.js');

const FPS = 60;

// feed runs levels(t) through the detector for seconds, logging the result.
function feed(levels, seconds, start = 0, d = Vad.createDetector(), log = Vad.createLog()) {
  const dt = 1 / FPS;
  for (let t = start + dt; t <= start + seconds + 1e-9; t += dt) {
    const r = Vad.detect(d, levels(t), t, dt);
    d = r.state;
    Vad.record(log, t - dt, t, r.voiced);
  }
  return { d, log };
}

test('steady room noise is not speech, however loud', () => {
  for (const noise of [0.002, 0.02, 0.2]) {
    const { log } = feed(() => noise, 8);
    assert.ok(Vad.voicedBetween(log, 4, 8) < 0.05, `noise ${noise}`);
  }
});

test('speech well above the room is detected, with a short hangover', () => {
  const speaking = (t) => (t > 3 && t < 5 ? 0.2 : 0.01);
  const { log } = feed(speaking, 7);
  const voiced = Vad.voicedBetween(log, 1, 7); // after the floor has settled
  assert.ok(voiced > 2 && voiced <= 2 + Vad.HANGOVER + 0.05, `voiced ${voiced}`);
  assert.ok(Vad.voicedBetween(log, 5.5, 7) === 0, 'silent after the hangover');
});

test('the gaps between syllables keep speech voiced', () => {
  // 4 Hz syllables: loud 150 ms, quiet 100 ms.
  const syllables = (t) => (t > 2 && (t * 4) % 1 < 0.6 ? 0.2 : 0.01);
  const { log } = feed(syllables, 10);
  assert.ok(Vad.voicedBetween(log, 3, 10) > 6.9);
});

test('lastOnset finds when speech resumed after a pause', () => {
  const speaking = (t) => ((t > 1 && t < 2) || t > 3.5 ? 0.2 : 0.01);
  const { log } = feed(speaking, 5);
  const onset = Vad.lastOnset(log, 0.5);
  assert.ok(Math.abs(onset - 3.5) < 2 / FPS, `onset ${onset}`);
  assert.equal(Vad.lastOnset(log, 5), null);
});

test('the log keeps only recent history', () => {
  const { log } = feed((t) => (Math.floor(t) % 2 ? 0.2 : 0.01), 60);
  assert.ok(log[0].t1 >= 60 - 10 - 1);
});

test('loud is the level right now; voiced bridges the gaps', () => {
  let d = Vad.createDetector();
  for (let t = 0; t < 2; t += 1 / 60) d = Vad.detect(d, 0.01, t, 1 / 60).state; // settle on the room
  const speaking = Vad.detect(d, 0.2, 2, 1 / 60);
  const justAfter = Vad.detect(speaking.state, 0.01, 2.1, 1 / 60);
  assert.equal(speaking.loud, true);
  assert.equal(justAfter.loud, false);
  assert.equal(justAfter.voiced, true, 'within the hangover');
});
