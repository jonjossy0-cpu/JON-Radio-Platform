const clients=new Set();
let source="idle";
function canStart(next){return source==="idle"||source===next}
function start(next){if(!canStart(next))return false;source=next;return true}
function stop(next){if(source===next)source="idle"}
function addClient(res){clients.add(res);res.on("close",()=>clients.delete(res))}
function broadcast(chunk){if(source==="idle")return;for(const res of clients){try{if(!res.writableEnded)res.write(chunk)}catch{clients.delete(res)}}}
function status(){return{source,listeners:clients.size,running:source!=="idle"}}
module.exports={start,stop,addClient,broadcast,status};
