import { app, BrowserWindow, screen, nativeImage } from 'electron'
import path from 'node:path'
import net from 'node:net'
import { pathToFileURL } from 'node:url'

const PORT = parseInt(process.env.PORT || '3003', 10)
const isDev = !app.isPackaged

function waitForPort(port: number, host = '127.0.0.1', timeoutMs = 15000) {
  const start = Date.now()
  return new Promise<void>((resolve, reject) => {
    const tryConnect = () => {
      const s = net.connect({ port, host })
      s.once('connect', () => { s.end(); resolve() })
      s.once('error', () => {
        s.destroy()
        if (Date.now() - start > timeoutMs) reject(new Error(`Timed out waiting for ${host}:${port}`))
        else setTimeout(tryConnect, 250)
      })
    }
    tryConnect()
  })
}

async function ensureServerInProd() {
  if (isDev) return
  // dist-server is shipped outside ASAR via extraResources
  const serverEntry = path.join(process.resourcesPath, 'dist-server', 'server.js')
  console.log('[main] loading server:', serverEntry)
  await import(pathToFileURL(serverEntry).href)  // starts Next server
  await waitForPort(PORT)
}

function appIconPath() {
  const packaged = path.join(process.resourcesPath, 'app.asar', 'public', 'tinder.png')
  const devIcon = path.join(process.cwd(), 'public', 'tinder.png')
  return isDev ? devIcon : packaged
}

function makeIcon() {
  try { return nativeImage.createFromPath(appIconPath()) } catch { return undefined as any }
}

async function createWindows() {
  // Splash immediately
  const splash = new BrowserWindow({
    width: 560,
    height: 360,
    resizable: false,
    movable: true,
    frame: false,
    show: true,
    transparent: false,
    icon: appIconPath(),
    title: 'Wireless KFB - Loading',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  const splashUrl = isDev
    ? `file://${path.join(process.cwd(), 'public', 'splash.html')}`
    : `file://${path.join(process.resourcesPath, 'app.asar', 'public', 'splash.html')}`
  try { await splash.loadURL(splashUrl) } catch {}

  // Start server in background (prod)
  const startServer = (async () => { try { await ensureServerInProd() } catch (e) { console.error('[main] ensureServerInProd error', e) } })()

  // Prepare main windows hidden
  const mainWin = new BrowserWindow({
    width: 1280,
    height: 820,
    x: 0,
    y: 0,
    show: false,
    fullscreenable: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    title: 'Dashboard',
    icon: appIconPath(),
  })
  const setupWin = new BrowserWindow({
    width: 1100,
    height: 820,
    x: 80,
    y: 60,
    show: false,
    fullscreenable: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    title: 'Setup',
    icon: appIconPath(),
  })

  // Wait for server then load targets
  await waitForPort(PORT)
  await Promise.resolve(startServer).catch(() => {})
  await mainWin.loadURL(`http://127.0.0.1:${PORT}/`)
  await setupWin.loadURL(`http://127.0.0.1:${PORT}/setup`)
  if (isDev) {
    mainWin.webContents.openDevTools({ mode: 'detach' })
    setupWin.webContents.openDevTools({ mode: 'detach' })
  }

  // Auto fullscreen/maximize across displays
  try {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const secondary = displays.find((d) => d.id !== primary.id) || primary;

    // Place windows on displays' work areas
    mainWin.setBounds(primary.workArea);
    setupWin.setBounds(secondary.workArea);

    if (displays.length >= 2) {
      mainWin.setFullScreen(true);
      setupWin.setFullScreen(true);
    } else {
      mainWin.maximize();
      setupWin.maximize();
    }
  } catch {}

  mainWin.show();
  setupWin.show();
  try { splash.destroy() } catch {}
}

app.whenReady().then(createWindows)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows() })
