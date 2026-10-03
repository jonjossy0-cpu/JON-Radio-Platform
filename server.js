const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ===============================
// JON RADIO PLATFORM
// Backend Foundation
// ===============================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------------------
// Folders
// -------------------------------

const MUSIC_DIR = path.join(__dirname, "music");

if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

// -------------------------------
// Music Upload
// -------------------------------

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, MUSIC_DIR);
  },

  filename: (req, file, cb) => {
    const safeName = file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, "_");

    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,

  fileFilter: (req, file, cb) => {
    const allowed = [
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/wave"
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only MP3 and WAV files are allowed."));
    }
  }
});

// -------------------------------
// Music folder
// -------------------------------

app.use("/music", express.static(MUSIC_DIR));

// -------------------------------
// Platform Status
// -------------------------------

let radioStatus = {
  station: "JON FM ETHIOPIA",
  online: false,
  live: false,
  autoDJ: false,
  nowPlaying: null,
  nextSong: null,
  listeners: 0
};

// -------------------------------
// Home
// -------------------------------

app.get("/", (req, res) => {
  res.json({
    platform: "JON RADIO PLATFORM",
    station: "JON FM ETHIOPIA",
    status: "ONLINE",
    message: "JON Radio Backend is running."
  });
});

// -------------------------------
// Status API
// -------------------------------

app.get("/api/status", (req, res) => {
  res.json(radioStatus);
});

// -------------------------------
// Music Library
// -------------------------------

app.get("/api/music", (req, res) => {
  try {
    const files = fs.readdirSync(MUSIC_DIR);

    const music = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ext === ".mp3" || ext === ".wav";
      })
      .map(file => ({
        name: file,
        url: `/music/${encodeURIComponent(file)}`
      }));

    res.json(music);

  } catch (error) {
    res.status(500).json({
      error: "Unable to read music library."
    });
  }
});

// -------------------------------
// Upload Music
// -------------------------------

app.post("/api/music/upload", upload.single("music"), (req, res) => {

  if (!req.file) {
    return res.status(400).json({
      error: "No music file uploaded."
    });
  }

  res.json({
    success: true,
    message: "Music uploaded successfully.",
    file: {
      name: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      url: `/music/${encodeURIComponent(req.file.filename)}`
    }
  });
});

// -------------------------------
// Delete Music
// -------------------------------

app.delete("/api/music/:filename", (req, res) => {

  const filename = path.basename(req.params.filename);
  const filePath = path.join(MUSIC_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: "Music file not found."
    });
  }

  fs.unlinkSync(filePath);

  res.json({
    success: true,
    message: "Music deleted."
  });
});

// -------------------------------
// Auto DJ
// -------------------------------

app.post("/api/autodj/start", (req, res) => {

  if (radioStatus.live) {
    return res.status(409).json({
      error: "Live broadcast is currently active."
    });
  }

  radioStatus.autoDJ = true;
  radioStatus.online = true;

  res.json({
    success: true,
    message: "Auto DJ started.",
    status: radioStatus
  });
});

app.post("/api/autodj/stop", (req, res) => {

  radioStatus.autoDJ = false;

  res.json({
    success: true,
    message: "Auto DJ stopped.",
    status: radioStatus
  });
});

// -------------------------------
// Live Microphone
// -------------------------------

app.post("/api/live/start", (req, res) => {

  radioStatus.live = true;

  // Live mode automatically pauses Auto DJ
  radioStatus.autoDJ = false;
  radioStatus.online = true;

  res.json({
    success: true,
    message: "Live microphone mode started. Auto DJ paused.",
    status: radioStatus
  });
});

app.post("/api/live/stop", (req, res) => {

  radioStatus.live = false;

  res.json({
    success: true,
    message: "Live microphone stopped. Auto DJ can resume.",
    status: radioStatus
  });
});

// -------------------------------
// Now Playing
// -------------------------------

app.post("/api/now-playing", (req, res) => {

  const { nowPlaying, nextSong } = req.body;

  radioStatus.nowPlaying = nowPlaying || null;
  radioStatus.nextSong = nextSong || null;

  res.json({
    success: true,
    status: radioStatus
  });
});

// -------------------------------
// Listener Count
// -------------------------------

app.post("/api/listeners", (req, res) => {

  const count = Number(req.body.count);

  if (!Number.isNaN(count) && count >= 0) {
    radioStatus.listeners = count;
  }

  res.json({
    success: true,
    listeners: radioStatus.listeners
  });
});

// -------------------------------
// Station Information
// -------------------------------

app.get("/api/station", (req, res) => {

  res.json({
    name: "JON FM ETHIOPIA",
    format: "MP3/AAC",
    broadcasting: radioStatus.online,
    live: radioStatus.live,
    autoDJ: radioStatus.autoDJ
  });
});

// -------------------------------
// Error Handler
// -------------------------------

app.use((err, req, res, next) => {

  console.error(err);

  res.status(500).json({
    error: err.message || "Server error."
  });
});

// -------------------------------
// Start Server
// -------------------------------

app.listen(PORT, () => {

  console.log("--------------------------------");
  console.log("JON RADIO PLATFORM");
  console.log("JON FM ETHIOPIA");
  console.log("--------------------------------");
  console.log(`Server running on port ${PORT}`);
});
