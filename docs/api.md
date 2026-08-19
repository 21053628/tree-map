# API 合約

## 1. 範圍與傳輸格式

本文記錄目前 GAS 後端實作嘅前後端合約。入口係 `GAS/main.gs` 嘅 `doGet(e)`／`doPost(e)`；GET 分派到 `GAS/handlers-get.gs`，POST 寫入分派到 `GAS/handlers-post.gs`。GET 全部公開；POST 除 `login` 外均須 Token 及 CSRF Token。現時 repo 內冇 `GAS/code.gs`。

- `<API_ENDPOINT>` 代表 `Config.API_ENDPOINT`。
- GET：`GET <API_ENDPOINT>?action=...`。
- POST：`POST <API_ENDPOINT>`，前端使用 `Content-Type: text/plain;charset=utf-8`，body 仍然係 JSON 字串。
- 業務結果以 JSON `ok` 欄位為準，唔應只依賴 HTTP status。
- 一般成功：`{ "ok": true, ... }`；一般錯誤：`{ "ok": false, "error": "..." }`。
- `duplicate: true` 代表同一寫入已處理；前端會將其視為成功。

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

`projects` 及 `trees` 分別係 `projects`、`trees` Sheet 全部資料列。服務端使用 `CacheService` key `bootstrap_data` 快取 60 秒（`BOOTSTRAP_CACHE_TTL = 60`）。

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
| `id` | 是（程式未顯式拒絕缺少值） | 樹木編號 `tree_id` |
| `prj` | 否 | 地盤 ID `project_id`；提供時優先揀相同地盤 |

```http
GET <API_ENDPOINT>?action=tree&id=T001&prj=PROJECT-A
```

返回：`{ "ok": true, "data": <樹木物件或 null> }`。找不到時 `data` 為 `null`。

### 2.4 `inspections`

| Query 參數 | 必填 | 說明 |
|---|---:|---|
| `action` | 是 | `inspections` |
| `id` | 是（程式未顯式拒絕缺少值） | 樹木編號 `tree_id` |
| `prj` | 否 | 按 `project_id` 再過濾 |

返回：`{ "ok": true, "data": <巡查記錄陣列> }`；無記錄時係空陣列。服務端一般快取 TTL 為 60 秒。

### 2.5 `projects`

```http
GET <API_ENDPOINT>?action=projects
```

返回：`{ "ok": true, "data": <地盤陣列> }`。服務端一般快取 TTL 為 60 秒。

### 2.6 `trees`（預設 action）

| Query 參數 | 必填 | 說明 |
|---|---:|---|
| `action` | 否 | 缺少時預設 `trees`；未知 action 亦落入此分支 |
| `project` | 否 | 按 `project_id` 過濾 |

返回：`{ "ok": true, "data": <樹木陣列> }`。服務端一般快取 TTL 為 60 秒。

## 3. POST 共通規則

### 3.1 Body 及認證

Body 必須係有效 JSON。除 `login` 外，body 應包含：

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

密碼錯誤：`{ "ok": false, "error": "密碼錯誤" }`。

連續失敗達 10 次後，login failure counter 以 CacheService 鎖 600 秒（10 分鐘），返回：

```json
{ "ok": false, "error": "嘗試太頻繁，請稍後再試" }
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

重複：`{ "ok": true, "duplicate": true, "message": "簽到記錄已存在" }`。

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

成功：

```json
{ "ok": true, "inspection_id": "INS-...", "photo_urls": [] }
```

重複會同樣帶 `duplicate: true`，並盡量返回既有 `inspection_id` 及 `photo_urls`。

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

成功：`{ "ok": true, "photo_url": "https://lh3.googleusercontent.com/d/...=w1200" }`。

重複：`{ "ok": true, "duplicate": true, "message": "相片已存在" }`。

缺少巡查 ID：`{ "ok": false, "error": "缺少 inspection_id" }`。

### 3.6 `update_tree`

部分更新樹木資料。定位欄位係 `tree_id`，`prj` 可選用於限定 `project_id`。

必備／共通欄位：`type`、`token`、`csrf_token`、`client_id`、`client_created_at`、`tree_id`；`prj` 可選。

可更新欄位：

```text
name, status, project_id, risk, description,
tree_height, crown_width, dbh, ground_diameter, stem_length,
crown_area, crown_volume, level, lat, lng, hk80_n, hk80_e
```

另有可選欄位 `new_tree_id`，用於將樹木編號改名；`tree_id` 仍然係定位原有樹木嘅編號。`new_tree_id` 必須為 1 至 64 字元，只可包含英數、中文、點、底線及連字號。改名只會喺同一 `project_id`（地盤）內檢查唯一性；純數字編號會按數值比較，例如 `07` 同 `7` 視為相同。重複時返回：

```json
{ "ok": false, "error": "樹木編號 X 已存在於此地盤，請改用其他編號" }
```

成功改名時，後端會同步將 `inspections` 同 `checkins` 內相同地盤及原編號嘅 `tree_id` 更新為新編號（cascade），並返回：

```json
{ "ok": true, "renamed": true, "new_tree_id": "X" }
```

未有提供 `new_tree_id`，或者其值等於原有編號時，行為與舊版相同，成功返回 `{ "ok": true }`。提供 `new_tree_id` 時仍會一併套用其他樹木欄位更新。

後端只套用存在且唔係空字串嘅欄位。提供 `lat` + `lng` 會重算 HK80；只提供 `hk80_n` + `hk80_e` 會嘗試重算 WGS84。

成功：`{ "ok": true }`。若目標列嘅 `last_client_id` 已等於今次 `client_id`，返回 `{ "ok": true, "duplicate": true, "message": "樹木更新已存在" }`。

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

可選 `description`、`risk`、`hk80_n`、`hk80_e`、`photo_base64`。缺少或留空 `tree_id` 時，後端會喺 Script Lock 內生成該地盤目前最大純數字 `tree_id`＋1；無純數字編號時由 `1` 開始。缺少 `status` 時預設 `Normal`。自動生成及指定嘅純數字編號會以 `Number` 寫入 `trees`；非數字編號則保留字串。

同一 `project_id` 內 `tree_id` 必須唯一。若指定編號已存在，返回：

```json
{ "ok": false, "error": "樹木編號 X 已存在於此地盤，請改用其他編號（或留空自動編號）" }
```

純數字編號會按數值比較（例如 `07` 與 `7` 視為相同）；非數字編號（例如 `A001`、`T1222225925`）唔會計入自動接號嘅最大值，但仍受同地盤唯一性檢查。

成功：`{ "ok": true, "tree_id": 7, "photo_urls": [] }`。重複會返回 `ok: true, duplicate: true, tree_id: "..."`。

## 4. 共通錯誤及認證

### 4.1 Body 解析及鎖定錯誤

| 情況 | JSON 返回 |
|---|---|
| POST body 缺失 | `{ "ok": false, "error": "無效請求" }` |
| JSON 解析失敗 | `{ "ok": false, "error": "無效的 JSON 請求" }` |
| Script Lock 10 秒內未取得 | `{ "ok": false, "error": "系統忙碌中，請稍後再試" }` |
| 未支援寫入 type | `{ "ok": false, "error": "不支援的操作: <type>" }` |
| 未捕捉後端例外 | `{ "ok": false, "error": "伺服器寫入錯誤: <message>" }` |

GET 例外返回 `{ "ok": false, "error": "伺服器讀取錯誤" }`。錯誤以 JSON body 為主，`GAS/main.gs` 未定義一套業務錯誤對應 HTTP status 嘅合約。

### 4.2 Token 及 CSRF

除 `login` 外，後端依次驗證：

1. `isValidToken_(d.token)` 失敗：`{ "ok": false, "error": "UNAUTHORIZED" }`。
2. `isValidCsrfToken_(...)` 失敗：`{ "ok": false, "error": "CSRF_TOKEN_INVALID" }`。

登入成功後：

- Token 存於 Apps Script Cache key `TOKEN_<token>`，TTL `21600` 秒（6 小時）。
- CSRF 存於 key `CSRF_<csrf token>`，value 綁定 session token，TTL 同為 6 小時。
- 前端 `AuthService` 以 `sessionStorage` 儲存 token 及 `until`，本地 session duration 係 4 小時；因此前端本地期限短於後端 Cache TTL。
- 前端 CSRF key 係 `tree_csrf_token`，token storage key 目前係 `tree_staff_token`。

### 4.3 登入 rate-limit

`LOGIN_MAX_FAILURES = 10`、`LOGIN_LOCK_SECONDS = 600`。失敗計數按 `Session.getTemporaryActiveUserKey()`（無法取得時使用 global key）保存。達上限後返回：

```json
{ "ok": false, "error": "嘗試太頻繁，請稍後再試" }
```

成功登入會清除失敗計數。

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

- `checkin` duplicate：返回 `duplicate: true` 及「簽到記錄已存在」。
- `inspection` duplicate：返回原 `inspection_id` 及已保存嘅 `photo_urls`。
- `inspection_photo` duplicate：返回「相片已存在」。
- `update_tree` duplicate：返回「樹木更新已存在」。
- `create_project`／`create_tree` duplicate：返回原本 ID。
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
- `assets/js/modules/forms.js` 會先做同地盤字串相等嘅即時重複提示；`GAS/tree-id.gs` 會喺後端鎖內再檢查，純數字會按數值比較（例如 `07` 同 `7` 視為重複）。
- `GAS/drive-photos.gs` 嘅多張相片上傳逐張容錯；單張 `inspection_photo` 上傳失敗則回報錯誤。

---

> **最後核對**：2026-08-19。源碼檔案：`GAS/main.gs`、`GAS/handlers-get.gs`、`GAS/handlers-post.gs`、`GAS/sheets-repo.gs`、`GAS/idempotency.gs`、`GAS/drive-photos.gs`、`GAS/config.gs`、`GAS/auth.gs`、`GAS/csrf.gs`、`GAS/coordinates.gs`、`GAS/cache.gs`、`GAS/project-utils.gs`、`GAS/utils.gs`、`GAS/backfill.gs`、`GAS/tree-id.gs`、`assets/js/api.js`、`assets/js/pages/t.js`、`assets/js/modules/forms.js`、`assets/js/modules/map.js`。`GAS/code.gs` 不存在。
