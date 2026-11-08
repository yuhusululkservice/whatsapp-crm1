import React, { useState } from 'react';
import {
  Code2,
  Copy,
  Check,
  Download,
  Terminal,
  FileCode,
  FolderGit2,
  Layers,
  Database,
  Server,
  Layout,
  ExternalLink,
  Cloud,
  HardDrive,
  CheckCircle2,
  Sparkles,
  Laptop
} from 'lucide-react';
import { EXPORTABLE_CODEBASE, CodeFile } from '../data/exportableCodebase';

export const CodebaseExportView: React.FC = () => {
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [copiedFile, setCopiedFile] = useState<boolean>(false);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [deploymentPlatform, setDeploymentPlatform] = useState<'railway' | 'render' | 'hostinger'>('railway');

  const selectedFile: CodeFile = EXPORTABLE_CODEBASE[selectedFileIdx] || EXPORTABLE_CODEBASE[0];

  const handleCopyCode = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 2000);
  };


  const handleDownloadSingleFile = () => {
    const blob = new Blob([selectedFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = selectedFile.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAllScript = () => {
    // Generate an automatic shell script setup that recreates all files
    let scriptContent = `#!/usr/bin/env bash
# Automated Setup Script for YUHUSULU CRM
echo "Initializing YUHUSULU CRM Local Codebase..."

mkdir -p backend/db backend/services frontend/components docs data sessions
`;

    EXPORTABLE_CODEBASE.forEach(file => {
      if (file.filename !== 'A-Z_COMPLETE_GUIDELINE.md') {
        scriptContent += `\ncat << 'EOF' > ${file.path}\n${file.content}\nEOF\n`;
      }
    });

    scriptContent += `\necho "All files created successfully!"\necho "Run cd backend && npm install && npm run dev to start."\n`;

    const blob = new Blob([scriptContent], { type: 'text/x-sh' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'setup_local_project.sh';
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredFiles = activeCategory === 'all'
    ? EXPORTABLE_CODEBASE
    : EXPORTABLE_CODEBASE.filter(f => f.category === activeCategory);

  return (
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-white tracking-tight">
              24/7 Cloud &amp; Production Deployment Hub
            </h1>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded flex items-center gap-1">
              <Cloud className="w-3 h-3 text-emerald-400" />
              <span>RUNS 24/7 (LAPTOP CAN BE OFF)</span>
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Deploy on Railway.app or Render.com so your WhatsApp campaigns and warm-up run continuously without keeping your computer on.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/downloads/yuhusulu_whatsapp_crm_cloud.zip"
            download="yuhusulu_whatsapp_crm_cloud.zip"
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-gradient-to-r from-cyan-500 to-emerald-400 hover:opacity-95 text-slate-950 text-xs font-bold rounded-lg shadow-sm transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Cloud Package (.zip)</span>
          </a>

          <button
            onClick={handleDownloadAllScript}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Localhost Shell Script (.sh)</span>
          </button>
        </div>
      </div>

      {/* Cloud & Hosting Platform Selector */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => setDeploymentPlatform('railway')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              deploymentPlatform === 'railway'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>Railway.app (Recommended - Free &amp; Persistent)</span>
          </button>

          <button
            type="button"
            onClick={() => setDeploymentPlatform('render')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              deploymentPlatform === 'render'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Cloud className="w-4 h-4 text-cyan-400" />
            <span>Render.com (Free Web Service)</span>
          </button>

          <button
            type="button"
            onClick={() => setDeploymentPlatform('hostinger')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              deploymentPlatform === 'hostinger'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Server className="w-4 h-4 text-emerald-400" />
            <span>Hostinger Business Hosting (SSH / Node.js)</span>
          </button>
        </div>

        {/* TAB 1: RAILWAY.APP */}
        {deploymentPlatform === 'railway' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-purple-950/30 border border-purple-800/50 rounded-xl p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white flex items-center gap-1.5">
                    <span>Railway.app මත WhatsApp CRM 24/7 Run කිරීම</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                      NO LAPTOP NEEDED
                    </span>
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Railway හි **Persistent Volume** පහසුකම ඇති බැවින් ඔබ Scan කරන WhatsApp Login Sessions කිසිදා Logout නොවී පවතී. Laptop එක Off කළද වැඩ කරයි!
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <a
                  href="/downloads/yuhusulu_whatsapp_crm_cloud.zip"
                  download="yuhusulu_whatsapp_crm_cloud.zip"
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 hover:opacity-90 text-white text-xs font-bold rounded-lg shadow transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Cloud Package (.zip)</span>
                </a>

                <a
                  href="https://railway.com"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Railway.com</span>
                </a>
              </div>
            </div>

            {/* 4 Steps for Railway */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3.5 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-1.5 text-purple-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center text-[11px]">1</span>
                  <span>Download &amp; Extract ZIP</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  ඉහත ඇති Cloud ZIP එක බාගත කර Extract කරන්න. මෙහි `railway.json` හා `Procfile` සූදානම් කර ඇත.
                </p>
              </div>

              <div className="p-3.5 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-1.5 text-purple-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center text-[11px]">2</span>
                  <span>Upload to GitHub</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  <a href="https://github.com" target="_blank" rel="noreferrer" className="text-purple-300 underline">github.com</a> වෙත ගොස් නොමිලේ Repository එකක් සාදා Extract කළ ගොනු Upload කරන්න.
                </p>
              </div>

              <div className="p-3.5 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-1.5 text-purple-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center text-[11px]">3</span>
                  <span>Deploy in Railway</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Railway.com හි **New Project ➡️ Deploy from GitHub** තෝරා ඔබේ Repo එක Select කරන්න. තත්පර 45න් build වේ.
                </p>
              </div>

              <div className="p-3.5 bg-slate-950/80 rounded-lg border border-emerald-500/40 bg-emerald-950/20 space-y-1.5">
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[11px]">4</span>
                  <span>Add Volume &amp; Scan QR</span>
                </div>
                <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                  Railway Settings හි **Add Volume** ඔබා `/app/data` දෙන්න. Domain එක Click කර QR Code එක Scan කරන්න!
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: RENDER.COM */}
        {deploymentPlatform === 'render' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-cyan-950/30 border border-cyan-800/50 rounded-xl p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white flex items-center gap-1.5">
                    <span>Render.com මත 100% Free Web Service සැකසීම</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                      FREE TIER
                    </span>
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Render හි නොමිලේ Node.js Web Service එකක් සාදා Git push මඟින් Auto-Deploy කළ හැක.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <a
                  href="/downloads/yuhusulu_whatsapp_crm_cloud.zip"
                  download="yuhusulu_whatsapp_crm_cloud.zip"
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 text-slate-950 text-xs font-bold rounded-lg shadow transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Package (.zip)</span>
                </a>

                <a
                  href="https://render.com"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Render.com</span>
                </a>
              </div>
            </div>

            {/* 4 Steps for Render */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3.5 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center text-[11px]">1</span>
                  <span>GitHub Repository</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Cloud ZIP එකේ ඇති ගොනු ඔබගේ GitHub ගිණුමේ අලුත් repository එකකට upload කරන්න.
                </p>
              </div>

              <div className="p-3.5 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center text-[11px]">2</span>
                  <span>Create Web Service</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Render Dashboard ➡️ **New + ➡️ Web Service** තෝරා ඔබගේ GitHub repository එක Connect කරන්න.
                </p>
              </div>

              <div className="p-3.5 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1.5">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center text-[11px]">3</span>
                  <span>Build &amp; Start Commands</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed font-mono text-[10px]">
                  Build: npm install &amp;&amp; npm run build<br />
                  Start: npm start
                </p>
              </div>

              <div className="p-3.5 bg-slate-950/80 rounded-lg border border-emerald-500/40 bg-emerald-950/20 space-y-1.5">
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[11px]">4</span>
                  <span>24/7 Keep-Alive Ping</span>
                </div>
                <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                  <a href="https://uptimerobot.com" target="_blank" rel="noreferrer" className="underline font-bold text-white">uptimerobot.com</a> හරහා ඔබගේ Render URL එකට 5 min ping එකක් දමන්න. එවිට sleep නොවී 24/7 වැඩ කරයි!
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: HOSTINGER */}
        {deploymentPlatform === 'hostinger' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white flex items-center gap-1.5">
                    <span>Hostinger Business Web Hosting: SSH &amp; Node.js Setup</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                      SSH ACTIVE
                    </span>
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Hostinger hPanel හි File Manager හෝ SSH මඟින් Node.js server.js ක්‍රියාත්මක කිරීමේ පියවර.
                </p>
              </div>

              <a
                href="/downloads/yuhusulu_whatsapp_crm_hostinger.zip"
                download="yuhusulu_whatsapp_crm_hostinger.zip"
                className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-emerald-500 to-teal-400 hover:opacity-90 text-slate-950 text-xs font-bold rounded-lg shadow transition-all shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Hostinger Package (.zip)</span>
              </a>
            </div>

            {/* 5 Step Visual Flow for Hostinger */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-1 text-xs">
              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center text-[11px]">1</span>
                  <span>Upload ZIP</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Hostinger File Manager &gt; `public_html` වෙත ZIP එක Upload කර Extract කරන්න.
                </p>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center text-[11px]">2</span>
                  <span>SSH Login</span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono text-[10px]">
                  ssh -p 65002 uXXXX@ip<br />
                  cd public_html
                </p>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center text-[11px]">3</span>
                  <span>Install Modules</span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono text-[10px]">
                  npm install --omit=dev
                </p>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 space-y-1">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center text-[11px]">4</span>
                  <span>Start Server</span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono text-[10px]">
                  nohup node server.js &gt; app.log 2&gt;&amp;1 &amp;
                </p>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-lg border border-emerald-500/40 bg-emerald-950/20 space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[11px]">5</span>
                  <span>Cron Revival</span>
                </div>
                <p className="text-[11px] text-emerald-300/80">
                  hPanel Cron: `pgrep -f "node server.js" || node server.js &amp;`
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4 Pillars Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          onClick={() => setActiveCategory('guideline')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeCategory === 'guideline'
              ? 'bg-emerald-950/30 border-emerald-500/60 text-white'
              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
            <Terminal className="w-4 h-4" />
            <span>PART 1: A-Z Guideline</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Architecture, laptop prerequisites (Node, Git), and setup terminal commands.
          </p>
        </div>

        <div
          onClick={() => setActiveCategory('schema')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeCategory === 'schema'
              ? 'bg-emerald-950/30 border-emerald-500/60 text-white'
              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
            <Database className="w-4 h-4" />
            <span>PART 2: SQLite Schema</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Tables for accounts, dynamic campaign timings, multi-templates, and logs.
          </p>
        </div>

        <div
          onClick={() => setActiveCategory('backend')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeCategory === 'backend'
              ? 'bg-emerald-950/30 border-emerald-500/60 text-white'
              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
            <Server className="w-4 h-4" />
            <span>PART 3: Backend Code</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Baileys persistent auth, queue engine with dynamic delay & rotation, warm-up daemon.
          </p>
        </div>

        <div
          onClick={() => setActiveCategory('frontend')}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeCategory === 'frontend'
              ? 'bg-emerald-950/30 border-emerald-500/60 text-white'
              : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
            <Layout className="w-4 h-4" />
            <span>PART 4: Next.js UI</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            QR scanner modal, dynamic timing inputs, and multi-template spintax composer.
          </p>
        </div>
      </div>

      {/* Main Code Viewer Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        {/* Left: File Explorer */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <FolderGit2 className="w-4 h-4 text-emerald-400" />
              <span>Project Files</span>
            </div>
            {activeCategory !== 'all' && (
              <button
                onClick={() => setActiveCategory('all')}
                className="text-[10px] text-slate-400 hover:text-white"
              >
                Show All
              </button>
            )}
          </div>

          <div className="p-2 space-y-1">
            {filteredFiles.map((f, i) => {
              const actualIdx = EXPORTABLE_CODEBASE.findIndex(item => item.filename === f.filename);
              const isSelected = actualIdx === selectedFileIdx;
              return (
                <button
                  key={f.filename}
                  onClick={() => setSelectedFileIdx(actualIdx)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono flex items-center justify-between transition-colors ${
                    isSelected
                      ? 'bg-slate-800 text-emerald-400 border border-slate-700 font-semibold'
                      : 'text-slate-400 hover:text-white hover:bg-slate-950'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileCode className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                    <span className="truncate">{f.filename}</span>
                  </div>
                  <span className="text-[9px] text-slate-400 uppercase font-sans shrink-0 ml-1">
                    {f.language}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Code Viewer Canvas */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-2xl">
          {/* File Header Bar */}
          <div className="px-4 py-3 bg-slate-950/80 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white font-mono">{selectedFile.filename}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                  {selectedFile.path}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                {selectedFile.description}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
              >
                {copiedFile ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-semibold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Code</span>
                  </>
                )}
              </button>

              <button
                onClick={handleDownloadSingleFile}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save File</span>
              </button>
            </div>
          </div>

          {/* Code Window with Tabular Numeral Line Numbers */}
          <div className="p-4 bg-slate-950 overflow-x-auto max-h-[620px] overflow-y-auto">
            <pre className="text-xs font-mono text-slate-200 leading-relaxed">
              <code>{selectedFile.content}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
