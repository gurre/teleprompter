const test = require('node:test');
const assert = require('node:assert/strict');
const Pace = require('../pace.js');
const Scroller = require('../scroller.js');

// speak feeds one match per word at a steady rate, starting at t0.
function speak(rate, count, t0 = 100, s = Pace.create()) {
  for (let i = 0; i < count; i++) s = Pace.observe(s, i, t0 + i / rate);
  return s;
}

test('measures the speaking rate', () => {
  assert.ok(Math.abs(speak(3, 10).rate - 3) < 1e-9);
  assert.ok(Math.abs(speak(1.5, 10).rate - 1.5) < 1e-9);
});

test('rate does not swing with uneven result timing', () => {
  // Results arrive in irregular bursts around a true pace of 2.5 words/s.
  let s = Pace.create();
  const jitter = [0.3, 0.3, -0.2, 0.25, -0.3, 0.1, 0.3, -0.25, 0.2, -0.1, 0.3, -0.3];
  for (let i = 0; i < jitter.length; i++) s = Pace.observe(s, i, 100 + i / 2.5 + jitter[i] * 0.4);
  assert.ok(Math.abs(s.rate - 2.5) < 0.08, `rate ${s.rate}`); // endpoints alone would say 2.64
});

test('lookahead grows with speaking rate and recognizer delay', () => {
  const slow = Pace.lookahead(speak(1.5, 10));
  const fast = Pace.lookahead(speak(3.5, 10));
  assert.ok(fast > slow);
  assert.ok(Math.abs(fast - 3.5 * (Pace.LATENCY + Pace.EASE)) < 1e-9);
  const laggy = { ...speak(3.5, 10), latency: 1.2 };
  assert.ok(Pace.lookahead(laggy) > fast);
});

test('lookahead accounts for the scroller easing it runs behind', () => {
  assert.equal(Pace.EASE, Scroller.TAU);
});

test('bursts of interim results do not inflate the rate', () => {
  let s = speak(2.5, 6);
  const t = s.at + 0.4;
  for (let i = 6; i < 9; i++) s = Pace.observe(s, i, t + (i - 6) * 0.01);
  assert.ok(s.rate < 4, `rate ${s.rate}`);
});

test('a pause or a skip does not distort the measured rate', () => {
  const s = speak(2.5, 10);
  const afterPause = Pace.observe(s, 10, s.at + 2);
  assert.equal(afterPause.rate, s.rate);
  const afterSkip = Pace.observe(s, 40, s.at + 0.4);
  assert.equal(afterSkip.rate, s.rate);
});

test('recognizer delay is measured from when speech resumes', () => {
  const truth = 0.9;
  const rate = 2.5;
  let s = speak(rate, 10);
  for (let k = 0; k < 9; k++) {
    // pause, then the speaker resumes at onset; 3 words later the match arrives
    const onset = s.at + 2;
    const index = s.index + 3;
    s = Pace.observe(s, index, onset + 3 / rate + truth, onset);
    for (let i = 1; i <= 6; i++) s = Pace.observe(s, index + i, s.at + 1 / rate);
  }
  assert.ok(Math.abs(s.latency - truth) < 0.1, `latency ${s.latency}`);
});

test('nothing is predicted before the first match', () => {
  assert.equal(Pace.predict(Pace.create(), 5), null);
});

test('at the moment of a match the speaker is lookahead words into the next word', () => {
  const s = speak(2.5, 10);
  assert.ok(Math.abs(Pace.predict(s, s.at) - (s.index + 1 + Pace.lookahead(s))) < 1e-9);
});

test('prediction is ahead of the match and moves forward over time', () => {
  const s = speak(2.5, 10);
  let prev = -Infinity;
  for (let dt = 0; dt < 3; dt += 0.05) {
    const f = Pace.predict(s, s.at + dt);
    assert.ok(f > s.index && f >= prev);
    prev = f;
  }
});

test('without new matches the prediction stops: it waits for the speaker', () => {
  const s = speak(2.5, 10);
  const later = Pace.predict(s, s.at + 5);
  assert.equal(Pace.predict(s, s.at + 60), later);
  assert.ok(later - s.index <= 1 + s.rate * (s.latency + Pace.COAST + Pace.EASE) + 1e-9);
});

test('when the speaker is silent the projection stays at the next word', () => {
  const s = speak(2.5, 10);
  // No speech since the matched word: the next word to say is index + 1.
  const f = Pace.predict(s, s.at + 3, 0);
  assert.ok(Math.abs(f - (s.index + 1 + s.rate * Pace.EASE)) < 1e-9);
  // Half a second of speech moves it on by rate × 0.5 words.
  assert.ok(Math.abs(Pace.predict(s, s.at + 3, 0.5) - f - s.rate * 0.5) < 1e-9);
});

test('a steady speaker glides at constant speed through a line', () => {
  const lines = [{ start: 0, top: 0 }, { start: 10, top: 96 }, { start: 20, top: 192 }, { start: 30, top: 288 }, { start: 30, top: 384 }];
  const step = Pace.offset(lines, 3) - Pace.offset(lines, 2);
  for (let f = 0; f < 20; f++) { // away from the end, where the glide stops
    assert.ok(Math.abs(Pace.offset(lines, f + 1) - Pace.offset(lines, f) - step) < 1e-9, `f=${f}`);
  }
  assert.equal(Pace.offset(lines, 5), 0); // mid-line sits on the reading line
  assert.equal(Pace.offset(lines, 15), 96);
  assert.equal(Pace.offset(lines, 40), 384); // past the end stays at the bottom
});

test('offset never decreases as the speaker advances, across paragraph gaps and uneven lines', () => {
  const lines = [{ start: 0, top: 0 }, { start: 3, top: 96 }, { start: 11, top: 240 }, { start: 12, top: 336 }, { start: 12, top: 432 }];
  let prev = -Infinity;
  for (let f = 0; f <= 13; f += 0.05) {
    const y = Pace.offset(lines, f);
    assert.ok(y >= prev - 1e-9, `f=${f}`);
    prev = y;
  }
});

test('pauses between sentences do not dilute the rate when speech time is known', () => {
  // 2.5 words/s with a 1 s pause after every 6 words; the pause is in wall
  // time but not in speech time.
  let s = Pace.create();
  let wall = 100;
  let speech = 0;
  for (let i = 0; i < 30; i++) {
    s = Pace.observe(s, i, wall, null, speech);
    wall += 0.4 + (i % 6 === 5 ? 1 : 0);
    speech += 0.4;
  }
  assert.ok(Math.abs(s.rate - 2.5) < 1e-6, `rate ${s.rate}`);
});

test('a speech clock that stalls while words keep coming is not believed', () => {
  // The level meter stops hearing the speaker: speech time barely moves.
  let s = Pace.create();
  for (let i = 0; i < 20; i++) s = Pace.observe(s, i, 100 + i * 0.4, null, 3 + i * 0.01);
  assert.ok(Math.abs(s.rate - 2.5) < 1e-6, `rate ${s.rate}`);
});

test('rate follows the speaker when they slow down', () => {
  let s = Pace.create();
  let t = 100;
  for (let i = 0; i < 30; i++) {
    s = Pace.observe(s, i, t);
    t += i < 15 ? 1 / 3 : 1 / 1.5;
  }
  assert.ok(Math.abs(s.rate - 1.5) < 0.05, `rate ${s.rate}`);
});

test('switching from wall time to speech time starts a fresh measurement', () => {
  // The level meter becomes available mid-talk: the clock jumps backwards.
  let s = Pace.create();
  for (let i = 0; i < 10; i++) s = Pace.observe(s, i, 100 + i * 0.4);
  for (let i = 10; i < 16; i++) s = Pace.observe(s, i, 100 + i * 0.4, null, (i - 10) * 0.4);
  assert.ok(Math.abs(s.rate - 2.5) < 1e-6, `rate ${s.rate}`);
});

test('ahead of schedule, the target pace slows the projection and lookahead', () => {
  const s = speak(3, 10); // speaker at 180 wpm
  const cap = 2; // the target needs only 120 wpm
  assert.ok(Math.abs(Pace.lookahead(s, cap) - 2 * (s.latency + Pace.EASE)) < 1e-9);
  assert.ok(Pace.lookahead(s, cap) < Pace.lookahead(s));
  const free = Pace.predict(s, s.at + 0.3);
  const heldBack = Pace.predict(s, s.at + 0.3, undefined, cap);
  assert.ok(heldBack < free && heldBack > s.index + 1);
});

test('behind schedule, the target never speeds the projection up', () => {
  const s = speak(2, 10);
  assert.equal(Pace.predict(s, s.at + 0.3, undefined, 4), Pace.predict(s, s.at + 0.3));
});

test('an absurdly slow target does not stop the text', () => {
  const s = speak(2.5, 10);
  assert.ok(Pace.lookahead(s, 0.01) > 0.5);
});

test('a short line before a paragraph gap does not make the glide surge', () => {
  // 8-word lines, then a 2-word last line, then a 32 px (.5em) paragraph gap:
  // without smoothing this peaks at 2.1× normal speed.
  const lines = [{ start: 0, top: 0 }, { start: 8, top: 96 }, { start: 16, top: 192 }, { start: 18, top: 320 }, { start: 26, top: 416 }, { start: 34, top: 512 }, { start: 42, top: 608 }, { start: 42, top: 704 }];
  const speeds = [];
  for (let f = 4; f < 28; f += 0.25) speeds.push(Pace.offset(lines, f + 0.25) - Pace.offset(lines, f));
  const normal = 96 / 8 / 4; // px per quarter word on a full line
  assert.ok(Math.max(...speeds) < 1.85 * normal, `peak ${Math.max(...speeds) / normal}× normal`);
});

test('indexAt finds the word position for a scroll offset', () => {
  const lines = [{ start: 0, top: 0 }, { start: 3, top: 96 }, { start: 11, top: 240 }, { start: 12, top: 336 }, { start: 20, top: 432 }, { start: 20, top: 528 }];
  for (let f = 0; f < 16; f += 0.5) {
    const y = Pace.offset(lines, f);
    assert.ok(Math.abs(Pace.offset(lines, Pace.indexAt(lines, y)) - y) < 1e-6, `f=${f}`);
  }
});

test('a level meter that hears too little of the speech is not trusted', () => {
  let s = Pace.create();
  for (let i = 0; i < 20; i++) s = Pace.observe(s, i, 100 + i * 0.4, null, 3 + i * 0.2); // half the time voiced
  assert.equal(s.trusted, false);
  let ok = Pace.create();
  for (let i = 0; i < 20; i++) ok = Pace.observe(ok, i, 100 + i * 0.4, null, 3 + i * 0.32); // 80% voiced
  assert.equal(ok.trusted, true);
});

test('the highlight is never before the word after the last one recognized', () => {
  const s = speak(2.5, 10); // last recognized: word 9
  for (const spoken of [5, 9.2, 10, 10.4]) assert.equal(Pace.highlightWord(s, spoken, 100), 10, `spoken ${spoken}`);
  assert.equal(Pace.highlightWord(Pace.create(), 3, 100), null, 'nothing before the first match');
});

test('the highlight moves on halfway through a word', () => {
  const s = speak(2.5, 10);
  const lead = s.rate * Pace.EASE;
  assert.equal(Pace.highlightWord(s, 12.4 + lead, 100), 12);
  assert.equal(Pace.highlightWord(s, 12.6 + lead, 100), 13);
});

test('at the end of the script the highlight stays on the last word', () => {
  const s = speak(2.5, 10);
  assert.equal(Pace.highlightWord(s, 10.9, 10), 9);
  assert.equal(Pace.highlightWord(s, 30, 20), 19);
});

test('when the presenter is silent the highlight rests on the next word', () => {
  const s = speak(2.5, 10);
  const lead = s.rate * Pace.EASE;
  assert.equal(Pace.highlightWord(s, 11.7 + lead, 100, Infinity, true), 12);
  assert.equal(Pace.highlightWord(s, 11.7 + lead, 100, Infinity, false), 11);
});

test('the highlight steps one word at a time, never skipping a word', () => {
  const rate = 2.5; // words/s: a step holds at least 0.2 s
  assert.equal(Pace.stepHighlight(10, 12, 0.25, rate), 11, 'two ahead: one step');
  assert.equal(Pace.stepHighlight(10, 12, 0.1, rate), 10, 'too soon: hold');
  assert.equal(Pace.stepHighlight(10, 10, 1, rate), 10);
  assert.equal(Pace.stepHighlight(10, 9, 1, rate), 10, 'never back');
  // Simulate a burst: the target leaps 3 words; the highlight follows in
  // single steps, one per dwell.
  let shown = 10;
  let since = 0;
  const seen = [shown];
  for (let t = 0; t < 1; t += 1 / 60) {
    since += 1 / 60;
    const next = Pace.stepHighlight(shown, 13, since, rate);
    if (next !== shown) since = 0;
    assert.ok(next - shown <= 1);
    shown = next;
    seen.push(shown);
  }
  assert.equal(shown, 13);
});

test('a real jump moves the highlight straight there', () => {
  assert.equal(Pace.stepHighlight(10, 30, 0, 2.5), 30);
  assert.equal(Pace.stepHighlight(-1, 4, 0, 2.5), 4, 'the first highlight appears at once');
});
