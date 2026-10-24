export interface SettingValues {
  'note.time': string;
  'cadence.headsUpDays': number;
  'cadence.followUpDays': number;
  'cadence.preCheckupDays': number;
  'milestones.pausedUntil': string | null;
  'ai.model': string;
  'ai.monthlyCapUsd': number;
}

export type SettingKey = keyof SettingValues;
export type SettingValue<K extends SettingKey> = SettingValues[K];

export const DEFAULTS: SettingValues = {
  'note.time': '09:00',
  'cadence.headsUpDays': 14,
  'cadence.followUpDays': 14,
  'cadence.preCheckupDays': 7,
  'milestones.pausedUntil': null,
  'ai.model': 'claude-haiku-5-5',
  'ai.monthlyCapUsd': 2,
};

const GLOBAL = 0;

/** Child-specific value if set, else the global value, else the default. */
export async function getSetting<K extends SettingKey>(
  db: D1Database,
  key: K,
  childId?: number,
): Promise<SettingValue<K>> {
  const rows = await db
    .prepare('SELECT child_id, value_json FROM settings WHERE key = ? AND child_id IN (?, ?)')
    .bind(key, GLOBAL, childId ?? GLOBAL)
    .all<{ child_id: number; value_json: string }>();
  const own = rows.results.find((r) => childId !== undefined && r.child_id === childId);
  const global = rows.results.find((r) => r.child_id === GLOBAL);
  const hit = own ?? global;
  return hit ? (JSON.parse(hit.value_json) as SettingValue<K>) : DEFAULTS[key];
}

export async function setSetting<K extends SettingKey>(
  db: D1Database,
  key: K,
  value: SettingValue<K>,
  updatedBy: number,
  childId?: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, child_id, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (key, child_id) DO UPDATE SET value_json = excluded.value_json,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(key, childId ?? GLOBAL, JSON.stringify(value), updatedBy, new Date().toISOString())
    .run();
}
