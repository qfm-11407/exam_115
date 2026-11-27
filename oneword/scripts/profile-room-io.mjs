// Counts service operations in the actual backend under mocked services; not a latency benchmark.
import {readFile,writeFile} from 'node:fs/promises';
import {fixture} from '../web-tests/helpers/gas-fixture.mjs';
const ids=[...Array.from({length:15},(_,i)=>String(1410701+i)),...Array.from({length:13},(_,i)=>String(1420716+i))];
const b=Buffer.alloc(64);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(512,16);b.writeUInt32BE(512,20);const image='data:image/png;base64,'+b.toString('base64');
function count(backendSource){
 const f=fixture(backendSource?{backendSource}:{}),room=f.room(),players=ids.map(studentId=>f.call('join',{room:room.code,studentId}).data);f.start(room.code);const roundId=f.admin().round.id,before={reads:f.state.roomReads,writes:f.state.roomWrites};
 for(const p of players){const r=f.call('submit',{room:room.code,roundId,image},p.token);if(!r.ok)throw Error(r.error);}
 for(let i=0;i<28;i++){const r=f.call('worker',{room:room.code},f.auth);if(!r.ok)throw Error(r.error);}
 return{roomFileReads:f.state.roomReads-before.reads,roomFileWrites:f.state.roomWrites-before.writes,imagesSaved:[...f.files.values()].filter(file=>file.name.endsWith('.png')).length,judged:f.admin().round.judged};
}
let before=null;try{before=count(await readFile(new URL('../.local/Code-before-state-2110.gs',import.meta.url),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const report={kind:'mock-service-operation-count',realGAS:false,latencyMeasured:false,before,after:count()};
await writeFile(new URL('../.local/room-io-profile.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
