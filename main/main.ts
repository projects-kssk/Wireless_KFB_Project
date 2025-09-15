import { app, BrowserWindow, screen, nativeImage } from 'electron'
import path from 'node:path'
import net from 'node:net'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const PORT = parseInt(process.env.PORT || '3003', 10)
const isDev = !app.isPackaged
// Silence Electron dev-time security warnings while we keep dev-friendly settings
if (isDev && !process.env.ELECTRON_DISABLE_SECURITY_WARNINGS) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}
const OPEN_DEVTOOLS = (() => {
  const env = String(process.env.WFKB_DEVTOOLS ?? '').trim()
  if (env) return env === '1' || env.toLowerCase() === 'true'
  return isDev // default: open devtools in dev
})()
// Candidate remote base; when WFKB_FORCE_REMOTE=1 we must use this and not start local
const PROD_BASE_URL = process.env.WFKB_BASE_URL || 'http://172.26.202.248:3000'
const FORCE_REMOTE = (process.env.WFKB_FORCE_REMOTE || '0') === '1'

// Best-effort load of .env for Electron dev (Next loads its own .env)
function loadDotEnvForElectron() {
  if (!isDev) return
  try {
    const p = path.join(process.cwd(), '.env')
    if (!fs.existsSync(p)) return
    const txt = fs.readFileSync(p, 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const s = line.trim()
      if (!s || s.startsWith('#')) continue
      const eq = s.indexOf('=')
      if (eq <= 0) continue
      const k = s.slice(0, eq).trim()
      const v = s.slice(eq + 1).trim()
      if (!(k in process.env)) process.env[k] = v
    }
  } catch {}
}
loadDotEnvForElectron()
const SIMULATE = (() => {
  const v = String(process.env.SIMULATE ?? process.env.NEXT_PUBLIC_SIMULATE ?? '0').trim().toLowerCase()
  const offline = String(process.env.NEXT_PUBLIC_KROSY_ONLINE ?? '').trim().toLowerCase() === 'false'
  return offline || v === '1' || v === 'true' || v === 'yes'
})()
// Optional GPU mitigation: disable hardware acceleration when requested
const DISABLE_GPU = (process.env.WFKB_DISABLE_GPU || '0').trim() === '1'
if (DISABLE_GPU) {
  try { app.disableHardwareAcceleration() } catch {}
  try { app.commandLine.appendSwitch('disable-gpu') } catch {}
}
// Optional GPU tuning for Jetson/ARM (env‑controlled to avoid regressions on other hosts)
const USE_EGL = (process.env.WFKB_USE_EGL || '0').trim() === '1'
const IS_LINUX = process.platform === 'linux'
const IS_ARM64 = process.arch === 'arm64' || (process.env.WFKB_ASSUME_ARM64 || '0').trim() === '1'
if (USE_EGL && IS_LINUX && IS_ARM64) {
  try { app.commandLine.appendSwitch('use-gl', 'egl') } catch {}
}
const IGNORE_GPU_BLOCKLIST = (process.env.WFKB_IGNORE_GPU_BLOCKLIST || '0').trim() === '1'
if (IGNORE_GPU_BLOCKLIST) {
  try { app.commandLine.appendSwitch('ignore-gpu-blocklist') } catch {}
}
const ENABLE_CANVAS_ACCEL = (process.env.WFKB_ENABLE_CANVAS_ACCEL || '0').trim() === '1'
if (ENABLE_CANVAS_ACCEL) {
  try { app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization,Accelerated2dCanvas') } catch {}
  try { app.commandLine.appendSwitch('enable-gpu-rasterization') } catch {}
}
// Additional tuning toggles (safe defaults off)
const ENABLE_ZERO_COPY = (process.env.WFKB_ENABLE_ZERO_COPY || '0').trim() === '1'
if (ENABLE_ZERO_COPY) {
  try { app.commandLine.appendSwitch('enable-zero-copy') } catch {}
  try { app.commandLine.appendSwitch('enable-native-gpu-memory-buffers') } catch {}
}
const NO_PROXY = (process.env.WFKB_NO_PROXY || '0').trim() === '1'
if (NO_PROXY) {
  try { app.commandLine.appendSwitch('no-proxy-server') } catch {}
}
const DISABLE_BG_THROTTLING = (process.env.WFKB_DISABLE_BG_THROTTLING || '0').trim() === '1'
if (DISABLE_BG_THROTTLING) {
  try { app.commandLine.appendSwitch('disable-renderer-backgrounding') } catch {}
  try { app.commandLine.appendSwitch('disable-background-timer-throttling') } catch {}
}
const LOW_END_MODE = (process.env.WFKB_LOW_END_MODE || '0').trim() === '1'
if (LOW_END_MODE) {
  try { app.commandLine.appendSwitch('enable-low-end-device-mode') } catch {}
  const rasterThreads = String(process.env.WFKB_RASTER_THREADS || '').trim()
  if (rasterThreads) {
    try { app.commandLine.appendSwitch('num-raster-threads', rasterThreads) } catch {}
  }
}
const USE_VULKAN = (process.env.WFKB_USE_VULKAN || '0').trim() === '1'
if (USE_VULKAN) {
  try { app.commandLine.appendSwitch('use-vulkan') } catch {}
}
const OZONE_PLATFORM = String(process.env.WFKB_OZONE_PLATFORM || '').trim()
if (OZONE_PLATFORM) {
  try { app.commandLine.appendSwitch('ozone-platform-hint', OZONE_PLATFORM) } catch {}
}
const DISABLE_REMOTE_PROBE = (() => {
  const v = String(process.env.WFKB_DISABLE_REMOTE_PROBE ?? '0').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
})()

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
  // Always create splash immediately so users see instant feedback
  const localBase = `http://127.0.0.1:${PORT}`
  let serverReadyErr: any = null

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

  // In production (not FORCE_REMOTE): start bundled local server while splash is visible
  if (!isDev && !FORCE_REMOTE) {
    try {
      await splashStep('Starting local server…')
      await ensureServerInProd()
    } catch (e) {
      serverReadyErr = e
    }
  }

  // Prepare main windows hidden
  const mainWin = new BrowserWindow({
    width: 1280,
    height: 820,
    x: 0,
    y: 0,
    show: false,
    autoHideMenuBar: true,
    fullscreenable: true,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
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
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
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
    if (!SIMULATE && !DISABLE_REMOTE_PROBE) {
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
    }
    if (!SIMULATE && !DISABLE_REMOTE_PROBE && remoteCandidate) {
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
      if (SIMULATE || DISABLE_REMOTE_PROBE) {
        await splashInfo('Simulation enabled: skipping remote probe and using Next dev server')
      }
      // Try common dev ports in case 3000 is occupied and Next switched to 3001+.
      const host = '127.0.0.1'
      const preferred = parseInt(new URL(devBase).port || '3000', 10)
      const candidates = [preferred, 3001, 3002]
      let found: number | null = null
      await splashInfo('Waiting for Next dev server (3000/3001)…')
      for (const p of candidates) {
        try { await waitForPort(p, host, 4000); found = p; break } catch {}
      }
      if (!found) {
        // Last attempt: keep waiting on the preferred one
        await waitForPort(preferred, host, 25000)
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
    // Default to local; optionally probe remote unless disabled via env
    chosenBase = localBase
    if (!DISABLE_REMOTE_PROBE) {
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
    } else {
      await splashInfo('Remote probe disabled; using local server')
    }
  }

  await splashInfo(`Loading UI from ${chosenBase} …`)
  // Load both windows concurrently to minimize startup time
  await Promise.all([
    mainWin.loadURL(`${chosenBase}/`),
    setupWin.loadURL(`${chosenBase}/setup`),
  ])
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
      // Surface GPU/renderer issues and auto-recover
      wc.on('render-process-gone', (_e, details) => {
        console.warn('[main] Renderer gone:', details?.reason)
        try { win.loadURL(`${chosenBaseRef || 'http://127.0.0.1:'+PORT}/`) } catch {}
      })
      // Use modern child-process-gone instead of deprecated gpu-process-crashed
      app.on('child-process-gone', (_event, details) => {
        try {
          const reason = (details as any)?.reason || 'unknown'
          const type = (details as any)?.type || ''
          if (String(type).toLowerCase().includes('gpu')) {
            console.warn('[main] GPU process gone; restarting windows', { reason, type })
            resetApp('gpu-process-gone')
          }
        } catch {}
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

  // Clamp popup creation (saves processes and prevents stray windows)
  const denyPopups = (win: BrowserWindow) => {
    try {
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', (e, url) => {
        const base = chosenBaseRef || `http://127.0.0.1:${PORT}`
        if (!url.startsWith(base)) {
          try { e.preventDefault() } catch {}
        }
      })
    } catch {}
  }
  denyPopups(mainWin)
  denyPopups(setupWin)

  // Auto fullscreen/kiosk and scale across displays
  try {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    const secondary = displays.find((d) => d.id !== primary.id) || primary;

    // Place windows on displays' work areas
    mainWin.setBounds(primary.workArea);
    setupWin.setBounds(secondary.workArea);

    // Fullscreen policy: default ON in production, OFF in dev unless WFKB_FULLSCREEN=1
    const kiosk = (process.env.WFKB_KIOSK || '0') === '1'
    const forceFullscreen = (() => {
      const env = String(process.env.WFKB_FULLSCREEN || '').trim().toLowerCase()
      if (env === '1' || env === 'true' || env === 'yes') return true
      if (env === '0' || env === 'false' || env === 'no') return false
      return !isDev // default: prod on, dev off
    })()
    try { mainWin.setFullScreen(forceFullscreen) } catch {}
    try { setupWin.setFullScreen(forceFullscreen) } catch {}
    if (forceFullscreen && kiosk) {
      try { mainWin.setKiosk(true); setupWin.setKiosk(true) } catch {}
    }

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
  app.whenReady().then(async () => {
    try {
      // Quick visibility into Chromium GPU pipeline and device
      const status = app.getGPUFeatureStatus?.()
      if (status) console.log('[main] GPU feature status:', status)
      try {
        const info = await app.getGPUInfo('complete')
        console.log('[main] GPU info (summary):', {
          vendor: (info as any)?.gpuDevice?.[0]?.vendor || (info as any)?.auxAttributes?.glVendor,
          device: (info as any)?.gpuDevice?.[0]?.device || (info as any)?.auxAttributes?.glRenderer,
          driverVersion: (info as any)?.gpuDevice?.[0]?.driverVendor || (info as any)?.auxAttributes?.glVersion,
        })
      } catch {}
    } catch {}
    createWindows()
  })
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows() })
