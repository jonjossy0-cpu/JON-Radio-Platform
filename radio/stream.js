const { spawn } = require("child_process");
let FFMPEG_PATH = "ffmpeg";
try {
  const ffmpegStatic = require("ffmpeg-static");
  if (ffmpegStatic) FFMPEG_PATH = ffmpegStatic;
} catch {}

const clients = new Set();

let ffmpegProcess = null;
let streamRunning = false;
let broadcastSource = null;

function writeToListeners(chunk) {
  for (const client of clients) {
    try {
      if (!client.writableEnded) client.write(chunk);
    } catch {
      clients.delete(client);
    }
  }
}

function startStream(input) {
  if (streamRunning || broadcastSource || !input) return false;
  ffmpegProcess = spawn(FFMPEG_PATH, [
    "-re","-i",input,"-vn","-ac","2","-ar","44100",
    "-b:a","128k","-f","mp3","pipe:1"
  ]);
  streamRunning = true;
  broadcastSource = "external";
  ffmpegProcess.stdout.on("data", writeToListeners);
  ffmpegProcess.on("error", error => {
    console.error("JON STREAM FFmpeg ERROR:", error.message);
    ffmpegProcess = null; streamRunning = false; broadcastSource = null;
  });
  ffmpegProcess.on("close", code => {
    console.log("JON STREAM FFmpeg STOPPED:", code);
    ffmpegProcess = null; streamRunning = false; broadcastSource = null;
  });
  return true;
}

function startAutoDJBroadcast() {
  if (broadcastSource && broadcastSource !== "autodj") return false;
  broadcastSource = "autodj";
  streamRunning = true;
  return true;
}
function stopAutoDJBroadcast() {
  if (broadcastSource === "autodj") {
    broadcastSource = null; streamRunning = false;
  }
}
function startLiveBroadcast() {
  if (broadcastSource && broadcastSource !== "live") return false;
  broadcastSource = "live";
  streamRunning = true;
  return true;
}
function stopLiveBroadcast() {
  if (broadcastSource === "live") {
    broadcastSource = null; streamRunning = false;
  }
}
function addClient(res) {
  clients.add(res);
  console.log("JON FM LISTENER CONNECTED:", clients.size);
  res.on("close", () => {
    clients.delete(res);
    console.log("JON FM LISTENER DISCONNECTED:", clients.size);
  });
}
function broadcastAudio(chunk) {
  if (broadcastSource === "autodj") writeToListeners(chunk);
}
function broadcastLiveAudio(chunk) {
  if (broadcastSource === "live") writeToListeners(chunk);
}
function stopStream() {
  if (ffmpegProcess) {
    try { ffmpegProcess.kill("SIGTERM"); } catch {}
    ffmpegProcess = null;
  }
  streamRunning = false;
  broadcastSource = null;
}
function getStatus() {
  return { running: streamRunning, listeners: clients.size, source: broadcastSource };
}
module.exports = {
  startStream, stopStream, startAutoDJBroadcast, stopAutoDJBroadcast,
  startLiveBroadcast, stopLiveBroadcast, addClient, broadcastAudio,
  broadcastLiveAudio, getStatus
};
