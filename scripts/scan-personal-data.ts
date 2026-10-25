// Fails if a tracked file looks like it holds personal data. Run in CI and before pushing.
// Optional: list family names, birthdays etc. one per line in scan-denylist.txt (gitignored).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { scanText } from './lib/scan';

const SKIP = new Set<string>();

const denylist = existsSync('scan-denylist.txt')
  ? readFileSync('scan-denylist.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter((f) => f && !SKIP.has(f));
let problems = 0;
for (const file of files) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (text.includes('\0')) continue; // binary
  for (const f of scanText(text, denylist)) {
    problems++;
    // Denylist hits are not echoed, so the CI log never shows the private word.
    console.error(`${file}: ${f.rule}${f.rule === 'denylist' ? '' : ` (${f.match})`}`);
  }
}
if (problems) {
  console.error(`\n${problems} possible personal-data finding(s). Remove them, or if a match is not personal data, rephrase it.`);
  process.exit(1);
}
console.log(`personal-data scan: ${files.length} files clean${denylist.length ? `, ${denylist.length} denylist entries checked` : ''}`);
