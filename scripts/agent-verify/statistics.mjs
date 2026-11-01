/** Nearest-rank percentiles over actual measured wall times, in milliseconds. */
export function summarize(samples) {
  if (!Array.isArray(samples) || !samples.length || samples.some((n) => !Number.isFinite(n) || n < 0)) throw new TypeError('samples must be nonempty finite nonnegative numbers');
  const sorted = [...samples].sort((a, b) => a - b);
  // Dividing each term avoids an overflowing sum for otherwise finite inputs.
  const mean = samples.reduce((sum, value) => sum + value / samples.length, 0);
  if (!Number.isFinite(mean)) throw new TypeError('mean is not finite');
  return { count: samples.length, mean_ms: mean, p95_ms: sorted[Math.ceil(0.95 * sorted.length) - 1], p99_ms: sorted[Math.ceil(0.99 * sorted.length) - 1], max_ms: sorted.at(-1) };
}

export function budgetEligibility(budget, environment, cache, contention) {
  const reasons = [];
  if (contention !== 'none') reasons.push('contention_unresolved');
  if (cache.state === 'unclassified' || cache.outcome !== 'verified' || cache.state !== cache.requested || cache.state !== budget.cache_state) reasons.push('cache_unqualified');
  const sameHardware = environment.hardware_id === budget.hardware_id && environment.profile === budget.profile;
  if (budget.mode === 'hardware-targeted' && !sameHardware) reasons.push('hardware_profile_mismatch');
  return { eligible: reasons.length === 0, reasons, limitation: budget.mode === 'regression-guard' ? (sameHardware ? 'regression_guard_only' : 'cross_hardware_regression_guard_only') : 'hardware_targeted' };
}

export function closeNumber(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-6);
}
