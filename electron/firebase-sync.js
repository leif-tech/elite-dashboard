const { app, session } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Firebase SDK (lazy loaded in initSync)
let firebaseApp, db, auth;
let initialized = false;
let store = null;
let autoSyncInterval = null;
let syncStatusCallback = null;
let accountsUpdatedCallback = null;
let lastUploadHashes = new Map();
let lastKnownRemoteTime = new Map();
let initializedSessions = new Set();
let cachedDerivedKey = null;
let cachedKeySource = null;
let syncInProgress = false;
let deletedAccountIds = new Set();

// Mark an account as deleted IMMEDIATELY — must be called before any async work
// so smartSync can't slip in between store removal and deletion tracking
function markAsDeleted(accountId) {
  deletedAccountIds.add(accountId);
  // Persist to store so deleted IDs survive app restart
  if (store) {
    const persisted = store.get('deletedIds') || [];
    if (!persisted.includes(accountId)) {
      store.set('deletedIds', [...persisted, accountId]);
    }
  }
  console.log(`[Sync] Marked ${accountId} as deleted. deletedIds:`, [...deletedAccountIds]);
}

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCtweAn8fMiNy0940RclIL1t-LZfcbxMwk',
  authDomain: 'elite-228d6.firebaseapp.com',
  projectId: 'elite-228d6',
  storageBucket: 'elite-228d6.firebasestorage.app',
  messagingSenderId: '367015080565',
  appId: '1:367015080565:web:edadcef1bcda99ce4b7e3c',
};

const SYNC_DIRS = ['Local Storage', 'Session Storage'];
const SYNC_FILES = ['Preferences'];
const SKIP_FILES = ['LOCK', 'LOG', 'LOG.old'];
const MAX_RECURSE_DEPTH = 10;

// ============ ENCRYPTION ============
function deriveKey(apiKey) {
  if (cachedDerivedKey && cachedKeySource === apiKey) return cachedDerivedKey;
  cachedDerivedKey = crypto.pbkdf2Sync(apiKey, 'elite-dashboard-sync-salt', 100000, 32, 'sha256');
  cachedKeySource = apiKey;
  return cachedDerivedKey;
}

function encrypt(data, apiKey) {
  const key = deriveKey(apiKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

function decrypt(data, apiKey) {
  if (!Buffer.isBuffer(data) || data.length < 29) throw new Error('Invalid encrypted data');
  const key = deriveKey(apiKey);
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function getTeamId(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

function getMachineId() {
  const os = require('os');
  const raw = `${os.hostname()}-${os.userInfo().username}-${os.platform()}`;
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
}

function getPartitionPath(accountId) {
  return path.join(app.getPath('userData'), 'Partitions', `of-${accountId}`);
}

// ============ PARTITION PACKING ============
function packPartition(accountId) {
  const partDir = getPartitionPath(accountId);
  if (!fs.existsSync(partDir)) return null;

  const files = [];
  for (const dir of SYNC_DIRS) {
    const dirPath = path.join(partDir, dir);
    if (!fs.existsSync(dirPath)) continue;
    collectFiles(dirPath, dir, files, 0);
  }
  for (const file of SYNC_FILES) {
    const filePath = path.join(partDir, file);
    if (!fs.existsSync(filePath)) continue;
    try {
      const data = fs.readFileSync(filePath);
      files.push({ path: file, data: data.toString('base64') });
    } catch {}
  }

  if (files.length === 0) return null;
  return zlib.gzipSync(Buffer.from(JSON.stringify(files), 'utf8'));
}

function collectFiles(dirPath, relativeTo, files, depth) {
  if (depth > MAX_RECURSE_DEPTH) return;
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (SKIP_FILES.includes(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.join(relativeTo, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, relPath, files, depth + 1);
    } else if (entry.isFile()) {
      try {
        const data = fs.readFileSync(fullPath);
        files.push({ path: relPath.replace(/\\/g, '/'), data: data.toString('base64') });
      } catch {}
    }
  }
}

function unpackPartition(accountId, compressed) {
  const partDir = getPartitionPath(accountId);
  const resolvedPartDir = path.resolve(partDir);

  let files;
  try {
    const json = zlib.gunzipSync(compressed).toString('utf8');
    files = JSON.parse(json);
  } catch (err) {
    throw new Error(`Corrupt partition data: ${err.message}`);
  }
  if (!Array.isArray(files)) throw new Error('Invalid partition format');

  let written = 0;
  for (const file of files) {
    if (!file.path || typeof file.path !== 'string' || !file.data) continue;
    const filePath = path.resolve(partDir, ...file.path.split('/'));
    if (!filePath.startsWith(resolvedPartDir)) continue;
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(file.data, 'base64'));
    written++;
  }
  return written;
}

// ============ COOKIES ============
async function exportCookies(accountId) {
  const ses = session.fromPartition(`persist:of-${accountId}`);
  initializedSessions.add(accountId);
  const cookies = await ses.cookies.get({});
  return cookies.filter(c => c.name && c.domain).map(c => {
    const domain = c.domain || '';
    const cookiePath = c.path || '/';
    const host = domain.replace(/^\./, '');
    const secure = c.secure !== false;

    const cookie = {
      url: `https://${host}${cookiePath}`,
      name: c.name,
      value: c.value || '',
      domain,
      path: cookiePath,
      secure,
      httpOnly: c.httpOnly || false,
    };

    if (c.expirationDate && typeof c.expirationDate === 'number' && c.expirationDate > 0) {
      cookie.expirationDate = c.expirationDate;
    }

    const sameSite = c.sameSite || 'unspecified';
    if (sameSite === 'unspecified' || sameSite === 'no_restriction') {
      cookie.sameSite = secure ? 'no_restriction' : 'lax';
    } else {
      cookie.sameSite = sameSite;
    }
    return cookie;
  });
}

async function importCookies(accountId, cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return { imported: 0, failed: 0 };
  const ses = session.fromPartition(`persist:of-${accountId}`);
  initializedSessions.add(accountId);

  let imported = 0, failed = 0;
  const errors = [];
  for (const cookie of cookies) {
    try {
      if (!cookie.name || !cookie.url) { failed++; continue; }
      const setCookie = {
        url: cookie.url,
        name: cookie.name,
        value: cookie.value || '',
        path: cookie.path || '/',
        secure: cookie.secure !== false,
        httpOnly: cookie.httpOnly || false,
      };
      if (cookie.domain) setCookie.domain = cookie.domain;
      if (cookie.expirationDate && typeof cookie.expirationDate === 'number' && cookie.expirationDate > 0) {
        setCookie.expirationDate = cookie.expirationDate;
      }
      if (cookie.sameSite === 'no_restriction') {
        setCookie.sameSite = 'no_restriction';
        setCookie.secure = true;
      } else if (cookie.sameSite === 'lax' || cookie.sameSite === 'strict') {
        setCookie.sameSite = cookie.sameSite;
      } else {
        setCookie.sameSite = setCookie.secure ? 'no_restriction' : 'lax';
      }
      await ses.cookies.set(setCookie);
      imported++;
    } catch (err) {
      failed++;
      if (errors.length < 3) errors.push(`${cookie.name}@${cookie.domain}: ${err.message}`);
    }
  }
  await ses.cookies.flushStore();
  if (errors.length > 0) console.warn(`[Sync] Cookie errors for ${accountId}:`, errors);
  return { imported, failed };
}

// ============ CORE ============
async function initSync(electronStore, statusCb, accountsCb) {
  store = electronStore;
  syncStatusCallback = statusCb;
  accountsUpdatedCallback = accountsCb;

  const apiKey = store.get('apiKey');
  if (!apiKey) {
    emitStatus({ connected: false, error: 'No API key set' });
    return false;
  }
  if (initialized) return true;

  try {
    const { initializeApp, getApps } = require('firebase/app');
    const { getFirestore } = require('firebase/firestore');
    const { getAuth, signInAnonymously } = require('firebase/auth');

    const existingApps = getApps();
    firebaseApp = existingApps.length > 0 ? existingApps[0] : initializeApp(FIREBASE_CONFIG);
    db = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);
    await signInAnonymously(auth);

    initialized = true;
    emitStatus({ connected: true, lastSync: null });

    // Restore persisted deleted IDs (survive app restart)
    const persistedDeleted = store.get('deletedIds') || [];
    const accts = store.get('accounts') || [];

    // On fresh devices (no local accounts), clear deletedIds —
    // they only matter for preventing re-sync after intentional deletion on THIS device
    if (accts.length === 0 && persistedDeleted.length > 0) {
      console.log(`[Sync] Fresh device detected (no accounts). Clearing ${persistedDeleted.length} stale deletedIds.`);
      store.set('deletedIds', []);
    } else {
      for (const id of persistedDeleted) deletedAccountIds.add(id);
      if (persistedDeleted.length > 0) {
        console.log(`[Sync] Restored ${persistedDeleted.length} deleted IDs from store:`, persistedDeleted);
      }
    }

    // Deduplicate accounts on startup (fixes corrupted store from prior bugs)
    const seen = new Set();
    const deduped = accts.filter(a => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
    if (deduped.length < accts.length) {
      console.log(`[Sync] Removed ${accts.length - deduped.length} duplicate accounts`);
      store.set('accounts', deduped);
      if (accountsUpdatedCallback) accountsUpdatedCallback(deduped);
    }

    // Clean up any stale deleted accounts from Firebase
    // (prevents new devices from downloading expired sessions)
    if (deletedAccountIds.size > 0) {
      const apiKey = store.get('apiKey');
      const teamId = getTeamId(apiKey);
      const { doc, getDoc, deleteDoc } = require('firebase/firestore');
      for (const delId of deletedAccountIds) {
        try {
          const sessionDoc = doc(db, `teams/${teamId}/sessions`, delId);
          const snap = await getDoc(sessionDoc);
          if (snap.exists()) {
            await deleteDoc(sessionDoc);
            await deleteDoc(doc(db, `teams/${teamId}/accounts`, delId));
            console.log(`[Sync] Cleaned up deleted account from Firebase: ${delId}`);
          }
        } catch (err) {
          console.warn(`[Sync] Cleanup failed for ${delId}:`, err.message);
        }
      }
    }

    // Initial sync — automatically downloads new accounts from other devices
    console.log('[Sync] Running initial sync...');
    await smartSync();
    console.log('[Sync] Initial sync complete');

    startAutoSync();
    return true;
  } catch (err) {
    console.error('[Sync] Init failed:', err.message);
    emitStatus({ connected: false, error: err.message });
    return false;
  }
}

function stopSync() {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
  }
  initialized = false;
  emitStatus({ connected: false });
}

function emitStatus(status) {
  if (syncStatusCallback) syncStatusCallback(status);
}

// ============ FULL SYNC (manual) ============
// Forces a fresh sync but RESPECTS deletions — deleted accounts stay deleted.
// Only Factory Reset clears the deletion block list.
async function fullSync() {
  console.log(`[Sync] Full sync — forcing re-check of all remote sessions (${deletedAccountIds.size} deletions preserved)`);
  lastKnownRemoteTime.clear();
  await smartSync();
}

// ============ SMART SYNC ============
// Uploads changed local sessions, then downloads new/changed remote sessions.
// Runs automatically every 30 seconds and on startup.
async function smartSync() {
  if (!initialized || !db || !store || syncInProgress) return;
  syncInProgress = true;

  try {
    const apiKey = store.get('apiKey');
    if (!apiKey) return;

    const teamId = getTeamId(apiKey);
    const { collection, getDocs } = require('firebase/firestore');

    // Step 1: Upload all local sessions that changed (hash dedup skips unchanged)
    const uploadAccounts = store.get('accounts') || [];
    for (const acct of uploadAccounts) {
      await uploadSession(acct.id, false);
    }

    // Step 2: Fetch remote account metadata
    const accountsSnap = await getDocs(collection(db, `teams/${teamId}/accounts`));
    const remoteAccounts = [];
    accountsSnap.forEach(d => remoteAccounts.push(d.data()));

    // Re-read accounts from store (may have changed during upload phase)
    const localAccounts = store.get('accounts') || [];

    if (remoteAccounts.length === 0) {
      emitStatus({ connected: true, lastSync: new Date().toISOString(), accounts: localAccounts.length });
      return;
    }

    // Step 3: Detect new or updated remote sessions
    const localIds = new Set(localAccounts.map(a => a.id));
    let accountListChanged = false;
    const updatedLocalAccounts = [...localAccounts];

    for (const remote of remoteAccounts) {
      const remoteUpdatedAt = remote.updatedAt || 0;
      const lastKnown = lastKnownRemoteTime.get(remote.id) || 0;

      // Skip accounts that were explicitly deleted on this machine
      if (deletedAccountIds.has(remote.id)) {
        console.log(`[Sync] Skipping deleted account: ${remote.id} (${remote.name})`);
        continue;
      }

      if (!localIds.has(remote.id)) {
        // New account from another device — include proxy settings
        console.log(`[Sync] New remote account: ${remote.id} (${remote.name}). localIds:`, [...localIds], 'deletedIds:', [...deletedAccountIds]);
        const ok = await downloadSession(remote.id, apiKey, teamId);
        if (ok) {
          const newAcct = { id: remote.id, name: remote.name };
          if (remote.proxy) newAcct.proxy = remote.proxy;
          updatedLocalAccounts.push(newAcct);
          localIds.add(remote.id);
          lastKnownRemoteTime.set(remote.id, remoteUpdatedAt);
          accountListChanged = true;
        }
      } else if (remoteUpdatedAt > lastKnown) {
        // Session updated by another device since our last check
        await downloadSession(remote.id, apiKey, teamId);
        // Sync proxy settings from remote
        if (remote.proxy) {
          const accts = store.get('accounts') || [];
          const idx = accts.findIndex(a => a.id === remote.id);
          if (idx >= 0 && JSON.stringify(accts[idx].proxy) !== JSON.stringify(remote.proxy)) {
            accts[idx].proxy = remote.proxy;
            store.set('accounts', accts);
            accountListChanged = true;
          }
        }
        lastKnownRemoteTime.set(remote.id, remoteUpdatedAt);
      }
    }

    if (accountListChanged) {
      // Re-read store to avoid overwriting concurrent changes (e.g., account deletion)
      const currentAccounts = store.get('accounts') || [];
      const currentIds = new Set(currentAccounts.map(a => a.id));
      // Only ADD truly new accounts — never overwrite or duplicate
      const newAccounts = updatedLocalAccounts.filter(a =>
        !currentIds.has(a.id) && !deletedAccountIds.has(a.id)
      );
      if (newAccounts.length > 0) {
        const merged = [...currentAccounts, ...newAccounts];
        store.set('accounts', merged);
        if (accountsUpdatedCallback) accountsUpdatedCallback(merged);
      }
    }

    // Report count from current store (not stale snapshot)
    const finalAccounts = store.get('accounts') || [];
    emitStatus({
      connected: true,
      lastSync: new Date().toISOString(),
      accounts: finalAccounts.length,
    });
  } catch (err) {
    console.error('[Sync] Smart sync error:', err.message);
  } finally {
    syncInProgress = false;
  }
}

// ============ DOWNLOAD SINGLE SESSION ============
async function downloadSession(accountId, apiKey, teamId) {
  if (deletedAccountIds.has(accountId)) return false;
  try {
    const { doc, getDoc } = require('firebase/firestore');
    const docSnap = await getDoc(doc(db, `teams/${teamId}/sessions`, accountId));
    if (!docSnap.exists()) return false;

    const data = docSnap.data();
    if (data.version !== 2 || !data.data) return false;

    const encrypted = Buffer.from(data.data, 'base64');
    const compressed = decrypt(encrypted, apiKey);
    const json = zlib.gunzipSync(compressed).toString('utf8');
    const payload = JSON.parse(json);

    // Validate payload shape
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      console.error(`[Sync] Invalid payload shape for ${accountId}`);
      return false;
    }
    if (payload.cookies && !Array.isArray(payload.cookies)) {
      console.error(`[Sync] Invalid cookies format for ${accountId}`);
      return false;
    }

    if (initializedSessions.has(accountId)) {
      // Session already in memory — only refresh cookies
      // (partition file writes are ignored by the in-memory session)
      if (payload.cookies) {
        const result = await importCookies(accountId, payload.cookies);
        console.log(`[Sync] Refreshed ${accountId} cookies: ${result.imported} imported`);
      }
    } else {
      // Session not accessed yet — write partition files FIRST, then cookies
      // session.fromPartition() reads Local Storage from disk on first access,
      // so files must exist before importCookies creates the session
      let filesWritten = 0;
      if (payload.partition) {
        filesWritten = unpackPartition(accountId, Buffer.from(payload.partition, 'base64'));
      }
      let cookieResult = { imported: 0, failed: 0 };
      if (payload.cookies) {
        cookieResult = await importCookies(accountId, payload.cookies);
      }
      console.log(`[Sync] Downloaded ${accountId}: ${cookieResult.imported} cookies, ${filesWritten} files`);
    }

    lastUploadHashes.set(accountId, data.dataHash || '');
    return true;
  } catch (err) {
    console.error(`[Sync] Download failed for ${accountId}:`, err.message);
    return false;
  }
}

// ============ UPLOAD ============
async function uploadSession(accountId, force = false) {
  if (!initialized || !db || !store) return;
  if (deletedAccountIds.has(accountId)) return;

  const apiKey = store.get('apiKey');
  if (!apiKey) return;

  try {
    const ses = session.fromPartition(`persist:of-${accountId}`);
    initializedSessions.add(accountId);
    await ses.cookies.flushStore();

    const cookies = await exportCookies(accountId);
    const packed = packPartition(accountId);

    // Don't upload empty sessions
    if (cookies.length === 0) return;

    const payload = { cookies, partition: packed ? packed.toString('base64') : null };
    const payloadStr = JSON.stringify(payload);
    let hash = crypto.createHash('sha256').update(payloadStr).digest('hex');
    if (!force && lastUploadHashes.get(accountId) === hash) return;

    const compressed = zlib.gzipSync(Buffer.from(payloadStr, 'utf8'));
    const encrypted = encrypt(compressed, apiKey);
    let b64 = encrypted.toString('base64');

    if (b64.length > 900000) {
      // Payload too large with partition files — retry with cookies only
      console.warn(`[Sync] Full payload too large for ${accountId} (${Math.round(b64.length / 1024)}KB), retrying cookies-only`);
      const cookiesOnly = { cookies, partition: null };
      const cookiesStr = JSON.stringify(cookiesOnly);
      const cookiesCompressed = zlib.gzipSync(Buffer.from(cookiesStr, 'utf8'));
      const cookiesEncrypted = encrypt(cookiesCompressed, apiKey);
      b64 = cookiesEncrypted.toString('base64');
      hash = crypto.createHash('sha256').update(cookiesStr).digest('hex');
      if (b64.length > 900000) {
        console.error(`[Sync] Even cookies-only too large for ${accountId}: ${Math.round(b64.length / 1024)}KB`);
        return;
      }
    }

    const teamId = getTeamId(apiKey);
    const machineId = getMachineId();
    const now = Date.now();
    const { doc, runTransaction, setDoc } = require('firebase/firestore');

    // Use transaction to prevent overwriting newer data from another machine
    const sessionRef = doc(db, `teams/${teamId}/sessions`, accountId);
    const lastKnown = lastKnownRemoteTime.get(accountId) || 0;
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(sessionRef);
      if (snap.exists()) {
        const remote = snap.data();
        if (remote.updatedAt > lastKnown && remote.updatedBy !== machineId) {
          // Another machine uploaded newer data — skip our upload
          throw new Error('SKIP_STALE');
        }
      }
      transaction.set(sessionRef, {
        data: b64,
        dataHash: hash,
        version: 2,
        updatedAt: now,
        updatedBy: machineId,
      });
    });

    const accounts = store.get('accounts') || [];
    const acct = accounts.find(a => a.id === accountId);
    if (acct) {
      await setDoc(doc(db, `teams/${teamId}/accounts`, accountId), {
        id: acct.id,
        name: acct.name,
        proxy: acct.proxy || null,
        updatedAt: now,
        updatedBy: machineId,
      });
    }

    lastUploadHashes.set(accountId, hash);
    lastKnownRemoteTime.set(accountId, now);
    emitStatus({ connected: true, lastSync: new Date().toISOString(), accounts: accounts.length });
    console.log(`[Sync] Uploaded ${accountId}: ${cookies.length} cookies, ${Math.round(b64.length / 1024)}KB`);
  } catch (err) {
    if (err.message === 'SKIP_STALE') {
      console.log(`[Sync] Skipped upload for ${accountId}: remote has newer data`);
    } else {
      console.error(`[Sync] Upload failed for ${accountId}:`, err.message);
    }
  }
}

async function uploadAllSessions(force = false) {
  if (!initialized || !store) return;
  const accounts = store.get('accounts') || [];
  // Upload all accounts in parallel — prevents quit timeout from cutting off later accounts
  await Promise.all(accounts.map(acct => uploadSession(acct.id, force)));
}

// ============ AUTO SYNC ============
function startAutoSync() {
  if (autoSyncInterval) clearInterval(autoSyncInterval);
  autoSyncInterval = setInterval(() => {
    smartSync().catch(err => console.error('[Sync] Auto-sync error:', err.message));
  }, 30 * 1000);
}

// ============ DELETE REMOTE SESSION ============
async function deleteRemoteSession(accountId) {
  // Mark as deleted FIRST — prevents smartSync from re-adding during delete
  deletedAccountIds.add(accountId);
  lastUploadHashes.delete(accountId);
  lastKnownRemoteTime.delete(accountId);
  initializedSessions.delete(accountId);

  if (!initialized || !db || !store) return;
  const apiKey = store.get('apiKey');
  if (!apiKey) return;
  const teamId = getTeamId(apiKey);
  const { doc, deleteDoc } = require('firebase/firestore');
  await deleteDoc(doc(db, `teams/${teamId}/sessions`, accountId));
  await deleteDoc(doc(db, `teams/${teamId}/accounts`, accountId));
  console.log(`[Sync] Deleted remote session for ${accountId}`);
}

// ============ FACTORY RESET ============
async function factoryReset() {
  // Clean up local partition directories
  const partitionsDir = path.join(app.getPath('userData'), 'Partitions');
  if (fs.existsSync(partitionsDir)) {
    const entries = fs.readdirSync(partitionsDir).filter(e => e.startsWith('of-'));
    for (const entry of entries) {
      try { fs.rmSync(path.join(partitionsDir, entry), { recursive: true, force: true }); } catch {}
    }
  }

  if (store) {
    store.set('accounts', []);
    store.set('deletedIds', []);
  }
  lastUploadHashes.clear();
  lastKnownRemoteTime.clear();
  initializedSessions.clear();
  deletedAccountIds.clear();

  if (initialized && db && store) {
    const apiKey = store.get('apiKey');
    if (apiKey) {
      try {
        const teamId = getTeamId(apiKey);
        const { collection, getDocs, deleteDoc, doc } = require('firebase/firestore');
        const sessionsSnap = await getDocs(collection(db, `teams/${teamId}/sessions`));
        for (const d of sessionsSnap.docs) await deleteDoc(doc(db, `teams/${teamId}/sessions`, d.id));
        const accountsSnap = await getDocs(collection(db, `teams/${teamId}/accounts`));
        for (const d of accountsSnap.docs) await deleteDoc(doc(db, `teams/${teamId}/accounts`, d.id));
      } catch (e) {
        console.error('[Sync] Firestore wipe error:', e.message);
      }
    }
  }

  console.log('[Sync] Factory reset complete');
  return { success: true };
}

// ============ EXPORTS ============
module.exports = {
  initSync,
  stopSync,
  smartSync,
  fullSync,
  uploadSession,
  uploadAllSessions,
  markAsDeleted,
  deleteRemoteSession,
  factoryReset,
  get isInitialized() { return initialized; },
};
