# Phase 4 — Security Audit

## Audit Scope
Full security review of credentials, encryption, Electron hardening, dependency vulnerabilities,
IPC attack surface, Firebase/Firestore access control, and CSP.

---

## Findings by Severity

### CRITICAL (1)

| ID | Component | Description | Status |
|----|-----------|-------------|--------|
| SEC-17 | Dependencies | Electron 31 has 17+ CVEs (use-after-free, IPC spoofing, injection). Upgrade to Electron 43+. `tar` has critical path traversal (build-time). `undici` has 5 high-severity CVEs. | **Action Required** — breaking upgrade |

### HIGH (2)

| ID | Component | Description | Status |
|----|-----------|-------------|--------|
| SEC-13 | Auto-updater | Without code signing, compromised GitHub could push malicious updates. `electron-updater` doesn't verify signatures. | **Action Required** — needs code signing cert |
| SEC-21 | Firebase auth | Anonymous auth + no Firestore security rules in repo. Anyone with Firebase config can read/delete encrypted data. Data is AES-256-GCM encrypted so can't be decrypted, but CAN be deleted. | **Action Required** — needs Firestore rules |

### MEDIUM (5)

| ID | Component | Description | Status |
|----|-----------|-------------|--------|
| SEC-2 | API key storage | OnlyFansAPI Bearer token stored in plaintext `config.json` on disk | **Documented** — use `safeStorage` API |
| SEC-3 | Proxy credentials | Proxy username/password in plaintext `config.json` | **Documented** — use `safeStorage` API |
| SEC-12 | Code signing | `signAndEditExecutable: false` — no Windows code signing. SmartScreen warnings. | **Action Required** — needs EV cert |
| SEC-22 | Firestore metadata | Account names, proxy creds, fingerprints stored unencrypted in Firestore accounts collection | **FIXED** — now AES-256-GCM encrypted |
| SYNC-3 | PBKDF2 salt | Static salt `'elite-dashboard-sync-salt'` for all users. Low practical risk since each API key is unique. Per-user salt would need to be stored alongside encrypted data (Firestore), negating its benefit. | **Accepted** — documented limitation |

### LOW (4)

| ID | Component | Description | Status |
|----|-----------|-------------|--------|
| SEC-6 | Key zeroization | Derived key (`cachedDerivedKey`) never cleared from memory. Node.js GC makes reliable zeroization impossible. | **Accepted** — platform limitation |
| API-2 | Path traversal | Account IDs used in API URLs without sanitization | **FIXED** — `safePath()` added |
| SEC-20 | esbuild/vite | Moderate dev-server vulnerability — dev-time only, not in production builds | **Documented** — upgrade when convenient |
| SEC-4 | Provider creds | Proxy provider password in plaintext config.json. Same category as SEC-2/3. | **Documented** |

---

## Security Posture Assessment

### What's Good

| Area | Assessment |
|------|-----------|
| **Context Isolation** | `contextIsolation: true` properly enabled — renderer can't access Node.js |
| **Node Integration** | `nodeIntegration: false` — renderer has no direct Node.js access |
| **Preload Bridge** | `contextBridge.exposeInMainWorld` — proper IPC whitelist pattern |
| **CSP** | Strong CSP in index.html: `script-src 'self'`, `object-src 'none'`, scoped `connect-src` |
| **Session Isolation** | Per-account partitions (`persist:of-{id}`) — cookies/storage don't leak between accounts |
| **Encryption** | AES-256-GCM with PBKDF2 (100k rounds) — session data encrypted in transit/rest on Firestore |
| **WebRTC** | `disable_non_proxied_udp` applied to all webviews — prevents IP leak |
| **Protocol Validation** | `open-external` validates http/https before `shell.openExternal` |
| **OAuth Popups** | Properly isolated with partition, scoped to known OAuth domains |
| **Cookie Filtering** | Import only accepts OnlyFans domain cookies (SYNC-4 fix) |

### What Needs External Action

| Item | Effort | Impact |
|------|--------|--------|
| **Electron 31 → 43 upgrade** | 4-8 hours (breaking changes) | Fixes 17+ CVEs |
| **Code signing certificate** | $200-400/yr (EV cert) | Secures auto-updater, removes SmartScreen |
| **Firestore security rules** | 1-2 hours (Firebase console) | Prevents unauthorized data deletion |
| **electron-store → safeStorage** | 2-3 hours | Encrypts local credentials at rest |
| **electron-builder upgrade** | 1-2 hours | Fixes critical `tar` CVE (build-time) |

---

## Fixes Applied in This Phase

### SEC-22: Encrypt Firestore Account Metadata
**File:** `firebase-sync.js`
- Account metadata (name, proxy credentials, fingerprint) now encrypted with AES-256-GCM before upload
- Uses same encryption key as session data (derived from API key)
- Backward compatible: reads both encrypted (v2) and plaintext (v1) metadata

### API-2: Path Sanitization
**File:** `api.js`
- Added `safePath()` function that strips `/`, `\`, `.` and encodes URI components
- Applied to all account ID and message ID path segments
- Vault media type parameter also URI-encoded

### VAULT-1: Stale Offset Fix
**File:** `VaultMediaPicker.jsx`
- `fetchMedia()` now reads offset directly (not from stale closure)

### VAULT-3: Deduplication on Paginated Results
**File:** `VaultMediaPicker.jsx`
- Append mode deduplicates by `id` using a `Set` before merging

---

## Dependency Audit Summary

```
npm audit — 19 vulnerabilities

CRITICAL  (build-time): tar <=7.5.18 — path traversal
HIGH      (runtime):    electron <=39.8.4 — 17+ CVEs
HIGH      (runtime):    undici <=6.26.0 — 5 CVEs
HIGH      (build-time): fast-uri 3.0.0-3.1.3 — host confusion
MODERATE  (dev-time):   esbuild <=0.24.2 — dev server access
```

**Recommended upgrade path:**
1. `npm audit fix` — fixes `fast-uri` (non-breaking)
2. `electron@43` — fixes Electron + undici CVEs (breaking, test thoroughly)
3. `electron-builder@26` — fixes `tar` CVE (breaking, test build pipeline)
4. `vite@6+` — fixes esbuild CVE (breaking, update config)

---

## Firestore Rules (Recommended)

Deploy these rules to `elite-228d6` Firebase project:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Deny all access by default
    match /{document=**} {
      allow read, write: if false;
    }

    // Team documents — require authentication
    match /teams/{teamId}/{collection}/{docId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

This ensures only authenticated users (even anonymous auth) can access data,
preventing unauthenticated scraping. For stronger protection, store the teamId
as a custom claim after API key validation.
