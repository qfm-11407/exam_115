async function nativeRPC(action,data={},auth='',retries=1){
  try{return await new Promise((resolve,reject)=>{
    let finished=false;
    const finish=(fn,value)=>{if(finished)return;finished=true;clearTimeout(timer);fn(value);};
    const timer=setTimeout(()=>finish(reject,Object.assign(new Error('GAS 回應逾時；重新按加入會恢復同一裝置的連線，不會重複加入'),{status:503,retryable:true})),action==='join'?20000:action==='studentWorker'?170000:60000);
    try{google.script.run.withSuccessHandler(reply=>{
      if(reply?.ok)finish(resolve,reply.data);
      else finish(reject,Object.assign(new Error(reply?.error||'GAS 未完成操作'),{status:reply?.status||503,retryable:Boolean(reply?.retryable)}));
    }).withFailureHandler(()=>finish(reject,Object.assign(new Error('教室雲端連線暫時中斷，請稍後重試'),{status:503,retryable:true}))).rpc(action,data,auth);}
    catch(error){finish(reject,Object.assign(new Error('教室雲端連線尚未就緒，請重新整理後再試'),{status:503,retryable:true}));}
  });}catch(error){if(retries>0&&error.retryable){await new Promise(resolve=>setTimeout(resolve,700));return nativeRPC(action,data,auth,retries-1);}throw error;}
}
async function api(route,data,token=''){
  const url=new URL(route,'https://oneword.invalid');let action,payload=data||{};
  if(url.pathname==='/api/join')action='join';
  else if(url.pathname==='/api/submit')action='submit';
  else if(url.pathname==='/api/room'){action='room';payload={room:url.searchParams.get('room')};}
  else throw new Error('找不到學生操作');
  // Submission retries belong to the student controller, which keeps one frozen answer.
  return nativeRPC(action,payload,token,action==='join'||action==='room'?1:0);
}
function connect(code,receive){
  let closed=false,timer,last='',latest=null;
  const poll=async()=>{try{const state=await api('/api/room?room='+encodeURIComponent(code));if(closed)return;latest=state;offset=state.serverTime-Date.now();liveState=state;connection(true);const version=state.revision+':'+state.round?.phase;if(last!==version){last=version;receive(state);}}
    catch(error){if(!closed){connection(false);toast(error.message,true);}}
    finally{if(!closed)timer=setTimeout(poll,(latest?.round&&(latest.round.phase==='collecting'||(latest.automation?.enabled&&latest.round.phase==='revealed')||(latest.round.phase==='writing'&&latest.round.deadline-latest.serverTime<=8000))?2500:3500)+Math.random()*800);}};
  poll();return{close(){closed=true;clearTimeout(timer);}};
}
