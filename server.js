const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const autoDJ = require("./radio/autodj");
const stream = require("./radio/stream");
const live = require("./radio/live");
const http = require("http");
const { WebSocketServer } = require("ws");
const { URL } = require("url");

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================
// JON RADIO PLATFORM
// JON FM ETHIOPIA
// MAIN SERVER
// Render redeploy marker: 2026-10-04 — Health endpoint + Auto DJ API/routes current
// =====================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================
// CORS — public browser API access
// Authentication is enforced by Bearer tokens, not browser cookies.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// =====================================
// JON RADIO PLATFORM ADMIN AUTH
// Password is stored only in Render Environment Variables.
// =====================================

const crypto = require("crypto");

// Accept the preferred Render variable and the legacy name.
// The password is never sent to the client or stored in the repository.
const ADMIN_PASSWORD = String(
  process.env.JON_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || ""
).trim();
const SESSION_SECRET =
  process.env.JON_ADMIN_SESSION_SECRET ||
  (ADMIN_PASSWORD ? crypto.createHash("sha256").update(ADMIN_PASSWORD).digest("hex") : "");

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");
  return body + "." + signature;
}

function verifySession(token) {
  if (!token || !SESSION_SECRET) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [body, signature] = parts;
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    );

    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function requireAdmin(req, res, next) {
  // Password login is temporarily disabled.
  req.adminAuthenticated = true;
  next();
}

app.post("/api/auth/login", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");

  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      success: false,
      error: "Admin password is not configured on the server."
    });
  }

  const ip = clientIp(req);
  const now = Date.now();
  const previous = loginAttempts.get(ip);

  if (previous && now - previous.startedAt < LOGIN_WINDOW_MS && previous.count >= MAX_LOGIN_ATTEMPTS) {
    return res.status(429).json({
      success: false,
      error: "Too many login attempts. Please try again later."
    });
  }

  if (!previous || now - previous.startedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { startedAt: now, count: 0 });
  }

  const password = String(req.body?.password || "");

  const provided = Buffer.from(password);
  const expected = Buffer.from(ADMIN_PASSWORD);

  const valid =
    provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected);

  if (!valid) {
    const attempt = loginAttempts.get(ip) || { startedAt: now, count: 0 };
    attempt.count += 1;
    loginAttempts.set(ip, attempt);

    return res.status(401).json({
      success: false,
      error: "Incorrect password."
    });
  }

  loginAttempts.delete(ip);

  const token = signSession({
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS
  });

  res.json({
    success: true,
    token,
    expiresIn: SESSION_TTL_MS
  });
});

app.get("/api/auth/check", requireAdmin, (req, res) => {
  res.json({ success: true, authenticated: true });
});

// Public health endpoint for deployment/runtime checks.
app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "JON RADIO PLATFORM",
    status: "ONLINE"
  });
});

// All /api routes below this point are admin-protected.
// Public update metadata, when present, is intentionally defined before this guard.
app.use("/api", requireAdmin);


// =====================================
// DIRECTORIES
// =====================================

const MUSIC_DIR = path.join(__dirname, "music");
const ADS_DIR = path.join(__dirname, "ads");
const JINGLES_DIR = path.join(__dirname, "jingles");

for (const dir of [MUSIC_DIR, ADS_DIR, JINGLES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
      cb(new Error("Only MP3, WAV, and M4A audio files are allowed."));
    }
  }
});

// =====================================
// ADVERTISEMENT + JINGLE UPLOAD
// =====================================

function mediaUpload(dir, fieldName) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, dir),
      filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        cb(null, `${Date.now()}-${safeName}`);
      }
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, [".mp3", ".wav", ".m4a"].includes(ext) || file.mimetype.startsWith("audio/"));
    }
  }).array(fieldName, 20);
}

app.post("/api/ads/upload", mediaUpload(ADS_DIR, "ads"), (req, res) => {
  res.json({ success: true, message: "Advertisement audio uploaded.", files: (req.files || []).map(f => f.filename), status: autoDJ.getStatus() });
});

app.post("/api/jingles/upload", mediaUpload(JINGLES_DIR, "jingles"), (req, res) => {
  res.json({ success: true, message: "Jingle / Station ID uploaded.", files: (req.files || []).map(f => f.filename), status: autoDJ.getStatus() });
});

// =====================================
// MEDIA FILES
// =====================================

app.use("/ads", express.static(ADS_DIR));
app.use("/jingles", express.static(JINGLES_DIR));

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
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    socket.destroy();
    return;
  }

  if (url.pathname !== "/live-mic") {
    socket.destroy();
    return;
  }

  // Password login is temporarily disabled, so the live microphone
  // WebSocket is also open while this temporary mode is active.
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
    autoDJ.removeMusic(filename);

    res.json({
      success: true,
      message: "Music deleted.",
      status: autoDJ.getStatus()
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
          : "No MP3/WAV/M4A file is available on the server. Upload music again after the latest Render deploy.",
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
// AUTO DJ ADVANCED CONTROLS
// =====================================

app.post("/api/autodj/next", (req, res) => {
  const success = autoDJ.next();
  res.json({ success, status: autoDJ.getStatus() });
});

app.post("/api/autodj/previous", (req, res) => {
  const success = autoDJ.previous();
  res.json({ success, status: autoDJ.getStatus() });
});

app.post("/api/autodj/queue", (req, res) => {
  const success = autoDJ.enqueue(req.body.song);
  res.json({ success, status: autoDJ.getStatus() });
});

app.post("/api/autodj/queue/clear", (req, res) => {
  autoDJ.clearQueue();
  res.json({ success: true, status: autoDJ.getStatus() });
});

app.get("/api/autodj/playlist", (req, res) => {
  res.json({ success: true, playlist: autoDJ.getPlaylist() });
});

app.post("/api/autodj/playlist", (req, res) => {
  const success = autoDJ.setPlaylist(req.body?.playlist);
  res.status(success ? 200 : 400).json({
    success,
    playlist: autoDJ.getPlaylist(),
    status: autoDJ.getStatus()
  });
});

app.post("/api/autodj/promotion", (req, res) => {
  const success = autoDJ.playPromotion();
  res.status(success ? 200 : 409).json({
    success,
    message: success ? "Promotion is now playing." : "Promotion could not play. Start Auto DJ and upload an advertisement first.",
    status: autoDJ.getStatus()
  });
});

app.post("/api/autodj/settings", (req, res) => {
  const result = {};
  if (req.body.shuffle !== undefined) result.shuffle = autoDJ.setShuffle(req.body.shuffle === true || req.body.shuffle === "true");
  if (req.body.repeat !== undefined) result.repeat = autoDJ.setRepeat(req.body.repeat === true || req.body.repeat === "true");
  if (req.body.crossfadeSeconds !== undefined) result.crossfade = autoDJ.setCrossfade(req.body.crossfadeSeconds);
  if (req.body.adIntervalMinutes !== undefined) result.adInterval = autoDJ.setAdInterval(req.body.adIntervalMinutes);
  res.json({ success: Object.values(result).every(Boolean), settings: result, status: autoDJ.getStatus() });
});

app.post("/api/autodj/pause", (req, res) => {
  const success = autoDJ.pause();
  res.json({ success, status: autoDJ.getStatus() });
});

app.post("/api/autodj/resume", (req, res) => {
  const success = autoDJ.resume();
  res.json({ success, status: autoDJ.getStatus() });
});

app.post("/api/autodj/gain", (req, res) => {
  const success = autoDJ.setGain(req.body.gainDb);
  res.json({ success, status: autoDJ.getStatus() });
});

app.post("/api/autodj/ad-times", (req, res) => {
  const success = autoDJ.setAdTimes(req.body.times);
  res.json({ success, status: autoDJ.getStatus() });
});

app.get("/api/autodj/history", (req, res) => {
  res.json({ success: true, history: autoDJ.getStatus().history });
});

app.get("/api/autodj/media", (req, res) => {
  res.json({ success: true, ads: autoDJ.getAdFiles(), jingles: autoDJ.getJingleFiles() });
});

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
