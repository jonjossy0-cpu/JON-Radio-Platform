const{spawn}=require("child_process");const broadcast=require("./broadcast");
let ffmpeg=null,active=false;
let FFMPEG_PATH="ffmpeg";try{FFMPEG_PATH=require("ffmpeg-static")||FFMPEG_PATH}catch{}
function start(){if(active)return true;if(!broadcast.start("live"))return false;ffmpeg=spawn(FFMPEG_PATH,["-hide_banner","-loglevel","error","-f","webm","-i","pipe:0","-vn","-ac","2","-ar","44100","-b:a","128k","-f","mp3","pipe:1"]);active=true;ffmpeg.stdout.on("data",broadcast.broadcast);ffmpeg.on("error",()=>stop());ffmpeg.on("close",()=>{ffmpeg=null;if(active){active=false;broadcast.stop("live")}});return true}
function writeAudio(chunk){if(!active||!ffmpeg?.stdin?.writable)return false;try{ffmpeg.stdin.write(chunk);return true}catch{return false}}
function stop(){if(ffmpeg){try{ffmpeg.stdin.end()}catch{}try{ffmpeg.kill("SIGTERM")}catch{}ffmpeg=null}active=false;broadcast.stop("live")}
module.exports={start,writeAudio,stop,isActive:()=>active};
