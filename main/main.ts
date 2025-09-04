import { app, BrowserWindow, screen, nativeImage } from 'electron'
import path from 'node:path'
import net from 'node:net'
import { pathToFileURL } from 'node:url'

const PORT = parseInt(process.env.PORT || '3003', 10)
const isDev = !app.isPackaged
const OPEN_DEVTOOLS = (process.env.WFKB_DEVTOOLS || '0') === '1'
// Candidate remote base; when WFKB_FORCE_REMOTE=1 we must use this and not start local
const PROD_BASE_URL = process.env.WFKB_BASE_URL || 'http://172.26.202.248:3000'
const FORCE_REMOTE = (process.env.WFKB_FORCE_REMOTE || '0') === '1'

// Track currently chosen base to allow reloads on errors/second launch
let chosenBaseRef: string = ''

// Keep references to windows so we can focus them on second-instance
let mainWinRef: BrowserWindow | null = null
let setupWinRef: BrowserWindow | null = null

// Zoom/scale policy: disable auto zoom in dev by default; allow override via env
const DISABLE_AUTO_ZOOM = (process.env.WFKB_DISABLE_AUTO_ZOOM ?? (process.env.NODE_ENV !== 'production' ? '1' : '0')) === '1'
const DISABLE_WHEEL_ZOOM = (process.env.WFKB_DISABLE_WHEEL_ZOOM ?? (process.env.NODE_ENV !== 'production' ? '1' : '0')) === '1'

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
  // Allow extra time here since app.prepare() can be slow on some hosts
  await waitForPort(PORT, '127.0.0.1', 45000)
}

function appIconPath() {
  const packaged = path.join(process.resourcesPath, 'app.asar', 'public', 'tinder.png')
  const devIcon = path.join(process.cwd(), 'public', 'tinder.png')
  return isDev ? devIcon : packaged
}

function makeIcon() {
  try { return nativeImage.createFromPath(appIconPath()) } catch { return undefined as any }
}

function isWindowBlank(win: BrowserWindow | null): boolean {
  if (!win) return true
  try {
    const url = win.webContents.getURL() || ''
    const crashed = (win.webContents as any).isCrashed?.() || false
    return crashed || url === '' || url === 'about:blank'
  } catch { return true }
}

function destroyWindows() {
  const wins = [mainWinRef, setupWinRef].filter(Boolean) as BrowserWindow[]
  for (const w of wins) {
    try { w.removeAllListeners() } catch {}
    try { w.destroy() } catch {}
  }
  mainWinRef = null
  setupWinRef = null
}

async function resetApp(reason = 'reset') {
  try { console.warn('[main] Resetting app windows:', reason) } catch {}
  destroyWindows()
  await createWindows()
}

async function createWindows() {
  // In production: start bundled local server. In dev: do not start; use dev server.
  const localBase = `http://127.0.0.1:${PORT}`
  let serverReadyErr: any = null
  if (!isDev && !FORCE_REMOTE) {
    try {
      await ensureServerInProd()
    } catch (e) {
      serverReadyErr = e
    }
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
    alwaysOnTop: true,
    icon: appIconPath(),
    title: 'Wireless KFB - Loading',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  const splashUrl = isDev
    ? `file://${path.join(process.cwd(), 'public', 'splash.html')}`
    : `file://${path.join(process.resourcesPath, 'app.asar', 'public', 'splash.html')}`
  try { await splash.loadURL(splashUrl) } catch {}
  // Helpers to stream progress to splash screen
  const splashExec = (code: string) => splash.webContents.executeJavaScript(code).catch(() => {})
  const splashSetTotal = async (n: number) => splashExec(`window.__splash && __splash.setTotal(${Number(n)||1})`)
  const splashStep = async (msg: string) => splashExec(`window.__splash && __splash.step(${JSON.stringify(msg)})`)
  const splashInfo = async (msg: string) => splashExec(`window.__splash ? __splash.info(${JSON.stringify(msg)}) : (window.__log && __log(${JSON.stringify(msg)}))`)
  const splashError = async (msg: string) => splashExec(`window.__splash && __splash.error(${JSON.stringify(msg)})`)
  const splashDone = async () => splashExec(`window.__splash && __splash.done()`)
  await splashSetTotal(6)
  await splashStep('Initializing…')

  // Prepare main windows hidden
  const mainWin = new BrowserWindow({
    width: 1280,
    height: 820,
    x: 0,
    y: 0,
    show: false,
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    title: 'Dashboard',
    icon: appIconPath(),
  })
  mainWinRef = mainWin
  const setupWin = new BrowserWindow({
    width: 1100,
    height: 820,
    x: 80,
    y: 60,
    show: false,
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
    title: 'Setup',
    icon: appIconPath(),
  })
  setupWinRef = setupWin

  // Decide target base URL
  let chosenBase = localBase
  // Hard-force remote origin if requested
  if (FORCE_REMOTE) {
    try {
      const forced = (process.env.WFKB_BASE_URL || '').trim() || PROD_BASE_URL
      const u = new URL(forced)
      const remotePort = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80)
      await splashInfo(`Forcing remote ${u.hostname}:${remotePort} …`)
      await waitForPort(remotePort, u.hostname, 6000)
      chosenBase = `${u.protocol}//${u.host}`
      await splashStep(`Using remote ${u.hostname}:${remotePort}`)
    } catch (e) {
      await splashError('Error: forced remote base not reachable')
      console.error('[main] Forced remote requested but not reachable:', e)
      return
    }
  } else if (isDev) {
    // Dev mode: prefer remote if set and reachable; else use Next dev server (3000)
    let devBase = 'http://127.0.0.1:3000'
    const forced = (process.env.WFKB_BASE_URL || '').trim()
    let remoteCandidate: URL | null = null
    try {
      if (forced) {
        const u = new URL(forced)
        if (!['localhost', '127.0.0.1'].includes(u.hostname)) remoteCandidate = u
        else devBase = `${u.protocol}//${u.host}`
      }
    } catch {}
    // If no explicit forced remote, probe configured remote base vars as a convenience
    if (!remoteCandidate) {
      const fallbackRemote = (process.env.NEXT_PUBLIC_REMOTE_BASE || PROD_BASE_URL || '').trim()
      try {
        if (fallbackRemote) {
          const u = new URL(fallbackRemote)
          if (!['localhost', '127.0.0.1'].includes(u.hostname)) remoteCandidate = u
        }
      } catch {}
    }
    if (remoteCandidate) {
      const remotePort = remoteCandidate.port ? parseInt(remoteCandidate.port, 10) : (remoteCandidate.protocol === 'https:' ? 443 : 80)
      try {
        await splashInfo(`Checking network server ${remoteCandidate.hostname}:${remotePort}…`)
        await waitForPort(remotePort, remoteCandidate.hostname, 3000)
        chosenBase = `${remoteCandidate.protocol}//${remoteCandidate.host}`
        await splashStep(`Connected to network server ${remoteCandidate.hostname}:${remotePort}`)
      } catch {
        chosenBase = devBase
        await splashStep('Krosy offline: network server not reachable; using Next dev server')
      }
    } else {
      // Try common dev ports in case 3000 is occupied and Next switched to 3001+.
      const host = '127.0.0.1'
      const preferred = parseInt(new URL(devBase).port || '3000', 10)
      const candidates = [preferred, 3001, 3002]
      let found: number | null = null
      await splashInfo('Waiting for Next dev server (3000/3001)…')
      for (const p of candidates) {
        try { await waitForPort(p, host, 2500); found = p; break } catch {}
      }
      if (!found) {
        // Last attempt: keep waiting on the preferred one
        await waitForPort(preferred, host, 15000)
        found = preferred
      }
      chosenBase = `http://${host}:${found}`
      await splashStep(`Using Next dev server on ${host}:${found}`)
    }
  } else {
    // Production: require local server, then optionally switch to remote if reachable
    try {
      const t0 = Date.now()
      await splashStep('Starting local server…')
      // Give more room; some systems need >12s to get ready
      await waitForPort(PORT, '127.0.0.1', 30000)
    } catch (e: any) {
      const reason = (e && e.message) ? String(e.message) : 'unknown error'
      await splashError(`Error: local server failed to start (${reason})`)
      console.error('[main] Local server not available:', serverReadyErr || e)
      return
    }
    // Probe remote
    let remoteCandidate: URL | null = null
    const forced = (process.env.WFKB_BASE_URL || '').trim()
    try {
      const u = new URL(forced || PROD_BASE_URL)
      if (!['localhost', '127.0.0.1'].includes(u.hostname)) remoteCandidate = u
    } catch {}
    if (remoteCandidate) {
      const remotePort = remoteCandidate.port ? parseInt(remoteCandidate.port, 10) : (remoteCandidate.protocol === 'https:' ? 443 : 80)
      try {
        await splashInfo(`Checking network server ${remoteCandidate.hostname}:${remotePort}…`)
        await waitForPort(remotePort, remoteCandidate.hostname, 3000)
        chosenBase = `${remoteCandidate.protocol}//${remoteCandidate.host}`
        await splashStep(`Connected to network server ${remoteCandidate.hostname}:${remotePort}`)
      } catch {
        await splashStep('Krosy offline: network server not reachable; using local')
        console.warn('[main] Remote not reachable, falling back to local:', remoteCandidate?.href)
      }
    }
  }

  await splashInfo(`Loading UI from ${chosenBase} …`)
  await mainWin.loadURL(`${chosenBase}/`)
  await setupWin.loadURL(`${chosenBase}/setup`)
  chosenBaseRef = chosenBase
  await splashStep('Renderer loaded')
  await splashDone()

  // In dev, relax max-width containers and force full-bleed layout so content
  // fills the fullscreen BrowserWindows regardless of Tailwind max-w classes.
  if (isDev) {
    const css = `
      html, body, #__next { width: 100vw; height: 100vh; margin: 0; padding: 0; overflow: hidden; }
      main { width: 100%; height: 100%; }
      .container, [class*="max-w-"] { max-width: 100% !important; }
      /* Ensure root flex layouts can expand */
      body > div:first-child, body > div#__next { width: 100%; height: 100%; }
    `
    try { mainWin.webContents.insertCSS(css) } catch {}
    try { setupWin.webContents.insertCSS(css) } catch {}
  }

  // Enable Ctrl/Cmd + Mouse Wheel zoom on both windows
  const enableZoom = (win: BrowserWindow) => {
    const wc = win.webContents
    // Default to 100% zoom; disable wheel zoom in dev unless explicitly enabled
    try { wc.setZoomFactor(1) } catch {}
    if (!DISABLE_WHEEL_ZOOM) {
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
  }
  enableZoom(mainWin)
  enableZoom(setupWin)
  // (Devtools are optional to avoid stealing focus before splash hides)

  // Auto-recover on renderer problems
  const attachRecovery = (win: BrowserWindow) => {
    try {
      const wc = win.webContents
      wc.on('render-process-gone', (_e, details) => {
        console.warn('[main] Renderer gone:', details?.reason)
        try { win.loadURL(`${chosenBaseRef || 'http://127.0.0.1:'+PORT}/`) } catch {}
      })
      win.on('unresponsive', () => {
        console.warn('[main] Window unresponsive; reloading')
        try { win.webContents.reloadIgnoringCache() } catch {}
      })
      wc.on('did-fail-load', (_ev, errorCode, errorDesc) => {
        console.warn('[main] did-fail-load:', errorCode, errorDesc)
        if (chosenBaseRef) {
          try { win.loadURL(`${chosenBaseRef}/`) } catch {}
        }
      })
    } catch {}
  }
  attachRecovery(mainWin)
  attachRecovery(setupWin)

  // Auto fullscreen/kiosk and scale across displays
  try {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const secondary = displays.find((d) => d.id !== primary.id) || primary;

    // Place windows on displays' work areas
    mainWin.setBounds(primary.workArea);
    setupWin.setBounds(secondary.workArea);

    // Force fullscreen on both; optional kiosk via env
    const kiosk = (process.env.WFKB_KIOSK || '0') === '1'
    mainWin.setFullScreen(true)
    setupWin.setFullScreen(true)
    if (kiosk) { try { mainWin.setKiosk(true); setupWin.setKiosk(true) } catch {} }

    if (!DISABLE_AUTO_ZOOM) {
      // Auto-scale content to fit each display's work area based on design sizes
      const applyAutoZoom = (win: BrowserWindow, baseW: number, baseH: number, area: Electron.Rectangle) => {
        const factor = Math.max(0.35, Math.min(2.0, Math.min(area.width / baseW, area.height / baseH)))
        try { win.webContents.setZoomFactor(factor) } catch {}
      }
      // Design bases: main 1280x820, setup 1100x820
      const applyAfterLoad = (win: BrowserWindow, baseW: number, baseH: number, area: Electron.Rectangle) => {
        const doApply = () => applyAutoZoom(win, baseW, baseH, area)
        doApply()
        win.webContents.once('did-finish-load', () => doApply())
      }
      applyAfterLoad(mainWin, 1280, 820, primary.workArea)
      applyAfterLoad(setupWin, 1100, 820, secondary.workArea)
    }
  } catch {}

  mainWin.show();
  setupWin.show();
  if (isDev && OPEN_DEVTOOLS) {
    try { mainWin.webContents.openDevTools({ mode: 'detach' }) } catch {}
    try { setupWin.webContents.openDevTools({ mode: 'detach' }) } catch {}
  }
  try { splash.destroy() } catch {}
}
// Enforce single instance; focus existing windows if user tries to start again
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  try { app.quit() } catch {}
} else {
  app.on('second-instance', () => {
    // If current windows look blank or crashed, reset the app to show the loader again
    const needReset = isWindowBlank(mainWinRef) && isWindowBlank(setupWinRef)
    if (needReset) {
      resetApp('second-instance: blank windows')
      return
    }
    // Otherwise, focus existing windows
    const wins = [mainWinRef, setupWinRef].filter(Boolean) as BrowserWindow[]
    for (const w of wins) {
      try {
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
      } catch {}
    }
  })
  app.whenReady().then(createWindows)
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows() })
