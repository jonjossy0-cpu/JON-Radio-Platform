const{spawn}=require("child_process");const broadcast=require("./broadcast");
let ffmpeg=null,active=false;
let FFMPEG_PATH="ffmpeg";try{FFMPEG_PATH=require("ffmpeg-static")||FFMPEG_PATH}catch{}
function start(){if(active)return true;if(!broadcast.start("live"))return false;ffmpeg=spawn(FFMPEG_PATH,["-hide_banner","-loglevel","error","-f","s16le","-ar","48000","-ac","2","-i","pipe:0","-vn","-af","aresample=async=1000:min_hard_comp=0.100:first_pts=0","-c:a","libmp3lame","-b:a","256k","-joint_stereo","1","-ar","48000","-ac","2","-f","mp3","pipe:1"],{stdio:["pipe","pipe","ignore"]});active=true;ffmpeg.stdout.on("data",broadcast.broadcast);ffmpeg.on("error",()=>stop());ffmpeg.on("close",()=>{ffmpeg=null;if(active){active=false;broadcast.stop("live")}});return true}
function writeAudio(chunk){if(!active||!ffmpeg?.stdin?.writable)return false;try{ffmpeg.stdin.write(Buffer.from(chunk));return true}catch{return false}}
function stop(){if(ffmpeg){try{ffmpeg.stdin.end()}catch{}try{ffmpeg.kill("SIGTERM")}catch{}ffmpeg=null}active=false;broadcast.stop("live")}
module.exports={start,writeAudio,stop,isActive:()=>active};
