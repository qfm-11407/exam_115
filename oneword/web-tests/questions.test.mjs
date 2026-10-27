import test from 'node:test';
import assert from 'node:assert/strict';
import {idiomBank,drawIdiomQuestion} from '../questions.mjs';

test('the existing 148-idiom catalog generates four valid blank positions per idiom (592 combinations)',()=>{
  assert.equal(idiomBank.length,148);assert.equal(new Set(idiomBank.map(x=>x.idiom)).size,148);
  let variants=0;
  for(let i=0;i<idiomBank.length;i++){
    const prompts=new Set();
    for(let blank=0;blank<4;blank++){
      const draws=[(i+0.25)/idiomBank.length,(blank+0.25)/4];let calls=0;
      const q=drawIdiomQuestion(()=>draws[calls++]);
      assert.equal(calls,2);assert.equal(q.idiom,idiomBank[i].idiom);assert.equal(q.blankIndex,blank);assert.equal(q.answer,Array.from(q.idiom)[blank]);assert.equal((q.prompt.match(/□/g)||[]).length,1);assert.equal(q.sourcePage,idiomBank[i].page);
      const mask=Array.from(q.idiom).map((c,n)=>n===blank?'□':c).join('');assert.ok(q.prompt.includes(mask));prompts.add(q.prompt);variants++;
    }
    assert.equal(prompts.size,4);
  }
  assert.equal(variants,592);
});
