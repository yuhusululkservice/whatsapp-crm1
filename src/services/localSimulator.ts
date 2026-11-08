import {
  Campaign,
  WhatsAppAccount,
  DeliveryLog,
  Contact
} from '../types';
import { resolveSpintax, replaceVariables, getRandomInt } from '../utils/spintax';
import { normalizePhoneNumber, isNumberInStopList } from '../utils/phoneUtils';

export class RealCampaignRunner {
  private activeCampaignId: string | null = null;
  private isPaused: boolean = false;
  private isStopped: boolean = false;
  private timerRef: any = null;

  async startCampaignRunner(
    campaign: Campaign,
    accounts: WhatsAppAccount[],
    onProgress: (updatedCampaign: Campaign, newLog: DeliveryLog) => void,
    onComplete: (campaignId: string) => void
  ) {
    this.activeCampaignId = campaign.id;
    this.isPaused = false;
    this.isStopped = false;

    // 1. Identify Connected Senders
    let connectedSenders = accounts.filter(
      a => campaign.senderAccountIds?.includes(a.id) && a.status === 'CONNECTED'
    );

    // Fallback: if selected sender IDs don't match, check any connected account in list
    if (connectedSenders.length === 0) {
      connectedSenders = accounts.filter(a => a.status === 'CONNECTED');
    }

    // Secondary fallback: fetch directly from server in case UI state hasn't refreshed
    if (connectedSenders.length === 0) {
      try {
        const res = await fetch('/api/accounts');
        if (res.ok) {
          const serverAccs: WhatsAppAccount[] = await res.json();
          connectedSenders = serverAccs.filter(a => a.status === 'CONNECTED');
        }
      } catch (e) {}
    }

    if (connectedSenders.length === 0) {
      alert('Error: No connected WhatsApp account available!\n\nPlease go to "Accounts" tab, click "Link New WhatsApp Account", and scan the QR code with your phone WhatsApp.');
      return;
    }

    // Fetch live Stop Numbers list to guarantee real-time opt-out enforcement
    let liveStopNumbers: any[] = [];
    try {
      const stopRes = await fetch('/api/stop-numbers');
      if (stopRes.ok) {
        const stopData = await stopRes.json();
        if (Array.isArray(stopData.stopNumbers)) {
          liveStopNumbers = stopData.stopNumbers;
        }
      }
    } catch (e) {}

    let currentIndex = campaign.stats?.sent || 0;
    let senderPointer = campaign.stats?.currentSenderIndex || 0;
    let batchCounter = campaign.stats?.currentBatchCount || 0;
    let deliveredCount = campaign.stats?.delivered || 0;
    let noWhatsAppCount = campaign.stats?.noWhatsAppCount || 0;
    let failedCount = campaign.stats?.failed || 0;
    let stoppedCount = campaign.stats?.stoppedCount || 0;
    let duplicateCount = campaign.stats?.duplicateCount || 0;

    // Set of normalized phone numbers already processed in this campaign session
    const processedPhoneNumbers = new Set<string>();

    const executeNext = async () => {
      if (this.isStopped) return;
      if (this.isPaused) {
        this.timerRef = setTimeout(executeNext, 1000);
        return;
      }

      if (currentIndex >= campaign.contacts.length) {
        onComplete(campaign.id);
        this.activeCampaignId = null;
        return;
      }

      const contact = campaign.contacts[currentIndex];
      const normPhone = normalizePhoneNumber(contact.phoneNumber);
      const now = new Date();
      const timeStr = `${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]}`;

      // Pick template early for log preview
      const selectedTemplate = campaign.templates[
        Math.floor(Math.random() * campaign.templates.length)
      ];
      const spintaxResolved = resolveSpintax(selectedTemplate.content);
      const fullyResolved = replaceVariables(spintaxResolved, {
        name: contact.name,
        company: contact.company || 'your team',
        phone: contact.phoneNumber,
        custom1: contact.customVar1,
        custom2: contact.customVar2
      });

      // 0a. Check if contact is in Stop Numbers list or pre-flagged as STOPPED
      const stopCheck = isNumberInStopList(contact.phoneNumber, liveStopNumbers);
      if (stopCheck.isStopped || contact.status === 'stopped') {
        stoppedCount++;
        const currentLog: DeliveryLog = {
          id: `log_${Date.now()}_${currentIndex}`,
          campaignId: campaign.id,
          campaignName: campaign.name,
          timestamp: timeStr,
          recipientPhone: contact.phoneNumber,
          recipientName: contact.name,
          senderPhone: 'BLOCKED',
          senderName: 'Stop List (Opt-Out Protection)',
          templateId: 'BLOCKED',
          resolvedMessage: `[BLOCKED - NO MESSAGE SENT] Recipient is in Stop Numbers list (${stopCheck.reason || 'Opt-Out'})`,
          delayAppliedSeconds: 0,
          hasWhatsApp: true,
          status: 'STOPPED',
          postAttachment: '',
          errorMessage: `Skipped: Number is in Stop Numbers list (${stopCheck.reason || 'Opt-Out'})`
        };
        currentIndex++;
        const updatedCampaign: Campaign = {
          ...campaign,
          stats: {
            ...campaign.stats,
            sent: deliveredCount, // Only count actually delivered messages as sent!
            delivered: deliveredCount,
            noWhatsAppCount: noWhatsAppCount,
            failed: failedCount,
            stoppedCount: stoppedCount,
            duplicateCount: duplicateCount,
            currentSenderIndex: senderPointer,
            currentBatchCount: batchCounter
          }
        };
        onProgress(updatedCampaign, currentLog);
        this.timerRef = setTimeout(executeNext, 150);
        return;
      }

      // 0b. Duplicate number check within campaign
      if (campaign.skipDuplicates && processedPhoneNumbers.has(normPhone)) {
        duplicateCount++;
        const currentLog: DeliveryLog = {
          id: `log_${Date.now()}_${currentIndex}`,
          campaignId: campaign.id,
          campaignName: campaign.name,
          timestamp: timeStr,
          recipientPhone: contact.phoneNumber,
          recipientName: contact.name,
          senderPhone: 'SKIPPED',
          senderName: 'Duplicate Guard',
          templateId: 'DUPLICATE',
          resolvedMessage: '[SKIPPED - DUPLICATE] Number already processed in this campaign session',
          delayAppliedSeconds: 0,
          hasWhatsApp: true,
          status: 'SKIPPED_DUPLICATE',
          postAttachment: '',
          errorMessage: 'Skipped: Duplicate number within campaign'
        };
        currentIndex++;
        const updatedCampaign: Campaign = {
          ...campaign,
          stats: {
            ...campaign.stats,
            sent: deliveredCount,
            delivered: deliveredCount,
            noWhatsAppCount: noWhatsAppCount,
            failed: failedCount,
            stoppedCount: stoppedCount,
            duplicateCount: duplicateCount,
            currentSenderIndex: senderPointer,
            currentBatchCount: batchCounter
          }
        };
        onProgress(updatedCampaign, currentLog);
        this.timerRef = setTimeout(executeNext, 150);
        return;
      }

      if (normPhone) {
        processedPhoneNumbers.add(normPhone);
      }

      // 1. SENDER ROTATION: Round-robin across connected accounts
      const currentSender = connectedSenders[senderPointer % connectedSenders.length];
      senderPointer++;

      // 4. Calculate dynamic delay
      const appliedDelay = getRandomInt(
        campaign.timings.minDelaySeconds,
        campaign.timings.maxDelaySeconds
      );

      let currentLog: DeliveryLog;

      try {
        // Send REAL WhatsApp Message via backend Baileys WebSockets
        const response = await fetch('/api/messages/send-one', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId: campaign.id,
            campaignName: campaign.name,
            accountId: currentSender.id,
            contact,
            template: {
              ...selectedTemplate,
              content: fullyResolved
            },
            typingDelaySeconds: campaign.timings.typingDelaySeconds || 2
          })
        });

        const data = await response.json();

        if (response.ok && data.success) {
          deliveredCount++;
          currentLog = data.log || {
            id: `log_${Date.now()}_${currentIndex}`,
            campaignId: campaign.id,
            campaignName: campaign.name,
            timestamp: timeStr,
            recipientPhone: contact.phoneNumber,
            recipientName: contact.name,
            senderPhone: currentSender.phoneNumber,
            senderName: currentSender.name,
            templateId: selectedTemplate.id,
            resolvedMessage: fullyResolved,
            delayAppliedSeconds: appliedDelay,
            hasWhatsApp: true,
            status: 'DELIVERED',
            postAttachment: selectedTemplate.fileName || '',
            errorMessage: ''
          };
        } else if (data.status === 'STOPPED' || data.isStopped) {
          stoppedCount++;
          currentLog = data.log || {
            id: `log_${Date.now()}_${currentIndex}`,
            campaignId: campaign.id,
            campaignName: campaign.name,
            timestamp: timeStr,
            recipientPhone: contact.phoneNumber,
            recipientName: contact.name,
            senderPhone: 'N/A',
            senderName: 'Stop List (Opt-Out)',
            templateId: selectedTemplate.id,
            resolvedMessage: fullyResolved,
            delayAppliedSeconds: 0,
            hasWhatsApp: true,
            status: 'STOPPED',
            postAttachment: selectedTemplate.fileName || '',
            errorMessage: data.error || 'Skipped: Number is in Stop Numbers list'
          };
        } else if (data.status === 'NO_WHATSAPP') {
          noWhatsAppCount++;
          currentLog = data.log || {
            id: `log_${Date.now()}_${currentIndex}`,
            campaignId: campaign.id,
            campaignName: campaign.name,
            timestamp: timeStr,
            recipientPhone: contact.phoneNumber,
            recipientName: contact.name,
            senderPhone: currentSender.phoneNumber,
            senderName: currentSender.name,
            templateId: selectedTemplate.id,
            resolvedMessage: fullyResolved,
            delayAppliedSeconds: appliedDelay,
            hasWhatsApp: false,
            status: 'NO_WHATSAPP',
            postAttachment: selectedTemplate.fileName || '',
            errorMessage: 'Number does not have an active WhatsApp account'
          };
        } else {
          failedCount++;
          currentLog = data.log || {
            id: `log_${Date.now()}_${currentIndex}`,
            campaignId: campaign.id,
            campaignName: campaign.name,
            timestamp: timeStr,
            recipientPhone: contact.phoneNumber,
            recipientName: contact.name,
            senderPhone: currentSender.phoneNumber,
            senderName: currentSender.name,
            templateId: selectedTemplate.id,
            resolvedMessage: fullyResolved,
            delayAppliedSeconds: appliedDelay,
            hasWhatsApp: true,
            status: 'FAILED',
            postAttachment: selectedTemplate.fileName || '',
            errorMessage: data.error || 'WhatsApp send failure'
          };
        }
      } catch (networkErr: any) {
        console.error('Real dispatch network error:', networkErr);
        failedCount++;
        currentLog = {
          id: `log_${Date.now()}_${currentIndex}`,
          campaignId: campaign.id,
          campaignName: campaign.name,
          timestamp: timeStr,
          recipientPhone: contact.phoneNumber,
          recipientName: contact.name,
          senderPhone: currentSender.phoneNumber,
          senderName: currentSender.name,
          templateId: selectedTemplate.id,
          resolvedMessage: fullyResolved,
          delayAppliedSeconds: appliedDelay,
          hasWhatsApp: true,
          status: 'FAILED',
          postAttachment: selectedTemplate.fileName || '',
          errorMessage: networkErr.message || 'Network request failed'
        };
      }

      currentIndex++;
      batchCounter++;

      const updatedCampaign: Campaign = {
        ...campaign,
        stats: {
          ...campaign.stats,
          sent: currentIndex,
          delivered: deliveredCount,
          noWhatsAppCount: noWhatsAppCount,
          failed: failedCount,
          currentSenderIndex: senderPointer,
          currentBatchCount: batchCounter,
          lastSenderId: currentSender.id,
          lastTemplateId: selectedTemplate.id
        }
      };

      onProgress(updatedCampaign, currentLog);

      // 5. BATCH COOLDOWN OR DYNAMIC DELAY
      let nextWaitMs = appliedDelay * 1000;
      if (batchCounter >= campaign.timings.batchSize && currentIndex < campaign.contacts.length) {
        batchCounter = 0;
        nextWaitMs = campaign.timings.breakDurationSeconds * 1000;
      }

      this.timerRef = setTimeout(executeNext, nextWaitMs);
    };

    // Kick off first real message after 1.5s
    this.timerRef = setTimeout(executeNext, 1500);
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
  }

  stop() {
    this.isStopped = true;
    if (this.timerRef) clearTimeout(this.timerRef);
    this.activeCampaignId = null;
  }
}

export const simulator = new RealCampaignRunner();
