import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import net from 'node:net'
import { pathToFileURL } from 'node:url'

const PORT = parseInt(process.env.PORT || '3001', 10)
const isDev = !app.isPackaged

function waitForPort(port: number, host = '127.0.0.1', timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const sock = net.connect({ port, host })
      sock.on('connect', () => {
        sock.end()
        resolve()
      })
      sock.on('error', () => {
        sock.destroy()
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${host}:${port}`))
        } else {
          setTimeout(tryConnect, 250)
        }
      })
    }
    tryConnect()
  })
}

async function ensureServerInProd() {
  if (isDev) return
  // dist-server/server.js is packaged into app.asar (see step 4)
  const appRoot = path.join(process.resourcesPath, 'app.asar')
  const serverEntry = path.join(appRoot, 'dist-server', 'server.js')
  // importing starts the server (your server.ts runs on import)
  await import(pathToFileURL(serverEntry).href)
  await waitForPort(PORT)
}

async function createWindow() {
  await ensureServerInProd()

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
      // preload: path.join(__dirname, 'preload.js'), // optional
    }
  })

  if (isDev) {
    await waitForPort(PORT)
    await win.loadURL(`http://127.0.0.1:${PORT}`)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadURL(`http://127.0.0.1:${PORT}`)
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
