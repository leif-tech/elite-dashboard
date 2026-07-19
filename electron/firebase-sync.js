const { app, session } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Firebase SDK (modular)
let firebaseApp, db, auth;
let initialized = false;
let store = null;
let autoUploadInterval = null;
let syncStatusCallback = null;
let lastUploadHashes = new Map(); // accountId -> hash
let cachedDerivedKey = null;
let cachedKeySource = null;

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
  if (!Buffer.isBuffer(data) || data.length < 29) {
    throw new Error('Invalid encrypted data');
  }
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
  console.log(`[Sync] Unpacked ${written} files for ${accountId}`);
}

// ============ COOKIES ============
async function exportCookies(accountId) {
  const ses = session.fromPartition(`persist:of-${accountId}`);
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
  if (!Array.isArray(cookies) || cookies.length === 0) return;
  const ses = session.fromPartition(`persist:of-${accountId}`);

  let imported = 0, failed = 0;
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
    } catch { failed++; }
  }
  await ses.cookies.flushStore();
  console.log(`[Sync] Imported ${imported}/${cookies.length} cookies for ${accountId} (${failed} failed)`);
}

// ============ CORE ============
async function initSync(electronStore, statusCb) {
  store = electronStore;
  syncStatusCallback = statusCb;

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
    const accounts = store.get('accounts') || [];
    emitStatus({ connected: true, lastSync: null, accounts: accounts.length });

    // Auto-upload every 60s to keep Firestore current
    startAutoUpload();

    return true;
  } catch (err) {
    console.error('[Sync] Init failed:', err.message);
    emitStatus({ connected: false, error: err.message });
    return false;
  }
}

function stopSync() {
  if (autoUploadInterval) {
    clearInterval(autoUploadInterval);
    autoUploadInterval = null;
  }
  initialized = false;
  emitStatus({ connected: false });
}

function emitStatus(status) {
  if (syncStatusCallback) syncStatusCallback(status);
}

// ============ UPLOAD ============
async function uploadSession(accountId, force = false) {
  if (!initialized || !db || !store) return;

  const apiKey = store.get('apiKey');
  if (!apiKey) return;

  try {
    const ses = session.fromPartition(`persist:of-${accountId}`);
    await ses.cookies.flushStore();
    await new Promise(r => setTimeout(r, 300));

    const cookies = await exportCookies(accountId);
    const packed = packPartition(accountId);

    // Only upload if there's actual data (cookies from a logged-in session)
    if (cookies.length === 0) {
      console.log(`[Sync] Skipping upload for ${accountId} — no cookies`);
      return;
    }

    const payload = { cookies, partition: packed ? packed.toString('base64') : null };
    const payloadStr = JSON.stringify(payload);
    const hash = crypto.createHash('sha256').update(payloadStr).digest('hex');
    if (!force && lastUploadHashes.get(accountId) === hash) return;

    const compressed = zlib.gzipSync(Buffer.from(payloadStr, 'utf8'));
    const encrypted = encrypt(compressed, apiKey);
    const b64 = encrypted.toString('base64');

    if (b64.length > 900000) {
      console.error(`[Sync] Data too large (${Math.round(b64.length / 1024)}KB)`);
      return;
    }

    const teamId = getTeamId(apiKey);
    const machineId = getMachineId();
    const { doc, setDoc } = require('firebase/firestore');

    await setDoc(doc(db, `teams/${teamId}/sessions`, accountId), {
      data: b64,
      dataHash: hash,
      version: 2,
      updatedAt: Date.now(),
      updatedBy: machineId,
    });

    const accounts = store.get('accounts') || [];
    const acct = accounts.find(a => a.id === accountId);
    if (acct) {
      await setDoc(doc(db, `teams/${teamId}/accounts`, accountId), {
        id: acct.id,
        name: acct.name,
        updatedAt: Date.now(),
        updatedBy: machineId,
      });
    }

    lastUploadHashes.set(accountId, hash);
    emitStatus({ connected: true, lastSync: new Date().toISOString(), accounts: accounts.length });
    console.log(`[Sync] Uploaded ${accountId} (${cookies.length} cookies, ${Math.round(b64.length / 1024)}KB)`);
  } catch (err) {
    console.error(`[Sync] Upload failed for ${accountId}:`, err.message);
  }
}

async function uploadAllSessions(force = false) {
  if (!initialized || !store) return;
  const accounts = store.get('accounts') || [];
  for (const acct of accounts) {
    await uploadSession(acct.id, force);
  }
}

// ============ DOWNLOAD (Force Download only — no auto-download) ============
async function downloadAllSessions() {
  if (!initialized || !db || !store) return null;

  const apiKey = store.get('apiKey');
  if (!apiKey) return null;

  const teamId = getTeamId(apiKey);

  try {
    const { collection, getDocs } = require('firebase/firestore');

    // Get remote accounts — this becomes the ONLY source of truth
    const accountsSnap = await getDocs(collection(db, `teams/${teamId}/accounts`));
    const remoteAccounts = [];
    accountsSnap.forEach(d => remoteAccounts.push(d.data()));

    // Replace local account list with remote (clean slate)
    const localAccounts = remoteAccounts.map(r => ({ id: r.id, name: r.name }));
    store.set('accounts', localAccounts);

    // Import all sessions
    const sessionsSnap = await getDocs(collection(db, `teams/${teamId}/sessions`));
    let syncedCount = 0;

    for (const docSnap of sessionsSnap.docs) {
      const data = docSnap.data();
      const accountId = docSnap.id;

      try {
        if (data.version === 2 && data.data) {
          const encrypted = Buffer.from(data.data, 'base64');
          const compressed = decrypt(encrypted, apiKey);
          const json = zlib.gunzipSync(compressed).toString('utf8');
          const payload = JSON.parse(json);
          if (payload.cookies) await importCookies(accountId, payload.cookies);
          if (payload.partition) unpackPartition(accountId, Buffer.from(payload.partition, 'base64'));
          lastUploadHashes.set(accountId, data.dataHash || '');
          syncedCount++;
        } else if (data.partition) {
          const encrypted = Buffer.from(data.partition, 'base64');
          const compressed = decrypt(encrypted, apiKey);
          unpackPartition(accountId, compressed);
          lastUploadHashes.set(accountId, data.partitionHash || '');
          syncedCount++;
        }
      } catch (err) {
        console.error(`[Sync] Import failed for ${accountId}:`, err.message);
      }
    }

    emitStatus({ connected: true, lastSync: new Date().toISOString(), accounts: localAccounts.length });
    console.log(`[Sync] Downloaded ${syncedCount} sessions`);
    return { syncedCount, accounts: localAccounts };
  } catch (err) {
    console.error('[Sync] Download failed:', err.message);
    return null;
  }
}

// ============ AUTO UPLOAD ============
function startAutoUpload() {
  if (autoUploadInterval) clearInterval(autoUploadInterval);
  autoUploadInterval = setInterval(() => {
    uploadAllSessions(false).catch(() => {});
  }, 60 * 1000);
}

// ============ FACTORY RESET ============
async function factoryReset() {
  // 1. Clear local data immediately
  if (store) store.set('accounts', []);
  lastUploadHashes.clear();

  // 2. Wipe Firestore
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
  uploadSession,
  uploadAllSessions,
  downloadAllSessions,
  factoryReset,
  get isInitialized() { return initialized; },
};
