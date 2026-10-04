const clients=new Set();
const BUFFER_LIMIT=128*1024;
const recent=[];
let recentBytes=0;
let source="idle";

function canStart(next){return source==="idle"||source===next}
function start(next){if(!canStart(next))return false;source=next;return true}
function stop(next){if(source===next){source="idle";recent.length=0;recentBytes=0}}
function addClient(res){
  clients.add(res);
  for(const chunk of recent){try{if(!res.writableEnded&&!res.destroyed)res.write(chunk)}catch{break}}
  res.on("close",()=>clients.delete(res));
}
function broadcast(chunk){
  if(source==="idle"||!chunk||!chunk.length)return;
  const copy=Buffer.from(chunk);
  recent.push(copy);recentBytes+=copy.length;
  while(recent.length>1&&recentBytes>BUFFER_LIMIT)recentBytes-=recent.shift().length;
  for(const res of clients){
    try{
      if(res.writableEnded||res.destroyed){clients.delete(res);continue}
      if(!res.writableNeedDrain)res.write(copy);
    }catch{clients.delete(res)}
  }
}
function status(){return{source,listeners:clients.size,running:source!=="idle",bufferBytes:recentBytes}}
module.exports={start,stop,addClient,broadcast,status};