# CSS 結構

## 1. 拆分檔及來源 Section

`assets/css/` 現時有 13 個正式載入嘅拆分檔（原 10 個 section 拆分 ＋ `skeleton.css`／`animations.css`／`utilities.css`），加上 2 個頁面 CSS（`pages/t.css`、`pages/nfc.css`）。原 13 檔由原本 `main.css` 的 section 分拆（`utilities.css` 等屬共用工具類，非 section 拆分）。每個拆分檔頂部註解仍保留原始 section 對應：

| 載入次序 | CSS 檔案 | 來源 Section |
|---:|---|---|
| 1 | `tokens.css` | Section 1：全域設計 tokens／變數 |
| 2 | `base.css` | Section 2：基礎樣式 |
| 3 | `layout.css` | Sections 3–6：頂部控制列、搜尋、面板、狀態列及圖例 |
| 4 | `map.css` | Sections 7–9：地圖標記、Layer Bar／FAB 及 Popup |
| 5 | `ui.css` | Sections 10–11：按鈕、Loading、通用觸控及無障礙 |
| 6 | `responsive.css` | Sections 12–13：手機版、平板及細視窗桌面 |
| 7 | `dark.css` | Section 14：深色模式覆蓋 |
| 8 | `filters.css` | Sections 15–17：狀態過濾面板及桌面過濾按鈕 |
| 9 | `gis.css` | Section 18：GIS 工具 |
| 10 | `performance.css` | Section 19：效能及微互動 |
| 11 | `skeleton.css` | 骨架屏（Skeleton）載入佔位 |
| 12 | `animations.css` | 動畫／過渡 |
| 13 | `utilities.css` | 共用工具類（`is-hidden/is-visible`、`offline-toast`、`filter-panel--mobile`、`cluster-badge`、`sk--*` 等），三個頁面共用 |

## 2. Cascade 載入順序

`index.html` 的 `<link>` 順序必須保持與上表一致：

```text
tokens.css
→ base.css
→ layout.css
→ map.css
→ ui.css
→ responsive.css
→ dark.css
→ filters.css
→ gis.css
→ performance.css
→ skeleton.css
→ animations.css
→ utilities.css
```

呢個順序係 cascade 合約，不可單獨調亂任何一個檔案；後載入的規則可能依賴或覆蓋前面 section 的 tokens、layout、map 及 UI 規則。`sw.js` 的 `PRECACHE` 按 13 個拆分檔＋2 個頁面 CSS（`pages/t.css`、`pages/nfc.css`）預快取。

## 3. `main.css` 已移除

歷史來源／備份檔 `assets/css/main.css`（約 30KB）已於 2026-08-25 清理移除——`index.html` 冇引用它、`sw.js` 的 `PRECACHE` 亦冇包含它。現存拆分檔頂部註解保留「由 `main.css` Section n 拆出」的歷史來源記錄。

因此：

- 不可重新建立 `main.css` 或將佢加入 HTML `<link>`／Service Worker `PRECACHE`。
- 13 個拆分檔＋2 個頁面 CSS 係目前唯一正式載入的 CSS 來源。

## 4. 其他頁面的遷移（已完成）

`t.html` 及 `nfc.html` 的 `<style>` 已外移：

- `t.html` → `assets/css/pages/t.css`
- `nfc.html` → `assets/css/pages/nfc.css`
- 兩頁共用工具類 → `assets/css/utilities.css`（`is-hidden/is-visible`, `offline-toast`, `filter-panel--mobile`, `cluster-badge`, `sk--*` 等）

`index.html` 主 cascade 係 `tokens→...→performance→skeleton→animations→utilities` 13 檔；`utilities.css` 由三個頁面共用，`pages/*.css` 僅由對應頁面載入，唔插入主 cascade 嘅 section 表。`sw.js` PRECACHE 已補齊上述 3 檔＋2 個頁面 CSS。

所有 `style=""` 及 `el.style.*` / `cssText` 已改為 class 切換或 `style.setProperty('--x', ...)` / `style.color = ...`（僅保留 CSS 變數與動態顏色寫入），Leaflet pane `zIndex` 仍保留於 JS。

---

 > **最後核對**：2026-08-25。源碼檔案：`index.html`、`t.html`、`nfc.html`、`sw.js`、`assets/css/tokens.css`、`assets/css/base.css`、`assets/css/layout.css`、`assets/css/map.css`、`assets/css/ui.css`、`assets/css/responsive.css`、`assets/css/dark.css`、`assets/css/filters.css`、`assets/css/gis.css`、`assets/css/performance.css`、`assets/css/skeleton.css`、`assets/css/animations.css`、`assets/css/utilities.css`、`assets/css/pages/t.css`、`assets/css/pages/nfc.css`。`assets/css/main.css` 已於 2026-08-25 移除。