const { app, BrowserWindow, ipcMain, session, net, Menu, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store').default;
const firebaseSync = require('./firebase-sync');
const { initAutoUpdater, stopAutoUpdater } = require('./updater');
const { generateFingerprint } = require('./fingerprint-profiles');
const { PROVIDERS, buildProxyForAccount, rotateProxy } = require('./proxy-providers');
const proxyHealth = require('./proxy-health');

// Load fingerprint injection script as string at startup
const INJECT_SCRIPT = fs.readFileSync(path.join(__dirname, 'fingerprint-inject.js'), 'utf8');

// Fallback UA for non-account sessions (OAuth popups before fingerprint lookup, etc.)
const FALLBACK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.182 Safari/537.36';

const FALLBACK_HINTS = {
  'sec-ch-ua': '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
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
  defaults: {
    apiKey: '',
    accounts: [],
    proxyProvider: {
      type: 'manual',
      username: '',
      password: '',
      country: 'us',
      autoAssign: false,
      rotation: { enabled: false, intervalHours: 4 },
    },
  },
});

let mainWindow;
let quitting = false;
let rotationInterval = null;
const activePopups = new Map();
const proxyCredentials = new Map();

// In-memory fingerprint cache — avoids re-reading store on every call
const fingerprintCache = new Map();

// Get fingerprint for a partition name like "persist:of-acct_123"
function getFingerprintForPartition(partition) {
  if (fingerprintCache.has(partition)) return fingerprintCache.get(partition);
  const match = partition.match(/^persist:of-(acct_\d+)$/);
  if (!match) return null;
  const accountId = match[1];
  const accounts = store.get('accounts') || [];
  const acct = accounts.find(a => a.id === accountId);
  const fp = acct?.fingerprint || null;
  if (fp) fingerprintCache.set(partition, fp);
  return fp;
}

// Invalidate cache when accounts change (save, remove, sync)
function invalidateFingerprintCache(accountId) {
  if (accountId) {
    fingerprintCache.delete(`persist:of-${accountId}`);
  } else {
    fingerprintCache.clear(); // clear all on bulk operations
  }
}

function spoofHeaders(ses, fingerprint) {
  const ua = fingerprint ? fingerprint.userAgent : FALLBACK_UA;
  const hints = fingerprint ? fingerprint.clientHints : FALLBACK_HINTS;
  // Build Accept-Language from fingerprint languages (e.g. ['en-US','en'] → 'en-US,en;q=0.9')
  const acceptLang = fingerprint?.languages
    ? fingerprint.languages.map((l, i) => i === 0 ? l : `${l};q=${(1 - i * 0.1).toFixed(1)}`).join(',')
    : 'en-US,en;q=0.9';
  // Build sec-ch-ua-full-version-list from uaData.fullVersionList
  const fullVerList = fingerprint?.uaData?.fullVersionList
    ? fingerprint.uaData.fullVersionList.map(b => `"${b.brand}";v="${b.version}"`).join(', ')
    : null;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = ua;
    details.requestHeaders['Accept-Language'] = acceptLang;
    if (fullVerList) details.requestHeaders['sec-ch-ua-full-version-list'] = fullVerList;
    Object.assign(details.requestHeaders, hints);
    callback({ requestHeaders: details.requestHeaders });
  });
}

function openOAuthPopup(url, partition, wvContents) {
  const fp = getFingerprintForPartition(partition);
  const ua = fp ? fp.userAgent : FALLBACK_UA;

  if (activePopups.has(partition)) {
    const existing = activePopups.get(partition);
    if (!existing.isDestroyed()) {
      existing.focus();
      existing.loadURL(url, { userAgent: ua });
      return;
    }
  }

  const ses = session.fromPartition(partition);
  spoofHeaders(ses, fp);

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
  popup.webContents.setUserAgent(ua);

  // Inject fingerprint via CDP BEFORE loading the URL — ensures script runs before page scripts
  if (fp) {
    try {
      popup.webContents.debugger.attach('1.3');
      popup.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.__FP_CONFIG__=${JSON.stringify(fp)};${INJECT_SCRIPT}`,
      }).then(() => {
        // Detach debugger after injection — prevents anti-bot detection of attached debugger
        try { popup.webContents.debugger.detach(); } catch {}
      }).catch(err => {
        console.warn('[Fingerprint] OAuth CDP inject failed:', err.message);
        try { popup.webContents.debugger.detach(); } catch {}
      });
    } catch (err) {
      console.warn('[Fingerprint] OAuth CDP attach failed:', err.message);
    }
  }

  // Disable WebRTC passkey prompt and credential autofill
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

  popup.loadURL(url, { userAgent: ua });

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
    popup.loadURL(subUrl, { userAgent: ua });
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
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
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
    const prefs = wvContents.getLastWebPreferences();
    const partition = prefs?.partition || 'persist:default';

    // Per-account fingerprint — re-read on each attach (not stale closure)
    const fp = getFingerprintForPartition(partition);
    wvContents.setUserAgent(fp ? fp.userAgent : FALLBACK_UA);

    const wvSession = session.fromPartition(partition);
    spoofHeaders(wvSession, fp);

    // Inject fingerprint via Chrome DevTools Protocol — runs BEFORE any page scripts.
    // executeJavaScript runs after page scripts (too late). CDP addScriptToEvaluateOnNewDocument
    // is the industry standard (same as Puppeteer's evaluateOnNewDocument).
    if (fp) {
      const fpScript = `window.__FP_CONFIG__=${JSON.stringify(fp)};${INJECT_SCRIPT}`;
      try {
        wvContents.debugger.attach('1.3');
        wvContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: fpScript,
        }).then(() => {
          // Detach debugger after injection — prevents anti-bot detection
          try { wvContents.debugger.detach(); } catch {}
        }).catch(err => {
          console.warn('[Fingerprint] CDP inject failed:', err.message);
          try { wvContents.debugger.detach(); } catch {}
        });
      } catch (err) {
        // Debugger already attached or unavailable — fall back to executeJavaScript
        console.warn('[Fingerprint] CDP attach failed, using fallback:', err.message);
        wvContents.on('did-start-navigation', (event, navUrl, isInPlace, isMainFrame) => {
          if (!isMainFrame) return;
          const freshFp = getFingerprintForPartition(partition);
          if (freshFp) {
            wvContents.executeJavaScript(
              `window.__FP_CONFIG__=${JSON.stringify(freshFp)};${INJECT_SCRIPT}`
            ).catch(() => {});
          }
        });
      }
    }

    // Restrict permissions — only allow clipboard and media (for OF content)
    const WV_ALLOWED = ['clipboard-sanitized-write', 'media', 'notifications'];
    wvSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(WV_ALLOWED.includes(permission));
    });
    // Block WebRTC IP leak — forces WebRTC to use proxy, prevents STUN from leaking real IP
    wvContents.setWebRTCIPHandlingPolicy?.('disable_non_proxied_udp');

    // Close orphaned OAuth popups when webview is destroyed (e.g., account switch)
    wvContents.on('destroyed', () => {
      const popup = activePopups.get(partition);
      if (popup && !popup.isDestroyed()) popup.close();
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

    // Extract user avatar from OnlyFans pages (with delay for SPA rendering)
    wvContents.on('did-finish-load', () => {
      try {
        const pageUrl = wvContents.getURL();
        if (!isOnlyFansHost(pageUrl)) return;
        // Get account ID from session storage path (partition attr isn't in webPreferences)
        const storagePath = wvContents.session.storagePath || '';
        const partMatch = storagePath.match(/[/\\]of-(acct_\d+)/);
        if (!partMatch) return;
        const acctId = partMatch[1];
        // Delay to let the OnlyFans SPA fully render
        setTimeout(() => {
          if (wvContents.isDestroyed()) return;
          wvContents.executeJavaScript(`
            (() => {
              try {
                const results = [];
                // Method 1: <img> tags
                const imgs = document.querySelectorAll('img');
                for (const img of imgs) {
                  if (img.src && img.src.startsWith('http')) {
                    const rect = img.getBoundingClientRect();
                    results.push({ src: img.src, w: Math.round(rect.width), h: Math.round(rect.height), t: Math.round(rect.top), l: Math.round(rect.left) });
                  }
                }
                // Method 2: computed background-image on potential avatar elements
                const candidates = document.querySelectorAll('[class*="avatar"], [class*="Avatar"], [class*="user"] img, [class*="profile"] img, .g-avatar, .b-profile__user');
                for (const el of candidates) {
                  const bg = getComputedStyle(el).backgroundImage;
                  if (bg && bg !== 'none') {
                    const m = bg.match(/url\\(["']?(https?:\\/\\/[^"')]+)["']?\\)/);
                    if (m) {
                      const rect = el.getBoundingClientRect();
                      results.push({ src: m[1], w: Math.round(rect.width), h: Math.round(rect.height), t: Math.round(rect.top), l: Math.round(rect.left), bg: true });
                    }
                  }
                }
                // Method 3: inline style background-images
                const bgEls = document.querySelectorAll('[style*="background-image"]');
                for (const el of bgEls) {
                  const m = el.style.backgroundImage.match(/url\\(["']?(https?:\\/\\/[^"')]+)["']?\\)/);
                  if (m) {
                    const rect = el.getBoundingClientRect();
                    results.push({ src: m[1], w: Math.round(rect.width), h: Math.round(rect.height), t: Math.round(rect.top), l: Math.round(rect.left), bg: true });
                  }
                }
                return JSON.stringify(results);
              } catch(e) { return JSON.stringify([]); }
            })()
          `).then(raw => {
            try {
              const images = JSON.parse(raw);
              // Pick avatar: small image, prefer background-images and those with 'avatar' in URL
              const avatar = images.find(img =>
                img.bg && img.w >= 20 && img.w <= 150 && img.h >= 20 && img.h <= 150 &&
                (img.src.includes('avatar') || img.src.includes('thumbs'))
              ) || images.find(img =>
                img.w >= 20 && img.w <= 80 && img.h >= 20 && img.h <= 80 &&
                img.src.includes('avatar')
              ) || images.find(img =>
                img.w >= 20 && img.w <= 80 && img.h >= 20 && img.h <= 80 &&
                img.src.includes('thumbs') &&
                !img.src.includes('.svg') && !img.src.includes('emoji')
              );
              if (avatar && mainWindow && !mainWindow.isDestroyed()) {
                const accounts = store.get('accounts') || [];
                const idx = accounts.findIndex(a => a.id === acctId);
                if (idx >= 0 && accounts[idx].avatar !== avatar.src) {
                  accounts[idx].avatar = avatar.src;
                  store.set('accounts', accounts);
                }
                mainWindow.webContents.send('avatar-extracted', { accountId: acctId, avatarUrl: avatar.src });
              }
            } catch {}
          }).catch(() => {});
        }, 3000);
      } catch {}
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
async function applyAllProxies() {
  const savedAccounts = store.get('accounts') || [];
  const promises = [];
  for (const acct of savedAccounts) {
    if (acct.proxy && acct.proxy.enabled && acct.proxy.host && acct.proxy.port) {
      const ses = session.fromPartition(`persist:of-${acct.id}`);
      promises.push(ses.setProxy({ proxyRules: buildProxyRules(acct.proxy) }));
      registerProxyAuth(acct.proxy);
    }
  }
  if (promises.length > 0) await Promise.all(promises);
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
  const oldKey = store.get('apiKey');
  // If key is changing and sync was active, stop old sync first
  if (oldKey && oldKey !== key && firebaseSync.isInitialized) {
    firebaseSync.stopSync();
  }
  store.set('apiKey', key);
  if (key) {
    await initFirebaseSync();
    await applyAllProxies();
  }
  return true;
});

ipcMain.handle('get-accounts', () => store.get('accounts') || []);

// Check which accounts are actually logged in on OnlyFans
// Trust the 'sess' cookie — if it exists, show the account as logged in.
// HTTP validation was unreliable on new devices (Cloudflare, fingerprinting).
// If the session truly expired, the user sees the login page in the webview.
ipcMain.handle('check-all-login-status', async () => {
  const accounts = store.get('accounts') || [];
  const status = {};
  const checks = accounts.map(async (acct) => {
    try {
      const ses = session.fromPartition(`persist:of-${acct.id}`);
      const ofCookies = await Promise.race([
        ses.cookies.get({ domain: 'onlyfans.com' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 5000)),
      ]);
      const hasSess = ofCookies.some(c => c.name === 'sess' && c.value && c.value.length > 10);
      status[acct.id] = hasSess;
    } catch {
      status[acct.id] = false;
    }
  });
  await Promise.all(checks);
  // After checking login status, upload any logged-in accounts in background.
  // Hash dedup skips unchanged sessions, so this is cheap for already-synced accounts
  // but ensures newly-logged-in accounts are immediately pushed to Firebase.
  if (firebaseSync.isInitialized) {
    const loggedIn = Object.entries(status).filter(([, v]) => v).map(([id]) => id);
    if (loggedIn.length > 0) {
      Promise.all(loggedIn.map(id => firebaseSync.uploadSession(id, false))).catch(() => {});
    }
  }
  return status;
});

// Save reordered accounts array — only accept an array of IDs, not full objects
ipcMain.handle('reorder-accounts', (_, orderedIds) => {
  if (!Array.isArray(orderedIds)) return store.get('accounts') || [];
  const existing = store.get('accounts') || [];
  const byId = new Map(existing.map((a) => [a.id, a]));
  // Reorder using existing account objects (prevents data injection)
  const reordered = orderedIds.filter((id) => typeof id === 'string' && byId.has(id)).map((id) => byId.get(id));
  // Append any accounts not in the ordered list (e.g., added by sync during drag)
  for (const a of existing) {
    if (!orderedIds.includes(a.id)) reordered.push(a);
  }
  store.set('accounts', reordered);
  return reordered;
});

ipcMain.handle('save-account', async (_, account) => {
  if (!account || typeof account.id !== 'string') return store.get('accounts') || [];
  const accounts = store.get('accounts');
  const idx = accounts.findIndex((a) => a.id === account.id);
  const isExisting = idx >= 0;
  // Auto-generate fingerprint for new accounts
  if (!isExisting && !account.fingerprint) {
    account.fingerprint = generateFingerprint(account.id);
  }
  // Auto-assign proxy for new accounts when provider is configured
  if (!isExisting && !account.proxy) {
    const providerConfig = store.get('proxyProvider');
    if (providerConfig && providerConfig.type !== 'manual' && providerConfig.autoAssign) {
      const proxy = buildProxyForAccount(providerConfig, account.id);
      if (proxy) {
        account.proxy = proxy;
        // Apply proxy to session
        const ses = session.fromPartition(`persist:of-${account.id}`);
        await ses.setProxy({ proxyRules: buildProxyRules(proxy) });
        registerProxyAuth(proxy);
      }
    }
  }
  if (isExisting) accounts[idx] = { ...accounts[idx], ...account };
  else accounts.push(account);
  store.set('accounts', accounts);
  invalidateFingerprintCache(account.id);
  // Only upload existing accounts — new accounts have no session data yet
  // and uploading would mark them as initialized, preventing partition downloads
  if (isExisting && firebaseSync.isInitialized) {
    firebaseSync.uploadSession(account.id).catch(() => {});
  }
  return accounts;
});

ipcMain.handle('remove-account', async (_, id) => {
  // Mark as deleted IMMEDIATELY — before any async work — so smartSync can't re-add
  firebaseSync.markAsDeleted(id);
  invalidateFingerprintCache(id);
  const allAccounts = store.get('accounts');
  const removed = allAccounts.find((a) => a.id === id);
  const accounts = allAccounts.filter((a) => a.id !== id);
  store.set('accounts', accounts);
  if (removed?.proxy) unregisterProxyAuth(removed.proxy);

  // Delete from Firestore FIRST — this is critical, must happen before anything that can fail
  if (firebaseSync.isInitialized) {
    try {
      await firebaseSync.deleteRemoteSession(id);
    } catch (err) {
      console.warn('[Sync] Failed to delete remote session:', err.message);
    }
  }

  // Clear session data — may partially fail on Windows due to file locks, that's OK
  try {
    await session.fromPartition(`persist:of-${id}`).clearStorageData();
  } catch (err) {
    console.warn('[Main] clearStorageData failed (non-fatal):', err.message);
  }

  // Try to clean up partition files — EBUSY is expected on Windows (session holds file locks)
  try {
    const fs = require('fs');
    const partDir = path.join(app.getPath('userData'), 'Partitions', `of-${id}`);
    if (fs.existsSync(partDir)) {
      fs.rmSync(partDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('[Main] Partition cleanup failed (non-fatal):', err.message);
  }

  return accounts;
});

// ============ PROXY IPC ============
ipcMain.handle('set-proxy', async (_, data) => {
  if (!data || typeof data.accountId !== 'string') return false;
  const { accountId, proxy } = data;
  if (proxy && (typeof proxy.host !== 'string' || typeof proxy.port !== 'string')) return false;
  const accounts = store.get('accounts');
  const idx = accounts.findIndex((a) => a.id === accountId);
  if (idx < 0) return false;
  const oldProxy = accounts[idx].proxy;
  accounts[idx].proxy = proxy;
  store.set('accounts', accounts);
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
  const http = require('http');
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out (15s)')), 15000);
      const options = {
        host: proxy.host,
        port: parseInt(proxy.port),
        path: 'http://ip-api.com/json',
        method: 'GET',
        headers: { Host: 'ip-api.com', 'User-Agent': FALLBACK_UA },
      };
      if (proxy.username) {
        options.headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
      }
      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          clearTimeout(timer);
          if (res.statusCode === 407) { reject(new Error('Proxy rejected credentials (407)')); return; }
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error(`Unexpected response (HTTP ${res.statusCode})`)); }
        });
      });
      req.on('error', (err) => { clearTimeout(timer); reject(err); });
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

// ============ PROXY PROVIDER IPC ============
ipcMain.handle('get-proxy-provider', () => store.get('proxyProvider'));

ipcMain.handle('set-proxy-provider', (_, config) => {
  store.set('proxyProvider', config);
  return config;
});

ipcMain.handle('get-proxy-providers-list', () => {
  const list = [{ key: 'manual', name: 'Manual' }];
  for (const [key, p] of Object.entries(PROVIDERS)) {
    list.push({ key, name: p.name });
  }
  return list;
});

ipcMain.handle('apply-provider-proxy', async (_, accountId) => {
  const providerConfig = store.get('proxyProvider');
  if (!providerConfig || providerConfig.type === 'manual') return false;
  const proxy = buildProxyForAccount(providerConfig, accountId);
  if (!proxy) return false;

  const accounts = store.get('accounts');
  const idx = accounts.findIndex(a => a.id === accountId);
  if (idx < 0) return false;

  const oldProxy = accounts[idx].proxy;
  if (oldProxy) unregisterProxyAuth(oldProxy);
  accounts[idx].proxy = proxy;
  store.set('accounts', accounts);

  const ses = session.fromPartition(`persist:of-${accountId}`);
  await ses.setProxy({ proxyRules: buildProxyRules(proxy) });
  registerProxyAuth(proxy);
  return proxy;
});

let applyingAll = false;
ipcMain.handle('apply-provider-proxy-all', async () => {
  if (applyingAll) return false; // prevent concurrent overwrites (IPC-7)
  applyingAll = true;
  try {
    const providerConfig = store.get('proxyProvider');
    if (!providerConfig || providerConfig.type === 'manual') return false;
    const accounts = store.get('accounts');

    for (const acct of accounts) {
      const proxy = buildProxyForAccount(providerConfig, acct.id);
      if (!proxy) continue;
      const oldProxy = acct.proxy;
      if (oldProxy) unregisterProxyAuth(oldProxy);
      acct.proxy = proxy;
      const ses = session.fromPartition(`persist:of-${acct.id}`);
      await ses.setProxy({ proxyRules: buildProxyRules(proxy) });
      registerProxyAuth(proxy);
    }

    store.set('accounts', accounts);
    return accounts;
  } finally {
    applyingAll = false;
  }
});

ipcMain.handle('rotate-proxy', async (_, accountId) => {
  const providerConfig = store.get('proxyProvider');
  if (!providerConfig || providerConfig.type === 'manual') return { success: false, error: 'No provider configured' };

  const accounts = store.get('accounts');
  const idx = accounts.findIndex(a => a.id === accountId);
  if (idx < 0) return { success: false, error: 'Account not found' };

  const oldProxy = accounts[idx].proxy;
  if (oldProxy) unregisterProxyAuth(oldProxy);

  const proxy = rotateProxy(providerConfig, accountId);
  if (!proxy) return { success: false, error: 'Failed to generate proxy' };

  accounts[idx].proxy = proxy;
  store.set('accounts', accounts);

  const ses = session.fromPartition(`persist:of-${accountId}`);
  await ses.setProxy({ proxyRules: buildProxyRules(proxy) });
  registerProxyAuth(proxy);

  // Quick health check on the new proxy
  const health = await proxyHealth.checkSingleProxy(accountId, proxy);
  return { success: true, proxy, health };
});

// ============ PROXY HEALTH IPC ============
ipcMain.handle('get-proxy-health', () => proxyHealth.getHealthData());

ipcMain.handle('check-proxy-health', async (_, accountId) => {
  const accounts = store.get('accounts');
  const acct = accounts.find(a => a.id === accountId);
  if (!acct?.proxy) return null;
  return await proxyHealth.checkSingleProxy(accountId, acct.proxy);
});

ipcMain.handle('check-all-proxy-health', async () => {
  await proxyHealth.checkAllProxies();
  return proxyHealth.getHealthData();
});

ipcMain.handle('dns-leak-test', async (_, accountId) => {
  const accounts = store.get('accounts');
  const acct = accounts.find(a => a.id === accountId);
  if (!acct?.proxy) return { success: false, error: 'No proxy configured' };
  return await proxyHealth.runDnsLeakTest(acct.proxy);
});

// ============ PROXY ROTATION SCHEDULER ============
function startRotationScheduler() {
  // Check every 10 minutes if any accounts need IP rotation
  rotationInterval = setInterval(async () => {
    const providerConfig = store.get('proxyProvider');
    if (!providerConfig || providerConfig.type === 'manual') return;
    if (!providerConfig.rotation?.enabled || !providerConfig.rotation?.intervalHours) return;

    const intervalMs = providerConfig.rotation.intervalHours * 60 * 60 * 1000;
    const accounts = store.get('accounts');
    const now = Date.now();
    let rotated = false;

    for (const acct of accounts) {
      if (!acct.proxy?.enabled || !acct.proxy?.providerType) continue;
      const lastRotated = acct.proxy.lastRotated || 0;
      if (now - lastRotated < intervalMs) continue;

      const oldProxy = acct.proxy;
      if (oldProxy) unregisterProxyAuth(oldProxy);

      const proxy = rotateProxy(providerConfig, acct.id);
      if (!proxy) continue;

      acct.proxy = proxy;
      const ses = session.fromPartition(`persist:of-${acct.id}`);
      await ses.setProxy({ proxyRules: buildProxyRules(proxy) });
      registerProxyAuth(proxy);
      rotated = true;
    }

    if (rotated) {
      store.set('accounts', accounts);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('proxies-rotated', accounts);
      }
    }
  }, 10 * 60 * 1000);
}

function stopRotationScheduler() {
  if (rotationInterval) {
    clearInterval(rotationInterval);
    rotationInterval = null;
  }
}

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

// Sync Now — manual full sync (clears deletion block list, pulls everything)
ipcMain.handle('sync-now', async () => {
  if (!firebaseSync.isInitialized) {
    await initFirebaseSync();
    await applyAllProxies();
    if (!firebaseSync.isInitialized) return { success: false, error: 'Failed to connect' };
  }
  await firebaseSync.fullSync();
  await applyAllProxies();
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
  // Stop auto-sync FIRST to prevent race condition (IPC-9)
  firebaseSync.stopSync();
  const result = await firebaseSync.factoryReset();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-accounts-updated', []);
  }
  // Re-init sync after reset
  await initFirebaseSync();
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
      async (accounts) => {
        invalidateFingerprintCache(); // clear all — sync may have changed fingerprints
        await applyAllProxies();
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
  // Migrate existing accounts: generate fingerprints for any that don't have one,
  // or regenerate if fingerprint version is outdated (e.g. v2 → v3 Chrome update)
  const existingAccounts = store.get('accounts') || [];
  let migrated = 0;
  for (const acct of existingAccounts) {
    if (!acct.fingerprint || acct.fingerprint.version < 3) {
      acct.fingerprint = generateFingerprint(acct.id);
      migrated++;
    }
  }
  if (migrated > 0) {
    store.set('accounts', existingAccounts);
    console.log(`[Fingerprint] Migrated ${migrated} accounts to v3 fingerprints`);
  }

  createWindow();
  initAutoUpdater();
  // Init sync FIRST (downloads remote sessions, writes partition files to disk)
  await initFirebaseSync();
  // THEN apply proxies (safe to call session.fromPartition — files already exist)
  await applyAllProxies();
  // Start health monitoring and rotation scheduler
  proxyHealth.startHealthMonitoring(store, mainWindow);
  startRotationScheduler();
});

app.on('before-quit', async (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();

  // Stop auto-sync FIRST — prevents concurrent smartSync from downloading
  // stale cookies that overwrite valid ones during quit
  firebaseSync.stopSync();
  stopAutoUpdater();
  proxyHealth.stopHealthMonitoring();
  stopRotationScheduler();

  // Explicitly flush ALL partition cookie stores to disk.
  // app.quit() only flushes sessions attached to live webContents —
  // partition sessions created via session.fromPartition() may not be flushed.
  const accounts = store.get('accounts') || [];
  try {
    await Promise.all(accounts.map(async (acct) => {
      try {
        const ses = session.fromPartition(`persist:of-${acct.id}`);
        await ses.cookies.flushStore();
      } catch {}
    }));
  } catch {}

  // Upload to Firebase (cookies already safe on disk)
  if (firebaseSync.isInitialized) {
    try {
      await Promise.race([
        firebaseSync.uploadAllSessions(false),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Quit sync timeout')), 10000)),
      ]);
    } catch (err) {
      console.error('[Sync] Quit sync failed:', err.message);
    }
  }

  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
