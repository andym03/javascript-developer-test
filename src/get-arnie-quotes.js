const { httpGet } = require('./mock-http-interface');

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 502, 503, 504]);
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 250;

const wait = (delayMs) => new Promise((resolve) => {
  setTimeout(resolve, delayMs);
});

/**
 * Generic retry function. We've assumed that an 'unsuccessful request'
 * is defined as one we've made a best effort to fetch yet still failed.
 * We shouldn't retry against useless codes (see: RETRYABLE_STATUS_CODES)
 * nor should we retry forever, nor should we instantly retry if we 
 * receive one of the rate limiting status codes and a defer time. 
 * (note - we don't parse waitfors/defers)
 * @template T
 * @param {() => Promise<T>} operation
 * @param {(result: T) => boolean} shouldRetry
 * @param {number} [maxRetries]
 * @param {number} [initialDelayMs]
 * @returns {Promise<T>}
 */
const retryWithExponentialBackoff = async (
  operation,
  shouldRetry,
  maxRetries = MAX_RETRIES,
  initialDelayMs = INITIAL_RETRY_DELAY_MS,
) => {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const result = await operation();

    if (!shouldRetry(result) || attempt === maxRetries) {
      return result;
    }

    await wait(initialDelayMs * (2 ** attempt));
  }
};

//1) We are told to expect a string, 2) we must handle JSON.parse 
// failures regardless of the request to ignore input validation.
/**
 * @param {{ status: number, body: string }} response
 * @returns {{ 'Arnie Quote': string }|{ FAILURE: string }}
 */
const responseToResult = (response) => {
  try {
    const { message } = JSON.parse(response.body);

    if (typeof message !== 'string') {
      return { FAILURE: `HTTP ${response.status}: missing message` };
    }

    return response.status === 200
      ? { 'Arnie Quote': message }
      : { FAILURE: message };
  } catch {
    return { FAILURE: `HTTP ${response.status}` };
  }
};

/**
 * Note: We've set no limit on the size of the url array, nor do we know
 * whether we are in a browser or server nodejs environment. We don't know
 * if all these URL's will be on the same origin, or if we will be rate limited,
 * or if the size of Arnie's quotes (or muscles) will infinitely grow, e.g response
 * size. 
 * 
 * Consider concurrency behaviour and argument / job delegation. If we break
 * this down, getArnieQuote is one network request and whatever retry logic desired.
 * we receive a list of url's, but this problem could very well be represented 
 * as an event stream of little lambda jobs.
 * 
 * `Promise.all` is our 'scheduler'. Replace this based on $$$, context, environment.
 * `getArnieQuote` (singular) is the simplest way to consider the task itself, a fetch.
 *   - Decide what a successful / unsuccessful fetch is, retry / fail behaviour
 * 
 * Consider logging failures, telemetry. Consider rate limiting ourselves.
 * @param {string} url
 * @returns {Promise<{ 'Arnie Quote': string }|{ FAILURE: string }>}
 */
const getArnieQuote = async (url) => {
  try {
    const response = await retryWithExponentialBackoff(
      () => httpGet(url),
      ({ status }) => RETRYABLE_STATUS_CODES.has(status),
    );

    return responseToResult(response);
  } catch (error) {
    return { FAILURE: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * @param {string[]} urls
 * @returns {Promise<Array<{ 'Arnie Quote': string }|{ FAILURE: string }>>}
 */
const getArnieQuotes = (urls) => Promise.all(urls.map(getArnieQuote));

module.exports = {
  getArnieQuotes,
};
