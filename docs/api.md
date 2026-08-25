# API 合約

## 1. 範圍與傳輸格式

本文記錄目前 GAS 後端實作嘅前後端合約。入口係 `GAS/main.gs` 嘅 `doGet(e)`／`doPost(e)`；GET 分派到 `GAS/handlers-get.gs`，POST 寫入分派到 `GAS/handlers-post.gs`。`doGet` 會先經 `GAS/validation.gs` 嘅 `validateGetParams_()` 校驗查詢參數，`doPost` 會先經 `validatePostPayload_()` 校驗 body（login 亦校驗但不消耗 rate-limit）。GET 全部公開；POST 除 `login` 外均須 Token 及 CSRF Token。現時 repo 內冇 `GAS/code.gs`。

- `<API_ENDPOINT>` 代表 `Config.API_ENDPOINT`。
- GET：`GET <API_ENDPOINT>?action=...`。
- POST：`POST <API_ENDPOINT>`，前端使用 `Content-Type: text/plain;charset=utf-8`，body 仍然係 JSON 字串。
- 業務結果以 JSON `ok` 欄位為準，唔應只依賴 HTTP status。
- 一般成功：`{ "ok": true, ... }`；一般錯誤：`{ "ok": false, "error_code": "CODE", "error": "CODE", "details": [{"field":"...","code":"..."}] }`（`error` 與 `error_code` 雙寫一版相容）。
- `duplicate: true` 代表同一寫入已處理；前端會將其視為成功（`message` 固定為 `OK_DUPLICATE`）。
- 對外僅回一般英文錯誤碼，內部 `err.message` 僅 `console.error` 落日誌；前端由 `assets/js/core/error-codes.js` 查表轉譯。
- `details` 僅回 `field+code`，不回中文 `message`，避免洩露校驗規則。

## 2. GET Actions（公開）

### 2.1 `bootstrap`

一次載入所有地盤及樹木。

```http
GET <API_ENDPOINT>?action=bootstrap
```

返回：

```json
{ "ok": true, "data": { "projects": [], "trees": [] } }
```

`projects` 及 `trees` 分別係 `projects`、`trees` Sheet 全部資料列。服務端採用**分段快取**：projects 與 trees 分別存入 `PROJECTS_CACHE_KEY`（`projects_all`）／`TREES_CACHE_KEY`（`trees_all`），TTL 300 秒（`BOOTSTRAP_CACHE_TTL`），避免單一 JSON 超過 ScriptCache 100KB 上限；舊 `bootstrap_data` key 僅作相容保留。超過 90KB 嘅 payload 會經 `cachePutChunked_()`／`cacheGetChunked_()` 分片存取（每片 ≤90KB）。`?nocache=1`／`?bust=1` 會清除 `bootstrap_data`、`projects_all`、`trees_all` 三段快取。

### 2.2 `ping`

健康檢查／暖機：

```http
GET <API_ENDPOINT>?action=ping
```

```json
{ "ok": true, "pong": 1710000000000 }
```

`pong` 係後端 `Date.now()` 嘅 Unix epoch milliseconds。

### 2.3 `tree`

| Query 參數 | 必填 | 說明 |
|---|---:|---|
| `action` | 是 | `tree` |
| `id` | 是 | 樹木編號 `tree_id`；缺少／空白由 `validateGetParams_` 回 `VALIDATION_FAILED`；格式限 Unicode 字母數字 `._-` 或全數字，≤64 字元 |
| `prj` | 否 | 地盤 ID `project_id`；提供時只在該地盤內查找（同名異地盤不再跨盤回退）；格式同 `id`，≤64 字元 |

```http
GET <API_ENDPOINT>?action=tree&id=T001&prj=PROJECT-A
```

返回：`{ "ok": true, "data": <樹木物件或 null> }`。找不到時 `data` 為 `null`。現版 `handleGetTree_()` 強制要求 `prj`——缺少 `prj` 時直接回 `data:null`，避免 `tree_id` 跨地盤回錯樹。

### 2.4 `inspections`（cursor 分頁）

| Query 參數 | 必填 | 說明 |
|---|---:|---|
| `action` | 是 | `inspections` |
| `id` | 是 | 樹木編號 `tree_id`；缺少／空白回 `VALIDATION_FAILED`，≤64 字元 |
| `prj` | 否 | 按 `project_id` 再過濾；≤64 字元 |
| `limit` | 否 | 單頁筆數，1-50，預設 20；不傳時為相容模式回全量；超出範圍由 `validateGetParams_` 回 `VALIDATION_FAILED` |
| `cursor` | 否 | 不透明分頁游標（`next_cursor`），首頁不傳；解碼失敗或格式不符（過長 >2048）回 `VALIDATION_FAILED` |
| `order` | 否 | 保留參數，目前僅支援 `desc`（`time DESC, inspection_id ASC` 穩定排序），`asc` 预留；非 `asc`/`desc` 回 `VALIDATION_FAILED` |

**相容**：舊版不帶 `limit`/`cursor` 仍回 `{ "ok": true, "data": [...] }` 全量（已按 `time DESC, inspection_id ASC` 排序）；新版帶 `limit` 或 `cursor` 走 cursor 分頁。

**請求範例**：
```http
GET <API_ENDPOINT>?action=inspections&id=T001&prj=PROJECT-A&limit=20
GET <API_ENDPOINT>?action=inspections&id=T001&prj=PROJECT-A&limit=20&cursor=eyJ0IjoiMjAyNi0wOC0xMCIsImlkIjoiSU5TLTEifQ==
```

**成功（分頁）**：
```json
{
  "ok": true,
  "data": [ /* 本頁 0-20 筆 */ ],
  "pagination": { "next_cursor": "eyJ...", "has_more": true, "limit": 20 }
}
```
`has_more=false` 時 `next_cursor` 為 `null`，前端顯示「已全部載入」。無記錄時 `data` 為空陣列且 `has_more=false`。服務端仍以 `getCachedRows_(SH_INS)` 快取全表（TTL 300 秒），cursor 切片在記憶體完成；寫入後會 `clearDataCache_()` 失效。

### 2.5 `projects`

```http
GET <API_ENDPOINT>?action=projects
```

返回：`{ "ok": true, "data": <地盤陣列> }`。服務端一般快取 TTL 為 300 秒。

### 2.6 `trees`（預設 action）

| Query 參數 | 必填 | 說明 |
|---|---:|---|
| `action` | 否 | 缺少時預設 `trees`；未知 action 亦落入此分支 |
| `project` | 否 | 按 `project_id` 過濾（前後端均 `String(...).trim()` 歸一，容許空白誤差）；格式限 `A-Za-z0-9_-`，≤64 字元 |
| `bbox` | 否 | `south,west,north,east`（viewport 按需載入）；亦支援獨立 `south`/`west`/`north`/`east` 參數；必須為 4 個有效數值 |
| `limit` | 否 | 分頁單頁筆數，1-5000；配合 `offset` 使用 |
| `offset` | 否 | 分頁起始偏移，預設 0 |
| `nocache` | 否 | `1`（或 `true`）時強制旁路 `CacheService` / `DATA_CACHE` / `ApiService` 記憶體快取；`bust=1` 同效 |

返回：`{ "ok": true, "data": <樹木陣列> }`。服務端一般快取 TTL 為 300 秒（`CACHE_TTL`，可被 `GAS/cache-policy.gs` 嘅 `CACHE_POLICY.trees` 覆蓋）。

### 2.7 `species`

| Query 參數 | 必填 | 說明 |
|---|---:|---|
| `action` | 是 | `species` |
| `id` | 否 | 物種 ID；過長（>64）或格式不符回 `VALIDATION_FAILED` |
| `name` | 否 | 物種名稱；過長（>200）回 `VALIDATION_FAILED` |

```http
GET <API_ENDPOINT>?action=species
```

返回：`{ "ok": true, "data": [{ "id": 1, "name": "..." }] }`。只回 `id`＋`name` 必要欄位；若 `species` Sheet 唔存在（`SH_SPECIES` 未設定）或讀取失敗，回空陣列讓前端 fallback 靜態 JSON。服務端快取 key `species_all`，TTL 86400 秒（`SPECIES_TTL`）。

> **後端回 `[]` 疑難排查**（`ShingMunRiver` 0 棵同類）：優先在 GAS 編輯器執行 `debugTrees_()`（見 `GAS/sheets-repo.gs`）檢查 `SH_TREES` 表頭/綁定/快取；前端已加 `?nocache=1` / `SW handleApi` / `ApiService` 記憶體三層旁路；若用 `https://script.google.com/macros/s/.../u/4/...` 報 `API_HTML_RESPONSE`，請改用 `*/exec?action=...` 直連（去 `/u/N/`）並加 `&nocache=1` 清 `trees_all` / `bootstrap_data`（GAS 內 `clearDataCache_()`）。

## 3. POST 共通規則

### 3.1 Body 及認證

Body 必須係有效 JSON，且會先經 `validatePostPayload_()`（`GAS/validation.gs`）做 type 白名單與欄位限制校驗；唔識別嘅 type 回 `UNSUPPORTED_OPERATION`。除 `login` 外，body 應包含：

```json
{ "token": "<session token>", "csrf_token": "<CSRF token>" }
```

Apps Script 無法依賴自訂 HTTP header，所以現行前端將 CSRF 放喺 JSON body；後端另支援 query `csrf_token`／`X-CSRF-Token` 作後備。

所有寫入應帶：

```json
{ "client_id": "<UUID>", "client_created_at": "<ISO timestamp>" }
```

`ApiService` 及 `offline.js` 會在缺少時補齊，重試沿用同一 `client_id`。

### 3.2 `login`

唔需要 Token，係取得 Token 嘅入口。

請求：

```json
{ "type": "login", "password": "..." }
```

成功：

```json
{ "ok": true, "token": "...", "csrf_token": "..." }
```

密碼錯誤：`{ "ok": false, "error_code": "AUTH_FAILED", "error": "AUTH_FAILED" }`。

連續失敗達 10 次後，login failure counter 以 CacheService 鎖 600 秒（10 分鐘），返回：

```json
{ "ok": false, "error_code": "RATE_LIMITED", "error": "RATE_LIMITED" }
```

實作係前 10 次失敗會累積，第 11 次開始被鎖定。

### 3.3 `checkin`

新增簽到記錄至 `checkins`。

請求欄位：

```json
{
  "type": "checkin", "token": "...", "csrf_token": "...",
  "client_id": "uuid", "client_created_at": "2026-08-19T00:00:00.000Z",
  "staff": "Alex", "tree_id": "T001", "prj": "PROJECT-A",
  "lat": "22.400000", "lng": "114.180000"
}
```

`prj` 寫入表內會對應為 `project_id`；`lat`／`lng` 係 WGS84。成功：`{ "ok": true }`。

重複：`{ "ok": true, "duplicate": true, "message": "OK_DUPLICATE" }`。

### 3.4 `inspection`

新增巡查記錄，支援直接相片或兩階段上傳。

請求欄位：

```json
{
  "type": "inspection", "token": "...", "csrf_token": "...",
  "client_id": "uuid", "client_created_at": "2026-08-19T00:00:00.000Z",
  "staff": "Alex", "tree_id": "T001", "prj": "PROJECT-A",
  "health": "Normal", "note": "備註", "photo_base64": "",
  "photos_total": 2, "photos_pending": 2
}
```

- `health` 合法前端值：`Normal`、`Fair`、`Poor`、`Very Poor`、`Dead`。
- `photo_base64` 可為單一 base64、陣列或空值。
- 當 `photo_base64` 留空而 `photos_total > 0`，後端先建立 metadata，之後用 `inspection_photo` 逐張上傳。
- `photos_pending` 目前由前端傳送，但 `GAS/handlers-post.gs` 未使用；後端實際按 `photos_total` 記錄相片總數。
- `lat`／`lng` 係可選欄位；後端支援，現行 `t.js` 巡查請求未傳。
- 建立巡查時若有相片或 `health`，會一併更新對應 `trees.photo_url`／`trees.status`，並 bump `trees.updated_at`（配合版本衝突檢測）。

成功：

```json
{ "ok": true, "inspection_id": "INS-...", "photo_urls": [] }
```

重複會同樣帶 `duplicate: true`，並盡量返回既有 `inspection_id` 及 `photo_urls`。

> 生產已啟用兩階段上傳（Config.INSPECTION_SPLIT_PHOTOS = true）；離線時前端自動 fallback 單一 POST。
### 3.5 `inspection_photo`

獨立上傳一張巡查相片。

請求欄位：

```json
{
  "type": "inspection_photo", "token": "...", "csrf_token": "...",
  "client_id": "uuid", "client_created_at": "2026-08-19T00:00:00.000Z",
  "inspection_id": "INS-...", "tree_id": "T001", "prj": "PROJECT-A",
  "photo_base64": "data:image/jpeg;base64,...", "photo_index": 1
}
```

成功：`{ "ok": true, "photo_url": "https://lh3.googleusercontent.com/d/...=w1200" }`。上傳檔名為 `<tree_id>_<time>_<index>.jpg`，相片設為 anyone-with-link 可讀。

重複：`{ "ok": true, "duplicate": true, "message": "OK_DUPLICATE" }`（舊文檔中文 `相片已存在` 已統一為代碼）。

若請求帶 `tree_id`／`prj` 而與 `inspection_id` 對應嘅記錄不符，回 `VALIDATION_FAILED` + `INVALID_VALUE`（跨樹防錯配）；`inspection_id` 缺少或格式不符（`^INS-\d+-[0-9a-fA-F]{1,12}$`）回 `VALIDATION_FAILED`。

缺少巡查 ID：`{ "ok": false, "error_code": "VALIDATION_FAILED", "error": "VALIDATION_FAILED", "details": [{"field":"inspection_id","code":"REQUIRED"}] }`。

### 3.6 `update_tree`

部分更新樹木資料。定位欄位係 `tree_id`，`prj` 可選用於限定 `project_id`。目標樹木唔存在時回 `CONFLICT` + `{field:'tree_id', code:'NOT_FOUND'}`（避免離線同步誤標記成功）。

必備／共通欄位：`type`、`token`、`csrf_token`、`client_id`、`client_created_at`、`tree_id`；`prj` 可選。

可更新欄位：

```text
name, status, project_id, risk, description,
tree_height, crown_width, dbh, ground_diameter, stem_length,
crown_area, crown_volume, level, lat, lng, hk80_n, hk80_e
```

另有可選欄位 `new_tree_id`，用於將樹木編號改名；`tree_id` 仍然係定位原有樹木嘅編號。`new_tree_id` 必須為 1 至 64 字元，只可包含英數、中文、點、底線及連字號。改名只會喺同一 `project_id`（地盤）內檢查唯一性；純數字編號會按數值比較，例如 `07` 同 `7` 視為相同。重複時返回：

```json
{ "ok": false, "error_code": "CONFLICT", "error": "CONFLICT", "details": [{"field":"new_tree_id","code":"ALREADY_EXISTS"}] }
```
格式不正確時返回 `VALIDATION_FAILED` + `INVALID_FORMAT`。

成功改名時，後端會同步將 `inspections` 同 `checkins` 內相同地盤及原編號嘅 `tree_id` 更新為新編號（cascade），並返回：

```json
{ "ok": true, "renamed": true, "new_tree_id": "X" }
```

未有提供 `new_tree_id`，或者其值等於原有編號時，行為與舊版相同，成功返回 `{ "ok": true }`。提供 `new_tree_id` 時仍會一併套用其他樹木欄位更新。

後端只套用存在且唔係空字串嘅欄位。提供 `lat` + `lng` 會重算 HK80；只提供 `hk80_n` + `hk80_e` 會嘗試重算 WGS84。

成功：`{ "ok": true }`。若目標列嘅 `last_client_id` 已等於今次 `client_id`，返回 `{ "ok": true, "duplicate": true, "message": "OK_DUPLICATE" }`。

每次成功更新都會 bump `trees.updated_at`；若請求帶 `base_updated_at`（編輯前睇到嘅版本）而與伺服器當前 `updated_at` 不一致，回 `CONFLICT` + `details:[{field:'tree_id', code:'VERSION_CONFLICT', current_updated_at:'...'}]`，前端應提示用戶重新載入最新資料。

### 3.7 `create_project`

請求欄位：

```json
{
  "type": "create_project", "token": "...", "csrf_token": "...",
  "client_id": "uuid", "client_created_at": "2026-08-19T00:00:00.000Z",
  "name": "泥涌", "custom_id": "NaiChung",
  "lat": "22.400000", "lng": "114.180000"
}
```

`description` 可選但現行建立表單未傳。成功返回 `{ "ok": true, "project_id": "..." }`；重複會加 `duplicate: true` 並返回原 `project_id`。

### 3.8 `create_tree`

請求欄位包括 `tree_id`、`project_id`、`name`、`status`、尺寸欄位、`level`、WGS84 `lat`／`lng`，以及認證與 client metadata。尺寸欄位係：

```text
tree_height, crown_width, dbh, ground_diameter, stem_length,
crown_area, crown_volume
```

可選 `description`、`risk`、`hk80_n`、`hk80_e`、`photo_base64`。`project_id` 必填且必須存在於 `projects` 表（否則回 `VALIDATION_FAILED` + `INVALID_VALUE`，避免建立孤兒樹木）。指定 `tree_id` 格式只容許 Unicode 字母數字 `._-`（≤64 字元），否則回 `VALIDATION_FAILED` + `INVALID_FORMAT`。缺少或留空 `tree_id` 時，後端會喺 Script Lock 內生成該地盤目前最大純數字 `tree_id`＋1；無純數字編號時由 `1` 開始。缺少 `status` 時預設 `Normal`。自動生成及指定嘅純數字編號會以 `Number` 寫入 `trees`；非數字編號則保留字串。建立時會初始寫入 `updated_at`（ISO 時間戳）作為版本基線。

同一 `project_id` 內 `tree_id` 必須唯一。若指定編號已存在，返回：

```json
{ "ok": false, "error_code": "CONFLICT", "error": "CONFLICT", "details": [{"field":"tree_id","code":"ALREADY_EXISTS"}] }
```

純數字編號會按數值比較（例如 `07` 與 `7` 視為相同）；非數字編號（例如 `A001`、`T1222225925`）唔會計入自動接號嘅最大值，但仍受同地盤唯一性檢查。

成功：`{ "ok": true, "tree_id": 7, "photo_urls": [] }`。重複會返回 `ok: true, duplicate: true, tree_id: "..."`。

## 4. 共通錯誤及認證

### 4.1 Body 解析及鎖定錯誤

| 情況 | JSON 返回 |
|---|---|
| POST body 缺失 | `{ "ok": false, "error_code": "INVALID_REQUEST", "error": "INVALID_REQUEST" }` |
| JSON 解析失敗 | `{ "ok": false, "error_code": "INVALID_JSON", "error": "INVALID_JSON" }` |
| Script Lock 10 秒內未取得 | `{ "ok": false, "error_code": "SYSTEM_BUSY", "error": "SYSTEM_BUSY" }` |
| 未支援寫入 type | `{ "ok": false, "error_code": "UNSUPPORTED_OPERATION", "error": "UNSUPPORTED_OPERATION", "details": [{"field":"type","code":"UNSUPPORTED"}] }` |
| 未捕捉後端例外 | `{ "ok": false, "error_code": "INTERNAL_WRITE_ERROR", "error": "INTERNAL_WRITE_ERROR" }` |
| 相片上傳（鎖外）失敗 | `{ "ok": false, "error_code": "UPLOAD_FAILED", "error": "UPLOAD_FAILED" }` |
| 位置超出香港 | `{ "ok": false, "error_code": "INVALID_LOCATION", "error": "INVALID_LOCATION" }` |
| 校驗失敗 | `{ "ok": false, "error_code": "VALIDATION_FAILED", "error": "VALIDATION_FAILED", "details": [{"field":"...","code":"REQUIRED|INVALID_FORMAT|TOO_LONG..."}] }` |
| 樹木編號衝突（create_tree） | `{ "ok": false, "error_code": "CONFLICT", "error": "CONFLICT", "details": [{"field":"tree_id","code":"ALREADY_EXISTS"}] }` |
| 改名衝突（update_tree new_tree_id 已被佔用） | `CONFLICT` + `details:[{field:'new_tree_id', code:'ALREADY_EXISTS'}]` |
| 目標樹木唔存在（update_tree） | `CONFLICT` + `details:[{field:'tree_id', code:'NOT_FOUND'}]` |
| 版本衝突（update_tree base_updated_at 不符） | `CONFLICT` + `details:[{field:'tree_id', code:'VERSION_CONFLICT', current_updated_at:'...'}]` |

GET 例外返回 `{ "ok": false, "error_code": "INTERNAL_READ_ERROR", "error": "INTERNAL_READ_ERROR" }`。錯誤以 JSON body 為主，`GAS/main.gs` 未定義一套業務錯誤對應 HTTP status 嘅合約。所有錯誤對外僅回 `error_code`（`error` 雙寫相容），`details` 僅 `field+code`；前端由 `assets/js/core/error-codes.js` 查表轉譯。


### 4.2 Token 及 CSRF

CSRF 採用同步器 one-time token 模式：`doPost` 鎖外先以 `peekCsrfToken_()` 唯讀檢查，鎖內再驗證一次（防並發消耗）；成功時 `rotateCsrfToken_()` 刪除舊 token、簽發新 token，並注入回應 `csrf_token` 欄位，前端下次請求使用新 token。

除 `login` 外，後端依次驗證：

1. `isValidToken_(d.token)` 失敗：`{ "ok": false, "error_code": "UNAUTHORIZED", "error": "UNAUTHORIZED" }`。
2. `isValidCsrfToken_(...)` 失敗：`{ "ok": false, "error_code": "CSRF_INVALID", "error": "CSRF_INVALID" }`（兼容舊 `CSRF_TOKEN_INVALID`）。

登入成功後：

- Token 存於 Apps Script Cache key `TOKEN_<token>`，TTL `21600` 秒（6 小時）。
- CSRF 存於 key `CSRF_<csrf token>`，value 綁定 session token，TTL 同為 6 小時。
- 前端 `AuthService` 以 `sessionStorage` 儲存 token 及 `until`，本地 session duration 係 4 小時；因此前端本地期限短於後端 Cache TTL。
- 前端 CSRF key 係 `tree_csrf_token`，token storage key 目前係 `tree_staff_token`。

### 4.3 登入 rate-limit

`LOGIN_MAX_FAILURES = 10`、`LOGIN_LOCK_SECONDS = 600`。失敗計數按 `Session.getTemporaryActiveUserKey()`（無法取得時使用 global key）保存。達上限後返回：

```json
{ "ok": false, "error_code": "RATE_LIMITED", "error": "RATE_LIMITED" }
```

成功登入會清除失敗計數。舊中文 `嘗試太頻繁，請稍後再試` 已改為 `RATE_LIMITED`（前端 `ErrorCodes` 轉譯）。

### 4.4 中央校驗規則（GAS/validation.gs）

`validatePostPayload_()` 對所有 POST type 做白名單及欄位限制，失敗時回 `VALIDATION_FAILED`（或 type 唔識別回 `UNSUPPORTED_OPERATION`）：

- 長度限制 `LIMITS_`：`staff` 100、`tree_id` 64、`project_id` 64、`custom_id` 64、`inspection_id` 80、`name` 200、`description`/`note`/`risk` 2000、`level` 100、`client_id` 128、數值欄位 50。
- `status`／`health` 白名單：`Normal` / `Fair` / `Poor` / `Very Poor` / `Dead`。
- `tree_id`／`project_id`／`new_tree_id` 格式：Unicode 字母數字 `._-`（`RE_TREE_ID_SIMPLE_`／`RE_PROJECT_ID_`）。
- `inspection_id` 格式：`^INS-\d+-[0-9a-fA-F]{1,12}$`（`RE_INSPECTION_ID_`）。
- 相片：最多 10 張（`MAX_IMAGE_COUNT_`），單張 base64 ≤15MB、解碼後 ≤10MB，MIME 限 jpeg/png/webp。
- `client_id`：UUID 或 8-128 字元 `[A-Za-z0-9_-]`。
- 位置：`lat/lng` 或 `hk80_n/hk80_e` 必須成對提供；WGS84 lat ∈ [-90,90]、lng ∈ [-180,180]。
- `create_aerial`／`update_project`／`delete_project`／`delete_tree` 只做 type 白名單，唔做欄位校驗（後端亦冇對應 handler，見第 6 節）。

## 5. 冪等及 duplicate

### 5.1 後端檢查

| type | 實際檢查／保存位置 |
|---|---|
| `checkin` | `checkins.client_id` |
| `inspection` | `inspections.client_id` |
| `inspection_photo` | `inspections.photo_client_ids` 逗號分隔集合 |
| `update_tree` | 目標樹木列嘅 `last_client_id` |
| `create_project` | `projects.client_id` |
| `create_tree` | `trees.client_id` |

`checkDuplicate_()` 只會在有 `client_id` 且 Sheet 已有 `client_id` header 時命中；缺少 client ID 時不會拒絕請求。因此 `client_id`／`client_created_at` 係前後端寫入約定，但唔係每個 handler 都有明確 required validation。

### 5.2 返回及前端處理

- `checkin` duplicate：返回 `{ "ok": true, "duplicate": true, "message": "OK_DUPLICATE" }`。
- `inspection` duplicate：返回原 `inspection_id` 及已保存嘅 `photo_urls`，`message` 為 `OK_DUPLICATE`。
- `inspection_photo` duplicate：返回 `OK_DUPLICATE`。
- `update_tree` duplicate：返回 `OK_DUPLICATE`（`last_client_id` 重合）。
- `create_project`／`create_tree` duplicate：返回原本 ID，`message` 為 `OK_DUPLICATE`。
- `ApiService.post` 及 `offline.js` 均將 `duplicate === true` 視為成功；離線記錄會標記 `synced`。

## 6. 前端已列出但後端未實作嘅寫入 type

`assets/js/api.js` 的 `WRITE_TYPES` 除本文已列嘅 type 外，仍包括：

```text
create_aerial, update_project, delete_project, delete_tree
```

現行 `GAS/handlers-post.gs` 對上述四個 type 沒有對應 handler；`GAS/main.gs` 完成 Token／CSRF 驗證及 POST 分派後會返回：

```json
{ "ok": false, "error": "不支援的操作: <type>" }
```

因此呢四個 type 係前端寫入分類／預留能力，並不屬於目前後端可成功執行嘅 API 合約。

## 7. 源碼核對備註

- `t.js` 的 `checkin` payload 目前未傳 `lat`／`lng`，但後端支援並會以空字串寫入缺少值。
- `t.js` 的 `inspection` payload 會傳 `photos_pending`；後端寫入／使用嘅係 `photos_total`，`photos_pending` 目前會被忽略。
- `health`／`status` 五值係前端表單驗證契約，後端目前未做同等白名單驗證。
- `create_project` 前端以 HK80 N/E 輸入，轉成 WGS84 後只傳 `lat`／`lng`；航拍欄位由 `assets/js/modules/map.js` 讀取，但建立 API 不會寫入。
- `GAS/main.gs` 對未知 GET action 不會返回 unsupported error，而係落入 `handleGetTrees_()` 嘅預設 `trees` 查詢。
- `GAS/validation.gs` 嘅 `validateGetParams_` 對 `tree`/`inspections`/`trees` action 校驗參數；未知 action 仍落入 `trees` 預設分支。
- `assets/js/modules/forms.js` 會先做同地盤字串相等嘅即時重複提示；`GAS/tree-id.gs` 會喺後端鎖內再檢查，純數字會按數值比較（例如 `07` 同 `7` 視為重複）。
- `GAS/drive-photos.gs` 嘅多張相片上傳逐張容錯；單張 `inspection_photo` 上傳失敗則回報錯誤。

---

> **最後核對**：2026-08-25。源碼檔案：`GAS/main.gs`、`GAS/handlers-get.gs`、`GAS/handlers-post.gs`、`GAS/sheets-repo.gs`、`GAS/idempotency.gs`、`GAS/drive-photos.gs`、`GAS/validation.gs`、`GAS/error-codes.gs`、`GAS/cache-policy.gs`、`GAS/config.gs`、`GAS/auth.gs`、`GAS/csrf.gs`、`GAS/coordinates.gs`、`GAS/cache.gs`、`GAS/project-utils.gs`、`GAS/utils.gs`、`GAS/backfill.gs`、`GAS/tree-id.gs`、`assets/js/api.js`、`assets/js/pages/t.js`、`assets/js/modules/forms.js`、`assets/js/modules/map.js`、`assets/js/core/error-codes.js`。`GAS/code.gs` 不存在。
