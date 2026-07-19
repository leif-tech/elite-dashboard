const { session } = require('electron');
const crypto = require('crypto');

// Firebase SDK (modular)
let firebaseApp, db, auth;
let initialized = false;
let store = null;
let realtimeUnsubscribe = null;
let uploadInterval = null;
let syncStatusCallback = null;
let lastUploadHashes = new Map(); // accountId -> hash
let isImporting = false; // flag to suppress cookie-changed during import

// ============ FIREBASE CONFIG ============
// Replace with your Firebase project config (one-time setup)
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCtweAn8fMiNy0940RclIL1t-LZfcbxMwk',
  authDomain: 'elite-228d6.firebaseapp.com',
  projectId: 'elite-228d6',
  storageBucket: 'elite-228d6.firebasestorage.app',
  messagingSenderId: '367015080565',
  appId: '1:367015080565:web:edadcef1bcda99ce4b7e3c',
};

// ============ ENCRYPTION ============
function deriveKey(apiKey) {
  // PBKDF2 with API key as password, fixed salt (both machines share same key)
  return crypto.pbkdf2Sync(apiKey, 'elite-dashboard-sync-salt', 100000, 32, 'sha256');
}

function encrypt(plaintext, apiKey) {
  const key = deriveKey(apiKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

function decrypt(encryptedStr, apiKey) {
  const key = deriveKey(apiKey);
  const parts = encryptedStr.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function hashCookies(cookies) {
  return crypto.createHash('sha256').update(JSON.stringify(cookies)).digest('hex');
}

function getTeamId(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
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
    // Dynamic import firebase
    const { initializeApp } = require('firebase/app');
    const { getFirestore } = require('firebase/firestore');
    const { getAuth, signInAnonymously } = require('firebase/auth');

    firebaseApp = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);

    // Anonymous auth
    await signInAnonymously(auth);

    initialized = true;
    emitStatus({ connected: true, lastSync: null, accounts: 0 });

    // Initial download only — don't auto-upload on startup
    // Uploads happen via: cookie-changed listener, periodic interval, or Force Upload
    await downloadAllSessions();

    // Start real-time listener
    startRealtimeListener();

    // Periodic upload every 3 minutes (skips if cookies unchanged via hash check)
    uploadInterval = setInterval(() => uploadAllSessions(), 3 * 60 * 1000);

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
  if (uploadInterval) {
    clearInterval(uploadInterval);
    uploadInterval = null;
  }
  initialized = false;
  emitStatus({ connected: false });
}

function emitStatus(status) {
  if (syncStatusCallback) syncStatusCallback(status);
}

// ============ UPLOAD ============
async function uploadSession(accountId) {
  if (!initialized || !db || !store) return;

  const apiKey = store.get('apiKey');
  if (!apiKey) return;

  const teamId = getTeamId(apiKey);
  const ses = session.fromPartition(`persist:of-${accountId}`);

  try {
    // Get all cookies for onlyfans.com
    const allCookies = await ses.cookies.get({ domain: '.onlyfans.com' });
    // Also get cookies without leading dot
    const allCookies2 = await ses.cookies.get({ domain: 'onlyfans.com' });

    // Merge and deduplicate
    const cookieMap = new Map();
    [...allCookies, ...allCookies2].forEach((c) => {
      const key = `${c.name}|${c.domain}|${c.path}`;
      cookieMap.set(key, c);
    });

    // Filter expired cookies
    const now = Date.now() / 1000;
    const cookies = [...cookieMap.values()].filter((c) => {
      if (c.expirationDate && c.expirationDate < now) return false;
      return true;
    });

    if (cookies.length === 0) return;

    // Check if changed
    const hash = hashCookies(cookies);
    if (lastUploadHashes.get(accountId) === hash) return; // No change

    // Encrypt and upload
    const encrypted = encrypt(JSON.stringify(cookies), apiKey);
    const { doc, setDoc } = require('firebase/firestore');

    const machineId = getMachineId();
    await setDoc(doc(db, `teams/${teamId}/sessions`, accountId), {
      cookies: encrypted,
      cookieHash: hash,
      updatedAt: Date.now(),
      updatedBy: machineId,
    });

    lastUploadHashes.set(accountId, hash);

    // Also sync account metadata
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
    console.log(`[Firebase Sync] Uploaded session for ${accountId} (${cookies.length} cookies)`);
  } catch (err) {
    console.error(`[Firebase Sync] Upload failed for ${accountId}:`, err.message);
  }
}

async function uploadAllSessions() {
  if (!initialized || !store) return;
  const accounts = store.get('accounts') || [];
  for (const acct of accounts) {
    await uploadSession(acct.id);
  }
}

// ============ DOWNLOAD ============
async function downloadAllSessions() {
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
    accountsSnap.forEach((doc) => remoteAccounts.push(doc.data()));

    // Sync remote accounts to local (add missing ones)
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

      // Skip if we uploaded this ourselves (no need to re-import our own cookies)
      if (data.updatedBy === machineId) {
        lastUploadHashes.set(accountId, data.cookieHash);
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
  }
}

async function importSession(accountId, data, apiKey) {
  try {
    isImporting = true;
    const decrypted = decrypt(data.cookies, apiKey);
    const cookies = JSON.parse(decrypted);

    const ses = session.fromPartition(`persist:of-${accountId}`);
    const now = Date.now() / 1000;
    let imported = 0;
    let failed = 0;

    for (const cookie of cookies) {
      // Skip expired
      if (cookie.expirationDate && cookie.expirationDate < now) continue;

      try {
        // Normalize sameSite — Electron expects: unspecified, no_restriction, lax, strict
        let sameSite = (cookie.sameSite || 'no_restriction').toLowerCase();
        if (sameSite === 'none') sameSite = 'no_restriction';
        if (!['unspecified', 'no_restriction', 'lax', 'strict'].includes(sameSite)) {
          sameSite = 'no_restriction';
        }

        const cleanDomain = cookie.domain.replace(/^\./, '');
        const cookieDetails = {
          url: `https://${cleanDomain}${cookie.path || '/'}`,
          name: cookie.name,
          value: cookie.value,
          path: cookie.path || '/',
          secure: cookie.secure !== false,
          httpOnly: cookie.httpOnly || false,
          sameSite,
        };
        // Only pass domain for subdomain cookies (dot-prefixed)
        // Host-only cookies (no dot) must NOT have domain — Electron derives from URL
        if (cookie.domain.startsWith('.')) {
          cookieDetails.domain = cookie.domain;
        }
        if (cookie.expirationDate) {
          cookieDetails.expirationDate = cookie.expirationDate;
        }
        await ses.cookies.set(cookieDetails);
        imported++;
      } catch (e) {
        failed++;
        if (failed <= 3) console.warn(`[Firebase Sync] Cookie set failed: ${cookie.name} — ${e.message}`);
      }
    }

    // Flush cookies to disk so they persist
    await ses.cookies.flushStore();
    console.log(`[Firebase Sync] Imported ${imported} cookies for ${accountId} (${failed} failed)`);

    // Verify cookies were actually set
    const verify = await ses.cookies.get({ url: 'https://onlyfans.com' });
    console.log(`[Firebase Sync] Verify: ${verify.length} cookies now in partition for onlyfans.com`);
    for (const c of verify) {
      console.log(`  ${c.name} | ${c.domain} | hostOnly=${!c.domain.startsWith('.')} | value=${c.value.substring(0, 15)}...`);
    }

    // Update local hash so we don't re-upload what we just downloaded
    lastUploadHashes.set(accountId, data.cookieHash);
    isImporting = false;
  } catch (err) {
    isImporting = false;
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

          // Skip our own updates
          if (data.updatedBy === machineId) {
            return;
          }

          console.log(`[Firebase Sync] Real-time update for ${accountId}`);
          await importSession(accountId, data, apiKey);

          // Sync account list too
          const localAccounts = store.get('accounts') || [];
          if (!localAccounts.find((a) => a.id === accountId)) {
            // Fetch account metadata
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
      emitStatus({ connected: true, error: err.message });
    }
  );
}

// ============ HELPERS ============
function getMachineId() {
  const os = require('os');
  const raw = `${os.hostname()}-${os.userInfo().username}-${os.platform()}`;
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
}

// ============ EXPORTS ============
module.exports = {
  initSync,
  stopSync,
  uploadSession,
  uploadAllSessions,
  downloadAllSessions,
  get isInitialized() { return initialized; },
  get isImporting() { return isImporting; },
};
