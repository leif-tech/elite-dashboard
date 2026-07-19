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
});
