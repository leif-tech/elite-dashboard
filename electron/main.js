const { app, BrowserWindow, ipcMain, session, Menu, clipboard, shell } = require('electron');
const path = require('path');
const Store = require('electron-store').default;
const firebaseSync = require('./firebase-sync');
const { initAutoUpdater, stopAutoUpdater } = require('./updater');

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
let quitting = false;
const activePopups = new Map();
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

  const ALLOWED_PERMISSIONS = ['clipboard-sanitized-write', 'media'];
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.includes(permission));
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

  // NOTE: Proxy setup moved to applyAllProxies() — called AFTER sync downloads
  // so that session.fromPartition() doesn't initialize sessions before partition
  // files are written to disk.

  mainWindow.webContents.on('did-attach-webview', (_, wvContents) => {
    wvContents.setUserAgent(CHROME_UA);

    const prefs = wvContents.getLastWebPreferences();
    const partition = prefs?.partition || 'persist:default';

    const wvSession = session.fromPartition(partition);
    spoofHeaders(wvSession);

    // Restrict permissions — only allow clipboard and media (for OF content)
    const WV_ALLOWED = ['clipboard-sanitized-write', 'media', 'notifications'];
    wvSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(WV_ALLOWED.includes(permission));
    });

    wvContents.on('will-navigate', (e, url) => {
      if (isOAuthUrl(url)) {
        e.preventDefault();
        openOAuthPopup(url, partition, wvContents);
      }
    });

    wvContents.on('will-redirect', (e, url) => {
      if (isOAuthUrl(url)) {
        e.preventDefault();
        openOAuthPopup(url, partition, wvContents);
      }
    });

    wvContents.setWindowOpenHandler(({ url }) => {
      if (isOAuthUrl(url)) {
        openOAuthPopup(url, partition, wvContents);
      } else {
        wvContents.loadURL(url);
      }
      return { action: 'deny' };
    });

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

// ============ PROXY ============
function buildProxyRules(proxy) {
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

// Apply saved proxies to account sessions.
// MUST be called AFTER sync downloads, so partition files exist on disk
// before session.fromPartition() initializes the session.
function applyAllProxies() {
  const savedAccounts = store.get('accounts') || [];
  for (const acct of savedAccounts) {
    if (acct.proxy && acct.proxy.enabled && acct.proxy.host && acct.proxy.port) {
      const ses = session.fromPartition(`persist:of-${acct.id}`);
      ses.setProxy({ proxyRules: buildProxyRules(acct.proxy) });
      registerProxyAuth(acct.proxy);
    }
  }
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
  } catch (err) {
    console.warn('[Main] Failed to open external URL:', err.message);
  }
});

// ============ ACCOUNT & API KEY IPC ============
ipcMain.handle('get-api-key', () => store.get('apiKey'));
ipcMain.handle('set-api-key', async (_, key) => {
  store.set('apiKey', key);
  if (!firebaseSync.isInitialized && key) {
    await initFirebaseSync();
    applyAllProxies();
  }
  return true;
});

ipcMain.handle('get-accounts', () => store.get('accounts') || []);

// Check which accounts have onlyfans.com cookies (= logged in)
ipcMain.handle('check-all-login-status', async () => {
  const accounts = store.get('accounts') || [];
  const status = {};
  for (const acct of accounts) {
    try {
      const ses = session.fromPartition(`persist:of-${acct.id}`);
      const ofCookies = await ses.cookies.get({ domain: 'onlyfans.com' });
      status[acct.id] = ofCookies.length > 0;
    } catch {
      status[acct.id] = false;
    }
  }
  return status;
});

// Save reordered accounts array
ipcMain.handle('reorder-accounts', (_, accounts) => {
  if (!Array.isArray(accounts)) return store.get('accounts') || [];
  store.set('accounts', accounts);
  return accounts;
});

ipcMain.handle('save-account', (_, account) => {
  if (!account || typeof account.id !== 'string') return store.get('accounts') || [];
  const accounts = store.get('accounts');
  const idx = accounts.findIndex((a) => a.id === account.id);
  const isExisting = idx >= 0;
  if (isExisting) accounts[idx] = { ...accounts[idx], ...account };
  else accounts.push(account);
  store.set('accounts', accounts);
  // Only upload existing accounts — new accounts have no session data yet
  // and uploading would mark them as initialized, preventing partition downloads
  if (isExisting && firebaseSync.isInitialized) {
    firebaseSync.uploadSession(account.id).catch(() => {});
  }
  return accounts;
});

ipcMain.handle('remove-account', async (_, id) => {
  const allAccounts = store.get('accounts');
  const removed = allAccounts.find((a) => a.id === id);
  const accounts = allAccounts.filter((a) => a.id !== id);
  store.set('accounts', accounts);
  if (removed?.proxy) unregisterProxyAuth(removed.proxy);
  await session.fromPartition(`persist:of-${id}`).clearStorageData();
  // Clean up partition files from disk
  const fs = require('fs');
  const partDir = path.join(app.getPath('userData'), 'Partitions', `of-${id}`);
  if (fs.existsSync(partDir)) {
    fs.rmSync(partDir, { recursive: true, force: true });
  }
  // Delete from Firestore so removed account doesn't reappear via sync
  if (firebaseSync.isInitialized) {
    firebaseSync.deleteRemoteSession(id).catch(err => console.warn('[Sync] Failed to delete remote session:', err.message));
  }
  return accounts;
});

// ============ PROXY IPC ============
ipcMain.handle('set-proxy', async (_, data) => {
  if (!data || typeof data.accountId !== 'string') return false;
  const { accountId, proxy } = data;
  const accounts = store.get('accounts');
  const idx = accounts.findIndex((a) => a.id === accountId);
  const oldProxy = idx >= 0 ? accounts[idx].proxy : null;
  if (idx >= 0) {
    accounts[idx].proxy = proxy;
    store.set('accounts', accounts);
  }
  const ses = session.fromPartition(`persist:of-${accountId}`);
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
    const http = require('http');
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timed out (15s)')), 15000);
      const proxyOpts = {
        host: proxy.host,
        port: parseInt(proxy.port),
        path: 'http://ip-api.com/json',
        method: 'GET',
        headers: { Host: 'ip-api.com' },
      };
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
      req.on('error', (err) => { clearTimeout(timeout); reject(err); });
      req.end();
    });
    const latency = Date.now() - start;
    return { success: true, ip: result.query || result.ip, country: result.countryCode || result.country, city: result.city, latency };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-proxy', (_, accountId) => {
  const accounts = store.get('accounts');
  const acct = accounts.find((a) => a.id === accountId);
  return acct?.proxy || null;
});

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
  callback();
});

// ============ SESSION SYNC IPC ============
let syncStatus = { connected: false };

ipcMain.handle('sync-status', () => syncStatus);

// Sync Now — manual trigger for smart sync
ipcMain.handle('sync-now', async () => {
  if (!firebaseSync.isInitialized) {
    await initFirebaseSync();
    applyAllProxies();
    if (!firebaseSync.isInitialized) return { success: false, error: 'Failed to connect' };
  }
  await firebaseSync.smartSync();
  const accounts = store.get('accounts') || [];
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-accounts-updated', accounts);
  }
  return { success: true };
});

// Upload a specific account's session (called on account switch)
ipcMain.handle('sync-upload-account', async (_, accountId) => {
  if (!firebaseSync.isInitialized || !accountId) return;
  await firebaseSync.uploadSession(accountId, false);
});

// Factory reset — wipe ALL data (local + Firestore)
ipcMain.handle('sync-factory-reset', async () => {
  const result = await firebaseSync.factoryReset();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-accounts-updated', []);
  }
  return result;
});

async function initFirebaseSync() {
  const apiKey = store.get('apiKey');
  if (!apiKey) return;

  try {
    await firebaseSync.initSync(
      store,
      // Status callback
      (status) => {
        syncStatus = status;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sync-update', status);
        }
      },
      // Accounts updated callback (when auto-sync adds new accounts)
      (accounts) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sync-accounts-updated', accounts);
        }
      }
    );
  } catch (err) {
    console.error('[Sync] Failed to init:', err.message);
  }
}

// ============ APP LIFECYCLE ============
app.whenReady().then(async () => {
  createWindow();
  initAutoUpdater();
  // Init sync FIRST (downloads remote sessions, writes partition files to disk)
  await initFirebaseSync();
  // THEN apply proxies (safe to call session.fromPartition — files already exist)
  applyAllProxies();
});

app.on('before-quit', async (e) => {
  if (quitting) return;
  if (firebaseSync.isInitialized) {
    quitting = true;
    e.preventDefault();
    try {
      await Promise.race([
        firebaseSync.uploadAllSessions(false),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Quit sync timeout')), 5000)),
      ]);
    } catch (err) {
      console.error('[Sync] Quit sync failed:', err.message);
    }
    firebaseSync.stopSync();
    stopAutoUpdater();
    app.exit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
