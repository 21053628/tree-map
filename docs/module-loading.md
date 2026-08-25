# Module Loading Strategy

## Scope

Phase 6 uses a conservative split between page ES Modules and shared classic
scripts. Page-specific entry logic and tree-detail helpers use ES Modules,
while shared services and compatibility bridges remain classic scripts on
their existing global contracts. This is required because `offline.js` hooks
`ApiService.post` and `ApiService.get` at runtime.

Page entry modules must execute only after the classic scripts that establish
their required globals. No API payload, authentication transport, CSRF
handling, or offline hook is changed by the module conversion.

## Loading matrix

| HTML | 實際 script 載入／執行順序 |
| --- | --- |
| `t.html` | `env.js` → `cache-policy.js` → `cache-manager.js` → `config.js` → `audit-log.js` → `error-codes.js` → `api.js` → `auth.js` → `purify.min.js` → `coordinates.js` (ESM) → `offline.js` → `modules/sync-panel.js` → module `pages/t.js` |
| `nfc.html` | `env.js` → `config.js` → `api.js` → module `pages/nfc.js` |
| `index.html` | `env.js` → vendor（Leaflet、marker cluster、`proj4.js`、`DOMPurify`）→ `cache-policy.js` → `cache-manager.js` → `config.js` → `audit-log.js` → `coordinates.js` (ESM) → `error-codes.js` → `ui-progress.js` → `ui-icons.js` → `api.js` → `auth.js` → `offline.js` → `modules/sync-panel.js` → module `app.js` |

| File | Loading mode | Global surface | Used by |
| --- | --- | --- | --- |
| `assets/js/app.js` | ES Module | Uses shared globals where required; no page export contract | `index.html` |
| `assets/js/pages/t.js` | ES Module | `window.TD` and page callbacks | `t.html` |
| `assets/js/pages/nfc.js` | ES Module | Reads `Config` global; no page API export required | `nfc.html` |
| `assets/js/pages/tree-detail/route.js` | ES Module | Initializes `globalThis.TD`; named exports `TD`, `initRoute` | `assets/js/pages/tree-detail/page.js` |
| `assets/js/pages/tree-detail/page.js` | ES Module | Reads `TD`; coordinates page lifecycle | `assets/js/pages/t.js` |
| `assets/js/pages/tree-detail/view.js` | ES Module | Pure rendering functions; no state | `assets/js/pages/tree-detail/page.js` |
| `assets/js/pages/tree-detail/tabs.js` | ES Module | Tab switching logic | `assets/js/pages/tree-detail/page.js` |
| `assets/js/pages/tree-detail/auth-gate.js` | ES Module | Auth gate overlay | `assets/js/pages/tree-detail/page.js` |
| `assets/js/pages/tree-detail/inspection-controller.js` | ES Module | Inspection CRUD; exports `post()` | `assets/js/pages/tree-detail/page.js` |
| `assets/js/pages/tree-detail/tree-edit-controller.js` | ES Module | Tree edit + version conflict detection | `assets/js/pages/tree-detail/page.js` |
| `assets/js/pages/tree-detail/photo-controller.js` | ES Module | Photo management | `assets/js/pages/tree-detail/page.js` |
| `assets/js/pages/tree-detail/nfc-navigation.js` | ES Module | NFC link handling | `assets/js/pages/tree-detail/page.js` |
| `assets/js/pages/tree-detail/td-utils.js` | ES Module | Initializes/retains `window.TD`; named exports for helpers | `assets/js/pages/tree-detail/*.js` |
| `assets/js/pages/tree-detail/td-photos.js` | ES Module | Reads `window.TD`; named exports for photo actions | `assets/js/pages/tree-detail/*.js` |
| `assets/js/pages/tree-detail/td-logs.js` | ES Module | Reads `window.TD`; uses page callback bridge | `assets/js/pages/tree-detail/page.js` |
| `assets/js/env.js` | Plain script | `globalThis.ENV` | `index.html`, `t.html`, `nfc.html` |
| `assets/js/config.js` | Plain script | `window.Config` / `Config` | `index.html`, `t.html`, `nfc.html`, shared services |
| `assets/js/api.js` | Plain script | `ApiService` / `window` global contract | `index.html`, `t.html`, `offline.js`, page logic |
| `assets/js/auth.js` | Plain script | `AuthService` / `window` global contract | `index.html`, `t.html`, page logic |
| `offline.js` | Plain script | `window.OfflineQueue`, `pwaToast`, `syncOutbox`, `syncNow`, `warmGAS`, `TreeSnapshot` | `index.html`, `t.html` |
| `assets/js/modules/sync-panel.js` | Plain script | Synchronisation UI and `window.OfflineQueue` | `index.html`, `t.html` |
| `assets/js/core/utils.js` | ES Module | Named utility exports | Page/application modules |
| `assets/js/core/event-bus.js` | ES Module | Module exports | Application modules |
| `assets/js/core/cache-policy.js` | Plain script | `CachePolicy` / `globalThis` | `index.html`, `t.html`, `api.js`, `offline.js`, `sw.js` |
| `assets/js/core/cache-manager.js` | Plain script | `CacheManager` / `globalThis` | `index.html`, `t.html` |
| `assets/js/core/error-codes.js` | Plain script | `ErrorCodes` / `globalThis` | `index.html`, `t.html` |
| `assets/js/core/coordinates.js` | ES Module | `globalThis.CoordUtils`/`CoordLazy` | `index.html`, `t.html` |
| `assets/js/core/spatial-index.js` | ES Module | Module exports | `assets/js/app.js` |
| `assets/js/ui-progress.js` | Plain script | Progress bar UI | `index.html`, `t.html`, `nfc.html` |
| `assets/js/ui-icons.js` | Plain script | SVG icon sprite helpers | `index.html` |
| `assets/js/modules/audit-log.js` | Plain script | Existing global audit API | `index.html`, `t.html` and shared services |
| `assets/js/modules/state.js` | ES Module | Business data state | `assets/js/app.js` |
| `assets/js/modules/ui-state.js` | ES Module | UI layer state | `assets/js/app.js` |
| `assets/js/modules/dom.js` | ES Module | DOM cache | `assets/js/app.js` |
| `assets/js/modules/map.js` | ES Module | Map logic | `assets/js/app.js` |
| `assets/js/modules/search.js` | ES Module | Tree search | `assets/js/app.js` |
| `assets/js/modules/species.js` | ES Module | Species repository | `assets/js/app.js` |
| `assets/js/modules/trees.js` | ES Module | Tree data rendering | `assets/js/app.js` |
| `assets/js/modules/filters.js` | ES Module | Filter panel | `assets/js/app.js` |
| `assets/js/modules/projects.js` | ES Module | Project selection | `assets/js/app.js` |
| `assets/js/modules/locate.js` | ES Module | Tree location/view state | `assets/js/app.js` |
| `assets/js/modules/lots.js` | ES Module | Lot boundary display | `assets/js/app.js` |
| `assets/js/modules/forms.js` | ES Module | Tree/project creation forms | `assets/js/app.js` |
| `assets/js/modules/draw.js` | ES Module | Drawing tools (line/area only) | `assets/js/app.js` |
| `assets/js/modules/geolocate.js` | ES Module | GPS geolocation | `assets/js/app.js` |
| `assets/js/modules/loader.js` | ES Module | Data loading orchestration | `assets/js/app.js` |
| `assets/js/sw-register.js` | Plain script (`defer`) | Service-worker registration | `index.html`, `t.html` |
| `assets/vendor/*.js` | Plain vendor scripts | Vendor globals such as `L`, `proj4`, and `DOMPurify` | Pages and shared scripts |

`draw.js` 已移除 polygon 模式，量測只保留 line／area。

`assets/js/core/global-utils.js` 實體存在（掛載 `window.TreeUtils`），但未被任何 HTML 頁面引用，屬歷史保留。全 repo 搜尋確認沒有剩餘 `window.TreeUtils` runtime consumers；module pages now consume named exports from `assets/js/core/utils.js`.

## Deliberately plain scripts

The following files must remain plain scripts with their existing contracts:

- `config.js`
- `api.js`
- `auth.js`
- `offline.js`
- `sync-panel.js`
- vendor libraries

The reason is compatibility with the runtime hook in `offline.js`:

```js
ApiService.post = /* offline-aware wrapper */;
ApiService.get = /* offline-aware wrapper */;
```

`offline.js` must run after `ApiService` has been established and before page
code starts making requests. Converting either side of that contract without
an explicit compatibility bridge could make offline queueing silently fail.

## Module contracts

`t.js` imports the shared utilities from `core/utils.js` and imports the
twelve tree-detail modules (via `page.js`). The tree-detail modules retain only
`window.TD` as a low-risk shared state bridge; `TDUtils`, `TDPhotos`, and
`TDLogs` are no longer global objects.

The tree-detail page continues to read these shared runtime services from
their classic-script globals:

- `Config`
- `ApiService`
- `AuthService`
- `OfflineQueue`
- `pwaToast`
- `L`
- `DOMPurify`
- `window.CoordUtils` / `window.CoordLazy`（由 `core/coordinates.js` ESM 提供）

The module entry does not convert `offline.js`, so offline queueing retains its
existing behavior. Coordinate conversion is provided by the `coordinates.js`
ES Module (which also exposes `CoordUtils`/`CoordLazy` globals).

## Phase status

### Completed

- Phase 6.1: shared service loading was consolidated without changing the
  service contracts.
- Phase 6.2: `assets/js/pages/nfc.js` became an ES Module and imports
  `escapeHtml` and `sanitizeId` from `assets/js/core/utils.js`.
- Phase 6.3: `t.js` and `assets/js/pages/tree-detail/*.js` became ES Modules;
  `t.html` loads the plain offline infrastructure before the module entry.
- Phase 6.4: the unused `global-utils.js` compatibility bridge remains as historical file (not referenced by any HTML).
- `nfc.html` keeps `config.js` before its module entry.
- `index.html` keeps classic services and `offline.js` before `app.js`.

## Ordering rules

For `t.html`, the page service／module order is:

1. `env.js`
2. `core/cache-policy.js`
3. `core/cache-manager.js`
4. `config.js`
5. `audit-log.js`
6. `error-codes.js`
7. `api.js`
8. `auth.js`
9. `purify.min.js`
10. `core/coordinates.js` (ES Module)
11. `offline.js`
12. `modules/sync-panel.js`
13. `pages/t.js` (ES Module)

`sw-register.js` remains a separate deferred registration script; `leaflet.js`
is a deferred vendor script declared before the page services in the HTML.

The module entry imports `core/utils.js` and the tree-detail modules. The
plain scripts before it establish the API/auth/offline globals. In
particular, `offline.js` and `sync-panel.js` must remain before `t.js` so the
`ApiService` hook and sync panel initialization are ready before page logic
runs.

For `nfc.html`, `env.js` and `config.js` and `api.js` remain before the `nfc.js` module entry.
`nfc.html` uses external CSS (`assets/css/pages/nfc.css`) loaded via `<link>`.

`assets/js/core/coordinates.js` provides both `CoordUtils` and `CoordLazy`
globals via ESM, so no separate plain-script forwarding layer is needed.

## Service Worker precache

`sw.js` 目前版本係 `v1.0.0-beta`，對應 cache 名稱
`precache-1.0.0-beta`、`runtime-1.0.0-beta`、`data-1.0.0-beta`、`tiles-1.0.0-beta`、`images-1.0.0-beta`。`PRECACHE` 包含以下 13 個拆分 CSS 及 2 個頁面 CSS：

```text
tokens.css, base.css, layout.css, map.css, ui.css,
responsive.css, dark.css, filters.css, gis.css, performance.css,
skeleton.css, animations.css, utilities.css
pages/t.css, pages/nfc.css
```

亦包含 `assets/js/pages/tree-detail/` 下 12 個 module（`route.js`、`page.js`、`view.js`、`tabs.js`、`auth-gate.js`、`inspection-controller.js`、`tree-edit-controller.js`、`photo-controller.js`、`nfc-navigation.js`、`td-utils.js`、`td-photos.js`、`td-logs.js`），以及其他頁面／application modules。`assets/css/main.css` 實體存在但唔在 `PRECACHE`，亦唔在任何 HTML `<link>` 載入順序內；`main.css` 只作歷史來源／備份名稱出現在拆分檔註解，並非目前可載入檔案。

`offline.js` 必須先於 `t.js` module 執行：它會保存並替換
`ApiService.post`／`ApiService.get`，建立離線 fallback、GET cache 及
同步 hook；調亂順序會令頁面請求可能未套用離線攔截。

## Verification and rollback

Each sub-phase should be checked independently on `index.html`, `t.html`,
and `nfc.html`, with special attention to login, inspection upload, photo
upload, offline outbox queueing, reconnect synchronization, and NFC writing.

Before changing the high-risk `t.html` path, create a clean Git commit when
Git is available. If a future module conversion affects the `offline.js` hook
or requires changing the hook itself, stop and roll back that sub-phase
instead of changing the hook.

Static checks can verify syntax, import paths, loading order, and precache
entries. Browser-only checks (NFC writing, clipboard permissions, and offline
outbox synchronization) remain manual acceptance tests and must not be
claimed as passed by static analysis.

---

> **最後核對**：2026-08-25。源碼檔案：`index.html`、`t.html`、`nfc.html`、`offline.js`、`sw.js`、`assets/js/api.js`、`assets/js/config.js`、`assets/js/auth.js`、`assets/js/env.js`、`assets/js/core/cache-policy.js`、`assets/js/core/cache-manager.js`、`assets/js/core/error-codes.js`、`assets/js/core/coordinates.js`、`assets/js/core/spatial-index.js`、`assets/js/core/utils.js`、`assets/js/core/event-bus.js`、`assets/js/ui-progress.js`、`assets/js/ui-icons.js`、`assets/js/modules/audit-log.js`、`assets/js/modules/sync-panel.js`、`assets/js/modules/state.js`、`assets/js/modules/ui-state.js`、`assets/js/modules/dom.js`、`assets/js/modules/map.js`、`assets/js/modules/search.js`、`assets/js/modules/species.js`、`assets/js/modules/trees.js`、`assets/js/modules/filters.js`、`assets/js/modules/projects.js`、`assets/js/modules/locate.js`、`assets/js/modules/lots.js`、`assets/js/modules/forms.js`、`assets/js/modules/draw.js`、`assets/js/modules/geolocate.js`、`assets/js/modules/loader.js`、`assets/js/sw-register.js`、`assets/js/app.js`、`assets/js/pages/t.js`、`assets/js/pages/nfc.js`、`assets/js/pages/tree-detail/route.js`、`assets/js/pages/tree-detail/page.js`、`assets/js/pages/tree-detail/view.js`、`assets/js/pages/tree-detail/tabs.js`、`assets/js/pages/tree-detail/auth-gate.js`、`assets/js/pages/tree-detail/inspection-controller.js`、`assets/js/pages/tree-detail/tree-edit-controller.js`、`assets/js/pages/tree-detail/photo-controller.js`、`assets/js/pages/tree-detail/nfc-navigation.js`、`assets/js/pages/tree-detail/td-utils.js`、`assets/js/pages/tree-detail/td-photos.js`、`assets/js/pages/tree-detail/td-logs.js`。`assets/js/api-config.js`、`assets/js/api-config.example.js` 及 `assets/js/core/coord-lazy.js` 已移除。`assets/js/core/global-utils.js`、`assets/js/utils.js` 及 `assets/css/main.css` 實體存在但未被引用。
