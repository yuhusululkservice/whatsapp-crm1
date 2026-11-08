/**
 * Spintax Resolver: recursively parses {option1|option2|option3} syntax
 */
export function resolveSpintax(text: string): string {
  const spintaxRegex = /\{([^{}]+)\}/;
  let matches = spintaxRegex.exec(text);

  while (matches) {
    const choices = matches[1].split('|');
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    text = text.replace(matches[0], randomChoice);
    matches = spintaxRegex.exec(text);
  }

  return text;
}

/**
 * Replaces dynamic variables such as {{name}}, {{phone}}, {{company}}, {{custom_1}}
 */
export function replaceVariables(
  templateText: string,
  variables: Record<string, string | undefined>
): string {
  let result = templateText;
  for (const [key, val] of Object.entries(variables)) {
    if (val !== undefined) {
      const reg = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
      result = result.replace(reg, val);
    }
  }
  return result;
}

/**
 * Generates random number between min and max inclusive
 */
export function getRandomInt(min: number, max: number): number {
  const minVal = Math.ceil(min);
  const maxVal = Math.floor(max);
  return Math.floor(Math.random() * (maxVal - minVal + 1)) + minVal;
}

/**
 * Formats seconds into human readable duration (e.g., 2m 15s)
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}
