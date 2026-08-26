/** Offline infrastructure configuration and shared limits. */
import { CachePolicy } from '../core/cache-policy.js';
import { Config } from '../config.js';

export const API_URL = Config.API_ENDPOINT || '';
export const DB_NAME = 'tree-offline';
export const STORE = 'outbox';
export const SNAPSHOT_STORE = 'snapshot';
export const MAX_AGE_DAYS = 30;
export const MAX_RETRY = 5;
export const SYNC_BATCH_SIZE = 10;
export const BATCH_DELAY_MS = 250;
export const MAX_DRAIN_BATCHES = 100;
export const CACHE_KEY_PREFIX = 'tree_cache_';
export const CACHE_MAX_AGE = (() => {
  try {
    if (CachePolicy.POLICY && CachePolicy.POLICY.snapshot) return CachePolicy.POLICY.snapshot.ttl;
  } catch (e) { /* intentionally ignored: optional fallback failure */ }
  return 24 * 60 * 60 * 1000;
})();
