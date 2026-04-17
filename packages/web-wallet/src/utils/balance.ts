import { Decimal } from 'decimal.js';

const ZATS_PER_YEC = 100_000_000;

function zatsToYec(zats: number): number {
  return zats / ZATS_PER_YEC;
}

function yecToZats(yecAmount: string): bigint {

  if (!/^\d+(\.\d+)?$/.test(yecAmount)) {
    throw new Error('Invalid YEC format: must be positive number');
  }

  const amount = new Decimal(yecAmount);

  if (amount.decimalPlaces() > 8) {
    throw new Error('Maximum 8 decimal places allowed');
  }

  const zats = amount.mul(100_000_000).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return BigInt(zats.toFixed());
}

export { zatsToYec, yecToZats };
