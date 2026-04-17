const ZATS_PER_YEC = 100_000_000;

export function zatsToYec(zats: number): number {
  return zats / ZATS_PER_YEC;
}
