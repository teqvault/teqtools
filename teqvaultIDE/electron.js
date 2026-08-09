// MOVED to electron.cjs — package.json has "type": "module", so a plain
// .js file here gets loaded as an ES module by Electron, and `require()`
// below doesn't exist in that scope (ReferenceError: require is not
// defined). Renaming to .cjs forces CommonJS regardless of the package's
// module type; this file is dead and unused, kept only so a stale
// reference to "public/electron.js" fails loudly instead of silently
// running old code. See public/electron.cjs for the real, current file.
throw new Error('public/electron.js is deprecated — use public/electron.cjs instead')
/* eslint-disable */
const { app, BrowserWindow, Menu, ipcMain, dialog, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')
const url = require('url')
const isDev = require('electron-is-dev')

let mainWindow

// The production build's dist/index.html loads its JS as
// <script type="module">, and Chromium (Electron's renderer is the same
// engine) refuses to load module scripts at all over a raw file:// origin
// — a browser security restriction, not something loadURL() options can
// override. Serving the built files through this custom "app://" scheme
// instead gives them a proper origin (registered as standard/secure below,
// same as https as far as module loading, fetch, and service worker
// registration are concerned), which is the standard fix Electron+Vite
// apps use for this. Must be called before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
])

// Serves everything under dist/ through app://-/<path>. The "-" host is a
// placeholder (custom schemes need *some* host to resolve relative URLs
// against consistently) — index.html's own relative asset paths
// ("./assets/...") resolve against it correctly the same way they would
// against any real URL.
function registerAppProtocol() {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url)
    const relPath = decodeURIComponent(pathname === '/' || pathname === '' ? '/index.html' : pathname)
    const filePath = path.join(__dirname, '../dist', relPath)
    return net.fetch(url.pathToFileURL(filePath).toString())
  })
}

// The .teq file path the app was launched/double-clicked with, if any (see
// package.json's build.fileAssociations). Windows/Linux pass it as a plain
// CLI argument; macOS instead fires its own 'open-file' event (registered
// below, before 'ready', since macOS can send it before the app is even
// finished starting up). Queued here and flushed once the window has
// actually finished loading — sending it any earlier would race the
// renderer's own startup and the message would just be dropped.
let pendingOpenFilePath = null

function extractTeqPathFromArgv(argv) {
  // In a packaged app argv[0] is the exe itself (no extra "." arg like
  // `electron .` in dev), so just look for anything ending in .teq rather
  // than assuming a fixed index.
  return argv.find((arg) => arg.toLowerCase().endsWith('.teq')) || null
}

function sendOpenFileWhenReady(filePath) {
  if (!filePath) return
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('menu:open-project-file', filePath)
  } else {
    pendingOpenFilePath = filePath
  }
}

// macOS: fired when a registered file is double-clicked, dropped on the
// dock icon, or "Open With" is used — including before 'ready'.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (mainWindow) {
    sendOpenFileWhenReady(filePath)
  } else {
    pendingOpenFilePath = filePath
  }
})

// Windows/Linux: only one instance of the app should ever run. Without this
// lock, double-clicking a second .teq file while the app's already open
// would launch a whole separate window instead of opening in the existing
// one.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (event, argv) => {
    const filePath = extractTeqPathFromArgv(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    sendOpenFileWhenReady(filePath)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    // Packaged builds get their icon baked in by electron-builder itself
    // (see the "win"/"mac"/"linux" icon fields in package.json's build
    // config) via OS-level resource embedding — this line only covers the
    // *dev* window (npm run electron:dev), which otherwise shows
    // Electron's default icon since assets/ isn't part of the packaged
    // app bundle (it's not in the build "files" list, deliberately: it
    // only needs to exist at build time, not at runtime).
    ...(isDev ? { icon: path.join(__dirname, '../assets/icon.png') } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      enableRemoteModule: false,
    },
  })

  const startUrl = isDev ? 'http://localhost:5173' : 'app://-/index.html'
  mainWindow.loadURL(startUrl)

  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.webContents.once('did-finish-load', () => {
    const filePath = pendingOpenFilePath || extractTeqPathFromArgv(process.argv)
    pendingOpenFilePath = null
    if (filePath) mainWindow.webContents.send('menu:open-project-file', filePath)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

if (gotSingleInstanceLock) {
  app.on('ready', () => {
    registerAppProtocol() // must run after 'ready'; only once, hence not inside createWindow
    createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// File system IPC handlers
ipcMain.handle('fs:read', async (event, filePath) => {
  try {
    return await fs.promises.readFile(filePath, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to read file: ${err.message}`)
  }
})

ipcMain.handle('fs:write', async (event, filePath, content) => {
  try {
    const dir = path.dirname(filePath)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(filePath, content, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to write file: ${err.message}`)
  }
})

ipcMain.handle('fs:delete', async (event, filePath) => {
  try {
    await fs.promises.unlink(filePath)
  } catch (err) {
    throw new Error(`Failed to delete file: ${err.message}`)
  }
})

// The AI panel's "Failed to fetch" comes from calling api.anthropic.com
// directly from the renderer: that's a browser context, and Anthropic's API
// doesn't send CORS headers permitting cross-origin fetches from a webpage,
// so the browser blocks the request before it ever leaves the machine (this
// shows up as a generic "Failed to fetch", not a 4xx/5xx). The main process
// isn't a browser — it's plain Node — so it isn't subject to CORS at all.
// Proxying the call through IPC (renderer -> main -> Anthropic -> main ->
// renderer) is the standard fix for any Electron app that talks to an API
// with no CORS allowance.
ipcMain.handle('ai:send-message', async (event, { apiKey, messages }) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages,
    }),
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message = data?.error?.message || response.statusText
    throw new Error(`API error: ${message}`)
  }

  return data
})

ipcMain.handle('fs:list', async (event, dirPath) => {
  try {
    const files = []
    const walk = async (dir) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isFile()) {
          files.push({
            path: fullPath,
            name: entry.name,
          })
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await walk(fullPath)
        }
      }
    }
    await walk(dirPath)
    return files
  } catch (err) {
    throw new Error(`Failed to list files: ${err.message}`)
  }
})

ipcMain.handle('dialog:open-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  })
  return result.filePaths[0] || null
})

ipcMain.handle('dialog:open-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
  })
  return result.filePaths[0] || null
})

ipcMain.handle('dialog:save-file', async (event, defaultPath, filters) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters,
  })
  return result.filePath || null
})

// Menu
const template = [
  {
    label: 'File',
    submenu: [
      {
        label: 'Open Folder',
        accelerator: 'CmdOrCtrl+O',
        click: () => {
          mainWindow.webContents.send('menu:open-folder')
        },
      },
      { type: 'separator' },
      {
        label: 'Exit',
        accelerator: 'CmdOrCtrl+Q',
        click: () => {
          app.quit()
        },
      },
    ],
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
    ],
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
    ],
  },
]

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)
