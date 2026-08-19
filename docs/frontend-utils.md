# 前端工具函數分佈

本文件記錄樹木 NFC 巡查系統前端工具函數的載入方式、暴露介面及維護邊界。系統同時支援 ES Modules 與 Plain Script；兩種載入機制按頁面及效能需要分工，不能把 lazy 座標服務與 module 工具混為一談。

## 工具檔案及載入方式

| 檔案 | 類型 | 載入頁面 | 暴露方式 |
|---|---|---|---|
| `assets/js/core/utils.js` | ES Module | `index.html`、`t.html`、`nfc.html` 及其他 module imports | Named exports；不掛載 `window` |
| `assets/js/utils.js` | Plain Script（IIFE） | `index.html` | `window.CoordUtils` |
| `assets/js/core/coord-lazy.js` | Plain Script（IIFE） | `t.html` | `window.CoordLazy` |

`assets/js/core/global-utils.js` 已於 Phase 6.4 移除。全 repo 搜尋確認沒有剩餘 `window.TreeUtils` runtime consumer；現時只見 `assets/js/core/utils.js`、舊文件及少量源碼註解保留相關文字，module 頁面統一直接 import `assets/js/core/utils.js`。

## 實際載入依賴順序

- `t.html`：`config.js` → `api-config.js` → `audit-log.js` → `api.js` → `auth.js` → `purify.min.js` → `core/coord-lazy.js` → `offline.js` → `modules/sync-panel.js` → module `pages/t.js`
- `nfc.html`：`config.js` → `api-config.js` → module `pages/nfc.js`
- `index.html`：shared classic scripts 及 vendor → module `app.js`，再由 module imports 載入其他 ES Modules

`offline.js` 必須在 `t.js` module 之前執行，以便先完成 `ApiService.post`/`ApiService.get` hook；`core/coord-lazy.js` 必須維持 plain script，以保留按需載入 `proj4.js` 的設計。

## 共用工具 exports

`assets/js/core/utils.js` 提供以下 named exports：

- `escapeHtml`
- `sanitizeId`
- `format1`
- `format5`
- `VALID_HEALTH`
- `isValidHK80`
- `debounce`
- `throttle`

`assets/js/pages/t.js`、`assets/js/pages/nfc.js` 及 application modules 應直接 import 需要的工具，不應重新建立同名實作或依賴已移除的 `window.TreeUtils`。

## 座標轉換雙軌

### `CoordUtils`：`index.html`

`assets/js/utils.js` 假設 vendor 的 `proj4.js` 已按頁面載入流程提供，負責地圖主頁的座標轉換，並保留現有 LRU 快取及批量轉換能力。

### `CoordLazy`：`t.html`

`assets/js/core/coord-lazy.js` 按需要才載入 `proj4.js`，負責樹木詳情／巡查頁的座標轉換，以保住首屏效能。

兩者的載入時機、快取及使用頁面不同，不能合併或互相取代：

- `index.html` 使用 `CoordUtils`
- `t.html` 使用 `window.CoordLazy`
- `assets/js/pages/t.js` 只讀取 `window.CoordLazy.toHK` / `toWGS`
- 不應修改兩者的座標轉換數學或延遲載入設計

## `VALID_HEALTH` 與 `isValidHK80` 的來源

健康狀態合法值及 HK80 座標有效性驗證已集中在 `assets/js/core/utils.js`：

- `assets/js/pages/t.js` 透過 `td-utils.js` import 使用；
- `assets/js/pages/nfc.js` 直接 import 需要的工具；
- `assets/js/modules/forms.js` 直接 import `VALID_HEALTH` 及 `isValidHK80`。

頁面模組不應再各自定義這兩項驗證邏輯，也不應重新引入 `window.TreeUtils` 相容層。

## Tree-detail 三模組契約

### `assets/js/pages/tree-detail/td-utils.js`

- 初始化／保留 `window.TD`，並確保 `selectedPhotos` 陣列、`TREE`、`id`、`prj` 存在。
- 提供 `COLORS`、`MAX_PHOTOS = 6`、`MAX_PHOTO_CHARS`，以及 `compress`、`sanitizeHTML`、`sanitizeLogsHTML`、`isValidHealth`、`isValidHK80` 等 named exports。
- `isValidHealth` 直接使用 `core/utils.js` 的 `VALID_HEALTH`；HK80 驗證亦委派至 `isValidHK80`。

### `assets/js/pages/tree-detail/td-photos.js`

- `initPhotoPreview()` 由 `input#photo` 選檔後追加至 `window.TD.selectedPhotos`。
- `updatePhotoPreview()` 讀取同一陣列產生預覽；`removePhoto(index)` 以 `splice` 移除，`t.js` 再將 `removePhoto` 暴露為 `window.removePhoto`。
- 因此 `window.TD.selectedPhotos` 係 `t.js`、`td-utils.js`、`td-photos.js` 之間的共享相片狀態合約。

### `assets/js/pages/tree-detail/td-logs.js`

- `loadLogs()` 及 `attachLogsDelegation()` 以 `window.TD.id`、`window.TD.prj` 組合 `inspections` GET 查詢。
- 讀取巡查相片時使用 `td-utils.js` 的時間格式化、Google Drive URL 轉換及 HTML 清理 helpers；相片下載／放大由事件委派呼叫頁面層的 `window.downloadPhoto`／`window.zoomImage`。
- `window.TD.id`／`window.TD.prj` 係頁面路由及巡查查詢的共享狀態合約。

---

> **最後核對**：2026-08-19。源碼檔案：`assets/js/core/utils.js`、`assets/js/pages/t.js`、`assets/js/pages/nfc.js`、`assets/js/pages/tree-detail/td-utils.js`、`assets/js/pages/tree-detail/td-photos.js`、`assets/js/pages/tree-detail/td-logs.js`、`assets/js/modules/forms.js`、`assets/js/utils.js`、`assets/js/core/coord-lazy.js`、`t.html`、`nfc.html`。全 repo 搜尋未發現 `window.TreeUtils` runtime 引用；`assets/js/core/global-utils.js` 實體不存在。
