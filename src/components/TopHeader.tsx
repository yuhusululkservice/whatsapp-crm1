import React from 'react';
import { Smartphone, Zap, Play, Terminal } from 'lucide-react';

interface Props {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  connectedAccountsCount: number;
  onOpenNewCampaign: () => void;
  onOpenConnectAccount: () => void;
}

export const TopHeader: React.FC<Props> = ({
  activeTab,
  setActiveTab,
  connectedAccountsCount,
  onOpenNewCampaign,
  onOpenConnectAccount
}) => {
  return (
    <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-slate-900 border-b border-slate-800 shrink-0 select-none">
      {/* Zone 1: Single text element wordmark */}
      <div className="flex items-center gap-3 whitespace-nowrap shrink-0">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
          <Zap className="w-4 h-4 fill-emerald-400" />
        </div>
        <span className="text-base font-bold tracking-tight text-white">
          YUHUSULU CRM
        </span>
        <span className="text-xs text-slate-400 font-mono hidden sm:inline">
          · Enterprise WhatsApp Engine
        </span>
        <span className="hidden xl:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono text-cyan-300 bg-cyan-950/60 border border-cyan-800/60">
          Node.js · TypeScript · Zero PHP
        </span>
      </div>

      {/* Zone 2: Clean single-line text navigation links */}
      <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-400">
        <button
          onClick={() => setActiveTab('accounts')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'accounts' ? 'text-emerald-400 font-semibold' : ''
          }`}
        >
          Accounts ({connectedAccountsCount})
        </button>
        <button
          onClick={() => setActiveTab('campaigns')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'campaigns' ? 'text-emerald-400 font-semibold' : ''
          }`}
        >
          Campaigns &amp; Timings
        </button>
        <button
          onClick={() => setActiveTab('monitor')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'monitor' ? 'text-emerald-400 font-semibold' : ''
          }`}
        >
          Live Queue Monitor
        </button>
        <button
          onClick={() => setActiveTab('stop_numbers')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
            activeTab === 'stop_numbers' ? 'text-rose-400 font-semibold' : 'text-slate-400 hover:text-rose-300'
          }`}
        >
          <span>Stop Numbers</span>
        </button>
        <button
          onClick={() => setActiveTab('warmup')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'warmup' ? 'text-emerald-400 font-semibold' : ''
          }`}
        >
          Anti-Ban Warm-up
        </button>
        <button
          onClick={() => setActiveTab('crm')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
            activeTab === 'crm' ? 'text-emerald-400 font-semibold' : ''
          }`}
        >
          CRM & Rules
        </button>
        <button
          onClick={() => setActiveTab('codebase')}
          className={`hover:text-white transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
            activeTab === 'codebase' ? 'text-emerald-400 font-semibold' : 'text-amber-400/90 hover:text-amber-300'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          24/7 Cloud &amp; Codebase
        </button>
      </nav>

      {/* Zone 3: 1 primary action */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onOpenConnectAccount}
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
          <span>Add Account</span>
        </button>
        <button
          onClick={onOpenNewCampaign}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg shadow-sm transition-colors whitespace-nowrap shrink-0"
        >
          <Play className="w-3.5 h-3.5 fill-slate-950" />
          <span>New Campaign</span>
        </button>
      </div>
    </header>
  );
};
