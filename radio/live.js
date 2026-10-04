const { spawn } = require("child_process");
let FFMPEG_PATH = "ffmpeg";
try {
  const ffmpegStatic = require("ffmpeg-static");
  if (ffmpegStatic) FFMPEG_PATH = ffmpegStatic;
} catch {}
const stream = require("./stream");

let ffmpegProcess = null;
let active = false;

function start() {
  if (active) return true;
  if (!stream.startLiveBroadcast()) return false;

  ffmpegProcess = spawn(FFMPEG_PATH, [
    "-f","webm","-i","pipe:0",
    "-vn","-ac","2","-ar","44100",
    "-b:a","128k","-f","mp3","pipe:1"
  ]);

  active = true;

  ffmpegProcess.stdout.on("data", chunk => stream.broadcastLiveAudio(chunk));

  ffmpegProcess.on("error", error => {
    console.error("JON LIVE FFmpeg ERROR:", error.message);
    stop();
  });

  ffmpegProcess.on("close", () => {
    ffmpegProcess = null;
    if (active) {
      active = false;
      stream.stopLiveBroadcast();
    }
  });

  return true;
}

function writeAudio(chunk) {
  if (!active || !ffmpegProcess || !ffmpegProcess.stdin.writable) return false;
  ffmpegProcess.stdin.write(chunk);
  return true;
}

function stop() {
  if (ffmpegProcess) {
    try { ffmpegProcess.stdin.end(); } catch {}
    try { ffmpegProcess.kill("SIGTERM"); } catch {}
    ffmpegProcess = null;
  }
  active = false;
  stream.stopLiveBroadcast();
}

function isActive() {
  return active;
}

module.exports = { start, writeAudio, stop, isActive };
