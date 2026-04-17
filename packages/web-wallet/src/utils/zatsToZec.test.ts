import { describe, it, expect } from 'vitest';
import { zatsToYec } from './zatsToZec';

describe('zatsToYec', () => {
  it('converts 100000000 zats to 1 YEC', () => {
    expect(zatsToYec(100_000_000)).toBe(1);
  });

  it('converts 0 zats to 0 YEC', () => {
    expect(zatsToYec(0)).toBe(0);
  });

  it('converts 50000000 zats to 0.5 YEC', () => {
    expect(zatsToYec(50_000_000)).toBe(0.5);
  });

  it('converts 1 zat to 0.00000001 YEC', () => {
    expect(zatsToYec(1)).toBe(0.00000001);
  });

  it('handles very small amounts (100 zats)', () => {
    expect(zatsToYec(100)).toBe(0.000001);
  });

  it('handles very large amounts (10 billion zats = 100 YEC)', () => {
    expect(zatsToYec(10_000_000_000)).toBe(100);
  });

  it('handles decimal precision correctly', () => {
    // 12345678 zats = 0.12345678 YEC
    expect(zatsToYec(12_345_678)).toBe(0.12345678);
  });

  it('handles typical transaction amounts', () => {
    // 1.5 YEC = 150000000 zats
    expect(zatsToYec(150_000_000)).toBe(1.5);
  });

  it('handles minimum shielding amount (0.001 YEC = 100000 zats)', () => {
    expect(zatsToYec(100_000)).toBe(0.001);
  });

  it('handles amounts less than minimum shielding (99999 zats)', () => {
    expect(zatsToYec(99_999)).toBe(0.00099999);
  });

  it('handles 21 million YEC (Ycash max supply) in zats', () => {
    // Ycash shares Zcash's 21M cap — 21 million YEC = 2.1 quadrillion zats
    const maxSupplyZats = 21_000_000 * 100_000_000;
    expect(zatsToYec(maxSupplyZats)).toBe(21_000_000);
  });
});
