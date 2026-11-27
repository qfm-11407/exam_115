import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const source=await readFile(new URL('../gas/Code.gs',import.meta.url),'utf8');
import {fixture} from './helpers/gas-fixture.mjs';

function png(){const b=Buffer.alloc(64);Buffer.from('89504e470d0a1a0a','hex').copy(b);Buffer.from('IHDR').copy(b,12);b.writeUInt32BE(512,16);b.writeUInt32BE(512,20);return 'data:image/png;base64,'+b.toString('base64');}
const allowedIds=[...Array.from({length:15},(_,i)=>String(1410701+i)),...Array.from({length:13},(_,i)=>String(1420716+i))];
const image=png();
function join(f,code,id='1410701'){return f.call('join',{room:code,studentId:id,name:'同學'}).data;}
function submit(f,code,p){return f.call('submit',{room:code,roundId:f.admin().round.id,image},p.token);}

test('GAS setup creates a private folder; API keys, private file IDs and tokens stay out of public snapshots',()=>{
  const f=fixture();assert.ok(f.properties.get('DRIVE_FOLDER_ID'));assert.equal(f.call('adminState').status,401);assert.equal(f.call('createRoom',{mode:'live'},f.auth).status,400);
  const r=f.room(),p=join(f,r.code);assert.equal(p.player.studentId,'1410701');assert.equal(f.call('join',{room:r.code,studentId:'1410701'}).status,409);assert.equal(f.call('join',{room:r.code,studentId:123}).status,403);assert.equal(f.call('join',{room:r.code,token:p.token}).data.player.id,p.player.id);
  join(f,r.code,'1410702');f.start(r.code);assert.equal(submit(f,r.code,p).ok,true);const publicData=f.call('room',{room:r.code}).data;
  assert.equal(publicData.round.answer,null);assert.equal(publicData.players[0].imageUrl,null);assert.equal(publicData.players[0].correct,null);assert.equal(JSON.stringify(publicData).includes(p.token),false);assert.equal(JSON.stringify(publicData).includes('file-'),false);
  assert.equal(f.call('images',{room:r.code,roundId:publicData.round.id}).status,403);
});

test('28 submissions are saved once; workers keep results hidden, close exposes images, reveal scores only once',()=>{
  const f=fixture(),r=f.room(),players=Array.from({length:28},(_,i)=>join(f,r.code,allowedIds[i]));f.start(r.code);
  for(const p of players){assert.equal(submit(f,r.code,p).ok,true);assert.equal(submit(f,r.code,p).data.duplicate,true);}
  assert.equal([...f.files.values()].filter(file=>file.name.endsWith('.png')).length,28);
  assert.equal(f.admin().round.phase,'closed');assert.equal(f.admin().round.closeReason,'all-submitted');assert.equal(f.call('reveal',{room:r.code},f.auth).status,409);
  for(let i=0;i<28;i++)assert.equal(f.call('worker',{room:r.code},f.auth).data.processed,true);
  const secret=f.call('room',{room:r.code}).data;assert.ok(secret.players.every(p=>p.score===0&&p.correct===null&&p.status==='submitted'));assert.equal(secret.round.answer,null);assert.equal(f.state.aiCalls,0);
  f.call('close',{room:r.code},f.auth);
  const images=f.call('images',{room:r.code,roundId:secret.round.id}).data;assert.equal(Object.keys(images).length,28);assert.ok(Object.values(images).every(s=>s.startsWith('data:image/png;base64,')));
  f.call('reveal',{room:r.code},f.auth);f.call('reveal',{room:r.code},f.auth);const done=f.call('room',{room:r.code}).data;assert.equal(done.players.reduce((n,p)=>n+p.score,0),190);assert.equal(done.players.filter(p=>p.correct===true).length,19);
  assert.ok(f.call('export',{room:r.code},f.auth).data.csv.includes('1410701'));assert.equal(f.call('retry',{room:r.code},f.auth).status,409);
});

test('upload reservation is idempotent and image creation happens outside the global lock',()=>{
  const f=fixture(),r=f.room(),p=join(f,r.code);f.start(r.code);let nested;
  f.state.createHook=()=>{assert.equal(f.state.locked,false);nested=submit(f,r.code,p);};
  assert.equal(submit(f,r.code,p).ok,true);assert.equal(nested.status,429);assert.equal([...f.files.values()].filter(file=>file.name.endsWith('.png')).length,1);assert.equal(submit(f,r.code,p).data.duplicate,true);
});

test('AI is full automatic, outputs only correct, does not receive the student ID and cannot score before reveal',()=>{
  const f=fixture();f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency:2},f.auth);
  const r=f.room('live'),p=join(f,r.code);f.start(r.code);submit(f,r.code,p);
  assert.equal(f.call('studentWorker',{room:r.code,roundId:f.admin().round.id},p.token).data.processed,true);
  assert.equal(f.state.aiCalls,1);assert.deepEqual(Object.keys(f.state.fetchBody.text.format.schema.properties),['correct']);assert.equal(JSON.stringify(f.state.fetchBody).includes('1410701'),false);assert.equal(f.state.fetchBody.store,false);
  assert.equal(f.call('room',{room:r.code}).data.players[0].correct,null);assert.equal(f.admin().usage.calls,1);
  f.call('worker',{room:r.code},f.auth);assert.equal(f.state.aiCalls,1);
});

test('service failure is not a wrong answer; retry repairs only unresolved work',()=>{
  const f=fixture();f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency:2},f.auth);const r=f.room('live'),p=join(f,r.code);f.start(r.code);submit(f,r.code,p);
  f.state.fetchHook=()=>({getResponseCode:()=>429,getContentText:()=> '{}'});f.call('worker',{room:r.code},f.auth);assert.equal(f.admin().players[0].judgeStatus,'error');assert.equal(f.admin().players[0].correct,null);
  f.state.fetchHook=null;f.call('retry',{room:r.code},f.auth);f.call('worker',{room:r.code},f.auth);assert.equal(f.admin().round.judged,1);f.call('retry',{room:r.code},f.auth);f.call('worker',{room:r.code},f.auth);assert.equal(f.state.aiCalls,2);
});

test('unknown handwriting gets two passes and stays unscored; deadlined rounds reject new answers',()=>{
  const f=fixture();f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency:2},f.auth);const r=f.room('live'),p=join(f,r.code),late=join(f,r.code,'1410702');f.start(r.code);submit(f,r.code,p);
  f.state.fetchHook=()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{content:[{type:'output_text',text:'{"correct":null}'}]}]})});f.call('worker',{room:r.code},f.auth);assert.equal(f.state.aiCalls,2);assert.equal(f.admin().players[0].judgeStatus,'uncertain');
  f.state.now+=35000;assert.equal(f.call('room',{room:r.code}).data.round.phase,'closed');assert.equal(submit(f,r.code,late).status,409);
  f.call('reveal',{room:r.code},f.auth);assert.equal(f.admin().players[0].correct,null);assert.equal(f.admin().players[0].score,0);
});

test('history is archived to Drive, scores carry to the next question, and settings never echo keys',()=>{
  const f=fixture(),r=f.room(),p=join(f,r.code);assert.equal(f.call('start',{room:r.code,draftId:'stale-preview',seconds:30},f.auth).status,409);f.start(r.code);submit(f,r.code,p);f.call('worker',{room:r.code},f.auth);f.call('close',{room:r.code},f.auth);f.call('reveal',{room:r.code},f.auth);f.start(r.code);
  assert.ok([...f.files.values()].some(file=>file.name==='round-1-results.json'));assert.equal(f.admin().players[0].score,10);assert.ok(f.call('export',{room:r.code},f.auth).data.csv.includes('1410701'));
  f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency:3},f.auth);assert.equal(JSON.stringify(f.call('adminState',{},f.auth)).includes('sk-test'),false);assert.equal(f.call('settings',{model:'x',concurrency:4},f.auth).status,400);
});

test('only the owning student may trigger their queued work and a new room cannot abandon the active round',()=>{
  const f=fixture(),r=f.room(),p=join(f,r.code);f.start(r.code);submit(f,r.code,p);assert.equal(f.call('studentWorker',{room:r.code,roundId:f.admin().round.id},'bad-token').status,401);assert.equal(f.call('createRoom',{mode:'practice'},f.auth).status,409);
});


test('only the exact 28 student IDs may join; adjacent ranges, aliases and malformed accounts are denied',()=>{
  const f=fixture(),r=f.room();
  for(const id of allowedIds)assert.equal(f.call('join',{room:r.code,studentId:id}).ok,true,id);
  assert.equal(f.admin().players.length,28);
  for(const id of ['1410700','1410716','1410728','1420701','1420715','1420729','141071','01410701','1410701x','１４１０７０１','',1410701,null]){
    const reply=f.call('join',{room:r.code,studentId:id});assert.equal(reply.status,403,String(id));
  }
  f.start(r.code);assert.equal(f.call('join',{room:r.code,studentId:'1420715'}).status,403);
  for(let n=1410600;n<=1420800;n++)assert.equal(f.context.allowedStudentId_(String(n)),allowedIds.includes(String(n)),String(n));
});

test('legacy tokens belonging to accounts outside the whitelist cannot restore, submit or trigger AI',()=>{
  const f=fixture(),r=f.room(),p=join(f,r.code);f.start(r.code);const roundId=f.admin().round.id;
  const file=f.files.get(f.properties.get('ROOM_'+r.code)),raw=JSON.parse(file.getBlob().getDataAsString());raw.players[0].studentId='9999999';file.setContent(JSON.stringify(raw));f.context.clearStoredRoom_(r.code);f.cache.delete('room:'+r.code);
  assert.equal(f.call('join',{room:r.code,token:p.token}).status,403);
  assert.equal(f.call('submit',{room:r.code,roundId,image},p.token).status,403);
  assert.equal(f.call('studentWorker',{room:r.code,roundId},p.token).status,403);
  assert.equal(f.state.aiCalls,0);
});


test('the complete GAS and Node banks produce the same valid answers for every blank position', async () => {
  const f = fixture();
  const { idiomBank, drawIdiomQuestion } = await import('../questions.mjs');
  const entries = JSON.parse(JSON.stringify(f.context.IDIOMS_));
  assert.deepEqual(entries, idiomBank);
  assert.equal(entries.length, 5554);
  let combinations = 0;
  for (const [index, { idiom }] of entries.entries()) {
    const chars = Array.from(idiom);
    const positions = chars.flatMap((char, position) => /\p{Script=Han}/u.test(char) ? [position] : []);
    for (const [choice, position] of positions.entries()) {
      const draws = [(index + 0.25) / entries.length, (choice + 0.25) / positions.length];
      let call = 0;
      const q = f.context.drawIdiomQuestion_(() => draws[call++]);
      const local = drawIdiomQuestion(() => draws[call++ - 2]);
      assert.equal(call, 4);
      assert.equal(q.idiom, idiom);
      assert.equal(q.blankIndex, position);
      assert.equal(q.answer, chars[position]);
      assert.equal(q.prompt, local.prompt);
      assert.equal((q.prompt.match(/□/g) || []).length, 1);
      assert.deepEqual(Array.from(q.accepted), local.accepted);
      for (const accepted of q.accepted) {
        assert.notEqual(accepted, q.answer);
        assert.equal(f.context.singleHan_(accepted), true);
      }
      combinations++;
    }
  }
  assert.equal(combinations, 22215);
});

test('a shared blank accepts the other valid idiom and hides answers until reveal', () => {
  const f = fixture(), r = f.room();
  join(f, r.code);
  const stored = f.context.readRoom_(r.code, true);
  stored.draft = { id: 'ambiguous', idiom: '萍水相逢', blankIndex: 3, answer: '逢', prompt: '「萍水相□」請填入缺少的一字。' };
  f.context.saveRoom_(stored);
  const response = f.call('start', { room: r.code, draftId: 'ambiguous', seconds: 30, accepted: ['逢'] }, f.auth);
  assert.equal(response.ok, true);
  assert.ok(response.data.room.round.accepted.includes('遇'));
  assert.ok(!response.data.room.round.accepted.includes('逢'));
  assert.equal(f.call('room', { room: r.code }).data.round.accepted, undefined);
  f.call('close', { room: r.code }, f.auth);
  f.call('reveal', { room: r.code }, f.auth);
  assert.ok(f.call('room', { room: r.code }).data.round.accepted.includes('遇'));
});

test('teacher draws privately; stale previews fail, client answers cannot replace the selected letter, and full idioms appear only after reveal',()=>{
  const f=fixture(),r=f.room(),p=join(f,r.code),original=r.draft;
  assert.ok(original.id);assert.equal(f.call('draw',{room:r.code}).status,401);
  const preview=f.call('draw',{room:r.code},f.auth).data.room.draft;assert.notEqual(preview.id,original.id);
  const before=f.call('room',{room:r.code}).data;assert.equal(before.draft,null);assert.equal(JSON.stringify(before).includes(preview.id),false);
  assert.equal(f.call('start',{room:r.code,draftId:original.id,seconds:30},f.auth).status,409);
  const started=f.call('start',{room:r.code,draftId:preview.id,seconds:30,prompt:'不要使用這個題目',answer:'假假'},f.auth);assert.equal(started.ok,true);
  assert.equal(started.data.room.round.answer,preview.answer);assert.equal(started.data.room.round.prompt,preview.prompt);assert.equal(started.data.room.round.idiom,preview.idiom);
  const secret=f.call('room',{room:r.code}).data;assert.equal(secret.round.answer,null);assert.equal(secret.round.idiom,null);assert.equal(secret.draft,null);
  assert.equal(f.call('draw',{room:r.code},f.auth).status,409);
  f.call('close',{room:r.code},f.auth);f.call('reveal',{room:r.code},f.auth);
  const done=f.call('room',{room:r.code}).data;assert.equal(done.round.idiom,preview.idiom);assert.equal(done.round.answer,preview.answer);assert.equal(done.draft,null);
  const next=f.admin().draft;assert.ok(next.id);assert.notEqual(next.id,preview.id);f.call('reveal',{room:r.code},f.auth);assert.equal(f.admin().draft.id,next.id);
});


test('ending a running exam cancels pending work without exposing answers or scoring; repeated end is harmless',()=>{
  const f=fixture(),r=f.room(),student=join(f,r.code);f.start(r.code);submit(f,r.code,student);
  assert.equal(f.call('endRoom',{room:r.code}).status,401);
  const ended=f.call('endRoom',{room:r.code},f.auth);assert.equal(ended.ok,true);assert.equal(ended.data.room.ended,true);assert.equal(ended.data.room.round.phase,'cancelled');
  assert.equal(ended.data.room.round.pending,0);assert.equal(ended.data.room.players[0].score,0);
  const revision=ended.data.room.revision;assert.equal(f.call('endRoom',{room:r.code},f.auth).data.room.revision,revision);
  assert.equal(f.call('room',{room:r.code}).data.round.answer,null);
  assert.equal(f.call('join',{room:r.code,token:student.token}).status,409);
  assert.equal(submit(f,r.code,student).status,409);assert.equal(f.call('start',{room:r.code},f.auth).status,409);
  assert.equal(f.call('worker',{room:r.code},f.auth).data.idle,true);assert.equal(f.state.aiCalls,0);
  const next=f.room();assert.notEqual(next.code,r.code);
});

test('a teacher must explicitly end the expected active room when replacing an unrevealed exam with AI',()=>{
  const f=fixture(),r=f.room(),student=join(f,r.code);f.start(r.code);submit(f,r.code,student);
  const settings=f.call('settings',{model:'gpt-4.1-mini',concurrency:2},f.auth);assert.equal(settings.data.configured,false);
  assert.equal(f.call('createRoom',{mode:'live',endCurrent:true,previousRoom:r.code},f.auth).status,400);assert.equal(f.admin().ended,false);
  f.properties.set('OPENAI_API_KEY','sk-example-not-a-real-key');
  assert.equal(f.call('createRoom',{mode:'live',previousRoom:r.code},f.auth).status,409);
  assert.equal(f.call('createRoom',{mode:'live',previousRoom:'FFFFFF',endCurrent:true},f.auth).status,409);assert.equal(f.admin().ended,false);
  const result=f.call('createRoom',{mode:'live',previousRoom:r.code,endCurrent:true,title:'AI 正式挑戰'},f.auth);
  assert.equal(result.ok,true);assert.equal(result.data.room.mode,'live');assert.equal(result.data.room.ended,false);
  assert.equal(result.data.room.players.length,0);assert.equal(f.call('room',{room:r.code}).data.ended,true);
  assert.equal(f.call('createRoom',{mode:'practice',previousRoom:r.code,endCurrent:true},f.auth).status,409);
  assert.equal(f.call('adminState',{},f.auth).data.features.roomManagement,true);
});

test('ending and deleting history preserves revealed scores and private Drive backups while revoking the old room',()=>{
  const f=fixture(),r=f.room(),student=join(f,r.code);f.start(r.code);submit(f,r.code,student);f.call('worker',{room:r.code},f.auth);f.call('close',{room:r.code},f.auth);f.call('reveal',{room:r.code},f.auth);
  const score=f.admin().players[0].score;f.call('endRoom',{room:r.code},f.auth);assert.equal(f.admin().players[0].score,score);assert.equal(f.admin().round.phase,'revealed');
  const next=f.room();assert.equal(f.call('listRooms').status,401);
  const listed=f.call('listRooms',{},f.auth).data;assert.equal(listed.rooms.length,2);assert.equal(listed.rooms.find(item=>item.code===r.code).ended,true);
  assert.equal(JSON.stringify(listed).includes(student.token),false);assert.equal(JSON.stringify(listed).includes('file-'),false);
  f.call('room',{room:r.code});const fileCount=f.files.size;
  assert.equal(f.call('deleteRoom',{room:r.code}).status,401);
  assert.equal(f.call('deleteRoom',{room:r.code},f.auth).data.backupKept,true);assert.equal(f.files.size,fileCount);
  assert.equal(f.properties.has('ROOM_'+r.code),false);assert.equal(f.properties.has('META_'+r.code),false);assert.equal(f.cache.has('room:'+r.code),false);
  assert.equal(f.call('room',{room:r.code}).status,404);assert.equal(f.call('join',{room:r.code,token:student.token}).status,404);
  assert.equal(f.call('deleteRoom',{room:r.code},f.auth).data.deleted,true);assert.equal(f.admin().code,next.code);
  f.call('deleteRoom',{room:next.code},f.auth);assert.equal(f.admin(),null);assert.equal(f.call('listRooms',{},f.auth).data.rooms.length,0);
});

test('ending during a Drive upload prevents its late completion from requeueing the cancelled submission',()=>{
  const f=fixture(),r=f.room(),student=join(f,r.code);f.start(r.code);
  f.state.createHook=()=>{assert.equal(f.call('endRoom',{room:r.code},f.auth).ok,true)};
  assert.equal(submit(f,r.code,student).status,409);const ended=f.admin();assert.equal(ended.ended,true);assert.equal(ended.round.pending,0);assert.equal(ended.players[0].judgeStatus,'cancelled');
  assert.equal(f.call('worker',{room:r.code},f.auth).data.idle,true);
});

test('deleting during an AI request drops its completion and prevents a second AI attempt',()=>{
  const f=fixture();f.properties.set('OPENAI_API_KEY','sk-example-not-a-real-key');const r=f.room('live'),student=join(f,r.code);f.start(r.code);submit(f,r.code,student);
  f.state.fetchHook=()=>{assert.equal(f.call('deleteRoom',{room:r.code},f.auth).ok,true);return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{content:[{type:'output_text',text:'{"correct":null}'}]}]})}};
  const result=f.call('worker',{room:r.code},f.auth);assert.equal(result.data.stale,true);assert.equal(f.state.aiCalls,1);assert.equal(f.admin(),null);assert.equal(f.properties.has('META_'+r.code),false);
});

test('history selection cannot abandon a live question; ended rooms stay closed when loaded',()=>{
  const f=fixture(),old=f.room();f.call('endRoom',{room:old.code},f.auth);const current=f.room(),student=join(f,current.code);f.start(current.code);
  assert.equal(f.call('selectRoom',{room:old.code},f.auth).status,409);assert.equal(f.admin().code,current.code);
  f.call('endRoom',{room:current.code},f.auth);const selected=f.call('selectRoom',{room:old.code},f.auth);assert.equal(selected.data.room.ended,true);assert.equal(f.admin().code,old.code);assert.equal(f.call('draw',{room:old.code},f.auth).status,409);
});


test('only a teacher can remove a student session; the same ID rejoins and stale removals cannot revoke a new session',()=>{
  const f=fixture(),r=f.room(),student=join(f,r.code);const removal={room:r.code,playerId:student.player.id,connectionVersion:0};
  assert.equal(f.call('removePlayer',removal).status,401);assert.equal(f.call('removePlayer',removal,student.token).status,401);
  assert.equal(f.call('removePlayer',{...removal,connectionVersion:undefined},f.auth).status,400);
  assert.equal(f.call('removePlayer',removal,f.auth).data.room.players.length,0);const revision=f.admin().revision;
  assert.equal(f.call('removePlayer',removal,f.auth).data.room.revision,revision);
  assert.equal(f.call('join',{room:r.code,token:student.token}).status,401);
  const rejoined=f.call('join',{room:r.code,studentId:'1410701'});assert.equal(rejoined.ok,true);assert.equal(rejoined.data.player.id,student.player.id);assert.notEqual(rejoined.data.token,student.token);
  assert.equal(f.admin().players[0].connectionVersion,2);assert.equal(f.call('removePlayer',removal,f.auth).status,409);assert.equal(f.admin().players.length,1);
  assert.equal(f.call('join',{room:r.code,studentId:'1410701'}).status,409);assert.equal(f.call('adminState',{},f.auth).data.features.playerManagement,true);
});

test('rejoining during a question preserves scores and locked answers while old credentials stay invalid',()=>{
  const f=fixture(),r=f.room(),student=join(f,r.code);f.start(r.code);submit(f,r.code,student);f.call('worker',{room:r.code},f.auth);f.call('close',{room:r.code},f.auth);f.call('reveal',{room:r.code},f.auth);assert.equal(f.admin().players[0].score,10);
  f.start(r.code);submit(f,r.code,student);
  f.call('removePlayer',{room:r.code,playerId:student.player.id,connectionVersion:0},f.auth);
  assert.equal(f.call('join',{room:r.code,studentId:'1410702'}).status,409);
  assert.equal(submit(f,r.code,student).status,401);assert.equal(f.call('studentWorker',{room:r.code,roundId:f.admin().round.id},student.token).status,401);
  const fresh=join(f,r.code);assert.equal(fresh.player.id,student.player.id);assert.equal(f.admin().players[0].score,10);assert.equal(f.admin().players[0].submitted,true);
  assert.equal(submit(f,r.code,fresh).data.duplicate,true);assert.equal([...f.files.values()].filter(file=>file.name.endsWith('.png')).length,2);
  f.call('worker',{room:r.code},f.auth);f.call('close',{room:r.code},f.auth);f.call('reveal',{room:r.code},f.auth);assert.equal(f.admin().players[0].score,20);
});

test('a removed in-flight upload cannot lock or overwrite the rejoined students answer',()=>{
  const f=fixture(),r=f.room(),student=join(f,r.code);f.start(r.code);let fresh;
  f.state.createHook=()=>{assert.equal(f.call('removePlayer',{room:r.code,playerId:student.player.id,connectionVersion:0},f.auth).ok,true);fresh=join(f,r.code)};
  assert.equal(submit(f,r.code,student).status,409);assert.equal(f.admin().players[0].submitted,false);f.state.createHook=null;
  assert.equal(submit(f,r.code,fresh).ok,true);assert.equal(f.admin().round.submitted,1);
});

test('an accepted submission continues judging across a device reset without losing the result',()=>{
  const f=fixture();f.properties.set('OPENAI_API_KEY','sk-example-not-a-real-key');const r=f.room('live'),student=join(f,r.code);f.start(r.code);submit(f,r.code,student);let fresh;
  f.state.fetchHook=()=>{f.call('removePlayer',{room:r.code,playerId:student.player.id,connectionVersion:0},f.auth);fresh=join(f,r.code);return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{content:[{type:'output_text',text:'{"correct":true}'}]}]})}};
  assert.equal(f.call('worker',{room:r.code},f.auth).data.processed,true);assert.equal(f.admin().players[0].judgeStatus,'done');assert.equal(f.state.aiCalls,1);assert.equal(f.call('join',{room:r.code,token:fresh.token}).ok,true);
});


test('lost join responses can be recovered with the same private device secret even after the question starts',()=>{
  const f=fixture(),r=f.room(),key='a'.repeat(64);
  const first=f.call('join',{room:r.code,studentId:'1410701',joinKey:key});assert.equal(first.ok,true);f.start(r.code);
  const recovered=f.call('join',{room:r.code,studentId:'1410701',joinKey:key});assert.equal(recovered.data.token,first.data.token);assert.equal(recovered.data.player.id,first.data.player.id);assert.equal(f.admin().players.length,1);
  assert.equal(f.call('join',{room:r.code,studentId:'1410701',joinKey:'b'.repeat(64)}).status,409);assert.equal(f.call('join',{room:r.code,studentId:'1410701',joinKey:'bad'}).status,400);
  const snapshot=JSON.stringify(f.call('room',{room:r.code}).data);assert.equal(snapshot.includes(key),false);assert.equal(snapshot.includes(first.data.token),false);assert.equal(snapshot.includes('joinKeyHash'),false);
  assert.equal(f.call('adminState',{},f.auth).data.features.directStudent,true);
});

test('removing a device revokes its recovery secret; a new explicit join key can reconnect',()=>{
  const f=fixture(),r=f.room(),key='a'.repeat(64),first=f.call('join',{room:r.code,studentId:'1410701',joinKey:key}).data;
  f.call('removePlayer',{room:r.code,playerId:first.player.id,connectionVersion:0},f.auth);
  assert.equal(f.call('join',{room:r.code,studentId:'1410701',joinKey:key}).status,401);
  const fresh=f.call('join',{room:r.code,studentId:'1410701',joinKey:'b'.repeat(64)});assert.equal(fresh.ok,true);assert.notEqual(fresh.data.token,first.token);
  assert.equal(f.call('join',{room:r.code,studentId:'1410701',joinKey:key}).status,409);
});

test('the direct student route serves only the public room bootstrap and validates room input',()=>{
  const f=fixture();let template;f.context.HtmlService={createTemplateFromFile:name=>{template={name,boot:null,evaluate(){return{template:this.name,boot:this.boot,meta:{},setTitle(){return this},addMetaTag(name,content){this.meta[name]=content;return this}}}};return template}};
  const output=f.context.doGet({parameter:{view:'student',room:'abcdef'}});assert.equal(output.template,'Student');assert.equal(output.meta.viewport,'width=device-width, initial-scale=1, viewport-fit=cover');assert.equal(JSON.parse(output.boot).room,'ABCDEF');assert.deepEqual(Object.keys(JSON.parse(output.boot)),['room','version']);
  assert.throws(()=>f.context.doGet({parameter:{view:'student',room:'<script>'}}));
});


test('all participants must finish saving images before the timer closes early; results remain concealed until reveal',()=>{
  const f=fixture(),r=f.room(),first=join(f,r.code),last=join(f,r.code,'1410702');f.start(r.code);submit(f,r.code,first);assert.equal(f.admin().round.phase,'writing');
  f.state.createHook=()=>{assert.equal(f.admin().round.phase,'writing');assert.equal(f.admin().round.submitted,1);};submit(f,r.code,last);
  const room=f.admin();assert.equal(room.round.phase,'closed');assert.equal(room.round.closeReason,'all-submitted');assert.ok(room.round.deadline>f.state.now);assert.equal(room.round.pending,2);
  const shown=f.call('room',{room:r.code}).data;assert.equal(shown.round.answer,null);assert.ok(shown.players.every(p=>p.correct===null&&p.score===0));assert.equal(f.call('reveal',{room:r.code},f.auth).status,409);
});

test('a failed final upload does not close early; a successful retry does',()=>{
  const f=fixture(),r=f.room(),first=join(f,r.code),last=join(f,r.code,'1410702');f.start(r.code);submit(f,r.code,first);
  f.state.createHook=()=>{throw Error('Drive write interrupted')};assert.equal(submit(f,r.code,last).status,503);assert.equal(f.admin().round.phase,'writing');
  f.state.createHook=null;assert.equal(submit(f,r.code,last).ok,true);assert.equal(f.admin().round.phase,'closed');
});

test('an empty active roster never counts as all submitted; removing the only missing participant closes a nonempty roster',()=>{
  const f=fixture(),r=f.room(),first=join(f,r.code);f.start(r.code);f.call('removePlayer',{room:r.code,playerId:first.player.id,connectionVersion:0},f.auth);assert.equal(f.admin().round.phase,'writing');
  f.call('endRoom',{room:r.code},f.auth);const next=f.room(),a=join(f,next.code),b=join(f,next.code,'1410702');f.start(next.code);submit(f,next.code,a);
  f.call('removePlayer',{room:next.code,playerId:b.player.id,connectionVersion:0},f.auth);assert.equal(f.admin().round.phase,'closed');assert.equal(f.admin().round.closeReason,'all-submitted');
});


test('30 seconds stops writing; a 5-second grace accepts delayed requests without exposing images or allowing reveal',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code),b=join(f,r.code,'1410702'),c=join(f,r.code,'1410703');f.start(r.code);const round=f.admin().round;assert.equal(round.submissionDeadline-round.deadline,5000);
 f.state.now=round.deadline;assert.equal(f.call('room',{room:r.code}).data.round.phase,'collecting');assert.equal(submit(f,r.code,a).ok,true);
 let snapshot=f.call('room',{room:r.code}).data;assert.equal(snapshot.players[0].imageUrl,null);assert.equal(snapshot.players[0].correct,null);assert.equal(f.call('images',{room:r.code,roundId:round.id}).status,403);
 f.call('worker',{room:r.code},f.auth);assert.equal(f.call('reveal',{room:r.code},f.auth).status,409);
 f.state.now=round.submissionDeadline-1;assert.equal(submit(f,r.code,b).ok,true);assert.equal(f.admin().round.phase,'collecting');
 f.state.now=round.submissionDeadline;assert.equal(submit(f,r.code,c).status,409);snapshot=f.call('room',{room:r.code}).data;assert.equal(snapshot.round.phase,'closed');assert.equal(snapshot.round.submitted,2);assert.ok(snapshot.players[0].imageUrl);assert.equal(snapshot.round.answer,null);
});

test('an accepted image may finish saving after the grace deadline without becoming a missing submission',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code),b=join(f,r.code,'1410702');f.start(r.code);const round=f.admin().round;
 f.state.now=round.submissionDeadline-1;f.state.createHook=()=>{f.state.now=round.submissionDeadline+1000;};assert.equal(submit(f,r.code,a).ok,true);assert.equal(f.admin().players[0].submitted,true);assert.equal(submit(f,r.code,b).status,409);
});

test('manual close ends grace immediately, and saved submissions still support idempotent retries',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code),b=join(f,r.code,'1410702');f.start(r.code);submit(f,r.code,a);f.state.now=f.admin().round.deadline;assert.equal(f.admin().round.phase,'collecting');
 assert.equal(f.call('close',{room:r.code},f.auth).ok,true);assert.equal(submit(f,r.code,b).status,409);assert.equal(submit(f,r.code,a).data.duplicate,true);
});

test('old rounds without a grace deadline keep their original deadline',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code);f.start(r.code);const room=f.context.readRoom_(r.code,true);delete room.round.submissionDeadline;f.context.saveRoom_(room);f.state.now=room.round.deadline;assert.equal(submit(f,r.code,a).status,409);
});


test('image requests read only the requested saved files and reuse per-image cache without exposing writing answers',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code),b=join(f,r.code,'1410702');f.start(r.code);submit(f,r.code,a);const round=f.admin().round;
 assert.equal(f.call('images',{room:r.code,roundId:round.id,playerIds:[a.player.id]}).status,403);submit(f,r.code,b);const before=f.state.imageReads;
 let result=f.call('images',{room:r.code,roundId:round.id,playerIds:[a.player.id]});assert.deepEqual(Object.keys(result.data),[a.player.id]);assert.equal(f.state.imageReads,before+1);
 result=f.call('images',{room:r.code,roundId:round.id,playerIds:[a.player.id,b.player.id]});assert.equal(Object.keys(result.data).length,2);assert.equal(f.state.imageReads,before+2);
 assert.equal(Object.keys(f.call('images',{room:r.code,roundId:round.id}).data).length,2);assert.equal(f.state.imageReads,before+2);
 assert.equal(f.call('images',{room:r.code,roundId:round.id,playerIds:'bad'}).status,400);
});

test('submission and worker saves keep durable state while unchanged room summaries avoid redundant property writes',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code);join(f,r.code,'1410702');f.start(r.code);const before=f.state.metadataWrites;
 submit(f,r.code,a);f.call('worker',{room:r.code,roundId:f.admin().round.id},f.auth);assert.equal(f.state.metadataWrites,before);assert.equal(f.admin().players[0].judgeStatus,'done');
 f.cache.delete('meta:'+r.code);const room=f.context.readRoom_(r.code,true);f.context.saveRoom_(room);assert.equal(f.state.metadataWrites,before+1);
 f.call('endRoom',{room:r.code},f.auth);assert.equal(f.state.metadataWrites,before+2);f.call('deleteRoom',{room:r.code},f.auth);assert.equal(f.cache.has('meta:'+r.code),false);assert.equal(f.properties.has('META_'+r.code),false);
});

test('workers report remaining queue length and reject a stale round without taking another job',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code),b=join(f,r.code,'1410702');f.start(r.code);submit(f,r.code,a);submit(f,r.code,b);const round=f.admin().round;
 assert.equal(f.call('worker',{room:r.code,roundId:'old-round'},f.auth).data.idle,true);assert.equal(f.admin().round.judged,0);
 assert.equal(f.call('worker',{room:r.code,roundId:round.id},f.auth).data.remainingQueued,1);assert.equal(f.call('worker',{room:r.code,roundId:round.id},f.auth).data.remainingQueued,0);
});

test('server timing distinguishes save, queue and AI durations and is available only in teacher snapshots',()=>{
 const f=fixture();f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency:2},f.auth);const r=f.room('live'),a=join(f,r.code);f.start(r.code);
 f.state.createHook=()=>{f.state.now+=40;};submit(f,r.code,a);f.state.now+=60;
 f.state.fetchHook=()=>{f.state.now+=80;return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{content:[{type:'output_text',text:'{"correct":true}'}]}]})}};
 const settingsReads=f.state.settingsReads;f.call('worker',{room:r.code,roundId:f.admin().round.id},f.auth);assert.equal(f.state.settingsReads,settingsReads+2); // admin snapshot + one worker settings read
 const perf=f.admin().round.performance;assert.equal(perf.saveMs.average,40);assert.equal(perf.queueMs.average,60);assert.equal(perf.aiMs.average,80);assert.equal(perf.totalMs.average,180);
 const publicState=JSON.stringify(f.call('room',{room:r.code}).data);assert.equal(publicState.includes('performance'),false);assert.equal(publicState.includes('timing'),false);
});


function startSeries(f,code,totalQuestions=3,revealSeconds=8){const draft=f.admin().draft;return f.call('start-series',{room:code,draftId:draft.id,seconds:30,totalQuestions,revealSeconds},f.auth);}

test('automatic series reveals once, waits, advances without repeating idioms, and finishes at the requested total',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code);let current=startSeries(f,r.code,3).data.room;const seen=[];
 for(let number=1;number<=3;number++){
  assert.equal(current.round.number,number);assert.equal(current.round.phase,'writing');seen.push(current.round.idiom);assert.equal(submit(f,r.code,a).ok,true);f.call('worker',{room:r.code,roundId:current.round.id},f.auth);
  current=f.admin();assert.equal(current.round.phase,'revealed');assert.equal(current.players[0].score,number*10);const nextAt=current.automation.nextAt;
  assert.equal(f.admin().players[0].score,number*10);f.state.now=nextAt-1;assert.equal(f.admin().round.number,number);f.state.now=nextAt;current=f.admin();
 }
 assert.equal(new Set(seen).size,3);assert.equal(current.automation.status,'completed');assert.equal(current.ended,true);assert.equal(current.round.phase,'revealed');assert.equal(current.players[0].score,30);assert.equal(current.round.number,3);assert.equal(f.admin().players[0].score,30);assert.equal(current.draft,null);
});

test('automatic timeouts keep the five-second grace and advance missing submissions without inventing scores',()=>{
 const f=fixture(),r=f.room();join(f,r.code);const first=startSeries(f,r.code,2).data.room;
 f.state.now=first.round.deadline;assert.equal(f.admin().round.phase,'collecting');f.state.now=first.round.submissionDeadline-1;assert.equal(f.admin().round.phase,'collecting');f.state.now++;
 const shown=f.admin();assert.equal(shown.round.phase,'revealed');assert.equal(shown.round.submitted,0);assert.equal(shown.players[0].score,0);f.state.now=shown.automation.nextAt;assert.equal(f.admin().round.number,2);
});

test('only authenticated teacher polls drive automatic transitions; stale polls and duplicate starts cannot double-score or double-start',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code),draft=f.admin().draft;const data={room:r.code,draftId:draft.id,seconds:30,totalQuestions:2,revealSeconds:8};assert.equal(f.call('start-series',data).status,401);assert.equal(f.call('start-series',data,f.auth).ok,true);assert.equal(f.call('start-series',data,f.auth).data.room.round.number,1);
 submit(f,r.code,a);const round=f.context.readRoom_(r.code,true).round;f.call('worker',{room:r.code,roundId:round.id},f.auth);const stale=f.context.readRoom_(r.code,true);assert.equal(f.call('room',{room:r.code}).data.round.phase,'closed');assert.equal(f.call('adminState').status,401);
 f.context.autoAdvance_(r.code,stale);f.context.autoAdvance_(r.code,stale);assert.equal(f.admin().players[0].score,10);const revealed=f.context.readRoom_(r.code,true);f.state.now=revealed.automation.nextAt;
 f.context.autoAdvance_(r.code,revealed);f.context.autoAdvance_(r.code,revealed);assert.equal(f.admin().round.number,2);assert.equal(f.call('start-series',data,f.auth).data.room.round.number,2);assert.equal(f.call('start-series',{...data,totalQuestions:3},f.auth).status,409);
 assert.equal(f.call('draw',{room:r.code},f.auth).status,409);assert.equal(f.call('start',{room:r.code,draftId:'stale',seconds:30},f.auth).status,409);
});

test('teacher pause stops automatic reveal and next question; resuming gives a full display interval',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code);startSeries(f,r.code,2);f.call('pause-series',{room:r.code},f.auth);submit(f,r.code,a);f.call('worker',{room:r.code},f.auth);
 assert.equal(f.admin().round.phase,'closed');assert.equal(f.admin().automation.pauseReason,'teacher');f.call('resume-series',{room:r.code},f.auth);let shown=f.admin();assert.equal(shown.round.phase,'revealed');f.call('pause-series',{room:r.code},f.auth);f.state.now+=20000;assert.equal(f.admin().round.number,1);
 f.call('resume-series',{room:r.code},f.auth);shown=f.admin();assert.equal(shown.automation.nextAt,f.state.now+8000);f.state.now=shown.automation.nextAt;assert.equal(f.admin().round.number,2);
});

test('service failures pause for recovery; uncertain handwriting remains unscored and can progress',()=>{
 for(const uncertain of [false,true]){const f=fixture();f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency:2},f.auth);const r=f.room('live'),a=join(f,r.code);startSeries(f,r.code,1);submit(f,r.code,a);
  f.state.fetchHook=()=>({getResponseCode:()=>uncertain?200:503,getContentText:()=>JSON.stringify({output:[{content:[{type:'output_text',text:'{"correct":null}'}]}]})});f.call('worker',{room:r.code},f.auth);let current=f.admin();
  if(uncertain){assert.equal(current.round.phase,'revealed');assert.equal(current.automation.status,'running');assert.equal(current.players[0].score,0);}
  else {assert.equal(current.round.phase,'closed');assert.equal(current.automation.status,'paused');assert.equal(current.automation.pauseReason,'judging');f.state.fetchHook=null;f.call('retry',{room:r.code},f.auth);f.call('worker',{room:r.code},f.auth);current=f.admin();assert.equal(current.round.phase,'revealed');assert.equal(current.players[0].score,10);}
 }
});

test('failed uploads pause automatic progression and the same image can recover without duplicate scoring',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code);startSeries(f,r.code,1);f.state.createHook=()=>{throw Error('failed')};assert.equal(submit(f,r.code,a).status,503);f.state.now+=35000;assert.equal(f.admin().automation.status,'paused');f.state.createHook=null;assert.equal(submit(f,r.code,a).ok,true);assert.equal(f.admin().automation.status,'running');f.call('worker',{room:r.code},f.auth);assert.equal(f.admin().players[0].score,10);
});

test('a maximum-length series completes 148 different idioms; invalid totals are rejected',()=>{
 const f=fixture(),r=f.room();join(f,r.code);const draft=f.admin().draft;for(const total of [0,149,1.5,'2'])assert.equal(f.call('start-series',{room:r.code,draftId:draft.id,seconds:30,totalQuestions:total,revealSeconds:8},f.auth).status,400);
 let current=startSeries(f,r.code,148).data.room;const seen=new Set();for(let number=1;number<=148;number++){assert.equal(current.round.number,number);assert.ok(!seen.has(current.round.idiom));seen.add(current.round.idiom);f.state.now=current.round.submissionDeadline;current=f.admin();assert.equal(current.round.phase,'revealed');f.state.now=current.automation.nextAt;current=f.admin();}
 assert.equal(seen.size,148);assert.equal(current.automation.status,'completed');assert.equal(current.roundCount,148);assert.equal(current.draft,null);
});

test('manual rounds also avoid repeated idioms and legacy history is migrated before another draw',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code);const seen=[];
 for(let n=0;n<2;n++){f.start(r.code);seen.push(f.admin().round.idiom);submit(f,r.code,a);f.call('worker',{room:r.code},f.auth);f.call('reveal',{room:r.code},f.auth);}
 const room=f.context.readRoom_(r.code,true);delete room.usedIdioms;f.context.saveRoom_(room);f.call('draw',{room:r.code},f.auth);const next=f.admin();assert.ok(!seen.includes(next.draft.idiom));assert.equal(f.context.readRoom_(r.code,true).usedIdioms.length,2);assert.equal(JSON.stringify(f.call('room',{room:r.code}).data).includes('usedIdioms'),false);
});

test('active automatic series cannot be abandoned during result display; ending prevents later work',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code);startSeries(f,r.code,2);submit(f,r.code,a);f.call('worker',{room:r.code},f.auth);const current=f.admin();assert.equal(current.round.phase,'revealed');
 assert.equal(f.call('createRoom',{mode:'practice'},f.auth).status,409);f.call('endRoom',{room:r.code},f.auth);f.state.now+=60000;const ended=f.admin();assert.equal(ended.round.number,1);assert.equal(ended.automation.status,'stopped');assert.equal(ended.players[0].score,10);assert.equal(ended.ended,true);
});


test('automatic public snapshots never reveal the next idiom, used list or private start preview ID',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code);const started=startSeries(f,r.code,2).data.room,privateRoom=f.context.readRoom_(r.code,true),publicState=f.call('room',{room:r.code}).data;
 assert.equal(publicState.round.answer,null);assert.equal(publicState.round.idiom,null);assert.equal(publicState.draft,null);const text=JSON.stringify(publicState);assert.equal(text.includes('usedIdioms'),false);assert.equal(text.includes(privateRoom.automation.startDraftId),false);
 submit(f,r.code,a);f.call('worker',{room:r.code},f.auth);f.admin();const raw=f.context.readRoom_(r.code,true),shown=f.call('room',{room:r.code}).data;assert.equal(shown.draft,null);assert.equal(JSON.stringify(shown).includes(raw.draft.idiom),false);assert.equal(started.automation.totalQuestions,2);
});


test('only teachers can persist room display columns, with a fixed page size and no quiz or score changes',()=>{
 const f=fixture(),r=f.room(),a=join(f,r.code);assert.equal(f.call('room',{room:r.code}).data.display.columns,6);assert.equal(f.call('display',{room:r.code,columns:8}).status,401);assert.equal(f.call('display',{room:r.code,columns:8},a.token).status,401);
 for(const columns of [2,9,1.5,'6',null])assert.equal(f.call('display',{room:r.code,columns},f.auth).status,400);
 f.start(r.code);const before=f.admin(),response=f.call('display',{room:r.code,columns:8,pageSize:99},f.auth);assert.equal(response.ok,true);const after=f.admin();assert.deepEqual(after.display,{columns:8,pageSize:24});assert.equal(after.round.id,before.round.id);assert.equal(after.round.deadline,before.round.deadline);assert.equal(after.players[0].score,before.players[0].score);assert.equal(f.context.readRoom_(r.code,true).display.columns,8);assert.equal(f.call('room',{room:r.code}).data.display.columns,8);
 const revision=after.revision;f.call('display',{room:r.code,columns:8},f.auth);assert.equal(f.admin().revision,revision);f.call('endRoom',{room:r.code},f.auth);assert.equal(f.call('display',{room:r.code,columns:4},f.auth).data.room.ended,true);
});

test('a PNG created before a lost Drive response is recovered by exact bytes instead of creating a second copy',()=>{
 const f=fixture(),r=f.room(),p=join(f,r.code);f.start(r.code);f.state.createHook=()=>{assert.equal(f.state.locked,false);throw Error('Drive response lost after create');};assert.equal(submit(f,r.code,p).status,503);assert.equal([...f.files.values()].filter(file=>file.name.endsWith('.png')).length,1);f.state.createHook=null;assert.equal(submit(f,r.code,p).ok,true);assert.equal([...f.files.values()].filter(file=>file.name.endsWith('.png')).length,1);assert.equal(f.admin().round.submitted,1);
});

test('a request received before the server grace deadline may wait for a lock; genuinely late requests and teacher-closed rounds remain rejected',()=>{
 const f=fixture(),r=f.room(),p=join(f,r.code),late=join(f,r.code,'1410702');f.start(r.code);f.state.now+=34000;f.state.lockDelay=8000;assert.equal(submit(f,r.code,p).ok,true);assert.equal(submit(f,r.code,late).status,409);
 const g=fixture(),room=g.room(),student=join(g,room.code);g.start(room.code);g.call('close',{room:room.code},g.auth);assert.equal(submit(g,room.code,student).status,409);
});
