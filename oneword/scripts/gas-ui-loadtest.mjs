// Run locally against the real deployed UI. No teacher PIN or player token is logged.
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const runnerVersion='1.3.1';
export const allowedIds=[...Array.from({length:15},(_,i)=>String(1410701+i)),...Array.from({length:13},(_,i)=>String(1420716+i))];
export function options(args){
 const o={site:'https://qfm-11407.github.io/exam_115/oneword/',mode:'practice',seconds:180,timeout:180,judgeTimeout:600,students:28,sendAt:null,channel:'chrome',keepRoom:false};
 for(let i=0;i<args.length;i++){
  const arg=args[i];if(arg==='--keep-room'){o.keepRoom=true;continue;}
  const key=({'--site':'site','--mode':'mode','--seconds':'seconds','--timeout':'timeout','--judge-timeout':'judgeTimeout','--students':'students','--send-at':'sendAt','--channel':'channel'})[arg];
  if(!key||!args[i+1])throw Error('Unknown or incomplete option: '+arg);o[key]=args[++i];
 }
 const site=new URL(o.site);if(site.protocol!=='https:'||!site.pathname.endsWith('/'))throw Error('--site must be an HTTPS OneWord directory ending in /');
 for(const key of ['seconds','timeout','judgeTimeout','students'])o[key]=Number(o[key]);
 if(!['practice','live'].includes(o.mode))throw Error('--mode 必須是 practice 或 live');
 if(!Number.isInteger(o.students)||o.students<1||o.students>28)throw Error('正式白名單只有 28 人；--students 必須是 1～28。');
 if(!Number.isInteger(o.seconds)||o.seconds<10||o.seconds>180)throw Error('--seconds 必須是 10～180。');
 if(!Number.isInteger(o.timeout)||o.timeout<30||o.timeout>600)throw Error('--timeout 必須是 30～600。');
 if(!Number.isInteger(o.judgeTimeout)||o.judgeTimeout<30||o.judgeTimeout>1800)throw Error('--judge-timeout 必須是 30～1800。');
 if(o.sendAt!==null){o.sendAt=Number(o.sendAt);if(!Number.isFinite(o.sendAt)||o.sendAt<0||o.sendAt>=o.seconds)throw Error('--send-at 必須小於作答秒數。');}
 if(!['chrome','msedge'].includes(o.channel))throw Error('--channel must be chrome or msedge');return o;
}
export function summarize(report){
 const rows=report.students||[],starts=rows.map(r=>r.clickedAt).filter(Number.isFinite);
 const live=report.mode==='live',calls=report.aiUsage?.calls||0;
 const uploadPassed=rows.length===report.requestedStudents&&rows.every(r=>r.joined&&r.serverSaved&&r.uiConfirmed&&r.imageVerified);
 const aiPassed=!live||(report.aiCompleted===true&&calls>=report.requestedStudents&&report.revealed===true&&report.screenVerified===true&&report.nextQuestionReady===true&&rows.every(r=>r.judgeStatus==='done'&&typeof r.correct==='boolean'&&r.resultVisible===true&&r.nextReady===true));
 return{kind:'real-gas-browser-test',scope:live?'ai-full-cycle':'upload-only',mode:report.mode||'practice',runnerVersion:report.runnerVersion,backendVersion:report.backendVersion,judgingEngine:report.judgingEngine||null,realGAS:report.gasReached===true,realAI:live&&calls>0,requestedStudentPages:report.requestedStudents,connectedStudents:rows.filter(r=>r.joined).length,totalPages:report.openedPages||0,submitted:rows.filter(r=>r.serverSaved).length,uiConfirmed:rows.filter(r=>r.uiConfirmed).length,imagesVerified:rows.filter(r=>r.imageVerified).length,aiJudged:live?rows.filter(r=>r.judgeStatus==='done').length:0,successfulAiCalls:live?calls:0,resultsVisible:rows.filter(r=>r.resultVisible).length,nextQuestionReady:report.nextQuestionReady===true,timingSeconds:report.timingSeconds||null,submitCalls:rows.reduce((n,r)=>n+r.attempts,0),clickSpreadMs:starts.length?Math.max(...starts)-Math.min(...starts):null,passed:!report.error&&report.completed===true&&uploadPassed&&aiPassed};
}
export function updateSavedRows(rows,players,now=Date.now()){
 for(const row of rows){const p=players.find(p=>p.studentId===row.studentId);if(p?.submitted){row.serverSaved=true;if(!row.savedObservedAt)row.savedObservedAt=now;}row.judgeStatus=p?.judgeStatus;if(p?.judgeStatus==='done'&&!row.judgedObservedAt)row.judgedObservedAt=now;if(typeof p?.correct==='boolean')row.correct=p.correct;if(p?.error)row.serverError=p.error;}
}
export function verifySavedImages(rows,players,hashes){
 for(const row of rows){const p=players.find(p=>p.studentId===row.studentId);row.imageVerified=Boolean(row.imageHash&&hashes[p?.id]===row.imageHash);if(row.imageVerified)row.serverSaved=true;}
}
async function observeStudents(clients,room){
 updateSavedRows(clients.map(c=>c.row),room.players);
 await Promise.all(clients.map(async c=>{c.row.uiConfirmed=await c.frame.locator('#submit-button').evaluate(el=>el.disabled&&el.textContent.includes('已送出'));}));
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function waitForRoundStart({readState,room,mode='practice',previousRound=null,timeout=120000,now=Date.now,wait=sleep,sample=()=>{}}){
 const started=now();let lastError='';
 while(now()-started<timeout){
  let admin;
  try{admin=await readState();}
  catch(error){
   sample({elapsedMs:now()-started,status:error.status||0,error:String(error.message).slice(0,240)});
   if([400,401,403,404].includes(error.status))throw error;
   lastError=error.message;await wait(2000);continue;
  }
  const state=admin.room,round=state?.round;
  sample({elapsedMs:now()-started,room:state?.code||null,ended:Boolean(state?.ended),roundId:round?.id||null,phase:round?.phase||null});
  if(!state||state.code!==room||state.ended)throw Error('等待出題時測試房間已切換或結束');
  if(state.mode!==mode)throw Error('測試房間的判讀方式不符，停止測試');
  if(previousRound&&round?.id===previousRound){await wait(2000);continue;}
  if(round?.id){
   if(round.phase==='writing'&&(!Number.isFinite(round.deadline)||!Number.isFinite(state.serverTime)||round.deadline>state.serverTime))return admin;
   throw Error('測試題目已建立，但作答階段已結束（'+round.phase+'）');
  }
  await wait(2000);
 }
 throw Error('等待 GAS 確認題目開始逾時'+(lastError?'；最後連線錯誤：'+lastError:''));
}
export async function waitForJudgments({readState,room,roundId,studentIds,timeout=600000,now=Date.now,wait=sleep,sample=()=>{}}){
 const start=now();let latest=null,counts=null;
 while(now()-start<timeout){
  let admin;try{admin=await readState();}catch(error){if([400,401,403,404].includes(error.status))throw error;sample({elapsedMs:now()-start,error:String(error.message).slice(0,240)});await wait(3000);continue;}
  const r=admin.room;if(!r||r.code!==room||r.round?.id!==roundId||r.ended||r.mode!=='live')throw Error('AI 測試期間房間、題目或判讀方式已變更');
  latest=admin;counts={done:0,uncertain:0,error:0,pending:0};
  for(const id of studentIds){const p=r.players.find(p=>p.studentId===id);if(!p)throw Error('AI 測試期間有學生被移除：'+id);if(['done','uncertain','error'].includes(p.judgeStatus))counts[p.judgeStatus]++;else counts.pending++;}
  sample({elapsedMs:now()-start,counts,admin});
  if(counts.pending===0)return{admin,counts,allDone:counts.done===studentIds.length,timedOut:false};
  await wait(3000);
 }
 return{admin:latest,counts,allDone:false,timedOut:true};
}
export function timingSummary(report){
 const seconds=(end,start)=>Number.isFinite(end)&&Number.isFinite(start)?Math.round(Math.max(0,end-start)/100)/10:null;
 const average=report.serverTiming?.aiMs;
 return{sendToUploadConfirmed:seconds(report.allUploadsConfirmedAt,report.uploadBarrierAt),sendToAllAiJudged:seconds(report.allJudgedObservedAt,report.uploadBarrierAt),remainingAiWaitAfterUploads:seconds(report.allJudgedObservedAt,report.allUploadsConfirmedAt),sendToRevealed:seconds(report.revealedObservedAt,report.uploadBarrierAt),roundStartToRevealed:seconds(report.revealedServerTime,report.serverRoundStartedAt),roundStartToNextQuestionReady:seconds(report.nextReadyServerTime,report.serverRoundStartedAt),averageAiTimePerAnswer:report.mode==='live'&&average?.count?Math.round(average.average/100)/10:null};
}
async function pool(items,limit,run){let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const index=next++;await run(items[index],index);}}));}
async function appFrame(page){
 const end=Date.now()+60000;
 while(Date.now()<end){for(const frame of page.frames())try{if(await frame.locator('#join-form').count())return frame;}catch{}await sleep(500);}
 throw Error('60 秒內未載入 GAS 學生介面；請確認部署存取權限及 Google 登入要求。');
}
// Reuse the exact imported module URL, so this is the teacher's already-authorized session.
async function teacherAction(page,action,data={}){
 return page.evaluate(async({action,data})=>{
  const script=[...document.scripts].find(s=>s.type==='module'&&/app\.js/.test(s.src));
  if(!script)throw Error('找不到教師端模組');
  const source=await fetch(script.src).then(r=>r.text()),match=source.match(/from ['"]([^'"]*transport\.js[^'"]*)['"]/);
  if(!match)throw Error('教師端版本不支援測試');
  const {client}=await import(new URL(match[1],script.src).href);
  if(action==='state')return client.request('/api/admin/state');
  if(action==='stateOnce')return client.rpc('adminState',{},client.token,0);
  if(action==='end')return client.request('/api/admin/rooms/'+data.room+'/end',{});
  if(action==='imageHashes'){
   const images=await client.rpc('images',data,'',0),out={};
   for(const [id,image] of Object.entries(images)){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(image));out[id]=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}return out;
  }
  throw Error('Unsupported teacher test action');
 },{action,data});
}
async function writeCharacter(page,frame,index){
 await frame.locator('#submit-button').waitFor({state:'visible',timeout:60000});
 await frame.waitForFunction(()=>!document.getElementById('submit-button').disabled,{},{timeout:60000});
 const box=await frame.locator('#handwriting').boundingBox();if(!box)throw Error('手寫區尚未出現');
 const strokes=[[[.2,.3],[.8,.3]],[[.5,.15],[.5,.85]],[[.5,.3],[.2,.8]],[[.5,.3],[.8,.8]],[[.1+index*.006,.92],[.12+index*.006,.92]]];
 for(const stroke of strokes){await page.mouse.move(box.x+stroke[0][0]*box.width,box.y+stroke[0][1]*box.height);await page.mouse.down();for(const [x,y] of stroke.slice(1))await page.mouse.move(box.x+x*box.width,box.y+y*box.height,{steps:4});await page.mouse.up();}
}
export async function completeLiveRound({teacher,screen,clients,report,o,room,roundId,act=teacherAction,wait=sleep}){
 report.stage='judge';report.judgmentChecks=[];let last='';
 console.log('上傳已確認；繼續等待全部 AI 判讀完成，尚未結束測試。');
 const result=await waitForJudgments({wait,room,roundId,studentIds:clients.map(c=>c.row.studentId),timeout:o.judgeTimeout*1000,readState:()=>act(teacher,'stateOnce'),sample:s=>{
  report.judgmentChecks.push({elapsedMs:s.elapsedMs,counts:s.counts,error:s.error});
  if(s.admin){updateSavedRows(report.students,s.admin.room.players);report.aiUsage=s.admin.room.usage;report.serverTiming=s.admin.room.round.performance;
   const key=JSON.stringify(s.counts);if(key!==last){console.log('AI 已完成 '+s.counts.done+'/'+o.students+'；處理／排隊 '+s.counts.pending+'；無法判定 '+s.counts.uncertain+'；失敗 '+s.counts.error);last=key;}}
 }});
 report.aiCompleted=result.allDone;report.aiStatusCounts=result.counts;
 if(!result.allDone)throw Error(result.timedOut?'等待全部 AI 判讀逾時；請查看 aiStatusCounts 與學生錯誤':'AI 判讀有失敗或無法判定，未通過完整測試');
 report.allJudgedObservedAt=Math.max(...report.students.map(s=>s.judgedObservedAt||Date.now()));
 if((report.aiUsage?.calls||0)<o.students)throw Error('未取得每位學生的 AI 成功回應紀錄，不能視為實際 AI 評分通過');
 report.stage='reveal';await teacher.locator('#reveal-button').click({timeout:60000});
 let revealed=null;const end=Date.now()+120000;
 while(Date.now()<end){
  const admin=await act(teacher,'stateOnce');if(admin.room?.code!==room||admin.room?.round?.id!==roundId||admin.room.ended)throw Error('公布期間測試房間已變更');
  if(admin.room.round.phase==='revealed'){revealed=admin;break;}await wait(2000);
 }
 if(!revealed)throw Error('等待 GAS 確認公布結果逾時');
 report.revealed=true;report.revealedObservedAt=Date.now();report.revealedServerTime=revealed.room.serverTime;
 updateSavedRows(report.students,revealed.room.players);report.aiUsage=revealed.room.usage;report.serverTiming=revealed.room.round.performance;
 report.stage='results';
 await Promise.all(clients.map(async c=>{
  if(typeof c.row.correct!=='boolean')return;
  try{await c.frame.waitForFunction(tone=>!document.getElementById('own-result').hidden&&document.body.dataset.verdict===tone,c.row.correct?'correct':'wrong',{timeout:60000});c.row.resultVisible=true;c.row.resultVisibleAt=Date.now();}
  catch{c.row.resultVisible=false;c.row.resultError='學生頁未在期限內顯示對應的判定';}
 }));
 if(!clients.every(c=>c.row.resultVisible))throw Error('部分學生頁沒有顯示 AI 結果');
 const ordered=[...revealed.room.players].sort((a,b)=>a.studentId.localeCompare(b.studentId)),seen=new Set();
 for(let index=0;index<Math.ceil(ordered.length/24);index++){
  const expected=ordered.slice(index*24,(index+1)*24).map(p=>({id:p.studentId,tone:p.correct?'correct':'wrong'}));
  await screen.waitForFunction(expected=>{
   const cards=[...document.querySelectorAll('article.answer-card:not(.empty-slot)')];
   return document.getElementById('screen-phase').textContent==='結果已揭曉'&&cards.length===expected.length&&cards.every((card,i)=>card.querySelector('.answer-seat')?.textContent===expected[i].id&&card.classList.contains(expected[i].tone)&&card.querySelector('img')?.complete&&card.querySelector('img')?.naturalWidth>0);
  },expected,{timeout:60000});
  for(const p of expected)seen.add(p.id);if(index+1<Math.ceil(ordered.length/24))await screen.locator('#wall-next').click();
 }
 report.screenVerified=seen.size===o.students;report.screenVerifiedStudents=seen.size;report.resultsVisibleAt=Date.now();
 report.stage='next-question';report.resultDisplaySeconds=8;report.resultInspectionMs=Date.now()-report.revealedObservedAt;report.resultDisplayExtensionMs=Math.max(0,report.resultInspectionMs-8000);report.remainingResultDisplayMs=Math.max(0,8000-report.resultInspectionMs);
 console.log('全部 AI 結果已公布；自公布起滿 8 秒後測試下一題。');await wait(report.remainingResultDisplayMs);
 await teacher.locator('#start-button').click({timeout:60000});
 const next=await waitForRoundStart({wait,room,mode:'live',previousRound:roundId,readState:()=>act(teacher,'stateOnce')});report.nextRoundId=next.room.round.id;
 await Promise.all(clients.map(async c=>{
  try{await c.frame.waitForFunction(number=>!document.getElementById('submit-button').disabled&&document.getElementById('canvas-lock').hidden&&document.body.dataset.verdict===''&&document.getElementById('play-round').textContent.includes('第 '+String(number).padStart(2,'0')),next.room.round.number,{timeout:60000});c.row.nextReady=true;}
  catch{c.row.nextReady=false;}
 }));
 await screen.waitForFunction(number=>document.getElementById('screen-round').textContent.includes('第 '+String(number).padStart(2,'0'))&&document.querySelectorAll('#screen-grid img').length===0,next.room.round.number,{timeout:60000});
 report.nextQuestionReady=clients.every(c=>c.row.nextReady);report.nextReadyObservedAt=Date.now();
 if(!report.nextQuestionReady)throw Error('部分學生頁尚未進入下一題可作答狀態');
 const nextReady=await act(teacher,'stateOnce');if(nextReady.room?.code!==room||nextReady.room?.round?.id!==report.nextRoundId)throw Error('確認下一題時房間或題目已變更');report.nextReadyServerTime=nextReady.room.serverTime;
 report.timingSeconds=timingSummary(report);console.log('AI 評分、公布、學生與大螢幕結果、下一題均已確認。');return revealed;
}
export async function main(args=process.argv.slice(2)){
 const o=options(args);let chromium;
 try{({chromium}=await import('../.local/ui-loadtest/node_modules/playwright-core/index.mjs'));}
 catch{throw Error('請執行 oneword/TEST_GAS_30.cmd，首次會安裝測試所需套件。');}
 const report={runnerVersion,stage:'setup',startedAt:new Date().toISOString(),requestedStudents:o.students,seconds:o.seconds,sendAt:o.sendAt,openedPages:0,realDrive:false,mode:o.mode,students:[],events:[],completed:false},title='OneWord '+(o.mode==='live'?'AI ':'')+'壓測 '+new Date().toISOString().slice(0,19);
 let browser,teacher,createdCode='',createdRound='';const rl=createInterface({input:stdin,output:stdout});
 const outDir=new URL('../.local/gas-loadtest/',import.meta.url);await mkdir(outDir,{recursive:true});
 const outFile=new URL('gas-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',outDir);
 try{
  browser=await chromium.launch({channel:o.channel,headless:false,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const teacherContext=await browser.newContext({viewport:{width:1440,height:1000}});teacher=await teacherContext.newPage();
  report.openedPages++;
  await teacher.goto(new URL('teacher.html',o.site).href,{waitUntil:'domcontentloaded',timeout:60000});
  console.log('測試規模：'+o.students+' 個學生頁＋教師＋大螢幕。'+(o.mode==='live'?'使用 AI 正式判讀，會呼叫 API 並產生費用。':'使用流程演練，會實際存圖至 Drive，不呼叫 AI。'));
  console.log('測試工具版本：'+runnerVersion);
  await rl.question('請在剛開啟的瀏覽器登入教師端，完成後回此視窗按 Enter：');
  await teacher.locator('#teacher-app').waitFor({state:'visible',timeout:30000});
  let admin=await teacherAction(teacher,'state');
  report.gasReached=true;
  if(o.mode==='live')console.log('測試筆跡固定寫「木」，成語答案隨機；答對、答錯都算完成判讀，不以答對率判定通過。');
  if(o.mode==='live'&&!admin.settings?.configured)throw Error('GAS 尚未設定 AI 金鑰，請先在教師端完成設定');
  report.judgingEngine=admin.features?.batchJudging?'gas-batch':'single-answer';
   report.aiSettings={model:admin.settings?.model,concurrency:admin.settings?.concurrency};
  if(admin.room&&!admin.room.ended)throw Error('目前還有未結束的測驗。請在教師端先結束，再重新執行壓測；本工具未變更該測驗。');
  await teacher.locator('#new-room-button').click();await teacher.locator('#new-title').fill(title);
  await teacher.locator('#mode-choice-'+o.mode).check();await teacher.locator('#room-create-submit').click();
  await teacher.locator('#room-dialog').waitFor({state:'hidden',timeout:60000});
  admin=await teacherAction(teacher,'state');
  if(admin.room?.title!==title||admin.room?.mode!==o.mode)throw Error('未成功建立指定判讀方式的獨立測驗');
  createdCode=admin.room.code;report.room=createdCode;report.backendVersion=admin.version;
  console.log('GAS 後端版本：'+admin.version);
  const studentURL=await teacher.locator('#join-url').inputValue();
  if(new URL(studentURL).hostname!=='script.google.com'||!studentURL.includes('view=student'))throw Error('教師端未提供 GAS 平板模式網址，請先更新程式');
  const screenContext=await browser.newContext({viewport:{width:1920,height:1080}}),screen=await screenContext.newPage();await screen.goto(new URL('screen.html?room='+createdCode,o.site).href,{waitUntil:'domcontentloaded',timeout:60000});
  report.openedPages++;
  const clients=[];
  report.stage='join';
  await pool(allowedIds.slice(0,o.students),4,async(id,index)=>{
   const row={studentId:id,joined:false,attempts:0,serverSaved:false,uiConfirmed:false,imageVerified:false};report.students.push(row);
   const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true}),page=await context.newPage();
   report.openedPages++;
   await page.exposeBinding('onewordProbe',(_source,event)=>{
    const item={studentId:id,...event};report.events.push(item);
    if(event.kind==='submit-start')row.attempts++;
    if(event.kind==='image-hash')row.imageHash=event.hash;
    if(event.kind==='submit-error')row.lastError={status:event.status,message:event.message};
   });
   await page.goto(studentURL,{waitUntil:'domcontentloaded',timeout:60000});const frame=await appFrame(page);
   await frame.evaluate(()=>{
    const original=window.nativeRPC;if(typeof original!=='function')throw Error('找不到平板模式 RPC');
    window.nativeRPC=async function(action,data,auth,retries){
     if(action!=='submit')return original(action,data,auth,retries);
     const at=Date.now();window.onewordProbe({kind:'submit-start',at});
     crypto.subtle.digest('SHA-256',new TextEncoder().encode(data.image)).then(d=>window.onewordProbe({kind:'image-hash',hash:[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')})).catch(()=>{});
     try{const result=await original(action,data,auth,retries);window.onewordProbe({kind:'submit-response',at:Date.now(),elapsedMs:Date.now()-at});return result;}
     catch(error){window.onewordProbe({kind:'submit-error',at:Date.now(),elapsedMs:Date.now()-at,status:error.status||0,message:String(error.message).slice(0,240)});throw error;}
    };
   });
   await frame.locator('#join-student-id').fill(id);await frame.locator('#join-name').fill('壓測'+(index+1));await frame.locator('#join-submit').click();
   await frame.locator('#writing-panel').waitFor({state:'visible',timeout:120000});row.joined=true;clients.push({page,frame,row,index});console.log('已加入 '+id);
  });
  report.stage='start';report.startChecks=[];
  await teacher.locator('#auto-enabled').uncheck();await teacher.locator('#seconds').fill(String(o.seconds));await teacher.locator('#start-button').click();
  // The UI disables the button before awaiting GAS. A disabled button is not a start receipt.
  console.log('開始出題，等待 GAS 確認作答階段…');
  try{admin=await waitForRoundStart({room:createdCode,mode:o.mode,readState:()=>teacherAction(teacher,'stateOnce'),sample:s=>report.startChecks.push(s)});}
  catch(error){
   try{report.startUI=await teacher.evaluate(()=>({toast:document.getElementById('toast')?.textContent||'',toastError:document.getElementById('toast')?.classList.contains('error')||false,startDisabled:document.getElementById('start-button')?.disabled,invalidFields:[...document.querySelectorAll('#question-form input, #question-form textarea')].filter(el=>!el.validity.valid).map(el=>({id:el.id,message:el.validationMessage}))}));}catch{}
   throw Error(error.message+(report.startUI?.toastError&&report.startUI.toast?'；教師端：'+report.startUI.toast:''));
  }
  createdRound=admin.room.round.id;report.roundId=createdRound;report.stage='draw';console.log('GAS 已確認題目開始，準備手寫。');
  report.actualSeconds=admin.room.round.seconds;if(Number.isFinite(report.actualSeconds)&&report.actualSeconds!==o.seconds)throw Error('GAS 實際作答秒數與指定不同，停止測試以免時間紀錄失準');
  report.roundStartObservedAt=Date.now();report.serverRoundStartedAt=admin.room.round.deadline-(report.actualSeconds||o.seconds)*1000;report.testInk='木（固定筆跡，只驗證效能與流程，不以答對率判定通過）';
  await Promise.all(clients.map(c=>writeCharacter(c.page,c.frame,c.index)));
  let target=Date.now()+2000;
  if(o.sendAt!==null){admin=await teacherAction(teacher,'state');const start=report.serverRoundStartedAt,delay=start+o.sendAt*1000-admin.room.serverTime;if(delay<1000)throw Error('手寫準備完成時已超過指定送出時間，請增加 --seconds 或 --send-at');target=Date.now()+delay;}
  report.uploadBarrierAt=target;
  report.stage='upload';
  console.log('手寫完成，即將同步送出 '+clients.length+' 張圖片。');
  await Promise.all(clients.map(async c=>{c.row.clickedAt=await c.frame.evaluate(target=>new Promise(resolve=>setTimeout(()=>{const at=Date.now();document.getElementById('submit-button').click();resolve(at);},Math.max(0,target-Date.now()))),target);}));
  const end=Date.now()+o.timeout*1000;let lastCount=-1;
  while(Date.now()<end){
   admin=await teacherAction(teacher,'state');if(admin.room?.code!==createdCode||admin.room?.round?.id!==createdRound)throw Error('測試期間房間或題目被切換');
   await observeStudents(clients,admin.room);
   const count=clients.filter(c=>c.row.serverSaved).length;if(count!==lastCount){console.log('雲端已保存 '+count+'/'+o.students);lastCount=count;}
   report.realDrive=count>0;
   if(clients.every(c=>c.row.serverSaved&&c.row.uiConfirmed)){report.completed=true;report.allUploadsConfirmedAt=Date.now();break;}await sleep(3000);
  }
  // A final state read may be newer than the last monitoring iteration.
  admin=await teacherAction(teacher,'stateOnce');if(admin.room?.code!==createdCode||admin.room?.round?.id!==createdRound)throw Error('結算時房間或題目被切換');
  await observeStudents(clients,admin.room);report.finalStateObservedAt=Date.now();
  if(['closed','revealed','cancelled'].includes(admin.room.round.phase)){
   report.stage='verify';
   const hashes=await teacherAction(teacher,'imageHashes',{room:createdCode,roundId:createdRound});report.returnedImageCount=Object.keys(hashes).length;
   verifySavedImages(clients.map(c=>c.row),admin.room.players,hashes);report.imagesObservedAt=Date.now();
   await observeStudents(clients,admin.room);
  }
  report.completed=clients.every(c=>c.row.serverSaved&&c.row.uiConfirmed);
  if(report.completed&&!report.allUploadsConfirmedAt)report.allUploadsConfirmedAt=Date.now();
  report.uploadCompleted=report.completed;
  if(o.mode==='live'&&report.completed&&!clients.every(c=>c.row.imageVerified))throw Error('原圖尚未全部核對成功，停止完整 AI 流程測試');
  if(o.mode==='live'&&report.completed&&clients.every(c=>c.row.imageVerified))admin=await completeLiveRound({teacher,screen,clients,report,o,room:createdCode,roundId:createdRound});
  for(const c of clients)if(!c.row.uiConfirmed)c.row.uiMessage=await c.frame.locator('#play-message').innerText();
  report.serverTiming=admin.room.round.performance;report.phase=admin.room.round.phase;
  report.stage=report.completed?'complete':'upload-timeout';
  if(!report.completed){report.failedStage='upload';report.error='等待所有圖片保存與學生端確認逾時';console.error(report.error);}
 }catch(error){report.completed=false;report.failedStage=report.stage;report.error=String(error.message).slice(0,1200);console.error(report.error);}
 finally{
  if(createdCode&&!o.keepRoom&&teacher)try{const s=await teacherAction(teacher,'state');if(s.room?.code===createdCode&&s.room?.title===title){await teacherAction(teacher,'end',{room:createdCode});report.testRoomEnded=true;}}catch{report.cleanupError='測試房間未自動結束，請到教師端手動結束';}
  report.finishedAt=new Date().toISOString();report.timingSeconds=timingSummary(report);report.summary=summarize(report);await writeFile(outFile,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report.summary,null,2));console.log('報告：'+fileURLToPath(outFile));rl.close();await browser?.close();
 }
 if(!report.summary.passed)process.exitCode=1;return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
