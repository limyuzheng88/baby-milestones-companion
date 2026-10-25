// Words the bot must never use about a child's development (spec: tone rules).
export const BANNED_WORDS = ['delayed', 'behind', 'missed', 'should', 'failed'] as const;

const patterns = BANNED_WORDS.map((w) => [w, new RegExp(`\\b${w}\\b`, 'i')] as const);

/** Banned words present in the text, in BANNED_WORDS order. */
export function findBannedWords(text: string): string[] {
  return patterns.filter(([, re]) => re.test(text)).map(([w]) => w);
}
