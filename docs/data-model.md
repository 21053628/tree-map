# 資料模型

## 1. 範圍及共通規則

本文根據 `GAS/sheets-repo.gs` 嘅 `appendByHeader_()`／更新函式、`GAS/handlers-post.gs` 實際寫入物件，以及 `assets/js/modules/map.js` 嘅 `refreshAerial()` 記錄四張 Google Sheet。後端入口係 `GAS/main.gs`；repo 內冇 `GAS/code.gs`。Sheet 名稱：

| 常數 | Sheet |
|---|---|
| `SH_TREES` | `trees` |
| `SH_INS` | `inspections` |
| `SH_CHK` | `checkins` |
| `SH_PRJ` | `projects` |

`appendByHeader_()` 按第一行 header 名稱寫入，遇到新 key 會動態新增欄位；所以本文係目前合約欄位，唔代表 Google Sheets 原生 UNIQUE constraint。

### 座標

- `lat`／`lng`：WGS84 緯度／經度。
- `hk80_n`／`hk80_e`：HK80 Northing／Easting。
- 樹木建立／更新會按需要進行 WGS84 ↔ HK80 轉換。
- 前端表單輸入 HK80 N/E，轉換後送出 WGS84 `lat`／`lng`。
- `projects` 基線欄位只有 WGS84 `lat`／`lng`，冇 `hk80_n`／`hk80_e`。

### 合法值

`trees.status` 同 `inspections.health` 由前端使用以下白名單：

```text
Normal / Fair / Poor / Very Poor / Dead
```

目前後端未對兩者再做白名單拒絕。

### 冪等欄位

- `client_id`：寫入請求冪等 key。
- `client_created_at`：客戶端建立時間，配合 `client_id` 追蹤。
- `last_client_id`：`update_tree` 最後成功更新嘅 client ID。
- `photo_client_ids`：巡查獨立相片已處理嘅 client ID，以逗號分隔；由 `inspection_photo` 追加，並由 `checkPhotoDuplicate_()` 掃描。

## 2. `trees` 表

欄位：

```text
tree_id, name, lat, lng, status, risk, photo_url, description,
tree_height, crown_width, dbh, ground_diameter, stem_length,
crown_area, crown_volume, project_id, level, hk80_n, hk80_e,
client_id, client_created_at, last_client_id
```

| 欄位 | 說明／識別角色 |
|---|---|
| `tree_id` | 樹木編號；邏輯識別欄位。缺少時後端生成。 |
| `project_id` | 所屬地盤；程式查找時可同 `tree_id` 一起限定。 |
| `lat`, `lng` | WGS84。 |
| `status` | 五個合法狀態值之一。 |
| `risk`, `description` | 風險及描述。 |
| `tree_height`, `crown_width`, `dbh`, `ground_diameter`, `stem_length`, `crown_area`, `crown_volume`, `level` | 尺寸／標高資料。 |
| `hk80_n`, `hk80_e` | HK80 座標。 |
| `photo_url` | 樹木主相片 URL；建立樹木相片時保存第一條。 |
| `name` | 樹木名稱。 |
| `client_id` | `create_tree` 冪等 key。 |
| `client_created_at` | 建立請求時間。 |
| `last_client_id` | `update_tree` 冪等 key／最後更新標記。 |

`update_tree` 成功後寫入 `last_client_id`；`create_tree` 初次 payload 未帶此欄位，header 可由後續更新動態加入。程式以 `tree_id` 定位，提供 `prj` 時再比對 `project_id`；跨地盤整合宜以 `(project_id, tree_id)` 作穩妥組合識別。`updateTreeFields_()` 及 `updateInspectionFields_()` 都會按需要動態新增缺少嘅 header。

### `tree_id` 編號約定

- 編號唯一性係以同一 `project_id` 內嘅 `(project_id, tree_id)` 配對判斷；唔係 Google Sheets 原生 UNIQUE constraint。
- 指定編號如同地盤已有相同編號，後端返回 `ok: false` 及「樹木編號 X 已存在於此地盤，請改用其他編號（或留空自動編號）」。
- `tree_id` 留空時，`GAS/tree-id.gs` 嘅 `nextTreeId_()` 會喺 Script Lock 內找同地盤最大純數字編號再加一；冇純數字時由 `1` 開始。
- 自動接號只計算符合純數字格式嘅編號；舊有 `T`＋timestamp 或其他非數字編號會保留，但唔會參與最大值計算。
- 指定及自動生成嘅純數字編號會由 `normalizeTreeId_()` 轉成 `Number` 寫入 Sheet；純數字 `07` 同 `7` 會視為同一編號。非數字編號保留字串。
- `GAS/handlers-post.gs` 會先喺鎖外預檢，再喺鎖內作最終重複確認，避免並發新增撞號。

## 3. `inspections` 表

欄位：

```text
inspection_id, time, staff, tree_id, project_id, health, note,
photo_url, lat, lng, photos_total, client_id, client_created_at,
photo_client_ids
```

| 欄位 | 說明／識別角色 |
|---|---|
| `inspection_id` | 後端生成 `INS-<timestamp>-<uuid片段>`；巡查主鍵。 |
| `time` | 後端日期，格式 `yyyy-MM-dd`。 |
| `staff` | 工作人員。 |
| `tree_id`, `project_id` | 被巡查樹木及地盤。 |
| `health` | 五個合法健康值之一。 |
| `note` | 備註。 |
| `photo_url` | 相片 URL；多張以逗號分隔。 |
| `lat`, `lng` | 巡查位置 WGS84。 |
| `photos_total` | 相片總數。 |
| `client_id` | `inspection` 冪等 key。 |
| `client_created_at` | 客戶端建立時間。 |
| `photo_client_ids` | `inspection_photo` 冪等集合，以逗號分隔。 |

兩階段模式會先以 `photos_total > 0` 及空 `photo_base64` 建立 metadata，再由 `inspection_photo` append `photo_url` 及 `photo_client_ids`。建立巡查時只要有一張以上已成功上傳相片，後端會把第一條 URL 更新到對應 `trees.photo_url`；分階段上傳時，第一張追加相片亦會更新該欄位。

## 4. `checkins` 表

欄位：

```text
time, staff, tree_id, project_id, lat, lng, client_id, client_created_at
```

- `time`：後端 `yyyy-MM-dd` 日期。
- `staff`：工作人員。
- `tree_id`／`project_id`：簽到對象。
- `lat`／`lng`：WGS84 簽到位置。
- `client_id`：簽到冪等 key；表內冇後端生成嘅 `checkin_id`。
- `client_created_at`：客戶端建立時間。

因此 `checkins` 無獨立資料庫主鍵；目前應用層以 `client_id` 作唯一寫入識別。

## 5. `projects` 表

基線欄位：

```text
project_id, name, lat, lng, description, created_at,
client_id, client_created_at
```

| 欄位 | 說明／識別角色 |
|---|---|
| `project_id` | 地盤主鍵／邏輯唯一識別，由 `name`／`custom_id` 產生。 |
| `name` | 地盤名稱。 |
| `lat`, `lng` | 地盤中心 WGS84。 |
| `description` | 描述。 |
| `created_at` | 後端 `yyyy-MM-dd` 日期。 |
| `client_id` | `create_project` 冪等 key。 |
| `client_created_at` | 客戶端建立時間。 |

### 航拍預留欄位

`refreshAerial()` 會讀取以下六欄：

```text
aerial_url, aerial_n1, aerial_e1, aerial_n2, aerial_e2, aerial_type
```

- `aerial_url`：影像 URL 或 tiles URL。
- `aerial_n1`／`aerial_e1`：第一個（西南）HK80 N/E 點。
- `aerial_n2`／`aerial_e2`：第二個（東北）HK80 N/E 點。
- `aerial_type`：`tiles` 時使用 Leaflet tile layer；其他值（預設 `image`）使用 image overlay。

前端會將兩組 HK80 邊界轉成 WGS84 後建立 Leaflet bounds。`create_project` 目前唔會寫入航拍欄位；呢六欄係表內預留／人工或其他流程配置。

## 6. 主鍵及唯一性總結

| 表 | 主鍵／邏輯識別 | Idempotency |
|---|---|---|
| `trees` | `tree_id`；建議 `(project_id, tree_id)` | `client_id`（建立）、`last_client_id`（更新） |
| `inspections` | `inspection_id` | `client_id`、`photo_client_ids` |
| `checkins` | 無獨立 ID；`client_id` | `client_id` |
| `projects` | `project_id` | `client_id` |

`checkDuplicate_()` 係掃描欄位值，並非試算表資料庫級 constraint；`photo_client_ids` 亦係逗號分隔字串掃描。

## 7. 核對備註

- 實際 Sheet 可以因 `appendByHeader_()` 動態新增欄位而多於本文列出嘅基線欄位。
- 航拍欄位由 `map.js` 讀取，但建立地盤 API 未寫入。
- `status`／`health` 嘅五值係前端驗證契約，後端目前未重複驗證。
- `trees.last_client_id` 只由 `update_tree` 寫入。

---

> **最後核對**：2026-08-19。源碼檔案：`GAS/main.gs`、`GAS/handlers-post.gs`、`GAS/sheets-repo.gs`、`GAS/idempotency.gs`、`GAS/tree-id.gs`、`GAS/drive-photos.gs`、`GAS/config.gs`、`GAS/coordinates.gs`、`GAS/cache.gs`、`GAS/project-utils.gs`、`GAS/utils.gs`、`GAS/backfill.gs`、`assets/js/modules/forms.js`、`assets/js/modules/map.js`。`GAS/code.gs` 不存在。
