/**
 * 樹木管理系統 - Sync Center 同步狀態面板 (Phase 3)
 * 純 plain script（IIFE），依賴 offline.js 暴露的：
 *   window.OfflineQueue / window.syncNow / window.pwaToast
 * 用途：前線人員不需開啟 devtools 都知道同步狀態、可重試／匯出失敗記錄
 */
(function () {
  'use strict';

  if (typeof window.OfflineQueue === 'undefined') return; // offline.js 未載入就不顯示

  var BADGE_ID = 'syncBadge';
  var PANEL_ID = 'syncPanel';
  var STYLE_ID = 'sync-panel-style';
  var POLL_INTERVAL = 8000;

  var _els = {};
  var _pollTimer = null;

  function isTreePage() {
    return !!document.getElementById('app') && !document.getElementById('map');
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#' + BADGE_ID + '{position:fixed;right:12px;bottom:100px;z-index:99990;display:flex;align-items:center;gap:6px;background:#263238;color:#fff;border:none;border-radius:999px;padding:10px 14px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.28);touch-action:manipulation;}',
      '#' + BADGE_ID + ':active{transform:scale(.97);}',
      '#' + BADGE_ID + ' .bubble{min-width:20px;height:20px;line-height:20px;border-radius:999px;font-size:12px;text-align:center;padding:0 6px;background:#546e7a;}',
      '#' + BADGE_ID + ' .bubble.ok{background:#2e7d32;}',
      '#' + BADGE_ID + ' .bubble.warn{background:#ffb300;color:#000;}',
      '#' + BADGE_ID + ' .bubble.err{background:#e53935;}',
      '#' + PANEL_ID + '{position:fixed;right:12px;bottom:88px;z-index:99991;width:min(360px,calc(100vw - 24px));max-height:72vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;font-size:14px;color:#222;line-height:1.5;}',
      '#' + PANEL_ID + '.open{display:block;}',
      '#' + PANEL_ID + ' .sp-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #eee;font-weight:600;position:sticky;top:0;background:#fff;}',
      '#' + PANEL_ID + ' .sp-close{border:none;background:none;font-size:18px;cursor:pointer;color:#666;padding:0 4px;}',
      '#' + PANEL_ID + ' .sp-body{padding:12px 14px;}',
      '#' + PANEL_ID + ' .sp-row{display:flex;justify-content:space-between;margin:6px 0;font-size:13px;}',
      '#' + PANEL_ID + ' .sp-muted{color:#888;font-size:12px;}',
      '#' + PANEL_ID + ' .sp-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;}',
      '#' + PANEL_ID + ' .sp-btn{flex:1;min-width:120px;border:none;border-radius:9px;padding:10px 8px;background:#2e7d32;color:#fff;font-size:13px;font-weight:500;cursor:pointer;touch-action:manipulation;}',
      '#' + PANEL_ID + ' .sp-btn.sec{background:#546e7a;}',
      '#' + PANEL_ID + ' .sp-btn.warn{background:#e65100;}',
      '#' + PANEL_ID + ' .sp-failed{margin-top:8px;border-top:1px dashed #ddd;padding-top:8px;}',
      '#' + PANEL_ID + ' .sp-failed-item{border:1px solid #f0d0d0;background:#fff5f5;border-radius:9px;padding:8px 10px;margin-bottom:8px;font-size:12px;}',
      '#' + PANEL_ID + ' .sp-failed-item .f-title{font-weight:600;color:#b71c1c;}',
      '#' + PANEL_ID + ' .sp-failed-item .f-err{color:#888;word-break:break-all;}',
      '#' + PANEL_ID + ' .sp-failed-item .f-actions{margin-top:6px;display:flex;gap:6px;}',
      '#' + PANEL_ID + ' .sp-failed-item .f-btn{border:none;border-radius:6px;padding:5px 8px;font-size:12px;cursor:pointer;background:#546e7a;color:#fff;}',
      '#' + PANEL_ID + ' .sp-failed-item .f-btn.del{background:#b71c1c;}',
      '#' + PANEL_ID + ' .sp-empty{color:#999;font-size:12px;padding:6px 0;}',
      // [UI] 樹木詳情頁（t.html）：頂欄 Flex（返回按鈕左、同步按鈕右，與下方白卡齊平）
      '.sync-topbar{display:flex;justify-content:space-between;align-items:center;width:100%;margin-bottom:12px;}',
      '.sync-topbar a.back{margin-bottom:0;}',
      '#' + BADGE_ID + '.compact{position:static;right:auto;bottom:auto;display:inline-flex;width:auto;margin:0;padding:6px 12px;font-size:13px;box-shadow:none;vertical-align:middle;white-space:nowrap;flex-shrink:0;}',
      '#' + BADGE_ID + '.in-drawer{position:static;right:auto;bottom:auto;display:flex;width:100%;justify-content:center;margin:0;padding:8px 12px;font-size:13px;border-radius:8px;box-shadow:none;}',
      '#' + PANEL_ID + '.compact-panel{bottom:auto;top:56px;}',
      // [UI] 電腦版地圖頁：同步按鈕上移，避開右下角 Tree Status 圖例
      '@media (min-width: 601px){#' + BADGE_ID + ':not(.compact){bottom:96px;} #' + PANEL_ID + ':not(.compact-panel){bottom:156px;}}',
      // [UI] 電腦版（≥769px）地圖頁：同步按鈕獨立固定在右下、Tree Status 圖例正上方
      '@media (min-width: 769px){#' + BADGE_ID + '.desktop-fixed{right:10px;bottom:96px;}}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }
  // [UI] 樹木詳情頁：等 t.js 異步 render 出 .back 後，包成 Flex 頂欄（返回按鈕左、同步按鈕右）
  function mountTreeBadge(badge) {
    var app = document.getElementById('app');
    if (!app) { document.body.appendChild(badge); return; }
    var done = false;
    var attempt = function () {
      var back = app.querySelector('a.back');
      if (back && !done) {
        done = true;
        var topbar = document.createElement('div');
        topbar.className = 'sync-topbar';
        back.parentNode.insertBefore(topbar, back);
        topbar.appendChild(back);
        topbar.appendChild(badge);
      }
    };
    var mo = new MutationObserver(attempt);
    mo.observe(app, { childList: true, subtree: true });
    attempt();
  }

  // [UI] 地圖頁：等 Leaflet 建立 .layerbar 後，將同步按鈕插入「新增樹木」按鈕下方
  function mountDrawerBadge(badge) {
    var done = false;
    var attempt = function () {
      var bar = document.querySelector('.layerbar');
      if (bar && !done) {
        done = true;
        var addTree = bar.querySelector('button[data-act="addTree"]');
        if (addTree) {
          addTree.parentNode.insertBefore(badge, addTree.nextSibling);
        } else {
          bar.appendChild(badge);
        }
        mo.disconnect();
      }
    };
    var mo = new MutationObserver(attempt);
    mo.observe(document.body, { childList: true, subtree: true });
    attempt();
  }

  function build() {
    injectStyles();

    var badge = document.createElement('button');
    badge.id = BADGE_ID;
    badge.setAttribute('type', 'button');
    badge.setAttribute('aria-label', '同步中心');
    badge.innerHTML = '<span>☁️ 同步</span><span class="bubble" id="syncBadgeBubble">…</span>';
    badge.addEventListener('click', toggle);

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML =
      '<div class="sp-head"><span>☁️ 同步中心</span><button type="button" class="sp-close" id="syncPanelClose">✖</button></div>' +
      '<div class="sp-body">' +
      '  <div class="sp-row"><span>狀態</span><b id="spStatus">…</b></div>' +
      '  <div class="sp-row"><span>待同步</span><b id="spPending">…</b></div>' +
      '  <div class="sp-row"><span>失敗</span><b id="spFailed">…</b></div>' +
      '  <div class="sp-row"><span>最後同步</span><span id="spLastSync" class="sp-muted">…</span></div>' +
      '  <div class="sp-actions">' +
      '    <button type="button" class="sp-btn" id="spSyncNow">🔄 立即同步</button>' +
      '    <button type="button" class="sp-btn sec" id="spRetryAll">🔁 重試全部失敗</button>' +
      '    <button type="button" class="sp-btn warn" id="spExport">📦 匯出失敗 JSON</button>' +
      '    <button type="button" class="sp-btn warn" id="spExportLog">🧾 匯出診斷記錄</button>' +
      '  </div>' +
      '  <div class="sp-failed" id="spFailedList"></div>' +
      '</div>';

    if (isTreePage()) {
      badge.classList.add('compact');
      panel.classList.add('compact-panel');
      document.body.appendChild(panel);
      mountTreeBadge(badge);
    } else {
      // [UI] 電腦版地圖頁：同步按鈕獨立固定在右下，不塞入左下工具列；
      //      手機版維持插入抽屜（in-drawer）不變。
      var isDesktop = window.matchMedia && window.matchMedia('(min-width: 769px)').matches;
      document.body.appendChild(panel);
      if (isDesktop) {
        badge.classList.add('desktop-fixed');
        document.body.appendChild(badge);
      } else {
        badge.classList.add('in-drawer');
        mountDrawerBadge(badge);
      }
    }

    _els = {
      bubble: badge.querySelector('#syncBadgeBubble'),
      panel: panel,
      status: document.getElementById('spStatus'),
      pending: document.getElementById('spPending'),
      failed: document.getElementById('spFailed'),
      lastSync: document.getElementById('spLastSync'),
      failedList: document.getElementById('spFailedList')
    };

    document.getElementById('syncPanelClose').addEventListener('click', close);
    document.getElementById('spSyncNow').addEventListener('click', doSyncNow);
    document.getElementById('spRetryAll').addEventListener('click', doRetryAll);
    document.getElementById('spExport').addEventListener('click', doExport);
    document.getElementById('spExportLog').addEventListener('click', doExportLog);
  }

  function toggle() {
    if (_els.panel.classList.contains('open')) close(); else open();
  }
  function open() { _els.panel.classList.add('open'); refresh(); }
  function close() { _els.panel.classList.remove('open'); }

  function fmtTime(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  async function refresh() {
    var items = [];
    try { items = await window.OfflineQueue.all(); } catch (e) { items = []; }

    var pending = 0, failed = 0, lastSync = 0, failedItems = [];
    items.forEach(function (it) {
      if (it.status === 'queued' || it.status === 'syncing') pending++;
      if (it.status === 'failed') { failed++; failedItems.push(it); }
      if (it.syncedAt && it.syncedAt > lastSync) lastSync = it.syncedAt;
    });

    if (_els.bubble) {
      _els.bubble.className = 'bubble';
      if (failed > 0) { _els.bubble.textContent = failed; _els.bubble.classList.add('err'); }
      else if (pending > 0) { _els.bubble.textContent = pending; _els.bubble.classList.add('warn'); }
      else { _els.bubble.textContent = '✓'; _els.bubble.classList.add('ok'); }
    }

    if (_els.status) _els.status.textContent = navigator.onLine ? '🟢 線上' : '🔴 離線';
    if (_els.pending) _els.pending.textContent = pending;
    if (_els.failed) _els.failed.textContent = failed;
    if (_els.lastSync) _els.lastSync.textContent = fmtTime(lastSync);

    renderFailedList(failedItems);
  }

  function renderFailedList(failedItems) {
    var list = _els.failedList;
    if (!list) return;
    list.textContent = '';
    if (!failedItems.length) {
      var empty = document.createElement('div');
      empty.className = 'sp-empty';
      empty.textContent = '✅ 沒有失敗記錄';
      list.appendChild(empty);
      return;
    }
    failedItems.forEach(function (it) {
      var item = document.createElement('div');
      item.className = 'sp-failed-item';

      var title = document.createElement('div');
      title.className = 'f-title';
      title.textContent = '[' + (it.type || 'unknown') + ']' + (it.tree_id ? ' 樹木 ' + it.tree_id : '');

      var err = document.createElement('div');
      err.className = 'f-err';
      err.textContent = '錯誤：' + (it.lastError || '未知') + '｜retry ' + (it.retry || 0) + '｜' + fmtTime(it.updatedAt);

      var actions = document.createElement('div');
      actions.className = 'f-actions';

      var retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'f-btn';
      retryBtn.textContent = '重試';
      retryBtn.addEventListener('click', function () { doRetryOne(it.id); });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'f-btn del';
      delBtn.textContent = '刪除';
      delBtn.addEventListener('click', function () { doDelete(it.id); });

      actions.appendChild(retryBtn);
      actions.appendChild(delBtn);
      item.appendChild(title);
      item.appendChild(err);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }
  async function doSyncNow() {
    await window.syncNow();
    refresh();
  }

  async function doRetryOne(id) {
    var r = await window.OfflineQueue.retryOne(id);
    if (r && r.ok === false) { if (window.pwaToast) window.pwaToast('⚠️ ' + r.error); }
    refresh();
  }

  async function doRetryAll() {
    var n = await window.OfflineQueue.retryAllFailed();
    if (window.pwaToast) {
      window.pwaToast(navigator.onLine ? ('🔁 已重排 ' + n + ' 筆失敗記錄') : ('🔁 已重排 ' + n + ' 筆，連線後自動同步'));
    }
    refresh();
  }

  async function doDelete(id) {
    if (!confirm('確定刪除此失敗記錄？刪除後無法復原。')) return;
    await window.OfflineQueue.remove(id);
    refresh();
  }

  async function doExport() {
    var items = await window.OfflineQueue.all();
    var failed = items.filter(function (it) { return it.status === 'failed'; });
    if (!failed.length) { if (window.pwaToast) window.pwaToast('沒有失敗記錄可匯出'); return; }

    var data = failed.map(function (it) {
      var p = {};
      try { p = JSON.parse(JSON.stringify(it.payload || {})); } catch (e) { p = {}; }
      if ('token' in p) delete p.token;
      if ('photo_base64' in p) p.photo_base64 = '[已省略 base64 相片資料]';
      return {
        id: it.id,
        client_id: it.client_id,
        type: it.type,
        tree_id: it.tree_id,
        project_id: it.project_id,
        status: it.status,
        retry: it.retry,
        lastError: it.lastError,
        createdAt: it.createdAt,
        updatedAt: it.updatedAt,
        syncedAt: it.syncedAt,
        payload: p
      };
    });

    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'sync-failed-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function doExportLog() {
    if (typeof window.AuditLog === 'undefined') { if (window.pwaToast) window.pwaToast('⚠️ 診斷記錄未啟用'); return; }
    var n = window.AuditLog.exportJSON();
    if (window.pwaToast) window.pwaToast('🧾 已匯出 ' + n + ' 筆診斷記錄');
  }

  function startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(function () {
      if (!document.hidden) refresh();
    }, POLL_INTERVAL);
  }

  function init() {
    build();
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    startPolling();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

