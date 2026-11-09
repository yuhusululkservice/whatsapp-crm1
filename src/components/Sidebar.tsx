import React from 'react';
import {
  Users,
  Send,
  Activity,
  Flame,
  MessageSquareCode,
  BookOpen,
  FolderGit2,
  HardDrive,
  ShieldAlert
} from 'lucide-react';

interface Props {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  connectedAccounts: number;
  activeCampaignsCount: number;
  warmupActive: boolean;
  stopNumbersCount?: number;
}

export const Sidebar: React.FC<Props> = ({
  activeTab,
  setActiveTab,
  connectedAccounts,
  activeCampaignsCount,
  warmupActive,
  stopNumbersCount = 0
}) => {
  const menuItems = [
    {
      id: 'accounts',
      label: 'Connected Accounts',
      icon: Users,
      badge: `${connectedAccounts} Online`
    },
    {
      id: 'campaigns',
      label: 'Campaign Studio',
      icon: Send,
      badge: 'Dynamic Timings'
    },
    {
      id: 'monitor',
      label: 'Live Queue Monitor',
      icon: Activity,
      badge: activeCampaignsCount > 0 ? `${activeCampaignsCount} Active` : 'Idle'
    },
    {
      id: 'stop_numbers',
      label: 'Stop Numbers Registry',
      icon: ShieldAlert,
      badge: `${stopNumbersCount} Blocked`
    },
    {
      id: 'warmup',
      label: 'P2P Warm-up Engine',
      icon: Flame,
      badge: warmupActive ? 'Auto-Chat' : 'Paused'
    },
    {
      id: 'crm',
      label: 'CRM & Auto-Responder',
      icon: MessageSquareCode,
      badge: 'Rules Active'
    },
    {
      id: 'codebase',
      label: 'A-Z Codebase & Guide',
      icon: BookOpen,
      badge: 'Export'
    }
  ];

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800/80 flex flex-col shrink-0 select-none">
      {/* Session directory status */}
      <div className="p-4 border-b border-slate-800/60">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <HardDrive className="w-3.5 h-3.5 text-slate-500" />
          <span className="truncate">./sessions (SQLite Local)</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-400/90">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span>Localhost Daemon Active</span>
        </div>
      </div>

      {/* Navigation items */}
      <nav className="p-3 space-y-1 flex-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-slate-800/90 text-white border border-slate-700/60'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span>{item.label}</span>
              </div>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                isActive ? 'text-emerald-300 bg-emerald-950/60' : 'text-slate-500'
              }`}>
                {item.badge}
              </span>
            </button>
          );
        })}
      </nav>

      {/* University Project Info Card */}
      <div className="p-3 m-3 bg-slate-900/80 border border-slate-800 rounded-lg text-[11px] text-slate-400 space-y-1.5">
        <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
          <FolderGit2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Local University Build</span>
        </div>
        <p className="text-slate-400 leading-relaxed">
          Zero external servers. Multi-device Baileys WebSockets with persistent disk storage.
        </p>
        <div className="pt-1 text-[10px] text-slate-400 font-mono flex items-center justify-between border-t border-slate-800">
          <span>PORT: 5000</span>
          <span>DB: SQLite3</span>
        </div>
      </div>
    </aside>
  );
};
