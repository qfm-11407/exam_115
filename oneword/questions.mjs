import {readFileSync} from 'node:fs';
export const idiomBank = JSON.parse(readFileSync(new URL('./idiom-bank.json',import.meta.url),'utf8')).entries;
if(!idiomBank.length||idiomBank.some(item=>!/^\p{Script=Han}{4}$/u.test(item.idiom)))throw new Error('Idiom bank must contain four-character idioms only');
export function drawIdiomQuestion(random=Math.random){
  const item=idiomBank[Math.floor(random()*idiomBank.length)];
  const chars=Array.from(item.idiom),blankIndex=Math.floor(random()*4);
  return {idiom:item.idiom,blankIndex,prompt:'「'+chars.map((char,index)=>index===blankIndex?'□':char).join('')+'」請填入缺少的一字。',answer:chars[blankIndex],sourcePage:item.page,seconds:30};
}
