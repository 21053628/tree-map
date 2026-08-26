/**
 * 樹木管理系統 - 離線基礎設施入口（相容 facade）
 *
 * 實作已按責任拆分至 assets/js/offline/；本檔保留原有載入路徑及具名匯出。
 */
import { setSyncTrigger, OfflineQueue, snapSave, snapLoad, snapRemove, cleanupExpired } from './assets/js/offline/storage.js';
import { pwaToast } from './assets/js/offline/utils.js';
import { syncOutbox, syncNow, warmGAS } from './assets/js/offline/sync.js';
import './assets/js/offline/api-hooks.js';
import './assets/js/offline/events.js';

setSyncTrigger(syncOutbox);

export const TreeSnapshot = { save: snapSave, load: snapLoad, remove: snapRemove };
export { OfflineQueue, pwaToast, syncOutbox, syncNow, warmGAS, cleanupExpired };
