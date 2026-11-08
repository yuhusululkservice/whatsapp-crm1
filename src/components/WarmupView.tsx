import React, { useState, useEffect, useRef } from 'react';
import {
  Flame,
  Play,
  Pause,
  MessageCircle,
  ShieldCheck,
  CheckCheck,
  RotateCw,
  Sparkles,
  Users,
  Settings,
  Activity,
  AlertCircle,
  CheckCircle,
  Smartphone,
  Timer,
  Hash,
  Eye,
  Shuffle,
  Clock,
  Layers,
  ArrowRightLeft,
  Calendar,
  Globe
} from 'lucide-react';
import { WhatsAppAccount, WarmupDialogue, WarmupConfig, WarmupAutoStopMode } from '../types';

interface Props {
  accounts: WhatsAppAccount[];
  warmupDialogues: WarmupDialogue[];
  warmupActive: boolean;
  onToggleWarmupService: () => void;
  onTriggerInstantWarmup: () => void;
  onToggleAccountWarmup: (accountId: string) => void;
}

export const WarmupView: React.FC<Props> = ({
  accounts,
  warmupDialogues,
  warmupActive,
  onToggleWarmupService,
  onTriggerInstantWarmup,
  onToggleAccountWarmup
}) => {
  const [isManualRunning, setIsManualRunning] = useState<boolean>(warmupActive);
  const [serverWarmupLogs, setServerWarmupLogs] = useState<WarmupDialogue[]>(warmupDialogues);
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  // Auto-Stop & Warm-up Settings
  const [autoStopMode, setAutoStopMode] = useState<WarmupAutoStopMode>('BOTH');
  const [stopDurationMinutes, setStopDurationMinutes] = useState<number>(30);
  const [stopDialogueLimit, setStopDialogueLimit] = useState<number>(20);
  const [scriptStyle, setScriptStyle] = useState<'casual' | 'business' | 'sinhala_singlish' | 'office_sync' | 'custom'>('sinhala_singlish');
  const [customTopicPrompt, setCustomTopicPrompt] = useState<string>('');
  const [useAiGeneration, setUseAiGeneration] = useState<boolean>(true);

  // Automated Day & Time Schedule
  const [scheduleEnabled, setScheduleEnabled] = useState<boolean>(false);
  const [scheduleDays, setScheduleDays] = useState<number[]>([1, 2, 3, 4, 5]); // 1=Mon .. 5=Fri
  const [scheduleStartTime, setScheduleStartTime] = useState<string>('09:00');
  const [scheduleStopTime, setScheduleStopTime] = useState<string>('17:00');
  const [timezone, setTimezone] = useState<string>('Asia/Colombo');
  const [isScheduledWindowActive, setIsScheduledWindowActive] = useState<boolean>(false);
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('');

  // Guard to load initial config from server ONLY ONCE so polling never overwrites user input
  const initialConfigLoadedRef = useRef<boolean>(false);

  // Live Session Stats
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [dialoguesCompleted, setDialoguesCompleted] = useState<number>(0);
  const [autoStopTriggered, setAutoStopTriggered] = useState<boolean>(false);
  const [autoStopReason, setAutoStopReason] = useState<string | null>(null);
  const [nextPairInfo, setNextPairInfo] = useState<{ senderName: string; senderPhone: string; receiverName: string; receiverPhone: string } | null>(null);
  const [totalMeshPairs, setTotalMeshPairs] = useState<number>(0);

  // Time remaining calculation
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  // AI Script Preview Modal
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [previewSamples, setPreviewSamples] = useState<Array<{ id: number; message1: string; message2: string }>>([]);
  const [showPreviewModal, setShowPreviewModal] = useState<boolean>(false);

  // Helper to persist configuration to server
  const syncConfigToServer = async (partial: Partial<WarmupConfig>) => {
    try {
      await fetch('/api/warmup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial)
      });
    } catch (e) {
      console.warn('Failed to sync warmup config to server', e);
    }
  };

  const handleSelectMode = (mode: WarmupAutoStopMode) => {
    setAutoStopMode(mode);
    syncConfigToServer({ autoStopMode: mode });
  };

  const handleDurationChange = (val: number) => {
    setStopDurationMinutes(val);
    syncConfigToServer({ stopDurationMinutes: val });
  };

  const handleDialogueLimitChange = (val: number) => {
    setStopDialogueLimit(val);
    syncConfigToServer({ stopDialogueLimit: val });
  };

  const handleScriptStyleChange = (style: any) => {
    setScriptStyle(style);
    syncConfigToServer({ scriptStyle: style });
  };

  const handleToggleAiGeneration = (val: boolean) => {
    setUseAiGeneration(val);
    syncConfigToServer({ useAiGeneration: val });
  };

  const handleCustomPromptBlur = () => {
    syncConfigToServer({ customTopicPrompt });
  };

  // Schedule Handlers
  const handleToggleSchedule = (enabled: boolean) => {
    setScheduleEnabled(enabled);
    syncConfigToServer({ scheduleEnabled: enabled });
  };

  const handleToggleDay = (day: number) => {
    let next: number[];
    if (scheduleDays.includes(day)) {
      if (scheduleDays.length === 1) return; // Keep at least 1 day selected
      next = scheduleDays.filter(d => d !== day);
    } else {
      next = [...scheduleDays, day].sort();
    }
    setScheduleDays(next);
    syncConfigToServer({ scheduleDays: next });
  };

  const handlePresetDays = (preset: 'all' | 'weekdays' | 'weekends') => {
    let next: number[] = [];
    if (preset === 'all') next = [0, 1, 2, 3, 4, 5, 6];
    else if (preset === 'weekdays') next = [1, 2, 3, 4, 5];
    else if (preset === 'weekends') next = [0, 6];
    setScheduleDays(next);
    syncConfigToServer({ scheduleDays: next });
  };

  const handleStartTimeChange = (val: string) => {
    setScheduleStartTime(val);
    syncConfigToServer({ scheduleStartTime: val });
  };

  const handleStopTimeChange = (val: string) => {
    setScheduleStopTime(val);
    syncConfigToServer({ scheduleStopTime: val });
  };

  // Poll real server warmup status (LIVE STATS ONLY - NEVER OVERWRITES INPUTS)
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/warmup/status');
        if (res.ok) {
          const data = await res.json();
          setIsManualRunning(data.isRunning);
          setStartedAt(data.startedAt || null);
          setDialoguesCompleted(data.dialoguesCompletedThisSession || 0);
          setAutoStopTriggered(Boolean(data.autoStopTriggered));
          setAutoStopReason(data.autoStopReason || null);
          if (data.nextPairInfo) setNextPairInfo(data.nextPairInfo);
          if (typeof data.totalMeshPairs === 'number') setTotalMeshPairs(data.totalMeshPairs);
          if (data.isScheduledWindowActive !== undefined) setIsScheduledWindowActive(Boolean(data.isScheduledWindowActive));
          if (data.currentTimeStr) setCurrentTimeStr(data.currentTimeStr);

          if (Array.isArray(data.logs) && data.logs.length > 0) {
            setServerWarmupLogs(data.logs);
          }

          // Initial load only: load saved config from server on first render
          if (!initialConfigLoadedRef.current && data.config) {
            initialConfigLoadedRef.current = true;
            if (data.config.autoStopMode) setAutoStopMode(data.config.autoStopMode);
            if (data.config.stopDurationMinutes) setStopDurationMinutes(data.config.stopDurationMinutes);
            if (data.config.stopDialogueLimit) setStopDialogueLimit(data.config.stopDialogueLimit);
            if (data.config.scriptStyle) setScriptStyle(data.config.scriptStyle);
            if (data.config.customTopicPrompt !== undefined) setCustomTopicPrompt(data.config.customTopicPrompt);
            if (data.config.useAiGeneration !== undefined) setUseAiGeneration(data.config.useAiGeneration);
            if (data.config.scheduleEnabled !== undefined) setScheduleEnabled(Boolean(data.config.scheduleEnabled));
            if (Array.isArray(data.config.scheduleDays)) setScheduleDays(data.config.scheduleDays);
            if (data.config.scheduleStartTime) setScheduleStartTime(data.config.scheduleStartTime);
            if (data.config.scheduleStopTime) setScheduleStopTime(data.config.scheduleStopTime);
            if (data.config.timezone) setTimezone(data.config.timezone);
          }
        }
      } catch (e) {}
    };


    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Live timer tick
  useEffect(() => {
    if (!isManualRunning || !startedAt || (autoStopMode !== 'DURATION' && autoStopMode !== 'BOTH')) {
      setRemainingSeconds(null);
      return;
    }

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      const totalSec = stopDurationMinutes * 60;
      const left = Math.max(0, totalSec - elapsed);
      setRemainingSeconds(left);
    };

    updateTimer();
    const timerInterval = setInterval(updateTimer, 1000);
    return () => clearInterval(timerInterval);
  }, [isManualRunning, startedAt, autoStopMode, stopDurationMinutes]);

  const handleManualToggle = async () => {
    const nextState = !isManualRunning;
    setIsManualRunning(nextState);
    onToggleWarmupService();

    try {
      if (nextState) {
        setAutoStopTriggered(false);
        setAutoStopReason(null);
        await fetch('/api/warmup/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            autoStopMode,
            stopDurationMinutes,
            stopDialogueLimit,
            scriptStyle,
            customTopicPrompt,
            useAiGeneration
          })
        });
      } else {
        await fetch('/api/warmup/stop', { method: 'POST' });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTriggerRealP2P = async () => {
    setIsTriggering(true);
    setTriggerResult(null);

    try {
      const res = await fetch('/api/warmup/trigger-instant', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setTriggerResult('Real WhatsApp P2P exchange sent between linked accounts using next mesh rotation!');
        if (data.entry) {
          setServerWarmupLogs(prev => [data.entry, ...prev]);
        }
      } else {
        onTriggerInstantWarmup();
        setTriggerResult(data.error || 'Simulated dialogue triggered (link 2 real accounts for actual socket delivery).');
      }
    } catch (e: any) {
      onTriggerInstantWarmup();
      setTriggerResult('Triggered dialogue: ' + e.message);
    } finally {
      setIsTriggering(false);
    }
  };

  const handlePreviewAiScripts = async () => {
    setIsPreviewLoading(true);
    setShowPreviewModal(true);
    try {
      const res = await fetch('/api/warmup/preview-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptStyle,
          customTopicPrompt
        })
      });
      const data = await res.json();
      if (res.ok && data.samples) {
        setPreviewSamples(data.samples);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const formatTimeRemaining = (seconds: number | null): string => {
    if (seconds === null) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  const connectedAccounts = accounts.filter(a => a.status === 'CONNECTED');
  const warmupEnabledCount = accounts.filter(a => a.warmupEnabled && a.status === 'CONNECTED').length;
  const activeDialogues = serverWarmupLogs.length > 0 ? serverWarmupLogs : warmupDialogues;

  return (
    <div className="space-y-6">
      {/* Title & Manual Controller Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-white tracking-tight">
              Anti-Ban Account Warm-up Engine
            </h1>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded">
              FULL-MESH + AI DYNAMIC + AUTO-STOP
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Builds unbreakable trust by rotating natural dialogues between all connected WhatsApp accounts. Automatically stops when duration or dialogue limit is reached.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Preview AI Scripts */}
          <button
            onClick={handlePreviewAiScripts}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors cursor-pointer"
            title="Preview AI-generated conversation scripts"
          >
            <Eye className="w-3.5 h-3.5 text-cyan-400" />
            <span>Preview AI Scripts</span>
          </button>

          {/* Instant Trigger */}
          <button
            onClick={handleTriggerRealP2P}
            disabled={isTriggering || connectedAccounts.length < 2}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            title="Send an immediate real dialogue pair between the next 2 accounts"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{isTriggering ? 'Sending Real P2P...' : 'Trigger Immediate Exchange'}</span>
          </button>

          {/* Master Manual ON / OFF Switch */}
          <button
            onClick={handleManualToggle}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md cursor-pointer ${
              isManualRunning
                ? 'bg-rose-500 hover:bg-rose-400 text-white'
                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
            }`}
          >
            {isManualRunning ? (
              <>
                <Pause className="w-3.5 h-3.5 fill-white" />
                <span>Turn Warm-up OFF</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-slate-950" />
                <span>Turn Warm-up ON</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Auto-Stop Completed Banner */}
      {autoStopTriggered && autoStopReason && (
        <div className="p-4 bg-emerald-950/50 border border-emerald-500/40 rounded-xl text-xs text-emerald-300 flex items-start justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="font-bold text-white text-xs">Warm-up Goal Completed Automatically!</p>
              <p className="text-[11px] text-emerald-200/90 mt-0.5">{autoStopReason}</p>
            </div>
          </div>
          <button
            onClick={() => setAutoStopTriggered(false)}
            className="text-[10px] font-mono text-emerald-400 hover:text-white px-2 py-1 bg-emerald-900/40 rounded border border-emerald-700/50 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {triggerResult && (
        <div className="p-3 bg-slate-900 border border-amber-500/40 rounded-lg text-xs text-amber-300 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{triggerResult}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* State */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400">Warm-up Engine Status</span>
          <div className="text-base font-bold font-mono flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isManualRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            <span className={isManualRunning ? 'text-emerald-400' : 'text-slate-400'}>
              {isManualRunning ? 'RUNNING (ACTIVE)' : 'STOPPED (OFF)'}
            </span>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            {isManualRunning
              ? (autoStopMode === 'OFF' ? 'Manual stop required' : 'Auto-stop armed')
              : 'Idle until started'}
          </span>
        </div>

        {/* Full-Mesh Pairs Status */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400">Full-Mesh Peer Rotation</span>
          <div className="text-base font-bold font-mono text-white flex items-center gap-1.5">
            <ArrowRightLeft className="w-4 h-4 text-cyan-400" />
            <span>{connectedAccounts.length} Nodes ({totalMeshPairs || Math.max(0, connectedAccounts.length * (connectedAccounts.length - 1))} Pairs)</span>
          </div>
          <span className="text-[11px] text-slate-400 truncate block">
            {nextPairInfo ? `Next: ${nextPairInfo.senderName} ↔ ${nextPairInfo.receiverName}` : 'All accounts message each other'}
          </span>
        </div>

        {/* Auto-Stop Progress / Countdown */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400">Auto-Stop Target</span>
          <div className="text-base font-bold font-mono text-amber-400 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-amber-400" />
            {isManualRunning && remainingSeconds !== null ? (
              <span>{formatTimeRemaining(remainingSeconds)}</span>
            ) : (
              <span>
                {autoStopMode === 'OFF' && 'Continuous (Manual Only)'}
                {autoStopMode === 'DURATION' && `${stopDurationMinutes} mins`}
                {autoStopMode === 'DIALOGUE_LIMIT' && `${stopDialogueLimit} msgs`}
                {autoStopMode === 'BOTH' && `${stopDurationMinutes}m / ${stopDialogueLimit}dlgs`}
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            {isManualRunning
              ? `Done: ${dialoguesCompleted} ${autoStopMode === 'DIALOGUE_LIMIT' || autoStopMode === 'BOTH' ? `/ ${stopDialogueLimit}` : ''} dialogues`
              : 'Configured limit before stopping'}
          </span>
        </div>

        {/* Total Warmup Messages Sent */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400">Total Dialogue History</span>
          <div className="text-base font-bold font-mono text-white">
            {activeDialogues.length} Exchanged
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            Natural timing (45s - 75s intervals)
          </span>
        </div>
      </div>

      {/* Advanced Warm-up Configuration Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">
              Warm-up Engine Settings (AI Dynamic Scripts & Auto-Stop Controls)
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {isManualRunning ? '⚠️ Running live with current settings' : 'Settings permanently saved'}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Section 1: Auto-Stop Rules */}
          <div className="space-y-3 bg-slate-950/70 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <Timer className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                1. Auto-Stop Mode (ස්වයංක්‍රීයව Off වන නීති)
              </h4>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Choose when the warmup engine should automatically shut off, so you don't have to keep an eye on it.
            </p>

            {/* Mode Radios */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {[
                { id: 'BOTH', label: 'Time OR Limit', desc: 'Whichever first' },
                { id: 'DURATION', label: 'Time Limit', desc: 'Timer duration' },
                { id: 'DIALOGUE_LIMIT', label: 'Message Limit', desc: 'Max dialogues' },
                { id: 'OFF', label: 'Manual Only', desc: 'Never auto-stop' }
              ].map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelectMode(m.id as WarmupAutoStopMode)}
                  className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                    autoStopMode === m.id
                      ? 'bg-amber-500/15 border-amber-500 text-amber-300 shadow-sm shadow-amber-500/10'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <p className="text-xs font-bold">{m.label}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{m.desc}</p>
                </button>
              ))}
            </div>

            {/* Duration Input & Presets */}
            {(autoStopMode === 'DURATION' || autoStopMode === 'BOTH') && (
              <div className="space-y-1.5 pt-2">
                <label className="text-[11px] text-slate-300 font-medium block">
                  Stop After Duration (Minutes):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={stopDurationMinutes}
                    onChange={(e) => handleDurationChange(Math.max(1, Number(e.target.value)))}
                    disabled={isManualRunning}
                    className="w-24 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-white font-mono focus:border-amber-400 focus:outline-none disabled:opacity-50"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[15, 30, 60, 120].map(mins => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => handleDurationChange(mins)}
                        disabled={isManualRunning}
                        className={`px-2.5 py-1 text-[11px] rounded border font-mono transition-colors cursor-pointer disabled:opacity-50 ${
                          stopDurationMinutes === mins
                            ? 'bg-amber-500 text-slate-950 font-bold border-amber-500'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Dialogue Count Input & Presets */}
            {(autoStopMode === 'DIALOGUE_LIMIT' || autoStopMode === 'BOTH') && (
              <div className="space-y-1.5 pt-2">
                <label className="text-[11px] text-slate-300 font-medium block">
                  Stop After Dialogue Exchanges (Count):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="500"
                    value={stopDialogueLimit}
                    onChange={(e) => handleDialogueLimitChange(Math.max(1, Number(e.target.value)))}
                    disabled={isManualRunning}
                    className="w-24 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-white font-mono focus:border-amber-400 focus:outline-none disabled:opacity-50"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[10, 20, 30, 50, 100].map(cnt => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => handleDialogueLimitChange(cnt)}
                        disabled={isManualRunning}
                        className={`px-2.5 py-1 text-[11px] rounded border font-mono transition-colors cursor-pointer disabled:opacity-50 ${
                          stopDialogueLimit === cnt
                            ? 'bg-amber-500 text-slate-950 font-bold border-amber-500'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        {cnt} dlgs
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 2: AI Dynamic Script & Personality */}
          <div className="space-y-3 bg-slate-950/70 border border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  2. AI Script Variations (සෑම දිනකම අලුත් Messages)
                </h4>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={useAiGeneration}
                  onChange={(e) => handleToggleAiGeneration(e.target.checked)}
                  disabled={isManualRunning}
                  className="rounded text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <span className="text-[11px] text-cyan-300 font-mono">Gemini AI Engine</span>
              </label>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Every dialogue is dynamically varied with human-like topics, natural slang, and emojis so WhatsApp algorithms never flag repeated scripts.
            </p>

            {/* Script Style Selection */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-300 font-medium block">
                Conversation Topic & Dialect:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'sinhala_singlish', label: '🇱🇰 Sinhala / Singlish', desc: 'Ado machan, ela bro, call ekak' },
                  { id: 'casual', label: '💬 Casual Everyday', desc: 'Friendly check-ins & coffee' },
                  { id: 'business', label: '💼 Business & Orders', desc: 'Invoices, catalogs, delivery' },
                  { id: 'office_sync', label: '🏢 Office & Team Sync', desc: 'Updates, meetings, reports' }
                ].map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleScriptStyleChange(s.id as any)}
                    disabled={isManualRunning}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all disabled:opacity-50 ${
                      scriptStyle === s.id
                        ? 'bg-cyan-500/15 border-cyan-500 text-cyan-300 shadow-sm shadow-cyan-500/10'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <p className="text-xs font-bold">{s.label}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 truncate">{s.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Optional Custom Topic Prompt */}
            <div className="space-y-1 pt-1">
              <label className="text-[11px] text-slate-300 font-medium block">
                Custom Topic / Context (Optional):
              </label>
              <input
                type="text"
                placeholder="e.g. Chatting about ecommerce orders, school reunion, weekend plans..."
                value={customTopicPrompt}
                onChange={(e) => setCustomTopicPrompt(e.target.value)}
                onBlur={handleCustomPromptBlur}
                disabled={isManualRunning}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-xs text-white focus:border-cyan-400 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Automated Day & Time Schedule */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <Calendar className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <span>3. Automated Day & Time Schedule (ස්වයංක්‍රීය දින සහ වේලාවන්)</span>
                  {scheduleEnabled && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-400 font-semibold">
                      SCHEDULE ON
                    </span>
                  )}
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Set specific days and daily time window. The warm-up engine will automatically turn ON and OFF at your configured times.
                </p>
              </div>
            </div>

            {/* Enable/Disable Toggle */}
            <label className="flex items-center gap-3 cursor-pointer self-start sm:self-auto bg-slate-900 border border-slate-700/80 px-3 py-1.5 rounded-lg hover:border-slate-600 transition-colors">
              <span className="text-xs font-medium text-slate-200">
                {scheduleEnabled ? 'Schedule Enabled' : 'Schedule Disabled'}
              </span>
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => handleToggleSchedule(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500 focus:ring-0 cursor-pointer"
              />
            </label>
          </div>

          {/* Schedule Status Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-900/90 border border-slate-800 rounded-lg text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                !scheduleEnabled
                  ? 'bg-slate-600'
                  : isScheduledWindowActive
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-amber-400'
              }`} />
              <span className="font-medium text-slate-300">
                {!scheduleEnabled ? (
                  <span className="text-slate-400">Schedule is currently OFF. Warm-up runs only when manually started.</span>
                ) : isScheduledWindowActive ? (
                  <span className="text-emerald-300 font-semibold">
                    🟢 CURRENTLY RUNNING IN SCHEDULE WINDOW ({scheduleStartTime} - {scheduleStopTime})
                  </span>
                ) : (
                  <span className="text-amber-300 font-medium">
                    🟡 ARMED & WAITING: Next run at {scheduleStartTime} on selected days (Window: {scheduleStartTime} - {scheduleStopTime})
                  </span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              <span>Time: {currentTimeStr || 'Asia/Colombo (SLT)'}</span>
            </div>
          </div>

          {/* Days Selection & Time Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
            {/* Day Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-slate-300 font-semibold block">
                  Select Active Days (ක්‍රියාත්මක විය යුතු දින):
                </label>
                {/* Presets */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handlePresetDays('weekdays')}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                  >
                    Mon-Fri
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePresetDays('all')}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                  >
                    All 7 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePresetDays('weekends')}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                  >
                    Weekends
                  </button>
                </div>
              </div>

              {/* Day Chips */}
              <div className="grid grid-cols-7 gap-1.5">
                {[
                  { index: 1, label: 'Mon', full: 'Monday' },
                  { index: 2, label: 'Tue', full: 'Tuesday' },
                  { index: 3, label: 'Wed', full: 'Wednesday' },
                  { index: 4, label: 'Thu', full: 'Thursday' },
                  { index: 5, label: 'Fri', full: 'Friday' },
                  { index: 6, label: 'Sat', full: 'Saturday' },
                  { index: 0, label: 'Sun', full: 'Sunday' }
                ].map(d => {
                  const isSelected = scheduleDays.includes(d.index);
                  return (
                    <button
                      key={d.index}
                      type="button"
                      onClick={() => handleToggleDay(d.index)}
                      className={`py-2 px-1 rounded-lg border text-center transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold shadow-sm shadow-emerald-500/10'
                          : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                      }`}
                      title={d.full}
                    >
                      <span className="text-xs block">{d.label}</span>
                      <span className="text-[9px] block opacity-75">{isSelected ? 'ON' : 'OFF'}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time Window Inputs */}
            <div className="space-y-2">
              <label className="text-[11px] text-slate-300 font-semibold block">
                Daily Time Window (ස්වයංක්‍රීයව Start වන සහ Stop වන වේලාවන්):
              </label>

              <div className="grid grid-cols-2 gap-3">
                {/* Start Time */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase">
                      Start Time (පටන් ගන්නා වේලාව)
                    </span>
                    <Play className="w-3 h-3 text-emerald-400" />
                  </div>
                  <input
                    type="time"
                    value={scheduleStartTime}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-sm text-white font-mono focus:border-emerald-400 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500 block">
                    e.g. 09:00 AM (උදෑසන)
                  </span>
                </div>

                {/* Stop Time */}
                <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-rose-400 font-bold uppercase">
                      Stop Time (නතර වන වේලාව)
                    </span>
                    <Pause className="w-3 h-3 text-rose-400" />
                  </div>
                  <input
                    type="time"
                    value={scheduleStopTime}
                    onChange={(e) => handleStopTimeChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-sm text-white font-mono focus:border-rose-400 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-500 block">
                    e.g. 17:00 (සවස 5:00 PM)
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 bg-slate-900/60 rounded p-2 border border-slate-800/80 leading-relaxed">
                💡 <span className="text-slate-300 font-medium">Auto-Behavior:</span> Engine එක start වූ පසු, accounts අතර dynamic AI messages හුවමාරු වන අතර stop time පැමිණි විට හෝ configured dialogue limit එකට ළඟා වූ විට ස්වයංක්‍රීයව safely shut down වේ.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Accounts List & Live Dialogue Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Connected Accounts with Full-Mesh participation */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400" />
              <span>Participating WhatsApp Nodes</span>
            </h3>
            <span className="text-xs font-mono text-slate-400">{warmupEnabledCount} active</span>
          </div>

          <p className="text-xs text-slate-400">
            <strong>Full-Mesh Round-Robin:</strong> Every connected account will automatically message every other connected account in rotation.
          </p>

          <div className="space-y-3">
            {accounts.map((acc) => {
              const isConnected = acc.status === 'CONNECTED';
              return (
                <div
                  key={acc.id}
                  className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{acc.name}</p>
                    <p className="text-[11px] font-mono text-emerald-400 truncate">{acc.phoneNumber || 'Not linked'}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      isConnected ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-500'
                    }`}>
                      {isConnected ? 'ONLINE' : 'OFFLINE'}
                    </span>

                    <button
                      onClick={() => onToggleAccountWarmup(acc.id)}
                      disabled={!isConnected}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 ${
                        acc.warmupEnabled && isConnected ? 'bg-amber-500' : 'bg-slate-700'
                      }`}
                      title={acc.warmupEnabled ? 'Warmup Enabled for this account' : 'Warmup Disabled'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition duration-200 ease-in-out ${
                          acc.warmupEnabled && isConnected ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 text-[11px] text-slate-400 space-y-1.5">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Full-Mesh Anti-Ban Safety:</span>
            </span>
            <p>
              When multiple accounts talk to each other, WhatsApp sees authentic two-way communications. This naturally warms up SIM reputation and protects accounts against bans during bulk broadcasts.
            </p>
          </div>
        </div>

        {/* Right: Live Dialogue Feed */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-white">
                  Real Peer-to-Peer Dialogue Feed
                </h3>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono">
                {isManualRunning ? (
                  <span className="flex items-center gap-1.5 text-emerald-400 bg-emerald-950/70 border border-emerald-800 px-2 py-0.5 rounded">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Daemon Active</span>
                  </span>
                ) : (
                  <span className="text-slate-400 bg-slate-800 px-2 py-0.5 rounded">Engine Idle</span>
                )}
              </div>
            </div>

            {/* Conversation Bubbles */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 max-h-[460px] overflow-y-auto space-y-4">
              {activeDialogues.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs space-y-2">
                  <p>No warm-up dialogues yet.</p>
                  <p className="text-slate-600 text-[11px]">Click "Turn Warm-up ON" or "Trigger Immediate Exchange" to exchange real messages.</p>
                </div>
              ) : (
                activeDialogues.map((item, idx) => {
                  const isAutoNotice = item.isAutoStopNotice || item.fromAccountId === 'SYSTEM';
                  if (isAutoNotice) {
                    return (
                      <div key={item.id} className="p-3 bg-amber-950/40 border border-amber-600/50 rounded-xl text-center space-y-1">
                        <p className="text-xs font-bold text-amber-300">{item.message}</p>
                        <p className="text-[10px] font-mono text-slate-400">{item.timestamp}</p>
                      </div>
                    );
                  }

                  const isEven = idx % 2 === 0;
                  return (
                    <div
                      key={item.id}
                      className={`flex flex-col ${isEven ? 'items-start' : 'items-end'}`}
                    >
                      <div className="text-[10px] font-mono text-slate-400 mb-1 flex items-center gap-1.5">
                        <span className="text-emerald-400 font-semibold">{item.fromPhone}</span>
                        <span>→</span>
                        <span className="text-cyan-400 font-semibold">{item.toPhone}</span>
                        <span>·</span>
                        <span>{item.timestamp}</span>
                      </div>

                      <div
                        className={`p-3 rounded-2xl max-w-md text-xs leading-relaxed ${
                          isEven
                            ? 'bg-slate-800 text-slate-100 rounded-tl-xs border border-slate-700/60'
                            : 'bg-emerald-950/80 text-emerald-100 rounded-tr-xs border border-emerald-800/80'
                        }`}
                      >
                        <p>{item.message}</p>
                        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400 font-mono">
                          <CheckCheck className="w-3.5 h-3.5 text-blue-400" />
                          <span>{item.status}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400 font-mono gap-2">
            <span>Daemon Control: User Managed</span>
            <span>Style: {scriptStyle.toUpperCase()}</span>
            <span>Natural human delays: 45s - 75s</span>
          </div>
        </div>
      </div>

      {/* AI Scripts Preview Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">
                  AI Warm-up Scripts Preview ({scriptStyle.toUpperCase()})
                </h3>
              </div>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800 cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Here are sample realistic dialogue pairs generated for your current style settings. Real sockets will exchange messages like these:
            </p>

            {isPreviewLoading ? (
              <div className="py-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                <RotateCw className="w-5 h-5 text-cyan-400 animate-spin" />
                <span>Generating dynamic AI script samples...</span>
              </div>
            ) : (
              <div className="space-y-3 max-h-[340px] overflow-y-auto">
                {previewSamples.map(sample => (
                  <div key={sample.id} className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2 text-xs">
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 font-mono text-[11px] font-bold shrink-0">Account A:</span>
                      <p className="text-slate-200">{sample.message1}</p>
                    </div>
                    <div className="flex items-start gap-2 pt-1 border-t border-slate-900">
                      <span className="text-cyan-400 font-mono text-[11px] font-bold shrink-0">Account B:</span>
                      <p className="text-slate-300">{sample.message2}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                onClick={handlePreviewAiScripts}
                disabled={isPreviewLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                <Shuffle className="w-3.5 h-3.5 text-cyan-400" />
                <span>Regenerate Fresh Samples</span>
              </button>

              <button
                onClick={() => setShowPreviewModal(false)}
                className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold rounded-lg transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
