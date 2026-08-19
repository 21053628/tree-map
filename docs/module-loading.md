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
| `t.html` | `config.js` → `api-config.js` → `audit-log.js` → `api.js` → `auth.js` → `purify.min.js` → `core/coord-lazy.js` → `offline.js` → `modules/sync-panel.js` → module `pages/t.js` |
| `nfc.html` | `config.js` → `api-config.js` → module `pages/nfc.js` |
| `index.html` | shared classic scripts（`config.js` → `api-config.js` → `audit-log.js` → `utils.js` → `api.js` → `auth.js` → `offline.js` → `sync-panel.js`）→ vendor（Leaflet、marker cluster、`proj4.js`、`DOMPurify`）→ module `app.js` |

| File | Loading mode | Global surface | Used by |
| --- | --- | --- | --- |
| `assets/js/app.js` | ES Module | Uses shared globals where required; no page export contract | `index.html` |
| `assets/js/pages/t.js` | ES Module | `window.TD` and page callbacks | `t.html` |
| `assets/js/pages/nfc.js` | ES Module | Reads `Config` global; no page API export required | `nfc.html` |
| `assets/js/pages/tree-detail/td-utils.js` | ES Module | Initializes/retains `window.TD`; named exports for helpers | `assets/js/pages/t.js` |
| `assets/js/pages/tree-detail/td-photos.js` | ES Module | Reads `window.TD`; named exports for photo actions | `assets/js/pages/t.js` |
| `assets/js/pages/tree-detail/td-logs.js` | ES Module | Reads `window.TD`; uses page callback bridge for photo actions | `assets/js/pages/t.js` |
| `assets/js/config.js` | Plain script | `window.Config` / `Config` | `index.html`, `t.html`, `nfc.html`, shared services |
| `assets/js/api-config.js` | Plain script | Shared API configuration | `index.html`, `t.html`, `nfc.html` and API code |
| `assets/js/api.js` | Plain script | `ApiService` / `window` global contract | `index.html`, `t.html`, `offline.js`, page logic |
| `assets/js/auth.js` | Plain script | `AuthService` / `window` global contract | `index.html`, `t.html`, page logic |
| `offline.js` | Plain script | `window.OfflineQueue`, `window.syncNow`, and `ApiService` hooks | `index.html`, `t.html` |
| `assets/js/modules/sync-panel.js` | Plain script | Synchronisation UI and `window.OfflineQueue` | `index.html`, `t.html` |
| `assets/js/utils.js` | Plain script | `window.CoordUtils` | `index.html` and classic-script consumers |
| `assets/js/core/utils.js` | ES Module | Named utility exports | Page/application modules |
| `assets/js/core/coord-lazy.js` | Plain script | `window.CoordLazy` | `t.html` and `assets/js/pages/t.js` |
| `assets/js/core/event-bus.js` | ES Module | Module exports | Application modules |
| `assets/js/modules/audit-log.js` | Plain script | Existing global audit API | `index.html`, `t.html` and shared services |
| `assets/js/sw-register.js` | Plain script (`defer`) | Service-worker registration | `index.html`, `t.html` |
| `assets/js/modules/*.js` | Existing application modules | Follow each module's current contract | `assets/js/app.js` |
| `assets/vendor/*.js` | Plain vendor scripts | Vendor globals such as `L`, `proj4`, and `DOMPurify` | Pages and shared scripts |

`assets/js/core/global-utils.js` was removed in Phase 6.4. Full repository
search found no remaining `window.TreeUtils` runtime consumers; only old
documentation and a source comment still mention the former filename. Module
pages now consume named exports from `assets/js/core/utils.js`.

## Deliberately plain scripts

The following files must remain plain scripts with their existing contracts:

- `config.js`
- `api-config.js`
- `api.js`
- `auth.js`
- `offline.js`
- `sync-panel.js`
- `utils.js`
- `core/coord-lazy.js`
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
three tree-detail modules directly. The tree-detail modules retain only
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
- `window.CoordLazy`

The module entry does not convert `offline.js` or `core/coord-lazy.js`, so
offline queueing and lazy `proj4` loading retain their existing behavior.

## Phase status

### Completed

- Phase 6.1: shared service loading was consolidated without changing the
  service contracts.
- Phase 6.2: `assets/js/pages/nfc.js` became an ES Module and imports
  `escapeHtml` and `sanitizeId` from `assets/js/core/utils.js`.
- Phase 6.3: `t.js` and `assets/js/pages/tree-detail/*.js` became ES Modules;
  `t.html` loads the plain offline infrastructure before the module entry.
- Phase 6.4: the unused `global-utils.js` compatibility bridge and its stale
  HTML/precache references were removed.
- `nfc.html` keeps `config.js` and `api-config.js` before its module entry.
- `index.html` keeps classic services and `offline.js` before `app.js`.

## Ordering rules

For `t.html`, the page service／module order is:

1. `config.js`
2. `api-config.js`
3. `audit-log.js`
4. `api.js`
5. `auth.js`
6. `purify.min.js`
7. `core/coord-lazy.js`
8. `offline.js`
9. `modules/sync-panel.js`
10. `pages/t.js` (ES Module)

`sw-register.js` remains a separate deferred registration script; `leaflet.js`
is a deferred vendor script declared before the page services in the HTML.

The module entry imports `core/utils.js` and the tree-detail modules. The
plain scripts before it establish the API/auth/offline globals. In
particular, `offline.js` and `sync-panel.js` must remain before `t.js` so the
`ApiService` hook and sync panel initialization are ready before page logic
runs.

For `nfc.html`, `config.js` and `api-config.js` remain before the `nfc.js`
module entry. `nfc.html` intentionally keeps its page CSS in an inline
`<style>` block.

`core/coord-lazy.js` must remain a plain script because it lazily loads
`proj4.js` on first coordinate conversion and exposes `window.CoordLazy`.

## Service Worker precache

`sw.js` 目前版本係 `v2.8.4`，對應 static cache 名稱
`static-v2.8.4`。`PRECACHE` 包含以下 10 個拆分 CSS：

```text
tokens.css, base.css, layout.css, map.css, ui.css,
responsive.css, dark.css, filters.css, gis.css, performance.css
```

亦包含 `assets/js/pages/tree-detail/td-utils.js`、
`td-photos.js`、`td-logs.js`，以及其他頁面／application modules。`main.css`
唔在 `PRECACHE`，亦唔在任何 HTML `<link>` 載入順序內；目前 repo 只見
10 個拆分 CSS 實體檔案，`main.css` 只作歷史來源／備份名稱出現在拆分檔
註解，並非目前可載入檔案。

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

> **最後核對**：2026-08-19。源碼檔案：`index.html`、`t.html`、`nfc.html`、`offline.js`、`sw.js`、`assets/js/api.js`、`assets/js/config.js`、`assets/js/api-config.js`、`assets/js/auth.js`、`assets/js/modules/audit-log.js`、`assets/js/modules/sync-panel.js`、`assets/js/sw-register.js`、`assets/js/app.js`、`assets/js/core/utils.js`、`assets/js/core/coord-lazy.js`、`assets/js/pages/t.js`、`assets/js/pages/nfc.js`、`assets/js/pages/tree-detail/td-utils.js`、`assets/js/pages/tree-detail/td-photos.js`、`assets/js/pages/tree-detail/td-logs.js`。`assets/js/core/global-utils.js`、`GAS/code.gs` 及實體 `assets/css/main.css` 均不存在。
