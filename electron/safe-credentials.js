// Transparent credential encryption using Electron's safeStorage API
// (Windows DPAPI / macOS Keychain). All callers get/set plaintext;
// encryption is handled internally.
const { safeStorage } = require('electron');

let storeRef = null;
let encryptionAvailable = false;

function encryptValue(plaintext) {
  return safeStorage.encryptString(plaintext).toString('base64');
}

function decryptValue(base64) {
  return safeStorage.decryptString(Buffer.from(base64, 'base64'));
}

/**
 * Initialize credential storage and run one-time migration from plaintext.
 * Must be called after app.whenReady().
 */
function initCredentials(store) {
  storeRef = store;
  encryptionAvailable = safeStorage.isEncryptionAvailable();

  if (!encryptionAvailable) {
    console.warn('[Credentials] safeStorage not available — storing in plaintext');
    return;
  }

  if (store.get('_credVersion') === 2) return;

  // --- One-time migration from plaintext ---
  console.log('[Credentials] Migrating to encrypted storage...');

  // API key
  const apiKey = store.get('apiKey');
  if (apiKey) {
    store.set('_enc_apiKey', encryptValue(apiKey));
    store.delete('apiKey');
  }

  // Proxy provider credentials
  const provider = store.get('proxyProvider');
  if (provider && (provider.username || provider.password)) {
    store.set('_enc_proxyProvider', encryptValue(
      JSON.stringify({ username: provider.username || '', password: provider.password || '' })
    ));
    const clean = { ...provider };
    delete clean.username;
    delete clean.password;
    store.set('proxyProvider', clean);
  }

  // Per-account proxy credentials
  const accounts = store.get('accounts') || [];
  let changed = false;
  for (const acct of accounts) {
    if (acct.proxy && (acct.proxy.username || acct.proxy.password)) {
      acct.proxy._enc_creds = encryptValue(
        JSON.stringify({ username: acct.proxy.username || '', password: acct.proxy.password || '' })
      );
      delete acct.proxy.username;
      delete acct.proxy.password;
      changed = true;
    }
  }
  if (changed) store.set('accounts', accounts);

  store.set('_credVersion', 2);
  console.log('[Credentials] Migration complete');
}

// ============ API KEY ============
function getApiKey() {
  if (encryptionAvailable) {
    const enc = storeRef.get('_enc_apiKey');
    if (enc) {
      try { return decryptValue(enc); } catch { return ''; }
    }
    return '';
  }
  return storeRef.get('apiKey') || '';
}

function setApiKey(key) {
  if (encryptionAvailable) {
    if (key) {
      storeRef.set('_enc_apiKey', encryptValue(key));
    } else {
      storeRef.delete('_enc_apiKey');
    }
    storeRef.delete('apiKey');
  } else {
    storeRef.set('apiKey', key);
  }
}

// ============ PROXY PROVIDER ============
function getProxyProvider() {
  const config = { ...(storeRef.get('proxyProvider') || {}) };
  if (encryptionAvailable) {
    const enc = storeRef.get('_enc_proxyProvider');
    if (enc) {
      try {
        const creds = JSON.parse(decryptValue(enc));
        config.username = creds.username || '';
        config.password = creds.password || '';
      } catch {}
    }
  }
  return config;
}

function setProxyProvider(config) {
  if (encryptionAvailable) {
    const creds = { username: config.username || '', password: config.password || '' };
    if (creds.username || creds.password) {
      storeRef.set('_enc_proxyProvider', encryptValue(JSON.stringify(creds)));
    } else {
      storeRef.delete('_enc_proxyProvider');
    }
    const clean = { ...config };
    delete clean.username;
    delete clean.password;
    storeRef.set('proxyProvider', clean);
  } else {
    storeRef.set('proxyProvider', config);
  }
}

// ============ ACCOUNTS ============
function getAccounts() {
  const accounts = storeRef.get('accounts') || [];
  if (!encryptionAvailable) return accounts;

  // Return copies with decrypted proxy creds (avoids mutating store internals)
  return accounts.map(acct => {
    if (!acct.proxy?._enc_creds) return { ...acct };
    const copy = { ...acct, proxy: { ...acct.proxy } };
    try {
      const creds = JSON.parse(decryptValue(copy.proxy._enc_creds));
      copy.proxy.username = creds.username || '';
      copy.proxy.password = creds.password || '';
    } catch {}
    return copy;
  });
}

function setAccounts(accounts) {
  if (!encryptionAvailable) {
    storeRef.set('accounts', accounts);
    return;
  }

  const toStore = accounts.map(acct => {
    if (!acct.proxy) return acct;
    if (!acct.proxy.username && !acct.proxy.password) return acct;
    const copy = { ...acct, proxy: { ...acct.proxy } };
    copy.proxy._enc_creds = encryptValue(
      JSON.stringify({ username: copy.proxy.username || '', password: copy.proxy.password || '' })
    );
    delete copy.proxy.username;
    delete copy.proxy.password;
    return copy;
  });
  storeRef.set('accounts', toStore);
}

module.exports = {
  initCredentials,
  getApiKey,
  setApiKey,
  getProxyProvider,
  setProxyProvider,
  getAccounts,
  setAccounts,
};
