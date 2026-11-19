/**
 * Exponential backoff with jitter: delay for retry n (1-based) is a random value in
 * [cap/2, cap] where cap = min(max, base * 2^(n-1)). Jitter prevents retry storms.
 */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, rand = Math.random): number {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(cap / 2 + rand() * (cap / 2));
}

/** Deterministic [0,1) from a key, so the queue and the UI agree on the jittered delay. */
export function seededRandom(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export function retryDelay(jobId: string | undefined, attempt: number, baseMs: number, maxMs: number): number {
  return backoffDelay(attempt, baseMs, maxMs, () => seededRandom(`${jobId}:${attempt}`));
}

/** 5xx, 408, 429 and network errors are retried; other 4xx are permanent failures. */
export function isRetryable(statusCode: number | null): boolean {
  if (statusCode === null) return true;
  return statusCode >= 500 || statusCode === 408 || statusCode === 429;
}
