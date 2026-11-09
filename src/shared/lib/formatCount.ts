const COUNT_UNITS = [
  { threshold: 1_000_000, suffix: 'М' },
  { threshold: 1_000, suffix: 'К' },
] as const;

export function formatCount(value: number): string {
  const normalized = Math.max(0, Math.round(value));
  for (const unit of COUNT_UNITS) {
    if (normalized < unit.threshold) continue;
    const scaled = normalized / unit.threshold;
    const rounded = Math.round(scaled * 10) / 10;
    const formatted = Number.isInteger(rounded)
      ? String(rounded)
      : rounded.toFixed(1).replace('.', ',');
    return `${formatted}${unit.suffix}`;
  }
  return String(normalized);
}
