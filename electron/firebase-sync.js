const { app, session } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Firebase SDK (modular)
let firebaseApp, db, auth;
let initialized = false;
let store = null;
let realtimeUnsubscribe = null;
let autoUploadInterval = null;
let syncStatusCallback = null;
let lastUploadHashes = new Map(); // accountId -> hash
let locallyOwnedSessions = new Set(); // sessions with active local login — don't overwrite
let cachedDerivedKey = null; // cache PBKDF2 result
let cachedKeySource = null; // the API key used to derive

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCtweAn8fMiNy0940RclIL1t-LZfcbxMwk',
  authDomain: 'elite-228d6.firebaseapp.com',
  projectId: 'elite-228d6',
  storageBucket: 'elite-228d6.firebasestorage.app',
  messagingSenderId: '367015080565',
  appId: '1:367015080565:web:edadcef1bcda99ce4b7e3c',
};

// Folders/files to sync from partition (skip Network — cookies handled via API)
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

// ============ PARTITION FOLDER PACKING (Local Storage + Session Storage only) ============
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

  const json = JSON.stringify(files);
  const compressed = zlib.gzipSync(Buffer.from(json, 'utf8'));
  return compressed;
}

function collectFiles(dirPath, relativeTo, files, depth) {
  if (depth > MAX_RECURSE_DEPTH) return;
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch { return; }
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

  let json, files;
  try {
    json = zlib.gunzipSync(compressed).toString('utf8');
    files = JSON.parse(json);
  } catch (err) {
    throw new Error(`Corrupt partition data: ${err.message}`);
  }

  if (!Array.isArray(files)) throw new Error('Invalid partition format');

  let written = 0;
  for (const file of files) {
    if (!file.path || typeof file.path !== 'string' || !file.data) continue;

    // Path traversal protection
    const filePath = path.resolve(partDir, ...file.path.split('/'));
    if (!filePath.startsWith(resolvedPartDir)) {
      console.warn(`[Firebase Sync] Skipping unsafe path: ${file.path}`);
      continue;
    }

    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(file.data, 'base64'));
    written++;
  }

  console.log(`[Firebase Sync] Unpacked ${written} files to partition for ${accountId}`);
}

// ============ COOKIES API (cross-platform) ============
async function exportCookies(accountId) {
  const ses = session.fromPartition(`persist:of-${accountId}`);
  const cookies = await ses.cookies.get({});
  // Only sync essential cookie fields (strip Electron internals)
  // IMPORTANT: Carefully handle fields for cross-platform compatibility (Windows <-> macOS)
  return cookies.filter(c => c.name && c.domain).map(c => {
    const domain = c.domain || '';
    const cookiePath = c.path || '/';
    const host = domain.replace(/^\./, '');
    const secure = c.secure !== false; // default to true for OnlyFans (HTTPS)

    // Build cookie object — only include fields that have valid values
    // Omitting expirationDate = session cookie (correct behavior)
    const cookie = {
      url: `https://${host}${cookiePath}`,
      name: c.name,
      value: c.value || '',
      domain: domain,
      path: cookiePath,
      secure: secure,
      httpOnly: c.httpOnly || false,
    };

    // Only include expirationDate if it's a real positive number (persistent cookie)
    // Session cookies must NOT have this field — omitting it is the correct way
    if (c.expirationDate && typeof c.expirationDate === 'number' && c.expirationDate > 0) {
      cookie.expirationDate = c.expirationDate;
    }

    // sameSite handling for cross-platform compatibility:
    // - "unspecified" means the server didn't set SameSite — map to "no_restriction" if secure (safest for cross-platform)
    // - "no_restriction" (SameSite=None) REQUIRES secure=true or Chromium rejects it
    // - "lax" and "strict" work on all platforms
    const sameSite = c.sameSite || 'unspecified';
    if (sameSite === 'unspecified' || sameSite === 'no_restriction') {
      // Use no_restriction (SameSite=None) for secure cookies — this is the most permissive
      // and ensures cookies are sent in all contexts (cross-site, embedded, etc.)
      cookie.sameSite = secure ? 'no_restriction' : 'lax';
    } else {
      cookie.sameSite = sameSite; // "lax" or "strict"
    }

    return cookie;
  });
}

async function importCookies(accountId, cookies) {
  if (!Array.isArray(cookies) || cookies.length === 0) return;
  const ses = session.fromPartition(`persist:of-${accountId}`);

  // ACTUALLY clear existing cookies (flushStore only writes to disk, doesn't clear!)
  const existing = await ses.cookies.get({});
  for (const c of existing) {
    try {
      const url = `https://${(c.domain || '').replace(/^\./, '')}${c.path || '/'}`;
      await ses.cookies.remove(url, c.name);
    } catch {}
  }

  let imported = 0;
  let failed = 0;
  const errors = [];
  for (const cookie of cookies) {
    try {
      // Validate required fields before attempting set
      if (!cookie.name || !cookie.url) {
        failed++;
        continue;
      }

      // Build a clean cookie object — only pass defined fields
      const setCookie = {
        url: cookie.url,
        name: cookie.name,
        value: cookie.value || '',
        path: cookie.path || '/',
        secure: cookie.secure !== false,
        httpOnly: cookie.httpOnly || false,
      };

      // Domain: include if present (Chromium will normalize with leading dot)
      if (cookie.domain) {
        setCookie.domain = cookie.domain;
      }

      // expirationDate: only include for persistent cookies (must be positive number)
      if (cookie.expirationDate && typeof cookie.expirationDate === 'number' && cookie.expirationDate > 0) {
        setCookie.expirationDate = cookie.expirationDate;
      }
      // If no expirationDate, cookie is treated as session cookie (correct)

      // sameSite: ensure no_restriction always paired with secure=true
      if (cookie.sameSite === 'no_restriction') {
        setCookie.sameSite = 'no_restriction';
        setCookie.secure = true; // REQUIRED by Chromium for SameSite=None
      } else if (cookie.sameSite === 'lax' || cookie.sameSite === 'strict') {
        setCookie.sameSite = cookie.sameSite;
      } else {
        // "unspecified" or missing — use "lax" which is the safest cross-platform default
        setCookie.sameSite = setCookie.secure ? 'no_restriction' : 'lax';
      }

      await ses.cookies.set(setCookie);
      imported++;
    } catch (err) {
      failed++;
      if (errors.length < 5) {
        errors.push(`${cookie.name}@${cookie.domain}: ${err.message}`);
      }
    }
  }
  await ses.cookies.flushStore();
  console.log(`[Firebase Sync] Imported ${imported}/${cookies.length} cookies for ${accountId} (${failed} failed)`);
  if (errors.length > 0) {
    console.warn(`[Firebase Sync] Sample cookie errors:`, errors);
  }
}

// ============ CORE SYNC ============
async function initSync(electronStore, statusCb) {
  store = electronStore;
  syncStatusCallback = statusCb;

  const apiKey = store.get('apiKey');
  if (!apiKey) {
    emitStatus({ connected: false, error: 'No API key set' });
    return false;
  }

  // Prevent double-init
  if (initialized) return true;

  try {
    const { initializeApp, getApps } = require('firebase/app');
    const { getFirestore } = require('firebase/firestore');
    const { getAuth, signInAnonymously } = require('firebase/auth');

    // Only create app if it doesn't already exist
    const existingApps = getApps();
    firebaseApp = existingApps.length > 0 ? existingApps[0] : initializeApp(FIREBASE_CONFIG);
    db = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);

    await signInAnonymously(auth);

    initialized = true;
    emitStatus({ connected: true, lastSync: null, accounts: 0 });

    await downloadAllSessions();
    startRealtimeListener();
    startAutoUpload();

    return true;
  } catch (err) {
    console.error('[Firebase Sync] Init failed:', err.message);
    emitStatus({ connected: false, error: err.message });
    return false;
  }
}

function stopSync() {
  if (realtimeUnsubscribe) {
    realtimeUnsubscribe();
    realtimeUnsubscribe = null;
  }
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

  const teamId = getTeamId(apiKey);

  try {
    // Flush session data to disk first
    try {
      const ses = session.fromPartition(`persist:of-${accountId}`);
      await ses.cookies.flushStore();
    } catch {}

    await new Promise(r => setTimeout(r, 300));

    // Export cookies via API (cross-platform, decrypted)
    const cookies = await exportCookies(accountId);

    // Pack local/session storage files
    const packed = packPartition(accountId);

    if (!packed && cookies.length === 0) {
      console.log(`[Firebase Sync] No data for ${accountId}`);
      return;
    }

    // Only upload if this device actually logged in (has cookies) — prevent uploading stale/empty data
    if (cookies.length === 0 && !locallyOwnedSessions.has(accountId)) {
      console.log(`[Firebase Sync] Skipping upload for ${accountId} — no local cookies and not locally owned`);
      return;
    }

    // Build payload and hash
    const payload = { cookies, partition: packed ? packed.toString('base64') : null };
    const payloadStr = JSON.stringify(payload);
    const hash = crypto.createHash('sha256').update(payloadStr).digest('hex');
    if (!force && lastUploadHashes.get(accountId) === hash) return;

    // Encrypt the full payload
    const compressed = zlib.gzipSync(Buffer.from(payloadStr, 'utf8'));
    const encrypted = encrypt(compressed, apiKey);
    const b64 = encrypted.toString('base64');

    if (b64.length > 900000) {
      console.error(`[Firebase Sync] Data too large for Firestore (${Math.round(b64.length / 1024)}KB)`);
      return;
    }

    const { doc, setDoc } = require('firebase/firestore');
    const machineId = getMachineId();

    await setDoc(doc(db, `teams/${teamId}/sessions`, accountId), {
      data: b64,
      dataHash: hash,
      version: 2, // v2 = cookies via API + partition files
      updatedAt: Date.now(),
      updatedBy: machineId,
    });

    lastUploadHashes.set(accountId, hash);
    locallyOwnedSessions.add(accountId); // This device owns this session — block incoming overwrites

    const accounts = store.get('accounts') || [];
    const acct = accounts.find((a) => a.id === accountId);
    if (acct) {
      await setDoc(doc(db, `teams/${teamId}/accounts`, accountId), {
        id: acct.id,
        name: acct.name,
        updatedAt: Date.now(),
        updatedBy: machineId,
      });
    }

    emitStatus({ connected: true, lastSync: new Date().toISOString(), accounts: accounts.length });
    console.log(`[Firebase Sync] Uploaded ${cookies.length} cookies + partition for ${accountId} (${Math.round(b64.length / 1024)}KB)`);
  } catch (err) {
    console.error(`[Firebase Sync] Upload failed for ${accountId}:`, err.message);
  }
}

async function uploadAllSessions(force = false) {
  if (!initialized || !store) return;
  const accounts = store.get('accounts') || [];
  for (const acct of accounts) {
    await uploadSession(acct.id, force);
  }
}

// ============ DOWNLOAD ============
async function downloadAllSessions(force = false) {
  if (!initialized || !db || !store) return;

  const apiKey = store.get('apiKey');
  if (!apiKey) return;

  const teamId = getTeamId(apiKey);
  const machineId = getMachineId();

  try {
    const { collection, getDocs } = require('firebase/firestore');

    const accountsSnap = await getDocs(collection(db, `teams/${teamId}/accounts`));
    const remoteAccounts = [];
    accountsSnap.forEach((d) => remoteAccounts.push(d.data()));

    const localAccounts = store.get('accounts') || [];
    let updated = false;
    for (const remote of remoteAccounts) {
      if (!localAccounts.find((a) => a.id === remote.id)) {
        localAccounts.push({ id: remote.id, name: remote.name });
        updated = true;
      }
    }
    if (updated) store.set('accounts', localAccounts);

    const sessionsSnap = await getDocs(collection(db, `teams/${teamId}/sessions`));
    let syncedCount = 0;

    for (const docSnap of sessionsSnap.docs) {
      const data = docSnap.data();
      const accountId = docSnap.id;

      if (!force && data.updatedBy === machineId) {
        lastUploadHashes.set(accountId, data.dataHash || data.partitionHash || '');
        continue;
      }

      await importSession(accountId, data, apiKey);
      syncedCount++;
    }

    emitStatus({ connected: true, lastSync: new Date().toISOString(), accounts: localAccounts.length });
    console.log(`[Firebase Sync] Downloaded ${syncedCount} sessions`);
    return { syncedCount, accounts: localAccounts };
  } catch (err) {
    console.error('[Firebase Sync] Download failed:', err.message);
    emitStatus({ connected: true, lastSync: null, error: err.message });
    return null;
  }
}

async function importSession(accountId, data, apiKey) {
  try {
    if (data.version === 2 && data.data) {
      // v2 format: cookies via API + partition files
      const encrypted = Buffer.from(data.data, 'base64');
      const compressed = decrypt(encrypted, apiKey);
      const json = zlib.gunzipSync(compressed).toString('utf8');
      const payload = JSON.parse(json);

      // Import cookies via Electron API (cross-platform)
      if (payload.cookies) {
        await importCookies(accountId, payload.cookies);
      }

      // Unpack local/session storage files
      if (payload.partition) {
        const partBuf = Buffer.from(payload.partition, 'base64');
        unpackPartition(accountId, partBuf);
      }

      lastUploadHashes.set(accountId, data.dataHash || '');
    } else if (data.partition) {
      // v1 format (legacy): raw partition files including Network
      const encrypted = Buffer.from(data.partition, 'base64');
      const compressed = decrypt(encrypted, apiKey);
      unpackPartition(accountId, compressed);
      lastUploadHashes.set(accountId, data.partitionHash || '');
    }

    emitStatus({ connected: true, lastSync: new Date().toISOString() });
  } catch (err) {
    console.error(`[Firebase Sync] Import failed for ${accountId}:`, err.message);
  }
}

// ============ REAL-TIME LISTENER ============
let realtimeQueue = Promise.resolve();

function startRealtimeListener() {
  if (!initialized || !db || !store) return;

  const apiKey = store.get('apiKey');
  if (!apiKey) return;

  const teamId = getTeamId(apiKey);
  const machineId = getMachineId();

  const { collection, onSnapshot } = require('firebase/firestore');

  realtimeUnsubscribe = onSnapshot(
    collection(db, `teams/${teamId}/sessions`),
    (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type !== 'added' && change.type !== 'modified') continue;
        const data = change.doc.data();
        const accountId = change.doc.id;

        if (data.updatedBy === machineId) continue;
        if (!data.data && !data.partition) continue;

        // Don't overwrite sessions that have an active local login
        if (locallyOwnedSessions.has(accountId)) {
          console.log(`[Firebase Sync] Skipping real-time update for ${accountId} — locally owned`);
          continue;
        }

        // Queue sequentially to prevent concurrent file writes
        realtimeQueue = realtimeQueue.then(async () => {
          try {
            console.log(`[Firebase Sync] Real-time update for ${accountId}`);
            await importSession(accountId, data, apiKey);

            const localAccounts = store.get('accounts') || [];
            if (!localAccounts.find((a) => a.id === accountId)) {
              const { doc, getDoc } = require('firebase/firestore');
              const acctDoc = await getDoc(doc(db, `teams/${teamId}/accounts`, accountId));
              if (acctDoc.exists()) {
                const acctData = acctDoc.data();
                localAccounts.push({ id: acctData.id, name: acctData.name });
                store.set('accounts', localAccounts);
              }
            }

            emitStatus({ connected: true, lastSync: new Date().toISOString(), accounts: localAccounts.length });
          } catch (err) {
            console.error(`[Firebase Sync] Real-time sync error for ${accountId}:`, err.message);
          }
        });
      }
    },
    (err) => {
      console.error('[Firebase Sync] Listener error:', err.message);
    }
  );
}

// ============ AUTO UPLOAD ============
const AUTO_UPLOAD_INTERVAL = 60 * 1000; // 1 minute

function startAutoUpload() {
  if (autoUploadInterval) clearInterval(autoUploadInterval);
  autoUploadInterval = setInterval(() => {
    uploadAllSessions(false).catch(() => {});
  }, AUTO_UPLOAD_INTERVAL);
}

function markLocallyOwned(accountId) {
  locallyOwnedSessions.add(accountId);
}

// ============ EXPORTS ============
module.exports = {
  initSync,
  stopSync,
  uploadSession,
  uploadAllSessions,
  downloadAllSessions,
  markLocallyOwned,
  get isInitialized() { return initialized; },
};
