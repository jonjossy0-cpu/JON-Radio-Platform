const { spawn } = require("child_process");

// =====================================
// JON RADIO PLATFORM
// JON FM ETHIOPIA
// STREAM ENGINE
// =====================================

let ffmpegProcess = null;
let streamRunning = false;

// -------------------------------------
// Start Stream
// -------------------------------------

function startStream(input) {

  if (streamRunning) {
    console.log("JON STREAM: Already running.");
    return;
  }

  if (!input) {
    console.log("JON STREAM: No input provided.");
    return;
  }

  console.log("--------------------------------");
  console.log("JON FM ETHIOPIA STREAM STARTING");
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

  ffmpegProcess.stderr.on("data", data => {
    // FFmpeg diagnostic output
    // intentionally not printed continuously
  });

  ffmpegProcess.on("error", error => {

    console.error(
      "JON STREAM ERROR:",
      error.message
    );

    streamRunning = false;
    ffmpegProcess = null;

  });

  ffmpegProcess.on("close", code => {

    console.log(
      "JON STREAM STOPPED. FFmpeg code:",
      code
    );

    streamRunning = false;
    ffmpegProcess = null;

  });

  return ffmpegProcess.stdout;
}

// -------------------------------------
// Stop Stream
// -------------------------------------

function stopStream() {

  if (!ffmpegProcess) {
    streamRunning = false;
    return;
  }

  console.log("JON STREAM: Stopping...");

  ffmpegProcess.kill("SIGTERM");

  ffmpegProcess = null;
  streamRunning = false;
}

// -------------------------------------
// Stream Status
// -------------------------------------

function getStatus() {

  return {
    running: streamRunning
  };

}

// -------------------------------------
// Export
// -------------------------------------

module.exports = {
  startStream,
  stopStream,
  getStatus
};
