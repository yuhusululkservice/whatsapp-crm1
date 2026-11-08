import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  Plus,
  Battery,
  ShieldCheck,
  Flame,
  CheckCircle,
  RefreshCw,
  Trash2,
  HardDrive,
  ExternalLink,
  X,
  AlertCircle,
  Send,
  QrCode,
  KeyRound,
  CheckCheck,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Download,
  Upload,
  Database,
  Info,
  Sparkles
} from 'lucide-react';
import { WhatsAppAccount } from '../types';
import { uploadMediaWithChunks } from '../utils/chunkedUploader';
import {
  saveAccountSessionToIndexedDB,
  getAllAccountSessionsFromIndexedDB,
  removeAccountSessionFromIndexedDB
} from '../utils/vaultStorage';

interface Props {
  accounts: WhatsAppAccount[];
  onAddAccount: (account: WhatsAppAccount) => void;
  onUpdateAccount: (account: WhatsAppAccount) => void;
  onDeleteAccount: (accountId: string) => void;
  onTriggerWarmupToggle: (accountId: string) => void;
  isAddModalOpen: boolean;
  setIsAddModalOpen: (open: boolean) => void;
  fetchAccountsFromServer: () => Promise<void>;
}

export const AccountsView: React.FC<Props> = ({
  accounts,
  onAddAccount,
  onUpdateAccount,
  onDeleteAccount,
  onTriggerWarmupToggle,
  isAddModalOpen,
  setIsAddModalOpen,
  fetchAccountsFromServer
}) => {
  // Modal state
  const [newAccountName, setNewAccountName] = useState('');
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>('CONNECTING');
  const [linkedPhoneNumber, setLinkedPhoneNumber] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [qrWaitSeconds, setQrWaitSeconds] = useState<number>(0);

  // Direct Real Message Tester State
  const [testPhoneNumber, setTestPhoneNumber] = useState<string>('');
  const [testMessageText, setTestMessageText] = useState<string>('Hello! This is a real test message sent from YUHUSULU CRM via Baileys WebSockets.');
  const [testMediaPreview, setTestMediaPreview] = useState<string | null>(null);
  const [testMediaInfo, setTestMediaInfo] = useState<{ fileUrl?: string; filePath?: string; fileName?: string } | null>(null);
  const [isUploadingMedia, setIsUploadingMedia] = useState<boolean>(false);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [testSendResult, setTestSendResult] = useState<{ success: boolean; text: string } | null>(null);

  const [selectedAccountIdForQr, setSelectedAccountIdForQr] = useState<string | null>(null);

  // Master Session Vault & Disaster Recovery State
  const [isExportingMaster, setIsExportingMaster] = useState<boolean>(false);
  const [isRestoringMaster, setIsRestoringMaster] = useState<boolean>(false);
  const [masterVaultNotice, setMasterVaultNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showHostingExplainer, setShowHostingExplainer] = useState<boolean>(false);
  const masterFileInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleDownloadMasterBackup = async () => {
    setIsExportingMaster(true);
    setMasterVaultNotice(null);
    try {
      const res = await fetch('/api/accounts/export-all-backup');
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `yuhusulu_whatsapp_master_vault_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setMasterVaultNotice({
          type: 'success',
          text: '✓ Master Vault Exported! All connected WhatsApp keys saved to your computer. You can restore this file with 1 click anytime.'
        });
      } else {
        throw new Error('Server returned an error generating master backup');
      }
    } catch (e: any) {
      setMasterVaultNotice({ type: 'error', text: 'Failed to download master backup: ' + e.message });
    } finally {
      setIsExportingMaster(false);
      setTimeout(() => setMasterVaultNotice(null), 8000);
    }
  };

  const handleUploadMasterBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsRestoringMaster(true);
    setMasterVaultNotice(null);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const accountsList = parsed.accounts || (Array.isArray(parsed) ? parsed : []);

      if (!Array.isArray(accountsList) || accountsList.length === 0) {
        throw new Error('No valid accounts found in this backup JSON file.');
      }

      const res = await fetch('/api/accounts/import-all-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: accountsList })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMasterVaultNotice({
          type: 'success',
          text: `✓ Success! Restored ${data.restoredCount || accountsList.length} WhatsApp accounts without scanning any QR codes!`
        });
        await fetchAccountsFromServer();
      } else {
        throw new Error(data.error || 'Failed to restore accounts from backup file.');
      }
    } catch (err: any) {
      setMasterVaultNotice({ type: 'error', text: err.message || 'Error restoring backup' });
    } finally {
      setIsRestoringMaster(false);
      if (masterFileInputRef.current) masterFileInputRef.current.value = '';
      setTimeout(() => setMasterVaultNotice(null), 8000);
    }
  };

  const handleRestoreFromBrowserMemory = async () => {
    setIsRestoringMaster(true);
    setMasterVaultNotice(null);

    try {
      const storedSessions = await getAllAccountSessionsFromIndexedDB();
      if (!storedSessions || storedSessions.length === 0) {
        throw new Error('No saved WhatsApp sessions found in browser IndexedDB memory yet. Connect accounts first or upload a backup file.');
      }

      const accountsPayload = storedSessions.map(s => ({
        id: s.accountId,
        name: s.accountName,
        phoneNumber: s.phoneNumber,
        keys: s.keys
      }));

      const res = await fetch('/api/accounts/import-all-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: accountsPayload })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMasterVaultNotice({
          type: 'success',
          text: `⚡ Restored ${data.restoredCount || storedSessions.length} accounts directly from Browser Memory without QR!`
        });
        await fetchAccountsFromServer();
      } else {
        throw new Error(data.error || 'Failed to restore sessions from memory.');
      }
    } catch (err: any) {
      setMasterVaultNotice({ type: 'error', text: err.message });
    } finally {
      setIsRestoringMaster(false);
      setTimeout(() => setMasterVaultNotice(null), 8000);
    }
  };

  const openQrForAccount = (acc: WhatsAppAccount) => {
    setSelectedAccountIdForQr(acc.id);
    setActiveAccountId(acc.id);
    setNewAccountName(acc.name);
    setQrCodeDataUrl(null);
    setConnectionStatus(acc.status || 'CONNECTING');
    setLinkedPhoneNumber(acc.phoneNumber || null);
    setErrorMessage(null);
    setIsAddModalOpen(true);
  };

  const handleRefreshQr = async () => {
    if (!activeAccountId) return;
    setQrCodeDataUrl(null);
    setConnectionStatus('CONNECTING');
    try {
      // User explicitly requested fresh QR code
      await fetch(`/api/accounts/reconnect/${activeAccountId}?forceNewQr=true`, { method: 'POST' });
    } catch (e) {
      console.error('Refresh QR error:', e);
    }
  };

  const handleResetSession = async () => {
    if (!activeAccountId) return;
    if (!window.confirm('Are you sure you want to completely unlink this WhatsApp account and reset the session?')) return;
    setQrCodeDataUrl(null);
    setConnectionStatus('CONNECTING');
    try {
      await fetch(`/api/accounts/reset/${activeAccountId}`, { method: 'POST' });
      try {
        localStorage.removeItem(`wa_vault_${activeAccountId}`);
      } catch (e) {}
    } catch (e) {
      console.error('Reset session error:', e);
    }
  };

  // When modal opens, initialize or fetch real account QR on server (never wipe existing credentials!)
  useEffect(() => {
    let pollingInterval: any = null;

    if (isAddModalOpen) {
      setIsInitializing(true);
      setErrorMessage(null);
      setQrWaitSeconds(0);

      const targetIdPromise = selectedAccountIdForQr
        ? fetch(`/api/accounts/reconnect/${selectedAccountIdForQr}?forceNewQr=true`, { method: 'POST' })
            .then(async res => {
              if (!res.ok) {
                const text = await res.text();
                throw new Error(`HTTP ${res.status}: Backend server offline or endpoint not found (${text.slice(0, 80)})`);
              }
              return res.json();
            })
            .then(() => selectedAccountIdForQr)
        : fetch('/api/accounts/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newAccountName || `WhatsApp Node 0${accounts.length + 1}` })
          })
            .then(async res => {
              if (!res.ok) {
                const text = await res.text();
                throw new Error(`HTTP ${res.status}: Hostinger Node.js app is offline or /api/accounts/create unreachable (${text.slice(0, 80)})`);
              }
              const data = await res.json();
              if (!data?.account?.id) throw new Error(data?.error || 'No account ID received from server');
              return data.account.id;
            });

      targetIdPromise
        .then((targetId: string) => {
          setIsInitializing(false);
          if (targetId) {
            setActiveAccountId(targetId);

            // Poll for real QR code & connection updates
            pollingInterval = setInterval(async () => {
              setQrWaitSeconds(prev => prev + 1);
              try {
                const qrRes = await fetch(`/api/accounts/qr/${targetId}`);
                if (!qrRes.ok) {
                  throw new Error(`HTTP ${qrRes.status} on /api/accounts/qr. Server not responding.`);
                }
                const qrData = await qrRes.json();

                if (qrData.error) {
                  setErrorMessage(qrData.error);
                }

                if (qrData.qr) {
                  setQrCodeDataUrl(qrData.qr);
                  setErrorMessage(null);
                }

                if (qrData.status) {
                  setConnectionStatus(qrData.status);
                }

                if (qrData.status === 'CONNECTED') {
                  const phone = qrData.account?.phoneNumber;
                  setLinkedPhoneNumber(phone || 'Connected');
                  clearInterval(pollingInterval);
                  await fetchAccountsFromServer();

                  // Auto-sync session keys to browser persistent storage for multi-month resilience
                  try {
                    const vaultRes = await fetch(`/api/accounts/vault/${targetId}`);
                    if (vaultRes.ok) {
                      const vaultData = await vaultRes.json();
                      if (vaultData.keys) {
                        localStorage.setItem(`wa_vault_${targetId}`, JSON.stringify(vaultData.keys));
                        console.log(`[Session Sync] Backed up WhatsApp session keys to browser storage for ${targetId}`);
                      }
                    }
                  } catch (vErr) {
                    console.warn('Could not sync vault to browser:', vErr);
                  }
                }
              } catch (err: any) {
                console.error('Polling error:', err);
                setErrorMessage('Connection error: ' + err.message);
              }
            }, 1500);
          } else {
            setIsInitializing(false);
            setErrorMessage('Could not initialize account. Make sure Hostinger Node.js app is running.');
          }
        })
        .catch((err: any) => {
          setIsInitializing(false);
          setErrorMessage('Failed to connect to backend: ' + err.message);
        });
    }

    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [isAddModalOpen, selectedAccountIdForQr]);

  // Handle local media file upload
  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingMedia(true);

    // Generate local preview URL
    const localPreview = URL.createObjectURL(file);
    setTestMediaPreview(localPreview);

    try {
      const data = await uploadMediaWithChunks(file);
      if (data && data.success) {
        setTestMediaInfo({
          fileUrl: data.fileUrl,
          filePath: data.filePath,
          fileName: data.fileName
        });
      }
    } catch (err: any) {
      console.warn('Direct upload fallback to base64:', err.message);
      const reader = new FileReader();
      reader.onload = () => {
        setTestMediaInfo({
          fileUrl: reader.result as string,
          fileName: file.name
        });
      };
      reader.readAsDataURL(file);
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleClearMedia = () => {
    setTestMediaPreview(null);
    setTestMediaInfo(null);
  };

  // Handle direct message send test
  const handleSendRealTestMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhoneNumber.trim() || (!testMessageText.trim() && !testMediaInfo)) return;

    setIsSendingTest(true);
    setTestSendResult(null);

    try {
      const res = await fetch('/api/messages/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: testPhoneNumber,
          message: testMessageText,
          mediaUrl: testMediaInfo?.fileUrl,
          filePath: testMediaInfo?.filePath,
          fileName: testMediaInfo?.fileName
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestSendResult({
          success: true,
          text: `Message ${testMediaInfo ? 'with Photo/Attachment ' : ''}successfully sent to ${testPhoneNumber} via real WhatsApp WebSocket! (ID: ${data.messageId || 'OK'})`
        });
        await fetchAccountsFromServer();
      } else {
        setTestSendResult({
          success: false,
          text: data.error || 'Failed to send. Ensure at least one WhatsApp account is linked and active.'
        });
      }
    } catch (err: any) {
      setTestSendResult({
        success: false,
        text: 'Error contacting server: ' + err.message
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleReconnect = async (accId: string) => {
    try {
      await fetch(`/api/accounts/reconnect/${accId}`, { method: 'POST' });
      await fetchAccountsFromServer();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (accId: string) => {
    try {
      // 1. Permanently remove from Browser IndexedDB
      await removeAccountSessionFromIndexedDB(accId);

      // 2. Permanently remove from localStorage session vault
      localStorage.removeItem(`wa_vault_${accId}`);

      // 3. Mark as deleted in localStorage so disaster recovery NEVER re-imports it
      try {
        const deletedIds: string[] = JSON.parse(localStorage.getItem('wa_deleted_accounts') || '[]');
        if (!deletedIds.includes(accId)) {
          deletedIds.push(accId);
          localStorage.setItem('wa_deleted_accounts', JSON.stringify(deletedIds));
        }
        const storedAccsStr = localStorage.getItem('yuhusulu_accounts');
        if (storedAccsStr) {
          const storedAccs = JSON.parse(storedAccsStr);
          if (Array.isArray(storedAccs)) {
            localStorage.setItem('yuhusulu_accounts', JSON.stringify(storedAccs.filter((a: any) => a.id !== accId)));
          }
        }
      } catch (e) {}

      // 4. Request server delete
      await fetch(`/api/accounts/${accId}`, { method: 'DELETE' });
      onDeleteAccount(accId);
      await fetchAccountsFromServer();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight">
              Real WhatsApp Accounts Manager
            </h1>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded">
              BAILEYS MULTI-DEVICE
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Scan with your official WhatsApp mobile app to establish a real multi-device session stored persistently on disk.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg shadow-sm transition-colors whitespace-nowrap self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>Link Real WhatsApp (Scan QR)</span>
        </button>
      </div>

      {/* Hidden File Input for Master Backup Import */}
      <input
        ref={masterFileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleUploadMasterBackupFile}
        className="hidden"
      />

      {/* Master Session Vault & Disaster Recovery Strip */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Permanent Session Vault & 1-Click Disaster Recovery
              </h3>
              <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/70 border border-emerald-800/80 px-2 py-0.5 rounded">
                Zero-QR Recovery
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Save all 4 accounts' cryptographic keys to your computer or browser memory so you never have to scan QR codes again if the container restarts.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleRestoreFromBrowserMemory}
              disabled={isRestoringMaster}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              title="Restores sessions from browser IndexedDB cache"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isRestoringMaster ? 'Restoring...' : 'Restore from Browser'}</span>
            </button>

            <button
              onClick={() => masterFileInputRef.current?.click()}
              disabled={isRestoringMaster}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
              title="Upload previously downloaded JSON session vault"
            >
              <Upload className="w-3.5 h-3.5 text-slate-400" />
              <span>Import Backup File</span>
            </button>

            <button
              onClick={handleDownloadMasterBackup}
              disabled={isExportingMaster}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
              title="Download all accounts' sessions as a single JSON file"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isExportingMaster ? 'Exporting...' : 'Export Vault (.json)'}</span>
            </button>

            <button
              onClick={() => setShowHostingExplainer(!showHostingExplainer)}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 px-2.5 py-1.5 bg-slate-950/60 rounded-lg border border-slate-800/80 transition-colors cursor-pointer"
            >
              <Info className="w-3 h-3 text-cyan-400" />
              <span>{showHostingExplainer ? 'Hide Cloud Info' : 'Why Sessions Disconnect?'}</span>
            </button>
          </div>
        </div>

        {/* Master Vault Notice */}
        {masterVaultNotice && (
          <div className={`p-3 rounded-lg border text-xs flex items-center gap-2 animate-fadeIn ${
            masterVaultNotice.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}>
            {masterVaultNotice.type === 'success' ? (
              <CheckCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{masterVaultNotice.text}</span>
          </div>
        )}

        {/* Hostinger Hosting & 24/7 VPS Deployment Guide */}
        {showHostingExplainer && (
          <div className="bg-slate-950/95 border border-cyan-800/60 rounded-xl p-5 space-y-4 text-xs animate-fadeIn">
            <div className="flex items-start gap-2.5">
              <Info className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
              <div className="space-y-3 flex-1">
                <h4 className="font-bold text-white text-sm">
                  Hostinger Hosting & 24/7 WhatsApp Session Continuity Guide (සම්පූර්ණ පැහැදිලි කිරීම)
                </h4>

                <div className="space-y-2 text-slate-300 text-[11px] leading-relaxed">
                  <div className="p-3 bg-cyan-950/40 border border-cyan-500/40 rounded-lg">
                    <p className="font-bold text-cyan-300 mb-1 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-cyan-400" />
                      <span>🛡️ 100% Modern TypeScript &amp; Node.js (Zero PHP · Zero Legacy Vulnerabilities):</span>
                    </p>
                    <p className="text-slate-300">
                      අපගේ මෙම සම්පූර්ණ පද්ධතියේ <strong>PHP බින්දුවක්වත් (0%) භාවිතා කර නැත</strong>. මෙය 100% ක්ම ගොඩනගා ඇත්තේ ලොව ප්‍රමුඛතම, අධි-ආරක්ෂිත <strong>TypeScript, Node.js (v20+), Express, React 19, සහ Baileys WebSockets</strong> තාක්ෂණයන්ගෙනි. එබැවින් PHP හි ඇති Remote Code Execution (RCE) හෝ File Inclusion වැනි කිසිදු Hacking/Security අවදානමක් මෙම පද්ධතියේ කිසිසේත්ම නොමැත!
                    </p>
                  </div>

                  <div className="p-3 bg-cyan-950/40 border border-cyan-500/40 rounded-lg">
                    <p className="font-bold text-cyan-300 mb-1 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-cyan-400" />
                      <span>🛡️ 100% Modern TypeScript &amp; Node.js (Zero PHP · Zero Legacy Vulnerabilities):</span>
                    </p>
                    <p className="text-slate-300">
                      අපගේ මෙම සම්පූර්ණ පද්ධතියේ <strong>PHP බින්දුවක්වත් (0%) භාවිතා කර නැත</strong>. මෙය 100% ක්ම ගොඩනගා ඇත්තේ ලොව ප්‍රමුඛතම, අධි-ආරක්ෂිත <strong>TypeScript, Node.js (v20+), Express, React 19, සහ Baileys WebSockets</strong> තාක්ෂණයන්ගෙනි.
                    </p>
                  </div>

                  {/* Hostinger Business Web Hosting Plan Guide */}
                  <div className="p-4 bg-emerald-950/40 border border-emerald-500/40 rounded-lg space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <p className="font-bold text-emerald-300 flex items-center gap-2">
                        <span>🌟 Hostinger Business Web Hosting එකේ Run කරන හැටි (A to Z Guide):</span>
                      </p>
                      <a
                        href="/downloads/yuhusulu_whatsapp_crm_hostinger.zip"
                        download="yuhusulu_whatsapp_crm_hostinger.zip"
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-md shadow-xs transition-colors shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Hostinger ZIP (1.29 MB)</span>
                      </a>
                    </div>
                    <div className="space-y-1.5 text-slate-300 text-[11px] leading-relaxed">
                      <p>
                        <strong className="text-white">1. File Manager:</strong> ඉහත ZIP එක බාගත කර, Hostinger hPanel &gt; File Manager හරහා <code className="text-emerald-400">public_html</code> වෙත Upload කර Extract කරන්න.
                      </p>
                      <p>
                        <strong className="text-white">2. Node.js සක්‍රීය කිරීම:</strong> hPanel &gt; Advanced &gt; <strong>Node.js</strong> වෙත ගොස් Root: <code className="text-cyan-400">public_html</code>, Startup File: <code className="text-cyan-400">server.js</code>, Node Version: <code className="text-cyan-400">20.x</code>, Mode: <code className="text-cyan-400">Production</code> තෝරා Save කරන්න.
                      </p>
                      <p>
                        <strong className="text-white">3. NPM Install:</strong> Node.js Manager හි ඇති <strong>"Run NPM Install"</strong> ඔබන්න. තත්පර 30න් dependencies ස්ථාපනය වේ. ඉන්පසු "Start App" ඔබන්න.
                      </p>
                      <p>
                        <strong className="text-white">4. Phone Auto-Logout වැළැක්වීම (Keep-Alive):</strong> Hostinger Shared/Business hosting වල Inactivity Sleep වීම වැළැක්වීමට <strong className="text-amber-300">UptimeRobot.com</strong> (නොමිලේ) හරහා <code className="text-amber-400">https://yourdomain.com/api/accounts</code> ලිපිනයට සෑම විනාඩි 2කට වරක් Ping එකක් සකසන්න. එවිට WhatsApp Session එක කිසිදා Logout නොවී 24/7/365 පවතී!
                      </p>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-1.5">
                    <p className="font-bold text-slate-300">
                      💡 විකල්ප ක්‍රමය: Hostinger KVM VPS එකක් භාවිතා කරන්නේ නම් (Direct Terminal):
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      ssh root@YOUR_IP &amp;&amp; apt install -y nodejs ffmpeg &amp;&amp; npm install -g pm2 &amp;&amp; pm2 start server.js --name whatsapp-crm
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Real Message Direct Tester Strip */}
      <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-5 space-y-4 shadow-lg shadow-emerald-950/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">
              Instant Real WhatsApp Test Message
            </h3>
          </div>
          <span className="text-[10px] font-mono text-emerald-400">
            Real WhatsApp Web Delivery
          </span>
        </div>

        <p className="text-xs text-slate-400">
          Enter any real phone number with country code (e.g. <span className="text-emerald-400 font-mono">+94 77 123 4567</span> or <span className="text-emerald-400 font-mono">+1 555 019 2831</span>) to verify real delivery from your connected account.
        </p>

        <form onSubmit={handleSendRealTestMessage} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Target Phone Number</label>
            <input
              type="text"
              placeholder="+94 7X XXX XXXX or +1 555..."
              value={testPhoneNumber}
              onChange={(e) => setTestPhoneNumber(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
              required
            />
          </div>

          <div className="sm:col-span-2 space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-[11px] text-slate-400 block mb-1">Message Content (Optional if Photo Attached)</label>
                <input
                  type="text"
                  placeholder="Type a caption or message..."
                  value={testMessageText}
                  onChange={(e) => setTestMessageText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Attach Photo Button */}
              <div>
                <label className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer border border-slate-700 transition-colors h-[34px]">
                  <Paperclip className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Attach Photo</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={handleMediaUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={isSendingTest || isUploadingMedia}
                className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-bold rounded flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer h-[34px]"
              >
                {isSendingTest ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Real Message</span>
                  </>
                )}
              </button>
            </div>

            {/* Media Attachment Thumbnail & Information */}
            {testMediaPreview && (
              <div className="flex items-center justify-between p-2.5 bg-slate-950/90 border border-emerald-500/40 rounded-lg">
                <div className="flex items-center gap-3">
                  {testMediaPreview.startsWith('blob:') || testMediaPreview.startsWith('data:image') || testMediaInfo?.fileName?.match(/\.(jpg|jpeg|png|webp)$/i) ? (
                    <img
                      src={testMediaPreview}
                      alt="Attachment Preview"
                      className="w-10 h-10 object-cover rounded-md border border-slate-700 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-md bg-slate-800 flex items-center justify-center text-slate-300 shrink-0">
                      <FileText className="w-5 h-5 text-emerald-400" />
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-white truncate max-w-[220px]">
                      {testMediaInfo?.fileName || 'Selected Attachment'}
                    </p>
                    <p className="text-[10px] text-emerald-400 font-mono">
                      {isUploadingMedia ? 'Uploading to local ./uploads...' : '✓ Ready to send directly via WhatsApp CDN (No hosting required)'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleClearMedia}
                  className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                  title="Remove attachment"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </form>

        {testSendResult && (
          <div className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
            testSendResult.success
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}>
            {testSendResult.success ? (
              <CheckCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{testSendResult.text}</span>
          </div>
        )}
      </div>

      {/* Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {accounts.map((acc) => {
          const isConnected = acc.status === 'CONNECTED';
          const quotaPercent = Math.min(100, Math.round((acc.dailySentCount / acc.dailyLimit) * 100));

          return (
            <div
              key={acc.id}
              className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-slate-700 transition-all"
            >
              <div className="space-y-4">
                {/* Account Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      isConnected
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}>
                      <Smartphone className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-white truncate">
                        {acc.name}
                      </h3>
                      <p className="text-xs font-mono text-emerald-400 font-medium truncate">
                        {acc.phoneNumber || 'Not linked yet'}
                      </p>
                    </div>
                  </div>

                  <span className={`text-[11px] font-mono px-2.5 py-0.5 rounded-md border flex items-center gap-1.5 ${
                    acc.status === 'CONNECTED'
                      ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/80 shadow-xs shadow-emerald-950/50'
                      : acc.status === 'CONNECTING'
                      ? 'bg-amber-950/70 text-amber-300 border-amber-800/80'
                      : acc.status === 'SCAN_REQUIRED'
                      ? 'bg-cyan-950/70 text-cyan-300 border-cyan-800/80'
                      : 'bg-rose-950/70 text-rose-300 border-rose-800/80'
                  }`}>
                    {acc.status === 'CONNECTED' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    )}
                    {acc.status === 'CONNECTING' && (
                      <RefreshCw className="w-2.5 h-2.5 animate-spin text-amber-400" />
                    )}
                    <span>
                      {acc.status === 'CONNECTED'
                        ? 'LIVE CONNECTED'
                        : acc.status === 'CONNECTING'
                        ? 'CONNECTING...'
                        : acc.status === 'SCAN_REQUIRED'
                        ? 'SCAN QR REQUIRED'
                        : 'DISCONNECTED'}
                    </span>
                  </span>
                </div>

                {/* Session Path & Health Data */}
                <div className="p-3 bg-slate-950/70 rounded-lg border border-slate-800/70 space-y-2 text-xs">
                  <div className="flex items-center justify-between text-slate-400">
                    <span className="flex items-center gap-1.5 font-mono text-[11px]">
                      <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                      <span className="truncate max-w-[170px]" title={acc.sessionPath}>
                        {acc.sessionPath}
                      </span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      Auth: MultiFile
                    </span>
                  </div>

                  {/* Quota Progress */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Daily Messages Sent</span>
                      <span className="font-mono text-slate-300">
                        {acc.dailySentCount} / {acc.dailyLimit}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          quotaPercent > 80 ? 'bg-amber-400' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${quotaPercent}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400 border-t border-slate-800/80">
                    <span>Delivered Total</span>
                    <span className="font-mono text-slate-300 font-semibold">{acc.totalDelivered.toLocaleString()}</span>
                  </div>
                </div>

                {/* Warm-up Toggle */}
                <div className="flex items-center justify-between px-1 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <Flame className={`w-3.5 h-3.5 ${acc.warmupEnabled ? 'text-amber-400' : 'text-slate-500'}`} />
                    <span>Auto Warm-up P2P</span>
                  </div>
                  <button
                    onClick={() => onTriggerWarmupToggle(acc.id)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      acc.warmupEnabled ? 'bg-emerald-500' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition duration-200 ease-in-out ${
                        acc.warmupEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 mt-4 border-t border-slate-800 flex items-center justify-between gap-2">
                <button
                  onClick={() => openQrForAccount(acc)}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    isConnected
                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                  }`}
                >
                  {isConnected ? 'Show QR / Re-link' : 'Scan QR & Connect'}
                </button>

                <button
                  onClick={() => handleDelete(acc.id)}
                  title="Delete Session"
                  className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* REAL BAILEYS QR CODE MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-emerald-400" />
                  <span>Scan Real WhatsApp QR Code</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Connects directly to WhatsApp Multi-Device WebSockets
                </p>
              </div>
              <button
                onClick={() => {
                  setIsAddModalOpen(false);
                  setSelectedAccountIdForQr(null);
                }}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Account Details Form */}
            <div>
              <label className="text-xs font-medium text-slate-300 block mb-1">
                Account Label
              </label>
              <input
                type="text"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="e.g. My Phone Node"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* QR Code Container */}
            <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex flex-col items-center justify-center min-h-[280px] text-center">
              {connectionStatus === 'CONNECTED' ? (
                <div className="flex flex-col items-center gap-3 text-emerald-400 py-6 animate-fadeIn">
                  <CheckCircle className="w-12 h-12 animate-bounce" />
                  <div className="space-y-1">
                    <span className="text-base font-bold">Successfully Connected!</span>
                    <p className="text-xs text-emerald-300 font-mono">
                      Phone Number: {linkedPhoneNumber || 'Active'}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Session keys saved locally in ./sessions/. You can now send real bulk messages!
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setIsAddModalOpen(false);
                      setSelectedAccountIdForQr(null);
                    }}
                    className="mt-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              ) : qrCodeDataUrl ? (
                <div className="space-y-3 animate-fadeIn">
                  <div className="bg-white p-3 rounded-xl inline-block shadow-lg border border-slate-200">
                    <img
                      src={qrCodeDataUrl}
                      alt="WhatsApp Web QR Code"
                      className="w-56 h-56 block mx-auto"
                    />
                  </div>
                  <div className="flex items-center justify-center gap-1.5 text-xs text-emerald-400 font-mono">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span>Live QR Code Active · Scan with WhatsApp on phone</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRefreshQr}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-emerald-400 bg-slate-900 hover:bg-slate-800 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Get New QR Code</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-slate-400 py-6 px-3">
                  <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
                  <div className="space-y-1 text-center">
                    <span className="text-xs font-semibold text-white block">
                      Connecting to WhatsApp WebSockets...
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono block">
                      Establishing Baileys multi-device socket session ({Math.round(qrWaitSeconds * 1.5)}s)
                    </span>
                  </div>

                  {/* Troubleshooting notice if waiting > 10s */}
                  {qrWaitSeconds > 6 && !qrCodeDataUrl && (
                    <div className="mt-2 p-3 bg-amber-950/70 border border-amber-500/50 rounded-xl text-left text-[11px] text-amber-200 space-y-2 animate-fadeIn max-w-sm">
                      <div className="flex items-center gap-1.5 font-bold text-amber-300">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>Hostinger Troubleshooting Guide:</span>
                      </div>
                      <p className="text-slate-300 text-[11px] leading-relaxed">
                        Hostinger එකේදී තත්පර 10කට වඩා Spinner එක කරකැවේ නම්:
                        <br />
                        1. Hostinger hPanel හි <strong>Node.js App එක 'Start' කර ඇත්දැයි</strong> බලන්න.
                        <br />
                        2. පහත බොත්තම ඔබා Fresh QR Code එකක් Request කරන්න.
                      </p>
                      <button
                        type="button"
                        onClick={handleRefreshQr}
                        className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Force New QR Code</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Error Message Notice if Backend is Offline */}
            {errorMessage && (
              <div className="p-3 bg-rose-950/80 border border-rose-500/60 rounded-xl text-xs text-rose-200 space-y-2 animate-fadeIn text-left">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-rose-300">Backend Server Offline or Error:</p>
                    <p className="text-[11px] text-slate-300 font-mono bg-slate-950/80 p-2 rounded border border-rose-900/50 break-all">
                      {errorMessage}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-rose-900/60 text-[11px]">
                  <span className="text-slate-400">Hostinger hPanel &gt; Node.js Start App කරන්න.</span>
                  <button
                    type="button"
                    onClick={handleRefreshQr}
                    className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded text-xs transition-colors cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* Real Scanning Instructions */}
            <div className="bg-slate-800/40 border border-slate-800 p-3.5 rounded-lg text-xs text-slate-300 space-y-1.5">
              <p className="font-bold text-emerald-400">How to link your phone:</p>
              <ol className="list-decimal list-inside space-y-1 text-slate-300 text-[11px]">
                <li>Open <strong>WhatsApp</strong> on your physical phone</li>
                <li>Tap <strong>Settings</strong> (or 3 dots on Android) &gt; <strong>Linked Devices</strong></li>
                <li>Tap <strong>Link a Device</strong></li>
                <li>Point your phone's camera at the QR code above</li>
              </ol>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
