const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenNewTab: (callback) => {
    ipcRenderer.removeAllListeners('open-new-tab');
    ipcRenderer.on('open-new-tab', (_, url) => callback(url));
  },
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  checkAllLoginStatus: () => ipcRenderer.invoke('check-all-login-status'),
  reorderAccounts: (accounts) => ipcRenderer.invoke('reorder-accounts', accounts),
  saveAccount: (account) => ipcRenderer.invoke('save-account', account),
  removeAccount: (id) => ipcRenderer.invoke('remove-account', id),
  setProxy: (data) => ipcRenderer.invoke('set-proxy', data),
  testProxy: (data) => ipcRenderer.invoke('test-proxy', data),
  getProxy: (accountId) => ipcRenderer.invoke('get-proxy', accountId),
  // Proxy Provider
  getProxyProvider: () => ipcRenderer.invoke('get-proxy-provider'),
  setProxyProvider: (config) => ipcRenderer.invoke('set-proxy-provider', config),
  getProxyProvidersList: () => ipcRenderer.invoke('get-proxy-providers-list'),
  applyProviderProxy: (accountId) => ipcRenderer.invoke('apply-provider-proxy', accountId),
  applyProviderProxyAll: () => ipcRenderer.invoke('apply-provider-proxy-all'),
  rotateProxy: (accountId) => ipcRenderer.invoke('rotate-proxy', accountId),
  // Proxy Health
  getProxyHealth: () => ipcRenderer.invoke('get-proxy-health'),
  checkProxyHealth: (accountId) => ipcRenderer.invoke('check-proxy-health', accountId),
  checkAllProxyHealth: () => ipcRenderer.invoke('check-all-proxy-health'),
  dnsLeakTest: (accountId) => ipcRenderer.invoke('dns-leak-test', accountId),
  onProxyHealthUpdate: (callback) => {
    ipcRenderer.removeAllListeners('proxy-health-update');
    ipcRenderer.on('proxy-health-update', (_, data) => callback(data));
  },
  onProxiesRotated: (callback) => {
    ipcRenderer.removeAllListeners('proxies-rotated');
    ipcRenderer.on('proxies-rotated', (_, accounts) => callback(accounts));
  },
  minimize: () => ipcRenderer.invoke('win-minimize'),
  maximize: () => ipcRenderer.invoke('win-maximize'),
  close: () => ipcRenderer.invoke('win-close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Session Sync
  syncStatus: () => ipcRenderer.invoke('sync-status'),
  syncNow: () => ipcRenderer.invoke('sync-now'),
  syncUploadAccount: (id) => ipcRenderer.invoke('sync-upload-account', id),
  syncFactoryReset: () => ipcRenderer.invoke('sync-factory-reset'),
  onSyncUpdate: (callback) => {
    ipcRenderer.removeAllListeners('sync-update');
    ipcRenderer.on('sync-update', (_, status) => callback(status));
  },
  onSyncAccountsUpdated: (callback) => {
    ipcRenderer.removeAllListeners('sync-accounts-updated');
    ipcRenderer.on('sync-accounts-updated', (_, accounts) => callback(accounts));
  },
  // Avatar extraction
  onAvatarExtracted: (callback) => {
    ipcRenderer.removeAllListeners('avatar-extracted');
    ipcRenderer.on('avatar-extracted', (_, data) => callback(data));
  },
  // Auto-updater
  onUpdateAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.on('update-available', (_, version) => callback(version));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.removeAllListeners('update-progress');
    ipcRenderer.on('update-progress', (_, percent) => callback(percent));
  },
});
