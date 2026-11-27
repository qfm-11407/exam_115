import test from 'node:test';
import assert from 'node:assert/strict';
import {options,summarize,allowedIds,waitForRoundStart,waitForJudgments,timingSummary,completeLiveRound,updateSavedRows,verifySavedImages} from '../scripts/gas-ui-loadtest.mjs';
import {pageFixture} from './helpers/frontend-fixture.mjs';

test('real UI runner keeps the 28-account whitelist and validates late-submit and target options',()=>{
 const o=options([]);assert.equal(o.students,28);assert.equal(o.seconds,180);assert.equal(allowedIds.length,28);assert.equal(new Set(allowedIds).size,28);
 assert.equal(options(['--seconds','30','--send-at','25']).sendAt,25);
 assert.throws(()=>options(['--students','30']));assert.throws(()=>options(['--seconds','30','--send-at','30']));assert.throws(()=>options(['--site','http://school.invalid/']));assert.throws(()=>options(['--timeout','NaN']));
});
test('a launch failure cannot be reported as a real GAS connection or a successful load test',()=>{
 const s=summarize({requestedStudents:28,openedPages:0,students:[],error:'launch failure'});assert.equal(s.realGAS,false);assert.equal(s.totalPages,0);assert.equal(s.passed,false);
});
test('load-test success needs the server receipt, UI confirmation and original-image integrity for every participant',()=>{
 const student={joined:true,serverSaved:true,uiConfirmed:true,imageVerified:true,attempts:2,clickedAt:1000};
 const report={requestedStudents:2,openedPages:4,gasReached:true,completed:true,students:[{...student},{...student,clickedAt:1020}]};assert.equal(summarize(report).passed,true);assert.equal(summarize(report).clickSpreadMs,20);
 for(const key of ['joined','serverSaved','uiConfirmed','imageVerified']){const r=structuredClone(report);r.students[1][key]=false;assert.equal(summarize(r).passed,false,key);}
 assert.equal(summarize({...report,error:'fatal test error'}).passed,false);assert.equal(summarize({...report,requestedStudents:3}).passed,false);
});

test('real teacher UI disables Start before GAS finishes; the load runner waits for the authoritative round instead',async()=>{
 let room={code:'ABCDEF',title:'壓測',mode:'practice',ended:false,players:[{id:'p1',studentId:'1410701',name:'同學',score:0}],round:null,usage:{calls:0,input:0,output:0},draft:{id:'draft',idiom:'金蘭之交',blankIndex:0,prompt:'□蘭之交',answer:'金'}};
 let resolveStart;
 const f=await pageFixture('teacher',async(url)=>{
  if(url.endsWith('/start'))return await new Promise(resolve=>{resolveStart=resolve;});
  return{status:200,body:{settings:{configured:false,concurrency:2},features:{autoSequence:true},room}};
 });
 f.get('auto-enabled').checked=false;const pending=f.get('question-form').onsubmit({preventDefault(){}});
 assert.equal(f.get('start-button').disabled,true);assert.equal(room.round,null);
 let now=0,waits=0,reads=0;const checks=[];
 const result=await waitForRoundStart({room:'ABCDEF',now:()=>now,readState:async()=>{reads++;return{room};},sample:s=>checks.push(s),wait:async ms=>{now+=ms;waits++;if(waits===2){room={...room,round:{id:'started-round',number:1,phase:'writing',deadline:Date.now()+180000}};resolveStart({status:200,body:{room}});await pending;}}});
 assert.equal(reads,3);assert.equal(waits,2);assert.equal(result.room.round.id,'started-round');assert.equal(checks[0].roundId,null);assert.equal(checks.at(-1).phase,'writing');
});

test('start wait retries transient state-read errors, but never treats an ended room, expired round or another mode as started',async()=>{
 const room={code:'ABCDEF',mode:'practice',ended:false,round:null};let now=0,calls=0;
 const r=await waitForRoundStart({room:'ABCDEF',now:()=>now,wait:async ms=>{now+=ms;},readState:async()=>{calls++;if(calls===1)throw Object.assign(Error('busy'),{status:429});return{room:{...room,serverTime:10,round:{id:'r1',phase:'writing',deadline:100}}};}});assert.equal(r.room.round.id,'r1');assert.equal(calls,2);
 for(const state of [{...room,ended:true},{...room,code:'FEDCBA'},{...room,mode:'live'},{...room,round:{id:'r1',phase:'closed'}},{...room,serverTime:100,round:{id:'r1',phase:'writing',deadline:99}}])await assert.rejects(waitForRoundStart({room:'ABCDEF',readState:async()=>({room:state})}));
});

test('missing start receipts time out with useful samples; authentication failure is immediate',async()=>{
 let now=0,calls=0;const checks=[];
 await assert.rejects(waitForRoundStart({room:'ABCDEF',timeout:6000,now:()=>now,wait:async ms=>{now+=ms;},sample:s=>checks.push(s),readState:async()=>{calls++;return{room:{code:'ABCDEF',mode:'practice',round:null}};}}),/逾時/);
 assert.equal(calls,3);assert.equal(checks.length,3);
 await assert.rejects(waitForRoundStart({room:'ABCDEF',readState:async()=>{throw Object.assign(Error('login expired'),{status:401});}}),e=>e.status===401);
});

test('a late verified image counts as saved even if the metadata sample was earlier; subsequent stale samples cannot erase that proof',()=>{
 const rows=[{studentId:'1410701',serverSaved:false,imageHash:'expected',attempts:1}],players=[{id:'p1',studentId:'1410701',submitted:false}];updateSavedRows(rows,players,100);assert.equal(rows[0].serverSaved,false);
 verifySavedImages(rows,players,{p1:'expected'});assert.equal(rows[0].imageVerified,true);assert.equal(rows[0].serverSaved,true);updateSavedRows(rows,players,200);assert.equal(rows[0].serverSaved,true);
 verifySavedImages(rows,players,{p1:'different'});assert.equal(rows[0].imageVerified,false);
});

test('AI mode is explicit and validates a separate grading deadline',()=>{
 assert.equal(options([]).mode,'practice');assert.equal(options(['--mode','live']).mode,'live');assert.equal(options(['--judge-timeout','600']).judgeTimeout,600);assert.throws(()=>options(['--mode','fake-ai']));assert.throws(()=>options(['--judge-timeout','0']));
});

test('upload success cannot pass a live test without actual AI responses, verdicts, result screens and next-question readiness',()=>{
 const row={studentId:'1410701',joined:true,serverSaved:true,uiConfirmed:true,imageVerified:true,attempts:1,judgeStatus:'done',correct:false,resultVisible:true,nextReady:true};
 const report={mode:'live',requestedStudents:1,completed:true,aiCompleted:true,aiUsage:{calls:1},revealed:true,screenVerified:true,nextQuestionReady:true,students:[row]};assert.equal(summarize(report).passed,true);assert.equal(summarize(report).realAI,true);assert.equal(summarize(report).scope,'ai-full-cycle');
 for(const changed of [{aiUsage:{calls:0}},{aiCompleted:false},{revealed:false},{screenVerified:false},{nextQuestionReady:false},{students:[{...row,judgeStatus:'queued'}]},{students:[{...row,correct:null}]},{students:[{...row,resultVisible:false}]},{students:[{...row,nextReady:false}]}])assert.equal(summarize({...report,...changed}).passed,false,JSON.stringify(changed));
 assert.equal(summarize({...report,mode:'practice'}).realAI,false);assert.equal(summarize({...report,mode:'practice'}).aiJudged,0);
});

test('AI grading wait stays open while jobs are queued and returns uncertainty or service failure without inventing verdicts',async()=>{
 const room={code:'ABCDEF',mode:'live',ended:false,round:{id:'r1'},players:[{studentId:'1410701',judgeStatus:'queued'}]};let now=0,reads=0;
 const result=await waitForJudgments({room:'ABCDEF',roundId:'r1',studentIds:['1410701'],now:()=>now,wait:async ms=>{now+=ms;},readState:async()=>{reads++;return{room:{...room,players:[{studentId:'1410701',judgeStatus:reads<3?'judging':'done'}]}};}});assert.equal(result.allDone,true);assert.equal(reads,3);assert.equal(now,6000);
 for(const status of ['uncertain','error']){const r=await waitForJudgments({room:'ABCDEF',roundId:'r1',studentIds:['1410701'],readState:async()=>({room:{...room,players:[{studentId:'1410701',judgeStatus:status}]}})});assert.equal(r.allDone,false);assert.equal(r.counts[status],1);}
 now=0;const timeout=await waitForJudgments({room:'ABCDEF',roundId:'r1',studentIds:['1410701'],timeout:6000,now:()=>now,wait:async ms=>{now+=ms;},readState:async()=>({room})});assert.equal(timeout.timedOut,true);assert.equal(timeout.allDone,false);
 await assert.rejects(waitForJudgments({room:'ABCDEF',roundId:'r1',studentIds:['1410701'],readState:async()=>({room:{...room,mode:'practice'}})}));
});

test('AI timing keeps upload latency, remaining AI wait, server round duration and average AI processing separate',()=>{
 const r={mode:'live',uploadBarrierAt:1000,allUploadsConfirmedAt:11000,allJudgedObservedAt:31000,revealedObservedAt:35000,serverRoundStartedAt:500000,revealedServerTime:545000,nextReadyServerTime:560000,serverTiming:{aiMs:{count:28,average:2400}}};const t=timingSummary(r);assert.equal(t.sendToUploadConfirmed,10);assert.equal(t.sendToAllAiJudged,30);assert.equal(t.remainingAiWaitAfterUploads,20);assert.equal(t.roundStartToRevealed,45);assert.equal(t.roundStartToNextQuestionReady,60);assert.equal(t.averageAiTimePerAnswer,2.4);
 assert.equal(timingSummary({...r,allJudgedObservedAt:9000}).remainingAiWaitAfterUploads,0);assert.equal(timingSummary({}).averageAiTimePerAnswer,null);assert.equal(timingSummary({...r,mode:'practice'}).averageAiTimePerAnswer,null);
});

test('the next-round start wait ignores the previous revealed round until GAS confirms a new writing round',async()=>{
 let n=0,now=0;const r=await waitForRoundStart({room:'ABCDEF',mode:'live',previousRound:'r1',now:()=>now,wait:async ms=>{now+=ms;},readState:async()=>({room:{code:'ABCDEF',mode:'live',round:++n===1?{id:'r1',phase:'revealed'}:{id:'r2',phase:'writing',deadline:10000},serverTime:now}})});assert.equal(r.room.round.id,'r2');assert.equal(n,2);
});

for(const count of [2,28])test(count+' live student controllers wait for AI before reveal, verify every screen page and unlock the next question without a second answer',async()=>{
 const log=[],ids=allowedIds.slice(0,count),report={mode:'live',requestedStudents:count,completed:true,uploadBarrierAt:Date.now()-1000,allUploadsConfirmedAt:Date.now(),serverRoundStartedAt:1000,students:ids.map(studentId=>({studentId,joined:true,serverSaved:true,uiConfirmed:true,imageVerified:true,attempts:1}))};
 let graded=false,phase='closed',roundId='r1';
 const state=()=>({room:{code:'ABCDEF',mode:'live',ended:false,serverTime:10000,usage:{calls:graded?count:0},round:{id:roundId,number:roundId==='r1'?1:2,phase,deadline:100000,performance:{aiMs:{count:2,average:2000}}},players:ids.map((studentId,i)=>({id:'p'+i,studentId,submitted:true,judgeStatus:graded?'done':'queued',correct:phase==='revealed'?i===0:null}))}});
 const teacher={locator:id=>({click:async()=>{log.push(id);if(id==='#reveal-button'){assert.equal(graded,true);phase='revealed';}else{assert.equal(phase,'revealed');roundId='r2';phase='writing';}}})};
 const clients=report.students.map(row=>({row,frame:{waitForFunction:async(_fn,arg)=>{log.push('student:'+arg);}}}));const screen={waitForFunction:async(_fn,arg)=>{log.push(Array.isArray(arg)?'screen-results':'screen-next');},locator:()=>({click:async()=>{log.push('screen-next-page');}})};
 await completeLiveRound({teacher,screen,clients,report,o:{students:count,judgeTimeout:30},room:'ABCDEF',roundId:'r1',act:async()=>state(),wait:async ms=>{log.push('wait:'+ms);if(ms===3000)graded=true;}});
 assert.equal(summarize(report).passed,true);assert.ok(log.indexOf('wait:3000')<log.indexOf('#reveal-button'));const hold='wait:'+report.remainingResultDisplayMs;assert.ok(log.indexOf('screen-results')<log.lastIndexOf(hold));assert.ok(log.lastIndexOf(hold)<log.indexOf('#start-button'));assert.equal(report.screenVerifiedStudents,count);assert.equal(log.filter(x=>x==='screen-next-page').length,Math.ceil(count/24)-1);assert.equal(log.filter(x=>x==='#start-button').length,1);assert.equal(report.nextRoundId,'r2');
});

test('a live-looking done status with zero recorded AI responses is rejected before any result is revealed',async()=>{
 const report={mode:'live',requestedStudents:1,completed:true,students:[{studentId:'1410701',joined:true,serverSaved:true,uiConfirmed:true,imageVerified:true,attempts:1}]};
 const teacher={locator:()=>{throw Error('Must not reveal');}};
 await assert.rejects(completeLiveRound({teacher,screen:{},clients:[{row:report.students[0]}],report,o:{students:1,judgeTimeout:30},room:'ABCDEF',roundId:'r1',act:async()=>({room:{code:'ABCDEF',mode:'live',ended:false,round:{id:'r1',performance:{}},usage:{calls:0},players:[{studentId:'1410701',submitted:true,judgeStatus:'done'}]}})}),/AI 成功回應/);
 assert.equal(summarize(report).realAI,false);assert.equal(summarize(report).passed,false);
});
