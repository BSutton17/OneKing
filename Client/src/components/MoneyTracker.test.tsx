import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { characterCard } from '../lib/art';
import { cellFor } from '../lib/money';
import { MoneyTracker } from './MoneyTracker';

describe('<MoneyTracker>', () => {
  test('uses the right official card and puts the token on the balance cell', () => {
    const { getByTestId, getByText, rerender } = render(<MoneyTracker role="noble" gold={600} />);
    const card = getByTestId('money-noble');
    expect(card.querySelector('img')!.getAttribute('src')).toContain('character/noble.webp');
    const token = card.querySelector('.token') as HTMLElement;
    const expected = cellFor(600, characterCard('noble'));
    expect(token.dataset.cell).toBe('600');
    expect(token.style.left).toBe(`${expected.x}%`);
    expect(token.style.top).toBe(`${expected.y}%`);
    getByText(/600 gold/);

    rerender(<MoneyTracker role="king" gold={1300} />);
    const king = getByTestId('money-king');
    expect(king.querySelector('img')!.getAttribute('src')).toContain('character/king.webp');
    const moved = king.querySelector('.token') as HTMLElement;
    expect(moved.dataset.cell).toBe('1300');
    expect(moved.style.left).toBe(`${cellFor(1300, characterCard('king')).x}%`);
  });
});
