import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Plus,
  Trash2,
  Search,
  Download,
  Upload,
  AlertOctagon,
  CheckCircle2,
  FileText,
  UserX,
  PhoneCall,
  RefreshCw,
  Info
} from 'lucide-react';
import { StopNumber } from '../types';
import { normalizePhoneNumber, formatPhoneDisplay } from '../utils/phoneUtils';

interface Props {
  onStopNumbersUpdated?: (count: number) => void;
}

export const StopNumbersView: React.FC<Props> = ({ onStopNumbersUpdated }) => {
  const [stopNumbers, setStopNumbers] = useState<StopNumber[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [bulkInput, setBulkInput] = useState<string>('');
  const [selectedReason, setSelectedReason] = useState<string>('Opt-Out (STOP requested)');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Quick checker state
  const [checkPhone, setCheckPhone] = useState<string>('');
  const [checkResult, setCheckResult] = useState<{ isBlocked: boolean; details?: StopNumber } | null>(null);

  const fetchStopNumbers = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/stop-numbers');
      if (res.ok) {
        const data = await res.json();
        const list: StopNumber[] = data.stopNumbers || [];
        setStopNumbers(list);
        if (onStopNumbersUpdated) onStopNumbersUpdated(list.length);
      }
    } catch (err: any) {
      console.error('Failed to load stop numbers:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStopNumbers();
  }, []);

  const handleAddNumbers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkInput.trim()) return;

    setIsSubmitting(true);
    setActionMessage(null);

    try {
      const res = await fetch('/api/stop-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numbers: bulkInput,
          reason: selectedReason
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStopNumbers(data.stopNumbers || []);
        setBulkInput('');
        setActionMessage({
          type: 'success',
          text: `Successfully registered ${data.addedCount} numbers into the Stop Numbers list!`
        });
        if (onStopNumbersUpdated) onStopNumbersUpdated(data.total || data.stopNumbers.length);
      } else {
        setActionMessage({
          type: 'error',
          text: data.error || 'Failed to add numbers to stop list'
        });
      }
    } catch (err: any) {
      setActionMessage({
        type: 'error',
        text: err.message || 'Network error while adding stop numbers'
      });
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setActionMessage(null), 5000);
    }
  };

  const handleRemoveNumber = async (id: string, phone: string) => {
    if (!confirm(`Remove ${phone} from the Stop List? This number will be eligible to receive campaign messages again.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/stop-numbers/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStopNumbers(data.stopNumbers || []);
        if (onStopNumbersUpdated) onStopNumbersUpdated(data.total);
      }
    } catch (err) {
      console.error('Failed to remove number:', err);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear ALL Stop numbers? This will unblock all previously excluded contacts.')) {
      return;
    }

    try {
      const res = await fetch('/api/stop-numbers/clear', { method: 'POST' });
      if (res.ok) {
        setStopNumbers([]);
        if (onStopNumbersUpdated) onStopNumbersUpdated(0);
        setActionMessage({
          type: 'success',
          text: 'All stop numbers have been cleared.'
        });
      }
    } catch (err) {
      console.error('Failed to clear stop numbers:', err);
    }
  };

  const handleCheckNumber = () => {
    if (!checkPhone.trim()) {
      setCheckResult(null);
      return;
    }
    const norm = normalizePhoneNumber(checkPhone);
    const found = stopNumbers.find(s => s.normalizedPhone === norm || s.phoneNumber === checkPhone.trim());
    if (found) {
      setCheckResult({ isBlocked: true, details: found });
    } else {
      setCheckResult({ isBlocked: false });
    }
  };

  const handleExportCsv = () => {
    if (stopNumbers.length === 0) {
      alert('No stop numbers to export.');
      return;
    }

    const headers = ['Phone Number', 'Normalized ID', 'Category / Reason', 'Date Added'];
    const rows = stopNumbers.map(item => [
      `"${item.phoneNumber}"`,
      `"${item.normalizedPhone}"`,
      `"${item.reason || ''}"`,
      `"${item.addedAt || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Yuhusulu_Stop_Numbers_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered stop numbers
  const filteredList = stopNumbers.filter(item => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.phoneNumber.toLowerCase().includes(q) ||
      item.normalizedPhone.toLowerCase().includes(q) ||
      (item.reason && item.reason.toLowerCase().includes(q))
    );
  });

  // Calculate detected count in bulk input
  const detectedBulkCount = bulkInput.trim()
    ? bulkInput.split(/[\r\n,;\s]+/).map(t => t.trim()).filter(t => t.length >= 7).length
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                Stop Numbers Registry
                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800">
                  {stopNumbers.length} Blocked
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Any phone number added here will strictly NEVER receive messages in any campaign. If present in a campaign queue, the engine automatically skips it and flags it as STOPPED in the audit report.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={fetchStopNumbers}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium border border-slate-700 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handleExportCsv}
            disabled={stopNumbers.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium border border-slate-700 transition-colors disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          {stopNumbers.length > 0 && (
            <button
              onClick={handleClearAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 hover:text-rose-200 rounded-lg text-xs font-medium border border-rose-800/80 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear List</span>
            </button>
          )}
        </div>
      </div>

      {actionMessage && (
        <div
          className={`p-3 rounded-lg text-xs font-medium border flex items-center gap-2 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
              : 'bg-rose-950/80 text-rose-300 border-rose-800'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{actionMessage.text}</span>
        </div>
      )}

      {/* Grid: Add Form + Quick Verifier */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Bulk Add Form */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <UserX className="w-4 h-4 text-rose-400" />
              <h2 className="text-sm font-semibold text-white">Add Numbers to Stop List</h2>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              Supports commas, newlines & vertical lists
            </span>
          </div>

          <form onSubmit={handleAddNumbers} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Paste Phone Numbers (Single or Bulk):
              </label>
              <textarea
                rows={4}
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder="0703393139, 0771234567&#10;0719876543&#10;+94723456789"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500 placeholder-slate-600 leading-relaxed"
              />
              <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5">
                <span>
                  Detected valid numbers: <strong className="text-rose-400 font-mono">{detectedBulkCount}</strong>
                </span>
                <span className="text-slate-500">
                  e.g. 070..., 077..., 94... or comma-separated
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Reason / Stop Category:
                </label>
                <select
                  value={selectedReason}
                  onChange={(e) => setSelectedReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500"
                >
                  <option value="Opt-Out (STOP requested)">Opt-Out (Replied STOP / Unsubscribe)</option>
                  <option value="Do Not Disturb (VIP / Sensitive)">Do Not Disturb (VIP / Sensitive)</option>
                  <option value="Customer Complaint">Customer Complaint</option>
                  <option value="Competitor / Exclude">Competitor / Internal Exclude</option>
                  <option value="Manual Blacklist">Manual Blacklist</option>
                  <option value="Invalid / Inactive Number">Invalid / Inactive Number</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={isSubmitting || detectedBulkCount === 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-rose-500 hover:bg-rose-400 disabled:bg-slate-800 disabled:text-slate-600 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isSubmitting ? 'Registering...' : `Add ${detectedBulkCount > 0 ? detectedBulkCount : ''} to Stop List`}</span>
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Right Column: Quick Status Check */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <PhoneCall className="w-4 h-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">Instant Number Checker</h2>
            </div>

            <p className="text-xs text-slate-400">
              Type any customer number to check if it is active in your Stop list or safe to contact.
            </p>

            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={checkPhone}
                  onChange={(e) => {
                    setCheckPhone(e.target.value);
                    setCheckResult(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleCheckNumber()}
                  placeholder="e.g. 0703393139 or 947..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={handleCheckNumber}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors"
                >
                  Check
                </button>
              </div>

              {checkResult && (
                <div
                  className={`p-3 rounded-lg border text-xs ${
                    checkResult.isBlocked
                      ? 'bg-rose-950/70 border-rose-800/90 text-rose-300'
                      : 'bg-emerald-950/70 border-emerald-800/90 text-emerald-300'
                  }`}
                >
                  {checkResult.isBlocked ? (
                    <div className="space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
                        <span>BLOCKED · In Stop List</span>
                      </div>
                      <p className="text-[11px] text-rose-400/90">
                        Reason: {checkResult.details?.reason || 'Opt-Out'}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        Added: {checkResult.details?.addedAt}
                      </p>
                    </div>
                  ) : (
                    <div className="font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>CLEAR · Safe to Message</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3 text-[11px] text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <Info className="w-3 h-3 text-emerald-400" />
              <span>Automated Protection Active</span>
            </div>
            <p>
              When a campaign is executed, all numbers matching this list are bypassed in 0ms with zero WhatsApp message sent.
            </p>
          </div>
        </div>
      </div>

      {/* Stop Numbers List Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden space-y-0">
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">
              Blocked Numbers Registry ({filteredList.length})
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search blocked phone or reason..."
                className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 w-64 focus:outline-none focus:border-rose-500"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 font-mono text-[11px] border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">#</th>
                <th className="py-2.5 px-4">Phone Number</th>
                <th className="py-2.5 px-4">WhatsApp ID (Normalized)</th>
                <th className="py-2.5 px-4">Category / Reason</th>
                <th className="py-2.5 px-4">Date Added</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 text-xs">
                    {searchQuery ? 'No numbers matching your search query.' : 'No stop numbers registered yet. Add phone numbers above to protect them.'}
                  </td>
                </tr>
              ) : (
                filteredList.map((item, index) => (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                      {index + 1}
                    </td>

                    <td className="py-2.5 px-4 font-mono font-bold text-white whitespace-nowrap">
                      {item.phoneNumber}
                    </td>

                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {item.normalizedPhone}@s.whatsapp.net
                    </td>

                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded border bg-rose-950/70 text-rose-300 border-rose-800">
                        <AlertOctagon className="w-3 h-3 text-rose-400" />
                        <span>{item.reason || 'Opt-Out'}</span>
                      </span>
                    </td>

                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {item.addedAt || 'Recently'}
                    </td>

                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleRemoveNumber(item.id, item.phoneNumber)}
                        className="px-2.5 py-1 text-[11px] text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors"
                        title="Unblock number"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline mr-1" />
                        <span>Unblock</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
