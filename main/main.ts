// main/main.ts
import { app, BrowserWindow } from 'electron';
import serve from 'electron-serve';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Import our custom menu (must end in .js so ESM finds the compiled file) ─
import './menu.js';

// ─── ESM __dirname shim ─────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ─── 1) Silence ANGLE/EGL GPU-init errors ────────────────────────────────────
app.disableHardwareAcceleration();

// ─── 2) Prep electron-serve for your static export under `out/` ─────────────
const appServe = serve({
  directory: path.join(__dirname, '../../out'),
});

async function createWindow() {
  // runtime path to your icon (packaged → resourcesPath; dev → assets/)
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'icon.png')
    : path.join(__dirname, '../../assets', 'icon.png');

  // on macOS, also set the Dock icon
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(iconPath);
  }

  const win = new BrowserWindow({
    // ─── start truly fullscreen ───────────────────────────────────────────────
    fullscreen: false,
    fullscreenable: true,
    autoHideMenuBar: false,

    // ─── custom window icon (Windows/Linux) ──────────────────────────────────
    icon: iconPath,

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    // ─── 3a) Production: serve the static HTML/CSS/JS from out/ ───────────────
    try {
      await appServe(win);
      win.loadURL('app://-/');
    } catch (err) {
      console.error('Failed to serve app://-/', err);
    }
  } else {
    // ─── 3b) Dev: point at your Next.js dev server ────────────────────────────
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
    win.webContents.on('did-fail-load', () => {
      win.webContents.reloadIgnoringCache();
    });
  }
}

// ─── 4) Standard Electron app lifecycle ─────────────────────────────────────
app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
