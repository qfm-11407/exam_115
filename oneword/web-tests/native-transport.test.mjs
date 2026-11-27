import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../scripts/native-transport.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const timers=new Map(),calls=[];let sequence=0;
 const runner=(success,failure)=>({withSuccessHandler(fn){return runner(fn,failure)},withFailureHandler(fn){return runner(success,fn)},rpc(action,data,auth){calls.push({action,data,auth,success,failure});}});
 const context={URL,Promise,Math,Object,Error,String,offset:0,liveState:null,connection(){},toast(){},setTimeout:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),google:{script:{run:runner()}}};
 vm.runInNewContext(source+'\nglobalThis.exports={nativeRPC,api,connect};',context);
 const fire=delay=>{const item=[...timers.entries()].find(([id,timer])=>timer.delay===delay);assert.ok(item,'Missing timer '+delay);timers.delete(item[0]);item[1].fn();};
 return{calls,timers,fire,...context.exports};
}
test('a missing native join response retries the identical device claim and ignores the late original response',async()=>{
 const f=fixture(),claim='a'.repeat(64),pending=f.api('/api/join',{room:'ABCDEF',studentId:'1410701',joinKey:claim});
 assert.equal(f.calls.length,1);f.fire(20000);await tick();f.fire(700);await tick();assert.equal(f.calls.length,2);
 assert.equal(f.calls[0].data.joinKey,claim);assert.equal(f.calls[1].data.joinKey,claim);
 f.calls[1].success({ok:true,data:{token:'same-student-token'}});assert.equal((await pending).token,'same-student-token');
 f.calls[0].success({ok:true,data:{token:'late-response'}});assert.equal(f.timers.size,0);
});
test('a duplicate-account or revoked-device error is surfaced without retrying',async()=>{
 const f=fixture(),pending=f.api('/api/join',{room:'ABCDEF',studentId:'1410701',joinKey:'b'.repeat(64)});
 f.calls[0].success({ok:false,status:409,error:'This account is already joined',retryable:false});
 await assert.rejects(pending,error=>error.status===409);assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
});
test('the native student transport forwards its own token for submissions and never requests teacher settings',async()=>{
 const f=fixture(),pending=f.api('/api/submit',{room:'ABCDEF',roundId:'r1',image:'data:image/png;base64,TEST'},'student-token');
 assert.equal(f.calls[0].action,'submit');assert.equal(f.calls[0].auth,'student-token');f.calls[0].success({ok:true,data:{ok:true}});assert.equal((await pending).ok,true);
 await assert.rejects(f.api('/api/admin/settings',{}));assert.equal(f.calls.length,1);
});


test('native student polling accelerates near the writing deadline and closes without leaving a polling timer',async()=>{
 for(const phase of ['writing','collecting']){const f=fixture(),connection=f.connect('ABCDEF',()=>{});assert.equal(f.calls.length,1);const now=Date.now();f.calls[0].success({ok:true,data:{revision:1,serverTime:now,round:{id:'r1',phase,deadline:now+3000}}});await tick();const delays=[...f.timers.values()].map(timer=>timer.delay);assert.equal(delays.length,1);assert.ok(delays[0]>=2500&&delays[0]<3300);connection.close();assert.equal(f.timers.size,0);}
});
