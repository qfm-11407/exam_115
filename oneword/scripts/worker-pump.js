// Runs inside the teacher controller. An idle/error result waits for the next state sync.
function createWorkerPump({run,changed,error}){
 let current=null,active=0;
 function same(target){return current&&current.code===target.code&&current.roundId===target.roundId&&current.enabled;}
 function pump(){
  if(!current?.enabled)return;
  const target={...current},limit=Math.min(target.limit,target.pending);
  while(active<limit){active++;(async()=>{
   try{while(same(target)){const result=await run({room:target.code,roundId:target.roundId});if(result?.processed)changed();if(!result?.processed||!result.remainingQueued)break;}}
   catch(problem){error(problem);}
   finally{active--;if(current&&(current.code!==target.code||current.roundId!==target.roundId))pump();}
  })();}
 }
 return {sync(state){current=state;pump();}};
}
