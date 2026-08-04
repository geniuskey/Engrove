import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CalculatedFieldSettings } from './DataPageSchema.js';
import { I18nProvider } from './i18n.js';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('CalculatedFieldSettings localization', () => {
  it('renders formula settings in Korean', () => {
    window.localStorage.setItem('engrove-locale', 'ko');

    render(
      <I18nProvider>
        <CalculatedFieldSettings base="/projects/project-1" fields={[]} type="formula" />
      </I18nProvider>,
    );

    expect(screen.getByRole('textbox', { name: '수식 표현식' })).toBeInTheDocument();
    expect(screen.getByText(/\{field-key\} 형식으로 필드를 참조/)).toBeInTheDocument();
  });
});
