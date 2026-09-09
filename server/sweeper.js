/**
 * The standing sweep.
 *
 * Discovery runs on the server's own clock, not the browser's. It used to live
 * in the discovery panel, which meant it only ticked while that panel happened
 * to be on screen: navigating to the board unmounted it, and a hidden tab
 * skipped it silently while still resetting the countdown. The desk would read
 * "next check in 4m" beside "updated 22 min ago" and both were true.
 *
 * Here it runs whether or not anyone is looking, and every client just reads
 * the result.
 */
import './env.js';
import { discover } from './discover.js';
import { fetchAll } from './rss.js';
import { configuredFeeds } from './feeds.js';

const INTERVAL_MS = Number(process.env.LSS_SWEEP_INTERVAL_MS || 5 * 60_000);
/** New headlines needed before re-clustering is worth the spend. */
const NEW_ITEMS_TO_RESWEEP = Number(process.env.LSS_SWEEP_NEW_ITEMS || 5);

const state = {
  auto: process.env.LSS_SWEEP_AUTO !== '0',
  intervalMs: INTERVAL_MS,
  running: false,
  last: null,
  lastCheckAt: null,
  lastSkip: null,
  nextCheckAt: null,
};

let timer = null;

export function sweeperStatus() {
  return {
    auto: state.auto,
    intervalMs: state.intervalMs,
    running: state.running,
    lastCheckAt: state.lastCheckAt,
    lastSkip: state.lastSkip,
    nextCheckAt: state.nextCheckAt,
  };
}

/** The most recent completed sweep, or null. */
export const lastDiscovery = () => state.last;

/** How many headlines are on the wire that the last sweep never saw. */
async function freshCount() {
  const seen = new Set(state.last?.wireLinks || []);
  if (!seen.size) return Infinity;
  const { items } = await fetchAll(configuredFeeds());
  return items.slice(0, 40).filter((i) => !seen.has(i.link)).length;
}

export async function runSweep({ force = false, useRss = true, useTrending = true } = {}) {
  if (state.running) return { skipped: 'a sweep is already running' };

  state.lastCheckAt = new Date().toISOString();
  if (!force) {
    try {
      const fresh = await freshCount();
      if (fresh < NEW_ITEMS_TO_RESWEEP) {
        state.lastSkip = `${fresh || 'No'} new headline${fresh === 1 ? '' : 's'} since the last sweep — not enough to re-run.`;
        state.nextCheckAt = new Date(Date.now() + state.intervalMs).toISOString();
        return { skipped: state.lastSkip, fresh };
      }
    } catch {
      /* if the wire check fails, sweep anyway rather than stall */
    }
  }

  state.running = true;
  state.lastSkip = null;
  try {
    const out = await discover({ useRss, useTrending });
    state.last = { ...out, finishedAt: new Date().toISOString() };
    return state.last;
  } finally {
    state.running = false;
    state.nextCheckAt = new Date(Date.now() + state.intervalMs).toISOString();
  }
}

export function startSweeper() {
  if (timer) clearInterval(timer);
  state.nextCheckAt = new Date(Date.now() + state.intervalMs).toISOString();
  timer = setInterval(() => {
    if (state.auto) runSweep().catch(() => {});
  }, state.intervalMs);
  timer.unref?.();
  return sweeperStatus();
}

export function setSweeperAuto(on) {
  state.auto = !!on;
  state.nextCheckAt = on ? new Date(Date.now() + state.intervalMs).toISOString() : null;
  return sweeperStatus();
}

/** Used by the autopilot so a cycle does not pay for a sweep twice. */
export function freshEnough(maxAgeMs = INTERVAL_MS) {
  if (!state.last?.finishedAt) return null;
  return Date.now() - new Date(state.last.finishedAt).getTime() <= maxAgeMs ? state.last : null;
}
