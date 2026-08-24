/**
 * UI SVG Icon 系統（零依賴，plain script）
 * - window.Icon.icon('name') 回傳 <svg><use href="#icon-name"></use></svg>
 * - 使用前先喺 HTML 引入 assets/icons/sprite.svg（<link rel="preload"> 或 <object>）
 */
(function (g) {
  'use strict';
  var CACHE = {};
  var loaded = false;

  // 惰性注入 sprite（僅需要時才 append，避免額外請求）
  function ensureSprite() {
    if (loaded || typeof document === 'undefined') return;
    loaded = true;
    if (document.getElementById('icon-sprite')) return;
    var item = document.createElement('link');
    item.id = 'icon-sprite';
    item.rel = 'preload';
    item.as = 'image';
    item.href = 'assets/icons/sprite.svg';
    document.head.appendChild(item);
  }

  function icon(name, cls) {
    ensureSprite();
    if (CACHE[name]) return CACHE[name];
    var svg = '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false">' +
      '<use href="#icon-' + name + '"></use></svg>';
    CACHE[name] = svg;
    return svg;
  }

  g.Icon = { icon: icon, ensureSprite: ensureSprite };
})(typeof globalThis !== 'undefined' ? globalThis : this);