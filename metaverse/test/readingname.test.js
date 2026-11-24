// 音読の採点：人の名前（文の途中の大文字の単語）は、その場所で何か言っていればOK（英語の聞き取りでは文字にならないことが多い）
const test = require('node:test');
const assert = require('node:assert');
global.window = {}; global.document = { querySelector: () => null };
require('../public/js/reading.js');
const { grade } = window.Reading;
const ws = (t) => t.split(/\s+/);
const T = 'Hello. My name is Tanaka Hana. Tanaka Hana is my friend. I live in Tokyo.';
const miss = (h) => { const g = grade(ws(T), h); return ws(T).filter((w, i) => !g.ok[i]); };

test('名前：聞き取りがちがう文字になっても、その場所で言っていればOK', () => {
  assert.deepEqual(miss('hello my name is tanaka hannah tanaka hana is my friend i live in tokyo'), []);
  assert.deepEqual(miss('hello my name is takanaka harnah tonaka hanna is my friend i live in tokyo'), []);
});
test('名前：言っていない（その場所に何も聞こえない）ときは、聞き取れなかった単語', () => {
  assert.deepEqual(miss('hello my name is is my friend i live in tokyo'), ['Tanaka', 'Hana.', 'Tanaka', 'Hana']);
  assert.deepEqual(miss('hello my name is tanaka hana is my friend i live in'), ['Tanaka', 'Hana', 'Tokyo.']);
});
test('ふつうの単語は今までどおり（名前あつかいにしない：文の頭・I）', () => {
  assert.deepEqual(miss('my name is tanaka hana tanaka hana is my friend i live in tokyo'), ['Hello.']);
  assert.deepEqual(miss('hello my name is tanaka hana tanaka hana is my friend live in tokyo'), ['I']);
});
