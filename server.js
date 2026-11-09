import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import QRCode from "qrcode";
import pino from "pino";
import multer from "multer";
import { execFile, execFileSync, execSync } from "child_process";
import util from "util";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay,
  Browsers
} from "@whiskeysockets/baileys";
import { GoogleGenAI } from "@google/genai";
const execFilePromise = util.promisify(execFile);
const app = express();
const PORT = Number(process.env.PORT) || 3e3;
const DATA_DIR = path.resolve("./data");
const SESSIONS_DIR = path.resolve("./sessions");
const UPLOADS_DIR = path.resolve("./uploads");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const TEMP_UPLOADS_DIR = path.resolve("./uploads/temp");
if (!fs.existsSync(TEMP_UPLOADS_DIR)) fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const unique = `media_${Date.now()}_${Math.random().toString(36).substring(2, 6)}${ext}`;
    cb(null, unique);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
  // up to 100MB for HD videos and rich media
});
const chunkStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, TEMP_UPLOADS_DIR);
  },
  filename: (req, _file, cb) => {
    const uploadId = req.query.uploadId || req.headers["x-upload-id"] || req.body?.uploadId || "upl";
    const chunkIndex = req.query.chunkIndex || req.headers["x-chunk-index"] || req.body?.chunkIndex || "0";
    cb(null, `chunk_${uploadId}_${chunkIndex}`);
  }
});
const chunkUpload = multer({
  storage: chunkStorage,
  limits: { fileSize: 25 * 1024 * 1024 }
});
function getVideoMetadata(videoPath) {
  try {
    if (!fs.existsSync(videoPath)) return {};
    const probeOut = execFileSync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration",
      "-of",
      "default=noprint_wrappers=1",
      videoPath
    ], { timeout: 1e4 }).toString();
    let width;
    let height;
    let duration;
    for (const line of probeOut.split("\n")) {
      const [k, v] = line.split("=");
      if (k === "width" && v) width = parseInt(v.trim(), 10);
      if (k === "height" && v) height = parseInt(v.trim(), 10);
      if (k === "duration" && v) duration = parseFloat(v.trim());
    }
    const thumbPath = `${videoPath}_thumb.jpg`;
    if (!fs.existsSync(thumbPath)) {
      try {
        execFileSync("ffmpeg", [
          "-y",
          "-ss",
          "00:00:01",
          "-i",
          videoPath,
          "-vframes",
          "1",
          "-vf",
          "scale='min(480\\,iw)':-2",
          "-q:v",
          "3",
          thumbPath
        ], { timeout: 1e4 });
      } catch (e) {
        try {
          execFileSync("ffmpeg", [
            "-y",
            "-i",
            videoPath,
            "-vframes",
            "1",
            "-vf",
            "scale='min(480\\,iw)':-2",
            "-q:v",
            "3",
            thumbPath
          ], { timeout: 1e4 });
        } catch (e2) {
        }
      }
    }
    let jpegThumbnail;
    if (fs.existsSync(thumbPath)) {
      jpegThumbnail = fs.readFileSync(thumbPath);
    }
    return { width, height, duration, jpegThumbnail };
  } catch (err) {
    console.warn(`[Video Metadata Warning] Could not probe video:`, err.message);
    return {};
  }
}
async function compressVideoForWhatsApp(inputPath) {
  const originalSize = fs.existsSync(inputPath) ? fs.statSync(inputPath).size : 0;
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const outputFilename = `${baseName}_whatsapp.mp4`;
  const outputPath = path.join(UPLOADS_DIR, outputFilename);
  if (fs.existsSync(outputPath)) {
    const compressedSize = fs.statSync(outputPath).size;
    const meta = getVideoMetadata(outputPath);
    return {
      outputPath,
      outputFilename,
      outputUrl: `/uploads/${outputFilename}`,
      originalSize,
      compressedSize,
      width: meta.width,
      height: meta.height,
      duration: meta.duration
    };
  }
  const metaBefore = getVideoMetadata(inputPath);
  const durationSec = metaBefore.duration || 0;
  let scaleFilter = "scale='min(1280\\,iw)':-2";
  let crf = "28";
  let videoBitrateArgs = [];
  let audioBitrate = "96k";
  if (durationSec > 180) {
    scaleFilter = "scale='min(854\\,iw)':-2";
    crf = "32";
    videoBitrateArgs = ["-b:v", "650k", "-maxrate", "850k", "-bufsize", "1700k"];
    audioBitrate = "64k";
  } else if (durationSec > 60) {
    scaleFilter = "scale='min(1280\\,iw)':-2";
    crf = "30";
    videoBitrateArgs = ["-b:v", "1100k", "-maxrate", "1400k", "-bufsize", "2800k"];
    audioBitrate = "96k";
  }
  const ffmpegArgs = [
    "-y",
    "-i",
    inputPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "veryfast",
    "-crf",
    crf,
    ...videoBitrateArgs,
    "-vf",
    scaleFilter,
    "-c:a",
    "aac",
    "-b:a",
    audioBitrate,
    "-ar",
    "44100",
    "-movflags",
    "+faststart",
    outputPath
  ];
  try {
    await execFilePromise("ffmpeg", ffmpegArgs, { timeout: 18e4 });
    const compressedSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : originalSize;
    console.log(`[FFmpeg Video Compression] Success! ${inputPath} -> ${outputPath} | Original: ${(originalSize / (1024 * 1024)).toFixed(2)} MB -> Compressed: ${(compressedSize / (1024 * 1024)).toFixed(2)} MB`);
    const metaAfter = getVideoMetadata(outputPath);
    return {
      outputPath,
      outputFilename,
      outputUrl: `/uploads/${outputFilename}`,
      originalSize,
      compressedSize,
      width: metaAfter.width || metaBefore.width,
      height: metaAfter.height || metaBefore.height,
      duration: metaAfter.duration || metaBefore.duration
    };
  } catch (err) {
    console.error(`[FFmpeg Video Warning] FFmpeg compression failed:`, err.message);
    const fallbackMeta = getVideoMetadata(inputPath);
    return {
      outputPath: inputPath,
      outputFilename: path.basename(inputPath),
      outputUrl: `/uploads/${path.basename(inputPath)}`,
      originalSize,
      compressedSize: originalSize,
      width: fallbackMeta.width,
      height: fallbackMeta.height,
      duration: fallbackMeta.duration
    };
  }
}
function prepareMediaPayload(template, captionText) {
  if (!template) return { text: captionText };
  let localPath = null;
  if (template.filePath && fs.existsSync(template.filePath)) {
    localPath = template.filePath;
  } else if (template.mediaUrl && template.mediaUrl.startsWith("/uploads/")) {
    const filename = path.basename(template.mediaUrl);
    const fullPath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(fullPath)) localPath = fullPath;
  }
  if (localPath) {
    const ext = path.extname(localPath).toLowerCase();
    const isImage = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext);
    const isVideo = [".mp4", ".mov", ".mkv", ".3gp", ".avi", ".webm"].includes(ext) || template.mediaType === "video";
    const isPdf = ext === ".pdf";
    if (isVideo) {
      let videoFileToRead = localPath;
      const parsed = path.parse(localPath);
      const possibleCompressed = path.join(parsed.dir, `${parsed.name}_whatsapp.mp4`);
      if (fs.existsSync(possibleCompressed)) {
        videoFileToRead = possibleCompressed;
      }
      const meta = getVideoMetadata(videoFileToRead);
      const buffer = fs.readFileSync(videoFileToRead);
      const payload = {
        video: buffer,
        mimetype: "video/mp4",
        caption: captionText,
        ptv: false,
        gifPlayback: false
      };
      if (meta.width && meta.height) {
        payload.width = meta.width;
        payload.height = meta.height;
      }
      if (meta.duration) {
        payload.seconds = Math.round(meta.duration);
      }
      if (meta.jpegThumbnail) {
        payload.jpegThumbnail = meta.jpegThumbnail;
      }
      return payload;
    } else {
      const buffer = fs.readFileSync(localPath);
      if (isImage) {
        return {
          image: buffer,
          caption: captionText
        };
      } else if (isPdf) {
        return {
          document: buffer,
          mimetype: "application/pdf",
          fileName: template.fileName || path.basename(localPath),
          caption: captionText
        };
      } else {
        return {
          document: buffer,
          mimetype: "application/octet-stream",
          fileName: template.fileName || path.basename(localPath),
          caption: captionText
        };
      }
    }
  }
  if (template.mediaUrl && template.mediaUrl.startsWith("data:")) {
    const [meta, base64Data] = template.mediaUrl.split(",");
    const mimeMatch = meta.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const buffer = Buffer.from(base64Data, "base64");
    if (mime.startsWith("video/")) {
      const tempPath = path.join(TEMP_UPLOADS_DIR, `temp_${Date.now()}.mp4`);
      try {
        fs.writeFileSync(tempPath, buffer);
        const meta2 = getVideoMetadata(tempPath);
        const payload = {
          video: buffer,
          mimetype: "video/mp4",
          caption: captionText,
          ptv: false,
          gifPlayback: false
        };
        if (meta2.width && meta2.height) {
          payload.width = meta2.width;
          payload.height = meta2.height;
        }
        if (meta2.duration) {
          payload.seconds = Math.round(meta2.duration);
        }
        if (meta2.jpegThumbnail) {
          payload.jpegThumbnail = meta2.jpegThumbnail;
        }
        return payload;
      } catch (e) {
        return {
          video: buffer,
          mimetype: "video/mp4",
          caption: captionText,
          ptv: false,
          gifPlayback: false
        };
      }
    } else if (mime.startsWith("image/")) {
      return {
        image: buffer,
        caption: captionText
      };
    } else {
      return {
        document: buffer,
        mimetype: mime,
        fileName: template.fileName || "attachment.pdf",
        caption: captionText
      };
    }
  }
  return { text: captionText };
}
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const CAMPAIGNS_FILE = path.join(DATA_DIR, "campaigns.json");
const LOGS_FILE = path.join(DATA_DIR, "logs.json");
const RULES_FILE = path.join(DATA_DIR, "auto_responders.json");
const STOP_NUMBERS_FILE = path.join(DATA_DIR, "stop_numbers.json");
const SESSIONS_VAULT_FILE = path.join(DATA_DIR, "sessions_vault.json");
const sockets = /* @__PURE__ */ new Map();
const qrCodes = /* @__PURE__ */ new Map();
const connectionStatuses = /* @__PURE__ */ new Map();
const reconnectAttempts = /* @__PURE__ */ new Map();
const connectionErrors = /* @__PURE__ */ new Map();
function loadJson(filePath, defaultVal) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return defaultVal;
}
function saveJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error(`Error saving ${filePath}:`, err);
  }
}
function exportSessionKeys(accountId) {
  try {
    const sessionDir = path.join(SESSIONS_DIR, `session_${accountId}`);
    if (!fs.existsSync(sessionDir)) return null;
    const files = fs.readdirSync(sessionDir);
    if (!files.includes("creds.json")) return null;
    const bundle = {};
    for (const f of files) {
      const fullPath = path.join(sessionDir, f);
      if (fs.statSync(fullPath).isFile()) {
        bundle[f] = fs.readFileSync(fullPath, "utf-8");
      }
    }
    return bundle;
  } catch (err) {
    console.error(`Error exporting session keys for ${accountId}:`, err.message);
    return null;
  }
}
function importSessionKeys(accountId, keys) {
  try {
    if (!keys || !keys["creds.json"]) return false;
    const sessionDir = path.join(SESSIONS_DIR, `session_${accountId}`);
    const backupDir = path.join(DATA_DIR, "session_backups", accountId);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    for (const [filename, content] of Object.entries(keys)) {
      fs.writeFileSync(path.join(sessionDir, filename), content, "utf-8");
      fs.writeFileSync(path.join(backupDir, filename), content, "utf-8");
    }
    const vault = loadJson(SESSIONS_VAULT_FILE, {});
    vault[accountId] = keys;
    saveJson(SESSIONS_VAULT_FILE, vault);
    console.log(`[Session Vault] Successfully restored ${Object.keys(keys).length} session keys for account ${accountId}`);
    return true;
  } catch (err) {
    console.error(`Error importing session keys for ${accountId}:`, err.message);
    return false;
  }
}
function persistSessionToVault(accountId) {
  try {
    const keys = exportSessionKeys(accountId);
    if (keys && keys["creds.json"]) {
      const vault = loadJson(SESSIONS_VAULT_FILE, {});
      vault[accountId] = keys;
      saveJson(SESSIONS_VAULT_FILE, vault);
      const backupDir = path.join(DATA_DIR, "session_backups", accountId);
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      for (const [f, c] of Object.entries(keys)) {
        fs.writeFileSync(path.join(backupDir, f), c, "utf-8");
      }
      console.log(`[Session Vault] Backed up ${Object.keys(keys).length} keys for account ${accountId} to persistent vault and backup disk.`);
    }
  } catch (err) {
    console.error(`Error persisting session to vault for ${accountId}:`, err.message);
  }
}
function resolveSpintax(text) {
  const spintaxRegex = /\{([^{}]+)\}/;
  let matches = spintaxRegex.exec(text);
  while (matches) {
    const choices = matches[1].split("|");
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    text = text.replace(matches[0], randomChoice);
    matches = spintaxRegex.exec(text);
  }
  return text;
}
function replaceVariables(text, vars) {
  let result = text;
  for (const [key, val] of Object.entries(vars)) {
    if (val !== void 0) {
      const reg = new RegExp("{{" + key + "}}", "gi");
      result = result.replace(reg, val);
    }
  }
  return result;
}
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function normalizeWhatsAppNumber(phone, defaultCountryCode = "94") {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) {
    digits = digits.substring(2);
  }
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `${defaultCountryCode}${digits.substring(1)}`;
  } else if (digits.length === 9 && (digits.startsWith("7") || digits.startsWith("1"))) {
    digits = `${defaultCountryCode}${digits}`;
  }
  return digits;
}
function formatToJid(phone) {
  const norm = normalizeWhatsAppNumber(phone);
  return `${norm}@s.whatsapp.net`;
}
function isStopNumber(phone) {
  if (!phone) return { isStopped: false };
  const rawTarget = phone.replace(/\D/g, "");
  if (!rawTarget) return { isStopped: false };
  const targetCore = rawTarget.length >= 9 ? rawTarget.slice(-9) : rawTarget;
  const targetNorm = normalizeWhatsAppNumber(phone);
  const stopList = loadJson(STOP_NUMBERS_FILE, []);
  for (const item of stopList) {
    const rawItem = (item.phoneNumber || item.normalizedPhone || "").toString();
    const cleanItem = rawItem.replace(/\D/g, "");
    if (!cleanItem) continue;
    const itemCore = cleanItem.length >= 9 ? cleanItem.slice(-9) : cleanItem;
    const itemNorm = item.normalizedPhone || normalizeWhatsAppNumber(rawItem);
    if (targetCore && itemCore && targetCore === itemCore || targetNorm && itemNorm && targetNorm === itemNorm || rawTarget === cleanItem || phone.trim() === rawItem.trim()) {
      return { isStopped: true, reason: item.reason || "Opt-Out (Stop List)" };
    }
  }
  return { isStopped: false };
}
function isBaileysSocketOpen(sock) {
  if (!sock || !sock.ws) return false;
  return Boolean(
    sock.ws.isOpen === true || sock.ws.socket?.readyState === 1 || sock.ws.readyState === 1
  );
}
function isAccountGenuinelyConnected(accId) {
  const sock = sockets.get(accId);
  if (!sock) return false;
  const isWsOpen = isBaileysSocketOpen(sock);
  const userJid = sock.user?.id || sock.authState?.creds?.me?.id;
  const liveStatus = connectionStatuses.get(accId);
  return Boolean(isWsOpen && userJid && (liveStatus === "CONNECTED" || Boolean(sock.user?.id)));
}
async function initBaileysAccount(accountId, accountName = "WhatsApp Account", forceNewQr = false, resetSession = false) {
  const existingSock = sockets.get(accountId);
  if (existingSock) {
    const isSocketAlive = isBaileysSocketOpen(existingSock);
    if (!forceNewQr && !resetSession && isSocketAlive && isAccountGenuinelyConnected(accountId)) {
      console.log(`[Baileys Real] Account ${accountId} is already actively connected. Preserving live socket.`);
      return existingSock;
    }
    try {
      existingSock.ev.removeAllListeners("connection.update");
      existingSock.ev.removeAllListeners("creds.update");
      existingSock.end(void 0);
    } catch (e) {
    }
    sockets.delete(accountId);
  }
  const sessionDir = path.join(SESSIONS_DIR, `session_${accountId}`);
  const backupDir = path.join(DATA_DIR, "session_backups", accountId);
  if (resetSession || forceNewQr) {
    console.log(`[Baileys Real] Session reset / fresh QR requested for ${accountId}. Clearing session files.`);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      fs.rmSync(backupDir, { recursive: true, force: true });
      if (resetSession) {
        const vault = loadJson(SESSIONS_VAULT_FILE, {});
        delete vault[accountId];
        saveJson(SESSIONS_VAULT_FILE, vault);
      }
    } catch (e) {
    }
    qrCodes.delete(accountId);
  }
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  if (!resetSession && !forceNewQr && !fs.existsSync(path.join(sessionDir, "creds.json"))) {
    const vault = loadJson(SESSIONS_VAULT_FILE, {});
    if (vault[accountId] && vault[accountId]["creds.json"]) {
      console.log(`[Baileys Recovery] Recovering session keys from persistent vault for ${accountId}...`);
      importSessionKeys(accountId, vault[accountId]);
    } else if (fs.existsSync(path.join(backupDir, "creds.json"))) {
      console.log(`[Baileys Recovery] Recovering session keys from backup directory for ${accountId}...`);
      const backupFiles = fs.readdirSync(backupDir);
      for (const bf of backupFiles) {
        fs.copyFileSync(path.join(backupDir, bf), path.join(sessionDir, bf));
      }
    }
  }
  connectionStatuses.set(accountId, "CONNECTING");
  connectionErrors.delete(accountId);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  let version = [2, 3e3, 1043857760];
  try {
    const vRes = await fetchLatestBaileysVersion();
    if (vRes?.version) version = vRes.version;
  } catch (vErr) {
    console.warn(`[Baileys Version Warning] Could not fetch latest version (${vErr.message}). Using stable fallback.`);
  }
  console.log(`[Baileys Real] Initializing real WhatsApp socket for ${accountId} (Baileys v${version.join(".")})`);
  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"),
    connectTimeoutMs: 9e4,
    keepAliveIntervalMs: 15e3,
    defaultQueryTimeoutMs: 12e4,
    mediaUploadTimeoutMs: 3e5,
    // 5 minutes upload timeout for large videos & rich attachments
    options: {},
    getMessage: async (_key) => {
      return {
        conversation: "YUHUSULU CRM active heartbeat"
      };
    },
    markOnlineOnConnect: true,
    syncFullHistory: false,
    // Prevents giant history sync drops and crashes
    retryRequestDelayMs: 1e3,
    generateHighQualityLinkPreview: true
  });
  sockets.set(accountId, sock);
  sock.ev.on("creds.update", async () => {
    try {
      await saveCreds();
      persistSessionToVault(accountId);
      if (state.creds?.me?.id || state.creds?.registered) {
        qrCodes.delete(accountId);
        console.log(`[Baileys Real] Pairing credentials established for ${accountId} (User: ${state.creds?.me?.id}). Cleared QR.`);
      }
      console.log(`[Baileys Real] Successfully persisted WhatsApp Multi-Device credentials & vault to disk for ${accountId}`);
    } catch (err) {
      console.error(`[Baileys Real] Failed to persist credentials for ${accountId}:`, err.message);
    }
  });
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log(`[Baileys Real] Real WhatsApp QR received for ${accountId}! Generating QR Code image...`);
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        qrCodes.set(accountId, qrDataUrl);
        connectionStatuses.set(accountId, "SCAN_REQUIRED");
      } catch (err) {
        console.error(`Failed to generate QR data URL:`, err);
      }
    }
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(`[Baileys Real] Connection closed for ${accountId}, statusCode: ${statusCode}, isLoggedOut: ${isLoggedOut}`);
      qrCodes.delete(accountId);
      sockets.delete(accountId);
      if (isLoggedOut) {
        const attempts = (reconnectAttempts.get(accountId) || 0) + 1;
        reconnectAttempts.set(accountId, attempts);
        if (attempts <= 5) {
          const delayTime = attempts * 3e3;
          console.log(`[Baileys Real] 401 challenge received for ${accountId}. Retrying connection attempt ${attempts}/5 in ${delayTime / 1e3}s...`);
          connectionStatuses.set(accountId, "CONNECTING");
          setTimeout(() => {
            initBaileysAccount(accountId, accountName).catch(console.error);
          }, delayTime);
          return;
        }
        console.log(`[Baileys Real] Account ${accountId} logged out by WhatsApp after 5 retries. Session preserved in vault.`);
        connectionStatuses.set(accountId, "DISCONNECTED");
        const accounts = loadJson(ACCOUNTS_FILE, []);
        const idx = accounts.findIndex((a) => a.id === accountId);
        if (idx !== -1) {
          accounts[idx].status = "DISCONNECTED";
          saveJson(ACCOUNTS_FILE, accounts);
        }
      } else {
        reconnectAttempts.delete(accountId);
        console.log(`[Baileys Real] Reconnecting socket for ${accountId} (code ${statusCode})...`);
        connectionStatuses.set(accountId, "CONNECTING");
        const reconnectDelay = statusCode === DisconnectReason.restartRequired ? 1e3 : 3e3;
        setTimeout(() => {
          initBaileysAccount(accountId, accountName).catch(console.error);
        }, reconnectDelay);
      }
    } else if (connection === "open") {
      reconnectAttempts.delete(accountId);
      persistSessionToVault(accountId);
      console.log(`[Baileys Real] CONNECTED SUCCESSFULLY! Account ${accountId} is now linked!`);
      connectionStatuses.set(accountId, "CONNECTED");
      qrCodes.delete(accountId);
      const user = sock.user || sock.authState?.creds?.me;
      const rawPhone = user?.id ? user.id.split(":")[0].replace(/\D/g, "") : "";
      const formattedPhone = rawPhone ? `+${rawPhone}` : "";
      const userName = user?.name || accountName;
      const accounts = loadJson(ACCOUNTS_FILE, []);
      const idx = accounts.findIndex((a) => a.id === accountId);
      const now = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").substr(0, 19);
      if (idx !== -1) {
        accounts[idx].status = "CONNECTED";
        accounts[idx].phoneNumber = formattedPhone || accounts[idx].phoneNumber;
        accounts[idx].name = userName || accounts[idx].name;
        accounts[idx].lastConnectedAt = now;
      } else {
        accounts.push({
          id: accountId,
          name: userName,
          phoneNumber: formattedPhone,
          status: "CONNECTED",
          sessionPath: `./sessions/session_${accountId}`,
          battery: 100,
          dailySentCount: 0,
          dailyLimit: 300,
          warmupEnabled: true,
          totalDelivered: 0,
          lastConnectedAt: now
        });
      }
      saveJson(ACCOUNTS_FILE, accounts);
      console.log(`[Baileys Real] Account ${accountId} saved to database with status CONNECTED and phone ${formattedPhone}`);
    }
  });
  sock.ev.on("messages.upsert", async (m) => {
    if (m.type === "notify") {
      for (const msg of m.messages) {
        if (!msg.key.fromMe && msg.message) {
          const from = msg.key.remoteJid;
          const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
          if (!body || !from || from.endsWith("@g.us")) continue;
          console.log(`[Baileys Incoming] Received real message on ${accountId} from ${from}: "${body}"`);
          const rules = loadJson(RULES_FILE, []);
          const lowerBody = body.toLowerCase().trim();
          const matchedRule = rules.find((rule) => {
            if (!rule.isEnabled) return false;
            const kw = (rule.keyword || "").toLowerCase().trim();
            if (rule.matchType === "exact") return lowerBody === kw;
            if (rule.matchType === "contains") return lowerBody.includes(kw);
            if (rule.matchType === "regex") {
              try {
                return new RegExp(rule.keyword, "i").test(body);
              } catch {
                return false;
              }
            }
            return false;
          });
          if (matchedRule) {
            console.log(`[Auto-Responder] Rule matched: "${matchedRule.name}". Replying to ${from}...`);
            await sock.sendPresenceUpdate("composing", from);
            await delay((matchedRule.typingDelaySeconds || 3) * 1e3);
            await sock.sendPresenceUpdate("paused", from);
            await sock.sendMessage(from, { text: matchedRule.replyMessage });
          }
        }
      }
    }
  });
  return sock;
}
function getCurrentTimezoneInfo(tz = "Asia/Colombo") {
  try {
    const now = /* @__PURE__ */ new Date();
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      second: "2-digit"
    });
    const parts = formatter.formatToParts(now);
    const getPart = (type) => parts.find((p) => p.type === type)?.value || "00";
    const hour = getPart("hour").padStart(2, "0");
    const minute = getPart("minute").padStart(2, "0");
    const second = getPart("second").padStart(2, "0");
    const day = getPart("day").padStart(2, "0");
    const month = getPart("month").padStart(2, "0");
    const year = getPart("year");
    const currentHHMM = `${hour}:${minute}`;
    const timeStr = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    const dayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    const dayStr = dayFormatter.format(now);
    const daysMap = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6
    };
    const currentDay = daysMap[dayStr] !== void 0 ? daysMap[dayStr] : now.getDay();
    return { currentDay, currentHHMM, timeStr, formatted: timeStr };
  } catch {
    const now = /* @__PURE__ */ new Date();
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    const fallbackStr = now.toISOString().replace("T", " ").substring(0, 19);
    return {
      currentDay: now.getDay(),
      currentHHMM: `${h}:${m}`,
      timeStr: fallbackStr,
      formatted: fallbackStr
    };
  }
}
const activeCampaignControllers = /* @__PURE__ */ new Map();
function calculateWindowMinutes(startTime = "06:00", endTime = "18:00") {
  try {
    const [sH, sM] = startTime.split(":").map(Number);
    const [eH, eM] = endTime.split(":").map(Number);
    const startM = (sH || 0) * 60 + (sM || 0);
    const endM = (eH || 0) * 60 + (eM || 0);
    if (endM > startM) return endM - startM;
    return 24 * 60 - startM + endM;
  } catch {
    return 720;
  }
}
function isTimeWithinWindow(startTime = "06:00", endTime = "18:00", tz = "Asia/Colombo") {
  const { currentHHMM } = getCurrentTimezoneInfo(tz);
  let within = false;
  if (startTime < endTime) {
    within = currentHHMM >= startTime && currentHHMM < endTime;
  } else if (startTime > endTime) {
    within = currentHHMM >= startTime || currentHHMM < endTime;
  } else {
    within = true;
  }
  return { within, currentHHMM };
}
function isAnyCampaignActive() {
  const campaigns = loadJson(CAMPAIGNS_FILE, []);
  for (const c of campaigns) {
    if (c.status === "running") {
      const ctrl = activeCampaignControllers.get(c.id);
      if (ctrl && !ctrl.isPaused && !ctrl.isStopped && !c.stats?.isWindowSleeping) {
        return { active: true, campaignName: c.name, campaignId: c.id };
      }
    }
  }
  return { active: false };
}
async function executeRealCampaign(campaignId) {
  const campaigns = loadJson(CAMPAIGNS_FILE, []);
  const campaign = campaigns.find((c) => c.id === campaignId);
  if (!campaign) return;
  const accounts = loadJson(ACCOUNTS_FILE, []);
  let connectedAccounts = accounts.filter((a) => campaign.senderAccountIds?.includes(a.id) && connectionStatuses.get(a.id) === "CONNECTED");
  if (connectedAccounts.length === 0) {
    connectedAccounts = accounts.filter((a) => connectionStatuses.get(a.id) === "CONNECTED" || sockets.has(a.id));
  }
  if (connectedAccounts.length === 0) {
    console.error(`[Campaign Error] No real connected WhatsApp accounts found for campaign ${campaignId}`);
    campaign.status = "failed";
    saveJson(CAMPAIGNS_FILE, campaigns);
    return;
  }
  campaign.status = "running";
  saveJson(CAMPAIGNS_FILE, campaigns);
  const state = {
    isPaused: false,
    isStopped: false,
    currentContactIndex: campaign.stats?.sent || 0,
    batchCounter: campaign.stats?.currentBatchCount || 0,
    senderPointer: campaign.stats?.currentSenderIndex || 0
  };
  activeCampaignControllers.set(campaignId, state);
  console.log(`[Campaign Started] "${campaign.name}" with ${campaign.contacts.length} recipients`);
  const contacts = campaign.contacts;
  const templates = campaign.templates;
  for (let i = state.currentContactIndex; i < contacts.length; i++) {
    const ctrl = activeCampaignControllers.get(campaignId);
    if (!ctrl || ctrl.isStopped) {
      campaign.status = "cancelled";
      saveJson(CAMPAIGNS_FILE, campaigns);
      break;
    }
    while (ctrl.isPaused) {
      await delay(1500);
    }
    if (campaign.deliveryWindow?.enabled) {
      const { within, currentHHMM } = isTimeWithinWindow(
        campaign.deliveryWindow.startTime,
        campaign.deliveryWindow.endTime,
        campaign.deliveryWindow.timezone || "Asia/Colombo"
      );
      if (!within) {
        console.log(`[Campaign Window Sleep] "${campaign.name}" paused at ${currentHHMM} because outside delivery window (${campaign.deliveryWindow.startTime} - ${campaign.deliveryWindow.endTime}). Sleeping until window opens...`);
        campaign.stats = {
          ...campaign.stats,
          isWindowSleeping: true,
          windowSleepResumeAt: `${campaign.deliveryWindow.startTime} (${campaign.deliveryWindow.timezone || "Asia/Colombo"})`
        };
        saveJson(CAMPAIGNS_FILE, campaigns);
        while (true) {
          const liveCtrl = activeCampaignControllers.get(campaignId);
          if (!liveCtrl || liveCtrl.isStopped) break;
          await delay(1e4);
          const check = isTimeWithinWindow(
            campaign.deliveryWindow.startTime,
            campaign.deliveryWindow.endTime,
            campaign.deliveryWindow.timezone || "Asia/Colombo"
          );
          if (check.within) {
            console.log(`[Campaign Window Resume] "${campaign.name}" resumed at ${check.currentHHMM}! Window is now active.`);
            campaign.stats = {
              ...campaign.stats,
              isWindowSleeping: false,
              windowSleepResumeAt: void 0
            };
            saveJson(CAMPAIGNS_FILE, campaigns);
            break;
          }
        }
      }
    }
    const contact = contacts[i];
    const stopCheck = isStopNumber(contact.phoneNumber);
    if (stopCheck.isStopped || contact.status === "stopped") {
      console.log(`[Campaign Stop Guard] Skipping ${contact.phoneNumber}: In Stop Numbers list (${stopCheck.reason || "Opt-Out"}).`);
      contact.status = "stopped";
      const now2 = /* @__PURE__ */ new Date();
      const timeStr2 = `${now2.toISOString().split("T")[0]} ${now2.toTimeString().split(" ")[0]}`;
      const logs = loadJson(LOGS_FILE, []);
      logs.unshift({
        id: `log_${Date.now()}_${i}`,
        campaignId: campaign.id,
        campaignName: campaign.name,
        timestamp: timeStr2,
        recipientPhone: contact.phoneNumber,
        recipientName: contact.name,
        senderPhone: "BLOCKED",
        senderName: "Stop List (Opt-Out Protection)",
        templateId: "BLOCKED",
        resolvedMessage: `[BLOCKED - NO MESSAGE SENT] Recipient is in Stop Numbers list (${stopCheck.reason || "Opt-Out"})`,
        delayAppliedSeconds: 0,
        hasWhatsApp: true,
        status: "STOPPED",
        postAttachment: "",
        errorMessage: `Skipped: Number is in Stop Numbers list (${stopCheck.reason || "Opt-Out"})`
      });
      saveJson(LOGS_FILE, logs);
      state.currentContactIndex = i + 1;
      campaign.stats = {
        ...campaign.stats,
        total: contacts.length,
        sent: campaign.stats?.delivered || 0,
        // Never count blocked stop numbers as sent!
        stoppedCount: (campaign.stats?.stoppedCount || 0) + 1
      };
      saveJson(CAMPAIGNS_FILE, campaigns);
      continue;
    }
    let sender = connectedAccounts[0];
    if (campaign.rotationStrategy === "random") {
      const eligibleSenders = connectedAccounts.filter((a) => (a.dailySentCount || 0) < (a.dailyLimit || 300));
      const pool = eligibleSenders.length > 0 ? eligibleSenders : connectedAccounts;
      sender = pool[Math.floor(Math.random() * pool.length)];
    } else {
      sender = connectedAccounts[ctrl.senderPointer % connectedAccounts.length];
      ctrl.senderPointer++;
    }
    const sock = sockets.get(sender.id);
    if (!sock) {
      console.error(`Socket for sender ${sender.id} not available.`);
      continue;
    }
    const template = templates[Math.floor(Math.random() * templates.length)];
    let messageText = resolveSpintax(template.content);
    messageText = replaceVariables(messageText, {
      name: contact.name || "Friend",
      company: contact.company || "your team",
      phone: contact.phoneNumber,
      custom1: contact.customVar1,
      custom2: contact.customVar2
    });
    const cleanDigits = normalizeWhatsAppNumber(contact.phoneNumber);
    const targetJid = formatToJid(contact.phoneNumber);
    let verifiedJid = targetJid;
    const typingSeconds = campaign.timings.typingDelaySeconds || 3;
    const postAttachment = template.fileName || "";
    let isRegisteredOnWhatsApp = true;
    try {
      if (sock.onWhatsApp && cleanDigits.length >= 7) {
        const presenceQuery = sock.onWhatsApp(cleanDigits);
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 4e3));
        const checkResults = await Promise.race([presenceQuery, timeoutPromise]);
        if (Array.isArray(checkResults) && checkResults.length > 0) {
          isRegisteredOnWhatsApp = Boolean(checkResults[0]?.exists);
          if (checkResults[0]?.jid) verifiedJid = checkResults[0].jid;
        }
      }
    } catch (checkErr) {
      console.log(`[Presence Check Note] Could not query presence for ${cleanDigits}:`, checkErr.message);
    }
    const now = /* @__PURE__ */ new Date();
    const timeStr = `${now.toISOString().split("T")[0]} ${now.toTimeString().split(" ")[0]}`;
    if (!isRegisteredOnWhatsApp) {
      console.log(`[WhatsApp Verification] ${contact.phoneNumber} is NOT registered on WhatsApp. Flagging as NO_WHATSAPP.`);
      contact.status = "no_whatsapp";
      contact.hasWhatsApp = false;
      const logs = loadJson(LOGS_FILE, []);
      logs.unshift({
        id: `log_${Date.now()}_${i}`,
        campaignId: campaign.id,
        campaignName: campaign.name,
        timestamp: timeStr,
        recipientPhone: contact.phoneNumber,
        recipientName: contact.name,
        senderPhone: sender.phoneNumber,
        senderName: sender.name,
        templateId: template.id,
        resolvedMessage: messageText,
        delayAppliedSeconds: 0,
        hasWhatsApp: false,
        status: "NO_WHATSAPP",
        postAttachment,
        errorMessage: "Number does not have an active WhatsApp account"
      });
      saveJson(LOGS_FILE, logs);
      ctrl.batchCounter++;
      state.currentContactIndex = i + 1;
      campaign.stats = {
        total: contacts.length,
        sent: i + 1,
        delivered: campaign.stats?.delivered || 0,
        failed: campaign.stats?.failed || 0,
        noWhatsAppCount: (campaign.stats?.noWhatsAppCount || 0) + 1,
        currentSenderIndex: ctrl.senderPointer,
        currentBatchCount: ctrl.batchCounter,
        lastSenderId: sender.id,
        lastTemplateId: template.id
      };
      saveJson(CAMPAIGNS_FILE, campaigns);
      await delay(1200);
      continue;
    }
    try {
      console.log(`[Baileys Send] Verified on WhatsApp! Sending real message to ${verifiedJid} via ${sender.name} (${sender.phoneNumber})...`);
      await sock.sendPresenceUpdate("composing", verifiedJid);
      await delay(typingSeconds * 1e3);
      await sock.sendPresenceUpdate("paused", verifiedJid);
      const messagePayload = prepareMediaPayload(template, messageText);
      await sock.sendMessage(verifiedJid, messagePayload);
      contact.status = "sent";
      contact.hasWhatsApp = true;
      const logs = loadJson(LOGS_FILE, []);
      logs.unshift({
        id: `log_${Date.now()}_${i}`,
        campaignId: campaign.id,
        campaignName: campaign.name,
        timestamp: timeStr,
        recipientPhone: contact.phoneNumber,
        recipientName: contact.name,
        senderPhone: sender.phoneNumber,
        senderName: sender.name,
        templateId: template.id,
        resolvedMessage: messageText,
        delayAppliedSeconds: 0,
        hasWhatsApp: true,
        status: "DELIVERED",
        postAttachment,
        errorMessage: ""
      });
      saveJson(LOGS_FILE, logs);
      sender.dailySentCount = (sender.dailySentCount || 0) + 1;
      sender.totalDelivered = (sender.totalDelivered || 0) + 1;
      saveJson(ACCOUNTS_FILE, accounts);
      ctrl.batchCounter++;
      state.currentContactIndex = i + 1;
      campaign.stats = {
        total: contacts.length,
        sent: i + 1,
        delivered: (campaign.stats?.delivered || 0) + 1,
        failed: campaign.stats?.failed || 0,
        noWhatsAppCount: campaign.stats?.noWhatsAppCount || 0,
        currentSenderIndex: ctrl.senderPointer,
        currentBatchCount: ctrl.batchCounter,
        lastSenderId: sender.id,
        lastTemplateId: template.id
      };
      saveJson(CAMPAIGNS_FILE, campaigns);
    } catch (sendErr) {
      console.error(`[Send Error] Failed to send to ${contact.phoneNumber}:`, sendErr.message);
      contact.status = "failed";
      const logs = loadJson(LOGS_FILE, []);
      logs.unshift({
        id: `log_${Date.now()}_${i}`,
        campaignId: campaign.id,
        campaignName: campaign.name,
        timestamp: timeStr,
        recipientPhone: contact.phoneNumber,
        recipientName: contact.name,
        senderPhone: sender.phoneNumber,
        senderName: sender.name,
        templateId: template.id,
        resolvedMessage: messageText,
        delayAppliedSeconds: 0,
        hasWhatsApp: true,
        status: "FAILED",
        postAttachment,
        errorMessage: sendErr.message || "Dispatch failure"
      });
      saveJson(LOGS_FILE, logs);
    }
    if (ctrl.batchCounter >= campaign.timings.batchSize && i < contacts.length - 1) {
      console.log(`[Batch Cooldown] Reached ${campaign.timings.batchSize} messages. Cooling down for ${campaign.timings.breakDurationSeconds}s...`);
      ctrl.batchCounter = 0;
      await delay(campaign.timings.breakDurationSeconds * 1e3);
    } else if (i < contacts.length - 1) {
      let waitSec = getRandomInt(campaign.timings.minDelaySeconds, campaign.timings.maxDelaySeconds);
      if (campaign.deliveryWindow?.enabled && campaign.deliveryWindow.smartPacingEnabled) {
        const windowMinutes = calculateWindowMinutes(campaign.deliveryWindow.startTime, campaign.deliveryWindow.endTime);
        const totalWindowSec = windowMinutes * 60;
        const totalContacts = Math.max(1, contacts.length);
        const idealPaceSec = Math.max(15, Math.floor(totalWindowSec / totalContacts));
        const jitterMin = Math.max(15, Math.floor(idealPaceSec * 0.7));
        const jitterMax = Math.max(jitterMin + 5, Math.ceil(idealPaceSec * 1.35));
        waitSec = getRandomInt(jitterMin, jitterMax);
        campaign.stats = {
          ...campaign.stats,
          currentPaceSeconds: waitSec
        };
      }
      console.log(`[Anti-Ban Dynamic Delay] Sleeping ${waitSec}s before next contact...`);
      await delay(waitSec * 1e3);
    }
  }
  campaign.status = "completed";
  saveJson(CAMPAIGNS_FILE, campaigns);
  activeCampaignControllers.delete(campaignId);
  console.log(`[Campaign Completed] "${campaign.name}" finished all dispatches.`);
}
app.get("/api/accounts", (req, res) => {
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const vault = loadJson(SESSIONS_VAULT_FILE, {});
  const enriched = accounts.map((acc) => {
    const sessionDir = path.join(SESSIONS_DIR, `session_${acc.id}`);
    const credsExist = fs.existsSync(path.join(sessionDir, "creds.json"));
    const vaultExist = Boolean(vault[acc.id] && vault[acc.id]["creds.json"]);
    const hasKeys = credsExist || vaultExist;
    const sock = sockets.get(acc.id);
    const liveStatus = connectionStatuses.get(acc.id);
    const isSocketOpen = isBaileysSocketOpen(sock);
    const userJid = sock?.user?.id || sock?.authState?.creds?.me?.id;
    const hasUserJid = Boolean(userJid);
    const isGenuinelyConnected = isAccountGenuinelyConnected(acc.id);
    let status = "DISCONNECTED";
    if (isGenuinelyConnected) {
      status = "CONNECTED";
    } else if (liveStatus === "CONNECTING") {
      status = "CONNECTING";
    } else if (liveStatus === "SCAN_REQUIRED" || qrCodes.has(acc.id)) {
      status = "SCAN_REQUIRED";
    } else if (hasKeys) {
      status = "DISCONNECTED";
    } else {
      status = "SCAN_REQUIRED";
    }
    const livePhone = hasUserJid ? `+${userJid.split(":")[0].replace(/\D/g, "")}` : acc.phoneNumber;
    const liveName = sock?.user?.name || acc.name;
    return {
      ...acc,
      name: liveName,
      phoneNumber: livePhone,
      status,
      isRealSocketAlive: isSocketOpen,
      userJid: userJid || null,
      sessionSavedOnDisk: credsExist,
      vaultSaved: hasKeys
    };
  });
  res.json(enriched);
});
app.post("/api/accounts/create", async (req, res) => {
  const { name = "WhatsApp Node", phoneNumber = "" } = req.body;
  const id = `acc_${Date.now().toString(36)}`;
  const DELETED_ACCOUNTS_FILE = path.join(DATA_DIR, "deleted_accounts.json");
  const deletedIds = loadJson(DELETED_ACCOUNTS_FILE, []);
  if (deletedIds.includes(id)) {
    saveJson(DELETED_ACCOUNTS_FILE, deletedIds.filter((d) => d !== id));
  }
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const newAccount = {
    id,
    name,
    phoneNumber,
    status: "SCAN_REQUIRED",
    sessionPath: `./sessions/session_${id}`,
    battery: 100,
    dailySentCount: 0,
    dailyLimit: 300,
    warmupEnabled: true,
    totalDelivered: 0,
    lastConnectedAt: ""
  };
  accounts.push(newAccount);
  saveJson(ACCOUNTS_FILE, accounts);
  initBaileysAccount(id, name, true).catch((err) => {
    console.error(`Error initializing Baileys for ${id}:`, err);
  });
  res.json({ success: true, account: newAccount });
});
app.get("/api/accounts/qr/:id", (req, res) => {
  const { id } = req.params;
  const qr = qrCodes.get(id) || null;
  const sock = sockets.get(id);
  const liveStatus = connectionStatuses.get(id);
  const isSocketOpen = isBaileysSocketOpen(sock);
  const userJid = sock?.user?.id || sock?.authState?.creds?.me?.id;
  const hasUserJid = Boolean(userJid);
  const isGenuinelyConnected = isAccountGenuinelyConnected(id);
  let status = "DISCONNECTED";
  if (isGenuinelyConnected) {
    status = "CONNECTED";
  } else if (liveStatus === "CONNECTING") {
    status = "CONNECTING";
  } else if (liveStatus === "SCAN_REQUIRED" || qr) {
    status = "SCAN_REQUIRED";
  } else {
    status = "DISCONNECTED";
  }
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const acc = accounts.find((a) => a.id === id);
  const livePhone = hasUserJid ? `+${userJid.split(":")[0].replace(/\D/g, "")}` : acc?.phoneNumber;
  res.json({
    qr,
    status,
    isSocketOpen,
    userJid: userJid || null,
    error: connectionErrors.get(id) || null,
    account: acc ? {
      ...acc,
      status,
      phoneNumber: livePhone || acc.phoneNumber
    } : null
  });
});
app.post("/api/accounts/reconnect/:id", async (req, res) => {
  const { id } = req.params;
  const forceNewQr = req.query.forceNewQr === "true" || req.body?.forceNewQr === true;
  const resetSession = req.query.reset === "true" || req.body?.reset === true;
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return res.status(404).json({ error: "Account not found" });
  console.log(`[Baileys Reconnect] Resuming session for account ${id} (${acc.name}). ForceNewQr: ${forceNewQr}, Reset: ${resetSession}`);
  await initBaileysAccount(id, acc.name, forceNewQr, resetSession);
  res.json({ success: true, status: "CONNECTING" });
});
app.post("/api/accounts/reset/:id", async (req, res) => {
  const { id } = req.params;
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return res.status(404).json({ error: "Account not found" });
  console.log(`[Baileys Reset] User explicitly requested to reset & unlink session for ${id} (${acc.name})`);
  await initBaileysAccount(id, acc.name, true, true);
  res.json({ success: true, status: "SCAN_REQUIRED", message: "Session reset. Ready for new QR scan." });
});
app.get("/api/accounts/vault/:id", (req, res) => {
  const { id } = req.params;
  let keys = exportSessionKeys(id);
  if (!keys) {
    const vault = loadJson(SESSIONS_VAULT_FILE, {});
    keys = vault[id] || null;
  }
  if (!keys) {
    return res.status(404).json({ error: "No saved session keys found for this account" });
  }
  res.json({ success: true, accountId: id, keys, keyCount: Object.keys(keys).length });
});
app.post("/api/accounts/vault/:id", async (req, res) => {
  const { id } = req.params;
  const { keys } = req.body;
  if (!keys || !keys["creds.json"]) {
    return res.status(400).json({ error: "Invalid session keys bundle. Missing creds.json" });
  }
  const success = importSessionKeys(id, keys);
  if (!success) {
    return res.status(500).json({ error: "Failed to write session keys to disk" });
  }
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const acc = accounts.find((a) => a.id === id);
  const accountName = acc?.name || "WhatsApp Node";
  initBaileysAccount(id, accountName).catch((err) => {
    console.error(`Error connecting restored session ${id}:`, err);
  });
  res.json({ success: true, status: "CONNECTING", message: "Session keys restored from vault successfully" });
});
app.get("/api/accounts/export-backup/:id", (req, res) => {
  const { id } = req.params;
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const acc = accounts.find((a) => a.id === id);
  let keys = exportSessionKeys(id);
  if (!keys) {
    const vault = loadJson(SESSIONS_VAULT_FILE, {});
    keys = vault[id] || null;
  }
  if (!keys) {
    return res.status(404).json({ error: "No session keys available to export for this account" });
  }
  const payload = {
    app: "YUHUSULU CRM",
    version: "1.0",
    accountId: id,
    accountName: acc?.name || "WhatsApp Account",
    phoneNumber: acc?.phoneNumber || "",
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    keys
  };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="yuhusulu_session_${acc?.phoneNumber ? acc.phoneNumber.replace(/\D/g, "") : id}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});
app.post("/api/accounts/import-backup", async (req, res) => {
  try {
    const { accountId, accountName, phoneNumber, keys } = req.body;
    if (!keys || !keys["creds.json"]) {
      return res.status(400).json({ error: "Invalid backup file. Missing WhatsApp credentials." });
    }
    const targetId = accountId || `acc_${Date.now().toString(36)}`;
    const targetName = accountName || "Imported WhatsApp Node";
    importSessionKeys(targetId, keys);
    const accounts = loadJson(ACCOUNTS_FILE, []);
    let idx = accounts.findIndex((a) => a.id === targetId);
    const now = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").substr(0, 19);
    if (idx === -1) {
      accounts.unshift({
        id: targetId,
        name: targetName,
        phoneNumber: phoneNumber || "",
        status: "CONNECTING",
        sessionPath: `./sessions/session_${targetId}`,
        battery: 100,
        dailySentCount: 0,
        dailyLimit: 300,
        warmupEnabled: true,
        totalDelivered: 0,
        lastConnectedAt: now
      });
    } else {
      accounts[idx].status = "CONNECTING";
    }
    saveJson(ACCOUNTS_FILE, accounts);
    initBaileysAccount(targetId, targetName).catch((err) => {
      console.error(`Error connecting imported session ${targetId}:`, err);
    });
    res.json({ success: true, accountId: targetId, status: "CONNECTING" });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to import session backup" });
  }
});
app.get("/api/accounts/export-all-backup", (req, res) => {
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const vault = loadJson(SESSIONS_VAULT_FILE, {});
  const accountsBundle = accounts.map((acc) => {
    let keys = exportSessionKeys(acc.id) || vault[acc.id] || null;
    return {
      id: acc.id,
      name: acc.name,
      phoneNumber: acc.phoneNumber,
      dailyLimit: acc.dailyLimit,
      warmupEnabled: acc.warmupEnabled,
      hasKeys: Boolean(keys && keys["creds.json"]),
      keys
    };
  });
  const payload = {
    app: "YUHUSULU CRM MASTER VAULT",
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    accountCount: accounts.length,
    accounts: accountsBundle
  };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="yuhusulu_all_accounts_master_backup.json"');
  res.send(JSON.stringify(payload, null, 2));
});
app.get("/api/system/download-hostinger-zip", (_req, res) => {
  const zipPath = path.resolve("./public/downloads/yuhusulu_whatsapp_crm_hostinger.zip");
  if (!fs.existsSync(zipPath)) {
    try {
      execSync("python3 scripts/package_hostinger.py", { stdio: "inherit" });
    } catch (err) {
      console.error("[Hostinger Packager Error]:", err);
    }
  }
  if (fs.existsSync(zipPath)) {
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="yuhusulu_whatsapp_crm_hostinger.zip"');
    return res.sendFile(zipPath);
  }
  return res.status(500).json({ error: "Could not find or generate Hostinger package" });
});
app.get("/api/system/download-cloud-zip", (_req, res) => {
  const zipPath = path.resolve("./public/downloads/yuhusulu_whatsapp_crm_cloud.zip");
  if (!fs.existsSync(zipPath)) {
    try {
      execSync("python3 scripts/package_hostinger.py", { stdio: "inherit" });
    } catch (err) {
      console.error("[Cloud Packager Error]:", err);
    }
  }
  if (fs.existsSync(zipPath)) {
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="yuhusulu_whatsapp_crm_cloud.zip"');
    return res.sendFile(zipPath);
  }
  return res.status(500).json({ error: "Could not find or generate Cloud package" });
});
app.post("/api/accounts/import-all-backup", async (req, res) => {
  try {
    const { accounts: importedAccounts, isAutoRecovery = false, forceManualImport = false } = req.body;
    if (!Array.isArray(importedAccounts) || importedAccounts.length === 0) {
      return res.status(400).json({ error: "Invalid master backup file. No accounts found." });
    }
    const DELETED_ACCOUNTS_FILE = path.join(DATA_DIR, "deleted_accounts.json");
    let deletedIds = loadJson(DELETED_ACCOUNTS_FILE, []);
    if (forceManualImport) {
      deletedIds = deletedIds.filter((dId) => !importedAccounts.some((a) => a.id === dId));
      saveJson(DELETED_ACCOUNTS_FILE, deletedIds);
    }
    const accountsToProcess = isAutoRecovery ? importedAccounts.filter((a) => !deletedIds.includes(a.id)) : importedAccounts;
    const currentAccounts = loadJson(ACCOUNTS_FILE, []);
    let restoredCount = 0;
    for (const item of accountsToProcess) {
      if (item.id && item.keys && item.keys["creds.json"]) {
        importSessionKeys(item.id, item.keys);
        restoredCount++;
        const idx = currentAccounts.findIndex((a) => a.id === item.id);
        const now = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").substr(0, 19);
        if (idx === -1) {
          currentAccounts.push({
            id: item.id,
            name: item.name || "Restored WhatsApp Account",
            phoneNumber: item.phoneNumber || "",
            status: "CONNECTING",
            sessionPath: `./sessions/session_${item.id}`,
            battery: 100,
            dailySentCount: 0,
            dailyLimit: item.dailyLimit || 300,
            warmupEnabled: item.warmupEnabled ?? true,
            totalDelivered: 0,
            lastConnectedAt: now
          });
        } else {
          currentAccounts[idx].status = "CONNECTING";
          if (item.phoneNumber) currentAccounts[idx].phoneNumber = item.phoneNumber;
        }
        initBaileysAccount(item.id, item.name || "WhatsApp Node").catch((err) => {
          console.error(`Error reconnecting restored account ${item.id}:`, err);
        });
      }
    }
    saveJson(ACCOUNTS_FILE, currentAccounts);
    res.json({
      success: true,
      restoredCount,
      message: `Successfully restored ${restoredCount} WhatsApp accounts and resumed connections without QR scan!`
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to import master backup" });
  }
});
app.delete("/api/accounts/:id", (req, res) => {
  const { id } = req.params;
  const sock = sockets.get(id);
  if (sock) {
    try {
      sock.end(void 0);
    } catch (e) {
    }
    sockets.delete(id);
  }
  qrCodes.delete(id);
  connectionStatuses.delete(id);
  reconnectAttempts.delete(id);
  const sessionDir = path.join(SESSIONS_DIR, `session_${id}`);
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  } catch (e) {
  }
  const backupDir = path.join(DATA_DIR, "session_backups", id);
  try {
    fs.rmSync(backupDir, { recursive: true, force: true });
  } catch (e) {
  }
  const vault = loadJson(SESSIONS_VAULT_FILE, {});
  delete vault[id];
  saveJson(SESSIONS_VAULT_FILE, vault);
  const DELETED_ACCOUNTS_FILE = path.join(DATA_DIR, "deleted_accounts.json");
  const deletedIds = loadJson(DELETED_ACCOUNTS_FILE, []);
  if (!deletedIds.includes(id)) {
    deletedIds.push(id);
    saveJson(DELETED_ACCOUNTS_FILE, deletedIds);
  }
  let accounts = loadJson(ACCOUNTS_FILE, []);
  accounts = accounts.filter((a) => a.id !== id);
  saveJson(ACCOUNTS_FILE, accounts);
  console.log(`[Account Delete] Account ${id} permanently deleted. Removed from memory, disk, vault, and backups.`);
  res.json({ success: true, deletedId: id });
});
app.get("/api/stop-numbers", (_req, res) => {
  const list = loadJson(STOP_NUMBERS_FILE, []);
  res.json({ success: true, stopNumbers: list });
});
app.post("/api/stop-numbers", (req, res) => {
  const { numbers, phone, reason = "Opt-Out (STOP requested)" } = req.body;
  let list = loadJson(STOP_NUMBERS_FILE, []);
  const rawList = [];
  if (Array.isArray(numbers)) {
    rawList.push(...numbers);
  } else if (typeof numbers === "string") {
    const tokens = numbers.split(/[\r\n,;\s]+/).map((t) => t.trim()).filter(Boolean);
    rawList.push(...tokens);
  } else if (phone) {
    rawList.push(phone);
  }
  let addedCount = 0;
  for (const raw of rawList) {
    const norm = normalizeWhatsAppNumber(raw);
    if (!norm) continue;
    if (!list.some((item) => item.normalizedPhone === norm)) {
      list.push({
        id: `stop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        phoneNumber: raw,
        normalizedPhone: norm,
        reason,
        addedAt: (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").substring(0, 16)
      });
      addedCount++;
    }
  }
  saveJson(STOP_NUMBERS_FILE, list);
  console.log(`[Stop Numbers] Added ${addedCount} numbers. Total active stop numbers: ${list.length}`);
  res.json({ success: true, addedCount, total: list.length, stopNumbers: list });
});
app.delete("/api/stop-numbers/:id", (req, res) => {
  const { id } = req.params;
  let list = loadJson(STOP_NUMBERS_FILE, []);
  list = list.filter((item) => item.id !== id && item.normalizedPhone !== id && item.phoneNumber !== id);
  saveJson(STOP_NUMBERS_FILE, list);
  res.json({ success: true, total: list.length, stopNumbers: list });
});
app.post("/api/stop-numbers/clear", (_req, res) => {
  saveJson(STOP_NUMBERS_FILE, []);
  console.log("[Stop Numbers] Cleared all stop numbers.");
  res.json({ success: true, stopNumbers: [] });
});
app.post("/api/upload/chunk", (req, res) => {
  chunkUpload.single("chunk")(req, res, (err) => {
    if (err) {
      console.error("[Chunk Upload Error]:", err);
      return res.status(400).json({ error: err.message || "Chunk upload failed" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No chunk file received" });
    }
    res.json({ success: true, chunkIndex: req.body.chunkIndex });
  });
});
app.post("/api/upload/complete", async (req, res) => {
  try {
    const { uploadId, fileName, totalChunks, originalSize, mimeType } = req.body;
    if (!uploadId || !fileName || !totalChunks) {
      return res.status(400).json({ error: "Missing upload assembly parameters" });
    }
    const ext = path.extname(fileName).toLowerCase();
    const finalFilename = `media_${Date.now()}_${Math.random().toString(36).substring(2, 6)}${ext}`;
    const finalPath = path.join(UPLOADS_DIR, finalFilename);
    const writeStream = fs.createWriteStream(finalPath);
    for (let i = 0; i < Number(totalChunks); i++) {
      const chunkPath = path.join(TEMP_UPLOADS_DIR, `chunk_${uploadId}_${i}`);
      if (!fs.existsSync(chunkPath)) {
        return res.status(400).json({ error: `Missing chunk ${i} during assembly` });
      }
      const data = fs.readFileSync(chunkPath);
      writeStream.write(data);
      try {
        fs.unlinkSync(chunkPath);
      } catch (e) {
      }
    }
    writeStream.end();
    await new Promise((resolve, reject) => {
      writeStream.on("finish", () => resolve(null));
      writeStream.on("error", reject);
    });
    const isVideo = mimeType && mimeType.startsWith("video/") || [".mp4", ".mov", ".mkv", ".3gp", ".avi", ".webm"].includes(ext);
    const isImage = mimeType && mimeType.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext);
    const mediaType = isVideo ? "video" : isImage ? "image" : "document";
    let finalFilePath = finalPath;
    let finalFileUrl = `/uploads/${finalFilename}`;
    let finalSize = fs.statSync(finalPath).size;
    let wasCompressed = false;
    if (isVideo) {
      console.log(`[Chunked Upload] Assembled video (${(finalSize / (1024 * 1024)).toFixed(2)} MB). Starting FFmpeg compression...`);
      const compResult = await compressVideoForWhatsApp(finalPath);
      finalFilePath = compResult.outputPath;
      finalFileUrl = compResult.outputUrl;
      finalSize = compResult.compressedSize;
      wasCompressed = true;
    }
    console.log(`[Chunk Assembly Success] Ready at ${finalFilePath} (${(finalSize / (1024 * 1024)).toFixed(2)} MB)`);
    res.json({
      success: true,
      filePath: finalFilePath,
      fileUrl: finalFileUrl,
      fileName,
      mimeType: isVideo ? "video/mp4" : mimeType || "application/octet-stream",
      mediaType,
      size: finalSize,
      originalSize: originalSize || fs.statSync(finalPath).size,
      compressed: wasCompressed
    });
  } catch (err) {
    console.error("[Chunk Assembly Error]:", err);
    res.status(500).json({ error: err.message || "Failed to assemble uploaded file" });
  }
});
app.post("/api/upload", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      console.error("[Direct Upload Error]:", err);
      return res.status(400).json({ error: err.message || "File upload error" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file received" });
    }
    const ext = path.extname(req.file.originalname).toLowerCase();
    const isVideo = req.file.mimetype.startsWith("video/") || [".mp4", ".mov", ".mkv", ".3gp", ".avi", ".webm"].includes(ext);
    const isImage = req.file.mimetype.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext);
    const mediaType = isVideo ? "video" : isImage ? "image" : "document";
    let finalFilePath = req.file.path;
    let finalFileUrl = `/uploads/${req.file.filename}`;
    let finalSize = req.file.size;
    let wasCompressed = false;
    if (isVideo) {
      console.log(`[Video Upload] Processing & compressing video: ${req.file.originalname} (${(req.file.size / (1024 * 1024)).toFixed(2)} MB)...`);
      const compResult = await compressVideoForWhatsApp(req.file.path);
      finalFilePath = compResult.outputPath;
      finalFileUrl = compResult.outputUrl;
      finalSize = compResult.compressedSize;
      wasCompressed = true;
    }
    console.log(`[Upload Success] ${mediaType.toUpperCase()} ready at ${finalFilePath} (${(finalSize / (1024 * 1024)).toFixed(2)} MB)`);
    res.json({
      success: true,
      filePath: finalFilePath,
      fileUrl: finalFileUrl,
      fileName: req.file.originalname,
      mimeType: isVideo ? "video/mp4" : req.file.mimetype,
      mediaType,
      size: finalSize,
      originalSize: req.file.size,
      compressed: wasCompressed
    });
  });
});
app.post("/api/messages/send-test", async (req, res) => {
  const { accountId, phone, message = "", mediaUrl, filePath, fileName } = req.body;
  if (!phone || !message && !mediaUrl && !filePath) {
    return res.status(400).json({ error: "Phone number and either message text or media are required" });
  }
  const stopCheck = isStopNumber(phone);
  if (stopCheck.isStopped) {
    return res.status(400).json({
      error: `Cannot send: Number ${phone} is listed in Stop Numbers (Opt-Out) list (${stopCheck.reason || "Opt-Out"})`
    });
  }
  let sock = accountId ? sockets.get(accountId) : null;
  if (!sock) {
    for (const [id, s] of sockets.entries()) {
      if (connectionStatuses.get(id) === "CONNECTED") {
        sock = s;
        break;
      }
    }
  }
  if (!sock) {
    return res.status(400).json({
      error: "No connected WhatsApp account available. Please link your phone via QR code first!"
    });
  }
  try {
    const targetJid = formatToJid(phone);
    console.log(`[Direct Test] Sending real WhatsApp message with media to ${targetJid}...`);
    await sock.sendPresenceUpdate("composing", targetJid);
    await delay(1500);
    await sock.sendPresenceUpdate("paused", targetJid);
    const payload = prepareMediaPayload({ mediaUrl, filePath, fileName }, message);
    const sent = await sock.sendMessage(targetJid, payload);
    res.json({ success: true, messageId: sent?.key?.id || "OK" });
  } catch (err) {
    console.error(`Direct test send failed:`, err);
    res.status(500).json({ error: err.message || "Failed to send WhatsApp message" });
  }
});
app.post("/api/messages/send-one", async (req, res) => {
  const {
    campaignId = "cmp_manual",
    campaignName = "Live Campaign",
    accountId,
    contact,
    template,
    typingDelaySeconds = 2
  } = req.body;
  if (!contact || !contact.phoneNumber) {
    return res.status(400).json({ error: "Contact phone number is required" });
  }
  const recipientPhone = contact.phoneNumber;
  const cleanDigits = normalizeWhatsAppNumber(recipientPhone);
  const targetJid = formatToJid(recipientPhone);
  let verifiedJid = targetJid;
  const now = /* @__PURE__ */ new Date();
  const timeStr = `${now.toISOString().split("T")[0]} ${now.toTimeString().split(" ")[0]}`;
  const stopCheck = isStopNumber(recipientPhone);
  if (stopCheck.isStopped || contact.status === "stopped") {
    const stopReason = stopCheck.reason || "Opt-Out (Stop List)";
    const newLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      campaignId,
      campaignName,
      timestamp: timeStr,
      recipientPhone,
      recipientName: contact.name || "",
      senderPhone: "BLOCKED",
      senderName: "Stop List (Opt-Out Protection)",
      templateId: "BLOCKED",
      resolvedMessage: `[BLOCKED - NO MESSAGE SENT] Recipient is in Stop Numbers list (${stopReason})`,
      delayAppliedSeconds: 0,
      hasWhatsApp: true,
      status: "STOPPED",
      postAttachment: "",
      errorMessage: `Skipped: Number is in Stop Numbers list (${stopReason})`
    };
    const logs = loadJson(LOGS_FILE, []);
    logs.unshift(newLog);
    saveJson(LOGS_FILE, logs);
    console.log(`[Stop Numbers Guard] Excluded ${recipientPhone} from campaign (Reason: ${stopReason})`);
    return res.json({
      success: false,
      status: "STOPPED",
      isStopped: true,
      log: newLog,
      error: `Skipped: Number is in Stop Numbers list (${stopReason})`
    });
  }
  let sock = accountId ? sockets.get(accountId) : null;
  let senderAcc = null;
  const accounts = loadJson(ACCOUNTS_FILE, []);
  if (sock && connectionStatuses.get(accountId) === "CONNECTED") {
    senderAcc = accounts.find((a) => a.id === accountId);
  }
  if (!sock) {
    for (const acc of accounts) {
      if (sockets.has(acc.id) && connectionStatuses.get(acc.id) === "CONNECTED") {
        sock = sockets.get(acc.id);
        senderAcc = acc;
        break;
      }
    }
  }
  if (!sock || !senderAcc || connectionStatuses.get(senderAcc.id) !== "CONNECTED") {
    return res.status(400).json({
      success: false,
      status: "FAILED",
      error: "No connected WhatsApp phone found. Please link your phone via QR code in Accounts tab first!"
    });
  }
  let isRegisteredOnWhatsApp = true;
  try {
    if (sock.onWhatsApp && cleanDigits.length >= 7) {
      const presenceQuery = sock.onWhatsApp(cleanDigits);
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 4e3));
      const checkResults = await Promise.race([presenceQuery, timeoutPromise]);
      if (Array.isArray(checkResults) && checkResults.length > 0) {
        isRegisteredOnWhatsApp = Boolean(checkResults[0]?.exists);
        if (checkResults[0]?.jid) verifiedJid = checkResults[0].jid;
      }
    }
  } catch (checkErr) {
    console.log(`[Presence Check Note] Error checking ${cleanDigits}:`, checkErr.message);
  }
  if (!isRegisteredOnWhatsApp) {
    const newLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      campaignId,
      campaignName,
      timestamp: timeStr,
      recipientPhone,
      recipientName: contact.name || "",
      senderPhone: senderAcc.phoneNumber,
      senderName: senderAcc.name,
      templateId: template?.id || "tpl_1",
      resolvedMessage: template?.content || "",
      delayAppliedSeconds: 0,
      hasWhatsApp: false,
      status: "NO_WHATSAPP",
      postAttachment: template?.fileName || "",
      errorMessage: "Number does not have an active WhatsApp account"
    };
    const logs = loadJson(LOGS_FILE, []);
    logs.unshift(newLog);
    saveJson(LOGS_FILE, logs);
    return res.json({
      success: false,
      status: "NO_WHATSAPP",
      hasWhatsApp: false,
      log: newLog,
      error: "Number does not have an active WhatsApp account"
    });
  }
  let messageText = resolveSpintax(template?.content || "");
  messageText = replaceVariables(messageText, {
    name: contact.name || "Friend",
    company: contact.company || "your team",
    phone: recipientPhone,
    custom1: contact.customVar1,
    custom2: contact.customVar2
  });
  try {
    if (typingDelaySeconds > 0) {
      await sock.sendPresenceUpdate("composing", verifiedJid);
      await delay(typingDelaySeconds * 1e3);
      await sock.sendPresenceUpdate("paused", verifiedJid);
    }
    const payload = prepareMediaPayload(template, messageText);
    const sent = await sock.sendMessage(verifiedJid, payload);
    const newLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      campaignId,
      campaignName,
      timestamp: timeStr,
      recipientPhone,
      recipientName: contact.name || "",
      senderPhone: senderAcc.phoneNumber,
      senderName: senderAcc.name,
      templateId: template?.id || "tpl_1",
      resolvedMessage: messageText,
      delayAppliedSeconds: typingDelaySeconds,
      hasWhatsApp: true,
      status: "DELIVERED",
      postAttachment: template?.fileName || "",
      errorMessage: ""
    };
    const logs = loadJson(LOGS_FILE, []);
    logs.unshift(newLog);
    saveJson(LOGS_FILE, logs);
    senderAcc.dailySentCount = (senderAcc.dailySentCount || 0) + 1;
    senderAcc.totalDelivered = (senderAcc.totalDelivered || 0) + 1;
    saveJson(ACCOUNTS_FILE, accounts);
    return res.json({
      success: true,
      status: "DELIVERED",
      hasWhatsApp: true,
      messageId: sent?.key?.id || "OK",
      senderPhone: senderAcc.phoneNumber,
      senderName: senderAcc.name,
      log: newLog
    });
  } catch (sendErr) {
    console.error(`[Send-One Error] Failed sending to ${recipientPhone}:`, sendErr.message);
    const newLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      campaignId,
      campaignName,
      timestamp: timeStr,
      recipientPhone,
      recipientName: contact.name || "",
      senderPhone: senderAcc.phoneNumber,
      senderName: senderAcc.name,
      templateId: template?.id || "tpl_1",
      resolvedMessage: messageText,
      delayAppliedSeconds: 0,
      hasWhatsApp: true,
      status: "FAILED",
      postAttachment: template?.fileName || "",
      errorMessage: sendErr.message || "WhatsApp message dispatch failed"
    };
    const logs = loadJson(LOGS_FILE, []);
    logs.unshift(newLog);
    saveJson(LOGS_FILE, logs);
    return res.status(500).json({
      success: false,
      status: "FAILED",
      hasWhatsApp: true,
      log: newLog,
      error: sendErr.message || "Failed to dispatch via WhatsApp"
    });
  }
});
app.get("/api/campaigns", (req, res) => {
  const campaigns = loadJson(CAMPAIGNS_FILE, []);
  res.json(campaigns);
});
app.post("/api/campaigns/create", (req, res) => {
  const campaign = req.body;
  if (!campaign.id) campaign.id = `cmp_${Date.now()}`;
  const campaigns = loadJson(CAMPAIGNS_FILE, []);
  campaigns.unshift(campaign);
  saveJson(CAMPAIGNS_FILE, campaigns);
  res.json({ success: true, campaign });
});
app.post("/api/campaigns/:id/start", async (req, res) => {
  const { id } = req.params;
  executeRealCampaign(id).catch((err) => {
    console.error(`Campaign execution failed for ${id}:`, err);
  });
  res.json({ success: true, status: "started" });
});
app.post("/api/campaigns/:id/pause", (req, res) => {
  const { id } = req.params;
  const ctrl = activeCampaignControllers.get(id);
  if (ctrl) ctrl.isPaused = true;
  res.json({ success: true, status: "paused" });
});
app.post("/api/campaigns/:id/resume", (req, res) => {
  const { id } = req.params;
  const ctrl = activeCampaignControllers.get(id);
  if (ctrl) ctrl.isPaused = false;
  res.json({ success: true, status: "running" });
});
app.post("/api/campaigns/:id/stop", (req, res) => {
  const { id } = req.params;
  const ctrl = activeCampaignControllers.get(id);
  if (ctrl) ctrl.isStopped = true;
  res.json({ success: true, status: "cancelled" });
});
app.get("/api/logs", (req, res) => {
  const logs = loadJson(LOGS_FILE, []);
  res.json(logs);
});
app.get("/api/auto-responders", (req, res) => {
  const rules = loadJson(RULES_FILE, []);
  res.json(rules);
});
app.post("/api/auto-responders/save", (req, res) => {
  const rules = req.body;
  saveJson(RULES_FILE, rules);
  res.json({ success: true });
});
let warmupManualRunning = false;
let warmupTimer = null;
let warmupStopTimer = null;
let warmupPairIndex = 0;
let warmupStartedAt = null;
let warmupDialoguesThisSession = 0;
let warmupAutoStopped = false;
let warmupAutoStopReason = null;
const WARMUP_LOGS_FILE = path.join(DATA_DIR, "warmup_logs.json");
const WARMUP_CONFIG_FILE = path.join(DATA_DIR, "warmup_config.json");
const PAIR_METRICS_FILE = path.join(DATA_DIR, "warmup_pair_metrics.json");
function generateDailyWarmupSlots(targetTotalMinutes = 120, earliestHHMM = "08:30", latestHHMM = "20:30", numSlots = 4) {
  const slots = [];
  try {
    const [eH, eM] = earliestHHMM.split(":").map(Number);
    const [lH, lM] = latestHHMM.split(":").map(Number);
    const startMinTotal = (eH || 8) * 60 + (eM || 30);
    const endMinTotal = (lH || 20) * 60 + (lM || 30);
    const availableRange = Math.max(180, endMinTotal - startMinTotal);
    let remainingMinutes = targetTotalMinutes;
    const baseMinutes = Math.floor(targetTotalMinutes / numSlots);
    const durations = [];
    for (let i = 0; i < numSlots - 1; i++) {
      const jitter = getRandomInt(-5, 6);
      const d = Math.max(15, Math.min(remainingMinutes - 15 * (numSlots - 1 - i), baseMinutes + jitter));
      durations.push(d);
      remainingMinutes -= d;
    }
    durations.push(Math.max(15, remainingMinutes));
    const chunk = Math.floor(availableRange / numSlots);
    for (let i = 0; i < numSlots; i++) {
      const slotStartBase = startMinTotal + i * chunk;
      const maxOffset = Math.max(0, chunk - durations[i] - 15);
      const offset = getRandomInt(5, Math.min(35, maxOffset + 5));
      const actualStart = slotStartBase + offset;
      const actualEnd = actualStart + durations[i];
      const sH = Math.floor(actualStart / 60) % 24;
      const sM = actualStart % 60;
      const eH2 = Math.floor(actualEnd / 60) % 24;
      const eM2 = actualEnd % 60;
      slots.push({
        id: `slot_${Date.now()}_${i}`,
        startTime: `${String(sH).padStart(2, "0")}:${String(sM).padStart(2, "0")}`,
        endTime: `${String(eH2).padStart(2, "0")}:${String(eM2).padStart(2, "0")}`,
        durationMinutes: durations[i],
        status: "pending"
      });
    }
  } catch {
    slots.push(
      { id: "s1", startTime: "09:15", endTime: "09:45", durationMinutes: 30, status: "pending" },
      { id: "s2", startTime: "12:20", endTime: "12:50", durationMinutes: 30, status: "pending" },
      { id: "s3", startTime: "15:30", endTime: "16:00", durationMinutes: 30, status: "pending" },
      { id: "s4", startTime: "18:45", endTime: "19:15", durationMinutes: 30, status: "pending" }
    );
  }
  return slots;
}
const DEFAULT_WARMUP_CONFIG = {
  autoStopMode: "BOTH",
  stopDurationMinutes: 30,
  stopDialogueLimit: 20,
  targetDailyHoursPerPair: 2,
  // 2 Hours default
  scriptStyle: "sinhala_singlish",
  customTopicPrompt: "",
  useAiGeneration: true,
  randomBurstMin: 1,
  randomBurstMax: 3,
  randomDailyScheduleEnabled: true,
  scheduleEnabled: false,
  scheduleDays: [1, 2, 3, 4, 5],
  scheduleStartTime: "08:30",
  scheduleStopTime: "20:30",
  timezone: "Asia/Colombo"
};
let warmupConfig = {
  ...DEFAULT_WARMUP_CONFIG,
  ...loadJson(WARMUP_CONFIG_FILE, {})
};
const todayDateStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
if (!warmupConfig.dailySlots || warmupConfig.dailySlots.length === 0 || warmupConfig.lastGeneratedDate !== todayDateStr) {
  warmupConfig.dailySlots = generateDailyWarmupSlots(
    (warmupConfig.targetDailyHoursPerPair || 2) * 60,
    warmupConfig.scheduleStartTime || "08:30",
    warmupConfig.scheduleStopTime || "20:30",
    4
  );
  warmupConfig.lastGeneratedDate = todayDateStr;
  saveJson(WARMUP_CONFIG_FILE, warmupConfig);
}
let scheduledWarmupActive = false;
function getPairKey(id1, id2) {
  return [id1, id2].sort().join("_");
}
function getPairMetrics() {
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const connectedAccounts = accounts.filter((a) => connectionStatuses.get(a.id) === "CONNECTED" && a.warmupEnabled);
  const metrics = loadJson(PAIR_METRICS_FILE, {});
  const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const targetMins = (warmupConfig.targetDailyHoursPerPair || 2) * 60;
  const result = [];
  for (let i = 0; i < connectedAccounts.length; i++) {
    for (let j = i + 1; j < connectedAccounts.length; j++) {
      const a1 = connectedAccounts[i];
      const a2 = connectedAccounts[j];
      const key = getPairKey(a1.id, a2.id);
      const existing = metrics[key] || {};
      const minsToday = existing.lastDate === todayStr ? existing.minutesCompletedToday || 0 : 0;
      result.push({
        pairKey: key,
        account1Id: a1.id,
        account1Name: a1.name,
        account1Phone: a1.phoneNumber,
        account2Id: a2.id,
        account2Name: a2.name,
        account2Phone: a2.phoneNumber,
        minutesCompletedToday: minsToday,
        targetMinutes: targetMins,
        totalExchanges: existing.totalExchanges || 0,
        lastWarmedAt: existing.lastWarmedAt
      });
    }
  }
  return result;
}
function recordPairExchange(id1, id2, burstCount) {
  const key = getPairKey(id1, id2);
  const metrics = loadJson(PAIR_METRICS_FILE, {});
  const todayStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const now = /* @__PURE__ */ new Date();
  const timeStr = `${now.toISOString().split("T")[0]} ${now.toTimeString().split(" ")[0]}`;
  const current = metrics[key] || { minutesCompletedToday: 0, totalExchanges: 0 };
  if (current.lastDate !== todayStr) {
    current.minutesCompletedToday = 0;
    current.lastDate = todayStr;
  }
  const addedMins = Number((burstCount * 1.5).toFixed(1));
  current.minutesCompletedToday = Number((current.minutesCompletedToday + addedMins).toFixed(1));
  current.totalExchanges = (current.totalExchanges || 0) + burstCount;
  current.lastWarmedAt = timeStr;
  current.lastDate = todayStr;
  metrics[key] = current;
  saveJson(PAIR_METRICS_FILE, metrics);
}
const MULTI_MESSAGE_BURSTS = {
  sinhala_singlish: {
    burst1: [
      ["Ado machan kohomada wada tika?", "Ela bro, wada tika shape eke yanawa. Oyata kohomada?"],
      ["Ada hawasa poddak call ekak gamuda?", "Elakiri machan, 5.30ta wage call ekak gamu."],
      ["Machan document eka ewwa balanna puluwanda?", "Hari bro, mama danma check karala kiyannam."],
      ["Supiri wada tika! Thanks support ekata.", "Ela ela machan, onama welawaka kiyanna!"],
      ["Ada meeting eka thiyenawada?", "Ow machan, 3 PM thiyenne. Link eka thiyenawada?"],
      ["Machan updates tika baluwada?", "Ow baluwa machan, okkoma hari kisima awulak na."],
      ["Suba udasanak bro!", "Suba udasanak! Ada dawasa hodata gewenna kiyala prarthana karanawa \u{1F64F}"],
      ["Wade goda daagatta neda machan?", "Ow bro, goda daagatta. Supiri!"],
      ["Kema keewada machan?", "Ow dan kewe, oya keewada? Podi break ekak gaththa."]
    ],
    burst2: [
      [["Ado machan!", "Ada hawasa poddak call ekak gamuda?"], ["Elakiri machan!", "5.30ta wage call ekak gamu, mama free."]],
      [["Machan", "Document eka ewwa poddak balanna puluwanda?"], ["Hari bro", "Danma check karala mama update ekak dennam."]],
      [["Good morning bro!", "Ada dawasa shape da wada ekka?"], ["Good morning machan!", "Ow shape, tasks tika iwara karanawa dan."]],
      [["Bro e link eka ewapanko", "Podi deyak double check karanna thiyenawa."], ["Elakiri machan ewwa", "Balala kiyanna onada kiyala."]],
      [["Machan campaign wada tika goda daagatta", "Patta results tikak awe ada."], ["Ado maru machan!", "Congratz, thawa scale karamu elakiri!"]]
    ],
    burst3: [
      [["Machan", "Podi update ekak thiyenawa clientgen", "Oya dan online innawada check karanna?"], ["Ow bro dan online", "Ewwa document tika balannam", "Elakiri mama 2 mins walin kiyannam."]],
      [["Ado bro", "Meeting eka 3.30 ta damma", "Zoom link eka inbox ewwa balanna."], ["Hari machan", "Link eka hambuna", "Mama 3.30 ta join wennam."]],
      [["Hi machan", "Ada wada tika okkoma iwarada?", "Hawasa tea ekak bonna yamuda?"], ["Elakiri bro", "Wada tika dan wrap up karanawa", "5.15 ta set wemu shop eka gawa."]]
    ]
  },
  casual: {
    burst1: [
      ["Hey! How's your day going so far?", "Pretty good! Just wrapping up some tasks here. How about you?"],
      ["Are you free for a quick call later today?", "Sure, I should be free around 4 PM. Let's connect then."],
      ["Did you get a chance to check that update?", "Yes, just checked it out! Looks super clean."],
      ["Thanks a lot for the quick follow up!", "Anytime! Glad I could help."],
      ["Hey, having coffee? Grab a break!", "Haha good timing, just made a cup \u2615"],
      ["Can you send over that link when you have a sec?", "Sent! Check your inbox, let me know if you got it."],
      ["Hope your week has been productive!", "Yeah, busy but making solid progress \u{1F44D}"]
    ],
    burst2: [
      [["Hey bro!", "Are you free for a quick sync later today?"], ["Hey! Sure thing", "I should be free around 4 PM. Let's connect then."]],
      [["Did you see the latest release?", "Performance looks dramatically faster now."], ["Yeah tested it earlier!", "Noticeably faster response times across all views."]],
      [["Quick reminder about tomorrow's session", "All slides are uploaded and verified."], ["Awesome work!", "I'll review them before tonight's wrap up."]],
      [["Morning! Grabbed your coffee yet?", "Long schedule lined up for today."], ["Morning! Just brewed a fresh pot \u2615", "Ready to tackle the backlog."]]
    ],
    burst3: [
      [["Hi there!", "Quick question regarding the report", "Did you have time to look over the numbers?"], ["Hey!", "Yes, went over the numbers this morning", "Everything tallies up perfectly."]],
      [["Hey team", "Server deployment wrapped up", "All endpoints returning 200 OK."], ["Excellent news!", "Zero downtime verified on health monitors", "Great job pushing this through."]]
    ]
  },
  business: {
    burst1: [
      ["Good day! Following up on the proposal sent yesterday.", "We are discussing it with our team and will confirm by noon."],
      ["Hello! Could you confirm if the product invoice was received?", "Confirmed! We have received the invoice and processing it today."],
      ["Hi, do you have the updated price catalog for this month?", "Yes, I will share the PDF catalog with you right away."],
      ["Could you provide an estimated delivery timeline for our order?", "Orders dispatched today will arrive within 24 to 48 hours."],
      ["We have updated the service agreement on our portal.", "Received and reviewed. The terms look great to us."]
    ],
    burst2: [
      [["Hello!", "Could you confirm if the product invoice was received?"], ["Confirmed!", "We received the invoice and are processing payment today."]],
      [["Good day,", "Following up on the service agreement review."], ["Thank you for following up", "Our legal team approved it without amendments."]],
      [["Hi there,", "Please find the requested compliance documents."], ["Received with thanks", "We will file them in the audit folder right away."]]
    ],
    burst3: [
      [["Good morning,", "Following up on the delivery schedule", "Can we expect the dispatch by tomorrow afternoon?"], ["Good morning,", "The dispatch is scheduled for tomorrow at 2:00 PM", "Tracking details will be emailed to your team."]]
    ]
  },
  office_sync: {
    burst1: [
      ["Hey team, did everyone review the sprint notes?", "Reviewed and added my comments on section 3."],
      ["Server maintenance completed successfully with 100% uptime.", "Excellent news! Thanks for the proactive monitoring."],
      ["Could you double-check the client report before release?", "Done! Verified numbers and formatting. Ready to dispatch."],
      ["Quick reminder: Team sync starts in 15 minutes.", "Got it, hopping on the link shortly."]
    ],
    burst2: [
      [["Hey team,", "Quick reminder that sprint demo starts in 15 mins."], ["Got it!", "Hopping on the meeting link shortly."]],
      [["Client signed off on the phase 2 milestone", "Great collaboration across the team!"], ["Terrific outcome!", "Moving next tickets to in-progress."]]
    ],
    burst3: [
      [["Hey everyone", "Deployment is starting in staging now", "Please hold off any test pushes for 10 mins."], ["Understood", "Holding test pushes until you give the green light", "Standing by."]]
    ]
  }
};
async function generateWarmupBurstDialogue(style, customPrompt, burstCount = 2) {
  const count = Math.min(3, Math.max(1, burstCount));
  if (warmupConfig.useAiGeneration && process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI();
      const styleInstruction = style === "sinhala_singlish" ? "natural Sinhala/Singlish everyday language in Sri Lanka" : style === "business" ? "polite professional business WhatsApp conversation" : style === "office_sync" ? "short office colleague chat" : "friendly everyday WhatsApp messaging";
      const prompt = `Generate a realistic multi-message WhatsApp conversation between two people in ${styleInstruction}.
Person A sends exactly ${count} consecutive natural short message bubbles.
Person B replies with exactly ${count} consecutive natural short message bubbles.
${customPrompt ? `Topic: "${customPrompt}"` : ""}
Return ONLY valid JSON matching this schema:
{
  "sender": ["message 1", "message 2"],
  "receiver": ["reply 1", "reply 2"]
}`;
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });
      if (response && response.text) {
        const parsed = JSON.parse(response.text.trim());
        if (Array.isArray(parsed.sender) && Array.isArray(parsed.receiver) && parsed.sender.length > 0 && parsed.receiver.length > 0) {
          return {
            burstCount: parsed.sender.length,
            senderMessages: parsed.sender.map(String),
            receiverMessages: parsed.receiver.map(String)
          };
        }
      }
    } catch (e) {
      console.warn("[Warmup AI Burst] Using dynamic multi-message fallback:", e.message);
    }
  }
  const bank = MULTI_MESSAGE_BURSTS[style] || MULTI_MESSAGE_BURSTS["sinhala_singlish"];
  if (count === 1) {
    const pair = bank.burst1[Math.floor(Math.random() * bank.burst1.length)];
    return { burstCount: 1, senderMessages: [pair[0]], receiverMessages: [pair[1]] };
  } else if (count === 2) {
    const pair = bank.burst2[Math.floor(Math.random() * bank.burst2.length)];
    return { burstCount: 2, senderMessages: pair[0], receiverMessages: pair[1] };
  } else {
    const pair = bank.burst3[Math.floor(Math.random() * bank.burst3.length)];
    return { burstCount: 3, senderMessages: pair[0], receiverMessages: pair[1] };
  }
}
function getMeshAccountPairs(connectedAccounts) {
  const pairs = [];
  if (connectedAccounts.length < 2) return pairs;
  for (let i = 0; i < connectedAccounts.length; i++) {
    for (let j = 0; j < connectedAccounts.length; j++) {
      if (i !== j) {
        pairs.push([connectedAccounts[i], connectedAccounts[j]]);
      }
    }
  }
  return pairs;
}
function stopWarmupEngine(reason, isAuto = false) {
  warmupManualRunning = false;
  if (warmupTimer) {
    clearTimeout(warmupTimer);
    warmupTimer = null;
  }
  if (warmupStopTimer) {
    clearTimeout(warmupStopTimer);
    warmupStopTimer = null;
  }
  if (isAuto && reason) {
    warmupAutoStopped = true;
    warmupAutoStopReason = reason;
    const now = /* @__PURE__ */ new Date();
    const timeStr = `${now.toISOString().split("T")[0]} ${now.toTimeString().split(" ")[0]}`;
    const warmupLogs = loadJson(WARMUP_LOGS_FILE, []);
    warmupLogs.unshift({
      id: `wup_autostop_${Date.now()}`,
      timestamp: timeStr,
      fromAccountId: "SYSTEM",
      fromPhone: "Warm-up Engine",
      toAccountId: "ALL",
      toPhone: "Auto-Stop Controller",
      message: `\u{1F6D1} Auto-Stop Notice: ${reason}`,
      status: "READ",
      isAutoStopNotice: true
    });
    saveJson(WARMUP_LOGS_FILE, warmupLogs);
    console.log(`[Warmup Engine] ${reason}`);
  } else {
    console.log("[Warmup Engine] Stopped manually by user.");
  }
}
async function runManualWarmupIteration() {
  if (!warmupManualRunning) return;
  const campaignActive = isAnyCampaignActive();
  if (campaignActive.active) {
    console.log(`[Warmup Paused] Active campaign "${campaignActive.campaignName}" is sending messages. Warm-up deferring for 45s...`);
    if (warmupManualRunning) {
      warmupTimer = setTimeout(runManualWarmupIteration, 45e3);
    }
    return;
  }
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const connectedAccounts = accounts.filter((a) => connectionStatuses.get(a.id) === "CONNECTED" && a.warmupEnabled);
  if (connectedAccounts.length < 2) {
    if (warmupManualRunning) {
      warmupTimer = setTimeout(runManualWarmupIteration, 3e4);
    }
    return;
  }
  const pairMetrics = getPairMetrics();
  const targetMinutes = (warmupConfig.targetDailyHoursPerPair || 2) * 60;
  const meshPairs = getMeshAccountPairs(connectedAccounts);
  if (meshPairs.length === 0) return;
  meshPairs.sort((pairA, pairB) => {
    const keyA = getPairKey(pairA[0].id, pairA[1].id);
    const keyB = getPairKey(pairB[0].id, pairB[1].id);
    const metA = pairMetrics.find((m) => m.pairKey === keyA)?.minutesCompletedToday || 0;
    const metB = pairMetrics.find((m) => m.pairKey === keyB)?.minutesCompletedToday || 0;
    return metA - metB;
  });
  const [sender, receiver] = meshPairs[0];
  const pairKey = getPairKey(sender.id, receiver.id);
  const currentMetric = pairMetrics.find((m) => m.pairKey === pairKey);
  const minsToday = currentMetric?.minutesCompletedToday || 0;
  const allReached = pairMetrics.length > 0 && pairMetrics.every((m) => m.minutesCompletedToday >= targetMinutes);
  if (allReached && warmupConfig.autoStopMode !== "OFF") {
    stopWarmupEngine(`\u{1F3AF} All connected WhatsApp number pairs have reached their daily target of ${warmupConfig.targetDailyHoursPerPair || 2} hours (${targetMinutes} mins). Engine safely resting.`, true);
    return;
  }
  const sockSender = sockets.get(sender.id);
  const sockReceiver = sockets.get(receiver.id);
  if (sockSender && receiver.phoneNumber) {
    const burstCount = getRandomInt(warmupConfig.randomBurstMin || 1, warmupConfig.randomBurstMax || 3);
    const dialogue = await generateWarmupBurstDialogue(warmupConfig.scriptStyle, warmupConfig.customTopicPrompt, burstCount);
    try {
      const targetJid = formatToJid(receiver.phoneNumber);
      console.log(`[Warmup Full-Mesh Burst ${dialogue.burstCount}] ${sender.name} (${sender.phoneNumber}) -> ${receiver.name} (${receiver.phoneNumber}) [${minsToday}m / ${targetMinutes}m today]`);
      for (let b = 0; b < dialogue.senderMessages.length; b++) {
        const msgText = dialogue.senderMessages[b];
        await sockSender.sendPresenceUpdate("composing", targetJid);
        await delay(getRandomInt(1800, 2600));
        await sockSender.sendPresenceUpdate("paused", targetJid);
        await sockSender.sendMessage(targetJid, { text: msgText });
        const now = /* @__PURE__ */ new Date();
        const timeStr = `${now.toISOString().split("T")[0]} ${now.toTimeString().split(" ")[0]}`;
        const warmupLogs = loadJson(WARMUP_LOGS_FILE, []);
        warmupLogs.unshift({
          id: `wup_${Date.now()}_${b}`,
          timestamp: timeStr,
          fromAccountId: sender.id,
          fromPhone: sender.phoneNumber,
          toAccountId: receiver.id,
          toPhone: receiver.phoneNumber,
          message: msgText,
          status: "DELIVERED",
          burstCount: dialogue.burstCount
        });
        saveJson(WARMUP_LOGS_FILE, warmupLogs);
        if (b < dialogue.senderMessages.length - 1) {
          await delay(getRandomInt(1400, 2400));
        }
      }
      warmupDialoguesThisSession += dialogue.senderMessages.length;
      recordPairExchange(sender.id, receiver.id, dialogue.burstCount);
      if ((warmupConfig.autoStopMode === "DIALOGUE_LIMIT" || warmupConfig.autoStopMode === "BOTH") && warmupDialoguesThisSession >= warmupConfig.stopDialogueLimit) {
        stopWarmupEngine(`Reached configured dialogue limit of ${warmupConfig.stopDialogueLimit} exchanges. Engine safely turned OFF.`, true);
        return;
      }
      if (sockReceiver && sender.phoneNumber) {
        const replyDelaySec = getRandomInt(9, 16);
        setTimeout(async () => {
          if (!warmupManualRunning) return;
          try {
            const replyJid = formatToJid(sender.phoneNumber);
            for (let b = 0; b < dialogue.receiverMessages.length; b++) {
              const replyText = dialogue.receiverMessages[b];
              await sockReceiver.sendPresenceUpdate("composing", replyJid);
              await delay(getRandomInt(1800, 2600));
              await sockReceiver.sendPresenceUpdate("paused", replyJid);
              await sockReceiver.sendMessage(replyJid, { text: replyText });
              const replyTime = /* @__PURE__ */ new Date();
              const replyTimeStr = `${replyTime.toISOString().split("T")[0]} ${replyTime.toTimeString().split(" ")[0]}`;
              const logs = loadJson(WARMUP_LOGS_FILE, []);
              logs.unshift({
                id: `wup_${Date.now()}_rep_${b}`,
                timestamp: replyTimeStr,
                fromAccountId: receiver.id,
                fromPhone: receiver.phoneNumber,
                toAccountId: sender.id,
                toPhone: sender.phoneNumber,
                message: replyText,
                status: "READ",
                burstCount: dialogue.burstCount
              });
              saveJson(WARMUP_LOGS_FILE, logs);
              if (b < dialogue.receiverMessages.length - 1) {
                await delay(getRandomInt(1400, 2400));
              }
            }
          } catch (err) {
            console.error("[Warmup Reply Error]:", err.message);
          }
        }, replyDelaySec * 1e3);
      }
    } catch (err) {
      console.error("[Warmup Send Error]:", err.message);
    }
  }
  if (warmupManualRunning) {
    const nextIntervalSec = getRandomInt(35, 65);
    warmupTimer = setTimeout(runManualWarmupIteration, nextIntervalSec * 1e3);
  }
}
function isCurrentTimeWithinSchedule(config) {
  const tz = config.timezone || "Asia/Colombo";
  const { currentDay, currentHHMM } = getCurrentTimezoneInfo(tz);
  const selectedDays = config.scheduleDays || [1, 2, 3, 4, 5];
  const startTime = config.scheduleStartTime || "08:30";
  const stopTime = config.scheduleStopTime || "20:30";
  const isSelectedDay = selectedDays.includes(currentDay);
  let within = false;
  if (startTime < stopTime) {
    within = isSelectedDay && currentHHMM >= startTime && currentHHMM < stopTime;
  } else if (startTime > stopTime) {
    within = isSelectedDay && (currentHHMM >= startTime || currentHHMM < stopTime);
  } else {
    within = false;
  }
  return { within, dayIndex: currentDay, currentHHMM };
}
function checkWarmupSchedule() {
  const tz = warmupConfig.timezone || "Asia/Colombo";
  const { currentHHMM } = getCurrentTimezoneInfo(tz);
  const campaignActive = isAnyCampaignActive();
  if (warmupConfig.randomDailyScheduleEnabled && warmupConfig.dailySlots && warmupConfig.dailySlots.length > 0) {
    let activeSlot = null;
    let anySlotActive = false;
    for (const slot of warmupConfig.dailySlots) {
      let inside = false;
      if (slot.startTime < slot.endTime) {
        inside = currentHHMM >= slot.startTime && currentHHMM < slot.endTime;
      } else {
        inside = currentHHMM >= slot.startTime || currentHHMM < slot.endTime;
      }
      if (inside) {
        activeSlot = slot;
        anySlotActive = true;
        if (campaignActive.active) {
          slot.status = "skipped_campaign";
        } else {
          slot.status = "active";
        }
      } else if (currentHHMM >= slot.endTime && slot.status !== "completed" && slot.status !== "skipped_campaign") {
        slot.status = "completed";
      }
    }
    if (anySlotActive) {
      if (campaignActive.active) {
        if (warmupManualRunning) {
          stopWarmupEngine(`Session paused: Bulk campaign "${campaignActive.campaignName}" is currently dispatching.`, false);
        }
      } else {
        if (!warmupManualRunning) {
          scheduledWarmupActive = true;
          warmupAutoStopped = false;
          warmupAutoStopReason = null;
          warmupDialoguesThisSession = 0;
          warmupStartedAt = (/* @__PURE__ */ new Date()).toISOString();
          warmupManualRunning = true;
          console.log(`[Warmup Scheduler] \u23F0 Random Daily Session Slot active [${activeSlot?.startTime} - ${activeSlot?.endTime}]. Warmup started!`);
          runManualWarmupIteration();
        }
      }
    } else {
      if (warmupManualRunning && scheduledWarmupActive) {
        scheduledWarmupActive = false;
        stopWarmupEngine(`\u{1F6D1} Session slot closed at ${currentHHMM}. Engine resting until next random slot.`, true);
      }
    }
    return;
  }
  if (!warmupConfig.scheduleEnabled) {
    if (scheduledWarmupActive && warmupManualRunning) {
      scheduledWarmupActive = false;
      stopWarmupEngine("Schedule disabled by user.", true);
    }
    return;
  }
  const { within } = isCurrentTimeWithinSchedule(warmupConfig);
  if (within) {
    if (campaignActive.active) {
      if (warmupManualRunning) {
        stopWarmupEngine(`Schedule paused: Bulk campaign "${campaignActive.campaignName}" is currently dispatching.`, false);
      }
    } else if (!warmupManualRunning) {
      scheduledWarmupActive = true;
      warmupAutoStopped = false;
      warmupAutoStopReason = null;
      warmupDialoguesThisSession = 0;
      warmupStartedAt = (/* @__PURE__ */ new Date()).toISOString();
      warmupManualRunning = true;
      runManualWarmupIteration();
    }
  } else {
    if (scheduledWarmupActive && warmupManualRunning) {
      scheduledWarmupActive = false;
      stopWarmupEngine(`\u{1F6D1} Scheduled window closed at ${currentHHMM}.`, true);
    }
  }
}
setInterval(checkWarmupSchedule, 2e4);
app.get("/api/warmup/status", (req, res) => {
  const warmupLogs = loadJson(WARMUP_LOGS_FILE, []);
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const connectedAccounts = accounts.filter((a) => connectionStatuses.get(a.id) === "CONNECTED" && a.warmupEnabled);
  const meshPairs = getMeshAccountPairs(connectedAccounts);
  const pairMetrics = getPairMetrics();
  const todayTotalWarmupMinutes = pairMetrics.reduce((sum, m) => sum + m.minutesCompletedToday, 0);
  let nextPairInfo = null;
  if (meshPairs.length > 0) {
    const nextPair = meshPairs[warmupPairIndex % meshPairs.length];
    nextPairInfo = {
      senderName: nextPair[0].name,
      senderPhone: nextPair[0].phoneNumber,
      receiverName: nextPair[1].name,
      receiverPhone: nextPair[1].phoneNumber
    };
  }
  const tzInfo = getCurrentTimezoneInfo(warmupConfig.timezone || "Asia/Colombo");
  const campaignActive = isAnyCampaignActive();
  const currentHHMM = tzInfo.currentHHMM;
  const activeSlot = warmupConfig.dailySlots?.find((s) => {
    if (s.startTime < s.endTime) return currentHHMM >= s.startTime && currentHHMM < s.endTime;
    return currentHHMM >= s.startTime || currentHHMM < s.endTime;
  }) || null;
  res.json({
    isRunning: warmupManualRunning,
    startedAt: warmupStartedAt,
    dialoguesCompletedThisSession: warmupDialoguesThisSession,
    autoStopTriggered: warmupAutoStopped,
    autoStopReason: warmupAutoStopReason,
    config: warmupConfig,
    nextPairInfo,
    totalMeshPairs: meshPairs.length,
    isScheduledWindowActive: Boolean(activeSlot || warmupConfig.scheduleEnabled && isCurrentTimeWithinSchedule(warmupConfig).within),
    currentTimeStr: tzInfo.formatted,
    campaignRunningNotice: campaignActive.active ? campaignActive.campaignName : null,
    activeSlot,
    pairMetrics,
    todayTotalWarmupMinutes,
    logs: warmupLogs
  });
});
app.post("/api/warmup/start", (req, res) => {
  const updates = req.body || {};
  warmupConfig = {
    ...warmupConfig,
    ...updates,
    targetDailyHoursPerPair: Number(updates.targetDailyHoursPerPair) || warmupConfig.targetDailyHoursPerPair || 2,
    randomBurstMin: Number(updates.randomBurstMin) || warmupConfig.randomBurstMin || 1,
    randomBurstMax: Number(updates.randomBurstMax) || warmupConfig.randomBurstMax || 3,
    randomDailyScheduleEnabled: updates.randomDailyScheduleEnabled !== void 0 ? Boolean(updates.randomDailyScheduleEnabled) : warmupConfig.randomDailyScheduleEnabled,
    stopDurationMinutes: Number(updates.stopDurationMinutes) || warmupConfig.stopDurationMinutes || 30,
    stopDialogueLimit: Number(updates.stopDialogueLimit) || warmupConfig.stopDialogueLimit || 20
  };
  warmupAutoStopped = false;
  warmupAutoStopReason = null;
  warmupDialoguesThisSession = 0;
  warmupStartedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (warmupStopTimer) {
    clearTimeout(warmupStopTimer);
    warmupStopTimer = null;
  }
  if (warmupConfig.autoStopMode === "DURATION" || warmupConfig.autoStopMode === "BOTH") {
    const durationMs = warmupConfig.stopDurationMinutes * 60 * 1e3;
    warmupStopTimer = setTimeout(() => {
      stopWarmupEngine(`Reached configured time duration limit of ${warmupConfig.stopDurationMinutes} minutes. Engine safely turned OFF.`, true);
    }, durationMs);
  }
  if (!warmupManualRunning) {
    warmupManualRunning = true;
    console.log(`[Warmup Engine] Started by user. Style: "${warmupConfig.scriptStyle}", DailyHours: ${warmupConfig.targetDailyHoursPerPair}h`);
    runManualWarmupIteration();
  }
  saveJson(WARMUP_CONFIG_FILE, warmupConfig);
  res.json({
    success: true,
    isRunning: true,
    config: warmupConfig,
    startedAt: warmupStartedAt
  });
});
app.post("/api/warmup/config", (req, res) => {
  const updates = req.body || {};
  warmupConfig = {
    ...warmupConfig,
    ...updates,
    targetDailyHoursPerPair: updates.targetDailyHoursPerPair !== void 0 ? Number(updates.targetDailyHoursPerPair) : warmupConfig.targetDailyHoursPerPair,
    randomBurstMin: updates.randomBurstMin !== void 0 ? Number(updates.randomBurstMin) : warmupConfig.randomBurstMin,
    randomBurstMax: updates.randomBurstMax !== void 0 ? Number(updates.randomBurstMax) : warmupConfig.randomBurstMax,
    randomDailyScheduleEnabled: updates.randomDailyScheduleEnabled !== void 0 ? Boolean(updates.randomDailyScheduleEnabled) : warmupConfig.randomDailyScheduleEnabled,
    stopDurationMinutes: updates.stopDurationMinutes !== void 0 ? Number(updates.stopDurationMinutes) || 30 : warmupConfig.stopDurationMinutes,
    stopDialogueLimit: updates.stopDialogueLimit !== void 0 ? Number(updates.stopDialogueLimit) || 20 : warmupConfig.stopDialogueLimit,
    scriptStyle: updates.scriptStyle || warmupConfig.scriptStyle,
    autoStopMode: updates.autoStopMode || warmupConfig.autoStopMode,
    customTopicPrompt: updates.customTopicPrompt !== void 0 ? String(updates.customTopicPrompt) : warmupConfig.customTopicPrompt,
    useAiGeneration: updates.useAiGeneration !== void 0 ? Boolean(updates.useAiGeneration) : warmupConfig.useAiGeneration,
    scheduleEnabled: updates.scheduleEnabled !== void 0 ? Boolean(updates.scheduleEnabled) : warmupConfig.scheduleEnabled,
    scheduleDays: Array.isArray(updates.scheduleDays) ? updates.scheduleDays.map(Number) : warmupConfig.scheduleDays,
    scheduleStartTime: updates.scheduleStartTime ? String(updates.scheduleStartTime) : warmupConfig.scheduleStartTime,
    scheduleStopTime: updates.scheduleStopTime ? String(updates.scheduleStopTime) : warmupConfig.scheduleStopTime,
    timezone: updates.timezone ? String(updates.timezone) : warmupConfig.timezone
  };
  saveJson(WARMUP_CONFIG_FILE, warmupConfig);
  checkWarmupSchedule();
  res.json({ success: true, config: warmupConfig });
});
app.post("/api/warmup/generate-schedule", (req, res) => {
  const targetMinutes = (Number(req.body?.targetDailyHours) || warmupConfig.targetDailyHoursPerPair || 2) * 60;
  const slots = generateDailyWarmupSlots(
    targetMinutes,
    req.body?.scheduleStartTime || warmupConfig.scheduleStartTime || "08:30",
    req.body?.scheduleStopTime || warmupConfig.scheduleStopTime || "20:30",
    Number(req.body?.numSlots) || 4
  );
  warmupConfig.dailySlots = slots;
  warmupConfig.lastGeneratedDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  saveJson(WARMUP_CONFIG_FILE, warmupConfig);
  console.log(`[Warmup Schedule Generated] ${slots.length} randomized session slots for today (${targetMinutes} mins total)`);
  res.json({ success: true, dailySlots: slots });
});
app.post("/api/campaigns/calculate-pacing", (req, res) => {
  const {
    startTime = "06:00",
    endTime = "18:00",
    contactCount = 1e3
  } = req.body || {};
  const windowMinutes = calculateWindowMinutes(startTime, endTime);
  const totalSeconds = windowMinutes * 60;
  const count = Math.max(1, Number(contactCount) || 1);
  const idealPaceSeconds = Math.max(15, Math.floor(totalSeconds / count));
  const recommendedMinDelay = Math.max(15, Math.floor(idealPaceSeconds * 0.7));
  const recommendedMaxDelay = Math.max(recommendedMinDelay + 5, Math.ceil(idealPaceSeconds * 1.35));
  const recommendedBatchSize = Math.max(8, Math.min(25, Math.floor(count / 40)));
  const recommendedBreakMinutes = Math.max(2, Math.min(6, Math.floor(windowMinutes / 120)));
  res.json({
    windowMinutes,
    totalSeconds,
    contactCount: count,
    idealPaceSeconds,
    recommendedMinDelay,
    recommendedMaxDelay,
    recommendedBatchSize,
    recommendedBreakMinutes,
    formulaDescription: `Distributes ${count} messages smoothly across ${windowMinutes / 60}h window (~${idealPaceSeconds}s per message) with anti-ban random jitter (${recommendedMinDelay}s - ${recommendedMaxDelay}s).`
  });
});
app.post("/api/warmup/stop", (req, res) => {
  scheduledWarmupActive = false;
  stopWarmupEngine(void 0, false);
  res.json({ success: true, isRunning: false });
});
app.post("/api/warmup/trigger-instant", async (req, res) => {
  const accounts = loadJson(ACCOUNTS_FILE, []);
  const connectedAccounts = accounts.filter((a) => connectionStatuses.get(a.id) === "CONNECTED" && a.warmupEnabled);
  if (connectedAccounts.length < 2) {
    return res.status(400).json({ error: "Need at least 2 connected WhatsApp accounts to exchange real dialogue." });
  }
  const meshPairs = getMeshAccountPairs(connectedAccounts);
  const [sender, receiver] = meshPairs[warmupPairIndex % meshPairs.length];
  warmupPairIndex = (warmupPairIndex + 1) % meshPairs.length;
  const sockSender = sockets.get(sender.id);
  const sockReceiver = sockets.get(receiver.id);
  if (!sockSender) return res.status(400).json({ error: "Sender socket unavailable." });
  try {
    const targetJid = formatToJid(receiver.phoneNumber);
    const burstCount = getRandomInt(warmupConfig.randomBurstMin || 1, warmupConfig.randomBurstMax || 3);
    const dialogue = await generateWarmupBurstDialogue(warmupConfig.scriptStyle, warmupConfig.customTopicPrompt, burstCount);
    for (let b = 0; b < dialogue.senderMessages.length; b++) {
      const msgText = dialogue.senderMessages[b];
      await sockSender.sendPresenceUpdate("composing", targetJid);
      await delay(1500);
      await sockSender.sendPresenceUpdate("paused", targetJid);
      await sockSender.sendMessage(targetJid, { text: msgText });
      const now = /* @__PURE__ */ new Date();
      const timeStr = `${now.toISOString().split("T")[0]} ${now.toTimeString().split(" ")[0]}`;
      const warmupLogs = loadJson(WARMUP_LOGS_FILE, []);
      warmupLogs.unshift({
        id: `wup_${Date.now()}_instant_${b}`,
        timestamp: timeStr,
        fromAccountId: sender.id,
        fromPhone: sender.phoneNumber,
        toAccountId: receiver.id,
        toPhone: receiver.phoneNumber,
        message: msgText,
        status: "DELIVERED",
        burstCount: dialogue.burstCount
      });
      saveJson(WARMUP_LOGS_FILE, warmupLogs);
      if (b < dialogue.senderMessages.length - 1) {
        await delay(1200);
      }
    }
    recordPairExchange(sender.id, receiver.id, dialogue.burstCount);
    if (sockReceiver && sender.phoneNumber) {
      setTimeout(async () => {
        try {
          const replyJid = formatToJid(sender.phoneNumber);
          for (let b = 0; b < dialogue.receiverMessages.length; b++) {
            const replyText = dialogue.receiverMessages[b];
            await sockReceiver.sendPresenceUpdate("composing", replyJid);
            await delay(1500);
            await sockReceiver.sendPresenceUpdate("paused", replyJid);
            await sockReceiver.sendMessage(replyJid, { text: replyText });
            const replyTime = /* @__PURE__ */ new Date();
            const replyTimeStr = `${replyTime.toISOString().split("T")[0]} ${replyTime.toTimeString().split(" ")[0]}`;
            const logs = loadJson(WARMUP_LOGS_FILE, []);
            logs.unshift({
              id: `wup_${Date.now()}_instant_reply_${b}`,
              timestamp: replyTimeStr,
              fromAccountId: receiver.id,
              fromPhone: receiver.phoneNumber,
              toAccountId: sender.id,
              toPhone: sender.phoneNumber,
              message: replyText,
              status: "READ",
              burstCount: dialogue.burstCount
            });
            saveJson(WARMUP_LOGS_FILE, logs);
            if (b < dialogue.receiverMessages.length - 1) {
              await delay(1200);
            }
          }
        } catch (e) {
          console.error("[Instant Warmup Reply Error]:", e.message);
        }
      }, 7e3);
    }
    res.json({ success: true, burstCount: dialogue.burstCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/warmup/preview-ai", async (req, res) => {
  const { scriptStyle = "casual", customTopicPrompt = "" } = req.body || {};
  try {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const dialogue = await generateWarmupBurstDialogue(scriptStyle, customTopicPrompt, 2);
      samples.push({
        id: i + 1,
        message1: dialogue.senderMessages.join(" | "),
        message2: dialogue.receiverMessages.join(" | ")
      });
    }
    res.json({ success: true, samples });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
async function bootstrap() {
  const vault = loadJson(SESSIONS_VAULT_FILE, {});
  for (const [accId, keys] of Object.entries(vault)) {
    const sessionDir = path.join(SESSIONS_DIR, `session_${accId}`);
    if (!fs.existsSync(path.join(sessionDir, "creds.json"))) {
      console.log(`[Startup] Recovering session keys from vault for account ${accId}...`);
      importSessionKeys(accId, keys);
    }
  }
  const existingAccounts = loadJson(ACCOUNTS_FILE, []);
  for (const acc of existingAccounts) {
    const sessionDir = path.join(SESSIONS_DIR, `session_${acc.id}`);
    const credsExist = fs.existsSync(path.join(sessionDir, "creds.json"));
    if (credsExist) {
      console.log(`[Startup] Restoring linked WhatsApp session from disk for ${acc.name} (${acc.id})...`);
      initBaileysAccount(acc.id, acc.name).catch(console.error);
    } else {
      console.log(`[Startup] Account ${acc.name} (${acc.id}) has no saved credentials on disk yet. Ready for QR scan.`);
      connectionStatuses.set(acc.id, "SCAN_REQUIRED");
    }
  }
  setInterval(async () => {
    for (const [accId, sock] of sockets.entries()) {
      if (connectionStatuses.get(accId) === "CONNECTED") {
        try {
          await sock.sendPresenceUpdate("available");
        } catch (e) {
        }
      }
    }
    const accounts = loadJson(ACCOUNTS_FILE, []);
    const vault2 = loadJson(SESSIONS_VAULT_FILE, {});
    for (const acc of accounts) {
      const sessionDir = path.join(SESSIONS_DIR, `session_${acc.id}`);
      const hasCredsOnDisk = fs.existsSync(path.join(sessionDir, "creds.json"));
      const hasVaultKeys = Boolean(vault2[acc.id] && vault2[acc.id]["creds.json"]);
      if ((hasCredsOnDisk || hasVaultKeys) && connectionStatuses.get(acc.id) !== "CONNECTED" && connectionStatuses.get(acc.id) !== "CONNECTING") {
        console.log(`[24/7 Watchdog] Account ${acc.id} (${acc.name}) has saved credentials but is currently ${connectionStatuses.get(acc.id)}. Auto-reconnecting...`);
        initBaileysAccount(acc.id, acc.name).catch(console.error);
      }
    }
  }, 25e3);
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ["**/sessions/**", "**/uploads/**", "**/data/**", "**/*.json"]
        }
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve("./dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("./dist/index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[YUHUSULU CRM] Full-Stack WhatsApp Server running at http://localhost:${PORT}`);
  });
}
bootstrap();
