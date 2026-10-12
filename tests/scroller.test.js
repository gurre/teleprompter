const test = require('node:test');
const assert = require('node:assert/strict');
const Scroller = require('../scroller.js');

test('easing approaches a jump target without overshooting', () => {
  let s = { position: 0, target: 300, max: 10000 };
  let prev = 0;
  for (let i = 0; i < 180; i++) {
    s = Scroller.step(s, 1 / 60);
    assert.ok(s.position >= prev && s.position <= 300);
    prev = s.position;
  }
  assert.equal(s.position, 300);
});

test('easing time does not depend on frame rate', () => {
  const run = (fps) => {
    let s = { position: 0, target: 500, max: 10000 };
    for (let i = 0; i < fps / 2; i++) s = Scroller.step(s, 1 / fps);
    return s.position;
  };
  assert.ok(Math.abs(run(30) - run(120)) < 1e-6);
});

test('a stalled frame cannot leap', () => {
  const s = Scroller.step({ position: 0, target: 1000, max: 10000 }, 30);
  assert.ok(s.position < 1000 * (1 - Math.exp(-0.1 / Scroller.TAU)) + 1e-9);
});

test('target stays within the script', () => {
  assert.equal(Scroller.step({ position: 0, target: 900, max: 50 }, 0.016).target, 50);
  assert.equal(Scroller.step({ position: 0, target: -40, max: 50 }, 0.016).target, 0);
});
