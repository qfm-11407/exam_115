import test from 'node:test';
import assert from 'node:assert/strict';
import { idiomBank, drawIdiomQuestion, otherIdiomAnswers } from '../questions.mjs';

test('the complete bank preserves punctuation and accepts valid alternate completions', () => {
  assert.equal(idiomBank.length, 5554);
  assert.equal(new Set(idiomBank.map(({ idiom }) => idiom)).size, 5554);
  const index = idiomBank.findIndex(({ idiom }) => idiom === '不入虎穴，焉得虎子');
  const draws = [(index + 0.25) / idiomBank.length, 4.25 / 8];
  const q = drawIdiomQuestion(() => draws.shift());
  assert.equal(q.answer, '焉');
  assert.equal(q.blankIndex, 5);
  assert.equal(q.prompt, '「不入虎穴，□得虎子」請填入缺少的一字。');
  assert.ok(otherIdiomAnswers('萍水相逢', 3, '逢').includes('遇'));
  const first = drawIdiomQuestion(() => 0);
  const next = drawIdiomQuestion(() => 0, [first.idiom]);
  assert.notEqual(first.idiom, next.idiom);
});
