/**
 * 離線頁面 — 按鈕綁定 + 待同步記錄計數器（ES Module）
 * 從 IndexedDB outbox 讀取 pending/failed 記錄數，顯示在頁面底部
 */
'use strict';

// 🔥 [CSP 相容] 按鈕事件改由 JS 綁定，避免 inline onclick 被 CSP script-src 阻擋
const btnRetry = document.getElementById('btnRetry');
if (btnRetry) btnRetry.addEventListener('click', function(){ location.reload(); });
const btnHome = document.getElementById('btnHome');
if (btnHome) btnHome.addEventListener('click', function(){ location.href = './index.html'; });

try {
  const req = indexedDB.open('tree-offline');
  req.onsuccess = function (e) {
    try {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('outbox')) return;
      const tx = db.transaction('outbox', 'readonly');
      const store = tx.objectStore('outbox');
      const all = store.getAll();
      all.onsuccess = function () {
        const list = all.result || [];
        const pending = list.filter(function (r) { return r.status === 'queued' || r.status === 'syncing'; }).length;
        const failed = list.filter(function (r) { return r.status === 'failed'; }).length;
        const el = document.getElementById('pendingInfo');
        if (pending || failed) el.textContent = '待同步：' + pending + ' 筆' + (failed ? '（失敗 ' + failed + ' 筆可重試）' : '');
      };
    } catch (_e) {}
  };
} catch (_e) {}