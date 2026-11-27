import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {fixture} from '../web-tests/helpers/gas-fixture.mjs';
import {pageFixture} from '../web-tests/helpers/frontend-fixture.mjs';

const ids=[...Array.from({length:15},(_,i)=>String(1410701+i)),...Array.from({length:13},(_,i)=>String(1420716+i))];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
// A header fixture exercises validation; this is not an actual Drive or browser test.
const bytes=Buffer.alloc(64);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);Buffer.from('IHDR').copy(bytes,12);bytes.writeUInt32BE(512,16);bytes.writeUInt32BE(512,20);
const image='data:image/png;base64,'+bytes.toString('base64');
export async function simulateClients({nativeHTML}={}){
 const gas=fixture(),room=gas.room(),clock={now:gas.state.now},start=clock.now,clients=[],attempts=new Map(),events=[];
 const reply=r=>({status:r.ok?200:r.status,body:r.ok?r.data:{error:r.error,retryable:r.retryable}});
 const teacher=await pageFixture('teacher',async()=>reply(gas.call('adminState',{},gas.auth)),{clock,roomCode:room.code,workerRun:async()=>({idle:true})});
 const screen=await pageFixture('screen',async()=>{throw Error('Unexpected screen write');},{clock,roomCode:room.code});
 for(const [index,id] of ids.entries()){
  let identity;
  const client=await pageFixture('play',async(route,options)=>{
   const data=options?.body?JSON.parse(options.body):{};
   if(route==='/api/join'){const r=gas.call('join',data);identity=r.data;return reply(r);}
   if(route.startsWith('/api/room'))return reply(gas.call('room',{room:room.code}));
   if(route==='/api/student-worker')return{status:200,body:{idle:true}};
   assert.equal(route,'/api/submit');const n=(attempts.get(id)||0)+1;attempts.set(id,n);
   await tick();
   // All sends start together. First four work; the rest encounter two busy responses.
   if(index>=4&&n<=2){events.push({ms:clock.now-start,id,attempt:n,status:429});return{status:429,body:{error:'目前交卷較多，請稍後重試',retryable:true}};}
   if(index===5&&n===3)gas.state.createHook=()=>{throw Error('Injected Drive interruption');};
   const r=gas.call('submit',data,identity.token);gas.state.createHook=null;
   if(index===4&&n===3&&r.ok){events.push({ms:clock.now-start,id,attempt:n,status:503,lostResponse:true});return{status:503,body:{error:'Injected response loss',retryable:true}};}
   events.push({ms:clock.now-start,id,attempt:n,status:r.ok?200:r.status});return reply(r);
  },{native:true,nativeHTML,clock,roomCode:room.code,image});
  client.get('join-code').value=room.code;client.get('join-student-id').value=id;
  await client.get('join-form').onsubmit({preventDefault(){}});await tick();
  assert.equal(client.get('writing-panel').hidden,false);clients.push(client);
 }
 gas.start(room.code);const snapshot=gas.call('room',{room:room.code}).data;
 screen.events[0].send(snapshot);
 for(const client of clients){const timer=client.timeouts.find(t=>!t.cancelled&&t.delay>=2500&&t.delay<4300);assert.ok(timer);timer.cancelled=true;await timer.fn();await tick();const canvas=client.get('handwriting');canvas.events.pointerdown({pointerType:'pen',pointerId:1,clientX:40,clientY:40,preventDefault(){}});canvas.events.pointerup({pointerId:1});}
 // The barrier releases all 28 actual native student controllers in the same turn.
 const firstWave=clients.map(c=>c.get('submit-button').onclick());
 for(let i=0;i<4;i++)await tick();
 for(let ms=500;ms<=60000;ms+=500){
  clock.now=start+ms;gas.state.now=clock.now;
  for(const client of [...clients,teacher]){
   const due=client.timeouts.filter(t=>!t.cancelled&&t.at<=clock.now);for(const t of due){t.cancelled=true;t.fn();}
  }
  for(let i=0;i<4;i++)await tick();
  if(gas.admin().round.submitted===ids.length)break;
 }
 await Promise.all(firstWave);await tick();
 const state=gas.admin(),saved=[...gas.files.values()].filter(f=>f.name.endsWith('.png'));
 const report={kind:'local-controller-simulation',realGAS:false,realBrowser:false,realDrive:false,clients:30,studentControllers:28,teacherControllers:1,screenControllers:1,initialSuccesses:4,submitted:state.round.submitted,files:saved.length,elapsedVirtualMs:clock.now-start,totalSubmitCalls:[...attempts.values()].reduce((a,b)=>a+b,0),duplicateFiles:saved.length-state.round.submitted,allConfirmed:clients.every(c=>c.get('submit-button').disabled&&c.get('submit-button').textContent.includes('已送出')),attempts:Object.fromEntries(attempts),events};
 assert.equal(gas.state.aiCalls,0);return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const before=process.argv.includes('--before');let nativeHTML;
 if(before)nativeHTML=await readFile(new URL('../.local/Student-before-retry.html',import.meta.url),'utf8');
 const report=await simulateClients({nativeHTML});
 await mkdir(new URL('../.local/',import.meta.url),{recursive:true});
 await writeFile(new URL('../.local/simulation-'+(before?'before':'after')+'.json',import.meta.url),JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,attempts:undefined,events:undefined},null,2));
 if(!before){assert.equal(report.submitted,28);assert.equal(report.files,28);assert.equal(report.duplicateFiles,0);assert.equal(report.allConfirmed,true);}
}
