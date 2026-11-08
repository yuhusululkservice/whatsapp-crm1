import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Campaign, DeliveryLog } from '../types';

export function generateCampaignPdfReport(campaign: Campaign, logs: DeliveryLog[]) {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // 1. Clean Executive Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 55, 'F');

  doc.setFillColor(16, 185, 129); // emerald-500 accent line
  doc.rect(0, 53, pageWidth, 2.5, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('YUHUSULU CRM · Campaign Execution & Delivery Audit Report', 40, 34);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text(`Report Date: ${new Date().toLocaleString()}`, pageWidth - 40, 34, { align: 'right' });

  // 2. Campaign Title Strip (Clean & Executive - Technical debug strings removed per user instruction)
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(`Campaign: ${campaign.name}`, 40, 78);

  // 3. KPI Statistics Cards
  const total = campaign.contacts?.length || logs.length || 0;
  const delivered = logs.filter(l => l.status === 'DELIVERED' || l.status === 'READ').length;
  const noWhatsApp = logs.filter(l => l.status === 'NO_WHATSAPP' || l.hasWhatsApp === false).length;
  const stopped = logs.filter(l => l.status === 'STOPPED').length;
  const failed = logs.filter(l => l.status === 'FAILED').length;
  const deliveryRate = total > 0 ? Math.round((delivered / total) * 100) : 0;

  const cardY = 92;
  const cardHeight = 44;
  const cardWidth = (pageWidth - 80 - 48) / 5;

  const drawCard = (x: number, title: string, value: string, sub: string, bgColor: number[], textColor: number[]) => {
    doc.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
    doc.roundedRect(x, cardY, cardWidth, cardHeight, 4, 4, 'F');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(title, x + 8, cardY + 14);

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.text(value, x + 8, cardY + 32);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(sub, x + cardWidth - 8, cardY + 32, { align: 'right' });
  };

  drawCard(40, 'TOTAL RECIPIENTS', `${total}`, '100%', [241, 245, 249], [15, 23, 42]);
  drawCard(40 + cardWidth + 12, 'DELIVERED MESSAGES', `${delivered}`, `${deliveryRate}%`, [236, 253, 245], [5, 150, 105]);
  drawCard(40 + (cardWidth + 12) * 2, 'NOT ON WHATSAPP', `${noWhatsApp}`, `${total > 0 ? Math.round((noWhatsApp / total) * 100) : 0}%`, [254, 242, 242], [220, 38, 38]);
  drawCard(40 + (cardWidth + 12) * 3, 'STOPPED (OPT-OUT)', `${stopped}`, `${total > 0 ? Math.round((stopped / total) * 100) : 0}%`, [254, 243, 199], [180, 83, 9]);
  drawCard(40 + (cardWidth + 12) * 4, 'FAILED DISPATCHES', `${failed}`, `${total > 0 ? Math.round((failed / total) * 100) : 0}%`, [248, 250, 252], [71, 85, 105]);

  // 4. Detailed Audit Table
  const tableData = logs.map((log, index) => {
    let onWhatsAppText = (log.hasWhatsApp === false || log.status === 'NO_WHATSAPP')
      ? 'No (Not on WhatsApp)'
      : 'Yes (Active)';

    let displayStatus: string = log.status;
    if (log.status === 'NO_WHATSAPP') {
      displayStatus = 'NO WHATSAPP';
    } else if (log.status === 'STOPPED') {
      displayStatus = 'STOPPED (Stop List)';
      onWhatsAppText = 'Opt-Out List';
    } else if (log.status === 'SKIPPED_DUPLICATE') {
      displayStatus = 'SKIPPED (Duplicate)';
    }

    const postInfo = log.postAttachment ? ` [Media: ${log.postAttachment}]` : '';
    const cleanMsg = (log.resolvedMessage || '').replace(/\n/g, ' ').substring(0, 75) + (log.resolvedMessage?.length > 75 ? '...' : '') + postInfo;

    return [
      index + 1,
      log.recipientPhone,
      log.recipientName || 'Contact',
      onWhatsAppText,
      displayStatus,
      log.senderName || 'Sender Node',
      cleanMsg,
      log.timestamp ? log.timestamp.split(' ')[1] || log.timestamp : 'Just now'
    ];
  });

  autoTable(doc, {
    startY: 150,
    margin: { left: 40, right: 40, bottom: 40 },
    head: [['#', 'Recipient Phone', 'Name', 'WhatsApp Active?', 'Status', 'Sender Node', 'Message & Media Details', 'Time']],
    body: tableData,
    theme: 'grid',
    styles: {
      fontSize: 8,
      cellPadding: 4,
      textColor: [30, 41, 59],
      valign: 'middle'
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5
    },
    columnStyles: {
      0: { cellWidth: 24, halign: 'center' },
      1: { cellWidth: 85, fontStyle: 'bold' },
      2: { cellWidth: 75 },
      3: { cellWidth: 85, halign: 'center' },
      4: { cellWidth: 75, halign: 'center' },
      5: { cellWidth: 75 },
      6: { cellWidth: 'auto' },
      7: { cellWidth: 45, halign: 'center' }
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        // Highlight "Not on WhatsApp"
        if (data.column.index === 3 && data.cell.text[0]?.includes('No')) {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        }
        // Highlight Status
        if (data.column.index === 4) {
          const status = data.cell.text[0];
          if (status === 'DELIVERED' || status === 'READ') {
            data.cell.styles.textColor = [5, 150, 105]; // green
            data.cell.styles.fontStyle = 'bold';
          } else if (status === 'NO WHATSAPP' || status === 'NO_WHATSAPP') {
            data.cell.styles.textColor = [220, 38, 38]; // red
            data.cell.styles.fontStyle = 'bold';
          } else if (status.includes('STOPPED')) {
            data.cell.styles.textColor = [180, 83, 9]; // amber
            data.cell.styles.fontStyle = 'bold';
          } else if (status.includes('DUPLICATE')) {
            data.cell.styles.textColor = [100, 116, 139]; // slate
          }
        }
      }
    }
  });

  // Save the PDF
  const filename = `${campaign.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_Audit_Report.pdf`;
  doc.save(filename);
}
