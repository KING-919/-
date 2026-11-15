'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell } = require('electron');

let mainWindow;
let localServer;
let serverPort;
let startServer;

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) app.quit();

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function startLocalServer() {
  const userData = app.getPath('userData');
  process.env.NOVA_DATA_DIR = path.join(userData, 'data');
  process.env.AGENT_WORKSPACE = path.join(app.getPath('documents'), 'NOVA Workspace');
  // Load the server only after writable Electron paths are configured. Requiring
  // server.js imports config.js immediately, which creates its data directories.
  ({ start: startServer } = require('../server.js'));
  localServer = startServer(0);
  return new Promise((resolve, reject) => {
    localServer.once('listening', () => {
      serverPort = localServer.address().port;
      resolve(serverPort);
    });
    localServer.once('error', reject);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 640,
    title: 'NOVA Agent',
    icon: path.join(__dirname, '..', 'public', 'assets', 'nova.ico'),
    backgroundColor: '#0e0d0b',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}/`)) event.preventDefault();
  });
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  try {
    await startLocalServer();
    createWindow();
  } catch (error) {
    console.error('تعذّر تشغيل خادم NOVA المحلي:', error);
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverPort) createWindow();
});

app.on('before-quit', () => {
  if (localServer && localServer.listening) localServer.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
