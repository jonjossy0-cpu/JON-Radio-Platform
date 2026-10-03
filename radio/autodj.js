const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const stream = require("./stream");

// =====================================
// JON RADIO PLATFORM
// 24/7 AUTO DJ ENGINE
// =====================================

const MUSIC_DIR = path.join(__dirname, "..", "music");

let playlist = [];
let currentIndex = 0;
let currentProcess = null;

let autoDJRunning = false;
let liveMode = false;

let nowPlaying = null;
let nextSong = null;

// -------------------------------------
// Get Music Files
// -------------------------------------

function getMusicFiles() {
  if (!fs.existsSync(MUSIC_DIR)) {
    return [];
  }

  return fs.readdirSync(MUSIC_DIR).filter(file => {
    const ext = path.extname(file).toLowerCase();

    return ext === ".mp3" || ext === ".wav";
  });
}

// -------------------------------------
// Load Playlist
// -------------------------------------

function loadPlaylist() {
  playlist = getMusicFiles();

  if (playlist.length === 0) {
    console.log("JON AUTO DJ: Music library is empty.");
    return false;
  }

  console.log(`JON AUTO DJ: ${playlist.length} songs found.`);

  return true;
}

// -------------------------------------
// Get Next Song
// -------------------------------------

function getNextSong() {
  if (playlist.length === 0) {
    return null;
  }

  if (currentIndex >= playlist.length) {
    currentIndex = 0;
  }

  const song = playlist[currentIndex];

  currentIndex++;

  return song;
}

// -------------------------------------
// Update Now Playing
// -------------------------------------

function updateNowPlaying(song) {
  nowPlaying = song;

  if (playlist.length > 0 && currentIndex < playlist.length) {
    nextSong = playlist[currentIndex];
  } else if (playlist.length > 0) {
    nextSong = playlist[0];
  } else {
    nextSong = null;
  }

  console.log("--------------------------------");
  console.log("JON FM ETHIOPIA");
  console.log("NOW PLAYING:", nowPlaying);
  console.log("NEXT SONG:", nextSong);
  console.log("--------------------------------");
}

// -------------------------------------
// Play Song
// -------------------------------------

function playSong() {

  if (!autoDJRunning) {
    return;
  }

  if (liveMode) {
    console.log("JON AUTO DJ: Live mode active. Waiting...");
    return;
  }

  if (!loadPlaylist()) {
    console.log("JON AUTO DJ: No music available.");
    return;
  }

  const song = getNextSong();

  if (!song) {
    setTimeout(playSong, 5000);
    return;
  }

  const filePath = path.join(MUSIC_DIR, song);

  updateNowPlaying(song);

  console.log("JON AUTO DJ: Playing", song);

  // -----------------------------------
  // FFmpeg
  // -----------------------------------

  currentProcess = spawn("ffmpeg", [
    "-re",

    "-i",
    filePath,

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

  currentProcess.stderr.on("data", data => {
    // FFmpeg status is intentionally not printed
    // to keep the server console clean.
  });

  currentProcess.on("error", error => {
    console.error(
      "JON AUTO DJ: FFmpeg error:",
      error.message
    );

    currentProcess = null;

    if (autoDJRunning && !liveMode) {
      setTimeout(playSong, 2000);
    }
  });

  currentProcess.on("close", code => {

    currentProcess = null;

    console.log(
      "JON AUTO DJ: Song finished.",
      "FFmpeg code:",
      code
    );

    if (autoDJRunning && !liveMode) {
      setTimeout(playSong, 500);
    }
  });
}

// -------------------------------------
// START AUTO DJ
// -------------------------------------

function startAutoDJ() {

  if (liveMode) {
    console.log(
      "JON AUTO DJ: Cannot start while Live is active."
    );

    return false;
  }

  if (autoDJRunning) {
    console.log("JON AUTO DJ: Already running.");
    return true;
  }

  autoDJRunning = true;

  console.log("--------------------------------");
  console.log("JON AUTO DJ STARTED");
  console.log("JON FM ETHIOPIA");
  console.log("--------------------------------");

  playSong();

  return true;
}

// -------------------------------------
// STOP AUTO DJ
// -------------------------------------

function stopAutoDJ() {

  autoDJRunning = false;

  if (currentProcess) {
    currentProcess.kill("SIGTERM");
    currentProcess = null;
  }

  nowPlaying = null;
  nextSong = null;

  console.log("JON AUTO DJ STOPPED.");

  return true;
}

// -------------------------------------
// LIVE MODE
// -------------------------------------

function startLive() {

  liveMode = true;

  // Auto DJ pauses automatically
  if (currentProcess) {
    currentProcess.kill("SIGTERM");
    currentProcess = null;
  }

  console.log("--------------------------------");
  console.log("JON FM LIVE MODE");
  console.log("AUTO DJ PAUSED");
  console.log("--------------------------------");

  return true;
}

// -------------------------------------
// STOP LIVE
// -------------------------------------

function stopLive() {

  liveMode = false;

  console.log("--------------------------------");
  console.log("JON FM LIVE MODE STOPPED");
  console.log("--------------------------------");

  // Resume Auto DJ
  if (autoDJRunning) {
    setTimeout(playSong, 500);
  }

  return true;
}

// -------------------------------------
// STATUS
// -------------------------------------

function getStatus() {

  return {
    autoDJ: autoDJRunning,
    live: liveMode,
    nowPlaying,
    nextSong,
    musicCount: playlist.length
  };
}

// -------------------------------------
// EXPORT
// -------------------------------------

module.exports = {
  startAutoDJ,
  stopAutoDJ,
  startLive,
  stopLive,
  getStatus,
  loadPlaylist
};
