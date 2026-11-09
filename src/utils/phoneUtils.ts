import { Contact } from '../types';

/**
 * Normalizes phone numbers (Sri Lanka local 07..., 94..., +94..., and international numbers)
 */
export function normalizePhoneNumber(phone: string, defaultCountryCode = '94'): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.substring(2);
  }
  // Sri Lanka 10-digit format (070..., 077..., 071..., 011...) -> replace leading 0 with 94
  if (digits.startsWith('0') && digits.length === 10) {
    digits = `${defaultCountryCode}${digits.substring(1)}`;
  } else if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) {
    digits = `${defaultCountryCode}${digits}`;
  }
  return digits;
}

/**
 * Formats a phone number nicely for display (e.g. 070 339 3139 or +94 70 339 3139)
 */
export function formatPhoneDisplay(phone: string): string {
  const norm = normalizePhoneNumber(phone);
  if (!norm) return phone;
  if (norm.startsWith('94') && norm.length === 11) {
    return `+94 ${norm.substring(2, 4)} ${norm.substring(4, 7)} ${norm.substring(7)}`;
  }
  return phone;
}

/**
 * Checks if a string looks like a phone number (at least 7 digits, mainly numbers and allowed separators)
 */
export function isLikelyPhoneNumber(str: string): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  const digits = trimmed.replace(/\D/g, '');
  // Must have 7 to 15 digits, and at least 60% of characters should be digits/plus
  if (digits.length < 7 || digits.length > 15) return false;
  const nonDigitRatio = (trimmed.length - digits.length) / trimmed.length;
  return nonDigitRatio < 0.45;
}

/**
 * Bulletproof matcher for Stop Numbers across country codes, local 07..., 94..., +94..., spaces, and formats.
 */
export function isNumberInStopList(
  phone: string,
  stopList: Array<{ phoneNumber?: string; normalizedPhone?: string; reason?: string } | string> | Set<string>
): { isStopped: boolean; reason?: string } {
  if (!phone) return { isStopped: false };
  const rawTarget = phone.replace(/\D/g, '');
  if (!rawTarget) return { isStopped: false };

  // Core subscriber digits (last 9 digits for Sri Lanka e.g. 703393139)
  const targetCore = rawTarget.length >= 9 ? rawTarget.slice(-9) : rawTarget;
  const targetNorm = normalizePhoneNumber(phone);

  const items = stopList instanceof Set ? Array.from(stopList) : stopList;

  for (const item of items) {
    const rawItem = typeof item === 'string' ? item : (item.phoneNumber || item.normalizedPhone || '');
    const cleanItem = rawItem.replace(/\D/g, '');
    if (!cleanItem) continue;

    const itemCore = cleanItem.length >= 9 ? cleanItem.slice(-9) : cleanItem;
    const itemNorm = typeof item === 'object' && item.normalizedPhone ? item.normalizedPhone : normalizePhoneNumber(rawItem);

    if (
      (targetCore && itemCore && targetCore === itemCore) ||
      (targetNorm && itemNorm && targetNorm === itemNorm) ||
      rawTarget === cleanItem ||
      phone.trim() === rawItem.trim()
    ) {
      const reason = (typeof item === 'object' && (item as any).reason) || 'Opt-Out (Stop List)';
      return { isStopped: true, reason };
    }
  }

  return { isStopped: false };
}

export interface ParseResult {
  contacts: Contact[];
  rawCount: number;
  duplicateCount: number;
  stopCount: number;
  duplicatesRemoved: string[];
  stopNumbersFound: string[];
}

/**
 * Parses recipients seamlessly whether separated by:
 * - Newlines (vertically)
 * - Commas (on single line or multiple lines)
 * - Semicolons
 * - Mixed CSV with Name, Company
 * - Handles duplicate detection & stop number filtering
 */
export function parseRecipientsSeamless(
  text: string,
  options?: {
    skipDuplicates?: boolean;
    stopNumbersSet?: Set<string> | Array<{ phoneNumber?: string; normalizedPhone?: string; reason?: string } | string>;
  }
): ParseResult {
  const skipDuplicates = options?.skipDuplicates ?? true;
  const stopNumbersSet = options?.stopNumbersSet || [];

  if (!text || !text.trim()) {
    return {
      contacts: [],
      rawCount: 0,
      duplicateCount: 0,
      stopCount: 0,
      duplicatesRemoved: [],
      stopNumbersFound: []
    };
  }

  const rawEntries: { phone: string; name: string; company: string; customVar1: string }[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    // Check if line contains commas
    if (line.includes(',')) {
      const parts = line.split(',').map(p => p.trim()).filter(p => p.length > 0);
      
      // Determine if this is a list of comma-separated phone numbers:
      // e.g. "0703393139, 0771234567, 0719998888"
      const phoneParts = parts.filter(p => isLikelyPhoneNumber(p));

      if (phoneParts.length > 1 && phoneParts.length >= parts.length * 0.6) {
        // This is a comma-separated list of multiple phone numbers!
        for (const phone of phoneParts) {
          rawEntries.push({
            phone,
            name: '',
            company: '',
            customVar1: ''
          });
        }
      } else {
        // This is a single contact with CSV fields: Phone, Name, Company, Note
        rawEntries.push({
          phone: parts[0] || '',
          name: parts[1] || '',
          company: parts[2] || '',
          customVar1: parts[3] || ''
        });
      }
    } else if (line.includes(';') && line.split(';').filter(p => isLikelyPhoneNumber(p.trim())).length > 1) {
      // Semicolon-separated phone numbers
      const parts = line.split(';').map(p => p.trim()).filter(p => isLikelyPhoneNumber(p));
      for (const phone of parts) {
        rawEntries.push({
          phone,
          name: '',
          company: '',
          customVar1: ''
        });
      }
    } else {
      // Single line with no commas - could be just a phone number or space separated
      const spaceParts = line.split(/\s+/).filter(p => p.length > 0);
      if (spaceParts.length === 1) {
        // Just a phone number
        rawEntries.push({
          phone: spaceParts[0],
          name: '',
          company: '',
          customVar1: ''
        });
      } else if (isLikelyPhoneNumber(spaceParts[0])) {
        // First word is phone, rest might be name
        rawEntries.push({
          phone: spaceParts[0],
          name: spaceParts.slice(1).join(' '),
          company: '',
          customVar1: ''
        });
      } else {
        // Fallback
        rawEntries.push({
          phone: line,
          name: '',
          company: '',
          customVar1: ''
        });
      }
    }
  }

  const rawCount = rawEntries.length;
  const seenPhones = new Set<string>();
  const duplicatesRemoved: string[] = [];
  const stopNumbersFound: string[] = [];
  const contacts: Contact[] = [];

  rawEntries.forEach((entry, idx) => {
    const rawPhone = entry.phone.trim();
    if (!rawPhone) return;

    const norm = normalizePhoneNumber(rawPhone);

    // Check if in Stop Numbers list via bulletproof core matcher
    const stopCheck = isNumberInStopList(rawPhone, stopNumbersSet);
    if (stopCheck.isStopped) {
      stopNumbersFound.push(rawPhone);
      // Add contact with status 'stopped' so the UI and results clearly show it was stopped!
      contacts.push({
        id: `c_${Date.now()}_${idx}`,
        phoneNumber: rawPhone,
        name: entry.name || `Contact ${idx + 1}`,
        company: entry.company,
        customVar1: entry.customVar1,
        status: 'stopped'
      });
      return;
    }

    // Check for duplicates
    if (skipDuplicates) {
      if (seenPhones.has(norm)) {
        duplicatesRemoved.push(rawPhone);
        return; // Skip duplicate completely
      }
      seenPhones.add(norm);
    }

    contacts.push({
      id: `c_${Date.now()}_${idx}`,
      phoneNumber: rawPhone,
      name: entry.name || `Contact ${contacts.length + 1}`,
      company: entry.company,
      customVar1: entry.customVar1,
      status: 'pending'
    });
  });

  return {
    contacts,
    rawCount,
    duplicateCount: duplicatesRemoved.length,
    stopCount: stopNumbersFound.length,
    duplicatesRemoved,
    stopNumbersFound
  };
}
