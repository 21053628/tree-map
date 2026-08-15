/**
 * 樹木管理系統 - GPS 定位模組 [Phase1]
 * - locateOnce：一次性定位並飛到位置（含多點採樣＋中位數過濾＋精度門檻）
 * - toggleGeolocation：開啟／關閉持續追蹤（含即時精度顯示）
 *
 * 精準度改善（方案 A）：
 * 1. maximumAge: 0   → 強制攞全新 fix，唔用舊定位
 * 2. CALIBRATION_TIMEOUT: 25000 → 加長等待，等收多啲衛星
 * 3. 多點採樣＋中位數過濾 → 一班 sample 取中位數，剔走異常大誤差點
 * 4. MIN_ACCURACY 門檻 → 等到精度夠先鎖定，否則顯示「等緊」
 */
import { state } from './state.js';
import { updateStatus } from './dom.js';

let watchId = null;
let finishTimer = null;

// 採樣參數
const SAMPLE_COUNT = 8;           // 最多採樣點數
const MIN_ACCURACY = 5;           // 精準度門檻（米）
const CALIBRATION_TIMEOUT = 25000; // 最長校准時間（毫秒）

// 採樣緩衝＋目前最佳定位
const samples = [];
let continuousMode = false;

// 🔥 修復：精準度圓圈專用 SVG renderer（否則用 map 預設 Canvas renderer，
// 會生成覆蓋全視窗嘅 canvas 並食晒點擊，令下方樹木撳唔到）
let circleRenderer = null;
function getCircleRenderer() {
  if (!circleRenderer) {
    circleRenderer = L.svg();
  }
  return circleRenderer;
}

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
      fillColor: '#1e88e5', fillOpacity: 0.08, interactive: false,
      renderer: getCircleRenderer()
    }).addTo(state.map);
  }
  if (fly) {
    state.map.flyTo([lat, lng], Math.max(state.map.getZoom(), 18), { duration: 0.8 });
  }
}

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort(function (a, b) { return a - b; });
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// 由採樣池計算「穩定位置」：剔走異常大誤差點後取中位數
function computeStable() {
  let pool = samples;
  if (samples.length >= 4) {
    const accMed = median(samples.map(function (s) { return s.acc; }));
    const filtered = samples.filter(function (s) { return s.acc <= accMed * 2; });
    if (filtered.length) pool = filtered;
  }
  const lat = median(pool.map(function (s) { return s.lat; }));
  const lng = median(pool.map(function (s) { return s.lng; }));
  const acc = Math.min.apply(null, pool.map(function (s) { return s.acc; }));
  return { lat: lat, lng: lng, acc: acc };
}

function stopWatch() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (finishTimer !== null) {
    clearTimeout(finishTimer);
    finishTimer = null;
  }
}

function lockBest(fly) {
  stopWatch();
  if (samples.length) {
    const stable = computeStable();
    drawPosition(stable.lat, stable.lng, stable.acc, fly);
    updateStatus('✅ 已定位（精準度 ±' + Math.round(stable.acc) + ' m）');
  } else {
    updateStatus('❌ 定位失敗（收唔到有效訊號）');
  }
}

function addSample(pos, flyNow) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const acc = pos.coords.accuracy || 0;
  if (!isFinite(lat) || !isFinite(lng) || !acc) return;

  samples.push({ lat: lat, lng: lng, acc: acc });
  const stable = computeStable();
  drawPosition(stable.lat, stable.lng, stable.acc, flyNow);

  if (stable.acc <= MIN_ACCURACY) {
    updateStatus('📡 定位中（±' + Math.round(stable.acc) + ' m）✅ 已達目標精度');
  } else {
    updateStatus('📡 定位中（±' + Math.round(stable.acc) + ' m）… 請企定，遠離樹冠／高牆');
  }

  // 一次性定位：精度夠／收夠 sample 就鎖定（持續追蹤則唔鎖，等用家手動停止）
  if (!continuousMode && (stable.acc <= MIN_ACCURACY || samples.length >= SAMPLE_COUNT)) {
    lockBest(true);
  }
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
  stopWatch();
  samples.length = 0;
  continuousMode = false;
  updateStatus('📡 定位中… 請舉高手機、遠離樹冠、企定等 10–25 秒');

  navigator.geolocation.getCurrentPosition(
    function (p) { addSample(p, true); },
    onError,
    { enableHighAccuracy: true, timeout: CALIBRATION_TIMEOUT, maximumAge: 0 }
  );

  watchId = navigator.geolocation.watchPosition(
    function (p) { addSample(p, false); },
    onError,
    { enableHighAccuracy: true, timeout: CALIBRATION_TIMEOUT, maximumAge: 0 }
  );

  // 超時後備：時間到就用目前最佳定位，唔會鎖死喺「等緊」
  finishTimer = setTimeout(function () {
    lockBest(true);
  }, CALIBRATION_TIMEOUT);
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
  samples.length = 0;
  continuousMode = true;
  updateStatus('📡 開始追蹤位置… 請舉高手機、遠離樹冠');

  navigator.geolocation.getCurrentPosition(
    function (p) { addSample(p, true); },
    onError,
    { enableHighAccuracy: true, timeout: CALIBRATION_TIMEOUT, maximumAge: 0 }
  );

  watchId = navigator.geolocation.watchPosition(
    function (p) { addSample(p, false); },
    onError,
    { enableHighAccuracy: true, timeout: CALIBRATION_TIMEOUT, maximumAge: 0 }
  );
}

export function stopGeolocation() {
  stopWatch();
  samples.length = 0;
  continuousMode = false;
}