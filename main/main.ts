import { app, BrowserWindow, screen, nativeImage } from 'electron'
import path from 'node:path'
import net from 'node:net'
import { pathToFileURL } from 'node:url'

const PORT = parseInt(process.env.PORT || '3003', 10)
const isDev = !app.isPackaged
// Candidate remote base (non-local) used when reachable; always start local server regardless
const PROD_BASE_URL = process.env.WFKB_BASE_URL || 'http://172.26.202.248:3000'

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
  // Always start local server in production; in dev it's already separate
  const localBase = `http://127.0.0.1:${PORT}`
  let serverReadyErr: any = null
  try {
    await ensureServerInProd()
  } catch (e) {
    serverReadyErr = e
  }

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

  // Decide target: prefer reachable remote; otherwise fallback to local
  let chosenBase = localBase
  // If local server didn't start, show fatal error and stop
  try {
    await waitForPort(PORT, '127.0.0.1', 12000)
  } catch (e) {
    try {
      await splash.webContents.executeJavaScript(`(function(){
        var sub = document.querySelector('.sub');
        if (sub) sub.textContent = 'Error: local server failed to start';
        var sp = document.querySelector('.spinner');
        if (sp) sp.style.display = 'none';
      })();`)
    } catch {}
    console.error('[main] Local server not available:', serverReadyErr || e)
    return
  }

  // Probe remote candidate (non-local URL)
  let remoteCandidate: URL | null = null
  const forced = (process.env.WFKB_BASE_URL || '').trim()
  try {
    const u = new URL(forced || PROD_BASE_URL)
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) remoteCandidate = u
  } catch {}

  if (remoteCandidate) {
    const remotePort = remoteCandidate.port ? parseInt(remoteCandidate.port, 10) : (remoteCandidate.protocol === 'https:' ? 443 : 80)
    try {
      await waitForPort(remotePort, remoteCandidate.hostname, 3000)
      chosenBase = `${remoteCandidate.protocol}//${remoteCandidate.host}`
      try {
        await splash.webContents.executeJavaScript(`(function(){ var sub = document.querySelector('.sub'); if (sub) sub.textContent = 'Connected to network server: ${remoteCandidate.hostname}:${remotePort}'; })();`)
      } catch {}
    } catch (e) {
      // Stay on local and inform user briefly
      try {
        await splash.webContents.executeJavaScript(`(function(){ var sub = document.querySelector('.sub'); if (sub) sub.textContent = 'Network server not reachable, using local'; })();`)
      } catch {}
      console.warn('[main] Remote not reachable, falling back to local:', remoteCandidate?.href)
    }
  }

  await mainWin.loadURL(`${chosenBase}/`)
  await setupWin.loadURL(`${chosenBase}/setup`)

  // Enable Ctrl/Cmd + Mouse Wheel zoom on both windows
  const enableZoom = (win: BrowserWindow) => {
    const wc = win.webContents
    try { wc.setVisualZoomLevelLimits(0.5, 3) } catch {}
    let zoomFactor = 1
    const clamp = (v: number) => Math.min(3, Math.max(0.5, v))
    wc.on('before-input-event', (event, input) => {
      const isMouseWheel = (input as any).type === 'mouseWheel'
      const ctrlOrMeta = (input as any).control || (input as any).meta
      if (isMouseWheel && ctrlOrMeta) {
        try { event.preventDefault() } catch {}
        const dy = (input as any).deltaY ?? 0
        const step = 0.08
        zoomFactor = clamp(zoomFactor * (dy > 0 ? (1 - step) : (1 + step)))
        try { wc.setZoomFactor(zoomFactor) } catch {}
      }
    })
  }
  enableZoom(mainWin)
  enableZoom(setupWin)
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
