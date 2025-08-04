import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import net from 'node:net'
import { pathToFileURL } from 'node:url'

const PORT = parseInt(process.env.PORT || '3001', 10)
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

async function createWindow() {
  await ensureServerInProd()

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })

  await waitForPort(PORT)
  await win.loadURL(`http://127.0.0.1:${PORT}`)

  if (isDev) win.webContents.openDevTools({ mode: 'detach' })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
