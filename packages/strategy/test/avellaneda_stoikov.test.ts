import { describe, expect, it } from 'vitest';
import { optimalSpreadTicks, reservationPriceTicks } from '@hft/strategy';

describe('Avellaneda & Stoikov (2008) closed form', () => {
  const gamma = 0.1;
  const sigma = 2;
  const kappa = 1.5;

  it('reservation price equals the mid when inventory is flat', () => {
    expect(reservationPriceTicks(100, 0, gamma, sigma, 0.5)).toBe(100);
  });

  it('reservation price is r = s - q*gamma*sigma^2*(T-t)', () => {
    const r = reservationPriceTicks(100, 3, gamma, sigma, 0.5);
    expect(r).toBeCloseTo(100 - 3 * 0.1 * 4 * 0.5, 12);
    expect(r).toBeCloseTo(99.4, 12);
  });

  it('a long inventory shades quotes down and a short inventory shades them up, symmetrically', () => {
    const long = reservationPriceTicks(100, 5, gamma, sigma, 1);
    const short = reservationPriceTicks(100, -5, gamma, sigma, 1);
    expect(long).toBeLessThan(100);
    expect(short).toBeGreaterThan(100);
    expect(100 - long).toBeCloseTo(short - 100, 12);
  });

  it('optimal spread equals gamma*sigma^2*(T-t) + (2/gamma)*ln(1 + gamma/kappa)', () => {
    const expected = 0.1 * 4 * 0.5 + (2 / 0.1) * Math.log(1 + 0.1 / 1.5);
    expect(optimalSpreadTicks(gamma, sigma, 0.5, kappa)).toBeCloseTo(expected, 12);
  });

  it('spread collapses to the inventory-independent term at terminal time', () => {
    const terminal = optimalSpreadTicks(gamma, sigma, 0, kappa);
    expect(terminal).toBeCloseTo((2 / gamma) * Math.log(1 + gamma / kappa), 12);
  });

  it('spread widens with risk aversion, volatility and time remaining', () => {
    const base = optimalSpreadTicks(gamma, sigma, 0.5, kappa);
    expect(optimalSpreadTicks(gamma, sigma * 2, 0.5, kappa)).toBeGreaterThan(base);
    expect(optimalSpreadTicks(gamma, sigma, 1.0, kappa)).toBeGreaterThan(base);
    expect(optimalSpreadTicks(gamma, sigma, 0.5, kappa / 2)).toBeGreaterThan(base);
  });

  it('inventory risk term vanishes as gamma goes to zero, leaving the market-order intensity term', () => {
    const tiny = 1e-6;
    const spread = optimalSpreadTicks(tiny, sigma, 0.5, kappa);
    expect(spread).toBeCloseTo((2 / tiny) * Math.log(1 + tiny / kappa), 3);
    expect(spread).toBeCloseTo(2 / kappa, 3);
  });
});
