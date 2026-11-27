import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const raw=await readFile(new URL('../transport.js',import.meta.url),'utf8');
function fixture(gasUrl='',search=''){
  const listeners=new Set(),frames=[],posted=[],session=new Map();const peer={postMessage:(message,origin)=>posted.push({message,origin})};
  const sandbox={config:{gasUrl,pollMs:3500},location:{href:'https://school.github.io/classboard/oneword/teacher.html',search,origin:'https://school.github.io'},URL,URLSearchParams,crypto:webcrypto,Uint8Array,Map,Promise,setTimeout,clearTimeout,localStorage:{getItem:()=>''},sessionStorage:{getItem:k=>session.get(k),setItem:(k,v)=>session.set(k,v)},window:{addEventListener:(t,fn)=>listeners.add(fn),removeEventListener:(t,fn)=>listeners.delete(fn)},document:{createElement:()=>({remove(){}}),body:{append:frame=>frames.push(frame)}}};
  const code=raw.replace(/import \{ config \} from '\.\/config\.js(?:\?[^']*)?';/,'').replace(/export /g,'').replace('{ validBackend, trustedGoogleOrigin };','')+'\nglobalThis.exports={GASClient,validBackend,trustedGoogleOrigin,defaultClient:client};';
  vm.runInNewContext(code,sandbox);const {GASClient,validBackend,trustedGoogleOrigin}=sandbox.exports;
  const client=new GASClient('https://script.google.com/macros/s/TEST_DEPLOYMENT/exec');
  const emit=(data,origin='https://abc-script.googleusercontent.com',source=peer)=>listeners.forEach(fn=>fn({data,origin,source}));
  const ready=()=>emit({type:'oneword:ready',channel:client.channel});
  const reply=(request,data,overrides={})=>emit({type:'oneword:response',channel:client.channel,id:request.id,reply:{ok:true,data},...overrides});
  return{sandbox,client,frames,posted,emit,ready,reply,peer,session,validBackend,trustedGoogleOrigin,defaultClient:sandbox.exports.defaultClient};
}
const tick=()=>new Promise(r=>setImmediate(r));

test('bridge handshake pins the Google source, rejects forged origins/channels and returns the actual RPC result',async()=>{
  const f=fixture();try{
    const task=f.client.rpc('ping',{},'');assert.equal(f.frames.length,1);assert.equal(f.frames[0].hidden,true);f.ready();await tick();
    const request=f.posted[0].message;assert.equal(f.posted[0].origin,'https://abc-script.googleusercontent.com');
    f.emit({type:'oneword:response',channel:f.client.channel,id:request.id,reply:{ok:true,data:'forged'}},'https://evil.invalid');assert.equal(f.client.pending.size,1);
    f.emit({type:'oneword:response',channel:f.client.channel,id:request.id,reply:{ok:true,data:'forged'}},'https://abc-script.googleusercontent.com',{});assert.equal(f.client.pending.size,1);
    f.reply(request,{ready:true});assert.equal((await task).ready,true);
  }finally{f.client.dispose();}
});

test('batch grading keeps the long worker response window instead of timing out as an ordinary short RPC',async()=>{
 const f=fixture(),timers=new Map();let serial=0;
 f.sandbox.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,delay});return id;};f.sandbox.clearTimeout=id=>timers.delete(id);
 try{const task=f.client.rpc('workerBatch',{room:'ABCDEF',roundId:'r1'},'teacher-token');f.ready();await tick();assert.ok([...timers.values()].some(t=>t.delay===170000));assert.ok(![...timers.values()].some(t=>t.delay===60000));
  f.reply(f.posted[0].message,{processed:true,processedCount:28,remainingQueued:0});assert.equal((await task).processedCount,28);assert.equal(timers.size,0);
 }finally{f.client.dispose();}
});

test('page links preserve the GitHub repository/subfolder path and carry a non-secret GAS URL',()=>{
  const f=fixture();try{const u=new URL(f.client.pageURL('student.html','A1B2C3'));assert.equal(u.pathname,'/classboard/oneword/student.html');assert.equal(u.searchParams.get('room'),'A1B2C3');assert.equal(u.searchParams.get('backend'),f.client.backend);assert.equal(u.searchParams.has('token'),false);assert.equal(u.searchParams.has('pin'),false);}finally{f.client.dispose();}
});

test('only real deployed GAS endpoints and trusted Google origins are accepted',()=>{
  const f=fixture();assert.equal(f.validBackend('https://script.google.com/macros/s/ABC/exec'),true);assert.equal(f.validBackend('https://script.google.com/macros/s/ABC/dev'),false);assert.equal(f.validBackend('https://script.google.com.evil.invalid/macros/s/ABC/exec'),false);assert.equal(f.trustedGoogleOrigin('https://evil-googleusercontent.com'),false);assert.equal(f.trustedGoogleOrigin('http://abc.googleusercontent.com'),false);
});

test('Drive images are fetched only after close and reused when revealing results',async()=>{
  const f=fixture();let calls=0;f.client.rpc=async(action,data)=>{assert.equal(action,'images');calls++;return{p1:'data:image/png;base64,TEST'}};
  const state={code:'ABCDEF',round:{id:'r1',phase:'writing'},players:[{id:'p1',imageUrl:null}]};await f.client.hydrate(state);assert.equal(calls,0);state.round.phase='closed';state.players[0].imageUrl='gas-image:r1/p1';const hydrated=await f.client.hydrate(state);assert.ok(hydrated.players[0].imageUrl.startsWith('data:image/png'));state.round.phase='revealed';await f.client.hydrate(state);assert.equal(calls,1);
});

test('Bridge.html enforces configured parent origins and uses the top-level hosting page through the Google wrapper',async()=>{
  const text=await readFile(new URL('../gas/Bridge.html',import.meta.url),'utf8'),script=text.match(/<script>([\s\S]+)<\/script>/)[1].replace('<?!= boot ?>',JSON.stringify({channel:'channel',origins:['https://school.github.io']}));
  let handler,calls=0;const messages=[],top={postMessage:(m,o)=>messages.push({m,o})};const run={withSuccessHandler(fn){this.success=fn;return this},withFailureHandler(fn){this.failure=fn;return this},rpc(){calls++;this.success({ok:true,data:{ready:true}})}};
  vm.runInNewContext(script,{window:{top,addEventListener:(name,fn)=>{handler=fn}},google:{script:{run}}});assert.equal(messages[0].m.type,'oneword:ready');
  handler({data:{type:'oneword:request',channel:'channel',id:'1',action:'ping'},origin:'https://evil.invalid',source:top});assert.equal(calls,0);assert.equal(messages.at(-1).m.reply.status,403);
  handler({data:{type:'oneword:request',channel:'channel',id:'2',action:'ping'},origin:'https://school.github.io',source:top});assert.equal(calls,1);assert.equal(messages.at(-1).o,'https://school.github.io');
});


test('configured classroom Workspace endpoint works by default without stored settings or backend query parameters',async()=>{
  const configuration=await readFile(new URL('../config.js',import.meta.url),'utf8');
  const url=configuration.match(/gasUrl:\s*'([^']+)'/)[1];
  assert.equal(url,"https://script.google.com/a/macros/mail.qfm.kh.edu.tw/s/AKfycbxADqWGu8UA_WDFWMJpal6HECz4IRgtMjJdnSRuaps757S2Hv3Cy_IP-9c71m-HxxU3zg/exec");
  const f=fixture(url);
  try{assert.equal(f.validBackend(url),true);assert.equal(f.defaultClient.backend,url);
    const link=new URL(f.defaultClient.pageURL('student.html','ABCDEF'));
    assert.equal(link.pathname,'/classboard/oneword/student.html');assert.equal(link.searchParams.has('backend'),false);
    assert.equal(f.validBackend(url.replace('/exec','/dev')),false);
    assert.equal(f.validBackend(url.replace('https://script.google.com/','https://script.google.com.evil.invalid/')),false);
    assert.equal(f.validBackend(url.replace('mail.qfm.kh.edu.tw','mail.qfm.kh.edu.tw/other')),false);
  }finally{f.client.dispose();f.defaultClient.dispose();}
});


test('an invalid backend query cannot disable the configured classroom connection',()=>{
  const url='https://script.google.com/a/macros/mail.qfm.kh.edu.tw/s/CLASSROOM/exec';
  const f=fixture(url,'?backend=https%3A%2F%2Finvalid.example');
  try{assert.equal(f.defaultClient.backend,url);}finally{f.client.dispose();f.defaultClient.dispose();}
});

test('all HTML entries and the module chain use matching release identifiers to refresh cached configuration',async()=>{
  const configImport=raw.match(/from '\.\/config\.js\?v=([^']+)'/);
  assert.ok(configImport);
  const version=configImport[1];
  const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
  assert.ok(app.includes("from './transport.js?v="+version+"'"));
  for(const file of ['index.html','teacher.html','student.html','screen.html']){
    const html=await readFile(new URL('../'+file,import.meta.url),'utf8');
    assert.ok(html.includes('src="./app.js?v='+version+'"'),file);
  }
});


test('Workspace configuration loads the public entry with the same deployment and preserves existing identity keys',async()=>{
  const configuration=await readFile(new URL('../config.js',import.meta.url),'utf8');
  const backend=configuration.match(/gasUrl:\s*'([^']+)'/)[1];
  const f=fixture(backend);
  try{
    const connected=f.defaultClient.connect();
    const loaded=new URL(f.frames[0].src);
    const original=new URL(backend);
    assert.equal(loaded.origin,'https://script.google.com');
    assert.equal(loaded.pathname,'/macros/s/'+original.pathname.split('/').at(-2)+'/exec');
    assert.match(loaded.searchParams.get('channel'),/^[a-f0-9]{32}$/);
    assert.equal(f.defaultClient.backend,backend);
    f.emit({type:'oneword:ready',channel:f.defaultClient.channel});
    await connected;
  }finally{f.client.dispose();f.defaultClient.dispose();}
});


test('room management routes map to authenticated GAS actions and preserve the target room',async()=>{
  const f=fixture(),calls=[];f.client.token='teacher-session';f.client.rpc=async(...args)=>{calls.push(args);return{ok:true}};
  try{
    await f.client.request('/api/admin/rooms/list');
    for(const action of ['end','delete','select','remove-player'])await f.client.request('/api/admin/rooms/ABCDEF/'+action,{});
    assert.deepEqual(calls.map(c=>c[0]),['listRooms','endRoom','deleteRoom','selectRoom','removePlayer']);
    assert.ok(calls.every(c=>c[2]==='teacher-session'));assert.ok(calls.slice(1).every(c=>c[1].room==='ABCDEF'));
  }finally{f.client.dispose();f.defaultClient.dispose();}
});


test('direct student links use the public GAS route and never carry authentication or device secrets',()=>{
 const f=fixture('https://script.google.com/a/macros/mail.qfm.kh.edu.tw/s/CLASSROOM/exec');try{const url=new URL(f.defaultClient.studentURL('ABCDEF'));assert.equal(url.pathname,'/macros/s/CLASSROOM/exec');assert.deepEqual([...url.searchParams.keys()],['view','room']);assert.equal(url.searchParams.get('view'),'student');}finally{f.client.dispose();f.defaultClient.dispose();}
});


test('collecting snapshots never fetch or hydrate answer images',async()=>{
 const f=fixture();try{f.client.rpc=()=>{throw Error('Images must stay private')};const state={round:{id:'r1',phase:'collecting'},players:[{id:'p1',imageUrl:null}]};assert.equal(await f.client.hydrate(state),state);}finally{f.client.dispose();}
});


test('image hydration fetches only new player IDs, handles roster replacement at the same count, and refreshes on a new round',async()=>{
 const f=fixture(),requests=[];f.client.rpc=async(action,data)=>{requests.push([...data.playerIds]);return Object.fromEntries(data.playerIds.map(id=>[id,'data:image/png;base64,'+id]));};
 try{const state={code:'ABCDEF',round:{id:'r1',phase:'closed'},players:[{id:'p1',imageUrl:'gas-image:r1/p1'}]};await f.client.hydrate(state);state.players.push({id:'p2',imageUrl:'gas-image:r1/p2'});await f.client.hydrate(state);state.players[0]={id:'p3',imageUrl:'gas-image:r1/p3'};let hydrated=await f.client.hydrate(state);assert.equal(hydrated.players[0].imageUrl,'data:image/png;base64,p3');state.round.phase='revealed';await f.client.hydrate(state);assert.deepEqual(requests,[['p1'],['p2'],['p3']]);state.round={id:'r2',phase:'closed'};state.players=[{id:'p1',imageUrl:'gas-image:r2/p1'}];await f.client.hydrate(state);assert.deepEqual(requests.at(-1),['p1']);}finally{f.client.dispose();}
});

test('overlapping image hydration shares the in-flight request instead of downloading the same file twice',async()=>{
 const f=fixture();let resolve,calls=0;f.client.rpc=()=>{calls++;return new Promise(done=>resolve=done)};
 try{const state={code:'ABCDEF',round:{id:'r1',phase:'closed'},players:[{id:'p1',imageUrl:'gas-image:r1/p1'}]};const a=f.client.hydrate(state),b=f.client.hydrate(state);resolve({p1:'data:image/png;base64,TEST'});await Promise.all([a,b]);assert.equal(calls,1);}finally{f.client.dispose();}
});


test('screen polling is faster in grace while ordinary student polling stays at the configured interval',async()=>{
 for(const screen of [false,true]){const f=fixture(),timers=[];f.sandbox.setTimeout=(fn,delay)=>{timers.push({fn,delay});return timers.length};f.sandbox.clearTimeout=()=>{};f.client.rpc=async()=>({revision:1,serverTime:Date.now(),round:{id:'r1',phase:'collecting'},players:[]});let subscription;
 try{subscription=f.client.subscribe('ABCDEF',()=>{},()=>{},screen);await tick();assert.equal(timers.length,1);assert.ok(screen?timers[0].delay>=1200&&timers[0].delay<1500:timers[0].delay>=3500&&timers[0].delay<4300);}finally{subscription?.close();f.client.dispose();}}
});


test('automatic-series controls use authenticated routes and preserve the target room',async()=>{
 const f=fixture(),calls=[];f.client.token='teacher';f.client.rpc=async(...args)=>{calls.push(args);return{ok:true}};try{for(const action of ['start-series','pause-series','resume-series'])await f.client.request('/api/admin/rooms/ABCDEF/'+action,{totalQuestions:3});assert.deepEqual(calls.map(call=>call[0]),['start-series','pause-series','resume-series']);assert.ok(calls.every(call=>call[1].room==='ABCDEF'&&call[2]==='teacher'));}finally{f.client.dispose();}
});


test('teacher display settings map to an authenticated room action',async()=>{
 const f=fixture();f.client.token='teacher';let call;f.client.rpc=async(...args)=>{call=args;return{ok:true}};try{await f.client.request('/api/admin/rooms/ABCDEF/display',{columns:8});assert.equal(call[0],'display');assert.equal(call[1].room,'ABCDEF');assert.equal(call[1].columns,8);assert.equal(call[2],'teacher');}finally{f.client.dispose();}
});
