import { ApiService } from '../../api.js';
import { Config } from '../../config.js';
import { escapeHtml } from '../../core/utils.js';
import * as TDLogs from './td-logs.js';
import { initRoute, TD } from './route.js';
import { render, initMiniMap } from './view.js';
import { initTabs } from './tabs.js';

if (Config.API_ENDPOINT) {
  try { ApiService.init(Config.API_ENDPOINT); } catch (e) { /* intentionally ignored: optional fallback failure */ }
}
initRoute();


if (!TD.id) {
  const app = document.querySelector('#app');
  if (app) app.innerHTML = '<div class="card error">❌ 缺少樹木編號：請由地圖選擇樹木後再開啟此頁。</div>';
} else {
  ApiService.get('tree', { id: TD.id, prj: TD.prj })
    .then(function (res) {
      if (res && (res.error === 'OFFLINE' || res.offline)) {
        const app = document.querySelector('#app');
        if (app) app.innerHTML = '<div class="card error">📴 離線模式：暫無此樹木的快取資料，請連線後再試。</div>';
        return;
      }
      const t = res && res.data;
      if (!t) {
        const app = document.querySelector('#app');
        if (app) app.innerHTML = '<div class="card error">❌ 找不到樹木：<b>' + escapeHtml(TD.id) + '</b></div>';
        return;
      }
      TD.TREE = t;
      render(t).then(function () { initTabs(); });
      initMiniMap(t);
      TDLogs.loadLogs();
    })
    .catch(function (err) {
      console.error('Fetch error:', err);
      const app = document.querySelector('#app');
      if (app) app.innerHTML = '<div class="card error">❌ 後端連線失敗：<br>' + escapeHtml(err.message) + '</div>';
    });
}
