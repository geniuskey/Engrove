import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { supplementalDictionaries } from './i18n-supplemental.js';

describe('embedded translations', () => {
  it('keeps embedded and supplemental dictionaries aligned by locale', () => {
    const root = process.cwd();
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const source = html.match(
      /<template id="engrove-translations"[^>]*>([\s\S]*?)<\/template\s*>/,
    )?.[1];
    expect(source).toBeTruthy();
    const dictionaries = JSON.parse(source!) as Record<'en' | 'ko', Record<string, unknown>>;

    expect(Object.keys(dictionaries.en).sort()).toEqual(Object.keys(dictionaries.ko).sort());
    expect(Object.keys(supplementalDictionaries.en).sort()).toEqual(
      Object.keys(supplementalDictionaries.ko).sort(),
    );
    expect(
      Object.keys(supplementalDictionaries.en).filter((key) => key in dictionaries.en),
    ).toEqual([]);
    expect(Object.values(dictionaries.en).every((value) => typeof value === 'string')).toBe(true);
    expect(Object.values(dictionaries.ko).every((value) => typeof value === 'string')).toBe(true);
  });
});
