import {webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
export async function pageFixture(page, responses, options={}) {
  const html=options.nativeHTML||await readFile(new URL(options.native?'../../gas/Student.html':`../../${page==='play'?'student':page==='home'?'index':page}.html`,import.meta.url),'utf8');
  const nodes=new Map();
  function element(id='') {
    const attrs={},classes=new Set();let ink=false;
    const ctx={clearRect(){ink=false;},beginPath(){},moveTo(){},lineTo(){},arc(){},fill(){ink=true;},stroke(){ink=true;},fillRect(){},drawImage(){},getImageData(){const data=new Uint8ClampedArray(128);if(ink)for(let i=3;i<data.length;i+=4)data[i]=255;return{data}}};
    return {id,hidden:false,value:'',textContent:'',innerHTML:'',disabled:false,events:{},className:'',classList:{toggle(c,on){if(on)classes.add(c);else classes.delete(c)},contains(c){return classes.has(c)}},
      addEventListener(event,fn){this.events[event]=fn},setAttribute(k,v){attrs[k]=v},getAttribute(k){return attrs[k]},getContext(){return ctx},getBoundingClientRect(){return{left:0,top:0,width:512,height:512}},setPointerCapture(){},toDataURL(){return options.image||'data:image/png;base64,TEST'},focus(){},select(){},showModal(){this.open=true},close(){this.open=false}};
  }
  for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){const node=element(match[1]);const value=match[0].match(/\bvalue="([^"]*)"/);if(value)node.value=value[1];node.hidden=/\bhidden\b/.test(match[0]);nodes.set(match[1],node);}
  const source=options.native?html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('<?!= boot ?>',JSON.stringify({room:options.roomCode||'ABCDEF',version:'2.4.0'})):(await readFile(new URL('../../canvas.js',import.meta.url),'utf8')).replace('export class InkPad','class InkPad')+'\n'+(await readFile(new URL('../../app.js',import.meta.url),'utf8')).replace("import { InkPad } from './canvas.js';",'').replace(/import \{ client, GASClient, saveBackend \} from '\.\/transport\.js(?:\?[^']*)?';/,'');
  const entryLinks=Array.from(html.matchAll(/<a[^>]*href="([.][/](?:teacher|student)[.]html)"[^>]*>/g),match=>({href:match[1],getAttribute(){return match[1]}}));
  const events=[],calls=[],store=new Map(),intervals=[],timeouts=[],confirmations=[],confirmState={answer:true},historyEntries=[],nativeCalls=[];
  const sessionStore=options.sessionStore||new Map(), downloads=[], objectURLs=new Map();
  class FixtureURL extends URL {
    static createObjectURL(blob){const url='blob:fixture/'+objectURLs.size;objectURLs.set(url,blob);return url;}
    static revokeObjectURL(url){objectURLs.delete(url);}
  }
  class Events{constructor(url){this.url=url;events.push(this)}close(){}send(state){this.onmessage({data:JSON.stringify(state)})}}
  const document={hidden:false,body:{dataset:{page}},getElementById:id=>nodes.get(id)||null,querySelectorAll:selector=>selector.includes('a[href=')?entryLinks:[],addEventListener(){},createElement:()=>element(),documentElement:{requestFullscreen:async()=>{}}};
  const clock=options.clock||{now:Date.now()};class Clock extends Date{constructor(...args){super(...(args.length?args:[clock.now]))}static now(){return clock.now}}
  const sandbox={document,EventSource:Events,URL,URLSearchParams,history:{replaceState:(state,title,url)=>historyEntries.push(url)},location:{search:'?room='+(options.roomCode||'ABCDEF'),hash:'',origin:'http://localhost:4178'},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},crypto:webcrypto,Uint8Array,navigator:{},confirm:message=>{confirmations.push(message);return confirmState.answer},console,setTimeout:(fn,delay)=>{timeouts.push({fn,delay,at:clock.now+delay});return timeouts.length},clearTimeout:id=>{if(timeouts[id-1])timeouts[id-1].cancelled=true},setInterval:fn=>{intervals.push(fn);return 1},Date:options.clock?Clock:Date,fetch:async(url,options)=>{calls.push({url,options});const result=await responses(url,options);if(url==='/api/admin/state'&&result.body?.settings)result.body={version:'2.2.0',features:{roomManagement:true},...result.body};if(url==='/api/admin/rooms/list'&&!result.body.rooms)result.body={rooms:[],active:''};return {ok:result.status<400,status:result.status,json:async()=>result.body}}};
  sandbox.sessionStorage={getItem:key=>sessionStore.get(key)||null,setItem:(key,value)=>sessionStore.set(key,value)};
  sandbox.Blob=Blob;
  sandbox.URL=FixtureURL;
  document.createElement=()=>Object.assign(element(),{click(){downloads.push({filename:this.download,blob:objectURLs.get(this.href)});}});
  sandbox.client={backend:'https://script.google.com/macros/s/TEST/exec',token:'test-teacher',request:async(url,data,token)=>{const r=await sandbox.fetch(url,data===undefined?undefined:{body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw Object.assign(new Error(body.error||'Request failed'),{status:r.status});return body;},rpc:options.workerRun|| (async()=>({idle:true})),studentURL:room=>'https://script.google.com/macros/s/TEST/exec?view=student'+(room?'&room='+room:''),pageURL:(file,room)=>'https://school.github.io/repo/oneword/'+file+'?room='+room,subscribe:(code,receive,onConnection)=>{const event=new Events(code);event.onmessage=e=>receive(JSON.parse(e.data));return event;}};
  if(options.native){
    const runner=(success,failure)=>({withSuccessHandler(fn){return runner(fn,failure)},withFailureHandler(fn){return runner(success,fn)},rpc(action,data,auth){
      nativeCalls.push({action,data,auth});
      const route=action==='room'?'/api/room?room='+data.room:action==='studentWorker'?'/api/student-worker':'/api/'+action;
      sandbox.fetch(route,action==='room'?undefined:{body:JSON.stringify(data)}).then(async response=>{const body=await response.json();success(response.ok?{ok:true,data:body}:{ok:false,status:response.status,error:body.error});}).catch(error=>failure(error));
    }});
    sandbox.google={script:{run:runner()}};
  }
  vm.runInNewContext(source,sandbox,{filename:`${page}-controller.js`});
  await new Promise(resolve=>setImmediate(resolve));
  return{entryLinks,nodes,events,calls,intervals,timeouts,document,store,sessionStore,downloads,confirmations,confirmState,historyEntries,nativeCalls,get:id=>nodes.get(id)};
}
