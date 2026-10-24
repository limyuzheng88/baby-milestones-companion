// Seeds the milestone library into D1 from the private, gitignored data file.
// Usage: tsx scripts/seed-milestones.ts [--check] [--remote] [--file data/milestones.private.json]
// --check only validates (npm run validate:library). Without --remote it seeds the local dev database.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLibrary, toSeedSql } from '../src/milestones/library';

const args = process.argv.slice(2);
const fileFlag = args.indexOf('--file');
const file = fileFlag >= 0 ? args[fileFlag + 1] : 'data/milestones.private.json';
if (!file) throw new Error('--file needs a path');

const lib = parseLibrary(JSON.parse(readFileSync(file, 'utf8')));
console.log(`library ${lib.version}: ${lib.milestones.length} items valid`);
if (args.includes('--check')) process.exit(0);

// The SQL holds the library text, so it lives in the gitignored .wrangler folder and is removed after.
mkdirSync('.wrangler', { recursive: true });
const sqlFile = join('.wrangler', 'seed-milestones.sql');
writeFileSync(sqlFile, toSeedSql(lib), { mode: 0o600 });
try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'baby-milestones', args.includes('--remote') ? '--remote' : '--local', '--file', sqlFile], {
    stdio: 'inherit',
  });
} finally {
  rmSync(sqlFile, { force: true });
}
