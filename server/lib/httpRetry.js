// Shared bounded retry with exponential backoff for the hosting providers'
// fetch layer. Keeps each provider thin and consistent: providers wrap a single
// "try once" call and declare which results are transient.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isRetryableStatus = (status) =>
  status === 429 || status === 0 || (Number.isInteger(status) && status >= 500);

// `run(i)` must resolve with the result envelope (never throw). Returns the
// first non-retryable result, or the last result after `attempts` tries.
export const withRetry = async ({
  run,
  attempts = 3,
  baseDelayMs = 250,
  maxDelayMs = 4000,
  isRetryable = (res) => isRetryableStatus(res?.status),
  onRetry,
} = {}) => {
  let result;
  for (let i = 0; i < attempts; i += 1) {
    result = await run(i);
    if (!isRetryable(result)) return result;
    if (i === attempts - 1) break;
    if (onRetry) onRetry(result, i + 1);
    const delay = Math.min(baseDelayMs * 2 ** i, maxDelayMs);
    if (delay > 0) await sleep(delay);
  }
  return result;
};