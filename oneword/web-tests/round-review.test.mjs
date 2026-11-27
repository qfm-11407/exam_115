import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/gas-fixture.mjs';
import {pageFixture} from './helpers/frontend-fixture.mjs';

test('the teacher can review all stored questions, including the final round, without exposing unpublished rounds', () => {
  const f = fixture();
  const room = f.room();
  const player = f.call('join', {room: room.code, studentId: '1410701'}).data;
  const expected = [];
  for (let number = 1; number <= 11; number++) {
    const draft = f.admin().draft;
    const accepted = number === 1 ? ['異'] : [];
    assert.equal(f.call('start', {room: room.code, draftId: draft.id, seconds: 30, accepted}, f.auth).ok, true);
    const writing = f.call('review', {room: room.code}, f.auth).data;
    assert.equal(writing.total, number - 1);
    const validAnswers = [...new Set([...draft.accepted, ...accepted])].filter(char => char !== draft.answer);
    expected.push({number, prompt: draft.prompt, answer: draft.answer, idiom: draft.idiom, accepted: validAnswers, cancelled: false});
    assert.equal(f.call('close', {room: room.code}, f.auth).ok, true);
    assert.equal(f.call('reveal', {room: room.code}, f.auth).ok, true);
  }
  assert.equal(f.call('endRoom', {room: room.code}, f.auth).ok, true);
  assert.equal(f.call('review', {room: room.code}, player.token).status, 401);
  assert.equal(f.call('review', {room: room.code, offset: -1}, f.auth).status, 400);
  const first = f.call('review', {room: room.code}, f.auth).data;
  assert.equal(first.total, 11);
  assert.equal(first.nextOffset, 10);
  assert.deepEqual(first.questions, expected.slice(0, 10));
  const last = f.call('review', {room: room.code, offset: first.nextOffset}, f.auth).data;
  assert.deepEqual(last.questions, expected.slice(10));
  assert.equal(last.nextOffset, null);
});

test('the completed room exposes a teacher dialog that displays answers and loads the next page on demand', async () => {
  const room = {code:'ABCDEF',title:'測驗回顧',mode:'practice',ended:true,roundCount:11,players:[],round:{id:'last',number:11,phase:'revealed',pending:0,unresolved:0}};
  const first = Array.from({length:10}, (_, index) => ({number:index+1,prompt:'按□就班',answer:'部',idiom:'按部就班',accepted:index===0?['步']:[]}));
  const f = await pageFixture('teacher', async (url, request) => {
    if (url === '/api/admin/state') return {status:200,body:{settings:{configured:false},features:{roundReview:true},room}};
    assert.equal(url, '/api/admin/rooms/ABCDEF/review');
    const {offset} = JSON.parse(request.body);
    return {status:200,body:{questions:offset===0?first:[{number:11,prompt:'一□千金',answer:'字',idiom:'一字千金',accepted:[]}],total:11,offset,nextOffset:offset===0?10:null}};
  });
  assert.equal(f.get('round-review-button').hidden, false);
  assert.equal(f.calls.filter(call => call.url.endsWith('/review')).length, 0);
  await f.get('round-review-button').onclick();
  assert.equal(f.get('round-review-dialog').open, true);
  assert.match(f.get('round-review-list').innerHTML, /正解 部/);
  assert.match(f.get('round-review-list').innerHTML, /其他允許字形 步/);
  await f.get('round-review-next').onclick();
  assert.match(f.get('round-review-list').innerHTML, /正解 字/);
  assert.equal(f.get('round-review-next').hidden, true);
});
