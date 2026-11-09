import React, { useState, useEffect } from 'react';
import { TopHeader } from './components/TopHeader';
import { Sidebar } from './components/Sidebar';
import { AccountsView } from './components/AccountsView';
import { CampaignsView } from './components/CampaignsView';
import { ActiveCampaignMonitor } from './components/ActiveCampaignMonitor';
import { WarmupView } from './components/WarmupView';
import { CrmAutoResponderView } from './components/CrmAutoResponderView';
import { CodebaseExportView } from './components/CodebaseExportView';
import { StopNumbersView } from './components/StopNumbersView';

import {
  INITIAL_ACCOUNTS,
  INITIAL_CAMPAIGNS,
  INITIAL_LOGS,
  INITIAL_WARMUP_DIALOGUES,
  INITIAL_AUTO_RESPONDERS,
  INITIAL_CONTACTS
} from './data/mockInitialData';

import {
  WhatsAppAccount,
  Campaign,
  DeliveryLog,
  WarmupDialogue,
  AutoResponderRule,
  Contact
} from './types';

import { simulator } from './services/localSimulator';
import {
  saveAccountSessionToIndexedDB,
  getAccountSessionFromIndexedDB,
  getAllAccountSessionsFromIndexedDB,
  removeAccountSessionFromIndexedDB
} from './utils/vaultStorage';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('campaigns');

  // Application Data States (Never fake CONNECTED status: strictly verified with backend)
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>(() => {
    try {
      const saved = localStorage.getItem('yuhusulu_accounts') || localStorage.getItem('whatzlocal_accounts');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Remove any legacy mock demo accounts, and mark status as CONNECTING until live server check
          const realAccounts = parsed
            .filter((a: any) => !['acc_01', 'acc_02', 'acc_03', 'acc_04'].includes(a.id))
            .map((a: any) => ({
              ...a,
              status: a.status === 'CONNECTED' ? 'CONNECTING' : (a.status || 'DISCONNECTED')
            }));
          return realAccounts;
        }
      }
    } catch (e) {}
    return [];
  });
  const [campaigns, setCampaigns] = useState<Campaign[]>(INITIAL_CAMPAIGNS);
  const [activeCampaignId, setActiveCampaignId] = useState<string>('cmp_sample_01');
  const [logs, setLogs] = useState<DeliveryLog[]>(INITIAL_LOGS);
  const [warmupDialogues, setWarmupDialogues] = useState<WarmupDialogue[]>(INITIAL_WARMUP_DIALOGUES);
  const [autoResponders, setAutoResponders] = useState<AutoResponderRule[]>(INITIAL_AUTO_RESPONDERS);
  const [contacts, setContacts] = useState<Contact[]>(INITIAL_CONTACTS);

  // Modal & Engine States
  const [isAddAccountModalOpen, setIsAddAccountModalOpen] = useState<boolean>(false);
  const [warmupActive, setWarmupActive] = useState<boolean>(false);
  const [stopNumbersCount, setStopNumbersCount] = useState<number>(0);

  useEffect(() => {
    fetch('/api/stop-numbers')
      .then(res => res.json())
      .then(data => {
        if (data.stopNumbers && Array.isArray(data.stopNumbers)) {
          setStopNumbersCount(data.stopNumbers.length);
        }
      })
      .catch(() => {});
  }, []);

  // Connected accounts count
  const connectedAccountsCount = accounts.filter(a => a.status === 'CONNECTED').length;
  const runningCampaignsCount = campaigns.filter(c => c.status === 'running').length;

  // Active Campaign Object
  const currentCampaign = campaigns.find(c => c.id === activeCampaignId) || campaigns[0] || null;

  // Fetch real accounts from local Baileys server & sync multi-month persistent vault
  const fetchAccountsFromServer = async () => {
    try {
      const res = await fetch('/api/accounts');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setAccounts(data);
          try {
            localStorage.setItem('yuhusulu_accounts', JSON.stringify(data));
          } catch (err) {}

          // 1. Check all server accounts against IndexedDB and LocalStorage vault
          for (const acc of data) {
            if (acc.status !== 'CONNECTED') {
              // Check IndexedDB first (can store complete RSA/ECC session keys indefinitely)
              getAccountSessionFromIndexedDB(acc.id).then(storedRecord => {
                if (storedRecord?.keys && storedRecord.keys['creds.json']) {
                  console.log(`[Auto-Heal IndexedDB] Restoring WhatsApp session keys for ${acc.id}...`);
                  fetch(`/api/accounts/vault/${acc.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ keys: storedRecord.keys })
                  })
                    .then(() => setTimeout(fetchAccountsFromServer, 2500))
                    .catch(() => {});
                  return;
                }

                // Fallback to localStorage
                const savedKeysStr = localStorage.getItem(`wa_vault_${acc.id}`);
                if (savedKeysStr) {
                  try {
                    const savedKeys = JSON.parse(savedKeysStr);
                    if (savedKeys && savedKeys['creds.json']) {
                      console.log(`[Auto-Heal LocalStorage] Restoring session from localStorage for ${acc.id}...`);
                      fetch(`/api/accounts/vault/${acc.id}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ keys: savedKeys })
                      })
                        .then(() => setTimeout(fetchAccountsFromServer, 2500))
                        .catch(() => {});
                    }
                  } catch (e) {}
                }
              }).catch(() => {});
            } else if (acc.status === 'CONNECTED') {
              // If account is actively connected, cache session keys into IndexedDB & localStorage
              fetch(`/api/accounts/vault/${acc.id}`)
                .then(r => r.json())
                .then(vData => {
                  if (vData.keys && vData.keys['creds.json']) {
                    saveAccountSessionToIndexedDB(acc.id, acc.name, acc.phoneNumber, vData.keys);
                    try {
                      localStorage.setItem(`wa_vault_${acc.id}`, JSON.stringify(vData.keys));
                    } catch (e) {}
                  }
                })
                .catch(() => {});
            }
          }

          // 2. Disaster Recovery: Check if user has other previously linked accounts stored in IndexedDB missing from server
          getAllAccountSessionsFromIndexedDB().then(allStored => {
            let deletedIds: string[] = [];
            try {
              deletedIds = JSON.parse(localStorage.getItem('wa_deleted_accounts') || '[]');
            } catch (e) {}

            // Purge any deleted accounts still in IndexedDB
            for (const stored of allStored) {
              if (stored?.accountId && deletedIds.includes(stored.accountId)) {
                removeAccountSessionFromIndexedDB(stored.accountId).catch(() => {});
              }
            }

            const missingAccounts = allStored.filter(
              stored => stored?.keys?.['creds.json'] &&
                        !data.some(d => d.id === stored.accountId) &&
                        !deletedIds.includes(stored.accountId)
            );
            if (missingAccounts.length > 0) {
              console.log(`[Disaster Recovery] Found ${missingAccounts.length} saved accounts in IndexedDB. Restoring to server...`);
              const payload = missingAccounts.map(m => ({
                id: m.accountId,
                name: m.accountName,
                phoneNumber: m.phoneNumber,
                keys: m.keys
              }));
              fetch('/api/accounts/import-all-backup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accounts: payload, isAutoRecovery: true })
              }).catch(() => {});
            }
          }).catch(() => {});
        }
      }
    } catch (e) {
      // Fallback to local state if server is booting
    }
  };

  const fetchLogsFromServer = async () => {
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setLogs(data);
        }
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchAccountsFromServer();
    fetchLogsFromServer();
    const interval = setInterval(() => {
      fetchAccountsFromServer();
      fetchLogsFromServer();
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  // Background Warm-up Dialogue Generator (every 35 seconds if active)
  useEffect(() => {
    if (!warmupActive) return;

    const interval = setInterval(() => {
      const activeWarmupNodes = accounts.filter(a => a.status === 'CONNECTED' && a.warmupEnabled);
      if (activeWarmupNodes.length < 2) return;

      const senderIdx = Math.floor(Math.random() * activeWarmupNodes.length);
      let receiverIdx = Math.floor(Math.random() * activeWarmupNodes.length);
      while (receiverIdx === senderIdx && activeWarmupNodes.length > 1) {
        receiverIdx = Math.floor(Math.random() * activeWarmupNodes.length);
      }

      const sender = activeWarmupNodes[senderIdx];
      const receiver = activeWarmupNodes[receiverIdx];

      const sampleDialogues = [
        "Hey! Did you inspect the updated SQLite indexes?",
        "Morning Alex, meeting is scheduled for 3 PM today.",
        "Could you confirm if the Baileys session folders exist in ./sessions?",
        "Everything passed locally. Ready for the university evaluation.",
        "Quick reminder to verify the random delay parameters before launch.",
        "Thanks for the prompt response! Looks completely solid."
      ];

      const text = sampleDialogues[Math.floor(Math.random() * sampleDialogues.length)];
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];

      const newEntry: WarmupDialogue = {
        id: `wup_${Date.now()}`,
        timestamp: timeStr,
        fromAccountId: sender.id,
        fromPhone: sender.phoneNumber,
        toAccountId: receiver.id,
        toPhone: receiver.phoneNumber,
        message: text,
        status: 'READ'
      };

      setWarmupDialogues(prev => [newEntry, ...prev.slice(0, 40)]);
    }, 35000);

    return () => clearInterval(interval);
  }, [warmupActive, accounts]);

  // Account Handlers
  const handleAddAccount = (newAcc: WhatsAppAccount) => {
    setAccounts(prev => [newAcc, ...prev]);
  };

  const handleUpdateAccount = (updatedAcc: WhatsAppAccount) => {
    setAccounts(prev => prev.map(a => a.id === updatedAcc.id ? updatedAcc : a));
  };

  const handleDeleteAccount = (accId: string) => {
    removeAccountSessionFromIndexedDB(accId).catch(() => {});
    localStorage.removeItem(`wa_vault_${accId}`);
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

    setAccounts(prev => prev.filter(a => a.id !== accId));
  };

  const handleToggleAccountWarmup = (accId: string) => {
    setAccounts(prev => prev.map(a => {
      if (a.id === accId) {
        return { ...a, warmupEnabled: !a.warmupEnabled };
      }
      return a;
    }));
  };

  // Campaign Handlers
  const handleCreateCampaign = (newCamp: Campaign) => {
    setCampaigns(prev => [newCamp, ...prev]);
    setActiveCampaignId(newCamp.id);
  };

  const handleLaunchCampaign = (campId: string, directCampaign?: Campaign) => {
    const target = directCampaign || campaigns.find(c => c.id === campId);
    if (!target) return;

    // Reset stats if restarting a completed or cancelled campaign
    const resetStats = (target.status === 'completed' || target.status === 'cancelled') ? {
      ...target.stats,
      sent: 0,
      delivered: 0,
      failed: 0,
      noWhatsAppCount: 0,
      currentSenderIndex: 0,
      currentBatchCount: 0
    } : target.stats;

    // Update status to running
    const updated: Campaign = { ...target, status: 'running' as const, stats: resetStats };
    setCampaigns(prev => {
      const exists = prev.some(c => c.id === campId);
      if (exists) {
        return prev.map(c => c.id === campId ? updated : c);
      }
      return [updated, ...prev];
    });
    setActiveCampaignId(campId);
    setActiveTab('monitor');

    // Start real campaign runner
    simulator.startCampaignRunner(
      updated,
      accounts,
      (progressCamp, newLog) => {
        setCampaigns(prev => prev.map(c => c.id === progressCamp.id ? progressCamp : c));
        setLogs(prev => [newLog, ...prev]);

        // Increment account daily sent count
        if (progressCamp.stats.lastSenderId) {
          setAccounts(prevAccs => prevAccs.map(acc => {
            if (acc.id === progressCamp.stats.lastSenderId) {
              return {
                ...acc,
                dailySentCount: (acc.dailySentCount || 0) + 1,
                totalDelivered: (acc.totalDelivered || 0) + 1
              };
            }
            return acc;
          }));
        }
      },
      (finishedId) => {
        setCampaigns(prev => prev.map(c => c.id === finishedId ? { ...c, status: 'completed' as const } : c));
      }
    );
  };

  const handlePauseCampaign = (campId: string) => {
    simulator.pause();
    setCampaigns(prev => prev.map(c => c.id === campId ? { ...c, status: 'paused' as const } : c));
  };

  const handleResumeCampaign = (campId: string) => {
    simulator.resume();
    setCampaigns(prev => prev.map(c => c.id === campId ? { ...c, status: 'running' as const } : c));
  };

  const handleStopCampaign = (campId: string) => {
    simulator.stop();
    setCampaigns(prev => prev.map(c => c.id === campId ? { ...c, status: 'cancelled' as const } : c));
  };

  // Warmup Manual Trigger
  const handleTriggerInstantWarmup = () => {
    const activeWarmupNodes = accounts.filter(a => a.status === 'CONNECTED' && a.warmupEnabled);
    if (activeWarmupNodes.length < 2) return;

    const sender = activeWarmupNodes[0];
    const receiver = activeWarmupNodes[1];
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    const newDialogue: WarmupDialogue = {
      id: `wup_${Date.now()}`,
      timestamp: timeStr,
      fromAccountId: sender.id,
      fromPhone: sender.phoneNumber,
      toAccountId: receiver.id,
      toPhone: receiver.phoneNumber,
      message: "Testing P2P connection handshake on local port 5000. All metrics nominal.",
      status: 'READ'
    };

    setWarmupDialogues(prev => [newDialogue, ...prev]);
  };

  // CRM & Auto-Responder Handlers
  const handleAddRule = (newRule: AutoResponderRule) => {
    setAutoResponders(prev => [newRule, ...prev]);
  };

  const handleToggleRule = (id: string) => {
    setAutoResponders(prev => prev.map(r => r.id === id ? { ...r, isEnabled: !r.isEnabled } : r));
  };

  const handleDeleteRule = (id: string) => {
    setAutoResponders(prev => prev.filter(r => r.id !== id));
  };

  const handleAddContact = (newContact: Contact) => {
    setContacts(prev => [newContact, ...prev]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      {/* Top Bar Contract (1 Wordmark, 4-5 Navigation Links, 1 Primary Action) */}
      <TopHeader
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        connectedAccountsCount={connectedAccountsCount}
        onOpenNewCampaign={() => {
          setActiveTab('campaigns');
        }}
        onOpenConnectAccount={() => {
          setIsAddAccountModalOpen(true);
        }}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Workspace Sidebar */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          connectedAccounts={connectedAccountsCount}
          activeCampaignsCount={runningCampaignsCount}
          warmupActive={warmupActive}
          stopNumbersCount={stopNumbersCount}
        />

        {/* Main Content Viewport */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8 bg-slate-950">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'accounts' && (
              <AccountsView
                accounts={accounts}
                onAddAccount={handleAddAccount}
                onUpdateAccount={handleUpdateAccount}
                onDeleteAccount={handleDeleteAccount}
                onTriggerWarmupToggle={handleToggleAccountWarmup}
                isAddModalOpen={isAddAccountModalOpen}
                setIsAddModalOpen={setIsAddAccountModalOpen}
                fetchAccountsFromServer={fetchAccountsFromServer}
              />
            )}

            {activeTab === 'campaigns' && (
              <CampaignsView
                accounts={accounts}
                campaigns={campaigns}
                onCreateCampaign={handleCreateCampaign}
                onLaunchCampaign={handleLaunchCampaign}
                onSelectCampaignToMonitor={(cId) => {
                  setActiveCampaignId(cId);
                  setActiveTab('monitor');
                }}
              />
            )}

            {activeTab === 'monitor' && (
              <ActiveCampaignMonitor
                campaign={currentCampaign}
                accounts={accounts}
                logs={logs}
                onPauseCampaign={handlePauseCampaign}
                onResumeCampaign={handleResumeCampaign}
                onStopCampaign={handleStopCampaign}
                onRestartCampaign={handleLaunchCampaign}
              />
            )}

            {activeTab === 'stop_numbers' && (
              <StopNumbersView
                onStopNumbersUpdated={(cnt) => setStopNumbersCount(cnt)}
              />
            )}

            {activeTab === 'warmup' && (
              <WarmupView
                accounts={accounts}
                warmupDialogues={warmupDialogues}
                warmupActive={warmupActive}
                onToggleWarmupService={() => setWarmupActive(!warmupActive)}
                onTriggerInstantWarmup={handleTriggerInstantWarmup}
                onToggleAccountWarmup={handleToggleAccountWarmup}
              />
            )}

            {activeTab === 'crm' && (
              <CrmAutoResponderView
                contacts={contacts}
                autoResponders={autoResponders}
                onAddRule={handleAddRule}
                onToggleRule={handleToggleRule}
                onDeleteRule={handleDeleteRule}
                onAddContact={handleAddContact}
              />
            )}

            {activeTab === 'codebase' && (
              <CodebaseExportView />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
