# CSS 結構

## 1. 拆分檔及來源 Section

`assets/css/` 現時有 10 個拆分檔，係由原本 `main.css` 的 section 分拆而成。每個檔案頂部註解仍保留原始 section 對應：

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
```

呢個順序係 cascade 合約，不可單獨調亂任何一個檔案；後載入的規則可能依賴或覆蓋前面 section 的 tokens、layout、map 及 UI 規則。`sw.js` 的 `PRECACHE` 亦按同一組 10 個拆分檔預快取。

## 3. `main.css` 現況

目前 repo 的 `assets/css/` 實際清單冇 `main.css` 實體檔案；`index.html` 亦冇引用它，`sw.js` 的 `PRECACHE` 亦冇包含它。現存拆分檔頂部註解只保留「由 `main.css` Section n 拆出」的歷史來源記錄。

因此：

- 不可重新將 `main.css` 加入 HTML `<link>` 或 Service Worker `PRECACHE`。
- 如果部署工作區或其他工作副本仍保留一份未引用的歷史 `main.css` 備份，應先完成視覺測試，再確認無需回溯後刪除；本 repo 當前並無可刪除的 `main.css` 實體檔案。
- 拆分檔係目前唯一正式載入的主頁 CSS 來源。

## 4. 其他頁面的刻意保留

`t.html` 及 `nfc.html` 仍然使用內嵌 `<style>`：

- `t.html` 的 `<style>` 包含樹木詳情、巡查記錄、相片預覽及 responsive 樣式。
- `nfc.html` 的 `<style>` 包含 NFC 表單、容量提示、狀態、歷史及深色模式樣式。

呢兩頁的 inline CSS 尚未抽取到 `assets/css/`，屬於刻意保留的頁面專用樣式，唔應因主頁 CSS 拆分而單獨調整。

---

> **最後核對**：2026-08-19。源碼檔案：`index.html`、`t.html`、`nfc.html`、`sw.js`、`assets/css/tokens.css`、`assets/css/base.css`、`assets/css/layout.css`、`assets/css/map.css`、`assets/css/ui.css`、`assets/css/responsive.css`、`assets/css/dark.css`、`assets/css/filters.css`、`assets/css/gis.css`、`assets/css/performance.css`。目前未發現實體 `assets/css/main.css`。