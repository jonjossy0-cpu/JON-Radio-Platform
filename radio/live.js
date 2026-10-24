const{spawn}=require("child_process");const broadcast=require("./broadcast");
let ffmpeg=null,active=false;
let FFMPEG_PATH="ffmpeg";try{FFMPEG_PATH=require("ffmpeg-static")||FFMPEG_PATH}catch{}
function start(inputSampleRate=48000,inputFormat="s16le"){
 if(active)return true;
 const rate=Number(inputSampleRate);
 if(!Number.isInteger(rate)||rate<8000||rate>192000)return false;
 if(!broadcast.start("live"))return false;
 const inputArgs=inputFormat==="webm-opus"?["-f","webm","-i","pipe:0"]:["-f","s16le","-ar",String(rate),"-ac","2","-i","pipe:0"];
 try{
  ffmpeg=spawn(FFMPEG_PATH,["-hide_banner","-loglevel","warning",...inputArgs,"-vn","-map","0:a:0","-ac","2","-channel_layout","stereo","-ar","48000","-c:a","libmp3lame","-b:a","256k","-joint_stereo","1","-af","highpass=f=70,lowpass=f=16000,alimiter=limit=0.95,aresample=async=1:first_pts=0","-f","mp3","pipe:1"],{stdio:["pipe","pipe","pipe"]});
 }catch(e){active=false;broadcast.stop("live");return false}
 active=true;
 ffmpeg.stdout.on("data",chunk=>{if(active)broadcast.broadcast(chunk)});
 ffmpeg.stderr.on("data",chunk=>{const msg=chunk.toString().trim();if(msg)console.error("Live FFmpeg:",msg.slice(-500))});
 ffmpeg.on("error",()=>stop());
 ffmpeg.on("close",()=>{ffmpeg=null;if(active){active=false;broadcast.stop("live")}});
 return true
}
function writeAudio(chunk){if(!active||!ffmpeg?.stdin?.writable)return false;try{return ffmpeg.stdin.write(chunk)}catch{return false}}
function stop(){const p=ffmpeg;ffmpeg=null;active=false;if(p){try{p.stdin.end()}catch{}try{p.kill("SIGTERM")}catch{}}broadcast.stop("live")}
module.exports={start,writeAudio,stop,isActive:()=>active};
