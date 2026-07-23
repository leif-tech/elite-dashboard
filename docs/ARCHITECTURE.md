# Elite Dashboard — Architecture

## Overview
Multi-account OnlyFans browser with isolated sessions, anti-detect fingerprinting,
proxy management, session sync, and content management tools.

**Stack:** Electron 31 + React 18 + Vite 5 + Tailwind 3
**Version:** 1.5.6 | **LOC:** ~5,460

---

## File Map

### Electron (Main Process)
| File | Lines | Purpose |
|------|-------|---------|
| `electron/main.js` | 1046 | App lifecycle, BrowserWindow, 40+ IPC handlers, proxy setup, fingerprint injection via CDP, OAuth popups, avatar extraction |
| `electron/preload.js` | 71 | contextBridge — whitelisted IPC API exposed to renderer |
| `electron/firebase-sync.js` | 696 | Bi-directional session sync to Firestore. AES-256-GCM encryption. 30s auto-sync. Partition packing (gzip LevelDB + cookies). Deletion tracking. |
| `electron/fingerprint-profiles.js` | 213 | Deterministic per-account fingerprint generation (v3). Chrome 148-151 UA, GPU/screen/font/timezone correlation. |
| `electron/fingerprint-inject.js` | 566 | Page-level overrides injected via CDP. Canvas, WebGL, audio, navigator, plugins, permissions, iframe propagation. |
| `electron/proxy-providers.js` | 102 | Provider registry (IPRoyal, Smartproxy, Bright Data, Oxylabs, ProxyScrape, SOAX). Session-ID-based IP rotation. |
| `electron/proxy-health.js` | 200 | Background health checks (5 min interval). Latency/status/IP tracking. DNS leak test. |
| `electron/updater.js` | 72 | electron-updater auto-update from GitHub Releases. 30 min poll. |

### React (Renderer Process)
| File | Lines | Purpose |
|------|-------|---------|
| `src/main.jsx` | 10 | React root mount |
| `src/App.jsx` | 424 | Shell: sidebar, account switching, login status, drag-reorder, sync status, proxy health state |
| `src/api.js` | 67 | OnlyFansAPI REST client (chats, mass messages, vault, user lists) |
| `src/index.css` | 51 | Tailwind base + component classes (.card, .btn-primary, .input, etc.) |
| `src/components/OFWebview.jsx` | 94 | Tab bar + webview container per account |
| `src/components/TabWebview.jsx` | 198 | Individual tab: nav bar, editable URL bar, proxy toggle, webview element |
| `src/components/VaultMediaPicker.jsx` | 151 | Modal: vault media grid with multi-select, filtering, pagination |
| `src/pages/HomeView.jsx` | 246 | Dashboard: API key setup, connected models grid, sync controls |
| `src/pages/ChatsView.jsx` | 222 | Message list: account selector, pagination, filter tabs |
| `src/pages/MassMessagesView.jsx` | 339 | Bulk messaging: audience targeting, PPV pricing, scheduling, queue |
| `src/pages/ProxyDashboardView.jsx` | 628 | Proxy mgmt: provider config, account table, health dots, rotate, DNS test, toast notifications |

### Config & Build
| File | Purpose |
|------|---------|
| `index.html` | CSP meta tag, Inter font, root div |
| `vite.config.js` | Relative base, output to dist-react |
| `tailwind.config.cjs` | Dark palette, accent color, fade-in animation |
| `package.json` | Scripts: dev, build, package, release |
| `.github/workflows/release.yml` | macOS build on tag push |
| `.gitignore` | node_modules, dist, exe, dmg |

---

## IPC Boundary

All renderer→main communication goes through `electron/preload.js` contextBridge.

### Account Management
`get-accounts`, `save-account`, `remove-account`, `reorder-accounts`, `check-all-login-status`

### Proxy
`set-proxy`, `test-proxy`, `get-proxy`

### Proxy Provider
`get-proxy-provider`, `set-proxy-provider`, `get-proxy-providers-list`,
`apply-provider-proxy`, `apply-provider-proxy-all`, `rotate-proxy`

### Proxy Health
`get-proxy-health`, `check-proxy-health`, `check-all-proxy-health`, `dns-leak-test`

### Session Sync
`sync-status`, `sync-now`, `sync-upload-account`, `sync-factory-reset`

### Window
`win-minimize`, `win-maximize`, `win-close`, `open-external`

### API
`get-api-key`, `set-api-key`

### Events (Main→Renderer)
`sync-update`, `sync-accounts-updated`, `avatar-extracted`, `open-new-tab`,
`update-available`, `update-progress`, `proxy-health-update`, `proxies-rotated`

---

## Data Storage

### electron-store (JSON on disk, `%APPDATA%/elite-agency/config.json`)
- `apiKey` — OnlyFansAPI Bearer token (plaintext)
- `accounts[]` — array of account objects (id, name, proxy, fingerprint, avatar)
- `proxyProvider` — global provider config (type, username, password, country, rotation)

### Session Partitions (`%APPDATA%/elite-agency/Partitions/of-{id}/`)
- Chromium profile per account: cookies, Local Storage, Session Storage, cache

### Firebase Firestore (`elite-228d6`)
- `sessions/{teamId}/accounts/{accountId}` — encrypted session data
- Team ID = SHA256(apiKey).slice(0,16)
- AES-256-GCM encryption with PBKDF2(apiKey, salt, 100k rounds)

---

## Feature Inventory

| # | Feature | Status | Files |
|---|---------|--------|-------|
| 1 | Multi-account browsing with isolated sessions | Implemented | main.js, App.jsx, OFWebview, TabWebview |
| 2 | Anti-detect fingerprint spoofing (v3) | Implemented | fingerprint-profiles.js, fingerprint-inject.js, main.js |
| 3 | Per-account proxy (manual) | Implemented | main.js, ProxyDashboardView |
| 4 | Proxy provider integration (6 providers) | Implemented | proxy-providers.js, main.js, ProxyDashboardView |
| 5 | Proxy health monitoring | Implemented | proxy-health.js, main.js, ProxyDashboardView |
| 6 | Proxy IP rotation (manual + scheduled) | Implemented | proxy-providers.js, main.js |
| 7 | DNS leak testing | Implemented | proxy-health.js, ProxyDashboardView |
| 8 | Cross-device session sync (Firebase) | Implemented | firebase-sync.js, main.js |
| 9 | AES-256-GCM encrypted sync | Implemented | firebase-sync.js |
| 10 | Auto-update from GitHub Releases | Implemented | updater.js |
| 11 | OAuth popup handling (Google, Twitter) | Implemented | main.js |
| 12 | Avatar extraction from OF pages | Implemented | main.js |
| 13 | Chat/message viewer | Implemented | ChatsView.jsx, api.js |
| 14 | Mass messaging with scheduling | Implemented | MassMessagesView.jsx, api.js |
| 15 | Vault media picker | Implemented | VaultMediaPicker.jsx, api.js |
| 16 | Drag-to-reorder accounts | Implemented | App.jsx |
| 17 | Editable URL bar (browse any site) | Implemented | TabWebview.jsx |
| 18 | Multi-tab browsing per account | Implemented | OFWebview.jsx |
| 19 | WebRTC leak prevention | Implemented | main.js |
| 20 | Custom titlebar (frameless window) | Implemented | App.jsx |
| 21 | Factory reset | Implemented | HomeView, firebase-sync.js |
### Not Present
- No test files (0 tests)
- No .env files
- No database (all state in electron-store + partitions)
- No error reporting / crash analytics
- No rate limiting on IPC handlers
- No logging to file

---

## Audit Status
- [x] Phase 0: Recon (ARCHITECTURE.md)
- [x] Phase 1: Build & Run
- [x] Phase 2: Feature Audit (PHASE2-AUDIT.md)
- [x] Phase 3: Fix (26 bugs fixed)
- [x] Phase 4: Security (PHASE4-SECURITY.md)
- [x] Phase 5: Report (REPORT.md)
