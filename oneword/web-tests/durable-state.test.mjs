import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/gas-fixture.mjs';
const bytes=Buffer.alloc(64);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(512,16);bytes.writeUInt32BE(512,20);
const image='data:image/png;base64,'+bytes.toString('base64');
const ids=[...Array.from({length:15},(_,i)=>String(1410701+i)),...Array.from({length:13},(_,i)=>String(1420716+i))];
function setup(count=2){const f=fixture(),room=f.room(),players=ids.slice(0,count).map(studentId=>f.call('join',{room:room.code,studentId}).data);f.start(room.code);const roundId=f.admin().round.id;return{f,room,players,roundId};}
const submit=(s,i=0)=>s.f.call('submit',{room:s.room.code,roundId:s.roundId,image},s.players[i].token);
const keys=(f,code)=>[...f.properties.keys()].filter(k=>k.startsWith('OWSTATE_'+code+'_'));

test('28 saves and 28 judgments no longer read or rewrite the Drive room file for each transition',()=>{
 const s=setup(28),{f,room}=s,before={reads:f.state.roomReads,writes:f.state.roomWrites};
 for(let i=0;i<28;i++)assert.equal(submit(s,i).ok,true);
 for(let i=0;i<28;i++)assert.equal(f.call('worker',{room:room.code},f.auth).ok,true);
 assert.equal(f.state.roomReads-before.reads,0);assert.equal(f.state.roomWrites-before.writes,1); // one close checkpoint
 assert.equal(f.admin().round.submitted,28);assert.equal(f.admin().round.judged,28);
 assert.equal([...f.files.values()].filter(file=>file.name.endsWith('.png')).length,28);
});

test('clearing all caches restores the latest accepted answer from durable properties, not the older Drive checkpoint',()=>{
 const s=setup(),{f,room}=s;assert.equal(submit(s).ok,true);const file=f.files.get(f.properties.get('ROOM_'+room.code));assert.equal(Object.keys(JSON.parse(file.getBlob().getDataAsString()).round.submissions).length,0);
 f.cache.clear();const reads=f.state.roomReads;const restored=f.context.readRoom_(room.code,true);assert.ok(restored.round.submissions[s.players[0].player.id].fileId);assert.equal(f.state.roomReads,reads);
});

for(const hook of ['propertyBatchHook','propertyCommitHook'])test(hook+' failure leaves the previous committed room readable',()=>{
 const {f,room}=setup(),head='OWSTATE_'+room.code+'_HEAD',old=f.properties.get(head),title=f.context.readRoom_(room.code,true).title;
 f.state[hook]=()=>{throw Error('Injected storage interruption');};assert.throws(()=>f.context.locked_(()=>{const r=f.context.readRoom_(room.code,true);r.title='uncommitted';f.context.saveRoom_(r);}));f.state[hook]=null;
 assert.equal(f.properties.get(head),old);f.cache.clear();assert.equal(f.context.readRoom_(room.code,true).title,title);
});

test('corrupt active chunks fail visibly instead of silently reverting to an outdated Drive copy',()=>{
 const {f,room}=setup(),head=JSON.parse(f.properties.get('OWSTATE_'+room.code+'_HEAD'));f.properties.set('OWSTATE_'+room.code+'_'+head.bank+'_0','invalid');f.cache.clear();assert.equal(f.call('room',{room:room.code}).status,503);
});

test('chunks stay below the per-value limit, total active storage stays bounded, and oversized writes never commit',()=>{
 const {f,room}=setup(28);assert.ok(keys(f,room.code).length>2);for(const key of keys(f,room.code))assert.ok(Buffer.byteLength(f.properties.get(key))<=8000,key);
 assert.ok([...f.properties].reduce((n,[k,v])=>n+Buffer.byteLength(k)+Buffer.byteLength(v),0)<500000);
 const head=f.properties.get('OWSTATE_'+room.code+'_HEAD');assert.throws(()=>f.context.locked_(()=>{const r=f.context.readRoom_(room.code,true);r.title='字'.repeat(60000);f.context.saveRoom_(r);}));assert.equal(f.properties.get('OWSTATE_'+room.code+'_HEAD'),head);
});

test('a failed end checkpoint retains durable state; retry ends once and releases only that rooms state',()=>{
 const s=setup(),{f,room}=s;submit(s);f.state.roomWriteHook=()=>{throw Error('Drive unavailable');};assert.equal(f.call('endRoom',{room:room.code},f.auth).status,503);f.cache.clear();assert.ok(f.context.readRoom_(room.code,true).endedAt);assert.ok(keys(f,room.code).length);
 f.state.roomWriteHook=null;f.cache.set('teacher:'+f.auth,'yes');assert.equal(f.call('endRoom',{room:room.code},f.auth).ok,true);assert.equal(keys(f,room.code).length,0);assert.ok(f.properties.has('TEACHER_PIN'));assert.ok(f.context.readRoom_(room.code,true).endedAt);
});

test('switching historical rooms checkpoints and releases inactive banks instead of growing state for all 30 rooms',()=>{
 const f=fixture(),first=f.room();f.call('join',{room:first.code,studentId:ids[0]});const second=f.room();assert.equal(keys(f,first.code).length,0);assert.ok(keys(f,second.code).length);
 assert.equal(f.call('selectRoom',{room:first.code},f.auth).ok,true);assert.equal(keys(f,second.code).length,0);assert.equal(f.context.readRoom_(first.code,true).players.length,1);
});

test('a timely server receipt survives a busy lock and preserves the same image after the writing and grace deadlines',()=>{
 const s=setup(1),{f,room}=s;f.state.locked=true;assert.equal(submit(s).status,429);f.state.locked=false;assert.ok([...f.properties.keys()].some(k=>k.startsWith('OWIN_'+room.code+'_')));
 f.state.now+=60000;const before=f.admin();assert.equal(before.round.phase,'closed');assert.equal(before.round.pending,1);assert.equal(f.call('reveal',{room:room.code},f.auth).status,409);
 assert.equal(submit(s).ok,true);assert.equal(f.admin().round.submitted,1);assert.ok(f.admin().round.performance.acceptMs.average>=60000);
});

test('unclaimed receipts pause automation after timeout; retrying the original picture recovers without a missing score',()=>{
 const f=fixture(),room=f.room(),p=f.call('join',{room:room.code,studentId:ids[0]}).data;
 const r=f.call('start-series',{room:room.code,draftId:f.admin().draft.id,seconds:30,totalQuestions:1,revealSeconds:5},f.auth).data.room;
 f.state.locked=true;assert.equal(f.call('submit',{room:room.code,roundId:r.round.id,image},p.token).status,429);f.state.locked=false;f.state.now+=160000;
 assert.equal(f.admin().automation.status,'paused');assert.equal(f.admin().round.phase,'closed');
 assert.equal(f.call('submit',{room:room.code,roundId:r.round.id,image},p.token).ok,true);f.call('worker',{room:room.code},f.auth);assert.equal(f.admin().players[0].score,10);
});

test('receipts do not authorize first-time late answers, changed images or revoked student sessions',()=>{
 const s=setup(),{f,room}=s;f.state.locked=true;assert.equal(submit(s).status,429);f.state.locked=false;
 const other=Buffer.from(bytes);other[40]=1;assert.equal(f.call('submit',{room:room.code,roundId:s.roundId,image:'data:image/png;base64,'+other.toString('base64')},s.players[0].token).status,409);
 f.call('removePlayer',{room:room.code,playerId:s.players[0].player.id,connectionVersion:0},f.auth);assert.equal(submit(s).status,401);
 f.state.now+=36000;assert.equal(submit(s,1).status,409);
});

test('workers give active image uploads priority without taking the shared lock or running AI',()=>{
 const s=setup(),{f,room}=s;f.state.createHook=()=>{const reply=f.call('worker',{room:room.code},f.auth);assert.equal(reply.data.receiving,true);assert.equal(f.state.locked,false);};assert.equal(submit(s).ok,true);assert.equal(f.state.aiCalls,0);
});

for(const action of ['worker','workerBatch'])test(action+' recovers an exact PNG when Drive writes it but the room update is interrupted',()=>{
 const s=setup(1),{f,room,roundId}=s;
 f.state.createHook=()=>{f.state.locked=true;};
 assert.equal(submit(s).status,503);
 f.state.locked=false;f.state.createHook=null;
 assert.equal(f.admin().players[0].judgeStatus,'uploading');
 f.state.now+=151000;
 assert.equal(f.call(action,{room:room.code,roundId},f.auth).data.processed,true);
 assert.equal(f.admin().round.submitted,1);assert.equal(f.admin().round.judged,1);
 assert.equal([...f.files.values()].filter(file=>file.name.endsWith('.png')).length,1);
});

test('a same-name PNG with different bytes is not counted as the accepted answer',()=>{
 const s=setup(1),{f,room,roundId}=s;
 f.state.createHook=file=>{
   const other=Buffer.from(bytes);other[40]=1;
   file.value=f.context.Utilities.newBlob([...other],'image/png',file.name);
   f.state.locked=true;
 };
 assert.equal(submit(s).status,503);
 f.state.locked=false;f.state.createHook=null;f.state.now+=151000;
 assert.equal(f.call('workerBatch',{room:room.code,roundId},f.auth).ok,true);
 assert.equal(f.admin().players[0].judgeStatus,'upload-error');
 assert.equal(f.admin().round.submitted,0);
 assert.equal(submit(s).ok,true);
 assert.equal(f.call('workerBatch',{room:room.code,roundId},f.auth).data.processed,true);
 assert.equal(f.admin().round.judged,1);
});

test('the original upload finishing after recovery preserves the completed judgment',()=>{
 const s=setup(1),{f,room,roundId}=s;
 f.state.createHook=()=>{
   f.state.now+=151000;
   assert.equal(f.call('workerBatch',{room:room.code,roundId},f.auth).data.processed,true);
 };
 assert.deepEqual(submit(s).data,{ok:true,duplicate:true});
 assert.equal(f.admin().players[0].judgeStatus,'done');
 assert.equal(f.call('workerBatch',{room:room.code,roundId},f.auth).data.idle,true);
});

test('a frozen retry cannot create a new PNG or reopen work after the teacher has revealed an unresolved answer',()=>{
 const s=setup(1),{f,room}=s;f.state.locked=true;assert.equal(submit(s).status,429);f.state.locked=false;f.state.now+=160000;
 assert.equal(f.call('reveal',{room:room.code},f.auth).ok,true);assert.equal(submit(s).status,409);assert.equal([...f.files.values()].filter(file=>file.name.endsWith('.png')).length,0);assert.equal(f.admin().round.phase,'revealed');assert.equal(f.admin().round.pending,0);
});
