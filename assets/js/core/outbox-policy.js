/**
 * Outbox 狀態及 lease 規則（零 DOM / IndexedDB 依賴）
 * 供 offline.js 使用，亦方便以 Node.js 做 deterministic unit test。
 */

export const OUTBOX_STATUSES = Object.freeze({
  QUEUED: 'queued',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  FAILED: 'failed'
});

export const OUTBOX_LEASE_MS = 2 * 60 * 1000;

export function normalizeOutboxStatus(status) {
  return Object.values(OUTBOX_STATUSES).indexOf(status) !== -1
    ? status
    : OUTBOX_STATUSES.QUEUED;
}

export function isOutboxPending(item) {
  if (!item) return false;
  const status = normalizeOutboxStatus(item.status);
  return status === OUTBOX_STATUSES.QUEUED || status === OUTBOX_STATUSES.SYNCING;
}

export function isOutboxLeaseExpired(item, now, leaseMs = OUTBOX_LEASE_MS) {
  if (!item || normalizeOutboxStatus(item.status) !== OUTBOX_STATUSES.SYNCING) return false;
  const started = Number(item.syncingAt);
  return !Number.isFinite(started) || Number(now) - started >= leaseMs;
}

export function canClaimOutboxItem(item, owner, now, leaseMs = OUTBOX_LEASE_MS) {
  if (!item || !isOutboxPending(item)) return false;
  const status = normalizeOutboxStatus(item.status);
  if (status === OUTBOX_STATUSES.QUEUED) return true;
  return item.syncOwner === owner || isOutboxLeaseExpired(item, now, leaseMs);
}
