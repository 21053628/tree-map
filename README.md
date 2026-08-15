# 樹木管理 GIS 系統

一個專業的樹木資訊管理系統，支援離線操作、NFC 標籤讀取、地圖定位及巡查簽到功能。

## 🌳 功能特點

- **離線優先 (Offline-First)**：採用 PWA 技術，支援離線環境下繼續工作
- **地圖整合**：整合 Leaflet 地圖，顯示樹木位置及地盤範圍
- **NFC 支援**：透過 NFC 標籤快速識別樹木
- **搜尋功能**：快速搜尋樹木編號或樹種名稱
- **過濾系統**：按樹木狀態進行篩選
- **多項目管理**：支援多個地盤項目管理
- **響應式設計**：支援桌面及移動設備

## 📁 專案結構

```
.
├── index.html              # 主頁面入口
├── t.html                  # 樹木詳情頁面
├── nfc.html                # NFC 功能頁面
├── manifest.webmanifest    # PWA Manifest
├── sw.js                   # Service Worker (離線快取)
├── offline.js              # 離線處理邏輯
├── assets/
│   ├── css/
│   │   └── main.css        # 主要樣式
│   ├── js/
│   │   ├── app.js          # 主入口 (ES Modules)
│   │   ├── config.js       # 設定配置
│   │   ├── utils.js        # 工具函數
│   │   ├── api.js          # API 服務
│   │   ├── auth.js         # 認證服務
│   │   ├── core/           # 核心模組
│   │   ├── modules/        # 功能模組
│   │   └── pages/          # 頁面模組
│   └── vendor/             # 第三方庫 (Leaflet, proj4 等)
├── icons/                  # 應用圖標
└── data/                   # 資料目錄
```

## 🚀 使用方式

### 本機開發

由於專案使用 ES Modules 和 Service Worker，需要透過 HTTP 伺服器運行：

```bash
# 使用 Python
python -m http.server 8000

# 或使用 Node.js
npx serve .

# 然後開啟瀏覽器訪問 http://localhost:8000
```

### 部署

1. 將所有檔案上傳至 HTTPS 伺服器（PWA 要求 HTTPS）
2. 確保 `manifest.webmanifest` 和 Service Worker 正確載入
3. 使用者可將應用安裝至主畫面作為獨立應用使用

## 🔧 技術棧

- **前端框架**：原生 JavaScript (ES Modules)
- **地圖庫**：Leaflet + Leaflet.MarkerCluster
- **坐標轉換**：proj4js
- **PWA**：Service Worker + Web App Manifest
- **UI**：自定義 CSS

## 📱 PWA 功能

- ✅ 離線快取（靜態資源、地圖瓦片、API 數據）
- ✅ 可安裝至主畫面
- ✅ 全螢幕獨立運行
- ✅ 背景同步更新

## 🗺️ 地圖服務

整合香港政府地理空間數據平台：
- 基礎地圖：GeoDataHK
- 坐標系統：HK80 / WGS84

## 📊 版本歷史

- **v2.55**：狀態雲「彈前→漸退」效果優化
- **v2.54**：兩段式載入（快照 → GAS 背景刷新）
- **v2.53+**：ES Modules 重構，提升載入效能

## 🔐 安全性

- Content Security Policy (CSP) 防護
- HTTPS 強制要求（生產環境）
- DOM XSS 防護（使用 DOMPurify）

## 📝 授權

本專案為內部系統，未經授權不得複製或分發。

## 🤝 貢獻

如需修改或新增功能，請遵循以下規範：

1. 使用 ES Modules 語法
2. 保持離線優先原則
3. 測試 Service Worker 快取行為
4. 確保移動設備相容性

## 📞 聯絡

如有問題，請聯絡系統管理員。
