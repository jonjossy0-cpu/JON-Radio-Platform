const {spawn}=require("child_process");
const fs=require("fs"),path=require("path");
const broadcast=require("./broadcast");
let FFMPEG_PATH="ffmpeg";try{FFMPEG_PATH=require("ffmpeg-static")||FFMPEG_PATH}catch{}
const MEDIA_ROOT=process.env.MEDIA_ROOT?path.resolve(process.env.MEDIA_ROOT):path.join(__dirname,"..");
const STATE_FILE=path.join(MEDIA_ROOT,"external-radio.json");
let url="",activeUrl=null,enabled=false,proc=null,restartTimer=null,generation=0,lastError=null,startedAt=null,lastOutputAt=null,reconnects=0;
function save(){try{fs.mkdirSync(MEDIA_ROOT,{recursive:true});fs.writeFileSync(STATE_FILE,JSON.stringify({url,enabled},null,2))}catch(e){lastError="Could not save external stream settings: "+e.message}}
function restore(){try{if(!fs.existsSync(STATE_FILE))return;const s=JSON.parse(fs.readFileSync(STATE_FILE,"utf8"));if(typeof s.url==="string")url=s.url;if(typeof s.enabled==="boolean")enabled=s.enabled}catch(e){lastError="Could not restore external stream settings: "+e.message}}
restore();
function validUrl(v){try{const u=new URL(String(v||""));return (u.protocol==="https:"||u.protocol==="http:")&&Boolean(u.hostname)}catch{return false}}
function safeHttpUrl(v){if(!validUrl(v))return null;return String(v).trim()}
function pickPlaylistEntry(text,type,baseUrl){
 let candidates=[];
 if(/pls/i.test(type)||/^\s*\[playlist\]/i.test(text)){
  candidates=[...text.matchAll(/^File\d+\s*=\s*(.+)\s*$/gim)].map(m=>m[1].trim());
 }else if(/xspf|xml/i.test(type)||/<(?:asx|playlist|entry|location)\b/i.test(text)){
  candidates=[...text.matchAll(/(?:href|url|src|location)\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1].trim());
  candidates.push(...[...text.matchAll(/<location>\s*([^<]+)\s*<\/location>/gi)].map(m=>m[1].trim()));
 }else{
  candidates=text.split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith("#"));
 }
 for(const candidate of candidates){try{const absolute=new URL(candidate,baseUrl).href;if(validUrl(absolute))return absolute}catch{}}
 return null;
}
async function resolveInput(input){
 const u=new URL(input),pathName=u.pathname.toLowerCase();
 // Keep HLS manifests intact: FFmpeg handles variant playlists and segment refresh.
 if(pathName.endsWith(".m3u8"))return input;
 // Resolve common station directory/playlist formats to their actual stream URL.
 if(!/\.(pls|m3u|asx|xspf|ram|wax|wvx)$/.test(pathName))return input;
 try{
  const response=await fetch(input,{redirect:"follow",signal:AbortSignal.timeout(8000),headers:{"User-Agent":"JON-Radio-Platform/2.0","Accept":"audio/*,application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,application/pls+xml,application/xspf+xml,*/*"}});
  if(!response.ok)throw new Error("playlist HTTP "+response.status);
  const type=response.headers.get("content-type")||"";
  const textBody=await response.text();
  if(textBody.length>1024*1024)throw new Error("playlist is larger than 1 MB");
  const picked=pickPlaylistEntry(textBody,type,input);
  if(picked)return picked;
  // Some .m3u URLs are actually audio streams; allow FFmpeg to try the original.
  if(pathName.endsWith(".m3u")&&!/^\s*#EXTM3U/i.test(textBody))return input;
  throw new Error("no playable HTTP/HTTPS stream URL found in playlist");
 }catch(e){if(pathName.endsWith(".m3u")||pathName.endsWith(".pls")||pathName.endsWith(".asx")||pathName.endsWith(".xspf"))throw new Error("Could not read radio playlist: "+e.message);return input}
}
async function launch(g){
 if(g!==generation||!enabled||!(activeUrl||url))return;
 const source=activeUrl||url;
 let input;
 try{input=await resolveInput(source)}catch(e){if(g!==generation||!enabled)return;lastError=e.message;schedule(g);return}
 if(g!==generation||!enabled)return;
 const args=["-hide_banner","-loglevel","warning","-nostdin","-user_agent","JON-Radio-Platform/2.0","-reconnect","1","-reconnect_streamed","1","-reconnect_at_eof","1","-reconnect_delay_max","10","-rw_timeout","15000000","-i",input,"-vn","-sn","-dn","-ac","2","-ar","44100","-b:a","128k","-c:a","libmp3lame","-f","mp3","pipe:1"];
 let p;
 try{p=spawn(FFMPEG_PATH,args,{stdio:["ignore","pipe","pipe"]})}catch(e){lastError="FFmpeg start failed: "+e.message;schedule(g);return}
 proc=p;let stderr="";
 p.stdout.on("data",chunk=>{if(g!==generation||!enabled)return;lastOutputAt=Date.now();lastError=null;reconnects=0;broadcast.broadcast(chunk)});
 p.stderr.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-1800)});
 p.on("error",e=>{if(g!==generation)return;lastError="FFmpeg could not start: "+e.message});
 p.on("close",(code,signal)=>{if(g!==generation)return;proc=null;if(!enabled)return;lastError="Stream disconnected"+(code!==null?" (FFmpeg exit "+code+")":"")+(stderr.trim()?": "+stderr.trim().slice(-700):"");schedule(g)});
}
function schedule(g){if(g!==generation||!enabled)return;clearTimeout(restartTimer);reconnects++;const delay=Math.min(30000,2000*Math.pow(2,Math.min(reconnects-1,4)));restartTimer=setTimeout(()=>launch(g),delay)}
const watchdog=setInterval(()=>{if(!enabled||!proc)return;const reference=lastOutputAt||Date.parse(startedAt||"");if(reference&&Date.now()-reference>30000){lastError="No audio received from source for 30 seconds; reconnecting.";try{proc.kill("SIGTERM")}catch{}}},5000);watchdog.unref?.();
function start(nextUrl){
 if(nextUrl!==undefined){if(!validUrl(nextUrl))return {success:false,error:"Enter a valid HTTP/HTTPS radio stream or playlist URL."};url=String(nextUrl).trim()}
 if(!validUrl(url))return {success:false,error:"Enter and save a valid HTTP/HTTPS radio stream or playlist URL first."};
 if(enabled&&broadcast.status().source==="external"&&proc&&activeUrl===url)return {success:true,status:status()};
 if(broadcast.status().source!=="idle"&&broadcast.status().source!=="external")return {success:false,error:"Another source is running. Stop Auto DJ or Live before starting the external stream."};
 if(proc){const old=proc;proc=null;try{old.kill("SIGTERM")}catch{}}clearTimeout(restartTimer);restartTimer=null;
 enabled=true;activeUrl=url;lastError=null;startedAt=new Date().toISOString();lastOutputAt=null;reconnects=0;save();
 if(!broadcast.start("external")){enabled=false;save();return {success:false,error:"The public radio stream is busy. Stop the active source first."}}
 const g=++generation;launch(g);return {success:true,status:status()}
}
function stop(){enabled=false;activeUrl=null;generation++;clearTimeout(restartTimer);restartTimer=null;const p=proc;proc=null;if(p){try{p.kill("SIGTERM")}catch{}setTimeout(()=>{try{if(p.exitCode===null)p.kill("SIGKILL")}catch{}},1500).unref?.()}broadcast.stop("external");save();return true}
function setUrl(nextUrl){if(!validUrl(nextUrl))return {success:false,error:"Enter a valid HTTP/HTTPS radio stream or playlist URL."};url=String(nextUrl).trim();save();return {success:true,settings:status()}}
function status(){return{enabled,active:Boolean(enabled&&proc&&!proc.killed&&lastOutputAt&&Date.now()-lastOutputAt<30000),url,startedAt,lastOutputAt:lastOutputAt?new Date(lastOutputAt).toISOString():null,reconnects,lastError,source:broadcast.status().source}}
function shouldAutoStart(){return enabled&&validUrl(url)}
module.exports={start,stop,setUrl,status,shouldAutoStart};
