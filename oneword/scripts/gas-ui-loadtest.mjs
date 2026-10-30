// Run locally against the real deployed UI. No teacher PIN or player token is logged.
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const allowedIds=[...Array.from({length:15},(_,i)=>String(1410701+i)),...Array.from({length:13},(_,i)=>String(1420716+i))];
export function options(args){
 const o={site:'https://qfm-11407.github.io/exam_115/oneword/',seconds:180,timeout:180,students:28,sendAt:null,channel:'chrome',keepRoom:false};
 for(let i=0;i<args.length;i++){
  const arg=args[i];if(arg==='--keep-room'){o.keepRoom=true;continue;}
  const key=({'--site':'site','--seconds':'seconds','--timeout':'timeout','--students':'students','--send-at':'sendAt','--channel':'channel'})[arg];
  if(!key||!args[i+1])throw Error('Unknown or incomplete option: '+arg);o[key]=args[++i];
 }
 const site=new URL(o.site);if(site.protocol!=='https:'||!site.pathname.endsWith('/'))throw Error('--site must be an HTTPS OneWord directory ending in /');
 for(const key of ['seconds','timeout','students'])o[key]=Number(o[key]);
 if(!Number.isInteger(o.students)||o.students<1||o.students>28)throw Error('正式白名單只有 28 人；--students 必須是 1～28。');
 if(!Number.isInteger(o.seconds)||o.seconds<10||o.seconds>180)throw Error('--seconds 必須是 10～180。');
 if(!Number.isInteger(o.timeout)||o.timeout<30||o.timeout>600)throw Error('--timeout 必須是 30～600。');
 if(o.sendAt!==null){o.sendAt=Number(o.sendAt);if(!Number.isFinite(o.sendAt)||o.sendAt<0||o.sendAt>=o.seconds)throw Error('--send-at 必須小於作答秒數。');}
 if(!['chrome','msedge'].includes(o.channel))throw Error('--channel must be chrome or msedge');return o;
}
export function summarize(report){
 const rows=report.students||[],starts=rows.map(r=>r.clickedAt).filter(Number.isFinite);
 return{kind:'real-gas-browser-test',realGAS:report.gasReached===true,requestedStudentPages:report.requestedStudents,connectedStudents:rows.filter(r=>r.joined).length,totalPages:report.openedPages||0,submitted:rows.filter(r=>r.serverSaved).length,uiConfirmed:rows.filter(r=>r.uiConfirmed).length,imagesVerified:rows.filter(r=>r.imageVerified).length,submitCalls:rows.reduce((n,r)=>n+r.attempts,0),clickSpreadMs:starts.length?Math.max(...starts)-Math.min(...starts):null,passed:!report.error&&report.completed===true&&rows.length===report.requestedStudents&&rows.every(r=>r.joined&&r.serverSaved&&r.uiConfirmed&&r.imageVerified)};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
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
export async function main(args=process.argv.slice(2)){
 const o=options(args);let chromium;
 try{({chromium}=await import('../.local/ui-loadtest/node_modules/playwright-core/index.mjs'));}
 catch{throw Error('請執行 oneword/TEST_GAS_30.cmd，首次會安裝測試所需套件。');}
 const report={startedAt:new Date().toISOString(),requestedStudents:o.students,seconds:o.seconds,sendAt:o.sendAt,openedPages:0,realDrive:false,mode:'practice',students:[],events:[],completed:false},title='OneWord 壓測 '+new Date().toISOString().slice(0,19);
 let browser,teacher,createdCode='',createdRound='';const rl=createInterface({input:stdin,output:stdout});
 const outDir=new URL('../.local/gas-loadtest/',import.meta.url);await mkdir(outDir,{recursive:true});
 const outFile=new URL('gas-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',outDir);
 try{
  browser=await chromium.launch({channel:o.channel,headless:false,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const teacherContext=await browser.newContext({viewport:{width:1440,height:1000}});teacher=await teacherContext.newPage();
  report.openedPages++;
  await teacher.goto(new URL('teacher.html',o.site).href,{waitUntil:'domcontentloaded',timeout:60000});
  console.log('測試規模：'+o.students+' 個學生頁＋教師＋大螢幕。使用流程演練，會實際存圖至 Drive。');
  await rl.question('請在剛開啟的瀏覽器登入教師端，完成後回此視窗按 Enter：');
  await teacher.locator('#teacher-app').waitFor({state:'visible',timeout:30000});
  let admin=await teacherAction(teacher,'state');
  report.gasReached=true;
  if(admin.room&&!admin.room.ended)throw Error('目前還有未結束的測驗。請在教師端先結束，再重新執行壓測；本工具未變更該測驗。');
  await teacher.locator('#new-room-button').click();await teacher.locator('#new-title').fill(title);
  await teacher.locator('#mode-choice-practice').check();await teacher.locator('#room-create-submit').click();
  await teacher.locator('#room-dialog').waitFor({state:'hidden',timeout:60000});
  admin=await teacherAction(teacher,'state');
  if(admin.room?.title!==title||admin.room?.mode!=='practice')throw Error('未成功建立獨立的流程演練測驗');
  createdCode=admin.room.code;report.room=createdCode;report.backendVersion=admin.version;
  const studentURL=await teacher.locator('#join-url').inputValue();
  if(new URL(studentURL).hostname!=='script.google.com'||!studentURL.includes('view=student'))throw Error('教師端未提供 GAS 平板模式網址，請先更新程式');
  const screenContext=await browser.newContext({viewport:{width:1920,height:1080}}),screen=await screenContext.newPage();await screen.goto(new URL('screen.html?room='+createdCode,o.site).href,{waitUntil:'domcontentloaded',timeout:60000});
  report.openedPages++;
  const clients=[];
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
  await teacher.locator('#auto-enabled').uncheck();await teacher.locator('#seconds').fill(String(o.seconds));await teacher.locator('#start-button').click();
  await teacher.waitForFunction(()=>document.getElementById('start-button').disabled,{},{timeout:60000});
  admin=await teacherAction(teacher,'state');createdRound=admin.room?.round?.id;
  if(!createdRound||admin.room.mode!=='practice')throw Error('測試題目未開始');report.roundId=createdRound;
  await Promise.all(clients.map(c=>writeCharacter(c.page,c.frame,c.index)));
  let target=Date.now()+2000;
  if(o.sendAt!==null){admin=await teacherAction(teacher,'state');const start=admin.room.round.deadline-o.seconds*1000,delay=start+o.sendAt*1000-admin.room.serverTime;if(delay<1000)throw Error('手寫準備完成時已超過指定送出時間，請增加 --seconds 或 --send-at');target=Date.now()+delay;}
  report.uploadBarrierAt=target;
  console.log('手寫完成，即將同步送出 '+clients.length+' 張圖片。');
  await Promise.all(clients.map(async c=>{c.row.clickedAt=await c.frame.evaluate(target=>new Promise(resolve=>setTimeout(()=>{const at=Date.now();document.getElementById('submit-button').click();resolve(at);},Math.max(0,target-Date.now()))),target);}));
  const end=Date.now()+o.timeout*1000;let lastCount=-1;
  while(Date.now()<end){
   admin=await teacherAction(teacher,'state');if(admin.room?.code!==createdCode||admin.room?.round?.id!==createdRound)throw Error('測試期間房間或題目被切換');
   for(const c of clients){const p=admin.room.players.find(p=>p.studentId===c.row.studentId);c.row.serverSaved=Boolean(p?.submitted);c.row.judgeStatus=p?.judgeStatus;if(p?.error)c.row.serverError=p.error;
    c.row.uiConfirmed=await c.frame.locator('#submit-button').evaluate(el=>el.disabled&&el.textContent.includes('已送出'));if(c.row.serverSaved&&!c.row.savedObservedAt)c.row.savedObservedAt=Date.now();}
   const count=clients.filter(c=>c.row.serverSaved).length;if(count!==lastCount){console.log('雲端已保存 '+count+'/'+o.students);lastCount=count;}
   report.realDrive=count>0;
   if(clients.every(c=>c.row.serverSaved&&c.row.uiConfirmed)){report.completed=true;break;}await sleep(3000);
  }
  if(['closed','revealed','cancelled'].includes(admin.room.round.phase)){
   const hashes=await teacherAction(teacher,'imageHashes',{room:createdCode,roundId:createdRound});report.returnedImageCount=Object.keys(hashes).length;
   for(const c of clients){const p=admin.room.players.find(p=>p.studentId===c.row.studentId);c.row.imageVerified=Boolean(c.row.imageHash&&hashes[p?.id]===c.row.imageHash);}
  }
  for(const c of clients)if(!c.row.uiConfirmed)c.row.uiMessage=await c.frame.locator('#play-message').innerText();
  report.serverTiming=admin.room.round.performance;report.phase=admin.room.round.phase;
 }catch(error){report.error=String(error.message).slice(0,1200);console.error(report.error);}
 finally{
  if(createdCode&&!o.keepRoom&&teacher)try{const s=await teacherAction(teacher,'state');if(s.room?.code===createdCode&&s.room?.title===title){await teacherAction(teacher,'end',{room:createdCode});report.testRoomEnded=true;}}catch{report.cleanupError='測試房間未自動結束，請到教師端手動結束';}
  report.finishedAt=new Date().toISOString();report.summary=summarize(report);await writeFile(outFile,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report.summary,null,2));console.log('報告：'+fileURLToPath(outFile));rl.close();await browser?.close();
 }
 if(!report.summary.passed)process.exitCode=1;return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
