import React, { useState } from 'react';
import {
  Play,
  Pause,
  Square,
  Clock,
  Users,
  FileText,
  RotateCw,
  Download,
  AlertCircle,
  CheckCircle,
  Coffee,
  CheckCheck,
  FileDown,
  ShieldAlert,
  Search,
  Filter,
  Paperclip,
  AlertOctagon
} from 'lucide-react';
import { Campaign, DeliveryLog, WhatsAppAccount } from '../types';
import { generateCampaignPdfReport } from '../utils/pdfReportGenerator';

interface Props {
  campaign: Campaign | null;
  accounts: WhatsAppAccount[];
  logs: DeliveryLog[];
  onPauseCampaign: (id: string) => void;
  onResumeCampaign: (id: string) => void;
  onStopCampaign: (id: string) => void;
  onRestartCampaign?: (id: string, campaign?: Campaign) => void;
}

export const ActiveCampaignMonitor: React.FC<Props> = ({
  campaign,
  accounts,
  logs,
  onPauseCampaign,
  onResumeCampaign,
  onStopCampaign,
  onRestartCampaign
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  if (!campaign) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center max-w-xl mx-auto space-y-4">
        <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 mx-auto">
          <Clock className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-white">No Campaign Selected</h3>
        <p className="text-xs text-slate-400">
          Create or select a campaign to watch live Baileys dispatches, verify WhatsApp numbers, and export full PDF audit reports.
        </p>
      </div>
    );
  }

  const campaignLogs = logs.filter(l => l.campaignId === campaign.id || l.campaignName === campaign.name);
  const totalContacts = campaign.contacts?.length || campaign.stats?.total || campaignLogs.length || 0;
  const deliveredCount = campaignLogs.filter(l => l.status === 'DELIVERED' || l.status === 'READ').length;
  const noWhatsAppCount = campaignLogs.filter(l => l.status === 'NO_WHATSAPP' || l.hasWhatsApp === false).length;
  const stoppedCount = campaignLogs.filter(l => l.status === 'STOPPED').length;
  const duplicateCount = campaignLogs.filter(l => l.status === 'SKIPPED_DUPLICATE').length;
  const failedCount = campaignLogs.filter(l => l.status === 'FAILED').length;
  const processedCount = campaignLogs.length;

  const percentComplete = totalContacts > 0
    ? Math.min(100, Math.round((processedCount / totalContacts) * 100))
    : 0;

  const filteredLogs = campaignLogs.filter(log => {
    if (filterStatus === 'delivered' && log.status !== 'DELIVERED' && log.status !== 'READ') return false;
    if (filterStatus === 'no_whatsapp' && log.status !== 'NO_WHATSAPP') return false;
    if (filterStatus === 'stopped' && log.status !== 'STOPPED') return false;
    if (filterStatus === 'duplicate' && log.status !== 'SKIPPED_DUPLICATE') return false;
    if (filterStatus === 'failed' && log.status !== 'FAILED') return false;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        log.recipientName?.toLowerCase().includes(q) ||
        log.recipientPhone.toLowerCase().includes(q) ||
        log.senderName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleDownloadPdf = () => {
    setIsExportingPdf(true);
    try {
      generateCampaignPdfReport(campaign, campaignLogs);
    } catch (err) {
      console.error('PDF Export Error:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const exportLogsToCsv = () => {
    const headers = ['Timestamp', 'Recipient Phone', 'Recipient Name', 'WhatsApp Status', 'Execution Status', 'Sender Account', 'Sender Phone', 'Message Text', 'Media Attachment', 'Error'];
    const rows = campaignLogs.map(l => [
      `"${l.timestamp}"`,
      `"${l.recipientPhone}"`,
      `"${l.recipientName || ''}"`,
      l.status === 'NO_WHATSAPP' ? '"NO"' : l.status === 'STOPPED' ? '"OPT-OUT LIST"' : '"YES"',
      `"${l.status}"`,
      `"${l.senderName}"`,
      `"${l.senderPhone}"`,
      `"${(l.resolvedMessage || '').replace(/"/g, '""')}"`,
      `"${l.postAttachment || ''}"`,
      `"${l.errorMessage || ''}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Campaign_Report_${campaign.name.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-white tracking-tight">
              {campaign.name}
            </h1>
            <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
              campaign.status === 'running'
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                : campaign.status === 'paused'
                ? 'bg-amber-950/80 text-amber-300 border-amber-800'
                : 'bg-blue-950/80 text-blue-300 border-blue-800'
            }`}>
              {campaign.status.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time live queue execution, automatic WhatsApp existence verification, and audit report generator.
          </p>
        </div>

        {/* Action Buttons: Pause/Resume/Stop & PDF Download */}
        <div className="flex flex-wrap items-center gap-2">
          {campaign.status === 'running' && (
            <button
              onClick={() => onPauseCampaign(campaign.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5 fill-amber-300" />
              <span>Pause Queue</span>
            </button>
          )}

          {campaign.status === 'paused' && (
            <button
              onClick={() => onResumeCampaign(campaign.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-slate-950" />
              <span>Resume Queue</span>
            </button>
          )}

          {campaign.status !== 'completed' && campaign.status !== 'cancelled' && (
            <button
              onClick={() => onStopCampaign(campaign.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-700 hover:border-rose-900 rounded-lg text-xs font-medium transition-colors cursor-pointer"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Stop</span>
            </button>
          )}

          {(campaign.status === 'completed' || campaign.status === 'cancelled') && onRestartCampaign && (
            <button
              onClick={() => onRestartCampaign(campaign.id, campaign)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-slate-950" />
              <span>Restart Queue</span>
            </button>
          )}

          {/* Download Official PDF Audit Report */}
          <button
            onClick={handleDownloadPdf}
            disabled={isExportingPdf}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <FileDown className="w-4 h-4 stroke-[2.5]" />
            <span>{isExportingPdf ? 'Exporting PDF...' : 'Download PDF Report'}</span>
          </button>
        </div>
      </div>

      {/* Outside Delivery Time Window Notice */}
      {campaign.stats?.isWindowSleeping && (
        <div className="p-4 bg-indigo-950/70 border border-indigo-500/50 rounded-xl text-xs text-indigo-200 flex items-center justify-between gap-3 animate-fadeIn shadow-lg shadow-indigo-950/40">
          <div className="flex items-center gap-2.5">
            <Clock className="w-5 h-5 text-indigo-400 shrink-0 animate-pulse" />
            <div>
              <p className="font-bold text-white text-xs">Outside Allowed Delivery Window</p>
              <p className="text-[11px] text-indigo-300 mt-0.5">
                Current time is outside the campaign's allowed sending hours ({campaign.deliveryWindow?.startTime} - {campaign.deliveryWindow?.endTime}).
                The queue is safely paused and will automatically resume at <strong className="text-white">{campaign.stats.windowSleepResumeAt || campaign.deliveryWindow?.startTime}</strong> without risking number bans.
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono bg-indigo-900/60 text-indigo-300 border border-indigo-600/40 px-2.5 py-1 rounded-full whitespace-nowrap">
            Sleeping (Anti-Ban Guard)
          </span>
        </div>
      )}

      {/* 5 KPI Audit Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Targets */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400">Total Targets</span>
          <div className="text-xl font-bold font-mono text-white">
            {totalContacts}
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            {processedCount} processed ({percentComplete}%)
          </span>
        </div>

        {/* Successfully Delivered */}
        <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400 flex items-center justify-between">
            <span>Delivered</span>
            <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
          </span>
          <div className="text-xl font-bold font-mono text-emerald-400">
            {deliveredCount}
          </div>
          <span className="text-[11px] text-emerald-400/90 font-mono">
            {totalContacts > 0 ? Math.round((deliveredCount / totalContacts) * 100) : 0}% delivery rate
          </span>
        </div>

        {/* NOT ON WHATSAPP */}
        <div className="bg-slate-900 border border-rose-500/30 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400 flex items-center justify-between">
            <span>No WhatsApp</span>
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
          </span>
          <div className="text-xl font-bold font-mono text-rose-400">
            {noWhatsAppCount}
          </div>
          <span className="text-[11px] text-rose-400/90 font-mono">
            Filtered by Baileys
          </span>
        </div>

        {/* STOPPED (Stop List / Blacklist) */}
        <div className="bg-slate-900 border border-amber-500/30 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400 flex items-center justify-between">
            <span>Stop List (Opt-Out)</span>
            <AlertOctagon className="w-3.5 h-3.5 text-amber-400" />
          </span>
          <div className="text-xl font-bold font-mono text-amber-400">
            {stoppedCount}
          </div>
          <span className="text-[11px] text-amber-400/90 font-mono">
            Bypassed safely
          </span>
        </div>

        {/* Dynamic Delays / Anti-ban */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
          <span className="text-xs text-slate-400 flex items-center justify-between">
            <span>Anti-Ban Timing</span>
            <Clock className="w-3.5 h-3.5 text-slate-400" />
          </span>
          <div className="text-xs font-bold font-mono text-slate-300 truncate">
            {campaign.timings.minDelaySeconds}s - {campaign.timings.maxDelaySeconds}s delay
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            Sleep {campaign.timings.breakDurationSeconds}s / {campaign.timings.batchSize} msgs
          </span>
        </div>
      </div>

      {/* Real-time Progress Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="text-slate-400">Campaign Execution:</span>
            <span className="font-mono font-bold text-white text-sm">
              {processedCount} of {totalContacts} contacts evaluated
            </span>
          </div>
          <span className="font-mono text-emerald-400 font-bold">{percentComplete}%</span>
        </div>

        <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
          <div
            className="h-full bg-linear-to-r from-emerald-500 to-teal-400 transition-all duration-300"
            style={{ width: `${percentComplete}%` }}
          />
        </div>
      </div>

      {/* Comprehensive Delivery Logs & Audit Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden space-y-0">
        <div className="p-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">
              Campaign Audit Log & Recipient Breakdown ({filteredLogs.length})
            </h3>
          </div>

          {/* Filters & Export Options */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1 bg-slate-950 border border-slate-800 p-1 rounded-lg">
              <button
                onClick={() => setFilterStatus('all')}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  filterStatus === 'all' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-white'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterStatus('delivered')}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  filterStatus === 'delivered' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 font-medium' : 'text-slate-400 hover:text-white'
                }`}
              >
                Delivered ({deliveredCount})
              </button>
              <button
                onClick={() => setFilterStatus('no_whatsapp')}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  filterStatus === 'no_whatsapp' ? 'bg-rose-950 text-rose-300 border border-rose-800 font-medium' : 'text-slate-400 hover:text-white'
                }`}
              >
                No WhatsApp ({noWhatsAppCount})
              </button>
              <button
                onClick={() => setFilterStatus('stopped')}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  filterStatus === 'stopped' ? 'bg-amber-950 text-amber-300 border border-amber-800 font-medium' : 'text-slate-400 hover:text-white'
                }`}
              >
                Stop List ({stoppedCount})
              </button>
              {duplicateCount > 0 && (
                <button
                  onClick={() => setFilterStatus('duplicate')}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    filterStatus === 'duplicate' ? 'bg-slate-800 text-slate-300 border border-slate-700 font-medium' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Duplicates ({duplicateCount})
                </button>
              )}
            </div>

            {/* Search Input */}
            <input
              type="text"
              placeholder="Search phone or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-500 w-44 focus:outline-none focus:border-emerald-500"
            />

            {/* CSV Export Button */}
            <button
              onClick={exportLogsToCsv}
              className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
          </div>
        </div>

        {/* Audit Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 font-mono text-[11px] border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Time</th>
                <th className="py-2.5 px-4">Recipient</th>
                <th className="py-2.5 px-4">WhatsApp Registered?</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Sender Account</th>
                <th className="py-2.5 px-4">Message / Post Attachment Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 text-xs">
                    No recipient events matching this filter.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isNoWhatsApp = log.status === 'NO_WHATSAPP' || log.hasWhatsApp === false;
                  const isStopped = log.status === 'STOPPED';
                  const isDuplicate = log.status === 'SKIPPED_DUPLICATE';

                  return (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                        {log.timestamp.split(' ')[1] || log.timestamp}
                      </td>

                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <div className="font-semibold text-white">{log.recipientName || 'Contact'}</div>
                        <div className="font-mono text-[11px] text-slate-400">{log.recipientPhone}</div>
                      </td>

                      {/* Real WhatsApp Presence Verification */}
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {isStopped ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-400 bg-amber-950/70 border border-amber-800/80 px-2 py-0.5 rounded">
                            <AlertOctagon className="w-3 h-3" />
                            <span>In Stop List</span>
                          </span>
                        ) : isDuplicate ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                            <span>Duplicate</span>
                          </span>
                        ) : isNoWhatsApp ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-400 bg-rose-950/60 border border-rose-800/80 px-2 py-0.5 rounded">
                            <ShieldAlert className="w-3 h-3" />
                            <span>No WhatsApp</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded">
                            <CheckCheck className="w-3 h-3" />
                            <span>Registered</span>
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded border ${
                          log.status === 'READ'
                            ? 'bg-blue-950/70 text-blue-300 border-blue-800'
                            : log.status === 'DELIVERED'
                            ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800'
                            : log.status === 'STOPPED'
                            ? 'bg-amber-950/80 text-amber-300 border-amber-800 font-bold'
                            : log.status === 'SKIPPED_DUPLICATE'
                            ? 'bg-slate-900 text-slate-400 border-slate-700'
                            : log.status === 'NO_WHATSAPP'
                            ? 'bg-rose-950/70 text-rose-300 border-rose-800 font-bold'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {log.status === 'READ' && <CheckCheck className="w-3 h-3 text-blue-400" />}
                          {log.status === 'DELIVERED' && <CheckCircle className="w-3 h-3 text-emerald-400" />}
                          {log.status === 'STOPPED' && <AlertOctagon className="w-3 h-3 text-amber-400" />}
                          <span>{log.status === 'STOPPED' ? 'STOPPED (Opt-Out)' : log.status === 'SKIPPED_DUPLICATE' ? 'DUPLICATE SKIPPED' : log.status}</span>
                        </span>
                      </td>

                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {isStopped ? (
                          <div>
                            <div className="text-amber-400 font-bold text-xs">BLOCKED</div>
                            <div className="font-mono text-[10px] text-amber-500/80">Opt-Out Protection</div>
                          </div>
                        ) : isDuplicate ? (
                          <div>
                            <div className="text-slate-400 font-medium text-xs">SKIPPED</div>
                            <div className="font-mono text-[10px] text-slate-500">Duplicate Guard</div>
                          </div>
                        ) : (
                          <div>
                            <div className="text-slate-200 font-medium">{log.senderName}</div>
                            <div className="font-mono text-[11px] text-slate-400">{log.senderPhone}</div>
                          </div>
                        )}
                      </td>

                      {/* Message and Attachment details */}
                      <td className="py-2.5 px-4 max-w-sm truncate text-slate-300 text-[11px]" title={log.resolvedMessage}>
                        <p className={`truncate ${isStopped ? 'text-amber-300/90 font-medium' : isDuplicate ? 'text-slate-400' : ''}`}>
                          {log.resolvedMessage}
                        </p>
                        {!isStopped && !isDuplicate && log.postAttachment && (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                            <Paperclip className="w-2.5 h-2.5" />
                            <span>{log.postAttachment}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
