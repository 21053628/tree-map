import { escapeHtml } from '../../core/utils.js';
import * as TDLogs from './td-logs.js';
import { initRoute, TD } from './route.js';
import { render, initMiniMap } from './view.js';
import { initTabs } from './tabs.js';
import { staffMode } from './auth-gate.js';
import { checkin, submitInspection } from './inspection-controller.js';
import { saveTreeInfo } from './tree-edit-controller.js';
import { removePhoto } from './photo-controller.js';
import { initNfcNavigation } from './nfc-navigation.js';

// expose globals for auth-gate / HTML bindings
if (typeof ApiService !== 'undefined' && typeof Config !== 'undefined' && Config.API_ENDPOINT) {
  try { ApiService.init(Config.API_ENDPOINT); } catch (e) {}
}
initNfcNavigation();
initRoute();

// 提供 tabs 守衛所需的 staffMode，及 HTML 內按鈕綁定
globalThis.staffMode = staffMode;
globalThis.checkin = checkin;
globalThis.submitInspection = submitInspection;
globalThis.saveTreeInfo = saveTreeInfo;
globalThis.removePhoto = removePhoto;

// 讓 auth-gate 內的 staffMode 後建的按鈕綁定能找到 globalThis.checkin 等

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
