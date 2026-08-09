# 樹木管理 GIS (Tree Management GIS)

一個基於 Web 的樹木管理系統，提供互動地圖、樹木巡查、簽到及 NFC 標籤集成功能。

## 🌳 功能特點

- **互動地圖**：使用 Leaflet.js 顯示樹木位置，支援聚合標記 (MarkerCluster)
- **項目管理**：可建立及管理多個地盤項目
- **樹木管理**：新增、編輯樹木記錄，包含樹種、健康狀況等資訊
- **離線支援**：PWA (Progressive Web App) 架構，支援離線操作
- **NFC 集成**：透過 NFC 標籤快速識別樹木
- **響應式設計**：支援手機、平板等移動設備
- **多底圖切換**：提供多種地圖圖層選擇

## 📁 專案結構

```
.
├── index.html              # 主頁面（互動地圖）
├── nfc.html                # NFC 樹木導覽系統
├── t.html                  # 樹木詳情頁面
├── manifest.webmanifest    # PWA 應用清單
├── sw.js                   # Service Worker（離線快取）
├── offline.js              # 離線佇列管理
├── assets/
│   ├── css/
│   │   └── main.css        # 主要樣式表
│   ├── js/
│   │   ├── app.js          # 主應用程式邏輯
│   │   ├── api.js          # API 通訊模組
│   │   ├── auth.js         # 認證模組
│   │   ├── config.js       # 配置模組
│   │   └── utils.js        # 工具函數
│   └── icons/              # 應用圖標
├── data/
│   └── trees_data.json     # 樹木物種資料
└── README.md               # 本說明文件
```

## 🚀 快速開始

### 直接部署

1. 將所有檔案上傳至任何靜態網頁伺服器（如 GitHub Pages、Netlify、Vercel）
2. 開啟 `index.html` 即可使用

### 本地開發

使用任意靜態伺服器：

```bash
# 使用 Python
python -m http.server 8000

# 使用 Node.js (需安裝 http-server)
npx http-server -p 8000
```

然後在瀏覽器開啟 `http://localhost:8000`

## ⚙️ 配置

### API 端點

在 `assets/js/config.js` 中配置 Google Apps Script API 端點：

```javascript
const Config = {
  API_ENDPOINT: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
  // ...其他配置
};
```

### PWA 設置

- `manifest.webmanifest`：定義應用名稱、圖標、主題色等
- `sw.js`：Service Worker，處理離線快取
- `offline.js`：管理離線時的請求佇列

## 🗺️ 地圖功能

### 支援的底圖

- CartoDB Positron（預設）
- OpenStreetMap
- Satellite 衛星圖
- HK Map 香港地圖

### 座標系統

支援 HK80 與 WGS84 座標轉換：

```javascript
// 在 config.js 中定義
PROJECTIONS: {
  HK80: '+proj=tmerc +lat_0=22.31213333333334...',
  WGS84: '+proj=longlat +datum=WGS84 +no_defs'
}
```

## 🌲 樹木狀態

系統支援以下樹木健康狀態：

| 狀態 | 顏色代碼 |
|------|----------|
| Normal（正常） | #2e7d32 |
| Fair（一般） | #f9a825 |
| Poor（差） | #ef6c00 |
| Very Poor（極差） | #c62828 |
| Dead（死亡） | #424242 |
| Unknown（未知） | #757575 |

## 📱 NFC 功能

`nfc.html` 提供 NFC 標籤讀寫功能：

- 讀取 NFC 標籤中的樹木 ID
- 將樹木資訊寫入 NFC 標籤
- 快速連結至樹木詳情頁面

## 🔐 安全性

- 使用 DOMPurify 防止 XSS 攻擊
- Content Security Policy (CSP) 限制資源載入
- 會話認證機制（30 分鐘過期）

## 🛠️ 技術棧

- **前端框架**：純 JavaScript (Vanilla JS)
- **地圖庫**：Leaflet.js + MarkerCluster
- **座標轉換**：Proj4js
- **安全**：DOMPurify
- **PWA**：Service Worker + Web Manifest
- **CDN**：jsDelivr, unpkg, Cloudflare

## 📄 授權

本專案供樹木管理用途使用。

## 🤝 貢獻

歡迎提交 Issue 和 Pull Request 以改進此系統。

## 📞 聯絡

如有問題或建議，請透過 Issue 追蹤系統聯繫。
