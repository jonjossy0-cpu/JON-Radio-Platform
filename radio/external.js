const{spawn}=require("child_process");
const fs=require("fs"),path=require("path");
const broadcast=require("./broadcast");
let FFMPEG_PATH="ffmpeg";try{FFMPEG_PATH=require("ffmpeg-static")||FFMPEG_PATH}catch{}
const MEDIA_ROOT=process.env.MEDIA_ROOT?path.resolve(process.env.MEDIA_ROOT):path.join(__dirname,"..");
const STATE_FILE=path.join(MEDIA_ROOT,"external-radio.json");
const ALLOWED_PROTOCOLS=new Set(["http:","https:","rtmp:","rtmps:","rtsp:","rtsps:","udp:","srt:"]);
let url="",urls=[],activeUrl=null,enabled=false,proc=null,restartTimer=null,generation=0,lastError=null,startedAt=null,procStartedAt=0,lastOutputAt=null,reconnects=0,lastStderr="";
function validUrl(v){try{const u=new URL(String(v||"").trim());return ALLOWED_PROTOCOLS.has(u.protocol)&&Boolean(u.hostname)}catch{return false}}
function save(){try{fs.mkdirSync(MEDIA_ROOT,{recursive:true});fs.writeFileSync(STATE_FILE,JSON.stringify({url,urls,enabled},null,2));return true}catch(e){lastError="Could not save external stream settings: "+e.message;return false}}
function restore(){try{if(!fs.existsSync(STATE_FILE))return;const s=JSON.parse(fs.readFileSync(STATE_FILE,"utf8"));if(Array.isArray(s.urls))urls=[...new Set(s.urls.filter(validUrl).map(v=>String(v).trim()))];if(typeof s.url==="string"&&validUrl(s.url))url=s.url;if(url&&!urls.includes(url))urls.unshift(url);if(typeof s.enabled==="boolean")enabled=s.enabled}catch(e){lastError="Could not restore external stream settings: "+e.message}}
restore();
function launch(g){
 if(g!==generation||!enabled||!(activeUrl||url))return;
 const inputUrl=activeUrl||url;
 const args=["-hide_banner","-loglevel","warning","-nostdin","-rw_timeout","20000000","-probesize","5000000","-analyzeduration","5000000"];
 if(/^https?:/i.test(inputUrl))args.push("-user_agent","Mozilla/5.0 (compatible; JON-Radio-Platform/2.0)","-headers","Accept: */*\r\nIcy-MetaData: 1\r\n","-reconnect","1","-reconnect_streamed","1","-reconnect_at_eof","1","-reconnect_on_network_error","1","-reconnect_on_http_error","4xx,5xx","-reconnect_delay_max","10");
 args.push("-i",inputUrl,"-map","0:a:0?","-vn","-sn","-dn","-ac","2","-ar","44100","-c:a","libmp3lame","-b:a","128k","-flush_packets","1","-write_xing","0","-f","mp3","pipe:1");
 let p;
 try{p=spawn(FFMPEG_PATH,args,{stdio:["ignore","pipe","pipe"]})}catch(e){lastError="FFmpeg start failed: "+e.message;schedule(g);return}
 proc=p;procStartedAt=Date.now();lastOutputAt=null;lastStderr="";
 p.stdout.on("data",chunk=>{if(g!==generation||!enabled)return;lastOutputAt=Date.now();lastError=null;reconnects=0;broadcast.broadcast(chunk)});
 p.stderr.on("data",chunk=>{const line=chunk.toString();lastStderr=(lastStderr+line).slice(-2400);console.error("[ExternalStream][ffmpeg]",line.trim())});
 p.on("error",e=>{if(g!==generation)return;lastError="FFmpeg process error: "+e.message;console.error("[ExternalStream] FFmpeg process error:",e.stack||e.message)});
 p.on("close",code=>{if(g!==generation)return;proc=null;procStartedAt=0;if(!enabled)return;lastError="Stream disconnected"+(code!==null?" (FFmpeg exit "+code+")":"")+(lastStderr.trim()?": "+lastStderr.trim().slice(-1000):": FFmpeg closed without reporting an error. Check Render runtime logs and source reachability.");console.error("[ExternalStream] disconnected:",lastError,"URL:",inputUrl);schedule(g)});
}
function schedule(g){if(g!==generation||!enabled)return;clearTimeout(restartTimer);reconnects++;const delay=Math.min(30000,2000*Math.pow(2,Math.min(reconnects-1,4)));restartTimer=setTimeout(()=>launch(g),delay)}
const watchdog=setInterval(()=>{if(!enabled||!proc)return;const reference=lastOutputAt||procStartedAt;if(!lastOutputAt&&reference&&Date.now()-reference>10000&&lastStderr)lastError="Waiting for source audio: "+lastStderr.trim().slice(-500);if(reference&&Date.now()-reference>30000){lastError="No audio received from source for 30 seconds; reconnecting."+(lastStderr.trim()?": "+lastStderr.trim().slice(-600):"");console.error("[ExternalStream] watchdog:",lastError);try{proc.kill("SIGTERM")}catch{}}},5000);watchdog.unref?.();
function start(nextUrl){
 if(nextUrl!==undefined){const r=selectUrl(nextUrl);if(!r.success)return r}
 if(!validUrl(url))return {success:false,error:"Choose or save a supported radio stream URL first."};
 if(enabled&&broadcast.status().source==="external"&&proc&&activeUrl===url)return {success:true,status:status()};
 if(broadcast.status().source!=="idle"&&broadcast.status().source!=="external")return {success:false,error:"Another source is running. Stop Auto DJ or Live before starting the external stream."};
 if(proc){const old=proc;proc=null;try{old.kill("SIGTERM")}catch{}}clearTimeout(restartTimer);restartTimer=null;
 enabled=true;activeUrl=url;lastError=null;startedAt=new Date().toISOString();procStartedAt=0;lastOutputAt=null;reconnects=0;
 if(!save()){enabled=false;activeUrl=null;return {success:false,error:lastError}}
 if(!broadcast.start("external")){enabled=false;save();return {success:false,error:"The public radio stream is busy. Stop the active source first."}}
 const g=++generation;launch(g);return {success:true,status:status()}
}
function stop(){enabled=false;activeUrl=null;generation++;clearTimeout(restartTimer);restartTimer=null;const p=proc;proc=null;procStartedAt=0;lastOutputAt=null;if(p){try{p.kill("SIGTERM")}catch{}setTimeout(()=>{try{if(p.exitCode===null)p.kill("SIGKILL")}catch{}},1500).unref?.()}broadcast.stop("external");save();return true}
function setUrls(values){if(!Array.isArray(values)||!values.length)return {success:false,error:"Paste at least one radio link, one URL per line."};const clean=[...new Set(values.map(v=>String(v||"").trim()).filter(Boolean))];if(!clean.length||clean.some(v=>!validUrl(v)))return {success:false,error:"One or more links are invalid. Supported schemes: HTTP(S), RTMP(S), RTSP(S), UDP and SRT."};const old={url,urls:urls.slice()};urls=clean;if(!urls.includes(url))url=urls[0];if(!save()){url=old.url;urls=old.urls;return {success:false,error:lastError}}return {success:true,settings:status()}}
function setUrl(nextUrl){const value=String(nextUrl||"").trim();if(!validUrl(value))return {success:false,error:"Enter a valid radio stream URL (HTTP(S), RTMP(S), RTSP(S), UDP or SRT)."};const next=[...urls];if(!next.includes(value))next.push(value);return setUrls(next)}
function selectUrl(nextUrl){const value=String(nextUrl||"").trim();if(!urls.includes(value)){if(validUrl(value))return setUrl(value);return {success:false,error:"Choose a saved radio link first."}}const previous=url;url=value;if(!save()){url=previous;return {success:false,error:lastError}}return {success:true,settings:status()}}
function status(){return{enabled,active:Boolean(enabled&&proc&&!proc.killed&&lastOutputAt&&Date.now()-lastOutputAt<30000),url,urls:[...urls],startedAt,lastOutputAt:lastOutputAt?new Date(lastOutputAt).toISOString():null,reconnects,lastError,source:broadcast.status().source}}
function shouldAutoStart(){return enabled&&validUrl(url)}
module.exports={start,stop,setUrl,setUrls,selectUrl,shouldAutoStart,status};
