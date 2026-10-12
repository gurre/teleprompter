const test = require('node:test');
const assert = require('node:assert/strict');
const Timing = require('../timing.js');

test('auto-scroll time left follows its pace exactly', () => {
  assert.equal(Timing.remainingMs({ wordsLeft: 25, rate: 2.5 }), 10000);
  assert.equal(Timing.remainingMs({ wordsLeft: 25, rate: 0 }), Infinity);
});

test('nothing left takes no time', () => {
  assert.equal(Timing.remainingMs({ wordsLeft: 0, rate: 2.5 }), 0);
  assert.equal(Timing.remainingMs({ wordsLeft: 0, wordsDone: 50, elapsedMs: 60000 }), 0);
});

test('voice time left uses the default pace until enough is measured', () => {
  const fewWords = Timing.remainingMs({ wordsDone: 5, wordsLeft: 140, elapsedMs: 60000 });
  const fewSeconds = Timing.remainingMs({ wordsDone: 40, wordsLeft: 140, elapsedMs: 5000 });
  assert.equal(fewWords, 60000);
  assert.equal(fewSeconds, 60000);
});

test('voice time left uses the measured pace once there is enough', () => {
  // 100 words in one minute → 100 wpm → 50 words take 30 s.
  const left = Timing.remainingMs({ wordsDone: 100, wordsLeft: 50, elapsedMs: 60000 });
  assert.equal(left, 30000);
});

test('durations format as m:ss and h:mm:ss', () => {
  assert.equal(Timing.format(0), '0:00');
  assert.equal(Timing.format(65000), '1:05');
  assert.equal(Timing.format(3600000 + 61000), '1:01:01');
  assert.equal(Timing.format(-5000), '0:00');
  assert.equal(Timing.format(Infinity), '–:––');
});

test('target lengths read as m:ss, h:mm:ss or minutes', () => {
  assert.equal(Timing.parseTarget('10:00'), 600000);
  assert.equal(Timing.parseTarget('12'), 720000);
  assert.equal(Timing.parseTarget(' 1:02:03 '), 3723000);
  assert.equal(Timing.parseTarget(''), 0);
  assert.ok(Number.isNaN(Timing.parseTarget('1:75')));
  assert.ok(Number.isNaN(Timing.parseTarget('ten')));
});

test('target pace spreads what is left over the time remaining', () => {
  // 300 words, 4 of 6 minutes used → 300 words in 120 s.
  assert.equal(Timing.targetRate({ targetMs: 360000, elapsedMs: 240000, left: 300 }), 2.5);
});

test('no target, or a target already passed, holds nothing back', () => {
  assert.equal(Timing.targetRate({ targetMs: 0, elapsedMs: 0, left: 300 }), Infinity);
  assert.equal(Timing.targetRate({ targetMs: 60000, elapsedMs: 61000, left: 300 }), Infinity);
  assert.equal(Timing.targetRate({ targetMs: 60000, elapsedMs: 1000, left: 0 }), Infinity, 'at the end');
});

test('slack says how early or late the talk will end', () => {
  assert.equal(Timing.slackMs(600000, 300000, 240000), 60000);
  assert.equal(Timing.slackMs(600000, 300000, 330000), -30000);
});

// A noisy estimate wandering up and down while it trends to zero.
function noisy(n, seed = 7) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return Array.from({ length: n }, (_, i) => 300000 - i * 1000 + (rnd() - 0.5) * 8000);
}

test('time left never counts up: it pauses, then follows the estimate down', () => {
  let shown = null;
  const values = noisy(300);
  for (const v of values) {
    const next = Timing.countDown(shown, v);
    if (shown !== null) assert.ok(next <= shown);
    assert.ok(next <= v); // never shows more than the estimate
    shown = next;
  }
  assert.equal(shown, Math.min(...values));
});

test('elapsed never counts down', () => {
  let shown = null;
  for (const v of [0, 1000, 900, 2000, 1999, 3000]) {
    const next = Timing.countUp(shown, v);
    if (shown !== null) assert.ok(next >= shown);
    shown = next;
  }
  assert.equal(shown, 3000);
});

test('the schedule moves in whole steps and does not flicker on noise', () => {
  let shown = null;
  const seen = [];
  for (const v of [12400, 12600, 11900, 13100, 12200, 12800]) {
    shown = Timing.steady(shown, v, 5000);
    seen.push(shown);
  }
  assert.deepEqual([...new Set(seen)], [10000]);
  assert.equal(Timing.steady(10000, 15100, 5000), 15000);
  assert.equal(Timing.steady(10000, 5000, 5000), 5000);
});

test('durations read the way people say them', () => {
  assert.equal(Timing.spoken(45000), '45s');
  assert.equal(Timing.spoken(61000), '1m 1s');
  assert.equal(Timing.spoken(3723000), '1h 2m 3s');
});

test('a finished talk is summed up against its target', () => {
  assert.equal(Timing.endText(600000, 661000), 'Ended 1m 1s over');
  assert.equal(Timing.endText(600000, 580000), 'Ended 20s early');
  assert.equal(Timing.endText(600000, 603000), 'Ended on time');
  assert.equal(Timing.endText(0, 252000), 'Ended after 4m 12s');
});
