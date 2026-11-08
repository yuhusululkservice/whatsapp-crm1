import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import pino from 'pino';
import multer from 'multer';
import { execFile, execFileSync, execSync } from 'child_process';
import util from 'util';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay,
  WASocket,
  Browsers
} from '@whiskeysockets/baileys';
import { GoogleGenAI } from '@google/genai';

const execFilePromise = util.promisify(execFile);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Persistent Data Storage & Media Uploads Directory
const DATA_DIR = path.resolve('./data');
const SESSIONS_DIR = path.resolve('./sessions');
const UPLOADS_DIR = path.resolve('./uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const TEMP_UPLOADS_DIR = path.resolve('./uploads/temp');
if (!fs.existsSync(TEMP_UPLOADS_DIR)) fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

// Multer storage for uploaded media (photos, PDF docs)
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
  limits: { fileSize: 100 * 1024 * 1024 } // up to 100MB for HD videos and rich media
});

// Multer storage for chunk uploads (slices large videos into small 4MB chunks to bypass proxy limits)
const chunkStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, TEMP_UPLOADS_DIR);
  },
  filename: (req, _file, cb) => {
    const uploadId = (req.query.uploadId as string) || (req.headers['x-upload-id'] as string) || req.body?.uploadId || 'upl';
    const chunkIndex = (req.query.chunkIndex as string) || (req.headers['x-chunk-index'] as string) || req.body?.chunkIndex || '0';
    cb(null, `chunk_${uploadId}_${chunkIndex}`);
  }
});
const chunkUpload = multer({
  storage: chunkStorage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Helper to extract video dimensions, duration, and high-res thumbnail for native WhatsApp rendering
function getVideoMetadata(videoPath: string): { width?: number; height?: number; duration?: number; jpegThumbnail?: Buffer } {
  try {
    if (!fs.existsSync(videoPath)) return {};

    const probeOut = execFileSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration',
      '-of', 'default=noprint_wrappers=1',
      videoPath
    ], { timeout: 10000 }).toString();

    let width: number | undefined;
    let height: number | undefined;
    let duration: number | undefined;

    for (const line of probeOut.split('\n')) {
      const [k, v] = line.split('=');
      if (k === 'width' && v) width = parseInt(v.trim(), 10);
      if (k === 'height' && v) height = parseInt(v.trim(), 10);
      if (k === 'duration' && v) duration = parseFloat(v.trim());
    }

    // Pre-generate 480px JPEG thumbnail so WhatsApp displays rich full-screen preview
    const thumbPath = `${videoPath}_thumb.jpg`;
    if (!fs.existsSync(thumbPath)) {
      try {
        execFileSync('ffmpeg', [
          '-y',
          '-ss', '00:00:01',
          '-i', videoPath,
          '-vframes', '1',
          '-vf', "scale='min(480\\,iw)':-2",
          '-q:v', '3',
          thumbPath
        ], { timeout: 10000 });
      } catch (e) {
        try {
          execFileSync('ffmpeg', [
            '-y',
            '-i', videoPath,
            '-vframes', '1',
            '-vf', "scale='min(480\\,iw)':-2",
            '-q:v', '3',
            thumbPath
          ], { timeout: 10000 });
        } catch (e2) {}
      }
    }

    let jpegThumbnail: Buffer | undefined;
    if (fs.existsSync(thumbPath)) {
      jpegThumbnail = fs.readFileSync(thumbPath);
    }

    return { width, height, duration, jpegThumbnail };
  } catch (err: any) {
    console.warn(`[Video Metadata Warning] Could not probe video:`, err.message);
    return {};
  }
}

// Helper to compress and optimize videos for WhatsApp via FFmpeg (Adaptive CRF, Bitrate Cap, and Faststart)
async function compressVideoForWhatsApp(inputPath: string): Promise<{
  outputPath: string;
  outputFilename: string;
  outputUrl: string;
  originalSize: number;
  compressedSize: number;
  width?: number;
  height?: number;
  duration?: number;
}> {
  const originalSize = fs.existsSync(inputPath) ? fs.statSync(inputPath).size : 0;
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const outputFilename = `${baseName}_whatsapp.mp4`;
  const outputPath = path.join(UPLOADS_DIR, outputFilename);

  // If already compressed version exists, return it with its metadata
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

  // Probe original video duration & size to determine optimal compression profile
  const metaBefore = getVideoMetadata(inputPath);
  const durationSec = metaBefore.duration || 0;

  // Adaptive tuning: Longer videos need tighter bitrate limits to stay under WhatsApp's 16MB inline threshold
  let scaleFilter = "scale='min(1280\\,iw)':-2"; // 720p HD default
  let crf = '28';
  let videoBitrateArgs: string[] = [];
  let audioBitrate = '96k';

  if (durationSec > 180) {
    // 3+ minutes video: 480p SD, capped bitrate ensures < 16MB
    scaleFilter = "scale='min(854\\,iw)':-2";
    crf = '32';
    videoBitrateArgs = ['-b:v', '650k', '-maxrate', '850k', '-bufsize', '1700k'];
    audioBitrate = '64k';
  } else if (durationSec > 60) {
    // 1-3 minutes video: 720p HD with bitrate cap
    scaleFilter = "scale='min(1280\\,iw)':-2";
    crf = '30';
    videoBitrateArgs = ['-b:v', '1100k', '-maxrate', '1400k', '-bufsize', '2800k'];
    audioBitrate = '96k';
  }

  // FFmpeg command strictly configured for WhatsApp Native Playback (H.264 High/Main, YUV420p, AAC, +faststart)
  const ffmpegArgs = [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-crf', crf,
    ...videoBitrateArgs,
    '-vf', scaleFilter,
    '-c:a', 'aac',
    '-b:a', audioBitrate,
    '-ar', '44100',
    '-movflags', '+faststart',
    outputPath
  ];

  try {
    await execFilePromise('ffmpeg', ffmpegArgs, { timeout: 180000 });
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
  } catch (err: any) {
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

// Helper to prepare real Baileys media payload from local uploads or base64
// Formatted to render as NATIVE FULL-SIZE INLINE WHATSAPP VIDEOS (not documents, not tiny notes)
function prepareMediaPayload(template: any, captionText: string): any {
  if (!template) return { text: captionText };

  let localPath: string | null = null;
  if (template.filePath && fs.existsSync(template.filePath)) {
    localPath = template.filePath;
  } else if (template.mediaUrl && template.mediaUrl.startsWith('/uploads/')) {
    const filename = path.basename(template.mediaUrl);
    const fullPath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(fullPath)) localPath = fullPath;
  }

  if (localPath) {
    const ext = path.extname(localPath).toLowerCase();
    const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
    const isVideo = ['.mp4', '.mov', '.mkv', '.3gp', '.avi', '.webm'].includes(ext) || template.mediaType === 'video';
    const isPdf = ext === '.pdf';

    if (isVideo) {
      // Prioritize WhatsApp-optimized version if available
      let videoFileToRead = localPath;
      const parsed = path.parse(localPath);
      const possibleCompressed = path.join(parsed.dir, `${parsed.name}_whatsapp.mp4`);
      if (fs.existsSync(possibleCompressed)) {
        videoFileToRead = possibleCompressed;
      }

      const meta = getVideoMetadata(videoFileToRead);
      const buffer = fs.readFileSync(videoFileToRead);

      // WhatsApp Native Video Message payload:
      // - Do NOT set fileName on video (setting fileName causes Baileys/WhatsApp to display as a document card)
      // - ptv: false ensures standard inline video playback with player controls, not circular video note
      // - gifPlayback: false ensures full normal video with sound
      // - width, height, seconds, and jpegThumbnail ensure full-size player rendering
      const payload: any = {
        video: buffer,
        mimetype: 'video/mp4',
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
          mimetype: 'application/pdf',
          fileName: template.fileName || path.basename(localPath),
          caption: captionText
        };
      } else {
        return {
          document: buffer,
          mimetype: 'application/octet-stream',
          fileName: template.fileName || path.basename(localPath),
          caption: captionText
        };
      }
    }
  }

  // Handle Base64 Data URI if sent directly
  if (template.mediaUrl && template.mediaUrl.startsWith('data:')) {
    const [meta, base64Data] = template.mediaUrl.split(',');
    const mimeMatch = meta.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const buffer = Buffer.from(base64Data, 'base64');

    if (mime.startsWith('video/')) {
      const tempPath = path.join(TEMP_UPLOADS_DIR, `temp_${Date.now()}.mp4`);
      try {
        fs.writeFileSync(tempPath, buffer);
        const meta = getVideoMetadata(tempPath);
        const payload: any = {
          video: buffer,
          mimetype: 'video/mp4',
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
      } catch (e) {
        return {
          video: buffer,
          mimetype: 'video/mp4',
          caption: captionText,
          ptv: false,
          gifPlayback: false
        };
      }
    } else if (mime.startsWith('image/')) {
      return {
        image: buffer,
        caption: captionText
      };
    } else {
      return {
        document: buffer,
        mimetype: mime,
        fileName: template.fileName || 'attachment.pdf',
        caption: captionText
      };
    }
  }

  return { text: captionText };
}

const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'campaigns.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const RULES_FILE = path.join(DATA_DIR, 'auto_responders.json');
const STOP_NUMBERS_FILE = path.join(DATA_DIR, 'stop_numbers.json');
const SESSIONS_VAULT_FILE = path.join(DATA_DIR, 'sessions_vault.json');

// Memory cache for active Baileys sockets and live QR codes
const sockets = new Map<string, WASocket>();
const qrCodes = new Map<string, string>(); // accountId -> dataURL
const connectionStatuses = new Map<string, string>(); // accountId -> 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'SCAN_REQUIRED'
const reconnectAttempts = new Map<string, number>();
const connectionErrors = new Map<string, string>();

// Helper to load/save JSON data
function loadJson<T>(filePath: string, defaultVal: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
  return defaultVal;
}

function saveJson<T>(filePath: string, data: T): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error saving ${filePath}:`, err);
  }
}

// -------------------------------------------------------------
// PERMANENT MULTI-MONTH SESSION VAULT (Disaster-proof session persistence)
// -------------------------------------------------------------
function exportSessionKeys(accountId: string): Record<string, string> | null {
  try {
    const sessionDir = path.join(SESSIONS_DIR, `session_${accountId}`);
    if (!fs.existsSync(sessionDir)) return null;
    const files = fs.readdirSync(sessionDir);
    if (!files.includes('creds.json')) return null;

    const bundle: Record<string, string> = {};
    for (const f of files) {
      const fullPath = path.join(sessionDir, f);
      if (fs.statSync(fullPath).isFile()) {
        bundle[f] = fs.readFileSync(fullPath, 'utf-8');
      }
    }
    return bundle;
  } catch (err: any) {
    console.error(`Error exporting session keys for ${accountId}:`, err.message);
    return null;
  }
}

function importSessionKeys(accountId: string, keys: Record<string, string>): boolean {
  try {
    if (!keys || !keys['creds.json']) return false;
    const sessionDir = path.join(SESSIONS_DIR, `session_${accountId}`);
    const backupDir = path.join(DATA_DIR, 'session_backups', accountId);

    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    for (const [filename, content] of Object.entries(keys)) {
      fs.writeFileSync(path.join(sessionDir, filename), content, 'utf-8');
      fs.writeFileSync(path.join(backupDir, filename), content, 'utf-8');
    }

    const vault = loadJson<Record<string, Record<string, string>>>(SESSIONS_VAULT_FILE, {});
    vault[accountId] = keys;
    saveJson(SESSIONS_VAULT_FILE, vault);

    console.log(`[Session Vault] Successfully restored ${Object.keys(keys).length} session keys for account ${accountId}`);
    return true;
  } catch (err: any) {
    console.error(`Error importing session keys for ${accountId}:`, err.message);
    return false;
  }
}

function persistSessionToVault(accountId: string): void {
  try {
    const keys = exportSessionKeys(accountId);
    if (keys && keys['creds.json']) {
      // 1. Save to JSON vault
      const vault = loadJson<Record<string, Record<string, string>>>(SESSIONS_VAULT_FILE, {});
      vault[accountId] = keys;
      saveJson(SESSIONS_VAULT_FILE, vault);

      // 2. Also mirror to disk folder backup
      const backupDir = path.join(DATA_DIR, 'session_backups', accountId);
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
      for (const [f, c] of Object.entries(keys)) {
        fs.writeFileSync(path.join(backupDir, f), c, 'utf-8');
      }

      console.log(`[Session Vault] Backed up ${Object.keys(keys).length} keys for account ${accountId} to persistent vault and backup disk.`);
    }
  } catch (err: any) {
    console.error(`Error persisting session to vault for ${accountId}:`, err.message);
  }
}

// Spintax & Variable helpers
function resolveSpintax(text: string): string {
  const spintaxRegex = /\{([^{}]+)\}/;
  let matches = spintaxRegex.exec(text);
  while (matches) {
    const choices = matches[1].split('|');
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    text = text.replace(matches[0], randomChoice);
    matches = spintaxRegex.exec(text);
  }
  return text;
}

function replaceVariables(text: string, vars: Record<string, string | undefined>): string {
  let result = text;
  for (const [key, val] of Object.entries(vars)) {
    if (val !== undefined) {
      const reg = new RegExp('{{' + key + '}}', 'gi');
      result = result.replace(reg, val);
    }
  }
  return result;
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Normalize phone number (Supports Sri Lanka local 07..., 94..., +94..., and international)
function normalizeWhatsAppNumber(phone: string, defaultCountryCode = '94'): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.substring(2);
  }
  // Sri Lanka 10-digit format (070..., 077..., 071..., 011...) -> replace leading 0 with 94
  if (digits.startsWith('0') && digits.length === 10) {
    digits = `${defaultCountryCode}${digits.substring(1)}`;
  } else if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) {
    digits = `${defaultCountryCode}${digits}`;
  }
  return digits;
}

// Format phone number to WhatsApp JID format
function formatToJid(phone: string): string {
  const norm = normalizeWhatsAppNumber(phone);
  return `${norm}@s.whatsapp.net`;
}

// Bulletproof Stop Numbers detection across all formatting variants (07..., 94..., +94..., spaces, core digits)
function isStopNumber(phone: string): { isStopped: boolean; reason?: string } {
  if (!phone) return { isStopped: false };
  const rawTarget = phone.replace(/\D/g, '');
  if (!rawTarget) return { isStopped: false };

  // Core subscriber digits (last 9 digits for Sri Lanka e.g. 703393139)
  const targetCore = rawTarget.length >= 9 ? rawTarget.slice(-9) : rawTarget;
  const targetNorm = normalizeWhatsAppNumber(phone);

  const stopList = loadJson<any[]>(STOP_NUMBERS_FILE, []);
  for (const item of stopList) {
    const rawItem = (item.phoneNumber || item.normalizedPhone || '').toString();
    const cleanItem = rawItem.replace(/\D/g, '');
    if (!cleanItem) continue;

    const itemCore = cleanItem.length >= 9 ? cleanItem.slice(-9) : cleanItem;
    const itemNorm = item.normalizedPhone || normalizeWhatsAppNumber(rawItem);

    if (
      (targetCore && itemCore && targetCore === itemCore) ||
      (targetNorm && itemNorm && targetNorm === itemNorm) ||
      rawTarget === cleanItem ||
      phone.trim() === rawItem.trim()
    ) {
      return { isStopped: true, reason: item.reason || 'Opt-Out (Stop List)' };
    }
  }
  return { isStopped: false };
}

// Bulletproof validation: An account is ONLY connected if Baileys socket exists, user JID is authenticated, and WebSocket readyState === 1
function isAccountGenuinelyConnected(accId: string): boolean {
  const sock = sockets.get(accId);
  const liveStatus = connectionStatuses.get(accId);
  const isSocketOpen = Boolean(sock && (sock as any).ws?.readyState === 1);
  const hasUserJid = Boolean(sock?.user?.id);
  return liveStatus === 'CONNECTED' && isSocketOpen && hasUserJid;
}

// -------------------------------------------------------------
// REAL BAILEYS MULTI-DEVICE WHATSAPP INITIALIZER
// -------------------------------------------------------------
async function initBaileysAccount(
  accountId: string,
  accountName: string = 'WhatsApp Account',
  forceNewQr: boolean = false,
  resetSession: boolean = false
) {
  const existingSock = sockets.get(accountId);
  if (existingSock) {
    const isSocketAlive = (existingSock as any).ws?.readyState === 1;
    if (!forceNewQr && !resetSession && isSocketAlive && isAccountGenuinelyConnected(accountId)) {
      console.log(`[Baileys Real] Account ${accountId} is already actively connected. Preserving live socket.`);
      return existingSock;
    }
    try {
      existingSock.ev.removeAllListeners('connection.update');
      existingSock.ev.removeAllListeners('creds.update');
      existingSock.end(undefined);
    } catch (e) {}
    sockets.delete(accountId);
  }

  const sessionDir = path.join(SESSIONS_DIR, `session_${accountId}`);
  const backupDir = path.join(DATA_DIR, 'session_backups', accountId);

  // If user explicitly requested a full reset / fresh QR, purge previous session directory so Baileys generates a brand new QR code
  if (resetSession || forceNewQr) {
    console.log(`[Baileys Real] Session reset / fresh QR requested for ${accountId}. Clearing session files.`);
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
      fs.rmSync(backupDir, { recursive: true, force: true });
      if (resetSession) {
        const vault = loadJson<Record<string, Record<string, string>>>(SESSIONS_VAULT_FILE, {});
        delete vault[accountId];
        saveJson(SESSIONS_VAULT_FILE, vault);
      }
    } catch (e) {}
    qrCodes.delete(accountId);
  }

  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  // DISASTER RECOVERY: If creds.json is missing on disk AND neither reset nor forceNewQr was requested, recover from vault or backup
  if (!resetSession && !forceNewQr && !fs.existsSync(path.join(sessionDir, 'creds.json'))) {
    const vault = loadJson<Record<string, Record<string, string>>>(SESSIONS_VAULT_FILE, {});
    if (vault[accountId] && vault[accountId]['creds.json']) {
      console.log(`[Baileys Recovery] Recovering session keys from persistent vault for ${accountId}...`);
      importSessionKeys(accountId, vault[accountId]);
    } else if (fs.existsSync(path.join(backupDir, 'creds.json'))) {
      console.log(`[Baileys Recovery] Recovering session keys from backup directory for ${accountId}...`);
      const backupFiles = fs.readdirSync(backupDir);
      for (const bf of backupFiles) {
        fs.copyFileSync(path.join(backupDir, bf), path.join(sessionDir, bf));
      }
    }
  }

  connectionStatuses.set(accountId, 'CONNECTING');
  connectionErrors.delete(accountId);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  let version: [number, number, number] = [2, 3000, 1043857760];
  try {
    const vRes = await fetchLatestBaileysVersion();
    if (vRes?.version) version = vRes.version;
  } catch (vErr: any) {
    console.warn(`[Baileys Version Warning] Could not fetch latest version (${vErr.message}). Using stable fallback.`);
  }

  console.log(`[Baileys Real] Initializing real WhatsApp socket for ${accountId} (Baileys v${version.join('.')})`);

  // WhatsApp Web Chrome Ubuntu profile - official multi-month persistent web socket pairing
  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    connectTimeoutMs: 90000,
    keepAliveIntervalMs: 15000,
    defaultQueryTimeoutMs: 120000,
    mediaUploadTimeoutMs: 300000, // 5 minutes upload timeout for large videos & rich attachments
    options: {},
    getMessage: async (_key: any) => {
      return {
        conversation: 'YUHUSULU CRM active heartbeat'
      };
    },
    markOnlineOnConnect: true,
    syncFullHistory: false, // Prevents giant history sync drops and crashes
    retryRequestDelayMs: 1000,
    generateHighQualityLinkPreview: true
  } as any);

  sockets.set(accountId, sock);

  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
      persistSessionToVault(accountId);
      console.log(`[Baileys Real] Successfully persisted WhatsApp Multi-Device credentials & vault to disk for ${accountId}`);
    } catch (err: any) {
      console.error(`[Baileys Real] Failed to persist credentials for ${accountId}:`, err.message);
    }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(`[Baileys Real] Real WhatsApp QR received for ${accountId}! Generating QR Code image...`);
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        qrCodes.set(accountId, qrDataUrl);
        connectionStatuses.set(accountId, 'SCAN_REQUIRED');
      } catch (err) {
        console.error(`Failed to generate QR data URL:`, err);
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      console.log(`[Baileys Real] Connection closed for ${accountId}, statusCode: ${statusCode}, isLoggedOut: ${isLoggedOut}`);

      qrCodes.delete(accountId);
      sockets.delete(accountId);

      if (isLoggedOut) {
        // WhatsApp returned 401 challenge (often transient on network handoffs)
        const attempts = (reconnectAttempts.get(accountId) || 0) + 1;
        reconnectAttempts.set(accountId, attempts);

        if (attempts <= 5) {
          const delayTime = attempts * 3000;
          console.log(`[Baileys Real] 401 challenge received for ${accountId}. Retrying connection attempt ${attempts}/5 in ${delayTime / 1000}s...`);
          connectionStatuses.set(accountId, 'CONNECTING');
          setTimeout(() => {
            initBaileysAccount(accountId, accountName).catch(console.error);
          }, delayTime);
          return;
        }

        console.log(`[Baileys Real] Account ${accountId} logged out by WhatsApp after 5 retries. Session preserved in vault.`);
        connectionStatuses.set(accountId, 'DISCONNECTED');
        const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
        const idx = accounts.findIndex(a => a.id === accountId);
        if (idx !== -1) {
          accounts[idx].status = 'DISCONNECTED';
          saveJson(ACCOUNTS_FILE, accounts);
        }
      } else {
        reconnectAttempts.delete(accountId);
        // Normal transient network disconnect / socket drop / 515 restartRequired after scanning QR
        console.log(`[Baileys Real] Reconnecting socket for ${accountId} (code ${statusCode})...`);
        connectionStatuses.set(accountId, 'CONNECTING');
        const reconnectDelay = statusCode === DisconnectReason.restartRequired ? 1000 : 3000;
        setTimeout(() => {
          initBaileysAccount(accountId, accountName).catch(console.error);
        }, reconnectDelay);
      }
    } else if (connection === 'open') {
      reconnectAttempts.delete(accountId);
      persistSessionToVault(accountId);
      console.log(`[Baileys Real] CONNECTED SUCCESSFULLY! Account ${accountId} is now linked!`);
      connectionStatuses.set(accountId, 'CONNECTED');
      qrCodes.delete(accountId);

      const user = sock.user;
      const rawPhone = user?.id ? user.id.split(':')[0] : '';
      const formattedPhone = rawPhone ? `+${rawPhone}` : '';
      const userName = user?.name || accountName;

      // Update in storage and ensure status is CONNECTED
      const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
      const idx = accounts.findIndex(a => a.id === accountId);
      const now = new Date().toISOString().replace('T', ' ').substr(0, 19);

      if (idx !== -1) {
        accounts[idx].status = 'CONNECTED';
        accounts[idx].phoneNumber = formattedPhone || accounts[idx].phoneNumber;
        accounts[idx].name = userName || accounts[idx].name;
        accounts[idx].lastConnectedAt = now;
      } else {
        accounts.push({
          id: accountId,
          name: userName,
          phoneNumber: formattedPhone,
          status: 'CONNECTED',
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
    }
  });

  // Handle incoming messages for Auto-Responder
  sock.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        if (!msg.key.fromMe && msg.message) {
          const from = msg.key.remoteJid;
          const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
          if (!body || !from || from.endsWith('@g.us')) continue;

          console.log(`[Baileys Incoming] Received real message on ${accountId} from ${from}: "${body}"`);

          const rules = loadJson<any[]>(RULES_FILE, []);
          const lowerBody = body.toLowerCase().trim();

          const matchedRule = rules.find((rule: any) => {
            if (!rule.isEnabled) return false;
            const kw = (rule.keyword || '').toLowerCase().trim();
            if (rule.matchType === 'exact') return lowerBody === kw;
            if (rule.matchType === 'contains') return lowerBody.includes(kw);
            if (rule.matchType === 'regex') {
              try { return new RegExp(rule.keyword, 'i').test(body); } catch { return false; }
            }
            return false;
          });

          if (matchedRule) {
            console.log(`[Auto-Responder] Rule matched: "${matchedRule.name}". Replying to ${from}...`);
            await sock.sendPresenceUpdate('composing', from);
            await delay((matchedRule.typingDelaySeconds || 3) * 1000);
            await sock.sendPresenceUpdate('paused', from);
            await sock.sendMessage(from, { text: matchedRule.replyMessage });
          }
        }
      }
    }
  });

  return sock;
}

// -------------------------------------------------------------
// CAMPAIGN EXECUTION ENGINE
// -------------------------------------------------------------
interface CampaignRunnerState {
  isPaused: boolean;
  isStopped: boolean;
  currentContactIndex: number;
  batchCounter: number;
  senderPointer: number;
}
const activeCampaignControllers = new Map<string, CampaignRunnerState>();

async function executeRealCampaign(campaignId: string) {
  const campaigns = loadJson<any[]>(CAMPAIGNS_FILE, []);
  const campaign = campaigns.find(c => c.id === campaignId);
  if (!campaign) return;

  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  let connectedAccounts = accounts.filter(a => campaign.senderAccountIds?.includes(a.id) && connectionStatuses.get(a.id) === 'CONNECTED');

  if (connectedAccounts.length === 0) {
    // Automatic fallback: use any account that is actively connected or has a live socket
    connectedAccounts = accounts.filter(a => connectionStatuses.get(a.id) === 'CONNECTED' || sockets.has(a.id));
  }

  if (connectedAccounts.length === 0) {
    console.error(`[Campaign Error] No real connected WhatsApp accounts found for campaign ${campaignId}`);
    campaign.status = 'failed';
    saveJson(CAMPAIGNS_FILE, campaigns);
    return;
  }

  campaign.status = 'running';
  saveJson(CAMPAIGNS_FILE, campaigns);

  const state: CampaignRunnerState = {
    isPaused: false,
    isStopped: false,
    currentContactIndex: campaign.stats?.sent || 0,
    batchCounter: campaign.stats?.currentBatchCount || 0,
    senderPointer: campaign.stats?.currentSenderIndex || 0,
  };
  activeCampaignControllers.set(campaignId, state);

  console.log(`[Campaign Started] "${campaign.name}" with ${campaign.contacts.length} recipients`);

  const contacts = campaign.contacts;
  const templates = campaign.templates;

  for (let i = state.currentContactIndex; i < contacts.length; i++) {
    const ctrl = activeCampaignControllers.get(campaignId);
    if (!ctrl || ctrl.isStopped) {
      campaign.status = 'cancelled';
      saveJson(CAMPAIGNS_FILE, campaigns);
      break;
    }

    while (ctrl.isPaused) {
      await delay(1500);
    }

    const contact = contacts[i];

    // 0. STOP NUMBERS GUARD (Opt-Out Protection)
    const stopCheck = isStopNumber(contact.phoneNumber);
    if (stopCheck.isStopped || contact.status === 'stopped') {
      console.log(`[Campaign Stop Guard] Skipping ${contact.phoneNumber}: In Stop Numbers list (${stopCheck.reason || 'Opt-Out'}).`);
      contact.status = 'stopped';

      const now = new Date();
      const timeStr = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;
      const logs = loadJson<any[]>(LOGS_FILE, []);
      logs.unshift({
        id: `log_${Date.now()}_${i}`,
        campaignId: campaign.id,
        campaignName: campaign.name,
        timestamp: timeStr,
        recipientPhone: contact.phoneNumber,
        recipientName: contact.name,
        senderPhone: 'BLOCKED',
        senderName: 'Stop List (Opt-Out Protection)',
        templateId: 'BLOCKED',
        resolvedMessage: `[BLOCKED - NO MESSAGE SENT] Recipient is in Stop Numbers list (${stopCheck.reason || 'Opt-Out'})`,
        delayAppliedSeconds: 0,
        hasWhatsApp: true,
        status: 'STOPPED',
        postAttachment: '',
        errorMessage: `Skipped: Number is in Stop Numbers list (${stopCheck.reason || 'Opt-Out'})`
      });
      saveJson(LOGS_FILE, logs);

      state.currentContactIndex = i + 1;
      campaign.stats = {
        ...campaign.stats,
        total: contacts.length,
        sent: campaign.stats?.delivered || 0, // Never count blocked stop numbers as sent!
        stoppedCount: (campaign.stats?.stoppedCount || 0) + 1
      };
      saveJson(CAMPAIGNS_FILE, campaigns);
      continue;
    }

    // 1. SENDER ROTATION: Round-robin across connected Baileys sockets
    const sender = connectedAccounts[ctrl.senderPointer % connectedAccounts.length];
    ctrl.senderPointer++;

    const sock = sockets.get(sender.id);
    if (!sock) {
      console.error(`Socket for sender ${sender.id} not available.`);
      continue;
    }

    // 2. TEMPLATE ROTATION: Random selection
    const template = templates[Math.floor(Math.random() * templates.length)];

    // 3. Spintax & Personalization variables
    let messageText = resolveSpintax(template.content);
    messageText = replaceVariables(messageText, {
      name: contact.name || 'Friend',
      company: contact.company || 'your team',
      phone: contact.phoneNumber,
      custom1: contact.customVar1,
      custom2: contact.customVar2
    });

    const cleanDigits = normalizeWhatsAppNumber(contact.phoneNumber);
    const targetJid = formatToJid(contact.phoneNumber);
    let verifiedJid = targetJid;
    const typingSeconds = campaign.timings.typingDelaySeconds || 3;
    const postAttachment = template.fileName || '';

    // 1. VERIFY REAL WHATSAPP PRESENCE with safe timeout
    let isRegisteredOnWhatsApp = true;
    try {
      if (sock.onWhatsApp && cleanDigits.length >= 7) {
        const presenceQuery = sock.onWhatsApp(cleanDigits);
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 4000));
        const checkResults = await Promise.race([presenceQuery, timeoutPromise]) as any;
        if (Array.isArray(checkResults) && checkResults.length > 0) {
          isRegisteredOnWhatsApp = Boolean(checkResults[0]?.exists);
          if (checkResults[0]?.jid) verifiedJid = checkResults[0].jid;
        }
      }
    } catch (checkErr: any) {
      console.log(`[Presence Check Note] Could not query presence for ${cleanDigits}:`, checkErr.message);
    }

    const now = new Date();
    const timeStr = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;

    // IF NOT ON WHATSAPP: MARK AND RECORD AUDIT LOG IMMEDIATELY
    if (!isRegisteredOnWhatsApp) {
      console.log(`[WhatsApp Verification] ${contact.phoneNumber} is NOT registered on WhatsApp. Flagging as NO_WHATSAPP.`);
      contact.status = 'no_whatsapp';
      contact.hasWhatsApp = false;

      const logs = loadJson<any[]>(LOGS_FILE, []);
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
        status: 'NO_WHATSAPP',
        postAttachment: postAttachment,
        errorMessage: 'Number does not have an active WhatsApp account'
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

      // Brief pause before next verification
      await delay(1200);
      continue;
    }

    // IF REGISTERED: PROCEED TO SEND REAL MESSAGE
    try {
      console.log(`[Baileys Send] Verified on WhatsApp! Sending real message to ${verifiedJid} via ${sender.name} (${sender.phoneNumber})...`);

      // Simulate human typing presence
      await sock.sendPresenceUpdate('composing', verifiedJid);
      await delay(typingSeconds * 1000);
      await sock.sendPresenceUpdate('paused', verifiedJid);

      // Real WhatsApp message dispatch (with image or document attachment support)
      const messagePayload = prepareMediaPayload(template, messageText);
      await sock.sendMessage(verifiedJid, messagePayload);

      contact.status = 'sent';
      contact.hasWhatsApp = true;

      // Save delivery log
      const logs = loadJson<any[]>(LOGS_FILE, []);
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
        status: 'DELIVERED',
        postAttachment: postAttachment,
        errorMessage: ''
      });
      saveJson(LOGS_FILE, logs);

      // Update sender metrics
      sender.dailySentCount = (sender.dailySentCount || 0) + 1;
      sender.totalDelivered = (sender.totalDelivered || 0) + 1;
      saveJson(ACCOUNTS_FILE, accounts);

      ctrl.batchCounter++;
      state.currentContactIndex = i + 1;

      // Update campaign stats
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

    } catch (sendErr: any) {
      console.error(`[Send Error] Failed to send to ${contact.phoneNumber}:`, sendErr.message);
      contact.status = 'failed';
      const logs = loadJson<any[]>(LOGS_FILE, []);
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
        status: 'FAILED',
        postAttachment: postAttachment,
        errorMessage: sendErr.message || 'Dispatch failure'
      });
      saveJson(LOGS_FILE, logs);
    }

    // 4. BATCH BREAK OR DYNAMIC INTER-MESSAGE DELAY
    if (ctrl.batchCounter >= campaign.timings.batchSize && i < contacts.length - 1) {
      console.log(`[Batch Cooldown] Reached ${campaign.timings.batchSize} messages. Cooling down for ${campaign.timings.breakDurationSeconds}s...`);
      ctrl.batchCounter = 0;
      await delay(campaign.timings.breakDurationSeconds * 1000);
    } else if (i < contacts.length - 1) {
      const waitSec = getRandomInt(campaign.timings.minDelaySeconds, campaign.timings.maxDelaySeconds);
      console.log(`[Dynamic Delay] Sleeping ${waitSec}s before next contact...`);
      await delay(waitSec * 1000);
    }
  }

  campaign.status = 'completed';
  saveJson(CAMPAIGNS_FILE, campaigns);
  activeCampaignControllers.delete(campaignId);
  console.log(`[Campaign Completed] "${campaign.name}" finished all dispatches.`);
}

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// Accounts List - Strictly verified against live Baileys WebSocket state
app.get('/api/accounts', (req, res) => {
  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  const vault = loadJson<Record<string, Record<string, string>>>(SESSIONS_VAULT_FILE, {});
  const enriched = accounts.map(acc => {
    const sessionDir = path.join(SESSIONS_DIR, `session_${acc.id}`);
    const credsExist = fs.existsSync(path.join(sessionDir, 'creds.json'));
    const vaultExist = Boolean(vault[acc.id] && vault[acc.id]['creds.json']);
    const hasKeys = credsExist || vaultExist;

    const sock = sockets.get(acc.id);
    const liveStatus = connectionStatuses.get(acc.id);
    const isSocketOpen = Boolean(sock && (sock as any).ws?.readyState === 1);
    const hasUserJid = Boolean(sock?.user?.id);
    const isGenuinelyConnected = isAccountGenuinelyConnected(acc.id);

    let status: 'CONNECTED' | 'CONNECTING' | 'SCAN_REQUIRED' | 'DISCONNECTED' = 'DISCONNECTED';
    if (isGenuinelyConnected) {
      status = 'CONNECTED';
    } else if (liveStatus === 'CONNECTING') {
      status = 'CONNECTING';
    } else if (liveStatus === 'SCAN_REQUIRED' || qrCodes.has(acc.id)) {
      status = 'SCAN_REQUIRED';
    } else if (hasKeys) {
      status = 'DISCONNECTED';
    } else {
      status = 'SCAN_REQUIRED';
    }

    const livePhone = hasUserJid ? `+${sock!.user!.id.split(':')[0]}` : acc.phoneNumber;
    const liveName = sock?.user?.name || acc.name;

    return {
      ...acc,
      name: liveName,
      phoneNumber: livePhone,
      status,
      isRealSocketAlive: isSocketOpen,
      userJid: sock?.user?.id || null,
      sessionSavedOnDisk: credsExist,
      vaultSaved: hasKeys
    };
  });
  res.json(enriched);
});

// Initialize / Connect Account & Start Real Baileys Handshake
app.post('/api/accounts/create', async (req, res) => {
  const { name = 'WhatsApp Node', phoneNumber = '' } = req.body;
  const id = `acc_${Date.now().toString(36)}`;

  // Ensure new account is removed from deleted blacklist
  const DELETED_ACCOUNTS_FILE = path.join(DATA_DIR, 'deleted_accounts.json');
  const deletedIds = loadJson<string[]>(DELETED_ACCOUNTS_FILE, []);
  if (deletedIds.includes(id)) {
    saveJson(DELETED_ACCOUNTS_FILE, deletedIds.filter(d => d !== id));
  }

  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  const newAccount = {
    id,
    name,
    phoneNumber,
    status: 'SCAN_REQUIRED',
    sessionPath: `./sessions/session_${id}`,
    battery: 100,
    dailySentCount: 0,
    dailyLimit: 300,
    warmupEnabled: true,
    totalDelivered: 0,
    lastConnectedAt: ''
  };
  accounts.push(newAccount);
  saveJson(ACCOUNTS_FILE, accounts);

  // Trigger real Baileys connection to generate initial QR code
  initBaileysAccount(id, name, true).catch(err => {
    console.error(`Error initializing Baileys for ${id}:`, err);
  });

  res.json({ success: true, account: newAccount });
});

// Get Live QR Code & Real Connection Status for Account
app.get('/api/accounts/qr/:id', (req, res) => {
  const { id } = req.params;
  const qr = qrCodes.get(id) || null;
  const sock = sockets.get(id);
  const liveStatus = connectionStatuses.get(id);
  const isSocketOpen = Boolean(sock && (sock as any).ws?.readyState === 1);
  const hasUserJid = Boolean(sock?.user?.id);
  const isGenuinelyConnected = isAccountGenuinelyConnected(id);

  let status: 'CONNECTED' | 'CONNECTING' | 'SCAN_REQUIRED' | 'DISCONNECTED' = 'DISCONNECTED';
  if (isGenuinelyConnected) {
    status = 'CONNECTED';
  } else if (liveStatus === 'CONNECTING') {
    status = 'CONNECTING';
  } else if (liveStatus === 'SCAN_REQUIRED' || qr) {
    status = 'SCAN_REQUIRED';
  } else {
    status = 'DISCONNECTED';
  }

  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  const acc = accounts.find(a => a.id === id);

  res.json({
    qr,
    status,
    isSocketOpen,
    userJid: sock?.user?.id || null,
    error: connectionErrors.get(id) || null,
    account: acc ? {
      ...acc,
      status,
      phoneNumber: hasUserJid ? `+${sock!.user!.id.split(':')[0]}` : acc.phoneNumber
    } : null
  });
});

// Reconnect an existing session (Preserves all credentials and resumes WebSocket seamlessly)
app.post('/api/accounts/reconnect/:id', async (req, res) => {
  const { id } = req.params;
  const forceNewQr = req.query.forceNewQr === 'true' || req.body?.forceNewQr === true;
  const resetSession = req.query.reset === 'true' || req.body?.reset === true;
  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  const acc = accounts.find(a => a.id === id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });

  console.log(`[Baileys Reconnect] Resuming session for account ${id} (${acc.name}). ForceNewQr: ${forceNewQr}, Reset: ${resetSession}`);
  await initBaileysAccount(id, acc.name, forceNewQr, resetSession);
  res.json({ success: true, status: 'CONNECTING' });
});

// Explicit Reset / Unlink Account Endpoint
app.post('/api/accounts/reset/:id', async (req, res) => {
  const { id } = req.params;
  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  const acc = accounts.find(a => a.id === id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });

  console.log(`[Baileys Reset] User explicitly requested to reset & unlink session for ${id} (${acc.name})`);
  await initBaileysAccount(id, acc.name, true, true);
  res.json({ success: true, status: 'SCAN_REQUIRED', message: 'Session reset. Ready for new QR scan.' });
});

// -------------------------------------------------------------
// SESSION VAULT ENDPOINTS (Multi-Month Persistence & Backup)
// -------------------------------------------------------------

// 1. Get Session Vault Backup for Client-Side Sync
app.get('/api/accounts/vault/:id', (req, res) => {
  const { id } = req.params;
  let keys = exportSessionKeys(id);
  if (!keys) {
    const vault = loadJson<Record<string, Record<string, string>>>(SESSIONS_VAULT_FILE, {});
    keys = vault[id] || null;
  }
  if (!keys) {
    return res.status(404).json({ error: 'No saved session keys found for this account' });
  }
  res.json({ success: true, accountId: id, keys, keyCount: Object.keys(keys).length });
});

// 2. Restore Session Vault from Client-Side Backup (Instant Auto-Reconnect without QR)
app.post('/api/accounts/vault/:id', async (req, res) => {
  const { id } = req.params;
  const { keys } = req.body;
  if (!keys || !keys['creds.json']) {
    return res.status(400).json({ error: 'Invalid session keys bundle. Missing creds.json' });
  }

  const success = importSessionKeys(id, keys);
  if (!success) {
    return res.status(500).json({ error: 'Failed to write session keys to disk' });
  }

  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  const acc = accounts.find(a => a.id === id);
  const accountName = acc?.name || 'WhatsApp Node';

  // Automatically reconnect the restored session
  initBaileysAccount(id, accountName).catch(err => {
    console.error(`Error connecting restored session ${id}:`, err);
  });

  res.json({ success: true, status: 'CONNECTING', message: 'Session keys restored from vault successfully' });
});

// 3. Export Downloadable Backup File for Permanent Cold Storage
app.get('/api/accounts/export-backup/:id', (req, res) => {
  const { id } = req.params;
  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  const acc = accounts.find(a => a.id === id);
  let keys = exportSessionKeys(id);
  if (!keys) {
    const vault = loadJson<Record<string, Record<string, string>>>(SESSIONS_VAULT_FILE, {});
    keys = vault[id] || null;
  }
  if (!keys) {
    return res.status(404).json({ error: 'No session keys available to export for this account' });
  }

  const payload = {
    app: 'YUHUSULU CRM',
    version: '1.0',
    accountId: id,
    accountName: acc?.name || 'WhatsApp Account',
    phoneNumber: acc?.phoneNumber || '',
    exportedAt: new Date().toISOString(),
    keys
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="yuhusulu_session_${acc?.phoneNumber ? acc.phoneNumber.replace(/\D/g, '') : id}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

// 4. Import Backup File to Link Device without QR scan
app.post('/api/accounts/import-backup', async (req, res) => {
  try {
    const { accountId, accountName, phoneNumber, keys } = req.body;
    if (!keys || !keys['creds.json']) {
      return res.status(400).json({ error: 'Invalid backup file. Missing WhatsApp credentials.' });
    }

    const targetId = accountId || `acc_${Date.now().toString(36)}`;
    const targetName = accountName || 'Imported WhatsApp Node';

    importSessionKeys(targetId, keys);

    const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
    let idx = accounts.findIndex(a => a.id === targetId);
    const now = new Date().toISOString().replace('T', ' ').substr(0, 19);

    if (idx === -1) {
      accounts.unshift({
        id: targetId,
        name: targetName,
        phoneNumber: phoneNumber || '',
        status: 'CONNECTING',
        sessionPath: `./sessions/session_${targetId}`,
        battery: 100,
        dailySentCount: 0,
        dailyLimit: 300,
        warmupEnabled: true,
        totalDelivered: 0,
        lastConnectedAt: now
      });
    } else {
      accounts[idx].status = 'CONNECTING';
    }
    saveJson(ACCOUNTS_FILE, accounts);

    initBaileysAccount(targetId, targetName).catch(err => {
      console.error(`Error connecting imported session ${targetId}:`, err);
    });

    res.json({ success: true, accountId: targetId, status: 'CONNECTING' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to import session backup' });
  }
});

// 5. Export ALL Accounts and All Session Keys in One Master Backup File
app.get('/api/accounts/export-all-backup', (req, res) => {
  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  const vault = loadJson<Record<string, Record<string, string>>>(SESSIONS_VAULT_FILE, {});

  // Collect session keys for each account
  const accountsBundle = accounts.map(acc => {
    let keys = exportSessionKeys(acc.id) || vault[acc.id] || null;
    return {
      id: acc.id,
      name: acc.name,
      phoneNumber: acc.phoneNumber,
      dailyLimit: acc.dailyLimit,
      warmupEnabled: acc.warmupEnabled,
      hasKeys: Boolean(keys && keys['creds.json']),
      keys
    };
  });

  const payload = {
    app: 'YUHUSULU CRM MASTER VAULT',
    exportedAt: new Date().toISOString(),
    accountCount: accounts.length,
    accounts: accountsBundle
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="yuhusulu_all_accounts_master_backup.json"');
  res.send(JSON.stringify(payload, null, 2));
});

// 5b. Download Complete Hostinger Deployment Package (Pre-compiled Zip)
app.get('/api/system/download-hostinger-zip', (_req, res) => {
  const zipPath = path.resolve('./public/downloads/yuhusulu_whatsapp_crm_hostinger.zip');
  if (!fs.existsSync(zipPath)) {
    try {
      execSync('python3 scripts/package_hostinger.py', { stdio: 'inherit' });
    } catch (err: any) {
      console.error('[Hostinger Packager Error]:', err);
    }
  }

  if (fs.existsSync(zipPath)) {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="yuhusulu_whatsapp_crm_hostinger.zip"');
    return res.sendFile(zipPath);
  }
  return res.status(500).json({ error: 'Could not find or generate Hostinger package' });
});

// 5c. Download Complete Railway/Render Cloud Deployment Package
app.get('/api/system/download-cloud-zip', (_req, res) => {
  const zipPath = path.resolve('./public/downloads/yuhusulu_whatsapp_crm_cloud.zip');
  if (!fs.existsSync(zipPath)) {
    try {
      execSync('python3 scripts/package_hostinger.py', { stdio: 'inherit' });
    } catch (err: any) {
      console.error('[Cloud Packager Error]:', err);
    }
  }

  if (fs.existsSync(zipPath)) {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="yuhusulu_whatsapp_crm_cloud.zip"');
    return res.sendFile(zipPath);
  }
  return res.status(500).json({ error: 'Could not find or generate Cloud package' });
});

// 6. Restore Master Backup File (Restores All Accounts & Links WebSockets without QR)
app.post('/api/accounts/import-all-backup', async (req, res) => {
  try {
    const { accounts: importedAccounts, isAutoRecovery = false, forceManualImport = false } = req.body;
    if (!Array.isArray(importedAccounts) || importedAccounts.length === 0) {
      return res.status(400).json({ error: 'Invalid master backup file. No accounts found.' });
    }

    const DELETED_ACCOUNTS_FILE = path.join(DATA_DIR, 'deleted_accounts.json');
    let deletedIds = loadJson<string[]>(DELETED_ACCOUNTS_FILE, []);

    // If manual user import, un-blacklist these accounts
    if (forceManualImport) {
      deletedIds = deletedIds.filter(dId => !importedAccounts.some(a => a.id === dId));
      saveJson(DELETED_ACCOUNTS_FILE, deletedIds);
    }

    // Filter out deleted accounts if this is auto recovery
    const accountsToProcess = isAutoRecovery
      ? importedAccounts.filter(a => !deletedIds.includes(a.id))
      : importedAccounts;

    const currentAccounts = loadJson<any[]>(ACCOUNTS_FILE, []);
    let restoredCount = 0;

    for (const item of accountsToProcess) {
      if (item.id && item.keys && item.keys['creds.json']) {
        importSessionKeys(item.id, item.keys);
        restoredCount++;

        const idx = currentAccounts.findIndex(a => a.id === item.id);
        const now = new Date().toISOString().replace('T', ' ').substr(0, 19);

        if (idx === -1) {
          currentAccounts.push({
            id: item.id,
            name: item.name || 'Restored WhatsApp Account',
            phoneNumber: item.phoneNumber || '',
            status: 'CONNECTING',
            sessionPath: `./sessions/session_${item.id}`,
            battery: 100,
            dailySentCount: 0,
            dailyLimit: item.dailyLimit || 300,
            warmupEnabled: item.warmupEnabled ?? true,
            totalDelivered: 0,
            lastConnectedAt: now
          });
        } else {
          currentAccounts[idx].status = 'CONNECTING';
          if (item.phoneNumber) currentAccounts[idx].phoneNumber = item.phoneNumber;
        }

        initBaileysAccount(item.id, item.name || 'WhatsApp Node').catch(err => {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to import master backup' });
  }
});

// Disconnect / Delete Account Permanently
app.delete('/api/accounts/:id', (req, res) => {
  const { id } = req.params;
  const sock = sockets.get(id);
  if (sock) {
    try { sock.end(undefined); } catch (e) {}
    sockets.delete(id);
  }
  qrCodes.delete(id);
  connectionStatuses.delete(id);
  reconnectAttempts.delete(id);

  const sessionDir = path.join(SESSIONS_DIR, `session_${id}`);
  try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) {}

  const backupDir = path.join(DATA_DIR, 'session_backups', id);
  try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch (e) {}

  // Also remove from permanent vault
  const vault = loadJson<Record<string, Record<string, string>>>(SESSIONS_VAULT_FILE, {});
  delete vault[id];
  saveJson(SESSIONS_VAULT_FILE, vault);

  // Blacklist in DELETED_ACCOUNTS_FILE so disaster recovery NEVER auto-restores it
  const DELETED_ACCOUNTS_FILE = path.join(DATA_DIR, 'deleted_accounts.json');
  const deletedIds = loadJson<string[]>(DELETED_ACCOUNTS_FILE, []);
  if (!deletedIds.includes(id)) {
    deletedIds.push(id);
    saveJson(DELETED_ACCOUNTS_FILE, deletedIds);
  }

  let accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  accounts = accounts.filter(a => a.id !== id);
  saveJson(ACCOUNTS_FILE, accounts);

  console.log(`[Account Delete] Account ${id} permanently deleted. Removed from memory, disk, vault, and backups.`);
  res.json({ success: true, deletedId: id });
});

// -------------------------------------------------------------
// STOP NUMBERS (BLACKLIST / OPT-OUT) ENDPOINTS
// -------------------------------------------------------------
app.get('/api/stop-numbers', (_req, res) => {
  const list = loadJson<any[]>(STOP_NUMBERS_FILE, []);
  res.json({ success: true, stopNumbers: list });
});

app.post('/api/stop-numbers', (req, res) => {
  const { numbers, phone, reason = 'Opt-Out (STOP requested)' } = req.body;
  let list = loadJson<any[]>(STOP_NUMBERS_FILE, []);

  const rawList: string[] = [];
  if (Array.isArray(numbers)) {
    rawList.push(...numbers);
  } else if (typeof numbers === 'string') {
    const tokens = numbers.split(/[\r\n,;\s]+/).map(t => t.trim()).filter(Boolean);
    rawList.push(...tokens);
  } else if (phone) {
    rawList.push(phone);
  }

  let addedCount = 0;
  for (const raw of rawList) {
    const norm = normalizeWhatsAppNumber(raw);
    if (!norm) continue;
    if (!list.some(item => item.normalizedPhone === norm)) {
      list.push({
        id: `stop_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        phoneNumber: raw,
        normalizedPhone: norm,
        reason,
        addedAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
      });
      addedCount++;
    }
  }

  saveJson(STOP_NUMBERS_FILE, list);
  console.log(`[Stop Numbers] Added ${addedCount} numbers. Total active stop numbers: ${list.length}`);
  res.json({ success: true, addedCount, total: list.length, stopNumbers: list });
});

app.delete('/api/stop-numbers/:id', (req, res) => {
  const { id } = req.params;
  let list = loadJson<any[]>(STOP_NUMBERS_FILE, []);
  list = list.filter(item => item.id !== id && item.normalizedPhone !== id && item.phoneNumber !== id);
  saveJson(STOP_NUMBERS_FILE, list);
  res.json({ success: true, total: list.length, stopNumbers: list });
});

app.post('/api/stop-numbers/clear', (_req, res) => {
  saveJson(STOP_NUMBERS_FILE, []);
  console.log('[Stop Numbers] Cleared all stop numbers.');
  res.json({ success: true, stopNumbers: [] });
});

// 1. Chunked Upload Endpoint (Accepts 4MB slices to bypass proxy payload limits)
app.post('/api/upload/chunk', (req, res) => {
  chunkUpload.single('chunk')(req, res, (err: any) => {
    if (err) {
      console.error('[Chunk Upload Error]:', err);
      return res.status(400).json({ error: err.message || 'Chunk upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No chunk file received' });
    }
    res.json({ success: true, chunkIndex: req.body.chunkIndex });
  });
});

// 2. Chunk Assembly & Completion Endpoint
app.post('/api/upload/complete', async (req, res) => {
  try {
    const { uploadId, fileName, totalChunks, originalSize, mimeType } = req.body;
    if (!uploadId || !fileName || !totalChunks) {
      return res.status(400).json({ error: 'Missing upload assembly parameters' });
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
      try { fs.unlinkSync(chunkPath); } catch (e) {}
    }
    writeStream.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', () => resolve(null));
      writeStream.on('error', reject);
    });

    const isVideo = (mimeType && mimeType.startsWith('video/')) || ['.mp4', '.mov', '.mkv', '.3gp', '.avi', '.webm'].includes(ext);
    const isImage = (mimeType && mimeType.startsWith('image/')) || ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
    const mediaType = isVideo ? 'video' : isImage ? 'image' : 'document';

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
      mimeType: isVideo ? 'video/mp4' : (mimeType || 'application/octet-stream'),
      mediaType,
      size: finalSize,
      originalSize: originalSize || fs.statSync(finalPath).size,
      compressed: wasCompressed
    });
  } catch (err: any) {
    console.error('[Chunk Assembly Error]:', err);
    res.status(500).json({ error: err.message || 'Failed to assemble uploaded file' });
  }
});

// 3. Direct Media Upload Endpoint (Fallback with safe JSON error handling)
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (err: any) => {
    if (err) {
      console.error('[Direct Upload Error]:', err);
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file received' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const isVideo = req.file.mimetype.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.3gp', '.avi', '.webm'].includes(ext);
    const isImage = req.file.mimetype.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
    const mediaType = isVideo ? 'video' : isImage ? 'image' : 'document';

    let finalFilePath = req.file.path;
    let finalFileUrl = `/uploads/${req.file.filename}`;
    let finalSize = req.file.size;
    let wasCompressed = false;

    // Auto-compress & optimize videos for WhatsApp via FFmpeg (H.264/AAC faststart)
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
      mimeType: isVideo ? 'video/mp4' : req.file.mimetype,
      mediaType,
      size: finalSize,
      originalSize: req.file.size,
      compressed: wasCompressed
    });
  });
});

// 2. Send Direct WhatsApp Test Message (supports text and photo/document attachments)
app.post('/api/messages/send-test', async (req, res) => {
  const { accountId, phone, message = '', mediaUrl, filePath, fileName } = req.body;
  if (!phone || (!message && !mediaUrl && !filePath)) {
    return res.status(400).json({ error: 'Phone number and either message text or media are required' });
  }

  // 0. STOP NUMBERS GUARD: Never send to opt-out numbers
  const stopCheck = isStopNumber(phone);
  if (stopCheck.isStopped) {
    return res.status(400).json({
      error: `Cannot send: Number ${phone} is listed in Stop Numbers (Opt-Out) list (${stopCheck.reason || 'Opt-Out'})`
    });
  }

  // Find socket
  let sock = accountId ? sockets.get(accountId) : null;
  if (!sock) {
    // Pick first available connected socket
    for (const [id, s] of sockets.entries()) {
      if (connectionStatuses.get(id) === 'CONNECTED') {
        sock = s;
        break;
      }
    }
  }

  if (!sock) {
    return res.status(400).json({
      error: 'No connected WhatsApp account available. Please link your phone via QR code first!'
    });
  }

  try {
    const targetJid = formatToJid(phone);
    console.log(`[Direct Test] Sending real WhatsApp message with media to ${targetJid}...`);
    await sock.sendPresenceUpdate('composing', targetJid);
    await delay(1500);
    await sock.sendPresenceUpdate('paused', targetJid);

    const payload = prepareMediaPayload({ mediaUrl, filePath, fileName }, message);
    const sent = await sock.sendMessage(targetJid, payload);
    res.json({ success: true, messageId: sent?.key?.id || 'OK' });
  } catch (err: any) {
    console.error(`Direct test send failed:`, err);
    res.status(500).json({ error: err.message || 'Failed to send WhatsApp message' });
  }
});

// 3. Real WhatsApp Single Dispatch Endpoint for Live Campaigns & Immediate Delivery
app.post('/api/messages/send-one', async (req, res) => {
  const {
    campaignId = 'cmp_manual',
    campaignName = 'Live Campaign',
    accountId,
    contact,
    template,
    typingDelaySeconds = 2
  } = req.body;

  if (!contact || !contact.phoneNumber) {
    return res.status(400).json({ error: 'Contact phone number is required' });
  }

  const recipientPhone = contact.phoneNumber;
  const cleanDigits = normalizeWhatsAppNumber(recipientPhone);
  const targetJid = formatToJid(recipientPhone);
  let verifiedJid = targetJid;

  const now = new Date();
  const timeStr = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;

  // 0. Check Stop Numbers List (Blacklist / Opt-Out)
  const stopCheck = isStopNumber(recipientPhone);
  if (stopCheck.isStopped || contact.status === 'stopped') {
    const stopReason = stopCheck.reason || 'Opt-Out (Stop List)';
    const newLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      campaignId,
      campaignName,
      timestamp: timeStr,
      recipientPhone,
      recipientName: contact.name || '',
      senderPhone: 'BLOCKED',
      senderName: 'Stop List (Opt-Out Protection)',
      templateId: 'BLOCKED',
      resolvedMessage: `[BLOCKED - NO MESSAGE SENT] Recipient is in Stop Numbers list (${stopReason})`,
      delayAppliedSeconds: 0,
      hasWhatsApp: true,
      status: 'STOPPED',
      postAttachment: '',
      errorMessage: `Skipped: Number is in Stop Numbers list (${stopReason})`
    };
    const logs = loadJson<any[]>(LOGS_FILE, []);
    logs.unshift(newLog);
    saveJson(LOGS_FILE, logs);

    console.log(`[Stop Numbers Guard] Excluded ${recipientPhone} from campaign (Reason: ${stopReason})`);
    return res.json({
      success: false,
      status: 'STOPPED',
      isStopped: true,
      log: newLog,
      error: `Skipped: Number is in Stop Numbers list (${stopReason})`
    });
  }

  // Find socket: prioritize requested accountId, or fallback to any connected account
  let sock = accountId ? sockets.get(accountId) : null;
  let senderAcc: any = null;
  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);

  if (sock && connectionStatuses.get(accountId) === 'CONNECTED') {
    senderAcc = accounts.find(a => a.id === accountId);
  }

  if (!sock) {
    for (const acc of accounts) {
      if (sockets.has(acc.id) && connectionStatuses.get(acc.id) === 'CONNECTED') {
        sock = sockets.get(acc.id);
        senderAcc = acc;
        break;
      }
    }
  }

  if (!sock || !senderAcc || connectionStatuses.get(senderAcc.id) !== 'CONNECTED') {
    return res.status(400).json({
      success: false,
      status: 'FAILED',
      error: 'No connected WhatsApp phone found. Please link your phone via QR code in Accounts tab first!'
    });
  }

  // 1. Verify Real WhatsApp Presence with a safe 4-second timeout
  let isRegisteredOnWhatsApp = true;
  try {
    if (sock.onWhatsApp && cleanDigits.length >= 7) {
      const presenceQuery = sock.onWhatsApp(cleanDigits);
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 4000));
      const checkResults = await Promise.race([presenceQuery, timeoutPromise]) as any;
      if (Array.isArray(checkResults) && checkResults.length > 0) {
        isRegisteredOnWhatsApp = Boolean(checkResults[0]?.exists);
        if (checkResults[0]?.jid) verifiedJid = checkResults[0].jid;
      }
    }
  } catch (checkErr: any) {
    console.log(`[Presence Check Note] Error checking ${cleanDigits}:`, checkErr.message);
  }

  // If NOT on WhatsApp
  if (!isRegisteredOnWhatsApp) {
    const newLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      campaignId,
      campaignName,
      timestamp: timeStr,
      recipientPhone,
      recipientName: contact.name || '',
      senderPhone: senderAcc.phoneNumber,
      senderName: senderAcc.name,
      templateId: template?.id || 'tpl_1',
      resolvedMessage: template?.content || '',
      delayAppliedSeconds: 0,
      hasWhatsApp: false,
      status: 'NO_WHATSAPP',
      postAttachment: template?.fileName || '',
      errorMessage: 'Number does not have an active WhatsApp account'
    };
    const logs = loadJson<any[]>(LOGS_FILE, []);
    logs.unshift(newLog);
    saveJson(LOGS_FILE, logs);

    return res.json({
      success: false,
      status: 'NO_WHATSAPP',
      hasWhatsApp: false,
      log: newLog,
      error: 'Number does not have an active WhatsApp account'
    });
  }

  // 2. Resolve Spintax & Personalization variables
  let messageText = resolveSpintax(template?.content || '');
  messageText = replaceVariables(messageText, {
    name: contact.name || 'Friend',
    company: contact.company || 'your team',
    phone: recipientPhone,
    custom1: contact.customVar1,
    custom2: contact.customVar2
  });

  try {
    // 3. Human typing presence simulation
    if (typingDelaySeconds > 0) {
      await sock.sendPresenceUpdate('composing', verifiedJid);
      await delay(typingDelaySeconds * 1000);
      await sock.sendPresenceUpdate('paused', verifiedJid);
    }

    // 4. Send Real WhatsApp message with photo/video/document/text
    const payload = prepareMediaPayload(template, messageText);
    const sent = await sock.sendMessage(verifiedJid, payload);

    // 5. Record Success Delivery Log
    const newLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      campaignId,
      campaignName,
      timestamp: timeStr,
      recipientPhone,
      recipientName: contact.name || '',
      senderPhone: senderAcc.phoneNumber,
      senderName: senderAcc.name,
      templateId: template?.id || 'tpl_1',
      resolvedMessage: messageText,
      delayAppliedSeconds: typingDelaySeconds,
      hasWhatsApp: true,
      status: 'DELIVERED',
      postAttachment: template?.fileName || '',
      errorMessage: ''
    };
    const logs = loadJson<any[]>(LOGS_FILE, []);
    logs.unshift(newLog);
    saveJson(LOGS_FILE, logs);

    // Update sender account metrics
    senderAcc.dailySentCount = (senderAcc.dailySentCount || 0) + 1;
    senderAcc.totalDelivered = (senderAcc.totalDelivered || 0) + 1;
    saveJson(ACCOUNTS_FILE, accounts);

    return res.json({
      success: true,
      status: 'DELIVERED',
      hasWhatsApp: true,
      messageId: sent?.key?.id || 'OK',
      senderPhone: senderAcc.phoneNumber,
      senderName: senderAcc.name,
      log: newLog
    });
  } catch (sendErr: any) {
    console.error(`[Send-One Error] Failed sending to ${recipientPhone}:`, sendErr.message);
    const newLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      campaignId,
      campaignName,
      timestamp: timeStr,
      recipientPhone,
      recipientName: contact.name || '',
      senderPhone: senderAcc.phoneNumber,
      senderName: senderAcc.name,
      templateId: template?.id || 'tpl_1',
      resolvedMessage: messageText,
      delayAppliedSeconds: 0,
      hasWhatsApp: true,
      status: 'FAILED',
      postAttachment: template?.fileName || '',
      errorMessage: sendErr.message || 'WhatsApp message dispatch failed'
    };
    const logs = loadJson<any[]>(LOGS_FILE, []);
    logs.unshift(newLog);
    saveJson(LOGS_FILE, logs);

    return res.status(500).json({
      success: false,
      status: 'FAILED',
      hasWhatsApp: true,
      log: newLog,
      error: sendErr.message || 'Failed to dispatch via WhatsApp'
    });
  }
});

// Campaigns Endpoints
app.get('/api/campaigns', (req, res) => {
  const campaigns = loadJson<any[]>(CAMPAIGNS_FILE, []);
  res.json(campaigns);
});

app.post('/api/campaigns/create', (req, res) => {
  const campaign = req.body;
  if (!campaign.id) campaign.id = `cmp_${Date.now()}`;
  const campaigns = loadJson<any[]>(CAMPAIGNS_FILE, []);
  campaigns.unshift(campaign);
  saveJson(CAMPAIGNS_FILE, campaigns);
  res.json({ success: true, campaign });
});

app.post('/api/campaigns/:id/start', async (req, res) => {
  const { id } = req.params;
  executeRealCampaign(id).catch(err => {
    console.error(`Campaign execution failed for ${id}:`, err);
  });
  res.json({ success: true, status: 'started' });
});

app.post('/api/campaigns/:id/pause', (req, res) => {
  const { id } = req.params;
  const ctrl = activeCampaignControllers.get(id);
  if (ctrl) ctrl.isPaused = true;
  res.json({ success: true, status: 'paused' });
});

app.post('/api/campaigns/:id/resume', (req, res) => {
  const { id } = req.params;
  const ctrl = activeCampaignControllers.get(id);
  if (ctrl) ctrl.isPaused = false;
  res.json({ success: true, status: 'running' });
});

app.post('/api/campaigns/:id/stop', (req, res) => {
  const { id } = req.params;
  const ctrl = activeCampaignControllers.get(id);
  if (ctrl) ctrl.isStopped = true;
  res.json({ success: true, status: 'cancelled' });
});

// Delivery Logs
app.get('/api/logs', (req, res) => {
  const logs = loadJson<any[]>(LOGS_FILE, []);
  res.json(logs);
});

// Auto-Responders
app.get('/api/auto-responders', (req, res) => {
  const rules = loadJson<any[]>(RULES_FILE, []);
  res.json(rules);
});

app.post('/api/auto-responders/save', (req, res) => {
  const rules = req.body;
  saveJson(RULES_FILE, rules);
  res.json({ success: true });
});

// -------------------------------------------------------------
// ADVANCED ANTI-BAN ACCOUNT WARM-UP ENGINE
// Features: Full-Mesh Peer Rotation, AI Dynamic Scripts, Configurable Auto-Stop
// -------------------------------------------------------------
let warmupManualRunning = false;
let warmupTimer: NodeJS.Timeout | null = null;
let warmupStopTimer: NodeJS.Timeout | null = null;
let warmupPairIndex = 0;
let warmupStartedAt: string | null = null;
let warmupDialoguesThisSession = 0;
let warmupAutoStopped = false;
let warmupAutoStopReason: string | null = null;

const WARMUP_LOGS_FILE = path.join(DATA_DIR, 'warmup_logs.json');
const WARMUP_CONFIG_FILE = path.join(DATA_DIR, 'warmup_config.json');

interface WarmupConfigState {
  autoStopMode: 'OFF' | 'DURATION' | 'DIALOGUE_LIMIT' | 'BOTH';
  stopDurationMinutes: number;
  stopDialogueLimit: number;
  scriptStyle: 'casual' | 'business' | 'sinhala_singlish' | 'office_sync' | 'custom';
  customTopicPrompt: string;
  useAiGeneration: boolean;
  scheduleEnabled: boolean;
  scheduleDays: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  scheduleStartTime: string; // "09:00"
  scheduleStopTime: string; // "17:00"
  timezone: string;
}

const DEFAULT_WARMUP_CONFIG: WarmupConfigState = {
  autoStopMode: 'BOTH',
  stopDurationMinutes: 30,
  stopDialogueLimit: 20,
  scriptStyle: 'sinhala_singlish',
  customTopicPrompt: '',
  useAiGeneration: true,
  scheduleEnabled: false,
  scheduleDays: [1, 2, 3, 4, 5],
  scheduleStartTime: '09:00',
  scheduleStopTime: '17:00',
  timezone: 'Asia/Colombo'
};

let warmupConfig: WarmupConfigState = {
  ...DEFAULT_WARMUP_CONFIG,
  ...loadJson<Partial<WarmupConfigState>>(WARMUP_CONFIG_FILE, {})
};
let scheduledWarmupActive = false;

// Rich multi-category dialogue banks for fallback & instant variation
const DYNAMIC_DIALOGUE_BANKS: Record<string, Array<[string, string]>> = {
  casual: [
    ["Hey! How's your day going so far?", "Pretty good! Just wrapping up some tasks here. How about you?"],
    ["Are you free for a quick call later today?", "Sure, I should be free around 4 PM. Let's connect then."],
    ["Did you get a chance to check that update?", "Yes, just checked it out! Looks super clean."],
    ["Thanks a lot for the quick follow up!", "Anytime! Glad I could help."],
    ["Hey, having coffee? Grab a break!", "Haha good timing, just made a cup ☕"],
    ["Can you send over that link when you have a sec?", "Sent! Check your inbox, let me know if you got it."],
    ["Hope your week has been productive!", "Yeah, busy but making solid progress 👍"],
    ["Did you manage to test the new workflow?", "Tested and running smoothly with zero issues."],
    ["Quick question - are we good for tomorrow?", "Yes, all set for tomorrow. Talk soon!"]
  ],
  sinhala_singlish: [
    ["Ado machan kohomada wada tika?", "Ela bro, wada tika shape eke yanawa. Oyata kohomada?"],
    ["Ada hawasa poddak call ekak gamuda?", "Elakiri machan, 5.30ta wage call ekak gamu."],
    ["Machan document eka ewwa balanna puluwanda?", "Hari bro, mama danma check karala kiyannam."],
    ["Supiri wada tika! Thanks support ekata.", "Ela ela machan, onama welawaka kiyanna!"],
    ["Ada meeting eka thiyenawada?", "Ow machan, 3 PM thiyenne. Link eka thiyenawada?"],
    ["Machan updates tika baluwada?", "Ow baluwa machan, okkoma hari kisima awulak na."],
    ["Suba udasanak bro!", "Suba udasanak! Ada dawasa hodata gewenna kiyala prarthana karanawa 🙏"],
    ["Wade goda daagatta neda machan?", "Ow bro, goda daagatta. Supiri!"],
    ["Kema keewada machan?", "Ow dan kewe, oya keewada? Podi break ekak gaththa."]
  ],
  business: [
    ["Hello! Could you confirm if the product invoice was received?", "Confirmed! We have received the invoice and processing it today."],
    ["Hi, do you have the updated price catalog for this month?", "Yes, I will share the PDF catalog with you right away."],
    ["Could you provide an estimated delivery timeline for our order?", "Orders dispatched today will arrive within 24 to 48 hours."],
    ["Thanks for the prompt communication regarding the shipment.", "Our pleasure! Customer satisfaction is our top priority."],
    ["We have updated the service agreement on our portal.", "Received and reviewed. The terms look great to us."],
    ["Good day! Following up on the proposal sent yesterday.", "We are discussing it with our team and will confirm by noon."]
  ],
  office_sync: [
    ["Hey team, did everyone review the sprint notes?", "Reviewed and added my comments on section 3."],
    ["Server maintenance completed successfully with 100% uptime.", "Excellent news! Thanks for the proactive monitoring."],
    ["Could you double-check the client report before release?", "Done! Verified numbers and formatting. Ready to dispatch."],
    ["Are we ready for the afternoon presentation?", "Slides are prepared and tested. We are ready to roll."],
    ["Quick reminder: Team sync starts in 15 minutes.", "Got it, hopping on the link shortly."]
  ]
};

// Generates dynamic dialogue pairs using Gemini 3.8 Flash or smart variation matrix
async function generateWarmupDialoguePair(style: string, customPrompt?: string): Promise<[string, string]> {
  // 1. Try Gemini AI generation if enabled and API key is present
  if (warmupConfig.useAiGeneration && process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI();
      const styleInstruction = style === 'sinhala_singlish'
        ? 'in natural Sinhala/Singlish spoken everyday language in Sri Lanka'
        : style === 'business'
        ? 'in polite, professional business WhatsApp customer/client tone'
        : style === 'office_sync'
        ? 'in short colleague / team office chat tone'
        : 'in casual, friendly, natural everyday WhatsApp tone';

      const prompt = `Generate a realistic 2-message WhatsApp conversation between two real people ${styleInstruction}.
${customPrompt ? `Topic/Context: "${customPrompt}"` : ''}
The first message is from Person A (10-18 words, natural, maybe an emoji).
The second message is a realistic reply from Person B (8-16 words, natural reply).
Return ONLY a valid JSON object matching this schema:
{
  "message1": "...",
  "message2": "..."
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      if (response && response.text) {
        const parsed = JSON.parse(response.text.trim());
        if (parsed.message1 && parsed.message2) {
          return [String(parsed.message1).trim(), String(parsed.message2).trim()];
        }
      }
    } catch (err: any) {
      console.warn('[Warmup AI] Gemini API dynamic generation error, using smart matrix fallback:', err.message);
    }
  }

  // 2. Smart Matrix Fallback with dynamic variations (always varied, never strictly repetitive)
  const bankKey = DYNAMIC_DIALOGUE_BANKS[style] ? style : 'casual';
  const pool = DYNAMIC_DIALOGUE_BANKS[bankKey];
  const pair = pool[Math.floor(Math.random() * pool.length)];

  // Add random realistic natural emoji or greeting variations
  const emojis = ['👍', '🙏', '😊', '☕', '🚀', '💯', '👋', ''];
  const pickedEmoji = emojis[Math.floor(Math.random() * emojis.length)];
  const m1 = pickedEmoji ? `${pair[0]} ${pickedEmoji}` : pair[0];
  const m2 = pair[1];

  return [m1, m2];
}

// Generate all directed pairs (Full-Mesh) so every account communicates with every other account
function getMeshAccountPairs(connectedAccounts: any[]): Array<[any, any]> {
  const pairs: Array<[any, any]> = [];
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

// Stops the Warm-up Engine cleanly
function stopWarmupEngine(reason?: string, isAuto: boolean = false) {
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

    const now = new Date();
    const timeStr = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;
    const warmupLogs = loadJson<any[]>(WARMUP_LOGS_FILE, []);
    warmupLogs.unshift({
      id: `wup_autostop_${Date.now()}`,
      timestamp: timeStr,
      fromAccountId: 'SYSTEM',
      fromPhone: 'Warm-up Engine',
      toAccountId: 'ALL',
      toPhone: 'Auto-Stop Controller',
      message: `🛑 Auto-Stop Completed: ${reason}`,
      status: 'READ',
      isAutoStopNotice: true
    });
    saveJson(WARMUP_LOGS_FILE, warmupLogs);
    console.log(`[Warmup Engine] ${reason}`);
  } else {
    console.log('[Warmup Engine] Stopped manually by user.');
  }
}

// Runs a single peer-to-peer warm-up exchange across the Full-Mesh round-robin queue
async function runManualWarmupIteration() {
  if (!warmupManualRunning) return;

  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  const connectedAccounts = accounts.filter(a => connectionStatuses.get(a.id) === 'CONNECTED' && a.warmupEnabled);

  if (connectedAccounts.length >= 2) {
    const meshPairs = getMeshAccountPairs(connectedAccounts);
    if (meshPairs.length > 0) {
      // Pick current pair in full-mesh round-robin rotation
      const [sender, receiver] = meshPairs[warmupPairIndex % meshPairs.length];
      warmupPairIndex = (warmupPairIndex + 1) % meshPairs.length;

      const sockSender = sockets.get(sender.id);
      const sockReceiver = sockets.get(receiver.id);

      if (sockSender && receiver.phoneNumber) {
        // Generate dynamic AI or varied script
        const [msg1, msg2] = await generateWarmupDialoguePair(warmupConfig.scriptStyle, warmupConfig.customTopicPrompt);

        try {
          const targetJid = formatToJid(receiver.phoneNumber);
          console.log(`[Warmup Full-Mesh] ${sender.name} (${sender.phoneNumber}) -> ${receiver.name} (${receiver.phoneNumber}): "${msg1}"`);
          
          await sockSender.sendPresenceUpdate('composing', targetJid);
          await delay(2000);
          await sockSender.sendPresenceUpdate('paused', targetJid);
          await sockSender.sendMessage(targetJid, { text: msg1 });

          const now = new Date();
          const timeStr = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;

          const warmupLogs = loadJson<any[]>(WARMUP_LOGS_FILE, []);
          warmupLogs.unshift({
            id: `wup_${Date.now()}_1`,
            timestamp: timeStr,
            fromAccountId: sender.id,
            fromPhone: sender.phoneNumber,
            toAccountId: receiver.id,
            toPhone: receiver.phoneNumber,
            message: msg1,
            status: 'DELIVERED'
          });
          saveJson(WARMUP_LOGS_FILE, warmupLogs);

          warmupDialoguesThisSession++;

          // Check if dialogue count limit reached
          if (
            (warmupConfig.autoStopMode === 'DIALOGUE_LIMIT' || warmupConfig.autoStopMode === 'BOTH') &&
            warmupDialoguesThisSession >= warmupConfig.stopDialogueLimit
          ) {
            stopWarmupEngine(`Reached configured dialogue limit of ${warmupConfig.stopDialogueLimit} exchanges. Engine safely turned OFF.`, true);
            return;
          }

          // If receiver socket is actively linked, schedule natural reply after 12-18 seconds
          if (sockReceiver && sender.phoneNumber) {
            const replyDelaySec = getRandomInt(12, 18);
            setTimeout(async () => {
              if (!warmupManualRunning) return;
              try {
                const replyJid = formatToJid(sender.phoneNumber);
                await sockReceiver.sendPresenceUpdate('composing', replyJid);
                await delay(2000);
                await sockReceiver.sendPresenceUpdate('paused', replyJid);
                await sockReceiver.sendMessage(replyJid, { text: msg2 });

                const replyTime = new Date();
                const replyTimeStr = `${replyTime.toISOString().split('T')[0]} ${replyTime.toTimeString().split(' ')[0]}`;
                const logs = loadJson<any[]>(WARMUP_LOGS_FILE, []);
                logs.unshift({
                  id: `wup_${Date.now()}_2`,
                  timestamp: replyTimeStr,
                  fromAccountId: receiver.id,
                  fromPhone: receiver.phoneNumber,
                  toAccountId: sender.id,
                  toPhone: sender.phoneNumber,
                  message: msg2,
                  status: 'READ'
                });
                saveJson(WARMUP_LOGS_FILE, logs);
              } catch (err: any) {
                console.error('[Warmup Reply Error]:', err.message);
              }
            }, replyDelaySec * 1000);
          }
        } catch (err: any) {
          console.error('[Warmup Send Error]:', err.message);
        }
      }
    }
  }

  // Schedule next iteration with natural human intervals (45s - 75s) if still running
  if (warmupManualRunning) {
    const nextIntervalSec = getRandomInt(45, 75);
    warmupTimer = setTimeout(runManualWarmupIteration, nextIntervalSec * 1000);
  }
}

// -------------------------------------------------------------
// WARMUP SCHEDULE CONTROLLER & TIME HELPERS
// -------------------------------------------------------------
function getCurrentTimezoneInfo(tz: string = 'Asia/Colombo') {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(now);

    const partMap: Record<string, string> = {};
    for (const p of parts) partMap[p.type] = p.value;

    const dStr = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDay = dayNames.indexOf(dStr);
    const currentHHMM = `${partMap.hour}:${partMap.minute}`;
    return { currentDay: currentDay >= 0 ? currentDay : now.getDay(), currentHHMM, formatted: `${dStr} ${currentHHMM}` };
  } catch (e) {
    const now = new Date();
    const currentDay = now.getDay();
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return { currentDay, currentHHMM, formatted: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][currentDay]} ${currentHHMM}` };
  }
}

function isCurrentTimeWithinSchedule(config: WarmupConfigState): { within: boolean; dayIndex: number; currentHHMM: string } {
  const tz = config.timezone || 'Asia/Colombo';
  const { currentDay, currentHHMM } = getCurrentTimezoneInfo(tz);
  const selectedDays = config.scheduleDays || [1, 2, 3, 4, 5];
  const startTime = config.scheduleStartTime || '09:00';
  const stopTime = config.scheduleStopTime || '17:00';

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
  if (!warmupConfig.scheduleEnabled) {
    if (scheduledWarmupActive && warmupManualRunning) {
      scheduledWarmupActive = false;
      stopWarmupEngine('Schedule disabled by user. Warm-up safely turned OFF.', true);
    }
    return;
  }

  const { within, dayIndex, currentHHMM } = isCurrentTimeWithinSchedule(warmupConfig);
  const tz = warmupConfig.timezone || 'Asia/Colombo';
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  if (within) {
    if (!warmupManualRunning) {
      scheduledWarmupActive = true;
      warmupAutoStopped = false;
      warmupAutoStopReason = null;
      warmupDialoguesThisSession = 0;
      warmupStartedAt = new Date().toISOString();
      warmupManualRunning = true;

      const notice = `⏰ Scheduled Auto Warm-up Started [${dayNames[dayIndex]} window: ${warmupConfig.scheduleStartTime} - ${warmupConfig.scheduleStopTime} (${tz})]`;
      console.log(`[Warmup Scheduler] ${notice}`);

      const nowTime = new Date();
      const warmupLogs = loadJson<any[]>(WARMUP_LOGS_FILE, []);
      warmupLogs.unshift({
        id: `wup_sched_start_${Date.now()}`,
        timestamp: `${nowTime.toISOString().split('T')[0]} ${nowTime.toTimeString().split(' ')[0]}`,
        fromAccountId: 'SYSTEM',
        fromPhone: 'Schedule Controller',
        toAccountId: 'ALL',
        toPhone: 'Warm-up Engine',
        message: notice,
        status: 'READ',
        isAutoStopNotice: true
      });
      saveJson(WARMUP_LOGS_FILE, warmupLogs);

      runManualWarmupIteration();
    }
  } else {
    if (scheduledWarmupActive && warmupManualRunning) {
      scheduledWarmupActive = false;
      const notice = `🛑 Scheduled Auto Warm-up Window Closed at ${currentHHMM} (Window: ${warmupConfig.scheduleStartTime} - ${warmupConfig.scheduleStopTime}). Engine safely turned OFF.`;
      console.log(`[Warmup Scheduler] ${notice}`);
      stopWarmupEngine(notice, true);
    }
  }
}

// Background scheduler checker runs every 20 seconds
setInterval(checkWarmupSchedule, 20000);

// -------------------------------------------------------------
// WARMUP API ENDPOINTS
// -------------------------------------------------------------
app.get('/api/warmup/status', (req, res) => {
  const warmupLogs = loadJson<any[]>(WARMUP_LOGS_FILE, []);
  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  const connectedAccounts = accounts.filter(a => connectionStatuses.get(a.id) === 'CONNECTED' && a.warmupEnabled);
  const meshPairs = getMeshAccountPairs(connectedAccounts);

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

  const { within, currentHHMM } = isCurrentTimeWithinSchedule(warmupConfig);
  const tzInfo = getCurrentTimezoneInfo(warmupConfig.timezone || 'Asia/Colombo');

  res.json({
    isRunning: warmupManualRunning,
    startedAt: warmupStartedAt,
    dialoguesCompletedThisSession: warmupDialoguesThisSession,
    autoStopTriggered: warmupAutoStopped,
    autoStopReason: warmupAutoStopReason,
    config: warmupConfig,
    nextPairInfo,
    totalMeshPairs: meshPairs.length,
    isScheduledWindowActive: warmupConfig.scheduleEnabled && within,
    currentTimeStr: tzInfo.formatted,
    logs: warmupLogs
  });
});

app.post('/api/warmup/start', (req, res) => {
  const {
    autoStopMode = warmupConfig.autoStopMode,
    stopDurationMinutes = warmupConfig.stopDurationMinutes,
    stopDialogueLimit = warmupConfig.stopDialogueLimit,
    scriptStyle = warmupConfig.scriptStyle,
    customTopicPrompt = warmupConfig.customTopicPrompt,
    useAiGeneration = warmupConfig.useAiGeneration,
    scheduleEnabled = warmupConfig.scheduleEnabled,
    scheduleDays = warmupConfig.scheduleDays,
    scheduleStartTime = warmupConfig.scheduleStartTime,
    scheduleStopTime = warmupConfig.scheduleStopTime,
    timezone = warmupConfig.timezone
  } = req.body || {};

  warmupConfig = {
    autoStopMode,
    stopDurationMinutes: Number(stopDurationMinutes) || 30,
    stopDialogueLimit: Number(stopDialogueLimit) || 20,
    scriptStyle: scriptStyle || 'casual',
    customTopicPrompt: customTopicPrompt || '',
    useAiGeneration: Boolean(useAiGeneration),
    scheduleEnabled: Boolean(scheduleEnabled),
    scheduleDays: Array.isArray(scheduleDays) ? scheduleDays.map(Number) : warmupConfig.scheduleDays,
    scheduleStartTime: scheduleStartTime || '09:00',
    scheduleStopTime: scheduleStopTime || '17:00',
    timezone: timezone || 'Asia/Colombo'
  };

  warmupAutoStopped = false;
  warmupAutoStopReason = null;
  warmupDialoguesThisSession = 0;
  warmupStartedAt = new Date().toISOString();

  if (warmupStopTimer) {
    clearTimeout(warmupStopTimer);
    warmupStopTimer = null;
  }

  // Arm Duration Timer if enabled
  if (warmupConfig.autoStopMode === 'DURATION' || warmupConfig.autoStopMode === 'BOTH') {
    const durationMs = warmupConfig.stopDurationMinutes * 60 * 1000;
    console.log(`[Warmup Engine] Auto-stop timer set for ${warmupConfig.stopDurationMinutes} minutes (${durationMs / 1000}s)`);
    warmupStopTimer = setTimeout(() => {
      stopWarmupEngine(`Reached configured time duration limit of ${warmupConfig.stopDurationMinutes} minutes. Engine safely turned OFF.`, true);
    }, durationMs);
  }

  if (!warmupManualRunning) {
    warmupManualRunning = true;
    console.log(`[Warmup Engine] Started by user. Style: "${warmupConfig.scriptStyle}", AutoStopMode: "${warmupConfig.autoStopMode}"`);
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

// Update Warmup Configuration independently from running state
app.post('/api/warmup/config', (req, res) => {
  const updates = req.body || {};
  warmupConfig = {
    ...warmupConfig,
    ...updates,
    stopDurationMinutes: updates.stopDurationMinutes !== undefined ? (Number(updates.stopDurationMinutes) || 30) : warmupConfig.stopDurationMinutes,
    stopDialogueLimit: updates.stopDialogueLimit !== undefined ? (Number(updates.stopDialogueLimit) || 20) : warmupConfig.stopDialogueLimit,
    scriptStyle: updates.scriptStyle || warmupConfig.scriptStyle,
    autoStopMode: updates.autoStopMode || warmupConfig.autoStopMode,
    customTopicPrompt: updates.customTopicPrompt !== undefined ? String(updates.customTopicPrompt) : warmupConfig.customTopicPrompt,
    useAiGeneration: updates.useAiGeneration !== undefined ? Boolean(updates.useAiGeneration) : warmupConfig.useAiGeneration,
    scheduleEnabled: updates.scheduleEnabled !== undefined ? Boolean(updates.scheduleEnabled) : warmupConfig.scheduleEnabled,
    scheduleDays: Array.isArray(updates.scheduleDays) ? updates.scheduleDays.map(Number) : warmupConfig.scheduleDays,
    scheduleStartTime: updates.scheduleStartTime ? String(updates.scheduleStartTime) : warmupConfig.scheduleStartTime,
    scheduleStopTime: updates.scheduleStopTime ? String(updates.scheduleStopTime) : warmupConfig.scheduleStopTime,
    timezone: updates.timezone ? String(updates.timezone) : warmupConfig.timezone
  };
  saveJson(WARMUP_CONFIG_FILE, warmupConfig);
  console.log(`[Warmup Config Updated] AutoStopMode: ${warmupConfig.autoStopMode}, Schedule: ${warmupConfig.scheduleEnabled ? 'ON' : 'OFF'} (${warmupConfig.scheduleStartTime}-${warmupConfig.scheduleStopTime}), Style: ${warmupConfig.scriptStyle}`);
  
  // Trigger immediate schedule check to start or stop if within window
  checkWarmupSchedule();

  res.json({ success: true, config: warmupConfig });
});

app.post('/api/warmup/stop', (req, res) => {
  scheduledWarmupActive = false;
  stopWarmupEngine(undefined, false);

  res.json({ success: true, isRunning: false });
});

// Trigger an immediate instant exchange using current mesh pair & dynamic script
app.post('/api/warmup/trigger-instant', async (req, res) => {
  const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  const connectedAccounts = accounts.filter(a => connectionStatuses.get(a.id) === 'CONNECTED' && a.warmupEnabled);
  if (connectedAccounts.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 connected WhatsApp accounts to exchange real dialogue.' });
  }

  const meshPairs = getMeshAccountPairs(connectedAccounts);
  const [sender, receiver] = meshPairs[warmupPairIndex % meshPairs.length];
  warmupPairIndex = (warmupPairIndex + 1) % meshPairs.length;

  const sockSender = sockets.get(sender.id);
  const sockReceiver = sockets.get(receiver.id);
  if (!sockSender) return res.status(400).json({ error: 'Sender socket unavailable.' });

  try {
    const targetJid = formatToJid(receiver.phoneNumber);
    const [msg1, msg2] = await generateWarmupDialoguePair(warmupConfig.scriptStyle, warmupConfig.customTopicPrompt);

    await sockSender.sendPresenceUpdate('composing', targetJid);
    await delay(1500);
    await sockSender.sendPresenceUpdate('paused', targetJid);
    await sockSender.sendMessage(targetJid, { text: msg1 });

    const now = new Date();
    const timeStr = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;
    const warmupLogs = loadJson<any[]>(WARMUP_LOGS_FILE, []);
    const entry = {
      id: `wup_${Date.now()}_instant`,
      timestamp: timeStr,
      fromAccountId: sender.id,
      fromPhone: sender.phoneNumber,
      toAccountId: receiver.id,
      toPhone: receiver.phoneNumber,
      message: msg1,
      status: 'DELIVERED'
    };
    warmupLogs.unshift(entry);
    saveJson(WARMUP_LOGS_FILE, warmupLogs);

    // If receiver socket is connected, reply after 8 seconds
    if (sockReceiver && sender.phoneNumber) {
      setTimeout(async () => {
        try {
          const replyJid = formatToJid(sender.phoneNumber);
          await sockReceiver.sendPresenceUpdate('composing', replyJid);
          await delay(1500);
          await sockReceiver.sendPresenceUpdate('paused', replyJid);
          await sockReceiver.sendMessage(replyJid, { text: msg2 });

          const replyTime = new Date();
          const replyTimeStr = `${replyTime.toISOString().split('T')[0]} ${replyTime.toTimeString().split(' ')[0]}`;
          const logs = loadJson<any[]>(WARMUP_LOGS_FILE, []);
          logs.unshift({
            id: `wup_${Date.now()}_instant_reply`,
            timestamp: replyTimeStr,
            fromAccountId: receiver.id,
            fromPhone: receiver.phoneNumber,
            toAccountId: sender.id,
            toPhone: sender.phoneNumber,
            message: msg2,
            status: 'READ'
          });
          saveJson(WARMUP_LOGS_FILE, logs);
        } catch (e: any) {
          console.error('[Instant Warmup Reply Error]:', e.message);
        }
      }, 8000);
    }

    res.json({ success: true, entry });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Preview AI generated samples for selected style/topic
app.post('/api/warmup/preview-ai', async (req, res) => {
  const { scriptStyle = 'casual', customTopicPrompt = '' } = req.body || {};
  try {
    const samples: Array<{ id: number; message1: string; message2: string }> = [];
    for (let i = 0; i < 3; i++) {
      const [m1, m2] = await generateWarmupDialoguePair(scriptStyle, customTopicPrompt);
      samples.push({ id: i + 1, message1: m1, message2: m2 });
    }
    res.json({ success: true, samples });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// VITE SPA MIDDLEWARE MOUNTING
// -------------------------------------------------------------
async function bootstrap() {
  // 1. Auto-recover session keys from persistent vault if container restarted
  const vault = loadJson<Record<string, Record<string, string>>>(SESSIONS_VAULT_FILE, {});
  for (const [accId, keys] of Object.entries(vault)) {
    const sessionDir = path.join(SESSIONS_DIR, `session_${accId}`);
    if (!fs.existsSync(path.join(sessionDir, 'creds.json'))) {
      console.log(`[Startup] Recovering session keys from vault for account ${accId}...`);
      importSessionKeys(accId, keys);
    }
  }

  // 2. Auto-restore previously linked WhatsApp sessions on startup
  const existingAccounts = loadJson<any[]>(ACCOUNTS_FILE, []);
  for (const acc of existingAccounts) {
    const sessionDir = path.join(SESSIONS_DIR, `session_${acc.id}`);
    const credsExist = fs.existsSync(path.join(sessionDir, 'creds.json'));
    if (credsExist) {
      console.log(`[Startup] Restoring linked WhatsApp session from disk for ${acc.name} (${acc.id})...`);
      initBaileysAccount(acc.id, acc.name).catch(console.error);
    } else {
      console.log(`[Startup] Account ${acc.name} (${acc.id}) has no saved credentials on disk yet. Ready for QR scan.`);
      connectionStatuses.set(acc.id, 'SCAN_REQUIRED');
    }
  }

  // 3. 24/7 Keep-Alive Heartbeat & Self-Healing Watchdog (Checks every 25s)
  // Guarantees sessions remain connected for months continuously without dropping
  setInterval(async () => {
    // A. Keep-alive ping for active connections
    for (const [accId, sock] of sockets.entries()) {
      if (connectionStatuses.get(accId) === 'CONNECTED') {
        try {
          await sock.sendPresenceUpdate('available');
        } catch (e) {}
      }
    }

    // B. Self-Healing: If any account has saved credentials on disk or in vault but socket dropped, auto-reconnect!
    const accounts = loadJson<any[]>(ACCOUNTS_FILE, []);
    const vault = loadJson<Record<string, Record<string, string>>>(SESSIONS_VAULT_FILE, {});

    for (const acc of accounts) {
      const sessionDir = path.join(SESSIONS_DIR, `session_${acc.id}`);
      const hasCredsOnDisk = fs.existsSync(path.join(sessionDir, 'creds.json'));
      const hasVaultKeys = Boolean(vault[acc.id] && vault[acc.id]['creds.json']);

      if ((hasCredsOnDisk || hasVaultKeys) && connectionStatuses.get(acc.id) !== 'CONNECTED' && connectionStatuses.get(acc.id) !== 'CONNECTING') {
        console.log(`[24/7 Watchdog] Account ${acc.id} (${acc.name}) has saved credentials but is currently ${connectionStatuses.get(acc.id)}. Auto-reconnecting...`);
        initBaileysAccount(acc.id, acc.name).catch(console.error);
      }
    }
  }, 25000);

  // Mount Vite middleware for dev
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ['**/sessions/**', '**/uploads/**', '**/data/**', '**/*.json']
        }
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve('./dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve('./dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[YUHUSULU CRM] Full-Stack WhatsApp Server running at http://localhost:${PORT}`);
  });
}

bootstrap();
