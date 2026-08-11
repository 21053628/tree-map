/**
 * 樹種清單模組：Promise 去重 + 快取 + 失敗可重試
 */
import { state } from './state.js';

export function loadTreeSpecies() {
  if (state.speciesCache) return Promise.resolve(state.speciesCache);
  if (state.speciesPromise) return state.speciesPromise;

  state.speciesPromise = fetch('data/trees_data.json')
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then((trees) => {
      state.speciesCache = trees || [];
      console.log('✅ 樹種清單載入完成：' + state.speciesCache.length + ' 種');
      return state.speciesCache;
    })
    .catch((err) => {
      console.error('❌ 載入樹木資料失敗:', err);
      state.speciesPromise = null;
      return [];
    });

  return state.speciesPromise;
}

export function fillSpeciesDatalist() {
  const dataList = document.getElementById('tree_datalist');
  if (!dataList) return;
  const fragment = document.createDocumentFragment();
  (state.speciesCache || []).forEach((tree) => {
    const option = document.createElement('option');
    option.value = tree.name;
    fragment.appendChild(option);
  });
  dataList.textContent = '';
  dataList.appendChild(fragment);
}