import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IconAction } from './IconAction.js';

describe('IconAction', () => {
  it('keeps icon-only actions named and explained by a tooltip', () => {
    render(<IconAction icon="✎" label="Edit cell" />);

    expect(screen.getByRole('button', { name: 'Edit cell' })).toHaveAttribute('title', 'Edit cell');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Edit cell');
  });

  it('can keep an edge action tooltip inside a narrow panel', () => {
    render(<IconAction icon="×" label="Remove long evidence link" tooltipAlign="end" />);

    const tooltip = screen.getByRole('tooltip', { name: 'Remove long evidence link' });
    expect(tooltip).toHaveClass('right-0');
    expect(tooltip).not.toHaveClass('-translate-x-1/2');
  });
});
