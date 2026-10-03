const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const autoDJ = require("./radio/autodj");
const stream = require("./radio/stream");
const live = require("./radio/live");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================
// JON RADIO PLATFORM
// JON FM ETHIOPIA
// MAIN SERVER
// =====================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// GitHub Pages frontend connection
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === "https://jonjossy0-cpu.github.io" || !origin) {
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// =====================================
// DIRECTORIES
// =====================================

const MUSIC_DIR = path.join(__dirname, "music");

if (!fs.existsSync(MUSIC_DIR)) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

// =====================================
// MUSIC UPLOAD
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
  limits: {
    fileSize: 50 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {
    const allowed = [
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/wave"
    ];

    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || ext === ".mp3" || ext === ".wav" || ext === ".m4a") {
      cb(null, true);
    } else {
      cb(new Error("Only MP3 and WAV files are allowed."));
    }
  }
});

// =====================================
// MUSIC FILES
// =====================================

app.use("/music", express.static(MUSIC_DIR));

// =====================================
// STATION
// =====================================

const station = {
  name: "JON FM ETHIOPIA",
  format: "MP3",
  bitrate: "128 kbps"
};

let listeners = 0;

const server = http.createServer(app);
const liveWSS = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/live-mic") {
    socket.destroy();
    return;
  }

  liveWSS.handleUpgrade(req, socket, head, ws => {
    liveWSS.emit("connection", ws, req);
  });
});

liveWSS.on("connection", ws => {
  // Pause Auto DJ while a microphone session is active.
  autoDJ.startLive();

  if (!live.start()) {
    autoDJ.stopLive();
    ws.close(1013, "Another broadcast source is active.");
    return;
  }

  ws.on("message", data => live.writeAudio(data));

  ws.on("close", () => {
    live.stop();
    autoDJ.stopLive();
  });

  ws.on("error", () => {
    live.stop();
    autoDJ.stopLive();
  });
});

// =====================================
// HOME
// =====================================

app.get("/", (req, res) => {
  res.json({
    platform: "JON RADIO PLATFORM",
    station: station.name,
    status: "ONLINE",
    message: "JON Radio Platform Backend is running."
  });
});

// =====================================
// STATUS
// =====================================

app.get("/api/status", (req, res) => {

  const dj = autoDJ.getStatus();
  const streamStatus = stream.getStatus();

  res.json({
    station: station.name,

    online:
      dj.autoDJ ||
      dj.live ||
      live.isActive() ||
      streamStatus.running,

    listeners: streamStatus.listeners,

    live: dj.live || live.isActive(),

    autoDJ: dj.autoDJ,

    stream: streamStatus.running,

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

        const ext =
          path.extname(file).toLowerCase();

        return (
          ext === ".mp3" ||
          ext === ".wav" ||
          ext === ".m4a"
        );

      })
      .map(file => {

        const filePath =
          path.join(MUSIC_DIR, file);

        const info =
          fs.statSync(filePath);

        return {
          name: file,
          size: info.size,
          url:
            `/music/${encodeURIComponent(file)}`
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

      message:
        "Music uploaded successfully.",

      file: {
        name: req.file.filename,
        originalName:
          req.file.originalname,
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

    if (autoDJ.getStatus().live) {

      return res.status(409).json({
        success: false,
        error:
          "Live broadcast is active."
      });

    }

    const started =
      autoDJ.startAutoDJ();

    if (!started) {
      const musicFiles = autoDJ.getMusicFiles();

      return res.status(409).json({
        success: false,
        error: musicFiles.length
          ? "Auto DJ could not start because the stream is busy or another broadcast source is active."
          : "No MP3/WAV file is available on the server. Upload music again after the latest Render deploy.",
        musicCount: musicFiles.length,
        stream: stream.getStatus(),
        autoDJ: autoDJ.getStatus()
      });
    }

    res.json({
      success: true,
      message:
        "JON FM Auto DJ started.",
      status:
        autoDJ.getStatus()
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

    res.json({
      success: true,
      message:
        "JON FM Auto DJ stopped.",
      status:
        autoDJ.getStatus()
    });

  }
);

// =====================================
// LIVE START
// =====================================

app.post(
  "/api/live/start",
  (req, res) => {

    const started = autoDJ.startLive();

    res.json({
      success: started,
      message: started
        ? "Live mode armed. Connect the microphone from the dashboard."
        : "Live mode could not start because another broadcast source is active.",
      status: {
        ...autoDJ.getStatus(),
        liveEngine: live.isActive()
      }
    });

  }
);

// =====================================
// LIVE STOP
// =====================================

app.post(
  "/api/live/stop",
  (req, res) => {

    live.stop();
    autoDJ.stopLive();

    res.json({
      success: true,
      message: "Live mode stopped. Auto DJ can resume.",
      status: {
        ...autoDJ.getStatus(),
        liveEngine: live.isActive()
      }
    });

  }
);

// =====================================
// STREAM START
// =====================================

app.post(
  "/api/stream/start",
  (req, res) => {

    const input =
      req.body.input;

    if (!input) {

      return res.status(400).json({
        success: false,
        error:
          "Stream input is required."
      });

    }

    stream.startStream(input);

    res.json({
      success: true,
      message:
        "JON FM stream engine started.",
      status:
        stream.getStatus()
    });

  }
);

// =====================================
// STREAM STOP
// =====================================

app.post(
  "/api/stream/stop",
  (req, res) => {

    stream.stopStream();

    res.json({
      success: true,
      message:
        "JON FM stream stopped.",
      status:
        stream.getStatus()
    });

  }
);

// =====================================
// JON FM PUBLIC AUDIO STREAM
// =====================================

app.get("/jonfm", (req, res) => {
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader(
    "Cache-Control",
    "no-cache, no-store, must-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.flushHeaders();

  stream.addClient(res);

  req.on("close", () => {
    try {
      res.end();
    } catch (error) {
      // Client already disconnected
    }
  });
});

// =====================================
// LISTENERS
// =====================================

app.post(
  "/api/listeners",
  (req, res) => {

    const count =
      Number(req.body.count);

    if (
      Number.isFinite(count) &&
      count >= 0
    ) {
      listeners =
        Math.floor(count);
    }

    res.json({
      success: true,
      listeners
    });

  }
);

// =====================================
// STATION INFO
// =====================================

app.get(
  "/api/station",
  (req, res) => {

    res.json({
      ...station,
      status:
        autoDJ.getStatus(),
      stream:
        stream.getStatus()
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
        err.message ||
        "Server error."
    });

  }
);

// =====================================
// START SERVER
// =====================================

server.listen(PORT, "0.0.0.0", () => {

  console.log("");
  console.log("================================");
  console.log("      JON RADIO PLATFORM");
  console.log("      JON FM ETHIOPIA");
  console.log("================================");
  console.log(
    `Server running on port ${PORT}`
  );
  console.log(
    "Auto DJ Engine: READY"
  );
  console.log(
    "Stream Engine: READY"
  );
  console.log(
    "Music Upload: READY"
  );
  console.log(
    "Live Control: READY"
  );
  console.log("================================");
  console.log("");

});
