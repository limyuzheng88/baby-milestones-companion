// What each setting means, who may change it, and which values it accepts. Used by chat and (later) the settings page.
import { PRICES } from '../ai/spend';
import type { SettingKey, SettingValues } from './store';

type Rule<K extends SettingKey> = {
  label: string;
  allowed: string;
  ownerOnly: boolean;
  parse(raw: unknown): SettingValues[K] | undefined;
  format(value: SettingValues[K]): string;
};

const intIn = (min: number, max: number) => (raw: unknown) => {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^-?\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

function parseTime(raw: unknown): string | undefined {
  const m = typeof raw === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(raw.trim()) : null;
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : undefined;
}

function parseDateOrNull(raw: unknown): string | null | undefined {
  if (raw === null || raw === '' || raw === 'null') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : undefined;
}

export const SETTING_RULES: { [K in SettingKey]: Rule<K> } = {
  'note.time': { label: 'daily note time', allowed: 'HH:MM, 24-hour, Singapore time', ownerOnly: false, parse: parseTime, format: (v) => v },
  'cadence.headsUpDays': { label: 'heads-up before a new age band', allowed: 'whole days 0 to 60', ownerOnly: false, parse: intIn(0, 60), format: days },
  'cadence.followUpDays': { label: 'gentle follow-up after "not yet"', allowed: 'whole days 1 to 90', ownerOnly: false, parse: intIn(1, 90), format: days },
  'cadence.preCheckupDays': { label: 'reminder before a check-up', allowed: 'whole days 0 to 30', ownerOnly: false, parse: intIn(0, 30), format: days },
  'cadence.checkInsPerDay': { label: 'milestone check-ins per day', allowed: 'whole number 1 to 10', ownerOnly: false, parse: intIn(1, 10), format: String },
  'milestones.pausedUntil': {
    label: 'milestone messages paused until',
    allowed: 'YYYY-MM-DD, or null to resume',
    ownerOnly: false,
    parse: parseDateOrNull,
    format: (v) => v ?? 'not paused',
  },
  'ai.model': {
    label: 'AI model',
    allowed: Object.keys(PRICES).join(' | '),
    ownerOnly: true,
    parse: (raw) => (typeof raw === 'string' && raw in PRICES ? raw : undefined),
    format: (v) => v,
  },
  'ai.monthlyCapUsd': {
    label: 'monthly AI budget',
    allowed: 'US dollars 0 to 50',
    ownerOnly: true,
    parse: (raw) => {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+(\.\d{1,2})?$/.test(raw.trim()) ? Number(raw) : NaN;
      return n >= 0 && n <= 50 ? n : undefined;
    },
    format: (v) => `US$${v.toFixed(2)}`,
  },
};

export function parseSettingValue<K extends SettingKey>(key: K, raw: unknown): SettingValues[K] | undefined {
  return SETTING_RULES[key].parse(raw);
}

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === 'string' && Object.hasOwn(SETTING_RULES, key);
}
