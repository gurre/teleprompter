const test = require('node:test');
const assert = require('node:assert/strict');
const Ear = require('../ear.js');

// fakeSpeech stands in for the browser's speechSynthesis: it records what
// it is given and lets the test fire the browser's events.
function fakeSpeech() {
  const synth = {
    spoken: [],
    cancels: 0,
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => [{ name: 'Samantha', voiceURI: 'com.apple.voice.compact.en-US.Samantha', lang: 'en-US', localService: true }],
    addEventListener() {},
    speak(u) {
      synth.spoken.push(u);
    },
    cancel() {
      synth.cancels++;
    },
    resume() {},
  };
  globalThis.speechSynthesis = synth;
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  return synth;
}

function recorder() {
  const calls = [];
  return {
    calls,
    handlers: {
      began: () => calls.push('began'),
      ended: () => calls.push('ended'),
      halted: () => calls.push('halted'),
      failed: (why) => calls.push(`failed: ${why}`),
    },
  };
}

test('an utterance that plays reports its end', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const synth = fakeSpeech();
  const speaker = Ear.speaker(() => {});
  const { calls, handlers } = recorder();
  speaker.say('Good evening everyone.', 1.2, handlers);
  t.mock.timers.tick(40);
  const u = synth.spoken.at(-1);
  assert.equal(u.rate, 1.2);
  assert.equal(u.voice.name, 'Samantha');
  u.onstart();
  u.onend();
  assert.deepEqual(calls, ['began', 'ended']);
  assert.equal(speaker.speaking(), false);
});

test('an utterance interrupted by something else is reported, so its words are said again', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const synth = fakeSpeech();
  const speaker = Ear.speaker(() => {});
  const { calls, handlers } = recorder();
  speaker.say('Good evening everyone.', 1, handlers);
  t.mock.timers.tick(40);
  const u = synth.spoken.at(-1);
  u.onstart();
  u.onerror({ error: 'interrupted' });
  assert.deepEqual(calls, ['began', 'halted']);
});

test('an utterance stopped by the caller reports nothing, even when the browser does', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const synth = fakeSpeech();
  const speaker = Ear.speaker(() => {});
  const { calls, handlers } = recorder();
  speaker.say('Good evening everyone.', 1, handlers);
  t.mock.timers.tick(40);
  const u = synth.spoken.at(-1);
  const cancels = synth.cancels;
  speaker.stop();
  assert.ok(synth.cancels > cancels, 'the browser was told to stop');
  u.onerror({ error: 'canceled' });
  u.onend();
  t.mock.timers.tick(60000);
  assert.deepEqual(calls, []);
});

test('an utterance given right after a cancel is given a moment later', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const synth = fakeSpeech();
  const speaker = Ear.speaker(() => {});
  speaker.say('one', 1, recorder().handlers);
  t.mock.timers.tick(40);
  const before = synth.spoken.length;
  speaker.say('two', 1, recorder().handlers); // cancels "one"
  assert.equal(synth.spoken.length, before, 'not in the same moment as the cancel');
  t.mock.timers.tick(40);
  assert.equal(synth.spoken.at(-1).text, 'two');
});

test('an utterance that never starts is given once more, then fails', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const synth = fakeSpeech();
  const speaker = Ear.speaker(() => {});
  const { calls, handlers } = recorder();
  speaker.say('Good evening everyone.', 1, handlers);
  t.mock.timers.tick(40);
  assert.equal(synth.spoken.length, 1);
  t.mock.timers.tick(4000); // never started: given again
  t.mock.timers.tick(40);
  assert.equal(synth.spoken.length, 2);
  assert.equal(synth.spoken[1].text, 'Good evening everyone.');
  assert.deepEqual(calls, []);
  t.mock.timers.tick(4000);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^failed: nothing played/);
});

test('once the voice has played, a lost utterance is given again sooner', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const synth = fakeSpeech();
  const speaker = Ear.speaker(() => {});
  speaker.say('one', 1, recorder().handlers);
  t.mock.timers.tick(40);
  synth.spoken.at(-1).onstart();
  synth.spoken.at(-1).onend();
  speaker.say('two', 1, recorder().handlers);
  t.mock.timers.tick(40);
  const given = synth.spoken.length;
  t.mock.timers.tick(1200); // never started: given again
  t.mock.timers.tick(40);
  assert.equal(synth.spoken.length, given + 1, 'given again after 1.2 s, not 4 s');
});
