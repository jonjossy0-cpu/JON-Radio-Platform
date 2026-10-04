const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const stream = require("./stream");

const MUSIC_DIR = path.join(__dirname, "..", "music");
const ADS_DIR = path.join(__dirname, "..", "ads");
const JINGLES_DIR = path.join(__dirname, "..", "jingles");

let playlist = [];
let currentIndex = 0;
let currentProcess = null;
let autoDJRunning = false;
let liveMode = false;
let nowPlaying = null;
let nextSong = null;
let previousSong = null;
let shuffleMode = false;
let repeatMode = false;
let crossfadeSeconds = 5;
let adIntervalMinutes = 0;
let lastAdAt = 0;
let adIndex = 0;
let jingleIndex = 0;
let playHistory = [];
let queue = [];
let generation = 0;

function audioFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ext === ".mp3" || ext === ".wav" || ext === ".m4a";
  });
}

function getMusicFiles() {
  return audioFiles(MUSIC_DIR);
}

function getAdFiles() {
  return audioFiles(ADS_DIR);
}

function getJingleFiles() {
  return audioFiles(JINGLES_DIR);
}

function ensureDirs() {
  for (const dir of [MUSIC_DIR, ADS_DIR, JINGLES_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function loadPlaylist() {
  ensureDirs();
  playlist = getMusicFiles();

  if (!playlist.length) {
    console.log("JON AUTO DJ: Music library is empty.");
    return false;
  }

  if (currentIndex >= playlist.length) currentIndex = 0;
  return true;
}

function chooseIndex() {
  if (!playlist.length) return -1;
  if (queue.length) return -1;

  if (shuffleMode) {
    if (playlist.length === 1) return 0;
    let index = Math.floor(Math.random() * playlist.length);
    if (playlist[index] === nowPlaying) index = (index + 1) % playlist.length;
    return index;
  }

  if (currentIndex >= playlist.length) currentIndex = 0;
  return currentIndex++;
}

function getNextSong() {
  if (queue.length) return queue.shift();
  const index = chooseIndex();
  return index >= 0 ? playlist[index] : null;
}

function updateNowPlaying(song) {
  nowPlaying = song;
  nextSong = queue.length ? queue[0] : (playlist.length ? (shuffleMode ? "Shuffle" : playlist[currentIndex % playlist.length]) : null);
}

function addHistory(item) {
  playHistory.unshift({ item, at: new Date().toISOString() });
  if (playHistory.length > 100) playHistory.length = 100;
}

function shouldPlayAd() {
  return adIntervalMinutes > 0 && getAdFiles().length > 0 &&
    (Date.now() - lastAdAt) >= adIntervalMinutes * 60 * 1000;
}

function getTimedAd() {
  const ads = getAdFiles();
  if (!ads.length) return null;
  const ad = ads[adIndex % ads.length];
  adIndex = (adIndex + 1) % ads.length;
  lastAdAt = Date.now();
  return { type: "ad", name: ad, filePath: path.join(ADS_DIR, ad) };
}

function getJingle() {
  const jingles = getJingleFiles();
  if (!jingles.length) return null;
  const jingle = jingles[jingleIndex % jingles.length];
  jingleIndex = (jingleIndex + 1) % jingles.length;
  return { type: "jingle", name: jingle, filePath: path.join(JINGLES_DIR, jingle) };
}

function terminateCurrent() {
  generation += 1;
  if (currentProcess) {
    try { currentProcess.kill("SIGTERM"); } catch {}
    currentProcess = null;
  }
}

function spawnAudio(filePath) {
  return spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-re",
    "-i", filePath,
    "-vn", "-ac", "2", "-ar", "44100", "-b:a", "128k", "-f", "mp3", "pipe:1"
  ]);
}

function playItem(item, myGeneration) {
  if (!autoDJRunning || liveMode || myGeneration !== generation) return;

  currentProcess = spawnAudio(item.filePath);
  currentProcess.stdout.on("data", chunk => stream.broadcastAudio(chunk));
  currentProcess.stderr.on("data", data => console.error("JON AUTO DJ FFmpeg:", data.toString().trim()));

  currentProcess.on("error", error => {
    console.error("JON AUTO DJ: FFmpeg error:", error.message);
    currentProcess = null;
    if (autoDJRunning && !liveMode && myGeneration === generation) setTimeout(playSong, 500);
  });

  currentProcess.on("close", () => {
    currentProcess = null;
    if (autoDJRunning && !liveMode && myGeneration === generation) setTimeout(playSong, 200);
  });
}

function playSong() {
  if (!autoDJRunning || liveMode) return;
  if (!loadPlaylist()) {
    setTimeout(playSong, 5000);
    return;
  }

  const previous = nowPlaying;
  let item = null;

  if (shouldPlayAd()) {
    item = getTimedAd();
  } else {
    const song = getNextSong();
    if (!song) {
      setTimeout(playSong, 1000);
      return;
    }
    item = { type: "song", name: song, filePath: path.join(MUSIC_DIR, song) };
  }

  previousSong = previous;
  updateNowPlaying(item.name);
  addHistory(item.name);

  const myGeneration = generation;
  playItem(item, myGeneration);
}

function next() {
  if (!autoDJRunning || liveMode) return false;
  if (!playlist.length) loadPlaylist();
  terminateCurrent();
  playSong();
  return true;
}

function previous() {
  if (!autoDJRunning || liveMode) return false;
  if (!previousSong) return false;
  const current = nowPlaying;
  if (current && !queue.includes(current)) queue.unshift(current);
  queue.unshift(previousSong);
  terminateCurrent();
  playSong();
  return true;
}

function enqueue(song) {
  if (!song) return false;
  if (!playlist.includes(song)) return false;
  queue.push(song);
  nextSong = queue[0] || nextSong;
  return true;
}

function clearQueue() {
  queue = [];
  updateNowPlaying(nowPlaying);
}

function setShuffle(enabled) {
  shuffleMode = Boolean(enabled);
  return shuffleMode;
}

function setRepeat(enabled) {
  repeatMode = Boolean(enabled);
  return repeatMode;
}

function setCrossfade(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0 || value > 15) return false;
  crossfadeSeconds = value;
  return true;
}

function setAdInterval(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 0 || value > 240) return false;
  adIntervalMinutes = value;
  if (value > 0 && !lastAdAt) lastAdAt = Date.now();
  return true;
}

function startAutoDJ() {
  if (liveMode) return false;
  if (autoDJRunning) return true;
  if (!loadPlaylist()) return false;
  if (!stream.startAutoDJBroadcast()) return false;
  autoDJRunning = true;
  lastAdAt = Date.now();
  playSong();
  return true;
}

function stopAutoDJ() {
  autoDJRunning = false;
  terminateCurrent();
  stream.stopAutoDJBroadcast();
  nowPlaying = null;
  nextSong = null;
  previousSong = null;
  return true;
}

function startLive() {
  liveMode = true;
  terminateCurrent();
  return true;
}

function stopLive() {
  liveMode = false;
  if (autoDJRunning) setTimeout(playSong, 500);
  return true;
}

function getStatus() {
  return {
    autoDJ: autoDJRunning,
    live: liveMode,
    nowPlaying,
    nextSong,
    previousSong,
    musicCount: playlist.length,
    queue,
    shuffle: shuffleMode,
    repeat: repeatMode,
    crossfadeSeconds,
    adIntervalMinutes,
    adCount: getAdFiles().length,
    jingleCount: getJingleFiles().length,
    history: playHistory.slice(0, 20)
  };
}

module.exports = {
  startAutoDJ,
  stopAutoDJ,
  startLive,
  stopLive,
  getStatus,
  loadPlaylist,
  getMusicFiles,
  getAdFiles,
  getJingleFiles,
  next,
  previous,
  enqueue,
  clearQueue,
  setShuffle,
  setRepeat,
  setCrossfade,
  setAdInterval
};
