import {
  WhatsAppAccount,
  MessageTemplate,
  Contact,
  Campaign,
  DeliveryLog,
  WarmupDialogue,
  AutoResponderRule
} from '../types';

export const INITIAL_ACCOUNTS: WhatsAppAccount[] = [];

export const INITIAL_TEMPLATES: MessageTemplate[] = [
  {
    id: 'tpl_01',
    title: 'Personalized Intro (Friendly)',
    content: '{Hello|Hi|Greetings} {{name}}! {Hope your week is off to a great start|Hope you are doing well}. We noticed your work at {{company}} and wanted to share our latest research digest for local projects.',
    mediaType: 'document',
    fileName: 'Project_Summary_2026.pdf'
  },
  {
    id: 'tpl_02',
    title: 'Direct Academic Follow-up',
    content: '{Dear|Hi} {{name}}, following up on our university research inquiry. Could we confirm if {{company}} is open for a brief 10-minute briefing this Thursday?',
  },
  {
    id: 'tpl_03',
    title: 'Value Proposition Brief',
    content: 'Good day {{name}}! {Quick update from our team|Reaching out with a quick note}: We just released the automated WhatsApp workflow documentation for {{company}}. Let me know if you would like the link.',
    mediaType: 'image',
    fileName: 'System_Infographic.png'
  }
];

export const INITIAL_CONTACTS: Contact[] = [
  { id: 'c_01', phoneNumber: '+1 (555) 019-2831', name: 'Sophia Martinez', company: 'Nova Labs', customVar1: 'Robotics', status: 'pending' },
  { id: 'c_02', phoneNumber: '+1 (555) 018-4729', name: 'David Chen', company: 'Aether Dynamics', customVar1: 'Embedded Systems', status: 'pending' },
  { id: 'c_03', phoneNumber: '+1 (555) 017-3810', name: 'Elena Rostova', company: 'BioGrid Tech', customVar1: 'Biotech', status: 'pending' },
  { id: 'c_04', phoneNumber: '+1 (555) 016-9283', name: 'Marcus Johnson', company: 'Apex Cloud', customVar1: 'Infrastructure', status: 'pending' },
  { id: 'c_05', phoneNumber: '+1 (555) 015-8472', name: 'Amina Al-Mansoor', company: 'Vertex Systems', customVar1: 'AI Research', status: 'pending' },
  { id: 'c_06', phoneNumber: '+1 (555) 014-7381', name: 'Liam O’Connor', company: 'Horizon Mobility', customVar1: 'EV Automation', status: 'pending' },
  { id: 'c_07', phoneNumber: '+1 (555) 013-6290', name: 'Chloe Dubois', company: 'Starlight Medical', customVar1: 'MedTech', status: 'pending' },
  { id: 'c_08', phoneNumber: '+1 (555) 012-5109', name: 'Mateo Hernandez', company: 'Kite Energy', customVar1: 'CleanTech', status: 'pending' },
  { id: 'c_09', phoneNumber: '+1 (555) 011-4098', name: 'Yuki Tanaka', company: 'Sora Telecom', customVar1: '5G Core', status: 'pending' },
  { id: 'c_10', phoneNumber: '+1 (555) 010-3987', name: 'Zane Washington', company: 'Echo Secure', customVar1: 'Cybersecurity', status: 'pending' },
  { id: 'c_11', phoneNumber: '+1 (555) 009-2876', name: 'Fatima Zahra', company: 'Helix Informatics', customVar1: 'Data Science', status: 'pending' },
  { id: 'c_12', phoneNumber: '+1 (555) 008-1765', name: 'Alexander Wright', company: 'Omni Robotics', customVar1: 'Hardware', status: 'pending' }
];

export const INITIAL_CAMPAIGNS: Campaign[] = [
  {
    id: 'cmp_sample_01',
    name: 'University Outreach & Partnership Q4',
    createdAt: '2026-10-15 14:00',
    status: 'draft',
    senderAccountIds: ['acc_01', 'acc_02'],
    rotationStrategy: 'round-robin',
    templates: [INITIAL_TEMPLATES[0], INITIAL_TEMPLATES[1]],
    contacts: INITIAL_CONTACTS,
    timings: {
      minDelaySeconds: 10,
      maxDelaySeconds: 30,
      batchSize: 5,
      breakDurationSeconds: 60,
      typingDelaySeconds: 3
    },
    stats: {
      total: 12,
      sent: 0,
      delivered: 0,
      failed: 0,
      noWhatsAppCount: 0,
      currentSenderIndex: 0,
      currentBatchCount: 0
    }
  }
];

export const INITIAL_LOGS: DeliveryLog[] = [
  {
    id: 'log_01',
    campaignId: 'cmp_sample_01',
    campaignName: 'Previous Test Blast',
    timestamp: '2026-10-15 16:42:10',
    recipientPhone: '+1 (555) 349-1102',
    recipientName: 'Robert Vance',
    senderPhone: '+1 (555) 234-8901',
    senderName: 'Primary Marketing Node',
    templateId: 'tpl_01',
    resolvedMessage: 'Hi Robert! Hope you are doing well. We noticed your work at Vance Refrigeration and wanted to share our research digest.',
    delayAppliedSeconds: 18,
    hasWhatsApp: true,
    status: 'READ'
  },
  {
    id: 'log_02',
    campaignId: 'cmp_sample_01',
    campaignName: 'Previous Test Blast',
    timestamp: '2026-10-15 16:42:34',
    recipientPhone: '+1 (555) 980-4412',
    recipientName: 'Karen Filippelli',
    senderPhone: '+1 (555) 478-9120',
    senderName: 'Outreach Node Beta',
    templateId: 'tpl_02',
    resolvedMessage: 'Dear Karen, following up on our university research inquiry. Could we confirm if Utica Tech is open for a brief briefing?',
    delayAppliedSeconds: 24,
    hasWhatsApp: true,
    status: 'DELIVERED'
  }
];

export const INITIAL_WARMUP_DIALOGUES: WarmupDialogue[] = [
  {
    id: 'wup_01',
    timestamp: '10:04:15',
    fromAccountId: 'acc_01',
    fromPhone: '+1 (555) 234-8901',
    toAccountId: 'acc_02',
    toPhone: '+1 (555) 478-9120',
    message: 'Hey Alex, did you push the recent database migrations to the local repo?',
    status: 'READ'
  },
  {
    id: 'wup_02',
    timestamp: '10:06:40',
    fromAccountId: 'acc_02',
    fromPhone: '+1 (555) 478-9120',
    toAccountId: 'acc_01',
    toPhone: '+1 (555) 234-8901',
    message: 'Yes! Just verified the SQLite table schemas. Everything is clean on my branch.',
    status: 'READ'
  },
  {
    id: 'wup_03',
    timestamp: '10:11:05',
    fromAccountId: 'acc_01',
    fromPhone: '+1 (555) 234-8901',
    toAccountId: 'acc_04',
    toPhone: '+1 (555) 891-2049',
    message: 'Awesome. Remember to run the unit test suite before starting the queue.',
    status: 'DELIVERED'
  }
];

export const INITIAL_AUTO_RESPONDERS: AutoResponderRule[] = [
  {
    id: 'rule_01',
    name: 'Info & Catalog Request',
    matchType: 'contains',
    keyword: 'catalog',
    replyMessage: 'Thanks for reaching out! You can view our full university project documentation and catalog here: https://github.com/localhost/project-docs',
    isEnabled: true,
    typingDelaySeconds: 3
  },
  {
    id: 'rule_02',
    name: 'Pricing Inquiry',
    matchType: 'exact',
    keyword: 'pricing',
    replyMessage: 'Hello! Our university project tool is 100% open-source for academic use. No subscription required for localhost deployment.',
    isEnabled: true,
    typingDelaySeconds: 4
  },
  {
    id: 'rule_03',
    name: 'Unsubscribe / Stop Command',
    matchType: 'exact',
    keyword: 'stop',
    replyMessage: 'You have been opted out from all automated notifications. Have a wonderful day!',
    isEnabled: true,
    typingDelaySeconds: 2
  }
];
