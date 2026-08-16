/**
 * 樹木管理系統 - 本地診斷／審計記錄 (Phase 6)
 * 純 plain script（IIFE），暴露 window.AuditLog
 * 記錄：time / action / type / tree_id / project_id / staff / status / error / online / userAgent
 * 用 localStorage 環形緩衝（上限 MAX_ENTRIES），關閉分頁仍保留
 */
(function () {
  'use strict';

  var KEY = 'tree_audit_log';
  var MAX_ENTRIES = 400;

  function _read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function _write(arr) {
    try {
      if (arr.length > MAX_ENTRIES) arr = arr.slice(arr.length - MAX_ENTRIES);
      localStorage.setItem(KEY, JSON.stringify(arr));
    } catch (e) {
      // localStorage 滿：清走一半再試
      try {
        arr = arr.slice(Math.floor(arr.length / 2));
        localStorage.setItem(KEY, JSON.stringify(arr));
      } catch (e2) {}
    }
  }

  function log(entry) {
    entry = entry || {};
    var rec = {
      time: new Date().toISOString(),
      action: entry.action || 'unknown',
      type: entry.type || null,
      tree_id: entry.tree_id || null,
      project_id: entry.project_id || null,
      staff: entry.staff || null,
      status: entry.status || null,
      error: entry.error || null,
      online: (typeof navigator !== 'undefined') ? navigator.onLine : null,
      userAgent: (typeof navigator !== 'undefined') ? navigator.userAgent : ''
    };
    var arr = _read();
    arr.push(rec);
    _write(arr);
    return rec;
  }

  function getAll() {
    return _read();
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  function exportJSON() {
    var arr = _read();
    var blob = new Blob([JSON.stringify(arr, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'audit-log-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return arr.length;
  }

  window.AuditLog = {
    log: log,
    getAll: getAll,
    clear: clear,
    exportJSON: exportJSON
  };
})();
