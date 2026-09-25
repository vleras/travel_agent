/**
 * Small per-host request limiter with priorities.
 * - At most `concurrency` requests in flight.
 * - Waiting requests run highest priority first; a request's priority is read
 *   when a slot frees up, so a page can boost work that is already queued.
 * - Retries on the given statuses with fixed backoff delays.
 */

export type Priority = 'high' | 'low';

interface LimiterOptions {
  name: string;
  concurrency: number;
  retryStatuses: number[];
  /** Wait before each retry, in ms (its length is the retry count). */
  backoffMs: number[];
  timeoutMs?: number;
}

interface Waiter {
  priority: () => Priority;
  seq: number;
  resolve: () => void;
}

export interface Limiter {
  fetch: (url: string, priority?: () => Priority) => Promise<Response>;
}

export function createLimiter(options: LimiterOptions): Limiter {
  let active = 0;
  let seq = 0;
  let pausedUntil = 0;
  const waiting: Waiter[] = [];

  function acquire(priority: () => Priority): Promise<void> {
    if (active < options.concurrency) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push({ priority, seq: seq++, resolve }));
  }

  function release() {
    if (!waiting.length) {
      active--;
      return;
    }
    // High before low; FIFO within the same priority.
    let best = 0;
    for (let i = 1; i < waiting.length; i++) {
      const a = waiting[i];
      const b = waiting[best];
      const pa = a.priority() === 'high' ? 0 : 1;
      const pb = b.priority() === 'high' ? 0 : 1;
      if (pa < pb || (pa === pb && a.seq < b.seq)) best = i;
    }
    const [next] = waiting.splice(best, 1);
    next.resolve(); // slot passes straight to the next waiter
  }

  async function limitedFetch(url: string, priority: () => Priority = () => 'low'): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await acquire(priority);
      let res: Response;
      try {
        const pause = pausedUntil - Date.now();
        if (pause > 0) await new Promise((r) => setTimeout(r, pause));
        // The timeout starts once the request leaves the queue.
        res = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 8000) });
      } finally {
        release();
      }
      const delay = options.backoffMs[attempt];
      if (!options.retryStatuses.includes(res.status) || delay == null) return res;
      if (Date.now() >= pausedUntil) {
        console.warn(`[${options.name}] ${res.status}; retrying in ${delay / 1000}s.`);
      }
      pausedUntil = Math.max(pausedUntil, Date.now() + delay);
    }
  }

  return { fetch: limitedFetch };
}
