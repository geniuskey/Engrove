import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('embedded translations', () => {
  it('keeps both dictionaries aligned with the compile-time key union', () => {
    const root = process.cwd();
    const types = readFileSync(resolve(root, 'src/i18n-types.ts'), 'utf8');
    const declaredKeys = [...types.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]).sort();
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const source = html.match(
      /<template id="engrove-translations"[^>]*>([\s\S]*?)<\/template\s*>/,
    )?.[1];
    expect(source).toBeTruthy();
    const dictionaries = JSON.parse(source!) as Record<'en' | 'ko', Record<string, unknown>>;

    expect(Object.keys(dictionaries.en).sort()).toEqual(declaredKeys);
    expect(Object.keys(dictionaries.ko).sort()).toEqual(declaredKeys);
    expect(Object.values(dictionaries.en).every((value) => typeof value === 'string')).toBe(true);
    expect(Object.values(dictionaries.ko).every((value) => typeof value === 'string')).toBe(true);
  });
});
