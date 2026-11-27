import {webcrypto} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Small DOM fixtures validate controller transitions without claiming browser/layout QA.
import {pageFixture} from './helpers/frontend-fixture.mjs';

const player={id:'p1',studentId:'1410701',name:'測試同學',score:0,submitted:false,status:'waiting',correct:null,imageUrl:null};
const state=()=>({code:'ABCDEF',title:'單字測試',mode:'practice',points:10,serverTime:Date.now(),players:[{...player}],round:null});

test('student enters a string student ID, writes, submits once, locks and receives a verdict without explanations',async()=>{
  let room=state();
  const f=await pageFixture('play',async(url,opts)=>{
    if(url==='/api/join'){const data=JSON.parse(opts.body);assert.equal(data.studentId,'1410701');return{status:201,body:{player:{...player},token:'test-token'}};}
    if(url==='/api/submit'){room.players[0].submitted=true;room.players[0].status='submitted';return{status:201,body:{ok:true}};}
    if(url.startsWith('/api/room'))return{status:200,body:room};
    throw new Error('Unexpected route '+url);
  });
  f.get('join-code').value='ABCDEF';f.get('join-student-id').value='1410701';
  await f.get('join-form').onsubmit({preventDefault(){}});assert.equal(f.get('writing-panel').hidden,false);assert.ok(f.historyEntries[0].includes('/oneword/student.html?room=ABCDEF'));f.events[0].send(room);
  room.round={id:'r1',number:1,prompt:'寫一個字',phase:'writing',deadline:Date.now()+30000,seconds:30,submitted:0};f.events[0].send(room);
  assert.equal(f.get('submit-button').disabled,false);assert.ok(f.get('player-identity').textContent.includes('1410701'));
  const canvas=f.get('handwriting');canvas.events.pointerdown({pointerType:'pen',pointerId:1,clientX:30,clientY:30,preventDefault(){}});canvas.events.pointerup({pointerId:1});
  await f.get('submit-button').onclick();assert.equal(f.get('submit-button').disabled,true);assert.equal(f.get('canvas-lock').hidden,false);
  await f.get('submit-button').onclick();assert.equal(f.calls.filter(c=>c.url==='/api/submit').length,1);
  room.round.phase='revealed';room.players[0].status='done';room.players[0].correct=true;f.events[0].send(room);
  assert.equal(f.get('own-result').hidden,false);assert.ok(f.get('own-result').textContent.includes('✓'));assert.equal(f.get('play-practice').hidden,false);
  assert.equal(f.document.body.dataset.verdict,'correct');assert.ok(f.get('own-result').className.includes('result-enter'));f.events[0].send(room);assert.ok(!f.get('own-result').className.includes('result-enter'));
  room.round={...room.round,id:'r2',phase:'writing'};f.events[0].send(room);assert.equal(f.document.body.dataset.verdict,'');room.round.phase='revealed';room.players[0].correct=false;f.events[0].send(room);assert.equal(f.document.body.dataset.verdict,'wrong');assert.equal(f.get('lock-symbol').textContent,'✗');
  room.players[0].status='uncertain';room.players[0].correct=null;f.events[0].send(room);assert.equal(f.document.body.dataset.verdict,'');
});

for(const native of [false,true])test((native?'native':'static')+' saving an answer only confirms delivery and leaves grading to the teacher queue',async()=>{
 const room=state();room.round={id:'r1',number:1,prompt:'寫一個字',phase:'writing',deadline:Date.now()+30000};const workerCalls=[];
 const f=await pageFixture('play',async(url)=>url==='/api/join'?{status:200,body:{player:{...player},token:'student-token'}}:url==='/api/submit'?{status:200,body:{ok:true}}:{status:200,body:room},{native,workerRun:async(...args)=>{workerCalls.push(args);return{idle:true};}});
 f.get('join-student-id').value='1410701';await f.get('join-form').onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));if(!native)f.events[0].send(room);
 const canvas=f.get('handwriting');canvas.events.pointerdown({pointerType:'pen',pointerId:1,clientX:30,clientY:30,preventDefault(){}});canvas.events.pointerup({pointerId:1});
 await f.get('submit-button').onclick();assert.equal(f.get('submit-button').disabled,true);assert.equal(f.calls.filter(c=>c.url==='/api/submit').length,1);assert.equal(workerCalls.length,0);assert.equal(f.nativeCalls.filter(c=>c.action==='studentWorker').length,0);
});

test('teacher controller loads, hides auth form, displays string IDs and keeps correct answers out of candidate statuses',async()=>{
  const room=state();room.usage={input:0,output:0,calls:0};room.draft={id:'draft1',idiom:'金蘭之交',blankIndex:0,prompt:'「□蘭之交」請填入缺少的一字。',answer:'金'};room.players[0].judgeStatus='waiting';
  const f=await pageFixture('teacher',async()=>({status:200,body:{settings:{configured:false,model:'gpt-4.1-mini',concurrency:3},addresses:['http://192.168.1.2:4178'],idiomCount:148,room}}));
  assert.equal(f.get('login-panel').hidden,true);assert.equal(f.get('teacher-app').hidden,false);assert.equal(f.get('answer').value,'金');assert.ok(f.get('teacher-players').innerHTML.includes('1410701'));assert.ok(f.get('join-url').value.includes('/student.html?room=ABCDEF'));assert.equal(f.get('practice-banner').hidden,false);
});

test('screen controller conceals handwriting and verdicts while writing, then displays independent images and boolean results',async()=>{
  const f=await pageFixture('screen',async()=>{throw new Error('No fetch needed')});const room=state();
  room.round={id:'r1',number:1,prompt:'請寫一字',phase:'writing',deadline:Date.now()+30000,seconds:30,submitted:1};room.players[0].submitted=true;room.players[0].status='submitted';f.events[0].send(room);
  assert.ok(!f.get('screen-grid').innerHTML.includes('<img'));assert.ok(f.get('screen-grid').innerHTML.includes('答案保密'));
  room.round.phase='closed';room.players[0].imageUrl='/api/image/ABCDEF/r1/p1';f.events[0].send(room);
  assert.ok(f.get('screen-grid').innerHTML.includes('<img'));assert.ok(f.get('screen-grid').innerHTML.includes('等待揭曉'));
  room.round.phase='revealed';room.round.answer='冶';room.players[0].correct=false;room.players[0].status='done';f.events[0].send(room);
  assert.ok(f.get('screen-grid').innerHTML.includes('✗'));assert.ok(f.get('screen-grid').innerHTML.includes('1410701'));assert.ok(f.get('screen-subtitle').textContent.includes('冶'));
  assert.ok(f.get('screen-grid').innerHTML.includes('wrong result-enter'));f.get('ranking-toggle').onclick();assert.ok(!f.get('screen-grid').innerHTML.includes('result-enter'));
  room.round.id='r2';room.players[0].correct=true;f.events[0].send(room);assert.ok(f.get('screen-grid').innerHTML.includes('correct result-enter'));
  room.players[0].status='uncertain';room.players[0].correct=null;f.events[0].send(room);assert.ok(!f.get('screen-grid').innerHTML.includes('correct result-enter'));assert.ok(!f.get('screen-grid').innerHTML.includes('wrong result-enter'));
});


test('student page rejects an unlisted ID before making a backend request',async()=>{
  const f=await pageFixture('play',async()=>{throw new Error('Unexpected backend request');});
  f.get('join-code').value='ABCDEF';f.get('join-student-id').value='1410716';
  await f.get('join-form').onsubmit({preventDefault(){}});
  assert.equal(f.calls.length,0);assert.ok(f.get('join-error').textContent.includes('不在允許名單'));
});


test('teacher random-draw button refreshes the preview; starting sends only the draft ID and timing rules',async()=>{
  const room=state();room.usage={input:0,output:0,calls:0};room.draft={id:'draft1',idiom:'金蘭之交',blankIndex:0,prompt:'「□蘭之交」請填入缺少的一字。',answer:'金'};room.players[0].judgeStatus='waiting';
  const f=await pageFixture('teacher',async(url,options)=>{
    if(url.endsWith('/draw')){room.draft={id:'draft2',idiom:'金蘭之交',blankIndex:3,prompt:'「金蘭之□」請填入缺少的一字。',answer:'交'};return {status:200,body:{room}};}
    if(url.endsWith('/start')){const payload=JSON.parse(options.body);assert.equal(payload.draftId,'draft2');assert.equal('prompt' in payload,false);assert.equal('answer' in payload,false);return {status:200,body:{room}};}
    return {status:200,body:{settings:{configured:false,model:'gpt-4.1-mini',concurrency:2},addresses:['http://192.168.1.2:4178'],idiomCount:148,room}};
  });
  await f.get('draw-button').onclick();assert.equal(f.get('answer').value,'交');assert.ok(f.get('question-prompt').value.includes('金蘭之□'));
  f.get('answer').value='錯';f.get('question-prompt').value='改寫題目';f.get('seconds').value='30';await f.get('question-form').onsubmit({preventDefault(){}});
  assert.equal(f.calls.filter(c=>c.url.endsWith('/start')).length,1);
});


test('homepage uses the configured backend immediately and collapses optional connection settings',async()=>{
  const f=await pageFixture('home',async()=>{throw new Error('No request required for default configuration')});
  assert.equal(f.get('backend-details').open,false);
  assert.equal(f.get('backend-url').value,'https://script.google.com/macros/s/TEST/exec');
  assert.ok(f.get('backend-description').textContent.includes('不需重新貼上網址'));
  assert.equal(f.calls.length,0);
  assert.ok(f.entryLinks.some(link=>link.href==='https://script.google.com/macros/s/TEST/exec?view=student'));
  assert.ok(f.entryLinks.some(link=>link.href.startsWith('https://school.github.io/repo/oneword/teacher.html')));
});


test('applying existing GAS AI settings leaves practice mode explicit; the direct action creates a new live room',async()=>{
  let room=state();room.usage={calls:0,input:0,output:0};
  const settings={configured:true,model:'gpt-4.1-mini',concurrency:2};
  const f=await pageFixture('teacher',async(url,options)=>{
    if(url==='/api/admin/settings'){const data=JSON.parse(options.body);assert.equal(data.key,'');return{status:200,body:{configured:true}};}
    if(url==='/api/admin/rooms'){const data=JSON.parse(options.body);assert.equal(data.mode,'live');room={...room,code:'FEDCBA',mode:'live'};return{status:201,body:{room}};}
    return{status:200,body:{settings,addresses:[],idiomCount:148,room}};
  });
  assert.ok(f.get('ai-ready-status').textContent.includes('後端已設定'));
  assert.ok(f.get('room-mode').textContent.includes('流程演練'));
  f.get('settings-button').onclick();f.get('api-key').value='';
  await f.get('settings-form').onsubmit({preventDefault(){}});
  assert.equal(room.mode,'practice');assert.ok(f.get('toast').textContent.includes('原房間在確認前維持不變'));assert.equal(f.get('room-dialog').open,true);assert.equal(f.get('new-mode').value,'live');
  assert.equal(f.calls.filter(c=>c.url==='/api/admin/rooms').length,0);
  assert.equal(f.get('create-ai-room-button').hidden,false);
  f.get('create-ai-room-button').onclick();
  assert.equal(f.get('room-dialog').open,true);assert.equal(f.get('new-mode').value,'live');
  f.get('end-current-confirm').checked=true;f.get('end-current-confirm').onchange();
  await f.get('room-form').onsubmit({preventDefault(){}});
  assert.equal(f.get('room-mode').textContent,'AI 正式判讀');assert.equal(f.get('practice-banner').hidden,true);
  assert.equal(f.get('room-code').textContent,'FEDCBA');
});

test('saving a model without a stored API key cannot report AI readiness or enable live-room creation',async()=>{
  const settings={configured:false,model:'gpt-4.1-mini',concurrency:2};
  const f=await pageFixture('teacher',async url=>url==='/api/admin/settings'?{status:200,body:{configured:false}}:{status:200,body:{settings,addresses:[],idiomCount:148,room:null}});
  f.get('settings-button').onclick();f.get('api-key').value='';
  await f.get('settings-form').onsubmit({preventDefault(){}});
  assert.ok(f.get('toast').textContent.includes('尚未設定 API 金鑰'));
  assert.ok(f.get('ai-ready-status').textContent.includes('後端尚未設定'));
  assert.equal(f.get('create-ai-room-button').disabled,true);assert.equal(f.get('create-ai-room-button').hidden,false);
});

test('a pending practice question can be replaced with AI only after explicit confirmation',async()=>{
  const room=state();room.usage={calls:0,input:0,output:0};room.round={id:'r1',number:1,phase:'closed',seconds:30,pending:2,judged:0};
  const f=await pageFixture('teacher',async()=>({status:200,body:{settings:{configured:true,model:'gpt-4.1-mini',concurrency:2},addresses:[],idiomCount:148,room}}));
  assert.equal(f.get('create-ai-room-button').disabled,false);f.get('create-ai-room-button').onclick();assert.equal(f.get('room-dialog').open,true);
  assert.equal(f.get('room-create-submit').disabled,true);assert.equal(f.get('end-current-container').hidden,false);
  await f.get('room-form').onsubmit({preventDefault(){}});assert.equal(f.calls.filter(c=>c.url==='/api/admin/rooms').length,0);
  assert.ok(f.get('room-create-error').textContent.includes('請先勾選'));
});


test('teacher can end and remove a stuck exam with confirmation; cancelled confirmation sends no mutation',async()=>{
  let room=state();room.usage={calls:0,input:0,output:0};
  const f=await pageFixture('teacher',async(url)=>{
    if(url.endsWith('/end')){room={...room,ended:true};return{status:200,body:{room}};}
    if(url.endsWith('/delete')){room=null;return{status:200,body:{deleted:true}};}
    if(url==='/api/admin/rooms/list')return{status:200,body:{rooms:room?[{...room}]:[],active:room?.code||''}};
    return{status:200,body:{settings:{configured:true,model:'gpt-4.1-mini',concurrency:2},addresses:[],idiomCount:148,room}};
  });
  f.confirmState.answer=false;await f.get('end-room-button').onclick();assert.equal(f.calls.filter(c=>c.url.endsWith('/end')).length,0);
  f.confirmState.answer=true;await f.get('end-room-button').onclick();assert.equal(f.get('room-status').textContent,'已結束');assert.equal(f.get('start-button').disabled,true);
  await f.get('delete-room-button').onclick();assert.equal(f.get('room-dashboard').hidden,true);assert.ok(f.confirmations.at(-1).includes('Drive'));
});

test('a backend without lifecycle support clearly requests a GAS update',async()=>{
  const f=await pageFixture('teacher',async()=>({status:200,body:{features:{},settings:{configured:true,model:'gpt-4.1-mini',concurrency:2},addresses:[],idiomCount:148,room:null}}));
  assert.equal(f.get('backend-update-note').hidden,false);assert.equal(f.get('room-manager').hidden,true);
});

test('student and screen show the ended state instead of waiting for another question',async()=>{
  let room=state();room.ended=true;room.round={id:'r1',number:1,phase:'cancelled',seconds:30,submitted:0};
  const student=await pageFixture('play',async url=>url==='/api/join'?{status:200,body:{player:{...player},token:'test'}}:{status:200,body:room});
  student.get('join-code').value=room.code;student.get('join-student-id').value='1410701';await student.get('join-form').onsubmit({preventDefault(){}});student.events[0].send(room);
  assert.equal(student.get('submit-button').disabled,true);assert.equal(student.get('write-state').textContent,'已結束');
  const screen=await pageFixture('screen',async()=>{throw Error('No fetch')});screen.events[0].send(room);assert.equal(screen.get('screen-phase').textContent,'測驗已結束');
});


test('teacher mode markup contains two real radio inputs and no malformed closing tags in source or generated HTML',async()=>{
  for(const prefix of ['../','../public/'])for(const file of ['index.html','teacher.html','screen.html',prefix.includes('public')?'play.html':'student.html']){
    const html=await readFile(new URL(prefix+file,import.meta.url),'utf8');
    assert.doesNotMatch(html,/<\/[A-Za-z][\w-]*\s+[^>]+>/,prefix+file);
    if(file==='teacher.html'){const tags=[...html.matchAll(/<input\b[^>]*>/g)].map(m=>m[0]).filter(t=>t.includes('name="mode-choice"'));assert.equal(tags.length,2);assert.ok(tags.every(t=>t.includes('type="radio"')));assert.ok(tags.some(t=>t.includes('value="live"')));assert.ok(tags.some(t=>t.includes('value="practice"')));}
  }
});

test('a teacher can select each visible mode; choosing the AI radio creates a live room with the existing GAS key',async()=>{
  let room=null;const settings={configured:true,model:'gpt-4.1-mini',concurrency:2};
  const f=await pageFixture('teacher',async(url,options)=>{
    if(url==='/api/admin/rooms'){const data=JSON.parse(options.body);assert.equal(data.mode,'live');room={...state(),mode:data.mode,usage:{calls:0,input:0,output:0}};return{status:201,body:{room}};}
    return{status:200,body:{settings,addresses:[],idiomCount:148,room}};
  });
  assert.ok(f.get('app-version').textContent.startsWith('網頁 v2.13.0'));
  f.get('new-room-button').onclick();assert.equal(f.get('mode-choice-live').checked,true);
  f.get('mode-choice-practice').checked=true;f.get('mode-choice-practice').onchange();assert.equal(f.get('new-mode').value,'practice');
  f.get('mode-choice-live').checked=true;f.get('mode-choice-live').onchange();assert.equal(f.get('new-mode').value,'live');
  assert.ok(f.get('mode-key-status').textContent.includes('不需重填'));assert.equal(f.get('room-create-submit').disabled,false);
  await f.get('room-form').onsubmit({preventDefault(){}});assert.equal(f.get('room-mode').textContent,'AI 正式判讀');
});

test('the AI radio remains visible without a key and explains why creation is blocked',async()=>{
  const f=await pageFixture('teacher',async()=>({status:200,body:{settings:{configured:false,model:'gpt-4.1-mini',concurrency:2},addresses:[],idiomCount:148,room:null}}));
  f.get('new-room-button').onclick();assert.equal(f.get('mode-choice-live').hidden,false);f.get('mode-choice-live').checked=true;f.get('mode-choice-live').onchange();
  assert.equal(f.get('new-mode').value,'live');assert.equal(f.get('room-create-submit').disabled,true);assert.ok(f.get('mode-note').textContent.includes('OPENAI_API_KEY'));
  await f.get('room-form').onsubmit({preventDefault(){}});assert.equal(f.calls.filter(c=>c.url==='/api/admin/rooms').length,0);
});


test('teacher removal requires confirmation and sends the target student session version',async()=>{
  let room=state();room.usage={calls:0,input:0,output:0};room.players[0].connectionVersion=4;
  const f=await pageFixture('teacher',async(url,options)=>{
    if(url.endsWith('/remove-player')){const data=JSON.parse(options.body);assert.equal(data.playerId,'p1');assert.equal(data.connectionVersion,4);room={...room,players:[]};return{status:200,body:{room}};}
    return{status:200,body:{features:{roomManagement:true,playerManagement:true},settings:{configured:true,model:'gpt-4.1-mini',concurrency:2},addresses:[],idiomCount:148,room}};
  });
  assert.ok(f.get('teacher-players').innerHTML.includes('data-remove-player="p1"'));
  const button={dataset:{removePlayer:'p1',connectionVersion:'4'},disabled:false};const event={target:{closest:()=>button}};
  f.confirmState.answer=false;await f.get('teacher-players').onclick(event);assert.equal(f.calls.filter(c=>c.url.endsWith('/remove-player')).length,0);
  f.confirmState.answer=true;await f.get('teacher-players').onclick(event);assert.equal(f.get('player-count').textContent,'0 人');assert.ok(f.get('toast').textContent.includes('可重新加入'));
});

test('a removed student returns to the join form, clears the old token, and can rejoin with the same student ID',async()=>{
  let room=state(),attempts=0;const f=await pageFixture('play',async(url)=>url==='/api/join'?{status:200,body:{player:{...player},token:'token-'+(++attempts)}}:{status:200,body:room});
  f.get('join-code').value=room.code;f.get('join-student-id').value='1410701';await f.get('join-form').onsubmit({preventDefault(){}});f.events[0].send(room);
  assert.equal(f.store.size,2);room={...room,players:[]};f.events[0].send(room);
  assert.equal(f.get('join-panel').hidden,false);assert.equal(f.get('writing-panel').hidden,true);assert.equal(f.get('submit-button').disabled,true);assert.equal(f.store.size,0);assert.ok(f.get('join-error').textContent.includes('重新輸入學號'));
  room={...room,players:[{...player}]};await f.get('join-form').onsubmit({preventDefault(){}});f.events[1].send(room);assert.equal(f.get('writing-panel').hidden,false);assert.equal(attempts,2);
});

test('joining shows progress and ignores repeated taps while waiting for the backend',async()=>{
  let resolveJoin;const f=await pageFixture('play',async()=>new Promise(resolve=>{resolveJoin=resolve}));
  f.get('join-code').value='ABCDEF';f.get('join-student-id').value='1410701';const joined=f.get('join-form').onsubmit({preventDefault(){}});
  assert.equal(f.get('join-submit').disabled,true);assert.ok(f.get('join-status').textContent.includes('正在連接'));
  await f.get('join-form').onsubmit({preventDefault(){}});assert.equal(f.calls.length,1);resolveJoin({status:200,body:{player:{...player},token:'token-new'}});await joined;assert.equal(f.get('join-submit').disabled,false);
});


test('when the backend advertises direct student support, teacher shares the GAS student entry',async()=>{
  const room=state();room.usage={calls:0,input:0,output:0};
  const f=await pageFixture('teacher',async()=>({status:200,body:{features:{roomManagement:true,playerManagement:true,directStudent:true},settings:{configured:true,model:'gpt-4.1-mini',concurrency:2},addresses:[],idiomCount:148,room}}));
  const url=new URL(f.get('join-url').value);assert.equal(url.origin,'https://script.google.com');assert.equal(url.searchParams.get('view'),'student');assert.equal(url.searchParams.get('room'),room.code);assert.equal(f.get('open-play').href,f.get('join-url').value);
});

test('the generated direct student page joins, writes and submits through google.script.run without a bridge iframe',async()=>{
  let room=state();room.round={id:'r1',number:1,prompt:'補上一字',phase:'writing',seconds:30,deadline:Date.now()+30000,submitted:0};
  const f=await pageFixture('play',async(url,options)=>{
    if(url==='/api/join'){const data=JSON.parse(options.body);assert.match(data.joinKey,/^[a-f0-9]{64}$/);return{status:200,body:{player:{...player},token:'native-player-token'}};}
    if(url==='/api/submit'){room.players[0].submitted=true;room.round.submitted=1;return{status:201,body:{ok:true}};}
    if(url==='/api/student-worker')return{status:200,body:{idle:true}};
    if(url.startsWith('/api/room'))return{status:200,body:room};
    throw Error('Unexpected '+url);
  },{native:true});
  assert.equal(f.get('join-code').value,'ABCDEF');f.get('join-student-id').value='1410701';await f.get('join-form').onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.get('writing-panel').hidden,false);assert.equal(f.historyEntries.length,0);assert.equal(f.get('submit-button').disabled,false);
  const canvas=f.get('handwriting');canvas.events.pointerdown({pointerType:'pen',pointerId:1,clientX:40,clientY:40,preventDefault(){}});canvas.events.pointerup({pointerId:1});
  await f.get('submit-button').onclick();assert.equal(f.get('submit-button').disabled,true);assert.equal(f.nativeCalls.find(call=>call.action==='submit').auth,'native-player-token');
  const html=await readFile(new URL('../gas/Student.html',import.meta.url),'utf8');assert.doesNotMatch(html,/<iframe|postMessage|from '\.\/transport\.js|<script[^>]+src=/);
});


for(const native of [false,true])test((native?'native':'static')+' student locks at the writing deadline, rejects a fresh late click, and never enables late editing',async()=>{
 const clock={now:Date.now()},room=state();room.serverTime=clock.now;room.round={id:'grace-r1',number:1,prompt:'請填一字',phase:'writing',deadline:clock.now+30000,submissionDeadline:clock.now+35000};
 const f=await pageFixture('play',async url=>{if(url==='/api/join')return{status:200,body:{player:{...player},token:'token'}};if(url.startsWith('/api/room'))return{status:200,body:room};throw Error('No submission expected');},{native,clock});
 f.get('join-student-id').value='1410701';await f.get('join-form').onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
 if(!native)f.events[0].send(room);
 const canvas=f.get('handwriting');canvas.events.pointerdown({pointerType:'pen',pointerId:1,clientX:40,clientY:40,preventDefault(){}});canvas.events.pointerup({pointerId:1});
 clock.now+=30000;for(const tick of f.intervals)tick();
 assert.equal(f.get('submit-button').disabled,true);assert.equal(f.get('clear').disabled,true);assert.equal(f.get('canvas-lock').hidden,false);assert.ok(f.get('write-state').textContent.includes('緩衝'));
 await f.get('submit-button').onclick();assert.equal(f.calls.filter(c=>c.url==='/api/submit').length,0);
});

for(const native of [false,true])test((native?'native':'static')+' lost submission response keeps the same frozen image for retry after the writing deadline',async()=>{
 const clock={now:Date.now()},room=state();room.serverTime=clock.now;room.round={id:'grace-r2',number:1,prompt:'請填一字',phase:'writing',deadline:clock.now+30000,submissionDeadline:clock.now+35000};let attempts=0;
 const f=await pageFixture('play',async(url)=>{
  if(url==='/api/join')return{status:200,body:{player:{...player},token:'token'}};
  if(url.startsWith('/api/room'))return{status:200,body:room};
  if(url==='/api/submit'){attempts++;if(attempts===1){clock.now+=31000;room.round.phase='collecting';room.serverTime=clock.now;return{status:503,body:{error:'回應遺失'}};}room.players[0].submitted=true;return{status:200,body:{ok:true}};}
  if(url==='/api/student-worker')return{status:200,body:{idle:true}};throw Error('Unexpected '+url);
 },{native,clock});
 f.get('join-student-id').value='1410701';await f.get('join-form').onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));if(!native)f.events[0].send(room);
 const canvas=f.get('handwriting');canvas.events.pointerdown({pointerType:'pen',pointerId:1,clientX:40,clientY:40,preventDefault(){}});canvas.events.pointerup({pointerId:1});
 await f.get('submit-button').onclick();assert.equal(f.get('submit-button').disabled,false);assert.ok(f.get('submit-button').textContent.includes('重送'));assert.equal(f.get('undo').disabled,true);
 const draft=Array.from(f.store.entries()).find(([key])=>key.includes(':draft:'))?.[1];canvas.events.pointerdown({pointerType:'pen',pointerId:2,clientX:200,clientY:200,preventDefault(){}});canvas.events.pointerup({pointerId:2});assert.equal(Array.from(f.store.entries()).find(([key])=>key.includes(':draft:'))?.[1],draft);
 await f.get('submit-button').onclick();const calls=f.calls.filter(c=>c.url==='/api/submit');assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[0].options.body),JSON.parse(calls[1].options.body));assert.equal(f.get('submit-button').disabled,true);
});

test('big screen keeps images concealed throughout the transmission grace phase',async()=>{
 const f=await pageFixture('screen',async()=>{throw Error('No fetch')});const room=state();room.round={id:'grace-screen',number:1,prompt:'請填一字',phase:'collecting',deadline:Date.now()-1000,submissionDeadline:Date.now()+4000};room.players[0]={...player,submitted:true,status:'submitted',imageUrl:'data:image/png;base64,TEST'};f.events[0].send(room);
 assert.ok(!f.get('screen-grid').innerHTML.includes('<img'));assert.ok(f.get('screen-phase').textContent.includes('緩衝'));assert.ok(f.get('screen-subtitle').textContent.includes('暫不公開'));
});


test('generated teacher controller chains queued jobs immediately and displays server timing records',async()=>{
 const room=state();room.usage={calls:0,input:0,output:0};room.round={id:'speed-round',number:1,phase:'closed',pending:2,judged:0,submitted:1,prompt:'請填一字',answer:'字',performance:{saveMs:{count:1,average:250},queueMs:{count:1,average:800},aiMs:{count:1,average:1200}}};const jobs=[];
 const f=await pageFixture('teacher',async()=>({status:200,body:{features:{performance:true},settings:{configured:true,model:'gpt-4.1-mini',concurrency:1},room}}),{workerRun:(action,data)=>{assert.equal(action,'worker');return new Promise(resolve=>jobs.push({data,resolve}));}});
 assert.equal(jobs.length,1);assert.equal(jobs[0].data.roundId,'speed-round');assert.equal(f.get('performance-panel').hidden,false);assert.ok(f.get('performance-info').textContent.includes('0.25 秒'));
 jobs[0].resolve({processed:true,remainingQueued:1});await new Promise(resolve=>setImmediate(resolve));assert.equal(jobs.length,2);jobs[1].resolve({processed:true,remainingQueued:0});await new Promise(resolve=>setImmediate(resolve));assert.equal(jobs.length,2);
 assert.ok(f.timeouts.some(timer=>timer.delay===180));
});

test('a batch-capable GAS uses one resumable teacher request while legacy backends retain single-answer workers',async()=>{
 const room=state();room.usage={calls:0,input:0,output:0};room.round={id:'batch-round',number:1,phase:'closed',pending:28,judged:0,submitted:28,prompt:'請填一字',answer:'字'};
 const jobs=[];const f=await pageFixture('teacher',async()=>({status:200,body:{features:{batchJudging:true},settings:{configured:true,model:'gpt-4.1-mini',concurrency:3},room}}),{workerRun:(action,data)=>new Promise(resolve=>jobs.push({action,data,resolve}))});
 assert.equal(jobs.length,1);assert.equal(jobs[0].action,'workerBatch');assert.equal(jobs[0].data.roundId,'batch-round');
 jobs[0].resolve({processed:true,processedCount:24,remainingQueued:4});await new Promise(resolve=>setImmediate(resolve));assert.equal(jobs.length,2);assert.equal(jobs[1].action,'workerBatch');
 jobs[1].resolve({processed:true,processedCount:4,remainingQueued:0});await new Promise(resolve=>setImmediate(resolve));assert.equal(jobs.length,2);assert.ok(f.timeouts.some(timer=>timer.delay===180));
});

test('teacher polling schedules a shorter interval only while time-critical work is active',async()=>{
 for(const pending of [0,1]){const room=state();room.usage={calls:0,input:0,output:0};room.round={id:'poll-r',number:1,phase:'closed',pending,prompt:'請填一字',answer:'字'};const f=await pageFixture('teacher',async()=>({status:200,body:{settings:{configured:false,model:'gpt-4.1-mini',concurrency:2},room}}));const pollTimers=f.timeouts.filter(timer=>!timer.cancelled&&[1500,3500].includes(timer.delay));assert.equal(pollTimers.at(-1).delay,pending?1500:3500);}
});


test('teacher sets the total and result display time, starts one automatic series, and can pause and resume it',async()=>{
 let room=state();room.usage={calls:0,input:0,output:0};room.draft={id:'first-draft',idiom:'金蘭之交',blankIndex:0,prompt:'□蘭之交',answer:'金'};const features={autoSequence:true},settings={configured:false,model:'gpt-4.1-mini',concurrency:2};
 const f=await pageFixture('teacher',async(url,options)=>{
  if(url.endsWith('/start-series')){const data=JSON.parse(options.body);assert.equal(data.totalQuestions,3);assert.equal(data.revealSeconds,5);assert.deepEqual(data.accepted,['字','金']);room={...room,draft:null,round:{id:'r1',number:1,phase:'writing',deadline:Date.now()+30000,pending:0,prompt:'□蘭之交',answer:'金'},automation:{enabled:true,status:'running',totalQuestions:3,seconds:30,revealSeconds:5}};return{status:200,body:{room}};}
  if(url.endsWith('/pause-series')){room.automation.status='paused';room.automation.pauseReason='teacher';return{status:200,body:{room}};}
  if(url.endsWith('/resume-series')){room.automation.status='running';room.automation.pauseReason=null;return{status:200,body:{room}};}
  return{status:200,body:{settings,features,room}};
 });
 assert.equal(f.get('auto-settings').hidden,false);assert.equal(f.get('auto-enabled').checked,true);assert.ok(f.get('start-button').textContent.includes('整場'));f.get('auto-total').value='3';f.get('auto-reveal-seconds').value='5';f.get('seconds').value='30';f.get('accepted').value='字 金';await f.get('question-form').onsubmit({preventDefault(){}});
 assert.equal(f.get('auto-total').disabled,true);assert.equal(f.get('start-button').disabled,true);assert.equal(f.get('pause-series').hidden,false);assert.ok(f.get('round-label').textContent.includes('/ 3'));
 await f.get('pause-series').onclick();assert.equal(f.get('resume-series').hidden,false);await f.get('resume-series').onclick();assert.equal(f.get('pause-series').hidden,false);
});

for(const native of [false,true])test((native?'native':'static')+' automatic countdown and question transitions preserve results and unlock the next answer',async()=>{
 const clock={now:Date.now()},room=state();const f=await pageFixture('play',async url=>url==='/api/join'?{status:200,body:{player:{...player},token:'token'}}:{status:200,body:room},{clock,native});f.get('join-student-id').value='1410701';await f.get('join-form').onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
 async function push(){room.revision=(room.revision||0)+1;if(!native){f.events[0].send(room);return;}const timer=[...f.timeouts].reverse().find(item=>!item.cancelled&&item.delay>=2000&&item.delay<4300);assert.ok(timer);timer.cancelled=true;await timer.fn();await new Promise(resolve=>setImmediate(resolve));}
 room.serverTime=clock.now;room.round={id:'auto-r1',number:1,phase:'revealed',prompt:'□蘭之交',answer:'金'};room.players[0]={...player,submitted:true,status:'done',correct:true,score:10};room.automation={enabled:true,status:'running',totalQuestions:3,nextAt:clock.now+8000};await push();assert.ok(f.get('play-message').textContent.includes('8 秒'));clock.now+=2000;for(const tick of f.intervals)tick();assert.ok(f.get('play-message').textContent.includes('6 秒'));
 room.round={id:'auto-r2',number:2,phase:'writing',prompt:'長□善舞',deadline:clock.now+30000};room.players[0]={...player,score:10};room.serverTime=clock.now;room.automation.nextAt=null;await push();assert.equal(f.document.body.dataset.verdict,'');assert.equal(f.get('submit-button').disabled,false);assert.equal(f.get('canvas-lock').hidden,true);assert.ok(f.get('play-round').textContent.includes('/ 3'));
 room.ended=true;room.automation.status='completed';room.round.phase='revealed';room.players[0].score=30;await push();assert.ok(f.get('play-message').textContent.includes('總分：30'));
});

test('completed automatic series opens final rankings once and still allows the teacher screen to return to the last answer wall',async()=>{
 const f=await pageFixture('screen',async()=>{throw Error('No fetch')});const room=state();room.ended=true;room.automation={enabled:true,status:'completed',totalQuestions:3};room.round={id:'final-r',number:3,phase:'revealed',prompt:'□蘭之交',answer:'金'};room.players[0]={...player,score:30,submitted:true,status:'done',correct:true,imageUrl:'data:image/png;base64,TEST'};f.events[0].send(room);
 assert.equal(f.get('screen-ranking').hidden,false);assert.ok(f.get('screen-prompt').textContent.includes('3 題'));assert.ok(f.get('screen-ranking').innerHTML.includes('30'));f.get('ranking-toggle').onclick();assert.equal(f.get('screen-grid').hidden,false);f.events[0].send(room);assert.equal(f.get('screen-grid').hidden,false);
});


test('the screen uses a fixed 6 by 4 wall, fills 24 slots and pages excess participants without dropping them',async()=>{
 const f=await pageFixture('screen',async()=>{throw Error('No fetch')});const room=state();const ids=[...Array.from({length:15},(_,i)=>String(1410701+i)),...Array.from({length:13},(_,i)=>String(1420716+i))];room.players=ids.slice(0,24).map((id,i)=>({...player,id:'p'+i,studentId:id,name:'同學'+(i+1)}));f.events[0].send(room);assert.equal(f.document.body.dataset.wallColumns,'6');assert.equal(f.document.body.dataset.wallRows,'4');assert.equal((f.get('screen-grid').innerHTML.match(/<article /g)||[]).length,24);assert.equal(f.get('wall-page-controls').hidden,true);
 room.players=ids.map((id,i)=>({...player,id:'p'+i,studentId:id,name:'同學'+(i+1),score:28-i}));f.events[0].send(room);assert.equal(f.get('wall-page-controls').hidden,false);assert.equal(f.get('wall-prev').disabled,true);assert.ok(!f.get('screen-grid').innerHTML.includes(ids[24]));f.get('wall-next').onclick();assert.ok(ids.slice(24).every(id=>f.get('screen-grid').innerHTML.includes(id)));assert.equal((f.get('screen-grid').innerHTML.match(/<article /g)||[]).length,24);assert.equal((f.get('screen-grid').innerHTML.match(/class="answer-card empty-slot"/g)||[]).length,20);assert.equal(f.get('wall-next').disabled,true);
 f.get('ranking-toggle').onclick();f.get('wall-next').onclick();assert.ok(f.get('screen-ranking').innerHTML.includes('class="rank-number">25<'));assert.ok(f.get('screen-ranking').innerHTML.includes('class="rank-number">28<'));
 room.players=room.players.slice(0,2);f.events[0].send(room);assert.equal(f.get('wall-page-controls').hidden,true);f.get('ranking-toggle').onclick();assert.equal((f.get('screen-grid').innerHTML.match(/class="answer-card empty-slot"/g)||[]).length,22);
});


test('teacher display settings preserve an unsaved choice across polling and apply to the selected room',async()=>{
 const room=state();room.usage={calls:0,input:0,output:0};room.display={columns:6,pageSize:24};let applied;
 const f=await pageFixture('teacher',async(url,options)=>{if(url.endsWith('/display')){applied=JSON.parse(options.body);room.display={columns:applied.columns,pageSize:24};return{status:200,body:{room}};}return{status:200,body:{features:{displayLayout:true},settings:{configured:false,model:'gpt-4.1-mini',concurrency:2},room}};});
 assert.equal(f.get('wall-layout-panel').hidden,false);assert.equal(f.get('wall-columns').value,'6');f.get('wall-columns').value='8';f.get('wall-columns').onchange();room.display.columns=4;const timer=[...f.timeouts].reverse().find(item=>!item.cancelled&&item.delay===3500);await timer.fn();assert.equal(f.get('wall-columns').value,'8');await f.get('wall-layout-form').onsubmit({preventDefault(){}});assert.equal(applied.columns,8);assert.equal(f.get('wall-columns').value,'8');assert.ok(f.get('wall-layout-summary').textContent.includes('3 列'));assert.ok(f.get('wall-layout-status').textContent.includes('已套用'));
});

test('screen updates rows for each supported teacher-selected column count without losing any of its 24 slots',async()=>{
 const f=await pageFixture('screen',async()=>{throw Error('No fetch')});const room=state();for(const columns of [3,4,5,6,7,8]){room.display={columns,pageSize:24};f.events[0].send(room);assert.equal(f.document.body.dataset.wallColumns,String(columns));assert.equal(f.document.body.dataset.wallRows,String(Math.ceil(24/columns)));assert.equal((f.get('screen-grid').innerHTML.match(/<article /g)||[]).length,24);}
});

for(const native of [false,true])test((native?'native':'static')+' automatically retries busy uploads with one unchanged image and keeps a confirmed receipt despite stale polls',async()=>{
 const room=state();room.round={id:'retry-r',number:1,phase:'writing',deadline:Date.now()+30000,submissionDeadline:Date.now()+35000};let attempts=0;
 const f=await pageFixture('play',async(url)=>{
  if(url==='/api/join')return{status:200,body:{player:{...player},token:'token'}};
  if(url.startsWith('/api/room'))return{status:200,body:room};
  if(url==='/api/student-worker')return{status:200,body:{idle:true}};
  if(url==='/api/submit'){attempts++;return attempts<3?{status:429,body:{error:'busy',retryable:true}}:{status:200,body:{ok:true}};}throw Error(url);
 },{native});f.get('join-student-id').value='1410701';await f.get('join-form').onsubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));if(!native)f.events[0].send(room);
 const canvas=f.get('handwriting');canvas.events.pointerdown({pointerType:'pen',pointerId:1,clientX:40,clientY:40,preventDefault(){}});canvas.events.pointerup({pointerId:1});await f.get('submit-button').onclick();
 for(let i=0;i<2;i++){const timer=f.timeouts.find(t=>!t.cancelled&&String(t.fn).includes('transmitFrozen'));assert.ok(timer);assert.ok(timer.delay>=1500&&timer.delay<13000);timer.cancelled=true;await timer.fn();await new Promise(resolve=>setImmediate(resolve));}
 const calls=f.calls.filter(c=>c.url==='/api/submit');assert.equal(calls.length,3);assert.ok(calls.every(c=>c.options.body===calls[0].options.body));assert.equal(f.get('submit-button').disabled,true);assert.ok(!f.timeouts.some(t=>!t.cancelled&&String(t.fn).includes('transmitFrozen')));
 if(!native)f.events[0].send(room);assert.equal(f.get('submit-button').disabled,true);assert.ok(f.get('submit-button').textContent.includes('已送出'));
});

test('a terminal rejection stops automatic retry, and a late old-round response cannot lock the next answer',async()=>{
 for(const terminal of [true,false]){let resolveUpload;const room=state();room.round={id:'old-r',number:1,phase:'writing',deadline:Date.now()+30000};
 const f=await pageFixture('play',async(url)=>url==='/api/join'?{status:200,body:{player:{...player},token:'token'}}:url.startsWith('/api/room')?{status:200,body:room}:url==='/api/submit'?(terminal?{status:409,body:{error:'已截止'}}:await new Promise(resolve=>{resolveUpload=resolve;})):{status:200,body:{idle:true}});
 f.get('join-student-id').value='1410701';await f.get('join-form').onsubmit({preventDefault(){}});f.events[0].send(room);const canvas=f.get('handwriting');canvas.events.pointerdown({pointerType:'pen',pointerId:1,clientX:30,clientY:30,preventDefault(){}});canvas.events.pointerup({pointerId:1});const pending=f.get('submit-button').onclick();
 if(terminal){await pending;assert.ok(!f.timeouts.some(t=>!t.cancelled&&String(t.fn).includes('transmitFrozen')));assert.ok(f.get('play-message').textContent.includes('已截止'));}
 else{room.round={id:'new-r',number:2,phase:'writing',deadline:Date.now()+30000};f.events[0].send(room);resolveUpload({status:200,body:{ok:true}});await pending;assert.equal(f.get('submit-button').disabled,false);assert.equal(f.get('canvas-lock').hidden,true);}
 }
});
