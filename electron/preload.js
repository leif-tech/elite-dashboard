const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenNewTab: (callback) => {
    ipcRenderer.removeAllListeners('open-new-tab');
    ipcRenderer.on('open-new-tab', (_, url) => callback(url));
  },
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  setApiKey: (key) => ipcRenderer.invoke('set-api-key', key),
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  saveAccount: (account) => ipcRenderer.invoke('save-account', account),
  removeAccount: (id) => ipcRenderer.invoke('remove-account', id),
  setProxy: (data) => ipcRenderer.invoke('set-proxy', data),
  testProxy: (data) => ipcRenderer.invoke('test-proxy', data),
  getProxy: (accountId) => ipcRenderer.invoke('get-proxy', accountId),
  minimize: () => ipcRenderer.invoke('win-minimize'),
  maximize: () => ipcRenderer.invoke('win-maximize'),
  close: () => ipcRenderer.invoke('win-close'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Session Sync
  syncStatus: () => ipcRenderer.invoke('sync-status'),
  syncForce: () => ipcRenderer.invoke('sync-force'),
  syncDownload: () => ipcRenderer.invoke('sync-download'),
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
