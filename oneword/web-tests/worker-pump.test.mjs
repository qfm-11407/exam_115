import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../scripts/worker-pump.js',import.meta.url),'utf8');
const {createWorkerPump}=vm.runInNewContext(source+'\n;({createWorkerPump})');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){const calls=[],errors=[],changes=[];const pump=createWorkerPump({run:data=>new Promise((resolve,reject)=>calls.push({data,resolve,reject})),changed:()=>changes.push(true),error:error=>errors.push(error)});return{pump,calls,errors,changes};}
const state=()=>({code:'ABCDEF',roundId:'r1',pending:4,limit:2,enabled:true});

test('finishing a judgment immediately claims the next queued answer without another poll and respects the local concurrency limit',async()=>{
 const f=fixture();f.pump.sync(state());assert.equal(f.calls.length,2);f.pump.sync(state());assert.equal(f.calls.length,2);
 f.calls[0].resolve({processed:true,remainingQueued:2});await tick();assert.equal(f.calls.length,3);assert.equal(f.changes.length,1);
 f.calls[1].resolve({idle:true});f.calls[2].resolve({processed:true,remainingQueued:0});await tick();assert.equal(f.calls.length,3);assert.equal(f.changes.length,2);
});

test('idle responses and errors do not create a busy loop; the next explicit state sync can retry',async()=>{
 const f=fixture();f.pump.sync({...state(),limit:1});f.calls[0].resolve({idle:true});await tick();assert.equal(f.calls.length,1);f.pump.sync({...state(),limit:1});f.calls[1].reject(Error('temporary'));await tick();assert.equal(f.calls.length,2);assert.equal(f.errors.length,1);
});

test('ending a round stops job chaining and changing rooms never sends an old round ID into the new room',async()=>{
 const f=fixture();f.pump.sync({...state(),limit:1});f.pump.sync({...state(),enabled:false});f.calls[0].resolve({processed:true,remainingQueued:3});await tick();assert.equal(f.calls.length,1);
 f.pump.sync({...state(),limit:1});f.pump.sync({...state(),code:'123456',roundId:'new-round',limit:1});f.calls[1].resolve({processed:true,remainingQueued:3});await tick();assert.equal(f.calls.length,3);assert.equal(f.calls[2].data.room,'123456');assert.equal(f.calls[2].data.roundId,'new-round');f.calls[2].resolve({idle:true});await tick();
});
