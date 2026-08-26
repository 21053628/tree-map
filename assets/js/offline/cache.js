/** localStorage response cache and cache invalidation policy. */
import { CACHE_KEY_PREFIX, CACHE_MAX_AGE } from './config.js';
  // ========== 快取（localStorage） ==========
  // 🔥 [Bugfix] key 用排序後嘅 params 建構，與 ApiService memory cache（api.js）一致，
  // 避免 URLSearchParams/JSON.stringify 因 params 順序唔同而 cache miss 或重複存儲
  function buildCacheKey(action, params) {
    if (!params) return action;
    var keys = Object.keys(params).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var v = params[keys[i]];
      parts.push(keys[i] + '=' + encodeURIComponent(v === undefined || v === null ? '' : String(v)));
    }
    return action + '?' + parts.join('&');
  }

  function setCache(action, params, data) {
    try {
      var key = buildCacheKey(action, params);
      localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify({ data: data, ts: Date.now() }));
    } catch (e) { /* intentionally ignored: optional fallback failure */ }
  }

  function getCache(action, params) {
    try {
      var key = buildCacheKey(action, params);
      var raw = localStorage.getItem(CACHE_KEY_PREFIX + key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > CACHE_MAX_AGE) {
        localStorage.removeItem(CACHE_KEY_PREFIX + key);
        return null;
      }
      return parsed.data;
    } catch (e) { return null; }
  }

  function clearCache(action) {
    if (action) {
      // 清除該 action 的所有快取（因為可能有多種 params）
      // 🔥 [Bugfix] 用「action + '?'」做分隔，避免 prefix 誤殺（如 'trees' 誤匹配 'treeshot'）
      const exactKey = CACHE_KEY_PREFIX + action;
      const paramPrefix = CACHE_KEY_PREFIX + action + '?';
      Object.keys(localStorage).forEach(function(k) {
        if (k === exactKey || k.indexOf(paramPrefix) === 0) localStorage.removeItem(k);
      });
    } else {
      Object.keys(localStorage).forEach(function(k) {
        if (k.indexOf(CACHE_KEY_PREFIX) === 0) localStorage.removeItem(k);
      });
    }
  }

  // 🔥 [Bugfix] 寫入成功後精準失效 localStorage 快取（對應 ApiService.invalidateCache 的 prefix 邏輯），
  // 不再無差別清空全部離線快取。
  function clearCacheForType(type) {
    var prefixes = [];
    if (type === 'inspection' || type === 'inspection_photo' || type === 'checkin') {
      prefixes = ['inspections', 'trees', 'bootstrap'];
    } else if (type === 'create_project' || type === 'update_project' || type === 'delete_project') {
      prefixes = ['projects', 'trees', 'bootstrap'];
    } else if (type === 'create_tree' || type === 'update_tree' || type === 'delete_tree') {
      prefixes = ['trees', 'bootstrap'];
    } else if (type === 'create_aerial') {
      prefixes = ['aerials'];
    } else if (type) {
      prefixes = [type];
    }
    prefixes.forEach(function(prefix) { clearCache(prefix); });
  }

export { buildCacheKey, setCache, getCache, clearCache, clearCacheForType };
