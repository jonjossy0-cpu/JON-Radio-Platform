const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const stream = require("./stream");

const MUSIC_DIR = path.join(__dirname, "..", "music");

let playlist = [];
let currentIndex = 0;
let currentProcess = null;
let autoDJRunning = false;
let liveMode = false;
let nowPlaying = null;
let nextSong = null;

function getMusicFiles() {
  if (!fs.existsSync(MUSIC_DIR)) return [];
  return fs.readdirSync(MUSIC_DIR).filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ext === ".mp3" || ext === ".wav" || ext === ".m4a";
  });
}

function loadPlaylist() {
  playlist = getMusicFiles();

  if (!playlist.length) {
    console.log("JON AUTO DJ: Music library is empty.");
    return false;
  }

  // Keep the current position valid when the library changes.
  if (currentIndex >= playlist.length) {
    currentIndex = 0;
  }

  return true;
}

function getNextSong() {
  if (!playlist.length) return null;
  if (currentIndex >= playlist.length) currentIndex = 0;
  return playlist[currentIndex++];
}

function updateNowPlaying(song) {
  nowPlaying = song;
  nextSong = playlist.length && currentIndex < playlist.length
    ? playlist[currentIndex] : (playlist[0] || null);
}

function playSong() {
  if (!autoDJRunning || liveMode) return;

  if (!loadPlaylist()) {
    console.log("JON AUTO DJ: Waiting for music...");
    setTimeout(playSong, 5000);
    return;
  }

  const song = getNextSong();
  if (!song) {
    setTimeout(playSong, 1000);
    return;
  }

  const filePath = path.join(MUSIC_DIR, song);
  updateNowPlaying(song);

  currentProcess = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-re",
    "-i", filePath,
    "-vn",
    "-ac", "2",
    "-ar", "44100",
    "-b:a", "128k",
    "-f", "mp3",
    "pipe:1"
  ]);

  currentProcess.stdout.on("data", chunk => {
    stream.broadcastAudio(chunk);
  });

  currentProcess.stderr.on("data", data => {
    console.error("JON AUTO DJ FFmpeg:", data.toString().trim());
  });

  currentProcess.on("error", error => {
    console.error("JON AUTO DJ: FFmpeg error:", error.message);
    currentProcess = null;

    if (autoDJRunning && !liveMode) {
      setTimeout(playSong, 2000);
    }
  });

  currentProcess.on("close", code => {
    currentProcess = null;

    if (autoDJRunning && !liveMode) {
      // Start the next song automatically.
      setTimeout(playSong, 300);
    }
  });
}

function startAutoDJ() {
  if (liveMode) return false;
  if (autoDJRunning) return true;
  if (!loadPlaylist()) return false;
  if (!stream.startAutoDJBroadcast()) return false;
  autoDJRunning = true;
  playSong();
  return true;
}

function stopAutoDJ() {
  autoDJRunning = false;
  if (currentProcess) {
    currentProcess.kill("SIGTERM");
    currentProcess = null;
  }
  stream.stopAutoDJBroadcast();
  nowPlaying = null;
  nextSong = null;
  return true;
}

function startLive() {
  liveMode = true;

  if (currentProcess) {
    try {
      currentProcess.kill("SIGTERM");
    } catch {}

    currentProcess = null;
  }

  return true;
}

function stopLive() {
  liveMode = false;

  if (autoDJRunning) {
    setTimeout(playSong, 500);
  }

  return true;
}

function getStatus() {
  return { autoDJ: autoDJRunning, live: liveMode, nowPlaying, nextSong, musicCount: playlist.length };
}

module.exports = {
  startAutoDJ,
  stopAutoDJ,
  startLive,
  stopLive,
  getStatus,
  loadPlaylist,
  getMusicFiles
};
