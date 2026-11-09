import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  Users,
  FileText,
  Upload,
  Plus,
  Trash2,
  Play,
  RotateCw,
  Sparkles,
  Paperclip,
  CheckCircle2,
  Calendar,
  AlertTriangle,
  FileSpreadsheet,
  Shuffle,
  Image as ImageIcon,
  Video,
  Film,
  ShieldCheck,
  ShieldAlert,
  X
} from 'lucide-react';
import { WhatsAppAccount, MessageTemplate, Contact, Campaign, DynamicTimingConfig } from '../types';
import { resolveSpintax, replaceVariables } from '../utils/spintax';
import { parseRecipientsSeamless } from '../utils/phoneUtils';
import { uploadMediaWithChunks } from '../utils/chunkedUploader';

interface Props {
  accounts: WhatsAppAccount[];
  campaigns: Campaign[];
  onCreateCampaign: (campaign: Campaign) => void;
  onLaunchCampaign: (campaignId: string, campaign?: Campaign) => void;
  onSelectCampaignToMonitor: (campaignId: string) => void;
}

export const CampaignsView: React.FC<Props> = ({
  accounts,
  campaigns,
  onCreateCampaign,
  onLaunchCampaign,
  onSelectCampaignToMonitor
}) => {
  const [activeTab, setActiveTab] = useState<'create' | 'list'>('create');

  // Campaign Form State
  const [name, setName] = useState('Product Launch - Batch 01');
  const [rotationStrategy, setRotationStrategy] = useState<'round-robin' | 'random'>('round-robin');
  const [selectedSenders, setSelectedSenders] = useState<string[]>(() =>
    accounts.filter(a => a.status === 'CONNECTED').map(a => a.id)
  );

  useEffect(() => {
    const connected = accounts.filter(a => a.status === 'CONNECTED').map(a => a.id);
    if (connected.length > 0 && (selectedSenders.length === 0 || !selectedSenders.some(id => connected.includes(id)))) {
      setSelectedSenders(connected);
    }
  }, [accounts]);

  // DYNAMIC TIMING CONTROLS (CRITICAL REQUIREMENT #2)
  const [minDelay, setMinDelay] = useState<number>(10);
  const [maxDelay, setMaxDelay] = useState<number>(30);
  const [batchSize, setBatchSize] = useState<number>(8);
  const [breakDurationMinutes, setBreakDurationMinutes] = useState<number>(2);
  const [typingDelay, setTypingDelay] = useState<number>(3);

  // DELIVERY TIME WINDOW & ANTI-BAN PACING (6:00 AM - 6:00 PM Distribution)
  const [deliveryWindowEnabled, setDeliveryWindowEnabled] = useState<boolean>(true);
  const [deliveryWindowStartTime, setDeliveryWindowStartTime] = useState<string>('06:00');
  const [deliveryWindowEndTime, setDeliveryWindowEndTime] = useState<string>('18:00');
  const [deliveryTimezone, setDeliveryTimezone] = useState<string>('Asia/Colombo');
  const [smartPacingEnabled, setSmartPacingEnabled] = useState<boolean>(true);
  const [pacingCalculationResult, setPacingCalculationResult] = useState<any>(null);
  const [isCalculatingPacing, setIsCalculatingPacing] = useState<boolean>(false);

  // SCHEDULING (REQUIREMENT #7)
  const [isScheduled, setIsScheduled] = useState<boolean>(false);
  const [scheduledDateTime, setScheduledDateTime] = useState<string>('2026-10-18T14:30');

  // MULTIPLE TEMPLATES (CRITICAL REQUIREMENT #5)
  const [templates, setTemplates] = useState<MessageTemplate[]>([
    {
      id: 'tpl_1',
      title: 'Variant A (Friendly Spintax)',
      content: '{Hi|Hello|Hey} {{name}}! {Hope your day is going well|Hope you are having a productive week}. We reviewed {{company}} and prepared an automated local WhatsApp CRM demo for you.',
      mediaType: 'document',
      fileName: 'University_Project_Proposal.pdf'
    },
    {
      id: 'tpl_2',
      title: 'Variant B (Direct Academic)',
      content: '{Good day|Dear} {{name}}, following up on our research briefing at {{company}}. Could you let us know if you have 5 minutes for a quick feedback sync?',
      mediaType: 'image',
      fileName: 'Local_Architecture_Overview.png'
    }
  ]);

  // LIVE SPINTAX PREVIEW TESTER
  const [spintaxPreview, setSpintaxPreview] = useState<string>('');
  const [selectedPreviewTplIdx, setSelectedPreviewTplIdx] = useState<number>(0);

  // RECIPIENTS STATE & DUPLICATE / STOP NUMBER GUARDS
  const [skipDuplicates, setSkipDuplicates] = useState<boolean>(true);
  const [filterStopNumbers, setFilterStopNumbers] = useState<boolean>(true);
  const [stopNumbersList, setStopNumbersList] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/stop-numbers')
      .then(res => res.json())
      .then(data => {
        if (data.stopNumbers && Array.isArray(data.stopNumbers)) {
          setStopNumbersList(data.stopNumbers);
        }
      })
      .catch(() => {});
  }, []);

  const [recipientText, setRecipientText] = useState<string>(
    `0703393139, Yuhusulu, Tech LK, VIP\n0771234567, Kamal Perera, Colombo Motors, Retail\n0712345678, Nimal Silva, Kandy Supplies, Wholesale\n0789876543, Dilani Fernando, Galle Traders, Partner`
  );

  const parsedPreview = useMemo(() => {
    return parseRecipientsSeamless(recipientText, {
      skipDuplicates,
      stopNumbersSet: filterStopNumbers ? stopNumbersList : []
    });
  }, [recipientText, skipDuplicates, filterStopNumbers, stopNumbersList]);

  const testSpintaxSample = (templateIndex: number) => {
    setSelectedPreviewTplIdx(templateIndex);
    const targetTpl = templates[templateIndex];
    if (!targetTpl) return;
    const resolved = resolveSpintax(targetTpl.content);
    const personalized = replaceVariables(resolved, {
      name: 'Alex Mercer',
      company: 'Omni Dynamics',
      phone: '+1 (555) 019-2831'
    });
    setSpintaxPreview(personalized);
  };

  const addTemplate = () => {
    const newIdx = templates.length + 1;
    setTemplates([
      ...templates,
      {
        id: `tpl_${Date.now()}`,
        title: `Variant ${String.fromCharCode(64 + newIdx)} (New)`,
        content: `{Greetings|Hello} {{name}}, quick update from our local server at {{company}}!`
      }
    ]);
  };

  const removeTemplate = (id: string) => {
    if (templates.length <= 1) return;
    setTemplates(templates.filter(t => t.id !== id));
  };

  const updateTemplate = (index: number, field: keyof MessageTemplate, value: any) => {
    const updated = [...templates];
    updated[index] = { ...updated[index], [field]: value };
    setTemplates(updated);
  };

  const [uploadingTemplateId, setUploadingTemplateId] = useState<string | null>(null);
  const [uploadStatusText, setUploadStatusText] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUploadTemplateMedia = async (index: number, file: File) => {
    const tpl = templates[index];
    if (!tpl) return;

    setUploadingTemplateId(tpl.id);
    setUploadError(null);
    setUploadStatusText('Preparing media...');

    try {
      const data = await uploadMediaWithChunks(file, (_percent, statusText) => {
        setUploadStatusText(statusText);
      });

      if (data && data.success) {
        const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        const isVideo = file.type.startsWith('video/') || ['.mp4', '.mov', '.mkv', '.3gp', '.avi', '.webm'].includes(ext);
        const isImg = file.type.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);
        const mediaType: 'video' | 'image' | 'document' = data.mediaType || (isVideo ? 'video' : isImg ? 'image' : 'document');

        const updated = [...templates];
        updated[index] = {
          ...updated[index],
          mediaUrl: data.fileUrl,
          filePath: data.filePath,
          fileName: data.fileName,
          fileSize: data.size,
          originalFileSize: data.originalSize || file.size,
          compressed: Boolean(data.compressed),
          mediaType
        };
        setTemplates(updated);
      } else {
        setUploadError((data as any)?.error || 'Failed to process media file.');
      }
    } catch (err: any) {
      console.error('File upload error:', err);
      setUploadError(err.message || 'Upload failed. Please try again.');
    } finally {
      setUploadingTemplateId(null);
      setUploadStatusText('');
    }
  };

  const handleRemoveTemplateMedia = (index: number) => {
    const updated = [...templates];
    updated[index] = {
      ...updated[index],
      mediaUrl: undefined,
      filePath: undefined,
      fileName: undefined,
      fileSize: undefined,
      mediaType: undefined
    };
    setTemplates(updated);
  };

  const toggleSender = (accountId: string) => {
    if (selectedSenders.includes(accountId)) {
      setSelectedSenders(selectedSenders.filter(id => id !== accountId));
    } else {
      setSelectedSenders([...selectedSenders, accountId]);
    }
  };

  const handleCalculatePacing = async () => {
    setIsCalculatingPacing(true);
    try {
      const { contacts: parsedContacts } = parseRecipientsSeamless(recipientText, {
        skipDuplicates,
        stopNumbersSet: filterStopNumbers ? stopNumbersList : []
      });
      const count = Math.max(1, parsedContacts.length);

      const res = await fetch('/api/campaigns/calculate-pacing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime: deliveryWindowStartTime,
          endTime: deliveryWindowEndTime,
          contactCount: count
        })
      });
      if (res.ok) {
        const data = await res.json();
        setPacingCalculationResult(data);
        if (data.recommendedMinDelay) setMinDelay(data.recommendedMinDelay);
        if (data.recommendedMaxDelay) setMaxDelay(data.recommendedMaxDelay);
        if (data.recommendedBatchSize) setBatchSize(data.recommendedBatchSize);
        if (data.recommendedBreakMinutes) setBreakDurationMinutes(data.recommendedBreakMinutes);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsCalculatingPacing(false);
    }
  };

  const handleCreateAndLaunch = () => {
    // Parse contacts from text seamlessly (supports commas, newlines, duplicates, and stop list)
    const { contacts: parsedContacts, stopNumbersFound } = parseRecipientsSeamless(recipientText, {
      skipDuplicates,
      stopNumbersSet: filterStopNumbers ? stopNumbersList : []
    });

    // If filterStopNumbers is enabled, strictly exclude stopped contacts from dispatch queue
    const activeContacts = filterStopNumbers
      ? parsedContacts.filter(c => c.status !== 'stopped')
      : parsedContacts;

    const connectedAccountIds = accounts.filter(a => a.status === 'CONNECTED').map(a => a.id);
    const effectiveSenders = selectedSenders.length > 0
      ? selectedSenders
      : (connectedAccountIds.length > 0 ? connectedAccountIds : accounts.map(a => a.id));

    const newCampaign: Campaign = {
      id: `cmp_${Date.now()}`,
      name: name || 'Untitled Campaign',
      createdAt: new Date().toISOString().replace('T', ' ').substr(0, 16),
      scheduledAt: isScheduled ? scheduledDateTime : undefined,
      status: isScheduled ? 'scheduled' : 'running',
      senderAccountIds: effectiveSenders,
      rotationStrategy,
      templates,
      contacts: activeContacts,
      skipDuplicates,
      autoFilterStopNumbers: filterStopNumbers,
      deliveryWindow: {
        enabled: deliveryWindowEnabled,
        startTime: deliveryWindowStartTime,
        endTime: deliveryWindowEndTime,
        timezone: deliveryTimezone,
        smartPacingEnabled
      },
      timings: {
        minDelaySeconds: minDelay,
        maxDelaySeconds: maxDelay,
        batchSize,
        breakDurationSeconds: breakDurationMinutes * 60,
        typingDelaySeconds: typingDelay
      },
      stats: {
        total: parsedContacts.length,
        sent: 0,
        delivered: 0,
        failed: 0,
        noWhatsAppCount: 0,
        stoppedCount: parsedContacts.filter(c => c.status === 'stopped').length,
        duplicateCount: 0,
        currentSenderIndex: 0,
        currentBatchCount: 0
      }
    };

    // Save to backend server
    fetch('/api/campaigns/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCampaign)
    }).catch(e => console.warn('Backend campaign persist error:', e));

    onCreateCampaign(newCampaign);
    onLaunchCampaign(newCampaign.id, newCampaign);
  };

  return (
    <div className="space-y-6">
      {/* Top Bar with View Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            Campaign Builder & Dynamic Timing Studio
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure anti-ban random delays, multi-sender account rotation, and template variations.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('create')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'create'
                ? 'bg-emerald-500 text-slate-950 font-semibold shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Create New Campaign
          </button>
          <button
            onClick={() => setActiveTab('list')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'list'
                ? 'bg-emerald-500 text-slate-950 font-semibold shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            All Campaigns ({campaigns.length})
          </button>
        </div>
      </div>

      {activeTab === 'list' ? (
        /* Campaigns List */
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Stored Local Campaigns</h3>
            <span className="text-xs font-mono text-slate-400">{campaigns.length} total</span>
          </div>

          <div className="divide-y divide-slate-800">
            {campaigns.map((c) => (
              <div key={c.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-800/40 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-white">{c.name}</h4>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                      c.status === 'running'
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                        : c.status === 'completed'
                        ? 'bg-blue-950/80 text-blue-300 border-blue-800'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      {c.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 font-mono">
                    <span>{c.contacts.length} recipients</span>
                    <span>·</span>
                    <span>{c.senderAccountIds.length} senders ({c.rotationStrategy})</span>
                    <span>·</span>
                    <span>Delay: {c.timings.minDelaySeconds}-{c.timings.maxDelaySeconds}s</span>
                    <span>·</span>
                    <span>Batch: {c.timings.batchSize} msgs (Sleep {c.timings.breakDurationSeconds}s)</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onSelectCampaignToMonitor(c.id)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
                  >
                    Open Live Monitor
                  </button>
                  {c.status !== 'running' && (
                    <button
                      onClick={() => onLaunchCampaign(c.id, c)}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-slate-950" />
                      <span>{c.status === 'completed' ? 'Restart Blast' : 'Start Blast'}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Create Campaign Studio */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main 2-column Config Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Campaign Basic Info */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span>Campaign Metadata</span>
              </h3>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Campaign Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. University Partner Outreach 2026"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            {/* DYNAMIC ANTI-BAN TIMING SETTINGS (CRITICAL REQUIREMENT #2) */}
            <div className="bg-slate-900 border border-emerald-500/20 rounded-xl p-5 space-y-4 shadow-lg shadow-emerald-950/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Dynamic Campaign Timings & Anti-Ban Controls
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded">
                  CRITICAL REQUIREMENT
                </span>
              </div>
              <p className="text-xs text-slate-400">
                These values are injected dynamically per campaign into the queue worker to prevent WhatsApp algorithm flags.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-1">
                {/* Min Delay */}
                <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-1">
                  <label className="text-[11px] font-medium text-slate-400 block">
                    Min Delay (sec)
                  </label>
                  <input
                    type="number"
                    min={3}
                    max={120}
                    value={minDelay}
                    onChange={(e) => setMinDelay(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400 block">Shortest pause</span>
                </div>

                {/* Max Delay */}
                <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-1">
                  <label className="text-[11px] font-medium text-slate-400 block">
                    Max Delay (sec)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={300}
                    value={maxDelay}
                    onChange={(e) => setMaxDelay(Math.max(minDelay, Number(e.target.value)))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400 block">Longest pause</span>
                </div>

                {/* Batch Size */}
                <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-1">
                  <label className="text-[11px] font-medium text-slate-400 block">
                    Batch Size (msgs)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={batchSize}
                    onChange={(e) => setBatchSize(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400 block">Messages per batch</span>
                </div>

                {/* Break Duration */}
                <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-1">
                  <label className="text-[11px] font-medium text-slate-400 block">
                    Break Duration (mins)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={breakDurationMinutes}
                    onChange={(e) => setBreakDurationMinutes(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400 block">Sleep cooldown</span>
                </div>
              </div>

              {/* Timing Simulation Preview Formula */}
              <div className="p-3 bg-emerald-950/20 border border-emerald-900/40 rounded-lg text-xs text-emerald-300 font-mono flex items-center justify-between">
                <span>Active Algorithm:</span>
                <span>delay = random({minDelay}s, {maxDelay}s) | Every {batchSize} msgs sleep {breakDurationMinutes * 60}s</span>
              </div>
            </div>

            {/* SMART DELIVERY TIME WINDOW & ANTI-BAN PACING (USER REQUEST) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Smart Delivery Time Window (Anti-Ban Daily Distribution)
                  </h3>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deliveryWindowEnabled}
                    onChange={(e) => setDeliveryWindowEnabled(e.target.checked)}
                    className="accent-emerald-500 rounded"
                  />
                  <span className="text-xs font-semibold text-emerald-400">
                    {deliveryWindowEnabled ? 'Window Active (e.g. 6AM - 6PM)' : 'Window Disabled (24/7 Blast)'}
                  </span>
                </label>
              </div>

              <p className="text-xs text-slate-400">
                Paces and distributes all messages smoothly across your allowed daily hours (e.g. 06:00 AM to 06:00 PM). If the current time is outside the window, the queue automatically pauses and sleeps until the window re-opens next morning without getting your numbers banned.
              </p>

              {deliveryWindowEnabled && (
                <div className="space-y-4 pt-1 animate-fadeIn">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Start Time */}
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                      <label className="text-[11px] font-medium text-slate-400 block">
                        Start Time (Window Open)
                      </label>
                      <input
                        type="time"
                        value={deliveryWindowStartTime}
                        onChange={(e) => setDeliveryWindowStartTime(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                      />
                      <span className="text-[10px] text-slate-500 block">e.g. 06:00 (6:00 AM)</span>
                    </div>

                    {/* End Time */}
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                      <label className="text-[11px] font-medium text-slate-400 block">
                        End Time (Window Close)
                      </label>
                      <input
                        type="time"
                        value={deliveryWindowEndTime}
                        onChange={(e) => setDeliveryWindowEndTime(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                      />
                      <span className="text-[10px] text-slate-500 block">e.g. 18:00 (6:00 PM)</span>
                    </div>

                    {/* Timezone */}
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                      <label className="text-[11px] font-medium text-slate-400 block">
                        Active Timezone
                      </label>
                      <select
                        value={deliveryTimezone}
                        onChange={(e) => setDeliveryTimezone(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                      >
                        <option value="Asia/Colombo">Asia/Colombo (Sri Lanka / India GMT+5:30)</option>
                        <option value="Asia/Dubai">Asia/Dubai (UAE GMT+4)</option>
                        <option value="Europe/London">Europe/London (UK GMT+0)</option>
                        <option value="America/New_York">America/New_York (US Eastern GMT-5)</option>
                      </select>
                      <span className="text-[10px] text-slate-500 block">Local dispatch timezone</span>
                    </div>
                  </div>

                  {/* Anti-Ban Auto-Pacing Calculator */}
                  <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-semibold text-white">
                          Smart Anti-Ban Rate Calculator
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCalculatePacing}
                        disabled={isCalculatingPacing}
                        className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <Shuffle className="w-3 h-3" />
                        <span>{isCalculatingPacing ? 'Calculating...' : 'Calculate Optimal Delays'}</span>
                      </button>
                    </div>

                    {pacingCalculationResult ? (
                      <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded-lg text-xs text-emerald-200 space-y-1">
                        <p className="font-semibold text-white text-xs">
                          {pacingCalculationResult.formulaDescription}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-emerald-300 font-mono pt-1">
                          <span>Window: {pacingCalculationResult.windowMinutes / 60} Hours</span>
                          <span>·</span>
                          <span>Contacts: {pacingCalculationResult.contactCount}</span>
                          <span>·</span>
                          <span>Min Delay: {pacingCalculationResult.recommendedMinDelay}s</span>
                          <span>·</span>
                          <span>Max Delay: {pacingCalculationResult.recommendedMaxDelay}s</span>
                          <span>·</span>
                          <span>Batch: {pacingCalculationResult.recommendedBatchSize} msgs</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400">
                        Click "Calculate Optimal Delays" to automatically calculate the safest random anti-ban delay distribution across your {deliveryWindowStartTime} - {deliveryWindowEndTime} window for the recipients in your list.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* SENDER ACCOUNT ROTATION (CRITICAL REQUIREMENT #4) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Sender Account Rotation
                  </h3>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">Strategy:</span>
                  <select
                    value={rotationStrategy}
                    onChange={(e: any) => setRotationStrategy(e.target.value)}
                    className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs"
                  >
                    <option value="round-robin">Round-Robin (Balanced)</option>
                    <option value="random">Randomized Rotation</option>
                  </select>
                </div>
              </div>

              <p className="text-xs text-slate-400">
                Workload will be distributed evenly across all checked accounts (e.g. 8 accounts will each take 1/8th of contacts).
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {accounts.map((acc) => {
                  const isChecked = selectedSenders.includes(acc.id);
                  const isConnected = acc.status === 'CONNECTED';
                  return (
                    <label
                      key={acc.id}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                        isChecked
                          ? 'bg-slate-950 border-emerald-500/50 shadow-xs'
                          : 'bg-slate-950/50 border-slate-800 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={!isConnected}
                          onChange={() => toggleSender(acc.id)}
                          className="accent-emerald-500 w-4 h-4 rounded cursor-pointer"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{acc.name}</p>
                          <p className="text-[11px] font-mono text-slate-400 truncate">{acc.phoneNumber}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                        isConnected ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'
                      }`}>
                        {isConnected ? 'ONLINE' : 'OFFLINE'}
                      </span>
                    </label>
                  );
                })}
              </div>

              {selectedSenders.length === 0 && (
                <div className="p-3 bg-amber-950/30 border border-amber-800/60 rounded-lg text-xs text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Please select at least one online WhatsApp account to dispatch this campaign.</span>
                </div>
              )}
            </div>

            {/* TEMPLATE ROTATION WITH SPINTAX & ATTACHMENTS (CRITICAL REQUIREMENT #5) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Template Rotation ({templates.length} Variants)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={addTemplate}
                  className="flex items-center gap-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Template Variant</span>
                </button>
              </div>

              <p className="text-xs text-slate-400">
                For every recipient, the engine randomly picks one template variant to prevent identical repetitive text patterns. Supports Spintax <code className="text-emerald-400 font-mono">{"{Option1|Option2}"}</code> and variables <code className="text-emerald-400 font-mono">{"{{name}}"}</code>, <code className="text-emerald-400 font-mono">{"{{company}}"}</code>.
              </p>

              <div className="space-y-4">
                {templates.map((tpl, idx) => (
                  <div key={tpl.id} className="bg-slate-950 border border-slate-800/80 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={tpl.title}
                        onChange={(e) => updateTemplate(idx, 'title', e.target.value)}
                        className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs font-semibold text-white w-64 focus:outline-none focus:border-emerald-500"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => testSpintaxSample(idx)}
                          className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-mono bg-emerald-950/40 border border-emerald-900/60 px-2 py-1 rounded"
                        >
                          <Shuffle className="w-3 h-3" />
                          <span>Test Spintax</span>
                        </button>
                        {templates.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeTemplate(tpl.id)}
                            className="text-slate-500 hover:text-rose-400 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <textarea
                      rows={3}
                      value={tpl.content}
                      onChange={(e) => updateTemplate(idx, 'content', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed"
                    />

                    {/* Rich HD Video, Photo & Document Attachment Section */}
                    <div className="pt-2 border-t border-slate-800/80 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          {/* File Upload Button supporting HD Video, Images, PDFs */}
                          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-850 text-slate-200 hover:text-white rounded-lg border border-slate-700/80 cursor-pointer transition-colors text-xs font-medium">
                            <Video className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{uploadingTemplateId === tpl.id ? (uploadStatusText || 'Optimizing & Compressing HD Video...') : 'Attach HD Video / Photo / Document'}</span>
                            <input
                              type="file"
                              accept="video/mp4,video/quicktime,video/*,image/*,application/pdf,.doc,.docx"
                              disabled={uploadingTemplateId === tpl.id}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleUploadTemplateMedia(idx, file);
                                e.target.value = '';
                              }}
                              className="hidden"
                            />
                          </label>

                          <span className="text-[11px] text-slate-400">or filename:</span>
                          <input
                            type="text"
                            value={tpl.fileName || ''}
                            placeholder="e.g. promo_video.mp4, flyer.png"
                            onChange={(e) => {
                              const updated = [...templates];
                              updated[idx] = { ...updated[idx], fileName: e.target.value };
                              setTemplates(updated);
                            }}
                            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-300 w-44 focus:outline-none focus:border-emerald-500"
                          />
                        </div>

                        <span className="text-[10px] text-emerald-400/90 font-mono flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>HD Video & Encrypted Baileys Stream (No Lag)</span>
                        </span>
                      </div>

                      {uploadError && (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-rose-950/80 border border-rose-800 text-xs text-rose-300">
                          <span className="flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            <span>{uploadError}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setUploadError(null)}
                            className="text-rose-400 hover:text-white text-[11px] underline ml-2 cursor-pointer"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}

                      {/* Attached Media Preview Box (Supports HD Video Player, Images, Documents) */}
                      {(tpl.mediaUrl || tpl.fileName) && (
                        <div className="p-2.5 bg-slate-900/95 border border-emerald-500/30 rounded-lg space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-3 min-w-0">
                              {tpl.mediaType === 'video' || (tpl.fileName && ['.mp4', '.mov', '.mkv', '.3gp', '.webm'].some(ext => tpl.fileName?.toLowerCase().endsWith(ext))) ? (
                                <div className="w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-800 flex items-center justify-center text-emerald-400 shrink-0">
                                  <Film className="w-5 h-5" />
                                </div>
                              ) : tpl.mediaUrl && (tpl.mediaUrl.startsWith('data:image') || tpl.mediaUrl.startsWith('/uploads/') || tpl.mediaType === 'image') ? (
                                <img
                                  src={tpl.mediaUrl}
                                  alt="Attachment"
                                  className="w-10 h-10 object-cover rounded-lg border border-slate-700 shrink-0"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300 shrink-0">
                                  <FileText className="w-5 h-5 text-emerald-400" />
                                </div>
                              )}

                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-white truncate max-w-[280px]">
                                  {tpl.fileName || 'Attached Media'}
                                </p>
                                <p className="text-[10px] text-slate-400">
                                  {tpl.fileSize ? `${(tpl.fileSize / (1024 * 1024)).toFixed(2)} MB ` : ''}
                                  {tpl.compressed && tpl.originalFileSize && tpl.originalFileSize > (tpl.fileSize || 0)
                                    ? `(Compressed from ${(tpl.originalFileSize / (1024 * 1024)).toFixed(2)} MB · WhatsApp Fast Stream) · `
                                    : '· '}
                                  {tpl.mediaType === 'video'
                                    ? 'HD Video (Instant WhatsApp Playback)'
                                    : tpl.mediaType === 'image'
                                    ? 'High Resolution Photo (JPG/PNG/WebP)'
                                    : 'Document Post (PDF)'}
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveTemplateMedia(idx)}
                              className="text-slate-400 hover:text-rose-400 p-1.5 transition-colors"
                              title="Remove attachment"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Video Player Preview for HD Videos */}
                          {tpl.mediaUrl && (tpl.mediaType === 'video' || (tpl.fileName && ['.mp4', '.mov', '.mkv', '.3gp', '.webm'].some(ext => tpl.fileName?.toLowerCase().endsWith(ext)))) && (
                            <div className="pt-2 border-t border-slate-800">
                              <video
                                src={tpl.mediaUrl}
                                controls
                                className="max-h-36 max-w-sm rounded-lg border border-slate-800 bg-black"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Spintax Test Output Modal Box */}
              {spintaxPreview && (
                <div className="p-3 bg-slate-950 border border-emerald-500/30 rounded-lg text-xs space-y-1">
                  <div className="flex items-center justify-between text-emerald-400 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Spintax Permutation Sample:</span>
                    </span>
                    <button
                      onClick={() => testSpintaxSample(selectedPreviewTplIdx)}
                      className="text-[11px] underline hover:text-white"
                    >
                      Roll again
                    </button>
                  </div>
                  <p className="text-slate-200 italic font-mono bg-slate-900/80 p-2 rounded border border-slate-800">
                    "{spintaxPreview}"
                  </p>
                </div>
              )}
            </div>

            {/* RECIPIENTS / CSV IMPORT (Supports Commas, Newlines, Duplicates, and Stop List) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Recipient Numbers (Comma or Newline Separated)
                  </h3>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  Accepts "070..., 077..." or lines vertically
                </span>
              </div>

              <textarea
                rows={5}
                value={recipientText}
                onChange={(e) => setRecipientText(e.target.value)}
                placeholder="0703393139, 0771234567, 0712345678&#10;or vertically:&#10;0703393139&#10;0771234567&#10;0712345678"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500 placeholder-slate-600 leading-relaxed"
              />

              {/* Duplicate & Stop Number Toggle Checkboxes (CRITICAL USER REQUEST) */}
              <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 space-y-2">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-200 hover:text-white select-none">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  <span className="font-medium">
                    Skip duplicate numbers (If a number appears multiple times, send only 1 message)
                  </span>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-200 hover:text-white select-none">
                  <input
                    type="checkbox"
                    checked={filterStopNumbers}
                    onChange={(e) => setFilterStopNumbers(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-rose-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  <span className="font-medium text-slate-300">
                    Auto-filter Stop Numbers list ({stopNumbersList.length} numbers active in Stop Registry)
                  </span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRecipientText("0703393139, Yuhusulu, Tech LK, VIP\n0771234567, Kamal Perera, Colombo Motors, Retail\n0712345678, Nimal Silva, Kandy Supplies, Wholesale\n0789876543, Dilani Fernando, Galle Traders, Partner")}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 rounded text-[11px] font-mono cursor-pointer transition-colors"
                >
                  + Add Sri Lanka Sample (Lines)
                </button>
                <button
                  type="button"
                  onClick={() => setRecipientText("0703393139, 0771234567, 0712345678, 0789876543, 0721112233, 0765554433")}
                  className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-teal-300 border border-slate-700 rounded text-[11px] font-mono cursor-pointer transition-colors"
                >
                  + Add Comma-Separated List Sample
                </button>
                <button
                  type="button"
                  onClick={() => setRecipientText("")}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 border border-slate-700 rounded text-[11px] font-mono cursor-pointer transition-colors"
                >
                  Clear All
                </button>
              </div>

              {/* Dynamic Recipient Detection Breakdown */}
              <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2 pt-1 border-t border-slate-800/60">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span>
                    Detected contacts: <strong className="text-emerald-400 font-mono text-sm">{parsedPreview.contacts.filter(c => c.status !== 'stopped').length}</strong>
                  </span>
                  {parsedPreview.duplicateCount > 0 && (
                    <span className="text-amber-300 font-mono text-[11px] bg-amber-950/70 border border-amber-800/80 px-2 py-0.5 rounded">
                      ✓ {parsedPreview.duplicateCount} duplicate(s) skipped
                    </span>
                  )}
                  {parsedPreview.stopCount > 0 && (
                    <span className="text-rose-300 font-mono text-[11px] bg-rose-950/70 border border-rose-800/80 px-2 py-0.5 rounded flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3 text-rose-400" />
                      <span>{parsedPreview.stopCount} in Stop List (bypassed)</span>
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-emerald-400 font-mono">
                  ✓ Sri Lanka (07... / 94...) normalized automatically
                </span>
              </div>
            </div>
          </div>

          {/* Right Summary & Launch Card */}
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5 sticky top-4">
              <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-3">
                Campaign Execution Summary
              </h3>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Target Recipients</span>
                  <span className="font-mono text-white font-semibold">
                    {recipientText.trim().split('\n').filter(l => l.trim()).length}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-slate-400">Sender Accounts</span>
                  <span className="font-mono text-emerald-400 font-semibold">
                    {selectedSenders.length} online ({rotationStrategy})
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-slate-400">Template Variants</span>
                  <span className="font-mono text-white font-semibold">
                    {templates.length} templates (Random pick)
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-slate-400">Per-Message Delay</span>
                  <span className="font-mono text-amber-300">
                    {minDelay}s - {maxDelay}s (Randomized)
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-slate-400">Batch Cooldown</span>
                  <span className="font-mono text-amber-300">
                    Sleep {breakDurationMinutes}m every {batchSize} msgs
                  </span>
                </div>
              </div>

              {/* Schedule options */}
              <div className="pt-3 border-t border-slate-800 space-y-3">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isScheduled}
                    onChange={(e) => setIsScheduled(e.target.checked)}
                    className="accent-emerald-500 rounded"
                  />
                  <span>Schedule for Future Date/Time</span>
                </label>

                {isScheduled && (
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 block">Scheduled Time</label>
                    <input
                      type="datetime-local"
                      value={scheduledDateTime}
                      onChange={(e) => setScheduledDateTime(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Launch CTA */}
              <button
                type="button"
                onClick={handleCreateAndLaunch}
                disabled={selectedSenders.length === 0}
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/10 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                <span>{isScheduled ? 'Schedule Campaign' : 'Save & Start Campaign Now'}</span>
              </button>

              <p className="text-[11px] text-slate-400 text-center leading-normal">
                Dispatches asynchronously via local Baileys engine. Live progress streams to your dashboard.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
