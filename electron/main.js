const { app, BrowserWindow, ipcMain, session, Menu, clipboard, shell } = require('electron');
const path = require('path');
const Store = require('electron-store').default;
const firebaseSync = require('./firebase-sync');
const { initAutoUpdater } = require('./updater');

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CHROME_HINTS = {
  'sec-ch-ua': '"Chromium";v="126", "Not/A)Brand";v="8", "Google Chrome";v="126"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const OAUTH_DOMAINS = ['accounts.google.com', 'api.twitter.com', 'twitter.com', 'x.com'];

function isOAuthUrl(url) {
  try {
    const host = new URL(url).hostname;
    return OAUTH_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

function isOnlyFansHost(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'onlyfans.com' || host.endsWith('.onlyfans.com');
  } catch {
    return false;
  }
}

const store = new Store({
  defaults: { apiKey: '', accounts: [] },
});

let mainWindow;
const activePopups = new Map();
// Runtime map: proxy host:port -> { username, password }
const proxyCredentials = new Map();

function spoofHeaders(ses) {
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = CHROME_UA;
    Object.assign(details.requestHeaders, CHROME_HINTS);
    callback({ requestHeaders: details.requestHeaders });
  });
}

function openOAuthPopup(url, partition, wvContents) {
  if (activePopups.has(partition)) {
    const existing = activePopups.get(partition);
    if (!existing.isDestroyed()) {
      existing.focus();
      existing.loadURL(url, { userAgent: CHROME_UA });
      return;
    }
  }

  const ses = session.fromPartition(partition);
  spoofHeaders(ses);

  // Deny WebAuthn/passkey requests so the regular email/password form shows
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'hid' || permission === 'usb') {
      callback(false);
    } else {
      callback(true);
    }
  });

  const popup = new BrowserWindow({
    width: 500,
    height: 700,
    parent: mainWindow,
    backgroundColor: '#ffffff',
    title: 'Sign In',
    autoHideMenuBar: true,
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  activePopups.set(partition, popup);
  popup.setMenuBarVisibility(false);
  popup.webContents.setUserAgent(CHROME_UA);

  // Inject script to disable passkey/WebAuthn prompts
  popup.webContents.on('did-finish-load', () => {
    popup.webContents.executeJavaScript(`
      if (navigator.credentials) {
        const origGet = navigator.credentials.get.bind(navigator.credentials);
        navigator.credentials.get = function(opts) {
          if (opts && opts.publicKey) {
            return Promise.reject(new DOMException('Cancelled', 'NotAllowedError'));
          }
          return origGet(opts);
        };
      }
    `).catch(() => {});
  });

  popup.loadURL(url, { userAgent: CHROME_UA });

  // Check if auth completed — ONLY when the actual hostname is onlyfans.com
  const onNav = (_, navUrl) => {
    if (isOnlyFansHost(navUrl)) {
      if (wvContents && !wvContents.isDestroyed()) {
        wvContents.loadURL(navUrl);
      }
      setTimeout(() => { if (!popup.isDestroyed()) popup.close(); }, 500);
    }
  };

  popup.webContents.on('will-navigate', onNav);
  popup.webContents.on('will-redirect', onNav);
  popup.webContents.on('did-navigate', onNav);

  popup.webContents.setWindowOpenHandler(({ url: subUrl }) => {
    popup.loadURL(subUrl, { userAgent: CHROME_UA });
    return { action: 'deny' };
  });

  popup.on('closed', () => activePopups.delete(partition));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist-react', 'index.html'));
  }

  // Apply saved proxies on startup
  const savedAccounts = store.get('accounts') || [];
  for (const acct of savedAccounts) {
    if (acct.proxy && acct.proxy.enabled && acct.proxy.host && acct.proxy.port) {
      const ses = session.fromPartition(`persist:of-${acct.id}`);
      ses.setProxy({ proxyRules: buildProxyRules(acct.proxy) });
      registerProxyAuth(acct.proxy);
    }
  }

  mainWindow.webContents.on('did-attach-webview', (_, wvContents) => {
    wvContents.setUserAgent(CHROME_UA);

    // Default OF view — no sidebar modification, pages render exactly as in a normal browser


    const prefs = wvContents.getLastWebPreferences();
    const partition = prefs?.partition || 'persist:default';

    const wvSession = session.fromPartition(partition);
    spoofHeaders(wvSession);

    // LAYER 1: same-frame navigation
    wvContents.on('will-navigate', (e, url) => {
      if (isOAuthUrl(url)) {
        e.preventDefault();
        openOAuthPopup(url, partition, wvContents);
      }
    });

    // LAYER 2: server-side redirects
    wvContents.on('will-redirect', (e, url) => {
      if (isOAuthUrl(url)) {
        e.preventDefault();
        openOAuthPopup(url, partition, wvContents);
      }
    });

    // LAYER 3: window.open() popups
    wvContents.setWindowOpenHandler(({ url }) => {
      if (isOAuthUrl(url)) {
        openOAuthPopup(url, partition, wvContents);
      } else {
        wvContents.loadURL(url);
      }
      return { action: 'deny' };
    });

    // Right-click context menu
    wvContents.on('context-menu', (e, params) => {
      const menuItems = [];
      if (params.linkURL) {
        menuItems.push({
          label: 'Open Link in New Tab',
          click: () => {
            mainWindow.webContents.send('open-new-tab', params.linkURL);
          },
        });
        menuItems.push({
          label: 'Copy Link',
          click: () => clipboard.writeText(params.linkURL),
        });
        menuItems.push({ type: 'separator' });
      }
      if (params.selectionText) {
        menuItems.push({
          label: 'Copy',
          click: () => clipboard.writeText(params.selectionText),
        });
        menuItems.push({ type: 'separator' });
      }
      menuItems.push({
        label: 'Reload',
        click: () => wvContents.reload(),
      });
      if (menuItems.length > 0) {
        Menu.buildFromTemplate(menuItems).popup();
      }
    });

    // LAYER 4: network-level fallback
    wvSession.webRequest.onBeforeRequest(
      { urls: ['*://accounts.google.com/*'] },
      (details, callback) => {
        if (details.resourceType !== 'mainFrame') {
          callback({});
          return;
        }
        const popup = activePopups.get(partition);
        if (popup && !popup.isDestroyed() && popup.webContents.id === details.webContentsId) {
          callback({});
          return;
        }
        callback({ cancel: true });
        openOAuthPopup(details.url, partition, wvContents);
      }
    );
  });
}

// Window controls
ipcMain.handle('win-minimize', () => mainWindow?.minimize());
ipcMain.handle('win-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('win-close', () => mainWindow?.close());
ipcMain.handle('open-external', (_, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return shell.openExternal(url);
    }
  } catch {}
});

ipcMain.handle('get-api-key', () => store.get('apiKey'));
ipcMain.handle('set-api-key', (_, key) => { store.set('apiKey', key); return true; });
ipcMain.handle('get-accounts', () => store.get('accounts'));
ipcMain.handle('save-account', (_, account) => {
  const accounts = store.get('accounts');
  const idx = accounts.findIndex((a) => a.id === account.id);
  if (idx >= 0) accounts[idx] = { ...accounts[idx], ...account };
  else accounts.push(account);
  store.set('accounts', accounts);
  // Sync account list to Firebase
  if (firebaseSync.isInitialized) {
    firebaseSync.uploadSession(account.id).catch(() => {});
  }
  return accounts;
});
ipcMain.handle('remove-account', (_, id) => {
  const allAccounts = store.get('accounts');
  const removed = allAccounts.find((a) => a.id === id);
  const accounts = allAccounts.filter((a) => a.id !== id);
  store.set('accounts', accounts);
  // Clean up proxy credentials for removed account
  if (removed?.proxy) unregisterProxyAuth(removed.proxy);
  session.fromPartition(`persist:of-${id}`).clearStorageData();
  return accounts;
});

// Proxy helpers
function buildProxyRules(proxy) {
  // Chromium proxy rules: no credentials in URL, just scheme://host:port
  const scheme = proxy.protocol === 'socks5' ? 'socks5' : 'http';
  return `${scheme}://${proxy.host}:${proxy.port}`;
}

function registerProxyAuth(proxy) {
  if (proxy.username) {
    const key = `${proxy.host}:${proxy.port}`;
    proxyCredentials.set(key, { username: proxy.username, password: proxy.password });
  }
}

function unregisterProxyAuth(proxy) {
  if (proxy?.host && proxy?.port) {
    proxyCredentials.delete(`${proxy.host}:${proxy.port}`);
  }
}

// Proxy handlers
ipcMain.handle('set-proxy', async (_, { accountId, proxy }) => {
  // Save proxy config to account
  const accounts = store.get('accounts');
  const idx = accounts.findIndex((a) => a.id === accountId);
  // Capture old proxy BEFORE mutating
  const oldProxy = idx >= 0 ? accounts[idx].proxy : null;
  if (idx >= 0) {
    accounts[idx].proxy = proxy;
    store.set('accounts', accounts);
  }
  // Apply proxy to account's session partition
  const ses = session.fromPartition(`persist:of-${accountId}`);
  // Unregister old proxy auth if any
  if (oldProxy) unregisterProxyAuth(oldProxy);
  if (proxy && proxy.enabled && proxy.host && proxy.port) {
    await ses.setProxy({ proxyRules: buildProxyRules(proxy) });
    registerProxyAuth(proxy);
  } else {
    await ses.setProxy({ proxyRules: '' });
  }
  return true;
});

ipcMain.handle('test-proxy', async (_, { proxy }) => {
  const start = Date.now();
  try {
    // Use Node's http module directly with the proxy — more reliable than Electron net.request
    const http = require('http');

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timed out (15s)')), 15000);

      // Build proxy request options
      const proxyOpts = {
        host: proxy.host,
        port: parseInt(proxy.port),
        path: 'http://ip-api.com/json',
        method: 'GET',
        headers: {
          Host: 'ip-api.com',
        },
      };

      // Add proxy auth header if credentials provided
      if (proxy.username) {
        const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
        proxyOpts.headers['Proxy-Authorization'] = `Basic ${auth}`;
      }

      const req = http.request(proxyOpts, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          clearTimeout(timeout);
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error('Invalid response from proxy')); }
        });
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      req.end();
    });

    const latency = Date.now() - start;
    return {
      success: true,
      ip: result.query || result.ip,
      country: result.countryCode || result.country,
      city: result.city,
      latency,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-proxy', (_, accountId) => {
  const accounts = store.get('accounts');
  const acct = accounts.find((a) => a.id === accountId);
  return acct?.proxy || null;
});

// Global proxy auth handler — this is where Electron handles 407 challenges
app.on('login', (event, _webContents, _details, authInfo, callback) => {
  if (authInfo.isProxy) {
    const key = `${authInfo.host}:${authInfo.port}`;
    const creds = proxyCredentials.get(key);
    if (creds) {
      event.preventDefault();
      callback(creds.username, creds.password);
      return;
    }
  }
  // Default behavior for non-proxy auth
  callback();
});

// ============ SESSION SYNC IPC ============
let syncStatus = { connected: false };

ipcMain.handle('sync-status', () => syncStatus);

ipcMain.handle('sync-force', async () => {
  if (!firebaseSync.isInitialized) {
    const ok = await firebaseSync.initSync(store, (status) => {
      syncStatus = status;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync-update', status);
      }
    });
    if (!ok) return { success: false, error: 'Failed to connect' };
  }
  await firebaseSync.uploadAllSessions(true); // force=true bypasses hash check
  return { success: true };
});

ipcMain.handle('sync-download', async () => {
  if (!firebaseSync.isInitialized) return { success: false, error: 'Not connected' };
  const result = await firebaseSync.downloadAllSessions(true); // force=true bypasses own-upload skip
  // Notify renderer to refresh accounts and signal sync complete
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-accounts-updated', store.get('accounts') || []);
    mainWindow.webContents.send('sync-ready');
  }
  return { success: true, ...result };
});

// Upload a specific account's session immediately (called on account switch)
ipcMain.handle('sync-upload-account', async (_, accountId) => {
  if (!firebaseSync.isInitialized || !accountId) return;
  await firebaseSync.uploadSession(accountId, false);
});

async function initFirebaseSync() {
  const apiKey = store.get('apiKey');
  if (!apiKey) return;

  try {
    await firebaseSync.initSync(store, (status) => {
      syncStatus = status;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync-update', status);
      }
    });
    // After initial download completes, notify renderer to refresh account list
    // This ensures any newly-synced accounts appear in the sidebar
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync-accounts-updated', store.get('accounts') || []);
      // Signal that sync download is complete — webviews can now load with valid cookies
      mainWindow.webContents.send('sync-ready');
    }
  } catch (err) {
    console.error('[Sync] Failed to init:', err.message);
  }
}

app.whenReady().then(() => {
  createWindow();
  initAutoUpdater();
  // Initialize Firebase sync after window is ready
  initFirebaseSync();
});
app.on('before-quit', async (e) => {
  if (firebaseSync.isInitialized) {
    e.preventDefault();
    await firebaseSync.uploadAllSessions(false);
    firebaseSync.stopSync();
    app.exit();
  }
});
app.on('window-all-closed', () => {
  app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
