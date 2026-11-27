import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/gas-fixture.mjs';

const ids=[...Array.from({length:15},(_,i)=>String(1410701+i)),...Array.from({length:13},(_,i)=>String(1420716+i))];
const bytes=Buffer.alloc(64);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(512,16);bytes.writeUInt32BE(512,20);
const image='data:image/png;base64,'+bytes.toString('base64');
const response=(correct,code=200)=>({getResponseCode:()=>code,getContentText:()=>JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify({correct})}]}],usage:{input_tokens:20,output_tokens:4}})});
function setup(count=4,{mode='live',concurrency=2,save=true}={}){
 const f=fixture();f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency},f.auth);
 const room=f.room(mode),players=ids.slice(0,count).map(studentId=>f.call('join',{room:room.code,studentId}).data);f.start(room.code);const roundId=f.admin().round.id;
 const submit=p=>f.call('submit',{room:room.code,roundId,image},p.token);
 if(save)for(const p of players)assert.equal(submit(p).ok,true);
 const run=()=>f.call('workerBatch',{room:room.code,roundId},f.auth);
 return{f,room,players,roundId,run,submit};
}

test('28 real-backend judgments use 14 batches and 28 state commits, with unchanged API count, hidden verdicts and idempotent scoring',()=>{
 const {f,room,run}=setup(28),before=f.state.propertyCommits;
 const reply=run();assert.equal(reply.ok,true);assert.equal(reply.data.processedCount,28);assert.equal(reply.data.batches,14);assert.equal(reply.data.remainingQueued,0);
 assert.deepEqual(f.state.fetchBatches,Array(14).fill(2));assert.equal(f.state.aiCalls,28);assert.equal(f.state.propertyCommits-before,28);
 assert.equal(f.admin().round.judged,28);assert.equal(f.admin().usage.calls,28);assert.ok(f.admin().players.every(p=>p.correct===null&&p.score===0));
 assert.equal(run().data.idle,true);assert.equal(f.state.aiCalls,28);
 assert.equal(f.call('reveal',{room:room.code},f.auth).ok,true);assert.ok(f.admin().players.every(p=>p.correct===true&&p.score===10));
 f.call('reveal',{room:room.code},f.auth);assert.ok(f.admin().players.every(p=>p.score===10));
});

test('batch size respects the configured concurrency including a final incomplete batch',()=>{
 for(const concurrency of [1,2,3]){const {f,run}=setup(7,{concurrency});assert.equal(run().data.processedCount,7);assert.ok(f.state.fetchBatches.every(n=>n<=concurrency));assert.equal(f.state.fetchBatches.reduce((a,b)=>a+b,0),7);}
});

test('one failed or malformed AI response cannot mark the other batch answers wrong or discard their successful results',()=>{
 const {f,run}=setup(4);
 f.state.fetchHook=()=>f.state.aiCalls===1?response(false):f.state.aiCalls===2?response(null,429):f.state.aiCalls===3?{getResponseCode:()=>200,getContentText:()=>'{broken'}:response(true);
 assert.equal(run().data.processedCount,4);const students=f.admin().players;
 assert.deepEqual(students.map(p=>p.judgeStatus),['done','error','error','done']);assert.equal(f.admin().usage.calls,2);
 const raw=f.context.readRoom_(f.admin().code,true);assert.deepEqual(Object.values(raw.round.submissions).map(s=>s.correct),[false,null,null,true]);
});

test('only uncertain answers are requested twice; completed answers are not charged a second time',()=>{
 const {f,run}=setup(2);f.state.fetchHook=()=>response(f.state.aiCalls===2?true:null);
 assert.equal(run().ok,true);assert.deepEqual(f.state.fetchBatches,[2,1]);assert.equal(f.state.aiCalls,3);assert.equal(f.admin().usage.calls,3);
 assert.deepEqual(f.admin().players.map(p=>p.judgeStatus),['uncertain','done']);assert.equal(f.admin().round.unresolved,1);
});

test('batch workers yield to uploads before acquiring a lock or making paid calls',()=>{
 const s=setup(2,{save:false}),{f,run}=s;let nested;
 f.state.createHook=()=>{const locks=f.state.lockAcquisitions;nested=run();assert.equal(f.state.lockAcquisitions,locks);assert.equal(nested.data.receiving,true);assert.equal(f.state.aiCalls,0);};
 assert.equal(s.submit(s.players[0]).ok,true);assert.equal(nested.ok,true);
 f.state.createHook=null;assert.equal(s.submit(s.players[1]).ok,true);assert.equal(run().data.processedCount,2);
});

test('the under-lock upload check also yields if an intake receipt arrives after the preflight read',()=>{
 const {f,room,players,roundId,run}=setup(2,{save:false});
 assert.equal(f.call('submit',{room:room.code,roundId,image},players[0].token).ok,true);
 const original=f.context.locked_;let inserted=false;
 f.context.locked_=fn=>{if(!inserted){inserted=true;const p=f.context.readRoom_(room.code,true).players.find(p=>p.studentId===players[1].player.studentId);f.context.admitSubmission_({room:room.code,roundId},players[1].token,'test-digest',f.state.now);assert.ok(p);}return original(fn);};
 assert.equal(run().data.receiving,true);assert.equal(f.state.aiCalls,0);
});

test('two teacher workers and a student worker share one concurrency ceiling and cannot duplicate a claimed answer',()=>{
 const {f,room,roundId,run}=setup(4);let checked=false;
 f.state.fetchHook=()=>{if(!checked){checked=true;assert.equal(run().data.idle,true);assert.equal(f.call('worker',{room:room.code,roundId},f.auth).data.idle,true);}return response(true);};
 assert.equal(run().data.processedCount,4);assert.equal(f.state.aiCalls,4);assert.equal(f.admin().round.judged,4);
});

test('an already-running legacy worker leaves only the free slot to the batch worker',()=>{
 const {f,room,roundId,run}=setup(4);let checked=false;
 f.state.fetchHook=()=>{if(!checked){checked=true;assert.equal(run().data.processedCount,3);}return response(true);};
 assert.equal(f.call('worker',{room:room.code,roundId},f.auth).data.processed,true);assert.deepEqual(f.state.fetchBatches,[1,1,1]);assert.equal(f.state.aiCalls,4);assert.equal(f.admin().round.judged,4);
});

test('ending the room during an in-flight batch prevents subsequent paid requests and stale result commits',()=>{
 const {f,room,run}=setup(4);let ended=false;
 f.state.fetchHook=()=>{if(!ended){ended=true;assert.equal(f.call('endRoom',{room:room.code},f.auth).ok,true);}return response(true);};
 assert.equal(run().data.processedCount,0);assert.equal(f.state.aiCalls,2);assert.equal(f.admin().ended,true);assert.ok(f.admin().players.every(p=>p.score===0));assert.equal(run().data.idle,true);assert.equal(f.state.aiCalls,2);
});

test('the request budget returns a resumable queue instead of chaining indefinitely',()=>{
 const {f,run}=setup(4);f.state.fetchHook=()=>{f.state.now+=46000;return response(true);};
 const first=run();assert.equal(first.data.processedCount,2);assert.equal(first.data.remainingQueued,2);assert.equal(first.data.batches,1);
 f.state.fetchHook=null;assert.equal(run().data.processedCount,2);assert.equal(f.admin().round.judged,4);
});

test('a late batch result cannot overwrite a replaced job identifier or count its usage twice',()=>{
 const {f,room,run}=setup(2);let replaced=false,firstId;
 f.state.fetchHook=()=>{if(!replaced){replaced=true;const raw=f.context.readRoom_(room.code,true),first=Object.values(raw.round.submissions)[0];firstId=first.playerId;first.job='replacement-job';f.context.saveRoom_(raw);}return response(true);};
 assert.equal(run().data.processedCount,1);const raw=f.context.readRoom_(room.code,true);assert.equal(raw.round.submissions[firstId].status,'judging');assert.equal(raw.round.submissions[firstId].correct,null);assert.equal(raw.usage.calls,1);
});

test('expired judging leases become recoverable errors without automatically launching duplicate paid requests',()=>{
 const {f,room,run}=setup(2);const raw=f.context.readRoom_(room.code,true);Object.values(raw.round.submissions).forEach(s=>{s.status='judging';s.startedAt=f.state.now-150001;s.job='abandoned';});f.context.saveRoom_(raw);
 assert.equal(run().data.idle,true);assert.equal(f.state.aiCalls,0);assert.ok(f.admin().players.every(p=>p.judgeStatus==='error'&&p.correct===null));
 f.call('retry',{room:room.code},f.auth);assert.equal(run().data.processedCount,2);assert.equal(f.state.aiCalls,2);
});

test('stale or unauthenticated batch requests cannot consume API calls or take a new round job',()=>{
 const {f,room,roundId}=setup(2);
 assert.equal(f.call('workerBatch',{room:room.code,roundId}).status,401);
 assert.equal(f.call('workerBatch',{room:room.code},f.auth).status,400);
 assert.equal(f.call('workerBatch',{room:room.code,roundId:'old'},f.auth).data.idle,true);assert.equal(f.state.aiCalls,0);
});

test('whole-batch transport failure preserves all images and leaves recoverable unscored errors',()=>{
 const {f,room,run}=setup(2);f.state.fetchAllHook=()=>{throw Error('network interrupted');};assert.equal(run().data.processedCount,2);assert.ok(f.admin().players.every(p=>p.submitted&&p.judgeStatus==='error'&&p.correct===null));
 f.state.fetchAllHook=null;f.call('retry',{room:room.code},f.auth);assert.equal(run().data.processedCount,2);assert.equal(f.admin().round.judged,2);
});

test('practice batches do not call any AI endpoint',()=>{
 const {f,run}=setup(28,{mode:'practice'});assert.equal(run().data.processedCount,28);assert.equal(f.state.aiCalls,0);assert.deepEqual(f.state.fetchBatches,[]);assert.equal(f.admin().usage.calls,0);
});
