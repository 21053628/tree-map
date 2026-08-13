/**
 * 樹木管理系統 - GPS 定位模組 [Phase1]
 * - locateOnce：一次性定位並飛到位置
 * - toggleGeolocation：開啟／關閉持續追蹤
 */
import { state } from './state.js';
import { updateStatus } from './dom.js';

let watchId = null;

function dotIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="geo-dot"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });
}

function clearMarker() {
  if (state.geolocation.marker) {
    state.map.removeLayer(state.geolocation.marker);
    state.geolocation.marker = null;
  }
  if (state.geolocation.circle) {
    state.map.removeLayer(state.geolocation.circle);
    state.geolocation.circle = null;
  }
}

function drawPosition(lat, lng, accuracy, fly) {
  clearMarker();
  state.geolocation.marker = L.marker([lat, lng], {
    icon: dotIcon(),
    interactive: false,
    zIndexOffset: 500
  }).addTo(state.map);
  if (accuracy) {
    state.geolocation.circle = L.circle([lat, lng], {
      radius: accuracy, color: '#1e88e5', weight: 1,
      fillColor: '#1e88e5', fillOpacity: 0.08, interactive: false
    }).addTo(state.map);
  }
  if (fly) {
    state.map.flyTo([lat, lng], Math.max(state.map.getZoom(), 18), { duration: 0.8 });
  }
}

function onSuccess(pos, fly) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const acc = pos.coords.accuracy || 0;
  drawPosition(lat, lng, acc, fly);
  updateStatus('📍 已定位（精準度 ±' + Math.round(acc) + ' m）');
}

function onError(err) {
  const msg = {
    1: '❌ 定位被拒絕（請喺瀏覽器允許位置權限）',
    2: '❌ 定位失敗（訊號不佳）',
    3: '❌ 定位超時'
  };
  updateStatus(msg[err.code] || ('❌ 定位失敗：' + err.message));
}

export function locateOnce() {
  if (!('geolocation' in navigator)) { updateStatus('❌ 呢部機唔支援定位'); return; }
  updateStatus('📡 定位中…');
  navigator.geolocation.getCurrentPosition(
    function (p) { onSuccess(p, true); },
    onError,
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
  );
}

export function toggleGeolocation(btn) {
  if (watchId !== null) {
    stopGeolocation();
    if (btn) btn.classList.remove('on');
    updateStatus('✅ 已停止追蹤位置');
    return;
  }
  if (!('geolocation' in navigator)) { updateStatus('❌ 呢部機唔支援定位'); return; }
  if (btn) btn.classList.add('on');
  updateStatus('📡 開始追蹤位置…');
  navigator.geolocation.getCurrentPosition(
    function (p) { onSuccess(p, true); },
    onError,
    { enableHighAccuracy: true, timeout: 12000 }
  );
  watchId = navigator.geolocation.watchPosition(
    function (p) { onSuccess(p, false); },
    onError,
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
  );
}

export function stopGeolocation() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}
