import { describe, expect, it } from 'vitest';
import { canonicalDecimal, parseCsv } from '../src/configurable-data.js';

describe('configurable record canonicalization', () => {
  it.each([
    ['0010.00', '10'],
    ['-0.000', '0'],
    ['1.20e-2', '0.012'],
    ['2e3', '2000'],
    ['.00042', '0.00042'],
  ])('canonicalizes %s without binary floating point', (input, expected) => {
    expect(canonicalDecimal(input)).toBe(expected);
  });

  it('enforces significant digit and integer boundaries', () => {
    expect(() => canonicalDecimal('12345678901234567890123456789012345')).toThrow(/34/);
    expect(() => canonicalDecimal('1.5', true)).toThrow(/integer/);
    expect(canonicalDecimal('1.0', true)).toBe('1');
  });

  it('parses quoted commas, quotes, and line breaks deterministically', () => {
    expect(parseCsv('displayName,notes\r\n"A, 1","line 1\nline ""2"""\r\n')).toEqual([
      ['displayName', 'notes'],
      ['A, 1', 'line 1\nline "2"'],
    ]);
  });
});
