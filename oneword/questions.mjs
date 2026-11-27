import { readFileSync } from 'node:fs';

const han = /^\p{Script=Han}$/u;
export const idiomBank = JSON.parse(readFileSync(new URL('./idiom-bank.json', import.meta.url), 'utf8')).entries;

function maskAt(chars, blankIndex) {
  return chars.map((char, index) => index === blankIndex ? '□' : char).join('');
}

const questions = idiomBank.map(item => {
  const chars = Array.from(item.idiom);
  const positions = chars.flatMap((char, index) => han.test(char) ? [index] : []);
  if (!positions.length || chars.some(char => !han.test(char) && char !== '，')) {
    throw new Error('Invalid idiom: ' + item.idiom);
  }
  return { item, chars, positions };
});
if (!questions.length || new Set(idiomBank.map(item => item.idiom)).size !== questions.length) {
  throw new Error('The idiom bank must contain unique entries');
}

const answersByMask = new Map();
for (const { chars, positions } of questions) {
  for (const position of positions) {
    const mask = maskAt(chars, position);
    const answers = answersByMask.get(mask) || [];
    answers.push(chars[position]);
    answersByMask.set(mask, answers);
  }
}

export function otherIdiomAnswers(idiom, blankIndex, answer) {
  const mask = maskAt(Array.from(idiom), blankIndex);
  return (answersByMask.get(mask) || []).filter(char => char !== answer);
}

export function drawIdiomQuestion(random = Math.random, excluded = []) {
  const used = new Set(excluded);
  const pool = used.size ? questions.filter(({ item }) => !used.has(item.idiom)) : questions;
  if (!pool.length) throw new Error('No unused idioms remain');
  const { item, chars, positions } = pool[Math.floor(random() * pool.length)];
  const blankIndex = positions[Math.floor(random() * positions.length)];
  const mask = maskAt(chars, blankIndex);
  const answer = chars[blankIndex];
  return {
    idiom: item.idiom, blankIndex, prompt: '「' + mask + '」請填入缺少的一字。',
    answer, accepted: otherIdiomAnswers(item.idiom, blankIndex, answer),
    sourcePage: item.page, seconds: 30,
  };
}
