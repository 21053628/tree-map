/**
 * 地段索引圖層模組
 * - GML 解析
 * - DD/Lot 編號顯示
 * - LRU 快取
 * v2.49 - 修正 walk() 條件反轉 bug（之前跳過咗數據 tag，導致 popup 淨係顯示「私人地段」）
 *       - 標題對齊航拍圖格式：「Lot 533 J,1」
 */
import { state, LOT_CACHE_MAX } from './state.js';
import { $, escapeHtml, debounce, updateStatus } from './dom.js';

const GEOM_TAGS_ = [
  'polygon','multisurface','surface','surfacemember','exterior','interior',
  'linearring','poslist','pos','coordinates','point','curve','linestring',
  'patch','geometryproperty','geometry','multigeometry','boundedby','envelope'
];

function lotCacheSet(key, data) {
  if (state.lotCache.size >= LOT_CACHE_MAX) {
    const firstKey = state.lotCache.keys().next().value;
    state.lotCache.delete(firstKey);
  }
  state.lotCache.set(key, { data: data, timestamp: Date.now() });
}

function lotCacheGet(key) {
  const entry = state.lotCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > 15 * 60 * 1000) {
    state.lotCache.delete(key);
    return null;
  }
  return entry.data;
}

function extractLotAttrs_(poly) {
  const attrs = {};
  let node = poly;
  for (let up = 0; up < 6 && node; up++) {
    if (node.attributes && node.attributes.length) {
      for (let a = 0; a < node.attributes.length; a++) {
        const at = node.attributes[a];
        const nm = at.localName || at.name || '';
        const nml = nm.toLowerCase();
        const v = (at.value || '').trim();
        if (v && nml.indexOf('xmlns') === -1 && nml !== 'id' && GEOM_TAGS_.indexOf(nml) === -1) {
          if (!attrs[nm]) attrs[nm] = v;
        }
      }
    }
    if (!node.parentElement) break;
    node = node.parentElement;
    const ln = (node.localName || '').toLowerCase();
    if (ln === 'featuremember' || ln === 'featurecollection' || ln.indexOf('collection') !== -1) break;
  }

  // 🔥 [v2.49 修正] 條件反轉：跳過幾何 tag，收集數據 tag（之前寫反咗，導致屬性全部丟失）
  (function walk(el) {
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      const ln = (c.localName || '').toLowerCase();
      if (GEOM_TAGS_.indexOf(ln) !== -1) continue;   // ✅ 跳過幾何/boundedBy
      if (c.firstElementChild) { walk(c); continue; }
      const v = (c.textContent || '').trim();
      if (v && v.length < 200 && !attrs[c.localName]) attrs[c.localName] = v;
    }
  })(node);

  return attrs;
}

function parseGML(gmlText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(gmlText, 'text/xml');
  const polygons = [];
  const polygonElements = xmlDoc.getElementsByTagNameNS('*', 'Polygon');

  if (polygonElements.length > 0) {
    let feat = polygonElements[0];
    for (let up = 0; up < 4 && feat.parentElement; up++) feat = feat.parentElement;
    console.log('🗺️ [Lot GML Debug] Feature 樣本:\n' + (feat.outerHTML || '').slice(0, 2000));
  }

  for (let i = 0, len = polygonElements.length; i < len; i++) {
    const poly = polygonElements[i];
    const coords = [];

    const posList = poly.getElementsByTagNameNS('*', 'posList')[0];
    if (posList && posList.textContent) {
      const points = posList.textContent.trim().split(/\s+/);
      for (let j = 0, plen = points.length; j < plen; j += 2) {
        const e = parseFloat(points[j]);
        const n = parseFloat(points[j + 1]);
        if (!isNaN(e) && !isNaN(n)) {
          const wgs = CoordUtils.toWGS84(n, e);
          if (wgs) coords.push([wgs.lat, wgs.lng]);
        }
      }
    } else {
      const coordsEl = poly.getElementsByTagNameNS('*', 'coordinates')[0];
      if (coordsEl && coordsEl.textContent) {
        const points = coordsEl.textContent.trim().split(/\s+/);
        for (let j = 0, plen = points.length; j < plen; j++) {
          const parts = points[j].split(',');
          if (parts.length >= 2) {
            const e = parseFloat(parts[0]);
            const n = parseFloat(parts[1]);
            if (!isNaN(e) && !isNaN(n)) {
              const wgs = CoordUtils.toWGS84(n, e);
              if (wgs) coords.push([wgs.lat, wgs.lng]);
            }
          }
        }
      }
    }

    if (coords.length >= 3) {
      polygons.push({ coords: coords, attrs: extractLotAttrs_(poly) });
    }
  }

  return polygons;
}

// 🔥 [v2.48] 將原始 sublot 寫法清洗做航拍圖格式：「S.J ss.1」→「J,1」
function cleanSublot_(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^S\.\s*/i, '');        // 剷走開頭 "S."
  s = s.replace(/\s*ss\.?\s*/i, ',');   // " ss.1" → ",1"
  s = s.replace(/\s+/g, ',');           // 空格 → ","（"F RP" → "F,RP"）
  return s;
}

function buildLotPopup_(a) {
  const get = function () {
    for (let i = 0; i < arguments.length; i++) {
      const want = String(arguments[i]).toLowerCase();
      for (const key in a) {
        if (key.toLowerCase() === want) return a[key];
      }
    }
    return '';
  };
  const disp = get('cislotdisplayname') || get('lotnumber');
  const type = get('lottype');
  const sec = get('sectioncode');
  const updated = get('lastupdatedate');
  const lotid = get('lotid');

  // 🔥 [v2.48/49] 標題對齊航拍圖：「533 S.J ss.1」→「Lot 533 J,1」；「STTL 28」→「Lot STTL 28」
  let title = '';
  if (disp) {
    const m = String(disp).trim().match(/^([A-Za-z]*\s*\d+)\s*(.*)$/);
    const prefix = m ? m[1] : String(disp).trim();   // "533" 或 "STTL 28"
    const rest = m ? m[2] : '';                      // "S.J ss.1" 或 ""
    const sublot = sec || cleanSublot_(rest);
    title = 'Lot ' + prefix + (sublot ? ' ' + sublot : '');
  }

  let html = '';
  if (title) {
    html += '<b>🗺️ ' + escapeHtml(title) + '</b><br>';
  } else {
    html += '<b>🗺️ 私人地段</b><br>';
  }
  if (type) html += '類型：' + escapeHtml(type) + (sec ? '（' + escapeHtml(sec) + '）' : '') + '<br>';
  if (updated) html += '更新：' + escapeHtml(String(updated).slice(0, 10)) + '<br>';
  if (lotid) html += 'Lot ID：' + escapeHtml(lotid) + '<br>';

  return html || '<b>🗺️ 私人地段</b>';
}

// 🔥 [優化] 可中止 fetch：避開弱網長期掛住，失敗靜默降級（唔會噴 error 阻住 UI）
function fetchTimeout(url, timeout) {
  return new Promise((resolve, reject) => {
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const signal = controller ? controller.signal : null;
    const timer = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error('TIMEOUT'));
    }, timeout);
    const opts = {};
    if (signal) opts.signal = signal;
    fetch(url, opts).then((r) => { clearTimeout(timer); resolve(r); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

function renderLots(polygons) {
  state.lotLayer.clearLayers();
  const fragment = L.layerGroup();
  polygons.forEach((p) => {
    const polygon = L.polygon(p.coords, {
      color: '#1565c0',
      weight: 2,
      opacity: 0.7,
      fillColor: '#1565c0',
      fillOpacity: 0.1
    });
    polygon.bindPopup(buildLotPopup_(p.attrs || {}));
    fragment.addLayer(polygon);
  });
  fragment.addTo(state.lotLayer);
}

function loadLots() {
  if (!state.lotLayerEnabled || !state.map || state.map.getZoom() < 17) {
    state.lotLayer.clearLayers();
    return;
  }

  const bounds = state.map.getBounds();
  const sw = CoordUtils.toHK80(bounds.getSouth(), bounds.getWest());
  const ne = CoordUtils.toHK80(bounds.getNorth(), bounds.getEast());

  if (!sw || !ne) return;

  const minX = Math.floor(sw.E / 50) * 50;
  const minY = Math.floor(sw.N / 50) * 50;
  const maxX = Math.ceil(ne.E / 50) * 50;
  const maxY = Math.ceil(ne.N / 50) * 50;
  const bboxKey = `${minX},${minY},${maxX},${maxY}`;

  const cached = lotCacheGet(bboxKey);
  if (cached) {
    state.perfMetrics.cacheHits++;
    renderLots(cached);
    return;
  }

  const url = `https://mapapi.geodata.gov.hk/gs/api/v1.0.0/iC1000/lot?bbox=${minX},${minY},${maxX},${maxY},EPSG:2326`;

  fetchTimeout(url, 8000)
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then((gmlText) => {
      const polygons = parseGML(gmlText);
      lotCacheSet(bboxKey, polygons);
      renderLots(polygons);
    })
    .catch((err) => {
      if (err && err.message !== 'TIMEOUT') console.warn('⚠️ 載入地段索引失敗:', err && err.message);
    });
}

// 防抖版
const debouncedLoadLots = debounce(loadLots, 500);

export function toggleLotLayer() {
  state.lotLayerEnabled = !state.lotLayerEnabled;

  if (state.lotLayerEnabled) {
    state.lotLayer.addTo(state.map);
    loadLots();
    state.map.on('moveend', debouncedLoadLots);
    updateStatus('✅ 已開啟地段索引圖層');
  } else {
    state.map.removeLayer(state.lotLayer);
    state.map.off('moveend', debouncedLoadLots);
    state.lotLayer.clearLayers();
    updateStatus('✅ 已關閉地段索引圖層');
  }

  const btn = document.querySelector('.layerbar button[data-l="lot"]');
  if (btn) btn.classList.toggle('on', state.lotLayerEnabled);
}

export function clearLotCache() {
  state.lotCache.clear();
}