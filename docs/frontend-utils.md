# 前端工具函數分佈

本文件記錄樹木 NFC 巡查系統前端工具函數的載入方式、暴露介面及維護邊界。系統同時支援 ES Modules 與 Plain Script；兩種載入機制按頁面及效能需要分工，不能把 lazy 座標服務與 module 工具混為一談。

## 工具檔案及載入方式

| 檔案 | 類型 | 載入頁面 | 暴露方式 |
|---|---|---|---|
| `assets/js/core/coordinates.js` | ES Module（統一真源） | `index.html`、`t.html`（type=module） | Named exports + `globalThis.CoordUtils`/`CoordLazy` 兼容 |
| `assets/js/core/utils.js` | ES Module | `index.html`、`t.html`、`nfc.html` 及其他 module imports | Named exports；不掛載 `window`（`isValidHK80/format1/format5` 轉發至 coordinates） |

`assets/js/core/global-utils.js` 及 `assets/js/utils.js`（deprecated CoordUtils shim）已於 2026-08-25 清理移除——兩者均未被任何 HTML 頁面引用，屬歷史保留檔。全 repo 搜尋確認沒有剩餘 `window.TreeUtils` runtime consumer；module 頁面統一直接 import `assets/js/core/utils.js`。

## 實際載入依賴順序

- `t.html`：`env.js` → `cache-policy.js` → `cache-manager.js` → `config.js` → `audit-log.js` → `error-codes.js` → `api.js` → `auth.js` → `purify.min.js` → `coordinates.js` (ESM) → `offline.js` → `modules/sync-panel.js` → module `pages/t.js`（座標轉換由 `coordinates.js` ESM 統一提供）
- `nfc.html`：`env.js` → `config.js` → `api.js` → module `pages/nfc.js`
- `index.html`：`env.js` → vendor（Leaflet、marker cluster、`proj4.js`、`DOMPurify`）→ `cache-policy.js` → `cache-manager.js` → `config.js` → `audit-log.js` → `coordinates.js` (ESM) → `error-codes.js` → `ui-progress.js` → `ui-icons.js` → `api.js` → `auth.js` → `offline.js` → `modules/sync-panel.js` → module `app.js`，再由 module imports 載入其他 ES Modules

`offline.js` 必須在 `t.js` module 之前執行，以便先完成 `ApiService.post`/`ApiService.get` hook；`proj4.js` 由 `coordinates.js` 載入時確保已就緒。

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
- `isSafeBackUrl`（NFC 安全 URL 驗證：同源 + 路徑白名單）

`assets/js/pages/t.js`、`assets/js/pages/nfc.js` 及 application modules 應直接 import 需要的工具，不應重新建立同名實作或依賴已移除的 `window.TreeUtils`。

## 座標轉換統一（單一真源）

統一至 `assets/js/core/coordinates.js`（ESM）：投影字串、HK80/WGS84 範圍、LRU 2000、同步/非同步 API（`toHK80/toWGS84/toHK80Async/toWGS84Async/batchToHK80`）、格式化與驗證。

- 載入：`index.html` 與 `t.html` 均以 `<script type="module" src="assets/js/core/coordinates.js">` 載入，並同時掛 `globalThis.CoordUtils`/`CoordLazy` 兼容舊呼叫（`CoordUtils.toHK80/toWGS84/batchToHK80/preheatCache/getCacheStats` 與 `CoordLazy.toHK/toWGS`）。
- 舊檔：`assets/js/core/coord-lazy.js` 及 `assets/js/utils.js`（deprecated CoordUtils shim）已移除。統一由 `coordinates.js` 提供 `CoordUtils`/`CoordLazy` 全域。
- 新代碼：`import { toHK80, toWGS84, toHK80Async, batchToHK80 } from '../core/coordinates.js'`。`assets/js/core/utils.js` 的 `isValidHK80/format1/format5` 已轉發至此。
- 後端 `GAS/coordinates.gs` 抽 `COORD_HK80_BOUNDS_/COORD_WGS84_BOUNDS_` 並新增 `batchWgs84ToHk80_()` 對應前端批次，參數與 `proj4` 完全一致。

## `VALID_HEALTH` 與 `isValidHK80` 的來源

健康狀態合法值及 HK80 座標有效性驗證已集中在 `assets/js/core/utils.js`：

- `assets/js/pages/t.js` 透過 `td-utils.js` import 使用；
- `assets/js/pages/nfc.js` 直接 import 需要的工具；
- `assets/js/modules/forms.js` 直接 import `VALID_HEALTH` 及 `isValidHK80`。

頁面模組不應再各自定義這兩項驗證邏輯，也不應重新引入 `window.TreeUtils` 相容層。

## Tree-detail 十二模組契約（Phase 8 重構）

樹木詳情頁（`t.html`）由 `assets/js/pages/tree-detail/` 下 12 個 ES Module 組成，透過 `globalThis.TD` 共享狀態：`TD.id`（樹木編號）、`TD.prj`（地盤 ID）、`TD.TREE`（樹木資料）、`TD.selectedPhotos`（相片陣列）。

### `route.js`
- 初始化 `globalThis.TD = globalThis.TD || {}`；匯出 `TD`、`initRoute()`。
- 解析 URL 參數 `id` / `prj`，設定 `TD.id`、`TD.prj`，並觸發頁面載入流程。

### `page.js`
- 匯入 `route.js` 嘅 `TD`、`initRoute`，以及 `td-logs.js`、`view.js` 等。
- 協調頁面生命週期：載入資料 → 渲染 → 附加事件。

### `view.js`
- 純渲染函式：`renderTreeInfo()`、`renderCard()`、`renderPhotoGallery()`、`renderForm()` 等。
- 使用 `core/utils.js` 的 `escapeHtml`/`format1`/`format5` 做安全格式化。
- 不管理狀態，僅接收資料並輸出 DOM。

### `tabs.js`
- 標籤頁切換邏輯（資訊、巡查、編輯等）。
- 切換時觸發對應 controller 的載入/卸載。

### `auth-gate.js`
- 檢查登入狀態，未登入時顯示鎖定覆蓋層。
- 匯入 `td-photos.js` 用於相片操作。

### `inspection-controller.js`
- 巡查記錄的載入、建立、提交。
- 匯出 `post()` 作為通用寫入函式（供 `tree-edit-controller.js` 使用）。
- 兩階段相片上傳：先 metadata 得 `inspection_id`，再逐張上傳。

### `tree-edit-controller.js`
- 樹木編輯（基本欄位、位置、編號改名）。
- 版本衝突檢測：帶 `base_updated_at` 比對，`VERSION_CONFLICT` 時提示用戶重新載入。
- `new_tree_id` 改名支援。

### `photo-controller.js`
- 相片管理（新增、刪除、排序）。
- 離線佇列整合：相片先暫存 `TD.selectedPhotos`，提交時一併處理。

### `nfc-navigation.js`
- NFC 連結跳轉（`nfc://` 協議處理）。
- 安全 URL 驗證委派至 `core/utils.js` 的 `isSafeBackUrl`。

### `td-utils.js`
- 初始化／保留 `window.TD`，確保 `selectedPhotos` 陣列、`TREE`、`id`、`prj` 存在。
- 提供 `COLORS`、`MAX_PHOTOS = 6`、`MAX_PHOTO_CHARS`，以及 `compress`、`sanitizeHTML`、`sanitizeLogsHTML`、`isValidHealth`、`isValidHK80` 等 named exports。
- `isValidHealth` 直接使用 `core/utils.js` 的 `VALID_HEALTH`；HK80 驗證亦委派至 `isValidHK80`。

### `td-photos.js`
- `initPhotoPreview()` 由 `input#photo` 選檔後追加至 `window.TD.selectedPhotos`。
- `updatePhotoPreview()` 讀取同一陣列產生預覽；`removePhoto(index)` 以 `splice` 移除，`t.js` 再將 `removePhoto` 暴露為 `window.removePhoto`。
- 因此 `window.TD.selectedPhotos` 係各模組之間的共享相片狀態合約。

### `td-logs.js`
- `loadLogs()` 及 `attachLogsDelegation()` 以 `window.TD.id`、`window.TD.prj` 組合 `inspections` GET 查詢。
- 讀取巡查相片時使用 `td-utils.js` 的時間格式化、Google Drive URL 轉換及 HTML 清理 helpers；相片下載／放大由事件委派呼叫頁面層的 `window.downloadPhoto`／`window.zoomImage`。
- `window.TD.id`／`window.TD.prj` 係頁面路由及巡查查詢的共享狀態合約。

---

> **最後核對**：2026-08-25。源碼檔案：`assets/js/core/utils.js`、`assets/js/pages/t.js`、`assets/js/pages/nfc.js`、`assets/js/pages/tree-detail/route.js`、`assets/js/pages/tree-detail/page.js`、`assets/js/pages/tree-detail/view.js`、`assets/js/pages/tree-detail/tabs.js`、`assets/js/pages/tree-detail/auth-gate.js`、`assets/js/pages/tree-detail/inspection-controller.js`、`assets/js/pages/tree-detail/tree-edit-controller.js`、`assets/js/pages/tree-detail/photo-controller.js`、`assets/js/pages/tree-detail/nfc-navigation.js`、`assets/js/pages/tree-detail/td-utils.js`、`assets/js/pages/tree-detail/td-photos.js`、`assets/js/pages/tree-detail/td-logs.js`、`assets/js/modules/forms.js`、`t.html`、`nfc.html`、`index.html`。全 repo 搜尋未發現 `window.TreeUtils` runtime 引用；`assets/js/core/coord-lazy.js` 已移除。`assets/js/core/global-utils.js` 及 `assets/js/utils.js` 已移除。
