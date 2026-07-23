# Phase 2 — Feature Audit Results

## Feature Verification Matrix

| # | Feature | Verdict | Issues Found |
|---|---------|---------|-------------|
| 1 | Multi-account browsing | **Works** | Read-modify-write race on accounts store (9 handlers share the pattern) |
| 2 | Anti-detect fingerprinting | **Partial** | Iframe toString not spoofed (HIGH detect), OffscreenCanvas bypass, WebGL canvas leak, seed correlations |
| 3 | Per-account proxy (manual) | **Works** | Phantom proxy on non-existent account; no host/port validation |
| 4 | Proxy provider integration | **Works** | No input validation on provider config |
| 5 | Proxy health monitoring | **Works** | No reentrancy guard; can take minutes with many accounts |
| 6 | IP rotation | **Works** | Race condition in rotation scheduler |
| 7 | DNS leak test | **Works** | No issues |
| 8 | Session sync (Firebase) | **Partial** | Anonymous auth + no visible Firestore rules; proxy creds + metadata unencrypted |
| 9 | AES-256-GCM encryption | **Works** | Static PBKDF2 salt; key never zeroized |
| 10 | Auto-update | **Works** | Not code-signed (Phase 4) |
| 11 | OAuth popups | **Works** | Fallback UA stuck at Chrome 126 |
| 12 | Avatar extraction | **Works** | No issues |
| 13 | Chat viewer | **Works** | Filter doesn't reset pagination; possible duplicate keys |
| 14 | Mass messaging | **Partial** | Negative PPV price; empty user list sends; no success feedback |
| 15 | Vault media picker | **Works** | Stale offset on Load More; no dedup |
| 16 | Drag-to-reorder | **Broken edge case** | Can silently drop sync-added accounts; accepts arbitrary data |
| 17 | Editable URL bar | **Works** | No issues |
| 18 | Multi-tab browsing | **Works** | No issues |
| 19 | WebRTC leak prevention | **Works** | Applied to proxy browser window too |
| 20 | Frameless window | **Works** | No issues |
| 21 | Factory reset | **Works** | No confirmation dialog; race with auto-sync |
| 22 | Proxy browser window | **Dead code** | IPC handler exists but no UI triggers it |

---

## All Issues by Severity

### CRITICAL (0)

### HIGH (3)
| ID | Component | File:Line | Description |
|----|-----------|-----------|-------------|
| IPC-1 | reorder-accounts | main.js:544 | No validation — can drop sync-added accounts or inject arbitrary data |
| SYNC-1 | Firebase auth | firebase-sync.js:255 | Anonymous auth + no Firestore rules in repo — anyone with config can access DB |
| INJ-1 | Fingerprint iframe | fingerprint-inject.js:483 | Iframe overrides lack Function.prototype.toString spoofing — trivially detectable |

### MEDIUM (16)
| ID | Component | File:Line | Description |
|----|-----------|-----------|-------------|
| IPC-2 | check-all-login-status | main.js:517 | No timeout on cookie reads — one stalled session blocks all |
| IPC-3 | save-account | main.js:550 | No ID format validation; spread merge allows field overwriting |
| IPC-4 | remove-account | main.js:585 | No ID validation; orphaned OAuth popups |
| IPC-5 | set-proxy | main.js:626 | Phantom proxy on non-existent account |
| IPC-6 | open-proxy-browser | main.js:691 | No URL protocol validation (file://, javascript:) |
| IPC-7 | apply-provider-proxy-all | main.js:780 | Race condition — concurrent account mods overwritten |
| IPC-8 | check-all-proxy-health | main.js:836 | No reentrancy guard; no cancellation; can block for minutes |
| IPC-9 | sync-factory-reset | main.js:936 | Race with auto-sync; no auto-sync stop before reset |
| SYNC-2 | Metadata storage | firebase-sync.js:588 | Account names, proxy creds, fingerprints stored unencrypted in Firestore |
| SYNC-3 | PBKDF2 salt | firebase-sync.js:54 | Static salt 'elite-dashboard-sync-salt' for all users |
| SYNC-4 | Cookie import | firebase-sync.js:197 | No domain validation — arbitrary cookies injectable |
| FP-1 | Fingerprint seeds | fingerprint-profiles.js:149 | Language/timezone perfect correlation via shared seed |
| FP-6 | Fallback UA | main.js:15 | Chrome 126 fallback (2+ years outdated) |
| INJ-2 | Iframe injection | fingerprint-inject.js:500 | Missing connection, plugins, userAgentData overrides in iframes |
| INJ-3 | Canvas | fingerprint-inject.js:193 | OffscreenCanvas not patched — bypasses noise |
| INJ-4 | Canvas | fingerprint-inject.js:225 | toDataURL/toBlob fail on WebGL canvases |

### LOW (20+)
| ID | Component | File:Line | Description |
|----|-----------|-----------|-------------|
| IPC-10 | set-api-key | main.js:497 | No format validation; bad key persisted before Firebase validates |
| IPC-11 | set-proxy-provider | main.js:746 | No validation; malformed config breaks operations |
| SYNC-5 | deleteRemoteSession | firebase-sync.js:627 | No try/catch; partial deletion possible |
| SYNC-6 | Derived key | firebase-sync.js:18 | Key never zeroized from memory |
| FP-3 | Memory distribution | fingerprint-profiles.js:68 | Duplicate 16 in high-tier memory array |
| FP-4 | Seed sharing | fingerprint-profiles.js:150 | Canvas noise seed = connection seed |
| FP-5 | Seed sharing | fingerprint-profiles.js:188 | Audio/font seeds same value |
| INJ-5 | Audio noise | fingerprint-inject.js:352 | Only channel 0 gets noise; channels 1+ untouched |
| INJ-6 | chrome.runtime | fingerprint-inject.js:124 | Stubs don't throw like real Chrome |
| INJ-7 | Config cleanup | fingerprint-inject.js:563 | __FP_CONFIG__ accessible before deletion |
| API-2 | Path traversal | api.js:30 | No path sanitization on account ID |
| MM-1 | PPV price | MassMessagesView.jsx:71 | Negative values allowed |
| MM-6 | User lists | MassMessagesView.jsx:74 | Empty list sends user_list_ids: [] |
| HOME-3 | Factory reset | HomeView.jsx:139 | No confirmation dialog |
| CHAT-4 | Pagination | ChatsView.jsx:68 | Filter doesn't reset server pagination |
| VAULT-1 | Load More | VaultMediaPicker.jsx:129 | Stale offset from React batching |
| VAULT-3 | Dedup | VaultMediaPicker.jsx:24 | No deduplication on paginated results |
| STORE-1 | Race condition | main.js (9 handlers) | Read-modify-write on accounts store not guarded by mutex |

---

## Systemic Issue: Store Race Condition

The pattern `store.get('accounts') → modify → store.set('accounts')` appears in **9 IPC handlers**:
`save-account`, `remove-account`, `reorder-accounts`, `set-proxy`, `apply-provider-proxy`,
`apply-provider-proxy-all`, `rotate-proxy`, rotation scheduler, avatar extraction.

Since Electron IPC handlers are async, two concurrent calls can interleave reads and writes,
causing one handler to silently overwrite the other's changes.

**Fix:** Implement a store-level async mutex for all account-modifying operations.

---

## Dead Code
| Item | Location | Action |
|------|----------|--------|
| `open-proxy-browser` IPC handler | main.js:691-741 | Remove (Browse button was deleted from UI) |
| `openProxyBrowser` preload bridge | preload.js | Remove |

---

## Manual Test Checklist (requires human hands)

- [ ] Log into OnlyFans with a test account — verify session persists after restart
- [ ] Add a second account — verify session isolation (cookies don't leak)
- [ ] Configure proxy, browse to browserleaks.com — verify proxy IP shown, no WebRTC leak
- [ ] DNS leak test button — verify proxy DNS, not ISP DNS
- [ ] Rotate IP — verify new IP is different
- [ ] Auto-rotation — set 1-hour interval, verify it fires
- [ ] Mass message — send to small test audience, verify delivery
- [ ] Vault picker — select media, attach to message, verify it sends
- [ ] Chat view — verify messages load, pagination works, filter works
- [ ] Drag reorder accounts — reorder, restart app, verify order persists
- [ ] Sync: add account on device A, verify it appears on device B
- [ ] Sync: delete account on device A, verify it disappears on device B
- [ ] Auto-update: tag a new release, verify update prompt appears
- [ ] Factory reset: click and verify all data wiped
- [ ] Fingerprint: browse to creepjs.com — verify spoofed values shown
