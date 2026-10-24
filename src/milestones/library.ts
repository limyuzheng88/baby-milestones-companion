import { findBannedWords } from '../tone/guard';

export type Domain = 'movement' | 'communication' | 'social' | 'thinking';
export type Source = 'HPB' | 'CDC' | 'WHO';

/**
 * Wording and tip use {pronoun} / {Pronoun} (subject), {object} and {possessive} placeholders;
 * the composer fills them. Wording is third-person singular ("{Pronoun} smiles").
 */
export type Milestone = {
  id: string;
  bandStartMonths: number;
  bandEndMonths: number;
  domain: Domain;
  wording: string;
  tip: string;
  source: Source;
  sourceUrl: string;
};

export type Library = { version: string; milestones: Milestone[] };

const DOMAINS: readonly string[] = ['movement', 'communication', 'social', 'thinking'];
const SOURCES: readonly string[] = ['HPB', 'CDC', 'WHO'];
const MAX_START_MONTHS = 72;
export const PLACEHOLDERS: readonly string[] = ['{pronoun}', '{Pronoun}', '{object}', '{possessive}'];

/** Validates a library file. Throws naming the first bad item. */
export function parseLibrary(json: unknown): Library {
  if (typeof json !== 'object' || json === null) throw new Error('library: not an object');
  const { version, milestones } = json as { version?: unknown; milestones?: unknown };
  if (typeof version !== 'string' || !version) throw new Error('library: missing version');
  if (!Array.isArray(milestones)) throw new Error('library: missing milestones array');

  const seen = new Set<string>();
  const out = milestones.map((raw: unknown, i): Milestone => {
    const m = (raw ?? {}) as Record<string, unknown>;
    const id = typeof m.id === 'string' && m.id ? m.id : `#${i}`;
    const fail = (why: string): never => {
      throw new Error(`library: item ${id}: ${why}`);
    };
    if (typeof m.id !== 'string' || !m.id) fail('missing id');
    if (seen.has(id)) fail(`duplicate id ${id}`);
    seen.add(id);
    const start = m.bandStartMonths;
    const end = m.bandEndMonths;
    if (!Number.isInteger(start) || !Number.isInteger(end)) fail('band months must be whole numbers');
    if ((start as number) < 0 || (start as number) > MAX_START_MONTHS) fail(`band start must be 0 to ${MAX_START_MONTHS}`);
    if ((start as number) >= (end as number)) fail('band start must be before band end');
    if (typeof m.domain !== 'string' || !DOMAINS.includes(m.domain)) fail('unknown domain');
    if (typeof m.source !== 'string' || !SOURCES.includes(m.source)) fail('unknown source');
    if (typeof m.wording !== 'string' || !m.wording.trim()) fail('missing wording');
    if (typeof m.tip !== 'string' || !m.tip.trim()) fail('missing tip');
    if (typeof m.sourceUrl !== 'string' || !m.sourceUrl.startsWith('https://')) fail('sourceUrl must start with https://');
    const unknown = `${m.wording} ${m.tip}`.match(/\{[^}]*\}/g)?.filter((p) => !PLACEHOLDERS.includes(p)) ?? [];
    if (unknown.length) fail(`unknown placeholders: ${unknown.join(', ')}`);
    const banned = findBannedWords(`${m.wording} ${m.tip}`);
    if (banned.length) fail(`banned words: ${banned.join(', ')}`);
    return {
      id,
      bandStartMonths: start as number,
      bandEndMonths: end as number,
      domain: m.domain as Domain,
      wording: m.wording as string,
      tip: m.tip as string,
      source: m.source as Source,
      sourceUrl: m.sourceUrl as string,
    };
  });
  return { version, milestones: out };
}

/** Unique age bands, sorted by start then end. */
export function bandsOf(ms: readonly Milestone[]): { startMonths: number; endMonths: number }[] {
  const keys = new Map<string, { startMonths: number; endMonths: number }>();
  for (const m of ms) keys.set(`${m.bandStartMonths}-${m.bandEndMonths}`, { startMonths: m.bandStartMonths, endMonths: m.bandEndMonths });
  return [...keys.values()].sort((a, b) => a.startMonths - b.startMonths || a.endMonths - b.endMonths);
}

const sqlText = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** SQL that replaces the whole library with this one (one statement per line-ending ';\n'). */
export function toSeedSql(lib: Library): string {
  const rows = lib.milestones.map(
    (m) =>
      `INSERT INTO milestones (id, band_start_months, band_end_months, domain, wording, tip, source, source_url, library_version) VALUES (` +
      [sqlText(m.id), m.bandStartMonths, m.bandEndMonths, sqlText(m.domain), sqlText(m.wording), sqlText(m.tip), sqlText(m.source), sqlText(m.sourceUrl), sqlText(lib.version)].join(', ') +
      `) ON CONFLICT(id) DO UPDATE SET band_start_months = excluded.band_start_months, band_end_months = excluded.band_end_months, domain = excluded.domain, wording = excluded.wording, tip = excluded.tip, source = excluded.source, source_url = excluded.source_url, library_version = excluded.library_version;\n`,
  );
  // Items removed from the library go too, but only ones with no recorded answers or notes.
  const keep = lib.milestones.map((m) => sqlText(m.id)).join(', ') || "''";
  rows.push(
    `DELETE FROM milestones WHERE id NOT IN (${keep}) AND id NOT IN (SELECT milestone_id FROM milestone_status) AND id NOT IN (SELECT milestone_id FROM milestone_notes);\n`,
  );
  return rows.join('');
}

type Row = {
  id: string;
  band_start_months: number;
  band_end_months: number;
  domain: Domain;
  wording: string;
  tip: string;
  source: Source;
  source_url: string;
};

let cache: readonly Milestone[] | null = null;

/** The milestone library from D1, cached for the life of the isolate once non-empty. */
export async function loadMilestones(db: D1Database): Promise<readonly Milestone[]> {
  if (cache) return cache;
  const { results } = await db
    .prepare('SELECT id, band_start_months, band_end_months, domain, wording, tip, source, source_url FROM milestones ORDER BY band_start_months, id')
    .all<Row>();
  const ms = Object.freeze(
    results.map((r) => ({
      id: r.id,
      bandStartMonths: r.band_start_months,
      bandEndMonths: r.band_end_months,
      domain: r.domain,
      wording: r.wording,
      tip: r.tip,
      source: r.source,
      sourceUrl: r.source_url,
    })),
  );
  if (ms.length) cache = ms;
  return ms;
}

/** Test hook: forget the cached library. */
export function clearMilestoneCache(): void {
  cache = null;
}
