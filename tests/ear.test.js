const test = require('node:test');
const assert = require('node:assert/strict');
const Ear = require('../ear.js');
const Script = require('../script.js');

const { words } = Script.parse(
  'Good evening everyone. Thank you for coming to the talk tonight about the future of energy and what it means for all of us here.\n\nWe will start now, with the numbers.',
);
const PACE = 2.5; // words/s
const GAP = 0.2; // s before an utterance given to the browser starts

// talk simulates a presenter at a steady pace who waits for the voice when
// they reach it, at 20 Hz for seconds. Each utterance starts GAP s after it
// is given (the browser getting ready) and plays for its words at the
// voice's pace. Returns what was said, the most the voice was ever ahead of
// the presenter when it started an utterance, and when the presenter said
// the last word.
function talk({ lead = 4, pace = PACE, seconds = 60, voiceWps = 2.9, silentFrom = Infinity } = {}) {
  let s = Ear.create();
  let presenter = 0;
  let sayAt = 0; // when the presenter can say their next word
  let playingUntil = -1;
  let start = 0;
  const said = [];
  let mostAhead = 0;
  let doneAt = Infinity;
  for (let t = 0; t <= seconds; t = Math.round((t + 0.05) * 100) / 100) {
    if (s.saying && t >= playingUntil) s = Ear.ended(s, start, t);
    // The presenter says a word every 1/pace s, but only one the voice has said.
    const reached = s.saying ? s.saying.from + Math.floor((t - start) * voiceWps * s.saying.rate) - 1 : s.said;
    if (t < silentFrom && t >= sayAt && presenter <= Math.max(s.said, reached)) {
      presenter++;
      sayAt = t + 1 / pace;
      if (presenter === words.length) doneAt = t;
    }
    const r = Ear.next(s, { presenter, pace, lead, words });
    if (!r) continue;
    mostAhead = Math.max(mostAhead, r.to + 1 - presenter);
    said.push(r);
    s = Ear.started(s, r, t);
    start = t + GAP;
    playingUntil = start + (r.to - r.from + 1) / (voiceWps * r.rate);
  }
  return { said, mostAhead, presenter, state: s, doneAt };
}

test('the voice reads the whole script, in order, no word skipped or repeated', () => {
  for (const lead of [2, 3, 4, 6, 8]) {
    const { said } = talk({ lead, seconds: 120 });
    assert.equal(said[0].from, 0);
    for (let k = 1; k < said.length; k++) assert.equal(said[k].from, said[k - 1].to + 1, `lead ${lead}`);
    assert.equal(said[said.length - 1].to, words.length - 1);
  }
});

test('the voice is never more than lead words ahead of the presenter', () => {
  for (const lead of [2, 3, 4, 6, 8]) {
    for (const pace of [1.2, 2.5, 4]) {
      assert.ok(talk({ lead, pace, seconds: 120 }).mostAhead <= lead, `lead ${lead} pace ${pace}`);
    }
  }
});

test('a silent presenter hears at most lead words, then nothing however long', () => {
  for (const lead of [2, 4, 8]) {
    const { said } = talk({ lead, silentFrom: 0, seconds: 600 });
    const heard = said.reduce((n, r) => n + r.to - r.from + 1, 0);
    assert.ok(heard > lead - 3 && heard <= lead, `lead ${lead}: heard ${heard}`);
  }
});

test('the voice reads on when the presenter does after a pause', () => {
  // Silent from 3 s: the voice stops; the presenter then carries on.
  const paused = talk({ silentFrom: 3, seconds: 20 });
  const going = talk({ seconds: 20 });
  assert.ok(paused.state.said < going.state.said);
  const resumed = Ear.next(paused.state, { presenter: paused.state.said + 1, pace: PACE, lead: 4, words });
  assert.equal(resumed.from, paused.state.said + 1);
});

test('a faster presenter gets a faster voice', () => {
  const s = Ear.create(9); // voice said up to word 9; presenter on 9: ahead 1
  const at = (pace) => Ear.next(s, { presenter: 9, pace, lead: 6, words }).rate;
  assert.ok(at(1.8) < at(2.5));
  assert.ok(at(2.5) < at(3.2));
});

test('the voice reads a little faster than the presenter, and faster still when they catch up', () => {
  const s = Ear.create(9);
  const caughtUp = Ear.next(s, { presenter: 10, pace: PACE, lead: 6, words }); // ahead 0
  const steady = Ear.next(s, { presenter: 7, pace: PACE, lead: 6, words }); // ahead 3 = lead - 3
  assert.ok(caughtUp.rate > steady.rate);
  assert.ok(Math.abs(steady.rate * 2.9 - 1.3 * PACE) < 1e-9, 'steadily it reads a little faster than the presenter');
});

test('the rate stays where speech can be followed', () => {
  const s = Ear.create();
  assert.ok(Ear.next(s, { presenter: 0, pace: 0.5, lead: 4, words }).rate >= 0.6);
  assert.ok(Ear.next(s, { presenter: 0, pace: 9, lead: 4, words }).rate <= 1.6);
});

test('an utterance ends where a clause ends', () => {
  // "Good evening everyone." then "Thank you for coming ..."
  const r = Ear.next(Ear.create(), { presenter: 0, pace: PACE, lead: 8, words });
  assert.equal(Ear.text(words, r.from, r.to), 'Good evening everyone.');
  const comma = words.findIndex((w) => w.text === 'now,');
  const r2 = Ear.next(Ear.create(comma - 2), { presenter: comma - 1, pace: PACE, lead: 8, words });
  assert.equal(Ear.text(words, r2.from, r2.to), 'start now,');
});

test('without a clause end, it waits for room for a few words rather than say one', () => {
  // The voice said up to word 5 ("for"). With lead 4, a presenter on word 4
  // leaves room for 2 words (coming to): it waits. On word 5, room for 3.
  const s = Ear.create(5);
  assert.equal(Ear.next(s, { presenter: 4, pace: PACE, lead: 4, words }), null);
  const r = Ear.next(s, { presenter: 5, pace: PACE, lead: 4, words });
  assert.equal(Ear.text(words, r.from, r.to), 'coming to the');
});

test('it never reads words the presenter has already said', () => {
  // The presenter read ahead from the screen to word 12.
  const r = Ear.next(Ear.create(5), { presenter: 12, pace: PACE, lead: 4, words });
  assert.equal(r.from, 12);
});

test('it waits while an utterance plays, and stops at the end of the script', () => {
  const s = Ear.started(Ear.create(), { from: 0, to: 2, rate: 1 });
  assert.equal(Ear.next(s, { presenter: 3, pace: PACE, lead: 4, words }), null);
  const end = Ear.create(words.length - 1);
  assert.equal(Ear.next(end, { presenter: words.length - 1, pace: PACE, lead: 4, words }), null);
});

test('a stopped utterance is said again; a jump starts over there', () => {
  let s = Ear.started(Ear.create(), { from: 0, to: 2, rate: 1 });
  s = Ear.halt(s);
  assert.equal(Ear.next(s, { presenter: 0, pace: PACE, lead: 4, words }).from, 0);
  s = Ear.jump(Ear.create(20), 5);
  assert.equal(Ear.next(s, { presenter: 5, pace: PACE, lead: 4, words }).from, 5);
});

test('the voice’s own pace is learned after the first utterances', () => {
  let s = Ear.create();
  for (let k = 0; k < 20; k++) {
    s = Ear.started(s, { from: k * 4, to: k * 4 + 3, rate: 1 });
    s = Ear.ended(s, k * 10, k * 10 + 1); // 4 words in 1 s: 4 words/s
  }
  assert.ok(Math.abs(s.wps - 4) < 0.05, `wps ${s.wps}`);
  // Steadily, it then reads at the presenter's pace.
  const r = Ear.next(Ear.create(9), { presenter: 7, pace: PACE, lead: 6, words });
  const learned = Ear.next({ ...Ear.create(9), wps: s.wps }, { presenter: 7, pace: PACE, lead: 6, words });
  assert.ok(learned.rate < r.rate);
});

test('the first utterances (Bluetooth waking up) do not teach the voice’s pace', () => {
  let s = Ear.started(Ear.create(), { from: 0, to: 3, rate: 1 });
  s = Ear.ended(s, 0, 4); // 1 word/s: slow start
  assert.equal(s.wps, Ear.create().wps);
});

// say has the voice say words [from, to] from t, one word every 0.4 s.
function say(s, from, to, t) {
  s = Ear.started(s, { from, to, rate: 1 }, t);
  return Ear.ended(s, t, t + 0.4 * (to - from + 1));
}

const LATENCY = 0.6;

test('a presenter repeating the voice is not taken for echo', () => {
  let s = Ear.create();
  let t = 0;
  for (let w = 0; w < 24; w += 3) {
    s = say(s, w, w + 2, t);
    // They say each word about a second after the voice; heard latency later.
    for (let k = 0; k < 3; k++) s = Ear.heard(s, w + k, t + 0.4 * (k + 1) + 1 + LATENCY, LATENCY);
    t += 1.2;
  }
  assert.equal(s.probe, null);
});

test('the voice heard in the microphone stops it: it holds still and the follower stops too', () => {
  let s = Ear.create();
  let t = 0;
  let echo = false;
  let probes = 0;
  for (let w = 0; w < 60 && !echo; ) {
    if (s.probe) {
      // Nothing is said, so nothing is heard.
      t += 0.1;
      const r = Ear.check(s, t);
      s = r.state;
      echo = r.echo;
      continue;
    }
    s = say(s, w, w + 2, t);
    for (let k = 0; k < 3 && !s.probe; k++) {
      s = Ear.heard(s, w + k, t + 0.4 * (k + 1) + LATENCY, LATENCY);
      if (s.probe) probes++;
    }
    w += 3;
    t += 1.2;
  }
  assert.ok(echo, 'echo found');
  assert.equal(probes, 2);
});

test('a presenter in step with the voice is probed, but goes on talking and is not stopped', () => {
  let s = Ear.create();
  let t = 0;
  let echoes = 0;
  let probes = 0;
  for (let w = 0; w < 60; w += 3) {
    if (s.probe) {
      // The voice is still; the presenter knows the script and talks on.
      probes++;
      const at = s.probe.at;
      s = Ear.heard(s, w, at + 1.2, LATENCY);
      const r = Ear.check(s, at + 3);
      s = r.state;
      if (r.echo) echoes++;
      t = at + 3;
    }
    s = say(s, w, w + 2, t);
    for (let k = 0; k < 3; k++) s = Ear.heard(s, w + k, t + 0.4 * (k + 1) + LATENCY, LATENCY);
    t += 1.2;
  }
  assert.ok(probes > 0, "it was probed");
  assert.equal(echoes, 0);
});

test('a probe holds the voice still', () => {
  let s = Ear.create();
  s = say(s, 0, 3, 0);
  for (let k = 0; k < 3; k++) s = Ear.heard(s, k, 0.4 * (k + 1) + LATENCY, LATENCY);
  assert.ok(s.probe);
  assert.equal(Ear.next(s, { presenter: 3, pace: PACE, lead: 8, words }), null);
});

test('two pauses far apart are not taken for echo', () => {
  let s = Ear.create();
  let echoes = 0;
  // Suspicion, then a probe the presenter happens to be quiet through; long
  // after, the same again further on.
  for (const [w, t] of [[0, 0], [8, 30]]) {
    s = say(s, w, w + 3, t);
    for (let k = 0; k < 3; k++) s = Ear.heard(s, w + k, t + 0.4 * (k + 1) + LATENCY, LATENCY);
    assert.ok(s.probe);
    const r = Ear.check(s, s.probe.at + 3);
    s = r.state;
    if (r.echo) echoes++;
  }
  assert.equal(echoes, 0);
});

test('a paragraph without a full stop still ends an utterance', () => {
  const doc = Script.parse('Thank you all\n\nNow the numbers matter most');
  const r = Ear.next(Ear.create(), { presenter: 0, pace: PACE, lead: 8, words: doc.words });
  assert.equal(Ear.text(doc.words, r.from, r.to), 'Thank you all');
});

test('a hyphenated word is read as written', () => {
  const doc = Script.parse('It is state-of-the-art work.');
  const r = Ear.next(Ear.create(), { presenter: 0, pace: PACE, lead: 8, words: doc.words });
  assert.equal(Ear.text(doc.words, r.from, r.to), 'It is state-of-the-art work.');
});

test('a presenter a second behind the voice is never suspected', () => {
  let s = Ear.create();
  let t = 0;
  for (let w = 0; w < 24; w += 3) {
    s = say(s, w, w + 2, t);
    for (let k = 0; k < 3; k++) {
      s = Ear.heard(s, w + k, t + 0.4 * (k + 1) + 1 + LATENCY, LATENCY);
      assert.equal(s.probe, null, `word ${w + k}`);
    }
    t += 1.2;
  }
});

test('a probe holds the voice for a while before it decides', () => {
  let s = Ear.create();
  s = say(s, 0, 3, 0);
  for (let k = 0; k < 3; k++) s = Ear.heard(s, k, 0.4 * (k + 1) + LATENCY, LATENCY);
  const at = s.probe.at;
  const early = Ear.check(s, at + 2);
  assert.ok(early.state.probe, 'still holding after 2 s');
  // A presenter heard after the echo has settled ends it: the voice goes on.
  const going = Ear.heard(early.state, 4, at + 1.5, LATENCY);
  assert.equal(going.probe, null);
  assert.equal(Ear.check(going, at + 10).echo, false);
});

test('one odd measurement moves the voice’s pace only part of the way', () => {
  let s = Ear.create();
  for (let k = 0; k < 3; k++) {
    s = Ear.started(s, { from: k * 4, to: k * 4 + 3, rate: 1 });
    s = Ear.ended(s, k * 10, k * 10 + 4 / 2.9); // the guess: 2.9 words/s
  }
  s = Ear.started(s, { from: 12, to: 15, rate: 1 });
  s = Ear.ended(s, 40, 41); // 4 words/s, once
  assert.ok(s.wps > 2.9 && s.wps < 3.6, `wps ${s.wps}`);
});

test('it reads in Samantha: the best quality, on this machine first', () => {
  const samantha = (uri, localService = true) => ({ name: 'Samantha', voiceURI: uri, lang: 'en-US', localService });
  const voices = [
    { name: 'Alva', voiceURI: 'com.apple.voice.premium.sv-SE.Alva', lang: 'sv-SE', localService: true },
    samantha('Samantha (network)', false),
    samantha('com.apple.voice.compact.en-US.Samantha'),
    samantha('com.apple.voice.premium.en-US.Samantha'),
    { name: 'Samanthas', voiceURI: 'x', lang: 'en-US', localService: true },
  ];
  assert.equal(Ear.choose(voices).voiceURI, 'com.apple.voice.premium.en-US.Samantha');
  assert.equal(Ear.choose(voices.slice(0, 3)).voiceURI, 'com.apple.voice.compact.en-US.Samantha', 'on this machine before the network');
  assert.equal(Ear.choose([voices[0], voices[4]]), null, 'only Samantha');
});

test('the voice’s own echo just after it stops does not end a probe', () => {
  let s = Ear.create();
  s = say(s, 0, 3, 0);
  for (let k = 0; k < 3; k++) s = Ear.heard(s, k, 0.4 * (k + 1) + LATENCY, LATENCY);
  const at = s.probe.at;
  s = Ear.heard(s, 3, at + 0.5, LATENCY); // the last words, recognized late
  assert.ok(s.probe, 'still probing');
});

test('a presenter following the voice is not held up by it', () => {
  // Each utterance takes GAP to start; reading a little faster than the
  // presenter makes that up, so they finish about when their pace says.
  // A lead of 2 or 3 words is shorter than an utterance takes to start at a
  // fast pace: it holds a fast presenter up, and is not tried here.
  for (const lead of [4, 6, 8]) {
    for (const pace of [2, 2.5, 3.5]) {
      const { doneAt } = talk({ lead, pace, seconds: 120 });
      const own = words.length / pace;
      assert.ok(doneAt <= own * 1.1, `lead ${lead} pace ${pace}: done at ${doneAt.toFixed(1)} s, own pace ${own.toFixed(1)} s`);
    }
  }
});

test('a presenter talking from memory past the voice drops what it says', () => {
  // The voice was given words 3–8 at t = 0; at 2.9 words/s it is on word 4
  // at t = 0.5.
  const s = Ear.started(Ear.create(2), { from: 3, to: 8, rate: 1 }, 0);
  assert.equal(Ear.overtake(s, 4, 0.5), s, 'level with the voice: it goes on');
  const passed = Ear.overtake(s, 6, 0.5);
  assert.equal(passed.saying, null);
  const r = Ear.next(passed, { presenter: 6, pace: PACE, lead: 4, words });
  assert.equal(r.from, 6, 'it goes on from the word they are on');
  assert.equal(Ear.overtake(Ear.create(2), 9, 1).saying, null, 'nothing playing: nothing to drop');
});

test('echo is found while long utterances still play', () => {
  // The voice says n words, 0.4 s each; each is heard LATENCY after it is
  // said, before the utterance ends.
  for (const n of [2, 4, 6, 8]) {
    let s = Ear.create();
    let t = 0;
    let probed = false;
    s = { ...s, wps: 2.5 }; // 0.4 s a word at rate 1
    for (let w = 0; w < 40 && !probed; w += n) {
      s = Ear.started(s, { from: w, to: w + n - 1, rate: 1 }, t);
      for (let k = 0; k < n && !s.probe; k++) s = Ear.heard(s, w + k, t + 0.4 * (k + 1) + LATENCY, LATENCY);
      probed = Boolean(s.probe);
      if (!probed) s = Ear.ended(s, t, t + 0.4 * n);
      t += 0.4 * n;
    }
    assert.ok(probed, `${n}-word utterances`);
  }
});

test('a pace that is not a number is a bug, not a tempo', () => {
  assert.throws(() => Ear.next(Ear.create(), { presenter: 0, pace: NaN, lead: 4, words }));
});

test('a presenter ahead of the voice is never taken for echo', () => {
  // They read from the screen: each word is recognized before the voice says it.
  let s = Ear.create();
  for (let w = 0; w < 24; w += 3) {
    s = Ear.started(s, { from: w, to: w + 2, rate: 1 }, w);
    for (let k = 0; k < 3; k++) s = Ear.heard(s, w + k, w + 0.1 * k, LATENCY);
    assert.equal(s.probe, null, `word ${w}`);
    s = Ear.ended(s, w, w + 1.2);
  }
});

test('when an utterance has played, its measured times replace the reckoned ones', () => {
  // Given at 0 but played from 5 to 6.6 (the browser was slow): its echo
  // comes LATENCY after 5.4, 5.8 and 6.2.
  let s = Ear.started(Ear.create(), { from: 0, to: 3, rate: 1 }, 0);
  s = Ear.ended(s, 5, 6.6);
  for (let k = 0; k < 3; k++) s = Ear.heard(s, k, 5 + 0.4 * (k + 1) + LATENCY, LATENCY);
  assert.ok(s.probe);
});

test('with a short lead, a presenter who has caught up still gets a faster voice', () => {
  // The voice said up to "evening"; "everyone." is next.
  const s = Ear.create(1);
  const caughtUp = Ear.next(s, { presenter: 2, pace: PACE, lead: 3, words }); // ahead 0
  const ahead = Ear.next(s, { presenter: 1, pace: PACE, lead: 3, words }); // ahead 1
  assert.ok(caughtUp.rate > ahead.rate);
});

test('passing the voice by one word is enough to drop what it says', () => {
  const s = Ear.started(Ear.create(2), { from: 3, to: 8, rate: 1 }, 0); // on word 4 at 0.5 s
  assert.equal(Ear.overtake(s, 5, 0.5).saying, null);
});

test('words the voice was dropped before saying are not taken for its echo', () => {
  // Words 0–7 given at 0; at 0.3 s the voice is on word 0 and the presenter
  // on word 1. They say 1, 2, 3 themselves, recognized LATENCY after the
  // voice would have said them.
  let s = Ear.started({ ...Ear.create(), wps: 2.5 }, { from: 0, to: 7, rate: 1 }, 0);
  s = Ear.overtake(s, 1, 0.3);
  assert.equal(s.saying, null);
  for (let w = 1; w <= 3; w++) s = Ear.heard(s, w, 0.4 * (w + 1) + LATENCY, LATENCY);
  assert.equal(s.probe, null);
});

test('echo is timed from when the voice was heard to start, not when it was given', () => {
  // Given at 0, heard to start at 0.6 s (earphones waking up): its echo
  // comes LATENCY after each word, counted from 0.6 s.
  for (const n of [4, 8]) {
    let s = Ear.started({ ...Ear.create(), wps: 2.5 }, { from: 0, to: n - 1, rate: 1 }, 0);
    s = Ear.began(s, 0.6);
    for (let k = 0; k < 3; k++) s = Ear.heard(s, k, 0.6 + 0.4 * (k + 1) + LATENCY, LATENCY);
    assert.ok(s.probe, `${n} words`);
  }
});

test('a voice that started late is reckoned from its start when the presenter passes it', () => {
  // Given at 0 but heard only from 1 s; at 1.2 s it is on word 0.
  let s = Ear.started({ ...Ear.create(), wps: 2.5 }, { from: 0, to: 7, rate: 1 }, 0);
  s = Ear.began(s, 1);
  assert.equal(Ear.overtake(s, 1, 1.2).saying, null, 'the presenter on word 1 has passed it');
  assert.ok(Ear.overtake(s, 0, 1.2).saying, 'level with it: it goes on');
});
