const test = require('node:test');
const assert = require('node:assert/strict');
const Follower = require('../follower.js');

const words = (s) => s.split(' ');
const SCRIPT = words('good evening everyone thank you for coming tonight we will talk about the future of energy and why it matters to all of us');

test('a spoken phrase moves the cursor to its last word', () => {
  assert.equal(Follower.match(SCRIPT, -1, words('good evening everyone')), 2);
  assert.equal(Follower.match(SCRIPT, 2, words('everyone thank you for')), 5);
});

test('reacts after two words when they are the next ones', () => {
  assert.equal(Follower.match(SCRIPT, 5, words('coming tonight')), 7);
});

test('a single word is never enough', () => {
  assert.equal(Follower.match(SCRIPT, 5, words('coming')), null);
});

test('one misheard word still matches', () => {
  assert.equal(Follower.match(SCRIPT, 7, words('we will walk about the')), 12);
});

test('a misheard final word keeps the speaker at the previous word', () => {
  assert.equal(Follower.match(SCRIPT, 7, words('we will talk about bee')), 11);
});

test('a word dropped by the speaker is tolerated', () => {
  // "you for coming tonight" said as "you for tonight"
  assert.equal(Follower.match(SCRIPT, 3, words('you for tonight')), 7);
});

test('never moves backward, even for a perfect match behind the cursor', () => {
  // Speaker is still at "thank you for coming" but the cursor got ahead.
  assert.equal(Follower.match(SCRIPT, 12, words('thank you for coming')), null);
  for (let cursor = 0; cursor < SCRIPT.length; cursor++) {
    for (let end = 2; end < SCRIPT.length; end++) {
      const next = Follower.match(SCRIPT, cursor, SCRIPT.slice(Math.max(0, end - 5), end + 1));
      if (next !== null) assert.ok(next > cursor, `cursor ${cursor} → ${next}`);
    }
  }
});

test('words already used by a match are not evidence again', () => {
  const tail = words('future of the city and the');
  const script = words('the future of the city and the region and later the city and the people');
  const first = Follower.match(script, -1, tail);
  assert.equal(first, 6);
  // The recognizer repeats the same tail (final after interim): nothing new.
  assert.equal(Follower.match(script, first, tail, 0), null);
  // One new word that is not in the script: still nothing to anchor on.
  assert.equal(Follower.match(script, first, [...tail, 'um'], 1), null);
  // A real next word moves on by one.
  assert.equal(Follower.match(script, first, [...tail, 'region'], 1), 7);
});

test('the further the move, the more words must agree', () => {
  const script = words(
    'tonight I will tell you a story ' +
      'filler filler filler filler filler filler filler filler filler filler filler filler filler filler filler filler ' +
      'the people of the city deserve better and the people of the region too',
  );
  // An ad-lib built from common words must not hop far ahead.
  assert.equal(Follower.match(script, 0, words('and honestly the people of this')), null);
  // Reading the far passage itself is followed.
  assert.equal(Follower.match(script, 0, words('the people of the city deserve')), 28);
});

test('skipping ahead within the window is followed', () => {
  assert.equal(Follower.match(SCRIPT, 2, words('the future of energy')), 15);
});

test('a phrase beyond the window is ignored', () => {
  const far = [...SCRIPT, ...new Array(100).fill('filler'), ...words('the grand finale tonight')];
  assert.equal(Follower.match(far, 0, words('the grand finale tonight')), null);
});

test('a repeated phrase matches its nearest occurrence ahead', () => {
  const script = words('so we start here and then so we start here again');
  assert.equal(Follower.match(script, -1, words('so we start here')), 3);
  assert.equal(Follower.match(script, 3, words('so we start here')), 9);
});

test('unrelated speech does not move the cursor', () => {
  assert.equal(Follower.match(SCRIPT, 5, words('purple monkey dishwasher banana')), null);
});

test('a mid-distance move needs four agreeing words', () => {
  assert.equal(Follower.match(SCRIPT, 2, words('the future of')), null);
  assert.equal(Follower.match(SCRIPT, 2, words('about the future of')), 14);
});

test('a far move waits for the next word to continue it', () => {
  const script = words(
    'tonight I will tell you a story ' +
      'filler filler filler filler filler filler filler filler filler filler filler filler filler filler filler filler ' +
      'and of course the data and the model decide what we can build next',
  );
  const start = { cursor: 0, pending: null };
  // Reading the far passage: a candidate first, committed by the next word.
  const candidate = Follower.step(start, script, words('of course the data and'), 5);
  assert.equal(candidate.cursor, 0);
  assert.equal(candidate.pending, 28);
  const confirmed = Follower.step(candidate, script, words('of course the data and the'), 1);
  assert.deepEqual(confirmed, { cursor: 29, pending: null });
  // An ad-lib echoing it, followed by something else: never committed.
  const adlib = Follower.step(start, script, words('of course the data and'), 5);
  const after = Follower.step(adlib, script, words('of course the data and honestly'), 1);
  assert.deepEqual(after, { cursor: 0, pending: null });
});

test('near moves commit at once', () => {
  assert.deepEqual(Follower.step({ cursor: 5, pending: null }, SCRIPT, words('coming tonight'), 2), { cursor: 7, pending: null });
});

test('only a new word can confirm a far move', () => {
  const script = words(
    'tonight I will tell you a story ' +
      'filler filler filler filler filler filler filler filler filler filler filler filler filler filler filler filler ' +
      'and then it was very very good',
  );
  const tail = words('and then it was very');
  const candidate = Follower.step({ cursor: 0, pending: null }, script, tail, 5);
  assert.equal(candidate.pending, 27);
  // The same words delivered again (a final repeating the interim).
  assert.deepEqual(Follower.step(candidate, script, tail, 0), candidate);
  // (Here a fresh "very" would be the speaker continuing: that commits.)
  assert.equal(Follower.step(candidate, script, tail, 1).cursor, 28);
});

test('a re-counted last word does not confirm a far move', () => {
  const script = words(
    'tonight I will tell you a story ' +
      'filler filler filler filler filler filler filler filler filler filler filler filler filler filler filler filler ' +
      'and of course the data and the model decide what we can build next',
  );
  const tail = words('of course the data and');
  const candidate = Follower.step({ cursor: 0, pending: null }, script, tail, 5);
  assert.equal(Follower.step(candidate, script, tail, 1).cursor, 0);
});

test('said tells which words of a stretch were spoken', () => {
  // cursor was at "coming" (6); the speaker went on to "talk" (10).
  assert.deepEqual(Follower.said(SCRIPT, 7, 10, words('coming tonight we will talk')), [7, 8, 9, 10]);
  // "will" forgotten: not said.
  assert.deepEqual(Follower.said(SCRIPT, 7, 10, words('coming tonight we talk')), [7, 8, 10]);
  // a wrong word in its place: not said either.
  assert.deepEqual(Follower.said(SCRIPT, 7, 10, words('coming tonight we shall talk')), [7, 8, 10]);
  // an extra ad-lib word does not cost the others.
  assert.deepEqual(Follower.said(SCRIPT, 7, 10, words('coming tonight um we will talk')), [7, 8, 9, 10]);
  // context before the stretch is not reported.
  assert.ok(Follower.said(SCRIPT, 7, 10, words('for coming tonight')).every((i) => i >= 7));
});
