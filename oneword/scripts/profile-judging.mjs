// Actual backend under mock services. Operation counts only; never a GAS latency benchmark.
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from '../web-tests/helpers/gas-fixture.mjs';
import {allowedIds} from './gas-ui-loadtest.mjs';
const bytes=Buffer.alloc(64);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(512,16);bytes.writeUInt32BE(512,20);
const image='data:image/png;base64,'+bytes.toString('base64');
function profile(batch){
 const f=fixture();f.call('settings',{key:'sk-test-not-a-real-key',model:'gpt-4.1-mini',concurrency:2},f.auth);
 const room=f.room('live'),players=allowedIds.map(studentId=>f.call('join',{room:room.code,studentId}).data);f.start(room.code);const roundId=f.admin().round.id;
 for(const p of players){const reply=f.call('submit',{room:room.code,roundId,image},p.token);if(!reply.ok)throw Error(reply.error);}
 const before={commits:f.state.propertyCommits,locks:f.state.lockAcquisitions};let requests=0;
 if(batch){let reply;do{requests++;reply=f.call('workerBatch',{room:room.code,roundId},f.auth);if(!reply.ok)throw Error(reply.error);}while(reply.data.remainingQueued);}
 else for(let i=0;i<28;i++){requests++;const reply=f.call('worker',{room:room.code,roundId},f.auth);if(!reply.ok)throw Error(reply.error);}
 return{teacherWorkerRequests:requests,stateCommits:f.state.propertyCommits-before.commits,lockAcquisitions:f.state.lockAcquisitions-before.locks,aiCalls:f.state.aiCalls,fetchAllBatches:f.state.fetchBatches.length,judged:f.admin().round.judged};
}
const report={kind:'mock-judging-operation-count',realGAS:false,realAI:false,latencyMeasured:false,scope:'teacher-driven judging only; excludes upload, polling and student workers',concurrency:2,before:profile(false),after:profile(true)};
await mkdir(new URL('../.local/',import.meta.url),{recursive:true});await writeFile(new URL('../.local/judging-profile.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
