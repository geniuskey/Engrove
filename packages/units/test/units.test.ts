import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertQuantity, REGISTRY_DIGEST } from '../src/index.js';

describe('authoritative units', () => {
  it('canonicalizes equivalent lengths exactly', () => {
    expect(convertQuantity('1', 'mm', 'length').canonicalValue).toBe('0.001');
    expect(convertQuantity('0.001', 'm', 'length').canonicalValue).toBe('0.001');
    expect(convertQuantity('1000', 'um', 'length').canonicalValue).toBe('0.001');
  });
  it('converts absolute temperature and rejects dimensions', () => {
    expect(convertQuantity('0', 'degC', 'temperature').canonicalValue).toBe('273.15');
    expect(convertQuantity('273.15', 'K', 'temperature').canonicalValue).toBe('273.15');
    expect(() => convertQuantity('1', 's', 'length')).toThrow('INCOMPATIBLE_DIMENSION');
  });
  it('embeds a sha256 registry digest', () => expect(REGISTRY_DIGEST).toMatch(/^[a-f0-9]{64}$/));
  it('matches every shared fixture', () => {
    const fixtures = JSON.parse(
      readFileSync(new URL('../fixtures/conversions.json', import.meta.url), 'utf8'),
    ) as Array<{
      value: string;
      unit: string;
      dimension: 'length' | 'temperature' | 'mass' | 'time';
      canonicalValue: string;
      canonicalUnit: string;
    }>;
    for (const fixture of fixtures) {
      const result = convertQuantity(fixture.value, fixture.unit, fixture.dimension);
      expect(result.canonicalValue).toBe(fixture.canonicalValue);
      expect(result.canonicalUnit).toBe(fixture.canonicalUnit);
    }
  });
});
