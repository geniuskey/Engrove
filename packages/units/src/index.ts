import Decimal from 'decimal.js';
import { GENERATED_REGISTRY, REGISTRY_DIGEST, REGISTRY_VERSION } from './generated.js';

Decimal.set({
  precision: 34,
  rounding: Decimal.ROUND_HALF_EVEN,
  minE: -6143,
  maxE: 6144,
  toExpNeg: -6143,
  toExpPos: 6144,
});

export { REGISTRY_DIGEST, REGISTRY_VERSION };
export type Dimension = keyof typeof GENERATED_REGISTRY.dimensions;
export type Quantity = {
  value: string;
  unit: string;
  canonicalValue: string;
  canonicalUnit: string;
  dimension: Dimension;
  precision?: number | null;
  uncertainty?: string | null;
  unitRegistryVersion: string;
};
const prefixes: Record<string, string> = {
  Y: '24',
  Z: '21',
  E: '18',
  P: '15',
  T: '12',
  G: '9',
  M: '6',
  k: '3',
  h: '2',
  da: '1',
  d: '-1',
  c: '-2',
  m: '-3',
  u: '-6',
  µ: '-6',
  n: '-9',
  p: '-12',
  f: '-15',
};
type Unit = (typeof GENERATED_REGISTRY.units)[number];

function canonicalDecimal(value: string): string {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
    throw new Error('INVALID_DECIMAL');
  const mantissa = value.replace(/^[+-]/, '').split(/[eE]/)[0]!.replace('.', '');
  const significant = mantissa.replace(/^0+/, '').length || 1;
  if (significant > 34) throw new Error('DECIMAL_PRECISION_EXCEEDED');
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) throw new Error('INVALID_DECIMAL');
  return decimal.isZero()
    ? '0'
    : decimal
        .toSignificantDigits(34, Decimal.ROUND_HALF_EVEN)
        .toFixed()
        .replace(/(\.\d*?[1-9])0+$/, '$1')
        .replace(/\.0+$/, '');
}

function resolveUnit(input: string): { unit: Unit; prefixPower: number } {
  const exact = GENERATED_REGISTRY.units.find(
    (unit) => unit.id === input || unit.symbol === input || unit.aliases.includes(input as never),
  );
  if (exact) return { unit: exact, prefixPower: 0 };
  for (const prefix of Object.keys(prefixes).sort((a, b) => b.length - a.length)) {
    if (!input.startsWith(prefix)) continue;
    const base = input.slice(prefix.length);
    const unit = GENERATED_REGISTRY.units.find(
      (candidate) =>
        'prefixable' in candidate &&
        candidate.prefixable === true &&
        (candidate.id === base || candidate.symbol === base),
    );
    if (unit) return { unit, prefixPower: Number(prefixes[prefix]) };
  }
  throw new Error('UNKNOWN_UNIT');
}

export function convertQuantity(
  value: string,
  unitId: string,
  expectedDimension?: Dimension,
  difference = false,
): Quantity {
  const original = canonicalDecimal(value);
  const { unit, prefixPower } = resolveUnit(unitId);
  if (expectedDimension && unit.dimension !== expectedDimension)
    throw new Error('INCOMPATIBLE_DIMENSION');
  const scale = new Decimal(unit.scaleNumerator)
    .div(unit.scaleDenominator)
    .mul(new Decimal(10).pow(prefixPower));
  const offset = difference
    ? new Decimal(0)
    : new Decimal(unit.offsetNumerator).div(unit.offsetDenominator);
  const canonical = canonicalDecimal(new Decimal(original).mul(scale).add(offset).toFixed());
  return {
    value: original,
    unit: unitId,
    canonicalValue: canonical,
    canonicalUnit: GENERATED_REGISTRY.dimensions[unit.dimension].canonicalUnit,
    dimension: unit.dimension,
    unitRegistryVersion: `${REGISTRY_VERSION}+sha256:${REGISTRY_DIGEST}`,
  };
}

export function assertCompatibleUnit(unitId: string, dimension: Dimension): void {
  resolveUnitForDimension(unitId, dimension);
}
export function resolveUnitForDimension(unitId: string, dimension: Dimension): string {
  const found = resolveUnit(unitId);
  if (found.unit.dimension !== dimension) throw new Error('INCOMPATIBLE_DIMENSION');
  return found.unit.id;
}
export function compareCanonical(a: string, b: string): number {
  return new Decimal(a).cmp(new Decimal(b));
}
export const UNIT_REGISTRY = GENERATED_REGISTRY;
