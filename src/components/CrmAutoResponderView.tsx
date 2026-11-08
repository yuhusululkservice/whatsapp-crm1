import React, { useState } from 'react';
import {
  MessageSquareCode,
  Users,
  Plus,
  Trash2,
  Send,
  Sparkles,
  Bot,
  User,
  Clock,
  Search,
  CheckCircle,
  FileSpreadsheet
} from 'lucide-react';
import { AutoResponderRule, Contact } from '../types';

interface Props {
  contacts: Contact[];
  autoResponders: AutoResponderRule[];
  onAddRule: (rule: AutoResponderRule) => void;
  onToggleRule: (id: string) => void;
  onDeleteRule: (id: string) => void;
  onAddContact: (contact: Contact) => void;
}

export const CrmAutoResponderView: React.FC<Props> = ({
  contacts,
  autoResponders,
  onAddRule,
  onToggleRule,
  onDeleteRule,
  onAddContact
}) => {
  const [activeTab, setActiveTab] = useState<'rules' | 'contacts'>('rules');

  // New Rule State
  const [ruleName, setRuleName] = useState('');
  const [matchType, setMatchType] = useState<'contains' | 'exact' | 'regex'>('contains');
  const [keyword, setKeyword] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [typingDelay, setTypingDelay] = useState(3);
  const [isAddRuleOpen, setIsAddRuleOpen] = useState(false);

  // New Contact State
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactCompany, setContactCompany] = useState('');
  const [contactSearch, setContactSearch] = useState('');

  // Interactive Incoming Message Simulator State
  const [simulatedIncomingText, setSimulatedIncomingText] = useState('Hey, can you send the catalog?');
  const [chatLog, setChatLog] = useState<{ sender: 'user' | 'bot'; text: string; time: string }[]>([
    { sender: 'user', text: 'Hi! Are you open for research collaboration?', time: '11:15' },
    { sender: 'bot', text: 'Thanks for reaching out! You can view our full university project documentation and catalog here: https://github.com/localhost/project-docs', time: '11:15' }
  ]);
  const [isBotTyping, setIsBotTyping] = useState(false);

  const handleTestIncomingMessage = () => {
    if (!simulatedIncomingText.trim()) return;

    const userMsg = simulatedIncomingText;
    setChatLog(prev => [...prev, { sender: 'user', text: userMsg, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    setSimulatedIncomingText('');

    // Evaluate matching rules
    const lowerInput = userMsg.toLowerCase();
    const matched = autoResponders.find(rule => {
      if (!rule.isEnabled) return false;
      const kw = rule.keyword.toLowerCase();
      if (rule.matchType === 'exact') return lowerInput === kw;
      if (rule.matchType === 'contains') return lowerInput.includes(kw);
      if (rule.matchType === 'regex') {
        try {
          return new RegExp(rule.keyword, 'i').test(userMsg);
        } catch {
          return false;
        }
      }
      return false;
    });

    if (matched) {
      setIsBotTyping(true);
      setTimeout(() => {
        setIsBotTyping(false);
        setChatLog(prev => [
          ...prev,
          {
            sender: 'bot',
            text: matched.replyMessage,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }, (matched.typingDelaySeconds || 2) * 1000);
    } else {
      setIsBotTyping(true);
      setTimeout(() => {
        setIsBotTyping(false);
        setChatLog(prev => [
          ...prev,
          {
            sender: 'bot',
            text: 'Hello! Thanks for your message. An operator will follow up shortly during local operating hours.',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]);
      }, 1500);
    }
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName || !keyword || !replyMessage) return;

    const newRule: AutoResponderRule = {
      id: `rule_${Date.now()}`,
      name: ruleName,
      matchType,
      keyword,
      replyMessage,
      isEnabled: true,
      typingDelaySeconds: typingDelay
    };

    onAddRule(newRule);
    setRuleName('');
    setKeyword('');
    setReplyMessage('');
    setIsAddRuleOpen(false);
  };

  const handleCreateContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactPhone) return;

    onAddContact({
      id: `c_${Date.now()}`,
      phoneNumber: contactPhone,
      name: contactName || 'New Contact',
      company: contactCompany,
      status: 'pending'
    });

    setContactName('');
    setContactPhone('');
    setContactCompany('');
  };

  const filteredContacts = contacts.filter(c => {
    if (!contactSearch) return true;
    const q = contactSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.phoneNumber.toLowerCase().includes(q) ||
      c.company?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Title & View Switch */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            CRM Contacts & Auto-Responder
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Maintain local customer records and automate instant WhatsApp replies with typing state simulation.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'rules'
                ? 'bg-emerald-500 text-slate-950 font-semibold shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Auto-Responder Rules ({autoResponders.length})
          </button>
          <button
            onClick={() => setActiveTab('contacts')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'contacts'
                ? 'bg-emerald-500 text-slate-950 font-semibold shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Contacts CRM ({contacts.length})
          </button>
        </div>
      </div>

      {activeTab === 'rules' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Rules List (Left 2-Columns) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <MessageSquareCode className="w-4 h-4 text-emerald-400" />
                <span>Active Auto-Response Triggers</span>
              </h3>
              <button
                onClick={() => setIsAddRuleOpen(!isAddRuleOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add New Rule</span>
              </button>
            </div>

            {/* Add Rule Form */}
            {isAddRuleOpen && (
              <form onSubmit={handleCreateRule} className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Configure New Rule</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Rule Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Discount Code Request"
                      value={ruleName}
                      onChange={(e) => setRuleName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Match Type</label>
                    <select
                      value={matchType}
                      onChange={(e: any) => setMatchType(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value="contains">Contains Keyword</option>
                      <option value="exact">Exact Match</option>
                      <option value="regex">Regular Expression</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">Keyword / Trigger</label>
                    <input
                      type="text"
                      placeholder="e.g. discount, promo"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white font-mono"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Automatic Reply Message</label>
                  <textarea
                    rows={2}
                    placeholder="Enter automated reply..."
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white font-mono"
                    required
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Typing Delay:</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={typingDelay}
                      onChange={(e) => setTypingDelay(Number(e.target.value))}
                      className="w-14 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-xs font-mono text-center text-white"
                    />
                    <span>seconds</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsAddRuleOpen(false)}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-lg"
                    >
                      Save Rule
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Rules Cards */}
            <div className="space-y-3">
              {autoResponders.map((rule) => (
                <div
                  key={rule.id}
                  className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2 hover:border-slate-700 transition-all"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                        <Bot className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">{rule.name}</h4>
                        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                          <span>Match: {rule.matchType}</span>
                          <span>·</span>
                          <span className="text-emerald-400 font-bold">"{rule.keyword}"</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => onToggleRule(rule.id)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          rule.isEnabled ? 'bg-emerald-500' : 'bg-slate-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition duration-200 ease-in-out ${
                            rule.isEnabled ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>

                      <button
                        onClick={() => onDeleteRule(rule.id)}
                        className="text-slate-500 hover:text-rose-400 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs font-mono text-slate-300 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    {rule.replyMessage}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1">
                    <span>Typing delay simulation: {rule.typingDelaySeconds}s</span>
                    <span className={rule.isEnabled ? 'text-emerald-400' : 'text-slate-500'}>
                      {rule.isEnabled ? 'LISTENING' : 'DISABLED'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Interactive Live Message Simulator (Right Column) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white">
                    Auto-Responder Live Simulator
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded">
                  TEST BOT
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Simulate an incoming WhatsApp customer message to test your keyword matching and typing pauses.
              </p>

              {/* Chat Window */}
              <div className="mt-4 bg-slate-950 border border-slate-800 rounded-xl p-3 min-h-[300px] max-h-[340px] overflow-y-auto space-y-3">
                {chatLog.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`p-2.5 rounded-xl max-w-[85%] text-xs leading-relaxed ${
                        msg.sender === 'user'
                          ? 'bg-emerald-600 text-white rounded-tr-xs'
                          : 'bg-slate-800 text-slate-100 rounded-tl-xs border border-slate-700/60'
                      }`}
                    >
                      <p>{msg.text}</p>
                      <span className="block text-[9px] text-slate-400 text-right mt-1 font-mono">
                        {msg.time}
                      </span>
                    </div>
                  </div>
                ))}

                {isBotTyping && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono py-1 px-2 bg-slate-900 rounded-lg inline-block">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    <span>WhatsApp node typing...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Input Bar */}
            <div className="pt-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Type sample message (e.g. pricing, catalog)..."
                  value={simulatedIncomingText}
                  onChange={(e) => setSimulatedIncomingText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTestIncomingMessage()}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={handleTestIncomingMessage}
                  className="p-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Contacts CRM View */
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span>Contact Database ({filteredContacts.length} Records)</span>
              </h3>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search name, phone, company..."
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 w-64 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            {/* Add Contact Strip */}
            <form onSubmit={handleCreateContact} className="p-3 bg-slate-950 border border-slate-800 rounded-lg grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
              <input
                type="text"
                placeholder="Phone (+1...)"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-white"
                required
              />
              <input
                type="text"
                placeholder="Contact Name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white"
              />
              <input
                type="text"
                placeholder="Company"
                value={contactCompany}
                onChange={(e) => setContactCompany(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-xs text-white"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold rounded transition-colors"
              >
                Add Record
              </button>
            </form>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">Contact</th>
                    <th className="py-2.5 px-4">Phone Number</th>
                    <th className="py-2.5 px-4">Company</th>
                    <th className="py-2.5 px-4">Tag / Segment</th>
                    <th className="py-2.5 px-4">Queue Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredContacts.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-semibold text-white">{c.name}</td>
                      <td className="py-2.5 px-4 font-mono text-emerald-400">{c.phoneNumber}</td>
                      <td className="py-2.5 px-4 text-slate-300">{c.company || '—'}</td>
                      <td className="py-2.5 px-4 text-slate-400 font-mono">{c.customVar1 || 'General'}</td>
                      <td className="py-2.5 px-4">
                        <span className="font-mono text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                          {c.status || 'READY'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
