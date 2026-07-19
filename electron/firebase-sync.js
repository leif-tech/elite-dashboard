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
let syncStatusCallback = null;
let lastUploadHashes = new Map(); // accountId -> hash

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCtweAn8fMiNy0940RclIL1t-LZfcbxMwk',
  authDomain: 'elite-228d6.firebaseapp.com',
  projectId: 'elite-228d6',
  storageBucket: 'elite-228d6.firebasestorage.app',
  messagingSenderId: '367015080565',
  appId: '1:367015080565:web:edadcef1bcda99ce4b7e3c',
};

// Folders/files to sync from partition (skip caches)
const SYNC_DIRS = ['Network', 'Local Storage', 'Session Storage'];
const SYNC_FILES = ['Preferences'];
const SKIP_FILES = ['LOCK', 'LOG', 'LOG.old'];

// ============ ENCRYPTION ============
function deriveKey(apiKey) {
  return crypto.pbkdf2Sync(apiKey, 'elite-dashboard-sync-salt', 100000, 32, 'sha256');
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

// ============ PARTITION FOLDER PACKING ============
function packPartition(accountId) {
  const partDir = getPartitionPath(accountId);
  if (!fs.existsSync(partDir)) return null;

  const files = [];

  // Collect files from sync directories
  for (const dir of SYNC_DIRS) {
    const dirPath = path.join(partDir, dir);
    if (!fs.existsSync(dirPath)) continue;
    collectFiles(dirPath, dir, files);
  }

  // Collect individual files
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

function collectFiles(dirPath, relativeTo, files) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_FILES.includes(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.join(relativeTo, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, relPath, files);
    } else {
      try {
        const data = fs.readFileSync(fullPath);
        files.push({ path: relPath.replace(/\\/g, '/'), data: data.toString('base64') });
      } catch {}
    }
  }
}

function unpackPartition(accountId, compressed) {
  const partDir = getPartitionPath(accountId);

  const json = zlib.gunzipSync(compressed).toString('utf8');
  const files = JSON.parse(json);

  for (const file of files) {
    const filePath = path.join(partDir, ...file.path.split('/'));
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(file.data, 'base64'));
  }

  console.log(`[Firebase Sync] Unpacked ${files.length} files to partition for ${accountId}`);
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

  try {
    const { initializeApp } = require('firebase/app');
    const { getFirestore } = require('firebase/firestore');
    const { getAuth, signInAnonymously } = require('firebase/auth');

    firebaseApp = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);

    await signInAnonymously(auth);

    initialized = true;
    emitStatus({ connected: true, lastSync: null, accounts: 0 });

    // Initial download only
    await downloadAllSessions();

    // Start real-time listener
    startRealtimeListener();

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
    const ses = session.fromPartition(`persist:of-${accountId}`);
    await ses.cookies.flushStore();

    // Small delay to let files settle
    await new Promise(r => setTimeout(r, 500));

    // Pack the partition folder
    const packed = packPartition(accountId);
    if (!packed) {
      console.log(`[Firebase Sync] No partition data for ${accountId}`);
      return;
    }

    // Hash for change detection
    const hash = crypto.createHash('sha256').update(packed).digest('hex');
    if (!force && lastUploadHashes.get(accountId) === hash) return;

    // Encrypt
    const encrypted = encrypt(packed, apiKey);
    const b64 = encrypted.toString('base64');

    // Firestore has 1MB doc limit — check size
    if (b64.length > 900000) {
      console.error(`[Firebase Sync] Partition too large for Firestore (${Math.round(b64.length/1024)}KB)`);
      return;
    }

    const { doc, setDoc } = require('firebase/firestore');
    const machineId = getMachineId();

    await setDoc(doc(db, `teams/${teamId}/sessions`, accountId), {
      partition: b64,
      partitionHash: hash,
      updatedAt: Date.now(),
      updatedBy: machineId,
    });

    lastUploadHashes.set(accountId, hash);

    // Sync account metadata
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
    console.log(`[Firebase Sync] Uploaded partition for ${accountId} (${Math.round(b64.length/1024)}KB)`);
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

    // Download account list
    const accountsSnap = await getDocs(collection(db, `teams/${teamId}/accounts`));
    const remoteAccounts = [];
    accountsSnap.forEach((d) => remoteAccounts.push(d.data()));

    // Sync remote accounts to local
    const localAccounts = store.get('accounts') || [];
    let updated = false;
    for (const remote of remoteAccounts) {
      if (!localAccounts.find((a) => a.id === remote.id)) {
        localAccounts.push({ id: remote.id, name: remote.name });
        updated = true;
      }
    }
    if (updated) store.set('accounts', localAccounts);

    // Download sessions
    const sessionsSnap = await getDocs(collection(db, `teams/${teamId}/sessions`));
    let syncedCount = 0;

    for (const docSnap of sessionsSnap.docs) {
      const data = docSnap.data();
      const accountId = docSnap.id;

      // Skip own uploads (unless force)
      if (!force && data.updatedBy === machineId) {
        lastUploadHashes.set(accountId, data.partitionHash || '');
        continue;
      }

      // Skip if no partition data (old cookie-based format)
      if (!data.partition) {
        console.log(`[Firebase Sync] Skipping ${accountId} — no partition data (old format)`);
        continue;
      }

      await importPartition(accountId, data, apiKey);
      syncedCount++;
    }

    emitStatus({ connected: true, lastSync: new Date().toISOString(), accounts: localAccounts.length });
    console.log(`[Firebase Sync] Downloaded ${syncedCount} sessions`);
    return { syncedCount, accounts: localAccounts };
  } catch (err) {
    console.error('[Firebase Sync] Download failed:', err.message);
    emitStatus({ connected: true, lastSync: null, error: err.message });
  }
}

async function importPartition(accountId, data, apiKey) {
  try {
    // Decrypt
    const encrypted = Buffer.from(data.partition, 'base64');
    const compressed = decrypt(encrypted, apiKey);

    // Unpack to partition folder
    unpackPartition(accountId, compressed);

    lastUploadHashes.set(accountId, data.partitionHash || '');
    emitStatus({ connected: true, lastSync: new Date().toISOString() });
  } catch (err) {
    console.error(`[Firebase Sync] Import failed for ${accountId}:`, err.message);
  }
}

// ============ REAL-TIME LISTENER ============
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
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const data = change.doc.data();
          const accountId = change.doc.id;

          if (data.updatedBy === machineId) return;
          if (!data.partition) return;

          console.log(`[Firebase Sync] Real-time update for ${accountId}`);
          await importPartition(accountId, data, apiKey);

          // Sync account list
          const localAccounts = store.get('accounts') || [];
          if (!localAccounts.find((a) => a.id === accountId)) {
            try {
              const { doc, getDoc } = require('firebase/firestore');
              const acctDoc = await getDoc(doc(db, `teams/${teamId}/accounts`, accountId));
              if (acctDoc.exists()) {
                const acctData = acctDoc.data();
                localAccounts.push({ id: acctData.id, name: acctData.name });
                store.set('accounts', localAccounts);
              }
            } catch {}
          }

          emitStatus({ connected: true, lastSync: new Date().toISOString(), accounts: localAccounts.length });
        }
      });
    },
    (err) => {
      console.error('[Firebase Sync] Listener error:', err.message);
    }
  );
}

// ============ EXPORTS ============
module.exports = {
  initSync,
  stopSync,
  uploadSession,
  uploadAllSessions,
  downloadAllSessions,
  get isInitialized() { return initialized; },
  get isImporting() { return false; }, // no longer needed with partition approach
};
