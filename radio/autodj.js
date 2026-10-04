const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const stream = require("./stream");

let FFMPEG_PATH = "ffmpeg";
try {
  const ffmpegStatic = require("ffmpeg-static");
  if (ffmpegStatic) FFMPEG_PATH = ffmpegStatic;
} catch {
  // Fall back to a system ffmpeg when ffmpeg-static is not installed.
}

const MUSIC_DIR = path.join(__dirname, "..", "music");
const ADS_DIR = path.join(__dirname, "..", "ads");
const JINGLES_DIR = path.join(__dirname, "..", "jingles");

let playlist = [];
let currentIndex = 0;
let currentProcess = null;
let autoDJRunning = false;
let liveMode = false;
let paused = false;
let nowPlaying = null;
let nextSong = null;
let previousSong = null;
let currentItem = null;
let currentOffset = 0;
let shuffleMode = false;
let repeatMode = false;
let crossfadeSeconds = 5;
let adIntervalMinutes = 0;
let adTimes = [];
let lastAdAt = 0;
let lastScheduledAdKey = "";
let adIndex = 0;
let jingleIndex = 0;
let playHistory = [];
let queue = [];
let generation = 0;
let gainDb = 0;
let configuredPlaylist = null;

function audioFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => {
    const ext = path.extname(file).toLowerCase();
    return [".mp3", ".wav", ".m4a"].includes(ext);
  });
}

function getMusicFiles() { return audioFiles(MUSIC_DIR); }
function getAdFiles() { return audioFiles(ADS_DIR); }
function getJingleFiles() { return audioFiles(JINGLES_DIR); }

function ensureDirs() {
  for (const dir of [MUSIC_DIR, ADS_DIR, JINGLES_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function loadPlaylist() {
  ensureDirs();
  const files = getMusicFiles();
  if (!files.length) return false;
  if (Array.isArray(configuredPlaylist)) {
    playlist = configuredPlaylist.filter(file => files.includes(file));
    if (!playlist.length) playlist = files;
  } else {
    playlist = files;
  }
  if (currentIndex >= playlist.length) currentIndex = 0;
  return true;
}

function chooseIndex() {
  if (!playlist.length) return -1;
  if (shuffleMode) {
    if (playlist.length === 1) return 0;
    let index = Math.floor(Math.random() * playlist.length);
    if (playlist[index] === nowPlaying) index = (index + 1) % playlist.length;
    return index;
  }
  if (currentIndex >= playlist.length) currentIndex = 0;
  return currentIndex++;
}

function makeSong(song) {
  return { type: "song", name: song, filePath: path.join(MUSIC_DIR, song) };
}

function getNextSong() {
  if (queue.length) return makeSong(queue.shift());
  const index = chooseIndex();
  return index >= 0 ? makeSong(playlist[index]) : null;
}

function updateNext(song) {
  nextSong = song ? song.name : null;
}

function addHistory(item) {
  playHistory.unshift({ item, at: new Date().toISOString() });
  if (playHistory.length > 100) playHistory.length = 100;
}

function shouldPlayAd() {
  const ads = getAdFiles();
  if (!ads.length) return false;

  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const key = now.toISOString().slice(0, 10) + " " + hhmm;

  if (adTimes.includes(hhmm) && key !== lastScheduledAdKey) {
    lastScheduledAdKey = key;
    return true;
  }

  return adIntervalMinutes > 0 &&
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

function getFollowingItem() {
  if (shouldPlayAd()) return getTimedAd();
  if (repeatMode && currentItem && currentItem.type === "song") return makeSong(currentItem.name);
  const song = getNextSong();
  if (!song) return null;
  return song;
}

function getTransitionItem() {
  if (currentItem && currentItem.type === "song") {
    const jingle = getJingle();
    if (jingle) return jingle;
  }
  return getFollowingItem();
}

function terminateCurrent() {
  generation += 1;
  if (currentProcess) {
    try { currentProcess.kill("SIGTERM"); } catch {}
    currentProcess = null;
  }
}

function spawnSingle(item, offset, myGeneration) {
  const args = [
    "-hide_banner", "-loglevel", "error", "-re",
    ...(offset > 0 ? ["-ss", String(offset)] : []),
    "-i", item.filePath,
    "-vn", "-ac", "2", "-ar", "44100",
    "-af", `volume=${gainDb}dB`,
    "-b:a", "128k", "-f", "mp3", "pipe:1"
  ];

  currentProcess = spawn(FFMPEG_PATH, args);
  currentProcess.stdout.on("data", chunk => stream.broadcastAudio(chunk));
  currentProcess.stderr.on("data", data => console.error("JON AUTO DJ FFmpeg:", data.toString().trim()));

  currentProcess.on("error", error => {
    console.error("JON AUTO DJ FFmpeg error:", error.message);
    currentProcess = null;
    if (autoDJRunning && !liveMode && myGeneration === generation && !paused) setTimeout(advance, 500);
  });

  currentProcess.on("close", () => {
    currentProcess = null;
    if (autoDJRunning && !liveMode && myGeneration === generation && !paused) setTimeout(advance, 100);
  });
}

function spawnCrossfade(first, second, fade, myGeneration) {
  const d = Math.max(0.1, Number(fade));
  const args = [
    "-hide_banner", "-loglevel", "error", "-re",
    "-i", first.filePath,
    "-re", "-i", second.filePath,
    "-filter_complex", `[0:a]aresample=44100,aformat=channel_layouts=stereo[a0];[1:a]aresample=44100,aformat=channel_layouts=stereo[a1];[a0][a1]acrossfade=d=${d}:curve1=tri:curve2=tri,volume=${gainDb}dB[aout]`,
    "-map", "[aout]", "-b:a", "128k", "-f", "mp3", "pipe:1"
  ];

  currentProcess = spawn(FFMPEG_PATH, args);
  currentProcess.stdout.on("data", chunk => stream.broadcastAudio(chunk));
  currentProcess.stderr.on("data", data => console.error("JON AUTO DJ FFmpeg:", data.toString().trim()));

  currentProcess.on("error", error => {
    console.error("JON AUTO DJ crossfade error:", error.message);
    currentProcess = null;
    if (autoDJRunning && !liveMode && myGeneration === generation && !paused) setTimeout(advance, 500);
  });

  currentProcess.on("close", () => {
    currentProcess = null;
    if (autoDJRunning && !liveMode && myGeneration === generation && !paused) {
      currentOffset = d;
      currentItem = second;
      nowPlaying = second.name;
      setTimeout(advance, 100);
    }
  });
}

function playPair(first, second, myGeneration) {
  if (crossfadeSeconds <= 0 || !second) {
    spawnSingle(first, currentOffset, myGeneration);
    return;
  }
  spawnCrossfade(first, second, crossfadeSeconds, myGeneration);
}

function advance() {
  if (!autoDJRunning || liveMode || paused) return;
  if (!loadPlaylist()) {
    setTimeout(advance, 5000);
    return;
  }

  const first = currentItem ? currentItem : getFollowingItem();
  if (!first) {
    setTimeout(advance, 1000);
    return;
  }

  const second = getTransitionItem();
  previousSong = nowPlaying;
  currentItem = first;
  currentOffset = currentItem === first && nowPlaying === first.name ? currentOffset : 0;
  nowPlaying = first.name;
  updateNext(second);
  addHistory(first.name);

  const myGeneration = generation;
  playPair(first, second, myGeneration);
}

function next() {
  if (!autoDJRunning || liveMode || paused) return false;
  if (!loadPlaylist()) return false;

  // Explicit Next must skip the current item immediately.
  // It bypasses Repeat/Ad timing for this manual action.
  terminateCurrent();

  const nextItem = getNextSong();
  if (!nextItem) return false;

  previousSong = nowPlaying;
  currentItem = nextItem;
  currentOffset = 0;
  nowPlaying = nextItem.name;

  const transition = getTransitionItem();
  updateNext(transition);
  addHistory(nextItem.name);

  const myGeneration = generation;
  playPair(nextItem, transition, myGeneration);
  return true;
}

function previous() {
  if (!autoDJRunning || liveMode || !previousSong) return false;
  terminateCurrent();
  const current = nowPlaying;
  if (current && current !== previousSong && !queue.includes(current)) queue.unshift(current);
  queue.unshift(previousSong);
  currentItem = null;
  currentOffset = 0;
  advance();
  return true;
}

function enqueue(song) {
  if (!song || !playlist.includes(song)) return false;
  queue.push(song);
  updateNext({ name: queue[0] });
  return true;
}

function setPlaylist(items) {
  if (!Array.isArray(items)) return false;
  const files = getMusicFiles();
  const valid = [...new Set(items.map(v => path.basename(String(v))).filter(v => files.includes(v)))];
  configuredPlaylist = valid;
  playlist = valid.length ? valid : files;
  if (currentIndex >= playlist.length) currentIndex = 0;
  updateNext(nextSong ? { name: nextSong } : null);
  return true;
}

function getPlaylist() {
  return playlist.slice();
}

function removeMusic(filename) {
  const name = path.basename(String(filename));
  configuredPlaylist = Array.isArray(configuredPlaylist)
    ? configuredPlaylist.filter(item => item !== name)
    : configuredPlaylist;
  queue = queue.filter(item => item !== name);
  const wasCurrent = currentItem && currentItem.name === name;
  if (wasCurrent) {
    terminateCurrent();
    currentItem = null;
    currentOffset = 0;
    nowPlaying = null;
    nextSong = null;
    if (autoDJRunning && !liveMode && !paused) setTimeout(advance, 100);
  }
  playlist = playlist.filter(item => item !== name);
  if (currentIndex >= playlist.length) currentIndex = 0;
  return true;
}

function playPromotion() {
  if (!autoDJRunning || liveMode || paused) return false;
  const ad = getTimedAd();
  if (!ad) return false;
  terminateCurrent();
  currentItem = null;
  currentOffset = 0;
  nowPlaying = ad.name;
  nextSong = null;
  const myGeneration = generation;
  spawnSingle(ad, 0, myGeneration);
  return true;
}

function clearQueue() {
  queue = [];
  updateNext(null);
}

function setShuffle(enabled) { shuffleMode = Boolean(enabled); return shuffleMode; }
function setRepeat(enabled) { repeatMode = Boolean(enabled); return repeatMode; }

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

function setAdTimes(times) {
  if (!Array.isArray(times)) return false;
  const valid = times.filter(t => /^([01]\\d|2[0-3]):[0-5]\\d$/.test(String(t)));
  adTimes = [...new Set(valid)];
  return true;
}

function setGain(db) {
  const value = Number(db);
  if (!Number.isFinite(value) || value < -12 || value > 12) return false;
  gainDb = value;
  return true;
}

function pause() {
  if (!currentProcess || !autoDJRunning || liveMode || paused) return false;
  try {
    process.kill(currentProcess.pid, "SIGSTOP");
    paused = true;
    return true;
  } catch { return false; }
}

function resume() {
  if (!currentProcess || !paused) return false;
  try {
    process.kill(currentProcess.pid, "SIGCONT");
    paused = false;
    return true;
  } catch { return false; }
}

function startAutoDJ() {
  if (liveMode) return false;
  if (autoDJRunning) return true;
  if (!loadPlaylist()) return false;
  if (!stream.startAutoDJBroadcast()) return false;
  autoDJRunning = true;
  paused = false;
  lastAdAt = Date.now();
  currentItem = null;
  currentOffset = 0;
  advance();
  return true;
}

function stopAutoDJ() {
  autoDJRunning = false;
  paused = false;
  terminateCurrent();
  stream.stopAutoDJBroadcast();
  nowPlaying = null;
  nextSong = null;
  previousSong = null;
  currentItem = null;
  currentOffset = 0;
  return true;
}

function startLive() {
  if (liveMode) return true;
  liveMode = true;
  terminateCurrent();
  return true;
}

function stopLive() {
  liveMode = false;
  if (autoDJRunning) {
    paused = false;
    currentItem = null;
    currentOffset = 0;
    setTimeout(advance, 300);
  }
  return true;
}

function getStatus() {
  return {
    autoDJ: autoDJRunning,
    live: liveMode,
    paused,
    nowPlaying,
    nextSong,
    previousSong,
    musicCount: playlist.length,
    queue,
    shuffle: shuffleMode,
    repeat: repeatMode,
    crossfadeSeconds,
    adIntervalMinutes,
    adTimes,
    gainDb,
    adCount: getAdFiles().length,
    jingleCount: getJingleFiles().length,
    history: playHistory.slice(0, 20),
    playlist: playlist.slice()
  };
}

module.exports = {
  startAutoDJ, stopAutoDJ, startLive, stopLive, getStatus,
  loadPlaylist, getMusicFiles, getAdFiles, getJingleFiles,
  next, previous, enqueue, clearQueue,
  setShuffle, setRepeat, setCrossfade, setAdInterval, setAdTimes, setGain,
  pause, resume, setPlaylist, getPlaylist, removeMusic, playPromotion
};
