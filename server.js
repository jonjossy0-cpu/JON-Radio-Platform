const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const autoDJ = require("./radio/autodj");

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================
// JON RADIO PLATFORM
// BACKEND SERVER
// =====================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================
// DIRECTORIES
// =====================================

const MUSIC_DIR = path.join(__dirname, "music");

if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

// =====================================
// MUSIC STORAGE
// =====================================

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

// =====================================
// STATIC MUSIC
// =====================================

app.use("/music", express.static(MUSIC_DIR));

// =====================================
// RADIO STATUS
// =====================================

let listeners = 0;

let station = {
  name: "JON FM ETHIOPIA",
  format: "MP3",
  bitrate: "128 kbps",
  online: false
};

// =====================================
// HOME
// =====================================

app.get("/", (req, res) => {
  res.json({
    platform: "JON RADIO PLATFORM",
    station: station.name,
    status: "ONLINE",
    message: "JON Radio Backend is running."
  });
});

// =====================================
// FULL STATUS
// =====================================

app.get("/api/status", (req, res) => {

  const dj = autoDJ.getStatus();

  res.json({
    station: station.name,
    online: station.online,
    listeners: listeners,

    live: dj.live,
    autoDJ: dj.autoDJ,

    nowPlaying: dj.nowPlaying,
    nextSong: dj.nextSong,

    musicCount: dj.musicCount
  });
});

// =====================================
// MUSIC LIBRARY
// =====================================

app.get("/api/music", (req, res) => {

  try {

    const files = fs.readdirSync(MUSIC_DIR);

    const music = files
      .filter(file => {
        const ext = path.extname(file).toLowerCase();

        return ext === ".mp3" || ext === ".wav";
      })
      .map(file => {

        const filePath = path.join(MUSIC_DIR, file);
        const stats = fs.statSync(filePath);

        return {
          name: file,
          size: stats.size,
          url: `/music/${encodeURIComponent(file)}`
        };
      });

    res.json(music);

  } catch (error) {

    res.status(500).json({
      error: "Unable to read music library."
    });

  }
});

// =====================================
// UPLOAD MUSIC
// =====================================

app.post(
  "/api/music/upload",
  upload.single("music"),
  (req, res) => {

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
        url:
          `/music/${encodeURIComponent(
            req.file.filename
          )}`
      }

    });

  }
);

// =====================================
// DELETE MUSIC
// =====================================

app.delete(
  "/api/music/:filename",
  (req, res) => {

    const filename =
      path.basename(req.params.filename);

    const filePath =
      path.join(MUSIC_DIR, filename);

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

  }
);

// =====================================
// AUTO DJ START
// =====================================

app.post(
  "/api/autodj/start",
  (req, res) => {

    const success =
      autoDJ.startAutoDJ();

    if (!success) {

      return res.status(409).json({
        success: false,
        error:
          "Auto DJ cannot start while Live is active."
      });

    }

    station.online = true;

    res.json({
      success: true,
      message: "JON FM Auto DJ started.",
      status: autoDJ.getStatus()
    });

  }
);

// =====================================
// AUTO DJ STOP
// =====================================

app.post(
  "/api/autodj/stop",
  (req, res) => {

    autoDJ.stopAutoDJ();

    station.online = false;

    res.json({
      success: true,
      message: "JON FM Auto DJ stopped.",
      status: autoDJ.getStatus()
    });

  }
);

// =====================================
// LIVE START
// =====================================

app.post(
  "/api/live/start",
  (req, res) => {

    autoDJ.startLive();

    station.online = true;

    res.json({
      success: true,
      message:
        "Live broadcast started. Auto DJ paused.",
      status: autoDJ.getStatus()
    });

  }
);

// =====================================
// LIVE STOP
// =====================================

app.post(
  "/api/live/stop",
  (req, res) => {

    autoDJ.stopLive();

    station.online = true;

    res.json({
      success: true,
      message:
        "Live broadcast stopped. Auto DJ can resume.",
      status: autoDJ.getStatus()
    });

  }
);

// =====================================
// LISTENER COUNT
// =====================================

app.post(
  "/api/listeners",
  (req, res) => {

    const count =
      Number(req.body.count);

    if (
      !Number.isNaN(count) &&
      count >= 0
    ) {
      listeners = Math.floor(count);
    }

    res.json({
      success: true,
      listeners
    });

  }
);

// =====================================
// STATION INFORMATION
// =====================================

app.get(
  "/api/station",
  (req, res) => {

    res.json({
      name: station.name,
      format: station.format,
      bitrate: station.bitrate,
      online: station.online,
      status: autoDJ.getStatus()
    });

  }
);

// =====================================
// ERROR HANDLER
// =====================================

app.use(
  (err, req, res, next) => {

    console.error(err);

    res.status(500).json({
      success: false,
      error:
        err.message || "Server error."
    });

  }
);

// =====================================
// START SERVER
// =====================================

app.listen(PORT, () => {

  console.log("");
  console.log("================================");
  console.log("     JON RADIO PLATFORM");
  console.log("     JON FM ETHIOPIA");
  console.log("================================");
  console.log(`Server running on port ${PORT}`);
  console.log("Auto DJ Engine: READY");
  console.log("Music Upload: READY");
  console.log("Live Control: READY");
  console.log("================================");
  console.log("");

});
