const { spawn } = require("child_process");
const { PassThrough } = require("stream");

// =====================================
// JON RADIO PLATFORM
// JON FM ETHIOPIA
// REAL AUDIO STREAM ENGINE
// =====================================

const clients = new Set();

let ffmpegProcess = null;
let streamRunning = false;

// =====================================
// START AUDIO ENGINE
// =====================================

function startStream(input) {
  if (streamRunning) {
    console.log("JON STREAM: Already running.");
    return false;
  }

  if (!input) {
    console.log("JON STREAM: No input provided.");
    return false;
  }

  console.log("--------------------------------");
  console.log("JON FM ETHIOPIA");
  console.log("AUDIO STREAM STARTING");
  console.log("--------------------------------");

  ffmpegProcess = spawn("ffmpeg", [
    "-re",
    "-i",
    input,

    "-vn",
    "-ac",
    "2",
    "-ar",
    "44100",

    "-b:a",
    "128k",

    "-f",
    "mp3",

    "pipe:1"
  ]);

  streamRunning = true;

  // =====================================
  // SEND AUDIO TO ALL LISTENERS
  // =====================================

  ffmpegProcess.stdout.on("data", chunk => {
    for (const client of clients) {
      try {
        client.write(chunk);
      } catch (error) {
        clients.delete(client);
      }
    }
  });

  // =====================================
  // FFmpeg ERROR
  // =====================================

  ffmpegProcess.on("error", error => {
    console.error(
      "JON STREAM FFmpeg ERROR:",
      error.message
    );

    streamRunning = false;
    ffmpegProcess = null;
  });

  // =====================================
  // FFmpeg STOP
  // =====================================

  ffmpegProcess.on("close", code => {
    console.log(
      "JON STREAM FFmpeg STOPPED:",
      code
    );

    streamRunning = false;
    ffmpegProcess = null;
  });

  return true;
}

// =====================================
// ADD LISTENER
// =====================================

function addClient(res) {
  clients.add(res);

  console.log(
    "JON FM LISTENER CONNECTED:",
    clients.size
  );

  res.on("close", () => {
    clients.delete(res);

    console.log(
      "JON FM LISTENER DISCONNECTED:",
      clients.size
    );
  });
}

// =====================================
// STOP STREAM
// =====================================

function stopStream() {
  if (!ffmpegProcess) {
    streamRunning = false;
    return;
  }

  console.log(
    "JON STREAM: Stopping..."
  );

  ffmpegProcess.kill("SIGTERM");

  ffmpegProcess = null;
  streamRunning = false;
}

// =====================================
// STATUS
// =====================================

function getStatus() {
  return {
    running: streamRunning,
    listeners: clients.size
  };
}

// =====================================
// EXPORT
// =====================================

module.exports = {
  startStream,
  stopStream,
  addClient,
  getStatus
};
