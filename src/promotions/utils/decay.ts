export const DEFAULT_DECAY_RATE = 0.05;

export function applyTimeDecay(
  rawScore: number,
  daysSinceLastEvent: number,
  decayRate = DEFAULT_DECAY_RATE,
): number {
  if (!Number.isFinite(rawScore) || rawScore <= 0) {
    return 0;
  }

  const days = Number.isFinite(daysSinceLastEvent)
    ? Math.max(0, daysSinceLastEvent)
    : 0;

  return rawScore * Math.exp(-decayRate * days);
}
