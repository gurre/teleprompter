const test = require('node:test');
const assert = require('node:assert/strict');
const Script = require('../script.js');

test('normalize makes script and recognizer spellings equal', () => {
  assert.equal(Script.normalize("Don't,"), Script.normalize("don't"));
  assert.equal(Script.normalize('Café!'), Script.normalize('cafe'));
  assert.equal(Script.normalize('—'), '');
});

test('blank lines separate paragraphs; single newlines are line breaks', () => {
  const { words, paragraphs } = Script.parse('One two\nthree\n\n\nFour five');
  assert.deepEqual(paragraphs, [{ start: 0, end: 3 }, { start: 3, end: 5 }]);
  assert.deepEqual(words.map((w) => w.lineBreak), [false, false, true, false, false]);
  assert.deepEqual(words.map((w) => w.para), [0, 0, 0, 1, 1]);
});

test('every word is matchable and no text is lost', () => {
  const text = '— Hello ... world — \n\n !!! \n\n— last';
  const { words } = Script.parse(text);
  assert.ok(words.every((w) => w.norm.length > 0));
  const shown = words.map((w) => w.text).join(' ');
  for (const token of ['—', 'Hello', '...', 'world', 'last']) assert.ok(shown.includes(token), token);
});

test('empty script has no words', () => {
  assert.deepEqual(Script.parse('  \n\n  '), { words: [], paragraphs: [] });
});

test('hyphenated words match as spoken but display as written', () => {
  const { words } = Script.parse('a state-of-the-art lab — this—that -5');
  assert.deepEqual(words.map((w) => w.norm), ['a', 'state', 'of', 'the', 'art', 'lab', 'this', 'that', '5']);
  const shown = words.map((w, i) => (i && !w.joined ? ' ' : '') + w.text).join('');
  assert.equal(shown, 'a state-of-the-art lab — this—that -5');
});

test('paragraph and sentence starts are marked', () => {
  const { words } = Script.parse('One two. Three "four?" Five state-of-the-art!\n\nSix seven… eight (nine.) ten');
  const starts = words.filter((w) => w.sentenceStart).map((w) => w.text);
  assert.deepEqual(starts, ['One', 'Three', 'Five', 'Six', 'eight', 'ten']);
  assert.deepEqual(words.filter((w) => w.paraStart).map((w) => w.text), ['One', 'Six']);
});
