/** Browser lifecycle hooks for offline mode and background maintenance. */
import { pwaToast } from './utils.js';
import { syncOutbox, warmGAS } from './sync.js';
import { cleanupExpired } from './storage.js';

window.addEventListener('offline', function() {
  pwaToast('📴 離線模式：可繼續巡查，記錄會暫存');
});

window.addEventListener('online', function() {
  warmGAS();
  setTimeout(function() { syncOutbox(true); }, 0);
});

document.addEventListener('visibilitychange', function() {
  if (!document.hidden) {
    warmGAS();
    syncOutbox(false);
  }
});

setTimeout(warmGAS, 2000);

if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  setTimeout(cleanupExpired, 3000);
}
