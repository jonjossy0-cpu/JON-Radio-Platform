const {spawn}=require("child_process");
const fs=require("fs"),path=require("path");
const broadcast=require("./broadcast");
let FFMPEG_PATH="ffmpeg";try{FFMPEG_PATH=require("ffmpeg-static")||FFMPEG_PATH}catch{}
const MEDIA_ROOT=process.env.MEDIA_ROOT?path.resolve(process.env.MEDIA_ROOT):path.join(__dirname,"..");
const STATE_FILE=path.join(MEDIA_ROOT,"external-radio.json");
let url="",enabled=false,proc=null,restartTimer=null,generation=0,lastError=null,startedAt=null,lastOutputAt=null,reconnects=0;
function save(){try{fs.mkdirSync(MEDIA_ROOT,{recursive:true});fs.writeFileSync(STATE_FILE,JSON.stringify({url,enabled},null,2))}catch(e){lastError="Could not save external stream settings: "+e.message}}
function restore(){try{if(!fs.existsSync(STATE_FILE))return;const s=JSON.parse(fs.readFileSync(STATE_FILE,"utf8"));if(typeof s.url==="string")url=s.url;if(typeof s.enabled==="boolean")enabled=s.enabled}catch(e){lastError="Could not restore external stream settings: "+e.message}}
restore();
function validUrl(v){try{const u=new URL(String(v||""));return (u.protocol==="https:"||u.protocol==="http:")&&Boolean(u.hostname)}catch{return false}}
function launch(g){
 if(g!==generation||!enabled||!url)return;
 const args=["-hide_banner","-loglevel","warning","-nostdin","-reconnect","1","-reconnect_streamed","1","-reconnect_delay_max","10","-i",url,"-vn","-sn","-dn","-ac","2","-ar","44100","-b:a","128k","-c:a","libmp3lame","-f","mp3","pipe:1"];
 let p;
 try{p=spawn(FFMPEG_PATH,args,{stdio:["ignore","pipe","pipe"]})}catch(e){lastError="FFmpeg start failed: "+e.message;schedule(g);return}
 proc=p;let stderr="";
 p.stdout.on("data",chunk=>{if(g!==generation||!enabled)return;lastOutputAt=Date.now();lastError=null;broadcast.broadcast(chunk)});
 p.stderr.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-1200)});
 p.on("error",e=>{if(g!==generation)return;lastError="FFmpeg error: "+e.message});
 p.on("close",(code,signal)=>{if(g!==generation)return;proc=null;if(!enabled)return;lastError="Stream disconnected"+(code!==null?" (FFmpeg exit "+code+")":"")+(stderr.trim()?": "+stderr.trim().slice(-500):"");schedule(g)});
}
function schedule(g){if(g!==generation||!enabled)return;clearTimeout(restartTimer);reconnects++;const delay=Math.min(30000,2000*Math.pow(2,Math.min(reconnects-1,4)));restartTimer=setTimeout(()=>launch(g),delay)}
const watchdog=setInterval(()=>{if(!enabled||!proc)return;const reference=lastOutputAt||Date.parse(startedAt||"");if(reference&&Date.now()-reference>30000){lastError="No audio received from source for 30 seconds; reconnecting.";try{proc.kill("SIGTERM")}catch{}}},5000);watchdog.unref?.();
function start(nextUrl){
 const previousUrl=url;
 if(nextUrl!==undefined){if(!validUrl(nextUrl))return {success:false,error:"Enter a valid HTTP/HTTPS M3U8 stream URL."};url=String(nextUrl).trim()}
 if(!validUrl(url))return {success:false,error:"Enter and save a valid HTTP/HTTPS M3U8 stream URL first."};
 if(enabled&&broadcast.status().source==="external"&&proc&&url===previousUrl)return {success:true,status:status()};
 if(broadcast.status().source!=="idle"&&broadcast.status().source!=="external")return {success:false,error:"Another source is running. Stop Auto DJ or Live before starting the external stream."};
 if(proc){const old=proc;proc=null;try{old.kill("SIGTERM")}catch{}}clearTimeout(restartTimer);restartTimer=null;
 enabled=true;lastError=null;startedAt=new Date().toISOString();lastOutputAt=null;reconnects=0;save();
 if(!broadcast.start("external")){enabled=false;save();return {success:false,error:"The public radio stream is busy. Stop the active source first."}}
 const g=++generation;clearTimeout(restartTimer);launch(g);return {success:true,status:status()}
}
function stop(){enabled=false;generation++;clearTimeout(restartTimer);restartTimer=null;const p=proc;proc=null;if(p){try{p.kill("SIGTERM")}catch{}setTimeout(()=>{try{if(p.exitCode===null)p.kill("SIGKILL")}catch{}},1500).unref?.()}broadcast.stop("external");save();return true}
function setUrl(nextUrl){if(!validUrl(nextUrl))return {success:false,error:"Enter a valid HTTP/HTTPS M3U8 stream URL."};url=String(nextUrl).trim();save();return {success:true,settings:status()}}
function status(){return{enabled,active:Boolean(enabled&&proc&&!proc.killed&&lastOutputAt&&Date.now()-lastOutputAt<30000),url,startedAt,lastOutputAt:lastOutputAt?new Date(lastOutputAt).toISOString():null,reconnects,lastError,source:broadcast.status().source}}
function shouldAutoStart(){return enabled&&validUrl(url)}
module.exports={start,stop,setUrl,status,shouldAutoStart};
