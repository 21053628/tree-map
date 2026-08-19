import { escapeHtml, sanitizeId } from '../core/utils.js';

// 依賴：config.js（Config）維持 plain script 全域
const API = (typeof Config !== 'undefined' && Config.API_ENDPOINT)
  ? Config.API_ENDPOINT
  : '';

const TAG_CAPACITY = { '213': 144, '215': 504, '216': 888 };
const TAG_LABELS = { '213': 'NTAG213', '215': 'NTAG215', '216': 'NTAG216' };

let currentURL = '';
let sourceTreeId = '';
let sourcePrj = '';
let ndef = null;
let abortController = null;

// 頁面載入時自動處理
window.addEventListener('DOMContentLoaded', function() {
  const params = new URLSearchParams(location.search);
  const urlParam = params.get('url');
  const backParam = params.get('back');

  // 設定返回按鈕
  const backBtn = document.getElementById('backBtn');
  if (backParam) {
    backBtn.href = backParam;
  } else if (document.referrer && document.referrer.indexOf('t.html') !== -1) {
    backBtn.href = document.referrer;
  } else {
    backBtn.style.display = 'none';
  }

  // 渲染寫入歷史
  renderHistory();

  // 自動匯入 URL 參數
  if (urlParam) {
    autoImportFromURL(urlParam);
  }

  // 綁定事件監聽器（移除 inline onclick）
  document.getElementById('generateBtn').addEventListener('click', generateURL);
  document.getElementById('tabWeb').addEventListener('click', function() { switchTab('web'); });
  document.getElementById('tabManual').addEventListener('click', function() { switchTab('manual'); });
  document.getElementById('writeNfcBtn').addEventListener('click', writeNFC);
  document.getElementById('cancelNfcBtn').addEventListener('click', cancelNFC);
  document.getElementById('readNfcBtn').addEventListener('click', readNFC);
  document.getElementById('copyBtn').addEventListener('click', copyURL);
  document.getElementById('testJumpBtn').addEventListener('click', testJump);
  document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);
  document.getElementById('tagType').addEventListener('change', updateCapacityHint);
  document.getElementById('backBtn').addEventListener('click', goBack);
});

// 由 t.html 跳轉過來，自動填入樹木資訊
function autoImportFromURL(url) {
  try {
    const u = new URL(url);
    const p = u.searchParams;

    // 支援兩種參數名（舊版 tree_id / 新版 id）
    const tid = sanitizeId(p.get('tree_id') || p.get('id') || '');
    const pid = sanitizeId(p.get('project_id') || p.get('prj') || '');

    if (tid) {
      document.getElementById('treeId').value = tid;
      if (pid) document.getElementById('projectId').value = pid;

      sourceTreeId = tid;
      sourcePrj = pid;

      document.getElementById('autoImportBanner').style.display = 'block';

      // 自動產生 URL
      generateURL(true);
    }
  } catch (err) {
    console.error('autoImport 失敗:', err);
  }
}

function goBack(e) {
  const href = document.getElementById('backBtn').href;
  if (href && href !== '#') {
    e.preventDefault();
    location.href = href;
    return false;
  }
  if (history.length > 1) {
    e.preventDefault();
    history.back();
    return false;
  }
  return true;
}

function generateURL(silent) {
  const treeId = sanitizeId(document.getElementById('treeId').value.trim());
  const projectId = sanitizeId(document.getElementById('projectId').value.trim());

  if (!treeId) {
    alert('⚠️ 樹木編號格式不正確（只可用英數、點、底線、連字號）');
    return;
  }

  const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
  let url = baseUrl + 'index.html?tree_id=' + encodeURIComponent(treeId);

  if (projectId) {
    url += '&project_id=' + encodeURIComponent(projectId);
  }

  currentURL = url;
  document.getElementById('urlText').textContent = url;
  document.getElementById('resultCard').style.display = 'block';

  if (!silent) {
    document.getElementById('resultCard').scrollIntoView({ behavior: 'smooth' });
  }

  // 載入樹木預覽
  loadTreePreview(treeId, projectId);

  // 更新容量提示
  updateCapacityHint();

  // 檢查 Web NFC 支援
  checkNfcSupport();
}

// 由後端 fetch 樹木資料做預覽
async function loadTreePreview(treeId, projectId) {
  const preview = document.getElementById('treePreview');
  try {
    const r = await fetch(API + '?action=tree&id=' + encodeURIComponent(treeId) + '&prj=' + encodeURIComponent(projectId || ''));
    const res = await r.json();

    if (res && res.data) {
      const t = res.data;
      document.getElementById('previewId').textContent = '🆔 ' + (t.tree_id || treeId);
      document.getElementById('previewName').textContent = '🌳 ' + (t.name || '(未設定樹種)');
      document.getElementById('previewPrj').textContent = t.project_id ? '🚩 地盤：' + t.project_id : '(不屬於任何地盤)';
      preview.style.display = 'block';
    } else {
      // API 找不到，只顯示 ID
      document.getElementById('previewId').textContent = '🆔 ' + treeId;
      document.getElementById('previewName').textContent = '⚠️ 樹木資料載入失敗';
      document.getElementById('previewPrj').textContent = projectId ? '🚩 地盤：' + projectId : '';
      preview.style.display = 'block';
    }
  } catch (err) {
    console.error('loadTreePreview error:', err);
    preview.style.display = 'none';
  }
}

function switchTab(tab) {
  document.getElementById('tabWeb').classList.toggle('active', tab === 'web');
  document.getElementById('tabManual').classList.toggle('active', tab === 'manual');
  document.getElementById('panelWeb').classList.toggle('active', tab === 'web');
  document.getElementById('panelManual').classList.toggle('active', tab === 'manual');
}

// 查詢字串的 UTF-8 位元組長度
function getByteLength(str) {
  return new TextEncoder().encode(str).length;
}

// 更新容量提示
function updateCapacityHint() {
  const hint = document.getElementById('capacityHint');
  if (!hint) return;
  if (!currentURL) { hint.textContent = ''; return; }

  const tagType = document.getElementById('tagType').value;
  const capacity = TAG_CAPACITY[tagType] || 504;
  const overhead = 12; // NDEF 記錄標頭開銷
  const total = getByteLength(currentURL) + overhead;

  if (total > capacity) {
    hint.className = 'capacity-hint warn';
    hint.textContent = '⚠️ 約需 ' + total + ' bytes，超出 ' + TAG_LABELS[tagType] + '（' + capacity + ' bytes），請改用更高容量標籤或縮短地盤代碼';
  } else {
    hint.className = 'capacity-hint';
    hint.textContent = '✅ 約需 ' + total + ' bytes，' + TAG_LABELS[tagType] + ' 容量（' + capacity + ' bytes）足夠';
  }
}

// 檢查 Web NFC 支援
function checkNfcSupport() {
  const status = document.getElementById('nfcSupportStatus');
  const btn = document.getElementById('writeNfcBtn');
  const readBtn = document.getElementById('readNfcBtn');
  const hint = document.getElementById('nfcHint');

  if (!('NDEFReader' in window)) {
    status.className = 'status warn';
    status.innerHTML = '❌ 此瀏覽器不支援 Web NFC<br><small>請使用 Android Chrome，或改用「手動複製」分頁</small>';
    status.style.background = '#fff3e0';
    status.style.color = '#e65100';
    btn.disabled = true;
    readBtn.disabled = true;
    hint.style.display = 'block';
    // 自動切換去手動 tab
    switchTab('manual');
    return;
  }

  // 檢查是否 HTTPS
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    status.className = 'status';
    status.style.background = '#fff3e0';
    status.style.color = '#e65100';
    status.innerHTML = '⚠️ Web NFC 需要 HTTPS 環境<br><small>請使用正式域名（例如 GitHub Pages）</small>';
    btn.disabled = true;
    readBtn.disabled = true;
    hint.style.display = 'block';
    return;
  }

  status.className = 'status success';
  status.innerHTML = '✅ 支援 Web NFC — 可以一鍵即寫！';
  btn.disabled = false;
  readBtn.disabled = false;
  hint.style.display = 'none';
}

// NFC 錯誤分類
function classifyNfcError(err) {
  const messages = {
    'NotAllowedError': '未取得 NFC 權限，請在瀏覽器設定中允許 NFC',
    'NotSupportedError': '標籤不支援 NDEF 格式，或容量不足（請確認使用 NTAG213/215/216）',
    'NotReadableError': '無法讀取標籤，請移開後重新靠近',
    'NetworkError': '找不到 NFC 裝置，請確認手機已開啟 NFC',
    'InvalidStateError': '已有進行中的 NFC 操作，請稍後再試'
  };
  if (messages[err.name]) return messages[err.name];
  return err.message || String(err);
}

// Web NFC 直寫
async function writeNFC() {
  if (!currentURL) return;

  const status = document.getElementById('nfcStatus');
  const btn = document.getElementById('writeNfcBtn');
  const cancelBtn = document.getElementById('cancelNfcBtn');

  // 容量檢查
  const tagType = document.getElementById('tagType').value;
  const capacity = TAG_CAPACITY[tagType] || 504;
  const overhead = 12;
  const totalBytes = getByteLength(currentURL) + overhead;

  if (totalBytes > capacity) {
    status.style.display = 'block';
    status.className = 'status error';
    status.innerHTML = '❌ <strong>URL 太長</strong><br><small>約需 ' + totalBytes + ' bytes，超出 ' + TAG_LABELS[tagType] + ' 容量（' + capacity + ' bytes）。請改用更高容量標籤或縮短地盤代碼</small>';
    return;
  }

  // 鎖定確認
  const lock = document.getElementById('lockTag').checked;
  if (lock) {
    const ok = confirm('⚠️ 寫入後將鎖定標籤為唯讀（不可逆），確定繼續？');
    if (!ok) return;
  }

  status.style.display = 'block';
  status.className = 'status writing';
  status.innerHTML = '📡 <strong>等待 NFC 標籤...</strong><br><small>請將手機背面靠近 NFC 標籤（通常在相機附近）</small>';

  btn.classList.add('ready');
  btn.textContent = '📡 等待中...（靠近標籤）';
  btn.disabled = true;
  cancelBtn.style.display = 'block';

  try {
    // 取消上次操作（如果有）
    if (abortController) abortController.abort();
    abortController = new AbortController();

    ndef = new NDEFReader();

    await ndef.write(
      {
        records: [
          {
            recordType: 'url',
            data: currentURL
          }
        ]
      },
      { signal: abortController.signal }
    );

    // 鎖定為唯讀
    if (lock && typeof ndef.makeReadOnly === 'function') {
      await ndef.makeReadOnly({ signal: abortController.signal });
    }

    status.className = 'status success';
    status.innerHTML = '✅ <strong>寫入成功！</strong>' +
      (lock
        ? '<br><small>標籤已鎖定為唯讀</small>'
        : '<br><small>NFC 標籤已寫入，任何手機靠近都會自動開啟樹木頁面</small>');

    // 記錄寫入歷史
    addHistory(document.getElementById('treeId').value.trim(), currentURL);

    // 播放成功提示音（如果有）
    try { navigator.vibrate && navigator.vibrate(200); } catch(e) {}

    btn.classList.remove('ready');
    btn.textContent = '✅ 完成！按這裡寫下一張';
    btn.disabled = false;
    cancelBtn.style.display = 'none';

  } catch (err) {
    cancelBtn.style.display = 'none';
    btn.classList.remove('ready');
    btn.textContent = '📡 按一下 → 手機靠近 NFC 標籤';
    btn.disabled = false;

    if (err.name === 'AbortError') {
      status.style.display = 'none';
      return;
    }

    status.className = 'status error';
    status.innerHTML = '❌ <strong>寫入失敗</strong><br><small>' + escapeHtml(classifyNfcError(err)) + '</small>';
    console.error('NFC write error:', err);
  }
}

// 取消寫入
function cancelNFC() {
  if (abortController) abortController.abort();
}

// 讀取標籤內容
async function readNFC() {
  if (!('NDEFReader' in window)) return;

  const status = document.getElementById('nfcStatus');
  const btn = document.getElementById('readNfcBtn');

  status.style.display = 'block';
  status.className = 'status writing';
  status.innerHTML = '📡 <strong>等待標籤...</strong><br><small>請將手機靠近要讀取的 NFC 標籤</small>';

  btn.disabled = true;

  try {
    const reader = new NDEFReader();
    await reader.scan();

    reader.onreading = ({ message }) => {
      const found = decodeNdefMessage(message);
      status.className = 'status success';
      if (found) {
        status.innerHTML = '✅ <strong>讀取成功</strong><br><small>' + escapeHtml(found) + '</small>';
      } else {
        status.innerHTML = '✅ <strong>標籤為空白</strong><br><small>此標籤尚未寫入任何內容</small>';
      }
      btn.disabled = false;
    };

    reader.onreadingerror = () => {
      status.className = 'status error';
      status.innerHTML = '❌ <strong>讀取失敗</strong><br><small>無法讀取標籤</small>';
      btn.disabled = false;
    };

  } catch (err) {
    btn.disabled = false;
    status.className = 'status error';
    status.innerHTML = '❌ <strong>讀取失敗</strong><br><small>' + escapeHtml(classifyNfcError(err)) + '</small>';
    console.error('NFC read error:', err);
  }
}

// 解碼 NDEF 訊息（優先回傳 URL）
function decodeNdefMessage(message) {
  const decoder = new TextDecoder();
  const URL_PREFIXES = {
    0x00: '',
    0x01: 'http://www.',
    0x02: 'https://www.',
    0x03: 'http://',
    0x04: 'https://',
    0x05: 'tel:',
    0x06: 'mailto:'
  };

  let result = '';
  for (const record of message.records) {
    const data = record.data; // DataView
    if (record.recordType === 'url') {
      const prefixByte = data.getUint8(0);
      const prefix = URL_PREFIXES[prefixByte] || '';
      const rest = decoder.decode(new Uint8Array(data.buffer, data.byteOffset + 1, data.byteLength - 1));
      return prefix + rest;
    } else if (record.recordType === 'text') {
      const statusByte = data.getUint8(0);
      const langLen = statusByte & 0x3F;
      const text = decoder.decode(new Uint8Array(data.buffer, data.byteOffset + 1 + langLen, data.byteLength - 1 - langLen));
      if (text) result = text;
    } else if (record.recordType === 'mime' || record.recordType === 'empty') {
      // 略過
    }
  }
  return result;
}

// 寫入歷史
function addHistory(treeId, url) {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('nfc_history') || '[]');
  } catch (e) { history = []; }

  history.unshift({
    id: treeId,
    url: url,
    time: new Date().toLocaleString('zh-HK')
  });
  history = history.slice(0, 20);

  localStorage.setItem('nfc_history', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const card = document.getElementById('historyCard');
  const list = document.getElementById('historyList');
  if (!card || !list) return;

  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('nfc_history') || '[]');
  } catch (e) { history = []; }

  if (history.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  list.innerHTML = history.map(function(h) {
    return '<li class="history-item"><span class="h-id">🆔 ' + escapeHtml(h.id) + '</span><span class="h-time">' + escapeHtml(h.time) + '</span></li>';
  }).join('');
}

function clearHistory() {
  if (!confirm('確定清除所有寫入歷史？')) return;
  localStorage.removeItem('nfc_history');
  renderHistory();
}

function copyURL() {
  if (!currentURL) return;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(currentURL).then(function() {
      showCopySuccess();
    }).catch(function() {
      fallbackCopy();
    });
  } else {
    fallbackCopy();
  }
}

function fallbackCopy() {
  const ta = document.createElement('textarea');
  ta.value = currentURL;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showCopySuccess();
  } catch (err) {
    alert('複製失敗，請手動長按文字複製');
  }
  document.body.removeChild(ta);
}

function showCopySuccess() {
  const btn = document.querySelector('.copy-btn');
  const orig = btn.textContent;
  btn.textContent = '✅ 已複製';
  btn.style.background = '#2e7d32';
  setTimeout(() => {
    btn.textContent = orig;
    btn.style.background = '';
  }, 1500);
}

function testJump() {
  if (currentURL) {
    window.location.href = currentURL;
  }
}

// 頁面離開時取消正在進行的 NFC 操作
window.addEventListener('beforeunload', function() {
  if (abortController) abortController.abort();
});