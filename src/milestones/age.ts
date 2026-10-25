// Date-only arithmetic on YYYY-MM-DD strings. No local-time getters, so results never shift by timezone.

export type Child = {
  id: number;
  name: string;
  pronoun: 'she' | 'he' | 'they';
  birthDate: string | null;
  dueDate: string | null;
  useCorrectedAge: boolean;
};

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y!, m!, d!];
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Due date when corrected age applies (or the child is not born yet), else birth date. */
export function effectiveBirthDate(child: Child): string {
  if (child.useCorrectedAge || !child.birthDate) {
    if (!child.dueDate) throw new Error('child has neither birth date nor due date');
    return child.dueDate;
  }
  return child.birthDate;
}

export function ageInWholeMonths(child: Child, today: string): number {
  const born = effectiveBirthDate(child);
  const [by, bm] = parts(born);
  const [ty, tm] = parts(today);
  let months = (ty - by) * 12 + (tm - bm);
  if (addMonths(born, months) > today) months -= 1;
  return Math.max(0, months);
}

export function windowOpenDate(child: Child, bandStartMonths: number): string {
  return addMonths(effectiveBirthDate(child), bandStartMonths);
}
