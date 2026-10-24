import { describe, expect, it } from 'vitest';
import { scanText } from '../../scripts/lib/scan';

// Samples are joined at runtime so this file doesn't trip the scan itself.
const j = (...parts: string[]) => parts.join('');

describe('personal data scan', () => {
  it('flags NRIC/FIN numbers', () => {
    expect(scanText(j('id S', '1234567D here'), [])).toEqual([{ rule: 'NRIC/FIN', match: j('S', '1234567D') }]);
    expect(scanText(j('T', '0123456G'), []).map((f) => f.rule)).toEqual(['NRIC/FIN']);
  });

  it('flags Singapore phone numbers, with or without +65 and a space', () => {
    expect(scanText(j('call 9', '1234567'), []).map((f) => f.rule)).toEqual(['SG phone']);
    expect(scanText(j('+65 8', '123 4567'), []).map((f) => f.rule)).toEqual(['SG phone']);
    expect(scanText(j('6', '123-4567'), []).map((f) => f.rule)).toEqual(['SG phone']);
  });

  it('flags postal codes next to Singapore', () => {
    expect(scanText(j('Blk 1 Road, Singapore ', '123456'), []).map((f) => f.rule)).toEqual(['SG postal code']);
    expect(scanText(j('S(', '123456)'), []).map((f) => f.rule)).toEqual(['SG postal code']);
  });

  it('flags denylisted strings case-insensitively', () => {
    expect(scanText('Hello MYNAME', ['myname'])).toEqual([{ rule: 'denylist', match: 'MYNAME' }]);
  });

  it('leaves ordinary code alone', () => {
    const code = `version 5.20261024.1, sha512-AbS1234567DzZ, timeout 10000, 2026-03-10, id: 12345678, port 8787, compat 20261019`;
    expect(scanText(code, [])).toEqual([]);
  });
});
