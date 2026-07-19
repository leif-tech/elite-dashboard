const { autoUpdater } = require('electron-updater');
const { app, dialog, BrowserWindow } = require('electron');

function initAutoUpdater() {
  if (!app.isPackaged) {
    console.log('[Updater] Skipping update check in dev mode');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('update-available', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] App is up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('update-progress', Math.round(progress.percent));
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info.version);
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err.message);
  });

  // Check after 3s delay on launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);

  // Check every 30 minutes
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 30 * 60 * 1000);
}

module.exports = { initAutoUpdater };
