// Patterns that suggest personal data was committed. Pure, so it can be unit-tested.

export type Finding = { rule: string; match: string };

const RULES: { rule: string; re: RegExp }[] = [
  { rule: 'NRIC/FIN', re: /(?<![A-Za-z0-9])[STFGM]\d{7}[A-Z](?![A-Za-z0-9])/g },
  { rule: 'SG phone', re: /(?<![\w.+/-])(?:\+65[\s-]?)?[689]\d{3}[\s-]?\d{4}(?![\w.-])/g },
  { rule: 'SG postal code', re: /(?:Singapore\s*|S\s*\(\s*)\d{6}(?!\d)/gi },
];

export function scanText(text: string, denylist: string[]): Finding[] {
  const out: Finding[] = [];
  for (const { rule, re } of RULES) for (const m of text.matchAll(re)) out.push({ rule, match: m[0].trim() });
  const lower = text.toLowerCase();
  for (const word of denylist) {
    const w = word.trim().toLowerCase();
    if (!w) continue;
    let i = lower.indexOf(w);
    while (i >= 0) {
      out.push({ rule: 'denylist', match: text.slice(i, i + w.length) });
      i = lower.indexOf(w, i + w.length);
    }
  }
  return out;
}
