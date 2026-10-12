const test = require('node:test');
const assert = require('node:assert/strict');

// A scripted stand-in for the browser's recognizer.
let current = null;
class FakeRecognition {
  constructor() {
    current = this;
    this.results = [];
  }
  start() {
    this.onstart?.();
  }
  abort() {
    this.onend?.();
  }
  say(text, isFinal = true) {
    const last = this.results[this.results.length - 1];
    const result = [{ transcript: text }];
    result.isFinal = isFinal;
    if (last && !last.isFinal) this.results[this.results.length - 1] = result;
    else this.results.push(result);
    this.onresult({ results: this.results });
  }
  fail(error) {
    this.onerror({ error });
    this.onend?.();
  }
}
globalThis.window = { SpeechRecognition: FakeRecognition };
const Voice = require('../voice.js');
const Script = require('../script.js');

function listen() {
  const heard = [];
  const states = [];
  const v = Voice.create({
    lang: 'en-US',
    normalize: Script.normalize,
    onWords: (words, fresh) => heard.push({ words, fresh }),
    onState: (state, detail) => states.push(detail ? `${state}: ${detail}` : state),
  });
  v.start();
  return { v, heard, states, last: () => heard[heard.length - 1] };
}

test('streams the latest words, interim revisions included', () => {
  const { last } = listen();
  current.say('Good evening', false);
  current.say('Good evening everyone', false);
  assert.deepEqual(last().words, ['good', 'evening', 'everyone']);
  current.say('Good evening everyone and thank you for coming tonight');
  assert.equal(last().words.length, 8);
  assert.equal(last().words[7], 'tonight');
});

test('fresh counts only words heard since the last consume', () => {
  const { v, last } = listen();
  current.say('we will talk', false);
  assert.equal(last().fresh, 3);
  v.consume();
  current.say('we will talk', true); // final repeats the interim
  assert.equal(last().fresh, 0);
  current.say('about the', false);
  assert.equal(last().fresh, 2);
});

test('reset drops what was heard before a manual jump, without restarting', () => {
  const { v, last, states } = listen();
  current.say('thank you for coming', false);
  v.reset();
  current.say('thank you for coming tonight we', false);
  assert.deepEqual(last().words, ['tonight', 'we']);
  assert.equal(last().fresh, 2);
  assert.ok(!states.includes('stopped'));
});

test('hyphenated speech splits like the script', () => {
  const { last } = listen();
  current.say('state-of-the-art');
  assert.deepEqual(last().words, ['state', 'of', 'the', 'art']);
});

test('a blocked microphone stops and the reason survives the end event', () => {
  const { v, states } = listen();
  current.fail('not-allowed');
  assert.equal(v.active(), false);
  assert.match(states.find((s) => s.startsWith('error')), /microphone blocked/);
});

test('a network error keeps trying', () => {
  const { v, states } = listen();
  current.fail('network');
  assert.equal(v.active(), true);
  assert.ok(states.some((s) => s.startsWith('error')));
  v.stop();
});

test('a revision that splits an earlier word does not make used words fresh', () => {
  const { v, last } = listen();
  current.say('we cannot stop now', false);
  v.consume();
  current.say('we can not stop now', false); // same speech, one more word
  assert.equal(last().fresh, 0);
  current.say('we can not stop now because', false);
  assert.equal(last().fresh, 1);
});
