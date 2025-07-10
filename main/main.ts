// src/main/main.ts
import { app, BrowserWindow } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import next from 'next'
import http from 'http'
import dotenv from 'dotenv'

// ─── ESM __dirname shim ─────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
dotenv.config({
  path: path.join(__dirname, '../../.env.production')
})
// ─── Silence ANGLE/EGL GPU-init errors ────────────────────────────────────
app.disableHardwareAcceleration()

// ─── Determine environment ─────────────────────────────────────────────────
const isProd = app.isPackaged
const isDev  = !isProd

// ─── Where your Next.js project lives ──────────────────────────────────────
const projectRoot = path.join(__dirname, '../../')

// ─── Prepare Next.js and its request handler ──────────────────────────────
const nextApp = next({ dev: isDev, dir: projectRoot })
const handle  = nextApp.getRequestHandler()

async function startNextServer(): Promise<void> {
  await nextApp.prepare()
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handle(req, res))
    server.on('error', reject)
    server.listen(3001, () => {
      console.log('▶ Next.js listening on http://localhost:3001')
      resolve()
    })
  })
}

async function createWindow() {
  // ─── Icon path (packaged vs. dev) ────────────────────────────────────────
  const iconPath = isProd
    ? path.join(process.resourcesPath, 'assets', 'icon.png')
    : path.join(__dirname, '../../assets/icon.png')

  // ─── macOS dock icon ────────────────────────────────────────────────────
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(iconPath)
  }

  // ─── Create the BrowserWindow ────────────────────────────────────────────
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // ─── Dev: point at your local `next dev` ────────────────────────────────
  if (isDev) {
    win.loadURL('http://localhost:3001')
    win.webContents.openDevTools()

  // ─── Prod: spin up Next.js and then load it ─────────────────────────────
  } else {
    try {
      await startNextServer()
      win.loadURL('http://localhost:3001')
    } catch (err) {
      console.error('❌ Failed to start Next.js server', err)
    }
  }
}

// ─── Standard Electron app lifecycle ───────────────────────────────────────
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
