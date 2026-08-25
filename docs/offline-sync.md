# 離線同步合約

## 1. 概覽及儲存

`offline.js` 使用 IndexedDB Outbox 保存離線或暫時無法送出嘅 POST 寫入，網絡恢復後逐筆同步到 GAS。

```text
DB_NAME           = 'tree-offline'
STORE             = 'outbox'
SNAPSHOT_STORE    = 'snapshot'
MAX_AGE_DAYS      = 30
MAX_RETRY         = 5
SYNC_BATCH_SIZE   = 10
BATCH_DELAY_MS    = 250
MAX_DRAIN_BATCHES = 100
```

IndexedDB 以 version 3 開啟。`outbox` 使用 `id`（autoIncrement）作 keyPath，並有 `ts` index；`snapshot` 使用 `key` 作 keyPath。

## 2. Outbox 資料結構

每筆記錄欄位：

| 欄位 | 說明／預設 |
|---|---|
| `id` | IndexedDB autoIncrement number。 |
| `payload` | POST payload；入庫前移除 `token`／`csrf_token`。 |
| `ts` | 入隊時間，`Date.now()` milliseconds。 |
| `client_id` | 冪等 key；缺少時產生 UUID。 |
| `type` | `payload.type`；缺少為 `unknown`。 |
| `tree_id` | `payload.tree_id`／`treeId`，否則 `null`。 |
| `project_id` | `payload.project_id`／`prj`，否則 `null`。 |
| `status` | 新記錄為 `queued`。 |
| `createdAt` | 建立時間；舊記錄缺少時以 `ts` 補。 |
| `updatedAt` | 最後更新時間。 |
| `syncedAt` | 成功同步時間；未同步為 `null`。 |
| `retry` | 重試次數；新記錄為 `0`。 |
| `lastError` | 最後錯誤；新記錄為 `null`。 |

`normalize()` 讀取舊 queue item 時會補齊上述 metadata。任務描述使用 `pending`，但目前源碼實際使用 `queued`；`getPendingCount()` 計算 `queued`／`syncing`。

GET 快取（localStorage `tree_cache_`）最長有效期優先取自 `CachePolicy.POLICY.snapshot.ttl`（24 小時），未載入 `cache-policy.js` 時回退硬編碼 24h；IndexedDB `snapshot` store 另由 `CachePolicy.snapshot.maxAgeDays = 7` 控制。

## 3. 狀態流轉

```text
入隊 → queued → syncing → synced
              │       ├─成功／duplicate→synced
              │       ├─HTTP 5xx／網絡錯誤→queued + retry
              │       ├─業務錯誤→queued + retry
              │       └─UNAUTHORIZED→queued（重新驗證後重試）
              └─retry >= 5 嘅同步批次檢查→failed（保留）

failed --retryOne/retryAllFailed--> queued（retry=0）
synced --超過30日 cleanupExpired--> 刪除
```

- `queued`：等待同步。
- `syncing`：開始送出前設定；下一輪仍會視為待同步。
- `synced`：收到 `json.ok` 或 `json.duplicate === true`；寫入 `syncedAt`、清除 `lastError`。
- `failed`：達重試上限後保留，不會自動再送；可手動重試。
- `incrementRetry()` 會增加 `retry`、寫入 `lastError`、將狀態設回 `queued`。
- `retryOne()`／`retryAllFailed()` 將 failed 改回 queued，重設 retry 及錯誤。
- `cleanupExpired()` 只刪除過期 `synced`；`queued`／`failed` 一律保留。

細節：item 已有 `retry >= MAX_RETRY` 時，會在下一次批次檢查時標記 `failed`；記錄不會因超過上限而丟失。

## 4. Token 安全處理

### 入隊前

`stripToken(payload)` 會刪除：

```text
token
csrf_token
```

經由 `ApiService` fallback（離線、網絡錯誤或伺服器錯誤）而 push 入 outbox 前會先 strip；`t.js` 直接呼叫 `OfflineQueue.push()` 嘅離線 payload 本身尚未由 `ApiService` 注入 token。要注意 `OfflineQueue.push()` 函式本身唔會再次 strip 任意呼叫者傳入嘅 token，因此安全保證依賴目前呼叫路徑。

### 同步時

每筆同步先標記 `syncing`，再：

1. 從 `getCurrentToken()` 讀取最新未過期 Token：優先 `sessionStorage` 嘅 `Config.AUTH.STORAGE_KEY`（目前 `tree_staff_token`），無效時 fallback 至 `localStorage`（跨分頁持久，避免關閉分頁後 token 遺失令離線佇列永鎖）。
2. 從 `AuthService.getCsrfToken()` 讀取最新 CSRF Token。
3. 只在記憶體 payload 補回 `token`／`csrf_token`。
4. 用 POST JSON body 送出，唔使用自訂 header。

## 5. `ApiService` 攔截

### POST hook

`offline.js` 保存原本 `ApiService.post` 後替換：

- 離線：`stripToken` → `push` → `{ ok: true, queued: true }`。
- 在線成功：呼叫原本 POST；若 `ok`，清理 GET cache。
- 網絡錯誤／`TIMEOUT`／離線／伺服器錯誤：strip → push → `{ ok: true, queued: true }`。
- 其他錯誤：重新 throw。

`ApiService.post` 本身會注入 Token、CSRF、`client_id`、`client_created_at`，並將 `duplicate` 改視為成功。

### GET hook

- 先 shallow clone `params`（避免修改呼叫方嘅物件）。
- 成功而有 `result.data`：寫入 localStorage cache，key prefix 為 `tree_cache_`；但 `nocache`／`bust` 旁路請求嘅成功結果**一律唔寫入**快取（避免「強制刷新」污染離線快取）。
- 離線判斷包含 `OFFLINE`、`TIMEOUT`、**SW 回 503**、`backendError === 'OFFLINE'` 或離線時 `API_` 開頭錯誤碼：返回 cache，並加 `offline: true, stale: true`。
- 冇 cache：返回 `{ data: [], offline: true, stale: true }`。
- 其他錯誤：重新 throw。

### clearCache hook

`offline.js` 亦包裝 `ApiService.clearCache`：先清除 `ApiService` 記憶體 `responseCache`（`origClearCache`），再清除 localStorage GET cache，並通知 Service Worker 失效 `DATA_CACHE`。

localStorage GET cache 最長 24 小時；`ApiService` 另有 60 秒記憶體 response cache。

## 6. 同步流程及觸發

`syncOutbox(force)`（drain 模式，`offline.js` 含 `processBatch_`）：

1. 離線或已有同步流程（`_syncing`/`_syncPromise` 去重）時返回；非 `force` 呼叫受 60 秒節流。
2. 過期 `synced` 清理由背景排程處理，不在前景熱路徑執行。
3. `while (navigator.onLine && batchCount < MAX_DRAIN_BATCHES)` 循環：每次 `await all()` 重新讀取，揀 `queued`／`syncing`，排除 `synced`／`failed`；空則 `break`。
4. 每批取最多 `SYNC_BATCH_SIZE=10` 筆，`batchCount>0` 時先 `await delay_(BATCH_DELAY_MS=250)`（讓出主線程、避開 GAS 限流），再檢查 `navigator.onLine`。
5. 逐筆（保持順序，不併發）`processBatch_`：檢查 `retry>=MAX_RETRY`→`failed`、相片校驗→`failed`、補最新 `token`/`csrf_token`、`fetch(POST)` + `ApiService.parseResponse` 分支（`ok/duplicate→synced`、`UNAUTHORIZED→reauthenticate` 重試同一筆、`permanentApiError(401/403/404/noRetry)→failed`、業務 `noRetryCodes→failed` / 其他 `incrementRetry`、網路錯誤 `incrementRetry` 且連續 3 次 → `shouldBreak`）。
6. 累計 `totalSynced/totalFailed`，`shouldBreak`（連續 3 次網路失敗或登入取消）則暫停本輪 `drain`，待下次 `online/visibilitychange/syncNow` 觸發續傳。
7. 循環結束後 `console.log` 匯總（含批數），`totalSynced>0` 時依 `getPendingCount()` 顯示 `已全部同步(totalSynced筆)` 或 `已同步 x 筆，剩餘 y 筆`，清理 `localStorage` + `SW DATA_CACHE` + `ApiService` 記憶體快取；全失敗亦 `pwaToast` 提示已保留重試。
8. 返回 `totalSynced`；`finally` 重設 `_syncing = false`；外層 `syncOutbox` 以 `_syncPromise` 去重並透傳返回值。

### 觸發時機

- `online`：`warmGAS()` 與 `syncOutbox(true)` 並行啟動（`setTimeout(..., 0)`，不再固定等 800ms，避免恢復連線後白等近一秒）。
- `visibilitychange`：頁面恢復可見時 `warmGAS()` 及 `syncOutbox(false)`。
- 手動 `syncNow()`：在線時強制同步；離線返回 0 並提示無法同步。

`globalThis.OfflineQueue`、`globalThis.pwaToast`、`globalThis.syncOutbox`、`globalThis.syncNow`、`globalThis.warmGAS`、`globalThis.TreeSnapshot` 由 `offline.js` 暴露。SW 層失效通知優先經 `CacheManager.notifySwInvalidate`，否則 `navigator.serviceWorker.controller.postMessage`。

## 7. 錯誤分類

| 類型 | 處理 |
|---|---|
| HTTP 5xx／網絡錯誤 | `incrementRetry`，狀態 `queued`，保留重試及 `lastError`。 |
| `TIMEOUT` | 即時 POST 先入 outbox；同步時按網絡錯誤處理。 |
| `UNAUTHORIZED` | 回到 `queued`，唔增加 retry；呼叫 `AuthService.promptAuth()`，成功後重試同一筆。 |
| 業務錯誤 | `incrementRetry`，狀態 `queued`，受 `MAX_RETRY` 限制。 |
| `duplicate` | 即使 response 未明確帶 `ok`，都視為成功並標記 `synced`。 |
| 達 retry 上限 | 標記 `failed` 並保留，停止自動送出。 |

`UNAUTHORIZED` 會先回到 queued；重新驗證成功時重試同一筆且不增加 retry，取消驗證則保留等下次觸發。

## 8. 審計記錄

如果存在 `window.AuditLog`，會記錄 queue／sync 事件，包括入隊、成功、retry、業務錯誤、UNAUTHORIZED 及 failed。`assets/js/modules/audit-log.js` 將資料存於 localStorage：

```text
tree_audit_log
```

每筆包括 `time`、`action`、`type`、`tree_id`、`project_id`、`staff`、`status`、`error`、`online`、`userAgent`，最多保存 400 筆。`ApiService` 在線寫入亦會使用同一 AuditLog，所以記錄可能同時有直接 API 及 offline sync 事件。

## 9. 源碼核對備註／現況差異

- 實際狀態值係 `queued`，不是 `pending`。
- `MAX_AGE_DAYS=30`、`MAX_RETRY=5`、`SYNC_BATCH_SIZE=10` 與要求一致。
- 即時 POST hook 對 5xx 使用 `err.status >= 500`；但 `api.js` 將非 2xx 轉成 `Error('HTTP <status>')`，未必保留 `status`，同步階段直接 fetch 則仍按 `!res.ok` retry。
- `t.js` 有路徑會直接呼叫 `OfflineQueue.push()`，其他呼叫由 `ApiService` hook 攔截；兩者共用同一 outbox。
- GET 快取最大有效期 24h 優先讀 `CachePolicy.POLICY.snapshot.ttl`；`CACHE_MAX_AGE` 變數在 `offline.js` 初始化時決定。
- 後端 `checkDuplicateFast_()`／`markDuplicateFast_()` 喺 ScriptCache 層做 600 秒快速防重，鎖外上傳相片前先檢查，減少孤兒檔案。
- `notifySwInvalidateOffline_` 優先使用 `CacheManager.notifySwInvalidate`（若 `cache-manager.js` 已載入），否則 `postMessage`。

---

> **最後核對**：2026-08-25。源碼檔案：`offline.js`、`assets/js/api.js`、`assets/js/config.js`、`assets/js/auth.js`、`assets/js/core/cache-policy.js`、`assets/js/core/cache-manager.js`、`assets/js/modules/audit-log.js`、`assets/js/pages/t.js`、`t.html`、`sw.js`。
