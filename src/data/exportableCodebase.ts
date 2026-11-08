export interface CodeFile {
  filename: string;
  path: string;
  language: string;
  description: string;
  category: 'guideline' | 'schema' | 'backend' | 'frontend' | 'scripts';
  content: string;
}

export const EXPORTABLE_CODEBASE: CodeFile[] = [
  {
    filename: 'A-Z_COMPLETE_GUIDELINE.md',
    path: 'docs/A-Z_COMPLETE_GUIDELINE.md',
    language: 'markdown',
    description: 'System architecture, prerequisites, and step-by-step local laptop setup guide',
    category: 'guideline',
    content: `# A to Z Complete Guideline: Local WhatsApp Bulk Sender & CRM

## 1. System Architecture
This application is designed specifically for local deployment on your laptop without requiring cloud dependencies or monthly SaaS subscriptions.

### Architecture Components:
1. **Frontend (Next.js / React + Tailwind CSS)**:
   - Runs locally at \`http://localhost:3000\`.
   - Communicates via REST and Server-Sent Events (SSE) or WebSockets with the backend.
   - Provides QR code scanning, dynamic campaign timing configuration, spintax preview, live delivery queue visualizer, and account health monitoring.

2. **Backend Server (Node.js + Express)**:
   - Runs locally at \`http://localhost:5000\`.
   - Houses the REST API, CORS configuration for localhost, and Baileys socket pool.

3. **WhatsApp Web Engine (@whiskeysockets/baileys)**:
   - Connects directly to WhatsApp servers via WebSockets using WhatsApp Web protocol.
   - Saves credentials on your local disk using \`useMultiFileAuthState('./sessions/session_{id}')\`. Once scanned, sessions stay valid across restarts.

4. **Database (Local SQLite via better-sqlite3)**:
   - File-based SQLite (\`./data/whatsapp_crm.db\`). Zero configuration, lightning-fast synchronous queries, zero external server installation required.

5. **Campaign Queue & Worker Engine**:
   - In-memory asynchronous priority queue backed by SQLite (or optional BullMQ with local Redis).
   - Dynamically loads anti-ban parameters for each campaign:
     - **Random Inter-Message Delays**: e.g., 10s to 35s.
     - **Batch Cooldown**: e.g., after 10 messages, pause for 120 seconds.
     - **Sender Account Rotation**: Round-robin across all designated accounts.
     - **Template Rotation**: Randomized selection with spintax & variable injection.

6. **Account Warm-up Engine**:
   - Background automated cron that triggers natural peer-to-peer dialogues between your connected WhatsApp numbers to build sender reputation and prevent bans.

---

## 2. Prerequisites to Install on Your Laptop

### A. Node.js (v18.x or v20.x LTS)
- Download and install the latest LTS release from https://nodejs.org.
- Verify in your terminal:
  \`\`\`bash
  node -v # Should be v18+ or v20+
  npm -v  # Should be v9+ or v10+
  \`\`\`

### B. Git (Version Control)
- Download from https://git-scm.com or install via package manager (\`brew install git\` on Mac, or \`winget install Git.Git\` on Windows).

### C. Build Tools (For SQLite compilation on Windows/Mac/Linux)
- **Windows**: Install Python and Visual Studio C++ Build Tools (usually handled automatically by Node installer, or run \`npm install --global --production windows-build-tools\`).
- **macOS**: \`xcode-select --install\`
- **Linux (Ubuntu/Debian)**: \`sudo apt-get install build-essential python3\`

---

## 3. Step-by-Step Installation (A to Z)

### Step 1: Create Project Directory
\`\`\`bash
mkdir whatsapp-local-crm
cd whatsapp-local-crm
mkdir backend frontend
\`\`\`

### Step 2: Initialize Backend
\`\`\`bash
cd backend
npm init -y

# Install Core Backend Dependencies
npm install express cors dotenv better-sqlite3 @whiskeysockets/baileys pino qrcode multer node-cron

# Install Dev Dependencies
npm install --save-dev nodemon
\`\`\`

### Step 3: Configure Environment Variables (\`backend/.env\`)
\`\`\`ini
PORT=5000
FRONTEND_URL=http://localhost:3000
SESSIONS_DIR=./sessions
DATABASE_PATH=./data/whatsapp_crm.db
\`\`\`

### Step 4: Initialize Frontend (Next.js)
\`\`\`bash
cd ../frontend
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"

# Install UI & Helper packages
npm install lucide-react qrcode axios
npm install --save-dev @types/qrcode
\`\`\`

### Step 5: Start Both Servers Locally
In terminal 1 (Backend):
\`\`\`bash
cd backend
npm run dev # Starts on http://localhost:5000
\`\`\`

In terminal 2 (Frontend):
\`\`\`bash
cd frontend
npm run dev # Starts on http://localhost:3000
\`\`\`

Open your browser at \`http://localhost:3000\` to access the dashboard!
`
  },
  {
    filename: 'schema.sql',
    path: 'backend/db/schema.sql',
    language: 'sql',
    description: 'SQLite database schema for accounts, campaigns, templates, logs, and rules',
    category: 'schema',
    content: `-- SQLite Database Schema for Local WhatsApp Bulk Sender & CRM
-- File path: backend/db/schema.sql

PRAGMA foreign_keys = ON;

-- 1. WhatsApp Accounts Table
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone_number TEXT,
  session_path TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'DISCONNECTED', -- 'CONNECTED', 'CONNECTING', 'DISCONNECTED', 'BANNED'
  battery_level INTEGER DEFAULT 100,
  daily_sent_count INTEGER DEFAULT 0,
  daily_limit INTEGER DEFAULT 250,
  warmup_enabled INTEGER DEFAULT 1,
  total_delivered INTEGER DEFAULT 0,
  last_connected_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Campaigns Table (Stores Dynamic Timing Configurations)
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'draft', -- 'draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'
  rotation_strategy TEXT DEFAULT 'round-robin', -- 'round-robin' or 'random'
  min_delay_seconds INTEGER NOT NULL DEFAULT 10,
  max_delay_seconds INTEGER NOT NULL DEFAULT 35,
  batch_size INTEGER NOT NULL DEFAULT 10,
  break_duration_seconds INTEGER NOT NULL DEFAULT 120,
  typing_delay_seconds INTEGER DEFAULT 3,
  scheduled_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

-- 3. Campaign Sender Accounts Junction Table (Multi-Account Rotation)
CREATE TABLE IF NOT EXISTS campaign_senders (
  campaign_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  priority_weight INTEGER DEFAULT 1,
  PRIMARY KEY (campaign_id, account_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- 4. Campaign Templates Table (Template Rotation)
CREATE TABLE IF NOT EXISTS campaign_templates (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL, -- Supports Spintax {A|B} and variables {{name}}
  media_url TEXT,
  media_type TEXT, -- 'image', 'video', 'document', 'audio'
  file_name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- 5. Campaign Contacts Table (Recipients Queue)
CREATE TABLE IF NOT EXISTS campaign_contacts (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  name TEXT,
  company TEXT,
  custom_var1 TEXT,
  custom_var2 TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'failed'
  assigned_sender_id TEXT,
  assigned_template_id TEXT,
  sent_at DATETIME,
  error_message TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- 6. Delivery Logs Table
CREATE TABLE IF NOT EXISTS delivery_logs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT,
  sender_phone TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  template_id TEXT,
  resolved_message TEXT NOT NULL,
  delay_applied_seconds INTEGER,
  status TEXT NOT NULL, -- 'SENT', 'DELIVERED', 'READ', 'FAILED'
  error_message TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. Account Warm-up Logs Table
CREATE TABLE IF NOT EXISTS warmup_logs (
  id TEXT PRIMARY KEY,
  from_account_id TEXT NOT NULL,
  from_phone TEXT NOT NULL,
  to_account_id TEXT NOT NULL,
  to_phone TEXT NOT NULL,
  message_content TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_account_id) REFERENCES accounts(id),
  FOREIGN KEY (to_account_id) REFERENCES accounts(id)
);

-- 8. Auto Responder Rules Table
CREATE TABLE IF NOT EXISTS auto_responders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'contains', -- 'exact', 'contains', 'regex'
  keyword TEXT NOT NULL,
  reply_message TEXT NOT NULL,
  is_enabled INTEGER DEFAULT 1,
  typing_delay_seconds INTEGER DEFAULT 3,
  media_attachment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_contacts_campaign_status ON campaign_contacts(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON delivery_logs(timestamp DESC);
`
  },
  {
    filename: 'baileysManager.js',
    path: 'backend/services/baileysManager.js',
    language: 'javascript',
    description: 'Baileys WebSocket connection pool, persistent session folders, QR generation, & auto-reconnect',
    category: 'backend',
    content: `// Baileys Connection Manager
// File: backend/services/baileysManager.js
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');

class BaileysManager {
  constructor() {
    this.sockets = new Map(); // accountId -> WASocket
    this.qrCodes = new Map(); // accountId -> dataURL
    this.connectionStates = new Map(); // accountId -> 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'
    this.sessionsBaseDir = path.resolve(process.env.SESSIONS_DIR || './sessions');

    if (!fs.existsSync(this.sessionsBaseDir)) {
      fs.mkdirSync(this.sessionsBaseDir, { recursive: true });
    }
  }

  /**
   * Initializes or reconnects a WhatsApp account
   */
  async initAccount(accountId, onQrGenerated = null, onStatusChange = null) {
    const sessionDir = path.join(this.sessionsBaseDir, \`session_\${accountId}\`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      auth: state,
      printQRInTerminal: false,
      browser: ['YUHUSULU CRM', 'Chrome', '120.0.0']
    });

    this.sockets.set(accountId, sock);
    this.connectionStates.set(accountId, 'CONNECTING');

    // Save auth credentials whenever updated
    sock.ev.on('creds.update', saveCreds);

    // Monitor connection lifecycle
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrDataUrl = await qrcode.toDataURL(qr);
        this.qrCodes.set(accountId, qrDataUrl);
        if (onQrGenerated) onQrGenerated(accountId, qrDataUrl);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        this.connectionStates.set(accountId, 'DISCONNECTED');
        this.qrCodes.delete(accountId);

        if (onStatusChange) onStatusChange(accountId, 'DISCONNECTED', statusCode);

        if (shouldReconnect) {
          console.log(\`[Baileys] Account \${accountId} disconnected. Reconnecting in 5s...\`);
          setTimeout(() => this.initAccount(accountId, onQrGenerated, onStatusChange), 5000);
        } else {
          console.log(\`[Baileys] Account \${accountId} logged out. Deleting session.\`);
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
      } else if (connection === 'open') {
        this.connectionStates.set(accountId, 'CONNECTED');
        this.qrCodes.delete(accountId);
        const jid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        console.log(\`[Baileys] Account \${accountId} CONNECTED as \${jid}\`);
        if (onStatusChange) onStatusChange(accountId, 'CONNECTED', null, sock.user);
      }
    });

    // Auto-responder hook for incoming messages
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          if (!msg.key.fromMe && msg.message) {
            await this.handleIncomingMessage(accountId, sock, msg);
          }
        }
      }
    });

    return sock;
  }

  /**
   * Sends a message with realistic typing state
   */
  async sendMessage(accountId, recipientPhone, messageText, mediaOptions = null, typingSeconds = 3) {
    const sock = this.sockets.get(accountId);
    if (!sock) throw new Error(\`Account \${accountId} is not active\`);

    // Clean phone number to WhatsApp JID format: e.g. 15552348901@s.whatsapp.net
    const cleanNumber = recipientPhone.replace(/\\D/g, '');
    const jid = \`\${cleanNumber}@s.whatsapp.net\`;

    // 1. Simulate human presence & typing
    await sock.sendPresenceUpdate('composing', jid);
    await delay(typingSeconds * 1000);
    await sock.sendPresenceUpdate('paused', jid);

    // 2. Dispatch content or media
    if (mediaOptions && mediaOptions.mediaUrl) {
      return await sock.sendMessage(jid, {
        image: { url: mediaOptions.mediaUrl },
        caption: messageText
      });
    }

    return await sock.sendMessage(jid, { text: messageText });
  }

  async handleIncomingMessage(accountId, sock, msg) {
    const from = msg.key.remoteJid;
    const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (!body || from.endsWith('@g.us')) return;

    // Call auto-responder service (checks SQLite rules)
    const { getMatchingAutoResponse } = require('./autoResponderService');
    const matchedReply = getMatchingAutoResponse(body);

    if (matchedReply) {
      await delay(matchedReply.typing_delay_seconds * 1000);
      await sock.sendMessage(from, { text: matchedReply.reply_message });
    }
  }

  getSocket(accountId) {
    return this.sockets.get(accountId);
  }

  getQrCode(accountId) {
    return this.qrCodes.get(accountId);
  }

  getStatus(accountId) {
    return this.connectionStates.get(accountId) || 'DISCONNECTED';
  }
}

module.exports = new BaileysManager();
`
  },
  {
    filename: 'queueEngine.js',
    path: 'backend/services/queueEngine.js',
    language: 'javascript',
    description: 'Dynamic delay calculations, batch break cooling, sender rotation, and template randomization',
    category: 'backend',
    content: `// Campaign Queue Processor
// File: backend/services/queueEngine.js
const db = require('../db');
const baileysManager = require('./baileysManager');

// Helper to resolve spintax: {Hi|Hello|Hey} -> random choice
function resolveSpintax(text) {
  const spintaxRegex = /\\{([^{}]+)\\}/;
  let matches = spintaxRegex.exec(text);
  while (matches) {
    const choices = matches[1].split('|');
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    text = text.replace(matches[0], randomChoice);
    matches = spintaxRegex.exec(text);
  }
  return text;
}

// Variable replacement: {{name}}, {{company}}
function replaceVariables(text, vars) {
  let result = text;
  for (const [key, val] of Object.entries(vars)) {
    if (val !== undefined) {
      const reg = new RegExp('{{' + key + '}}', 'gi');
      result = result.replace(reg, val);
    }
  }
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

class QueueEngine {
  constructor() {
    this.activeCampaigns = new Map(); // campaignId -> { isPaused: boolean, isStopped: boolean }
  }

  /**
   * Starts campaign execution using dynamic timings loaded from SQLite
   */
  async startCampaign(campaignId, onProgress = null) {
    // 1. Fetch campaign and dynamic timings from SQLite
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    const senders = db.prepare(\`
      SELECT a.* FROM accounts a
      JOIN campaign_senders cs ON a.id = cs.account_id
      WHERE cs.campaign_id = ? AND a.status = 'CONNECTED'
    \`).all(campaignId);

    if (senders.length === 0) {
      throw new Error('No connected WhatsApp accounts assigned to this campaign.');
    }

    const templates = db.prepare('SELECT * FROM campaign_templates WHERE campaign_id = ?').all(campaignId);
    if (templates.length === 0) {
      throw new Error('At least one message template is required.');
    }

    const pendingContacts = db.prepare(\`
      SELECT * FROM campaign_contacts WHERE campaign_id = ? AND status = 'pending'
    \`).all(campaignId);

    if (pendingContacts.length === 0) {
      db.prepare("UPDATE campaigns SET status = 'completed' WHERE id = ?").run(campaignId);
      return;
    }

    // Set campaign state to RUNNING
    db.prepare("UPDATE campaigns SET status = 'running' WHERE id = ?").run(campaignId);
    this.activeCampaigns.set(campaignId, { isPaused: false, isStopped: false });

    console.log(\`[Queue] Started Campaign "\${campaign.name}" (\${pendingContacts.length} contacts)\`);
    console.log(\`[Queue] Dynamic Timings: Delay \${campaign.min_delay_seconds}-\${campaign.max_delay_seconds}s | Batch: \${campaign.batch_size} | Break: \${campaign.break_duration_seconds}s\`);

    let senderIndex = 0;
    let batchCounter = 0;

    for (let i = 0; i < pendingContacts.length; i++) {
      const controller = this.activeCampaigns.get(campaignId);
      if (!controller || controller.isStopped) {
        console.log(\`[Queue] Campaign \${campaignId} was cancelled/stopped.\`);
        db.prepare("UPDATE campaigns SET status = 'cancelled' WHERE id = ?").run(campaignId);
        break;
      }

      while (controller.isPaused) {
        console.log(\`[Queue] Campaign \${campaignId} is paused. Waiting...\`);
        await sleep(2000);
      }

      const contact = pendingContacts[i];

      // 1. SENDER ROTATION: Round-robin across connected accounts
      const currentSender = senders[senderIndex % senders.length];
      senderIndex++;

      // 2. TEMPLATE ROTATION: Random selection from available templates
      const selectedTemplate = templates[Math.floor(Math.random() * templates.length)];

      // 3. Resolve Spintax & Personalization variables
      let resolvedText = resolveSpintax(selectedTemplate.content);
      resolvedText = replaceVariables(resolvedText, {
        name: contact.name || 'Friend',
        company: contact.company || 'your team',
        phone: contact.phone_number,
        custom1: contact.custom_var1 || '',
        custom2: contact.custom_var2 || ''
      });

      // 4. Send Message via Baileys
      try {
        await baileysManager.sendMessage(
          currentSender.id,
          contact.phone_number,
          resolvedText,
          selectedTemplate.media_url ? { mediaUrl: selectedTemplate.media_url } : null,
          campaign.typing_delay_seconds || 3
        );

        // Update contact status to 'sent'
        db.prepare(\`
          UPDATE campaign_contacts
          SET status = 'sent', assigned_sender_id = ?, assigned_template_id = ?, sent_at = CURRENT_TIMESTAMP
          WHERE id = ?
        \`).run(currentSender.id, selectedTemplate.id, contact.id);

        // Record Delivery Log
        const logId = 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        db.prepare(\`
          INSERT INTO delivery_logs (
            id, campaign_id, recipient_phone, recipient_name, sender_phone, sender_name,
            template_id, resolved_message, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DELIVERED')
        \`).run(
          logId, campaign.id, contact.phone_number, contact.name,
          currentSender.phone_number, currentSender.name, selectedTemplate.id, resolvedText
        );

        // Increment account daily quota count
        db.prepare('UPDATE accounts SET daily_sent_count = daily_sent_count + 1, total_delivered = total_delivered + 1 WHERE id = ?')
          .run(currentSender.id);

        batchCounter++;

        if (onProgress) {
          onProgress({
            campaignId,
            current: i + 1,
            total: pendingContacts.length,
            sender: currentSender.name,
            recipient: contact.phone_number,
            template: selectedTemplate.title
          });
        }
      } catch (err) {
        console.error(\`[Queue] Failed to send to \${contact.phone_number}:\`, err.message);
        db.prepare("UPDATE campaign_contacts SET status = 'failed', error_message = ? WHERE id = ?")
          .run(err.message, contact.id);
      }

      // 5. BATCH COOLDOWN BREAK: Check if batch limit is reached
      if (batchCounter >= campaign.batch_size && i < pendingContacts.length - 1) {
        console.log(\`[Queue] Batch of \${campaign.batch_size} reached. Taking cooldown break for \${campaign.break_duration_seconds} seconds...\`);
        batchCounter = 0;
        await sleep(campaign.break_duration_seconds * 1000);
      } else if (i < pendingContacts.length - 1) {
        // 6. DYNAMIC RANDOM DELAY between individual messages
        const delaySeconds = getRandomInt(campaign.min_delay_seconds, campaign.max_delay_seconds);
        console.log(\`[Queue] Waiting dynamic delay of \${delaySeconds}s before next contact...\`);
        await sleep(delaySeconds * 1000);
      }
    }

    db.prepare("UPDATE campaigns SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(campaignId);
    this.activeCampaigns.delete(campaignId);
    console.log(\`[Queue] Campaign \${campaignId} execution finished.\`);
  }

  pauseCampaign(campaignId) {
    const ctrl = this.activeCampaigns.get(campaignId);
    if (ctrl) ctrl.isPaused = true;
    db.prepare("UPDATE campaigns SET status = 'paused' WHERE id = ?").run(campaignId);
  }

  resumeCampaign(campaignId) {
    const ctrl = this.activeCampaigns.get(campaignId);
    if (ctrl) ctrl.isPaused = false;
    db.prepare("UPDATE campaigns SET status = 'running' WHERE id = ?").run(campaignId);
  }

  stopCampaign(campaignId) {
    const ctrl = this.activeCampaigns.get(campaignId);
    if (ctrl) ctrl.isStopped = true;
    db.prepare("UPDATE campaigns SET status = 'cancelled' WHERE id = ?").run(campaignId);
  }
}

module.exports = new QueueEngine();
`
  },
  {
    filename: 'warmupEngine.js',
    path: 'backend/services/warmupEngine.js',
    language: 'javascript',
    description: 'Background peer-to-peer automated dialogue generator between connected accounts',
    category: 'backend',
    content: `// Account Warm-up System (Anti-Ban Reputation Engine)
// File: backend/services/warmupEngine.js
const cron = require('node-cron');
const db = require('../db');
const baileysManager = require('./baileysManager');

const NATURAL_DIALOGUES = [
  ["Hey there, did you verify the database export from earlier?", "Yes, just reviewed it. All records matched."],
  ["Morning! Quick question, are we meeting at 3 PM today?", "Hey! Yes, 3 PM on Google Meet."],
  ["Did you review the project presentation slides?", "Looking through section 4 right now. Looks great!"],
  ["Thanks for the quick turnaround on that report.", "Anytime! Let me know if you need more details."],
  ["Can you resend the attachment link?", "Sure, sending the link right now."],
  ["All test cases passed on the local branch.", "Excellent! Push it to main when ready."]
];

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

class WarmupEngine {
  constructor() {
    this.isRunning = false;
    this.cronTask = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Runs every 5 minutes: picks 2 connected accounts with warmup_enabled = 1
    this.cronTask = cron.schedule('*/5 * * * *', async () => {
      try {
        await this.executeWarmupRound();
      } catch (err) {
        console.error('[Warmup Engine] Error during warmup round:', err.message);
      }
    });

    console.log('[Warmup Engine] Peer-to-peer warmup scheduler started (every 5 mins).');
  }

  async executeWarmupRound() {
    const activeAccounts = db.prepare(\`
      SELECT * FROM accounts
      WHERE status = 'CONNECTED' AND warmup_enabled = 1 AND daily_sent_count < daily_limit
    \`).all();

    if (activeAccounts.length < 2) {
      // Need at least 2 connected accounts to simulate peer-to-peer conversation
      return;
    }

    // Pick 2 distinct accounts randomly
    const sender = getRandomItem(activeAccounts);
    const receiver = getRandomItem(activeAccounts.filter(a => a.id !== sender.id));

    const dialoguePair = getRandomItem(NATURAL_DIALOGUES);
    const message1 = dialoguePair[0];
    const replyMessage = dialoguePair[1];

    console.log(\`[Warmup] Simulating dialogue: \${sender.name} -> \${receiver.name}\`);

    // Sender sends first message
    await baileysManager.sendMessage(sender.id, receiver.phone_number, message1, null, 2);
    db.prepare(\`
      INSERT INTO warmup_logs (id, from_account_id, from_phone, to_account_id, to_phone, message_content)
      VALUES (?, ?, ?, ?, ?, ?)
    \`).run('wup_' + Date.now(), sender.id, sender.phone_number, receiver.id, receiver.phone_number, message1);

    // Receiver responds after a natural 15-45 second delay
    const delaySec = Math.floor(Math.random() * 30) + 15;
    setTimeout(async () => {
      try {
        await baileysManager.sendMessage(receiver.id, sender.phone_number, replyMessage, null, 2);
        db.prepare(\`
          INSERT INTO warmup_logs (id, from_account_id, from_phone, to_account_id, to_phone, message_content)
          VALUES (?, ?, ?, ?, ?, ?)
        \`).run('wup_' + Date.now(), receiver.id, receiver.phone_number, sender.id, sender.phone_number, replyMessage);
      } catch (e) {
        console.error('[Warmup] Failed to send reply:', e.message);
      }
    }, delaySec * 1000);
  }

  stop() {
    if (this.cronTask) this.cronTask.stop();
    this.isRunning = false;
    console.log('[Warmup Engine] Stopped.');
  }
}

module.exports = new WarmupEngine();
`
  },
  {
    filename: 'server.js',
    path: 'backend/server.js',
    language: 'javascript',
    description: 'Express local REST API with CORS, SQLite integration, SSE for QR codes, and campaign endpoints',
    category: 'backend',
    content: `// Express Local Server
// File: backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const baileysManager = require('./services/baileysManager');
const queueEngine = require('./services/queueEngine');
const warmupEngine = require('./services/warmupEngine');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for local Next.js frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. GET Accounts
app.get('/api/accounts', (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all();
  // enrich with live socket state
  const enriched = accounts.map(acc => ({
    ...acc,
    status: baileysManager.getStatus(acc.id)
  }));
  res.json(enriched);
});

// 2. CREATE or INITIALIZE Account & Get QR Code
app.post('/api/accounts/create', async (req, res) => {
  const { name, phone_number } = req.body;
  const id = 'acc_' + Date.now();
  const sessionPath = path.join('./sessions', \`session_\${id}\`);

  db.prepare(\`
    INSERT INTO accounts (id, name, phone_number, session_path, status)
    VALUES (?, ?, ?, ?, 'CONNECTING')
  \`).run(id, name, phone_number || '', sessionPath);

  // Initialize Baileys socket
  await baileysManager.initAccount(id, 
    (accId, qrCode) => {
      // QR callback
    },
    (accId, status, code, user) => {
      db.prepare('UPDATE accounts SET status = ?, phone_number = ? WHERE id = ?')
        .run(status, user?.id?.split(':')[0] || phone_number, accId);
    }
  );

  res.json({ success: true, accountId: id });
});

// 3. GET Live QR Code for Account
app.get('/api/accounts/qr/:id', (req, res) => {
  const { id } = req.params;
  const qr = baileysManager.getQrCode(id);
  const status = baileysManager.getStatus(id);
  res.json({ qr, status });
});

// 4. CREATE Campaign with Dynamic Timings & Templates
app.post('/api/campaigns/create', (req, res) => {
  const {
    name,
    rotation_strategy = 'round-robin',
    min_delay_seconds = 10,
    max_delay_seconds = 35,
    batch_size = 10,
    break_duration_seconds = 120,
    typing_delay_seconds = 3,
    sender_account_ids = [],
    templates = [],
    contacts = []
  } = req.body;

  const campaignId = 'cmp_' + Date.now();

  const insertCampaign = db.transaction(() => {
    db.prepare(\`
      INSERT INTO campaigns (
        id, name, rotation_strategy, min_delay_seconds, max_delay_seconds,
        batch_size, break_duration_seconds, typing_delay_seconds, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    \`).run(
      campaignId, name, rotation_strategy, min_delay_seconds, max_delay_seconds,
      batch_size, break_duration_seconds, typing_delay_seconds
    );

    // Link senders
    const insertSender = db.prepare('INSERT INTO campaign_senders (campaign_id, account_id) VALUES (?, ?)');
    for (const accId of sender_account_ids) {
      insertSender.run(campaignId, accId);
    }

    // Insert templates
    const insertTpl = db.prepare(\`
      INSERT INTO campaign_templates (id, campaign_id, title, content, media_url, media_type, file_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    \`);
    for (const tpl of templates) {
      insertTpl.run('tpl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4), campaignId, tpl.title, tpl.content, tpl.media_url, tpl.media_type, tpl.file_name);
    }

    // Insert contacts
    const insertContact = db.prepare(\`
      INSERT INTO campaign_contacts (id, campaign_id, phone_number, name, company, custom_var1, custom_var2)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    \`);
    for (const c of contacts) {
      insertContact.run('c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4), campaignId, c.phoneNumber, c.name, c.company, c.customVar1, c.customVar2);
    }
  });

  insertCampaign();
  res.json({ success: true, campaignId });
});

// 5. START / PAUSE / RESUME Campaign
app.post('/api/campaigns/:id/start', (req, res) => {
  queueEngine.startCampaign(req.params.id);
  res.json({ success: true, status: 'started' });
});

app.post('/api/campaigns/:id/pause', (req, res) => {
  queueEngine.pauseCampaign(req.params.id);
  res.json({ success: true, status: 'paused' });
});

app.post('/api/campaigns/:id/resume', (req, res) => {
  queueEngine.resumeCampaign(req.params.id);
  res.json({ success: true, status: 'resumed' });
});

// 6. Delivery Logs
app.get('/api/logs', (req, res) => {
  const logs = db.prepare('SELECT * FROM delivery_logs ORDER BY timestamp DESC LIMIT 100').all();
  res.json(logs);
});

// 7. Auto Responders
app.get('/api/auto-responders', (req, res) => {
  const rules = db.prepare('SELECT * FROM auto_responders ORDER BY created_at DESC').all();
  res.json(rules);
});

// Start warmup service on boot
warmupEngine.start();

app.listen(PORT, () => {
  console.log(\`[Server] YUHUSULU CRM backend listening at http://localhost:\${PORT}\`);
});
`
  },
  {
    filename: 'CampaignWizard.tsx',
    path: 'frontend/components/CampaignWizard.tsx',
    language: 'typescript',
    description: 'Next.js React component for dynamic timings (min/max delay, batch size, break), sender & template rotation',
    category: 'frontend',
    content: `// Next.js React Component: Campaign Creation Wizard
// File: frontend/components/CampaignWizard.tsx
'use client';

import React, { useState } from 'react';
import { Clock, Users, FileText, Upload, Plus, Trash2, Play } from 'lucide-react';

export default function CampaignWizard({ accounts, onCampaignCreated }) {
  const [name, setName] = useState('');
  const [selectedSenders, setSelectedSenders] = useState<string[]>([]);
  const [rotationStrategy, setRotationStrategy] = useState<'round-robin' | 'random'>('round-robin');
  
  // DYNAMIC TIMING STATE (CRITICAL REQUIREMENTS)
  const [minDelay, setMinDelay] = useState(10);
  const [maxDelay, setMaxDelay] = useState(35);
  const [batchSize, setBatchSize] = useState(10);
  const [breakDuration, setBreakDuration] = useState(120); // in seconds

  // MULTIPLE TEMPLATES
  const [templates, setTemplates] = useState([
    { id: '1', title: 'Template A (Intro)', content: '{Hi|Hello} {{name}}, noticed your work at {{company}}!' },
    { id: '2', title: 'Template B (Direct)', content: 'Greetings {{name}}, following up on our project proposal.' }
  ]);

  const addTemplate = () => {
    setTemplates([
      ...templates,
      { id: Date.now().toString(), title: \`Template \${String.fromCharCode(65 + templates.length)}\`, content: 'Hello {{name}}!' }
    ]);
  };

  const handleCreate = async () => {
    const payload = {
      name,
      rotation_strategy: rotationStrategy,
      min_delay_seconds: minDelay,
      max_delay_seconds: maxDelay,
      batch_size: batchSize,
      break_duration_seconds: breakDuration,
      sender_account_ids: selectedSenders,
      templates
    };

    const res = await fetch('http://localhost:5000/api/campaigns/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success && onCampaignCreated) onCampaignCreated(data.campaignId);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-slate-100 max-w-4xl mx-auto space-y-6">
      <h2 className="text-xl font-bold">Create Dynamic WhatsApp Campaign</h2>

      {/* Dynamic Timing Settings */}
      <div className="bg-slate-950/60 p-4 rounded-lg border border-slate-800 space-y-4">
        <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
          <Clock className="w-4 h-4" /> Dynamic Anti-Ban Timing Controls
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-slate-400">Min Delay (seconds)</label>
            <input
              type="number"
              value={minDelay}
              onChange={(e) => setMinDelay(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Max Delay (seconds)</label>
            <input
              type="number"
              value={maxDelay}
              onChange={(e) => setMaxDelay(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Batch Size (msgs)</label>
            <input
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Break Duration (sec)</label>
            <input
              type="number"
              value={breakDuration}
              onChange={(e) => setBreakDuration(Number(e.target.value))}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm font-mono"
            />
          </div>
        </div>
      </div>

      {/* Multi-Sender Rotation */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-emerald-400" /> Sender Account Rotation (Round-Robin)
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {accounts.map((acc) => (
            <label key={acc.id} className="flex items-center gap-2 text-sm bg-slate-950 p-3 rounded border border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedSenders.includes(acc.id)}
                onChange={(e) => {
                  setSelectedSenders(e.target.checked
                    ? [...selectedSenders, acc.id]
                    : selectedSenders.filter(id => id !== acc.id));
                }}
              />
              <span>{acc.name} ({acc.phone_number})</span>
            </label>
          ))}
        </div>
      </div>

      {/* Multiple Message Templates */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" /> Template Rotation (Spintax & Variables)
          </h3>
          <button onClick={addTemplate} className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> Add Template
          </button>
        </div>

        {templates.map((tpl, idx) => (
          <div key={tpl.id} className="p-3 bg-slate-950 border border-slate-800 rounded space-y-2">
            <input
              type="text"
              value={tpl.title}
              onChange={(e) => {
                const next = [...templates];
                next[idx].title = e.target.value;
                setTemplates(next);
              }}
              className="w-full bg-slate-900 border border-slate-800 px-2 py-1 text-xs font-semibold rounded"
            />
            <textarea
              rows={2}
              value={tpl.content}
              onChange={(e) => {
                const next = [...templates];
                next[idx].content = e.target.value;
                setTemplates(next);
              }}
              className="w-full bg-slate-900 border border-slate-800 px-2 py-1 text-xs font-mono rounded"
            />
          </div>
        ))}
      </div>

      <button onClick={handleCreate} className="w-full bg-emerald-600 hover:bg-emerald-500 py-2.5 rounded font-medium flex items-center justify-center gap-2">
        <Play className="w-4 h-4" /> Save & Launch Campaign
      </button>
    </div>
  );
}
`
  },
  {
    filename: 'QRCodeModal.tsx',
    path: 'frontend/components/QRCodeModal.tsx',
    language: 'typescript',
    description: 'Next.js component to generate QR code via API, poll connection state, and connect WhatsApp',
    category: 'frontend',
    content: `// Next.js Component: QR Code Scanner Modal
// File: frontend/components/QRCodeModal.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Smartphone, RefreshCw, X, CheckCircle } from 'lucide-react';

interface Props {
  accountId: string;
  accountName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function QRCodeModal({ accountId, accountName, onClose, onSuccess }: Props) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('CONNECTING');

  useEffect(() => {
    let interval = setInterval(async () => {
      try {
        const res = await fetch(\`http://localhost:5000/api/accounts/qr/\${accountId}\`);
        const data = await res.json();
        if (data.qr) setQrCodeDataUrl(data.qr);
        if (data.status === 'CONNECTED') {
          setStatus('CONNECTED');
          clearInterval(interval);
          setTimeout(() => onSuccess(), 1500);
        }
      } catch (err) {
        console.error('QR polling error', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [accountId, onSuccess]);

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-sm w-full space-y-4 text-center">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-slate-100">Connect {accountName}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {status === 'CONNECTED' ? (
          <div className="py-8 space-y-2">
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto animate-bounce" />
            <p className="text-sm font-medium text-emerald-300">Account Connected Successfully!</p>
            <p className="text-xs text-slate-400">Session saved to local storage folder.</p>
          </div>
        ) : (
          <>
            <div className="bg-white p-4 rounded-xl flex items-center justify-center min-h-[220px]">
              {qrCodeDataUrl ? (
                <img src={qrCodeDataUrl} alt="WhatsApp QR Code" className="w-56 h-56" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-600">
                  <RefreshCw className="w-8 h-8 animate-spin" />
                  <span className="text-xs">Generating secure Baileys QR...</span>
                </div>
              )}
            </div>
            <div className="text-xs text-slate-400 space-y-1">
              <p>1. Open WhatsApp on your phone</p>
              <p>2. Tap Settings &gt; Linked Devices &gt; Link a Device</p>
              <p>3. Point your camera at this QR code</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
`
  }
];
