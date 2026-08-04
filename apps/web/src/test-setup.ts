import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const translations = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8').match(
  /<template id="engrove-translations"[^>]*>([\s\S]*?)<\/template\s*>/,
)?.[1];
if (!translations) throw new Error('TEST_TRANSLATIONS_NOT_FOUND');
const translationContainer = document.createElement('template');
translationContainer.id = 'engrove-translations';
translationContainer.innerHTML = translations;
document.body.append(translationContainer);
