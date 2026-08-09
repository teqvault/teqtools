const { app, BrowserWindow, Menu, ipcMain, dialog, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const url = require('url')
const { spawn } = require('child_process')
// Wraps the system `git` binary (not bundled — the user's machine needs git
// on PATH, same as any other IDE's git integration). Already listed in
// package.json's dependencies (was previously unused dead weight); safe for
// electron-builder to pack since it's pure JS, no native/prebuilt-binary
// concerns like node-pty would have had.
const simpleGit = require('simple-git')
// Was `require('electron-is-dev')` — that package is a devDependency, and
// electron-builder only bundles `dependencies` into the packaged app.asar,
// so this require() 404'd at runtime in the built .exe ("Cannot find
// module 'electron-is-dev'") despite working fine in `npm run electron:dev`.
// `app.isPackaged` is built into Electron itself and means the same thing,
// with no extra dependency (or packaging footgun) involved.
const isDev = !app.isPackaged

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

// Extensions registered as file associations below (build.fileAssociations)
// that AREN'T .teq — i.e. plain code/text files the OS can now hand to this
// app via double-click / "Open with" / "Set as default app", separately
// from Teq Vault's own .teq project format. Keep this in sync with the
// "ext" values in package.json's fileAssociations list (minus "teq").
const OPENABLE_TEXT_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'html', 'css', 'scss', 'json', 'md', 'yml', 'yaml', 'xml', 'txt', 'py',
])

// In a packaged app argv[0] is the exe itself (no extra "." arg like
// `electron .` in dev), so this just looks for anything ending in a
// recognized extension rather than assuming a fixed argv index. Returns
// { filePath, isProjectFile } so the caller knows which IPC channel (and
// therefore which renderer-side loader — whole-project JSON vs. a single
// plain-text file) to use.
function extractOpenableFileFromArgv(argv) {
  for (const arg of argv) {
    const lower = arg.toLowerCase()
    if (lower.endsWith('.teq')) return { filePath: arg, isProjectFile: true }
    const ext = lower.split('.').pop()
    if (OPENABLE_TEXT_EXTENSIONS.has(ext)) return { filePath: arg, isProjectFile: false }
  }
  return null
}

function sendOpenFileWhenReady(filePath, isProjectFile) {
  if (!filePath) return
  const channel = isProjectFile ? 'menu:open-project-file' : 'menu:open-single-file'
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(channel, filePath)
  } else {
    pendingOpenFilePath = { filePath, isProjectFile }
  }
}

// macOS: fired when a registered file is double-clicked, dropped on the
// dock icon, or "Open With" is used — including before 'ready'. Unlike the
// Windows/Linux argv path below, macOS hands this a bare path with no other
// argv noise to search through, so it's run through the same argv-scanning
// helper as a one-element array just to get the same isProjectFile check.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  const opened = extractOpenableFileFromArgv([filePath])
  if (mainWindow) {
    if (opened) sendOpenFileWhenReady(opened.filePath, opened.isProjectFile)
  } else {
    pendingOpenFilePath = opened
  }
})

// Windows/Linux: only one instance of the app should ever run. Without this
// lock, double-clicking a second .teq (or other associated) file while the
// app's already open would launch a whole separate window instead of
// opening in the existing one.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (event, argv) => {
    const opened = extractOpenableFileFromArgv(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    if (opened) sendOpenFileWhenReady(opened.filePath, opened.isProjectFile)
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
      preload: path.join(__dirname, 'preload.cjs'),
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
    const opened = pendingOpenFilePath || extractOpenableFileFromArgv(process.argv)
    pendingOpenFilePath = null
    if (opened) {
      const channel = opened.isProjectFile ? 'menu:open-project-file' : 'menu:open-single-file'
      mainWindow.webContents.send(channel, opened.filePath)
    }
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

// Extension -> MIME map for binary reads (fs:read below) — used to build a
// proper data URL so images render correctly via <img src="..."> (see
// Editor.jsx's BinaryFileView / Preview.jsx) and DocPreview.jsx's mammoth
// conversion gets a real docx MIME rather than a generic fallback. Not
// exhaustive — anything not listed just falls back to
// application/octet-stream, which is harmless for files the app never
// renders inline (only images and docx/xlsx/pptx currently need the real
// type).
const MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

// File system IPC handlers
//
// `binary` (added alongside the File-menu "Open Folder" native-fs flow —
// see App.jsx's handleOpenFolderNative) switches between reading/writing
// plain UTF-8 text and reading/writing a base64 data URL. Without this,
// loading an image through this path read its raw bytes as if they were
// UTF-8 text (silently corrupting it), and writing one back would write the
// literal string "data:image/png;base64,...." to disk instead of decoding
// it back to real image bytes.
ipcMain.handle('fs:read', async (event, filePath, binary) => {
  try {
    if (binary) {
      const buf = await fs.promises.readFile(filePath)
      const ext = path.extname(filePath).slice(1).toLowerCase()
      const mime = MIME_TYPES[ext] || 'application/octet-stream'
      return `data:${mime};base64,${buf.toString('base64')}`
    }
    return await fs.promises.readFile(filePath, 'utf-8')
  } catch (err) {
    throw new Error(`Failed to read file: ${err.message}`)
  }
})

ipcMain.handle('fs:write', async (event, filePath, content, binary) => {
  try {
    const dir = path.dirname(filePath)
    await fs.promises.mkdir(dir, { recursive: true })
    if (binary) {
      const base64 = (content || '').split(',')[1] || ''
      await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'))
    } else {
      await fs.promises.writeFile(filePath, content, 'utf-8')
    }
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

// The AI panel's "Failed to fetch" comes from calling an AI API directly
// from the renderer: that's a browser context, and most of these APIs
// don't send CORS headers permitting cross-origin fetches from a webpage,
// so the browser blocks the request before it ever leaves the machine (this
// shows up as a generic "Failed to fetch", not a 4xx/5xx). The main process
// isn't a browser — it's plain Node — so it isn't subject to CORS at all.
// Proxying the call through IPC (renderer -> main -> provider -> main ->
// renderer) is the standard fix for any Electron app that talks to an API
// with no CORS allowance. See src/aiProviders.js for the renderer side of
// this (provider metadata, and the one exception — Gemini — that's allowed
// to skip this proxy and call straight from the browser in the web/PWA
// build, since Google's API explicitly permits it).
//
// Each provider speaks a different request/response shape (Anthropic's own
// Messages API; Gemini's contents/parts shape; Groq and OpenRouter both
// speak the OpenAI-compatible chat-completions shape) — normalized here to
// a single `{ text }` so AiChat.jsx doesn't need to know which provider it
// asked.

// `systemPrompt` carries the file-edit protocol instructions (see
// src/aiProviders.js's buildSystemPrompt) — each API takes it in a
// different place, hence a separate param instead of just another message.
// max_tokens is bumped well past the old 1024 default since a response can
// now legitimately contain one or more whole file bodies, not just a short
// chat reply.

// `model` is whatever the renderer resolved via src/aiProviders.js's
// getSelectedModel() (the user's per-provider pick, falling back to that
// provider's defaultModel) — falling back again here to a hardcoded model
// is just a last-resort safety net in case an older renderer build ever
// calls this without passing one.
async function callAnthropic(apiKey, messages, systemPrompt, model) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-5',
      max_tokens: 8192,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages,
    }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error?.message || response.statusText)
  return data.content[0].text
}

async function callGemini(apiKey, messages, systemPrompt, model) {
  // Gemini uses "contents"/"parts" instead of "messages"/"content", and
  // "model" instead of "assistant" as the non-user role.
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const body = { contents }
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model || 'gemini-2.5-flash'}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error?.message || response.statusText)
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '(empty response)'
}

async function callOpenAICompatible(baseUrl, model, apiKey, messages, systemPrompt) {
  const fullMessages = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, messages: fullMessages }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error?.message || response.statusText)
  return data.choices?.[0]?.message?.content || '(empty response)'
}

ipcMain.handle('ai:send-message', async (event, { provider, apiKey, messages, systemPrompt, model }) => {
  try {
    switch (provider) {
      case 'gemini':
        return { text: await callGemini(apiKey, messages, systemPrompt, model) }
      case 'groq':
        return {
          text: await callOpenAICompatible(
            'https://api.groq.com/openai/v1/chat/completions',
            model || 'llama-3.3-70b-versatile',
            apiKey,
            messages,
            systemPrompt
          ),
        }
      case 'openrouter':
        return {
          text: await callOpenAICompatible(
            'https://openrouter.ai/api/v1/chat/completions',
            model || 'nvidia/nemotron-3-ultra-550b-a55b:free',
            apiKey,
            messages,
            systemPrompt
          ),
        }
      case 'openai':
        return {
          text: await callOpenAICompatible(
            'https://api.openai.com/v1/chat/completions',
            model || 'gpt-5.6-terra',
            apiKey,
            messages,
            systemPrompt
          ),
        }
      case 'nvidianim':
        return {
          text: await callOpenAICompatible(
            'https://integrate.api.nvidia.com/v1/chat/completions',
            model || 'deepseek-ai/deepseek-v4-flash-0731',
            apiKey,
            messages,
            systemPrompt
          ),
        }
      case 'anthropic':
      default:
        return { text: await callAnthropic(apiKey, messages, systemPrompt, model) }
    }
  } catch (err) {
    throw new Error(`API error: ${err.message}`)
  }
})

ipcMain.handle('fs:list', async (event, dirPath) => {
  try {
    const files = []
    const walk = async (dir) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isFile()) {
          // `size` lets the renderer apply the same import size limits used
          // everywhere else (see importFolder.js's MAX_FILE_SIZE /
          // MAX_BINARY_FILE_SIZE) without a second round-trip per file.
          const stat = await fs.promises.stat(fullPath)
          files.push({
            path: fullPath,
            name: entry.name,
            size: stat.size,
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

// ── Terminal ──────────────────────────────────────────────────────────────
// A plain child_process.spawn per command, not a real pty (node-pty was
// deliberately avoided — it's a native module that needs rebuilding against
// Electron's exact ABI, which is exactly the kind of packaging landmine that
// caused the earlier electron-is-dev/EPERM build failures on this project).
// The tradeoff: no ANSI cursor control, no truly interactive programs
// (vim, a REPL that needs a real tty) — but npm/git/node/build commands,
// which is what an IDE's terminal panel is for, work fine streamed this way.
//
// Only one command runs at a time (see `runningProc` below) — Terminal.jsx
// disables its input while a command is in flight, matching that.
let runningProc = null

ipcMain.handle('terminal:run', async (event, { command, cwd }) => {
  return new Promise((resolve) => {
    if (runningProc) {
      resolve({ code: 1, error: 'A command is already running' })
      return
    }
    const workDir = cwd || os.homedir()
    const isWin = process.platform === 'win32'
    const shell = isWin ? 'cmd.exe' : process.env.SHELL || '/bin/bash'
    const args = isWin ? ['/d', '/s', '/c', command] : ['-c', command]

    let child
    try {
      child = spawn(shell, args, { cwd: workDir, windowsHide: true })
    } catch (err) {
      resolve({ code: 1, error: err.message })
      return
    }
    runningProc = child

    child.stdout.on('data', (chunk) => {
      if (!event.sender.isDestroyed()) event.sender.send('terminal:data', chunk.toString())
    })
    child.stderr.on('data', (chunk) => {
      if (!event.sender.isDestroyed()) event.sender.send('terminal:data', chunk.toString())
    })
    child.on('error', (err) => {
      runningProc = null
      resolve({ code: 1, error: err.message })
    })
    child.on('close', (code) => {
      runningProc = null
      resolve({ code })
    })
  })
})

ipcMain.handle('terminal:kill', async () => {
  if (!runningProc) return false
  runningProc.kill()
  runningProc = null
  return true
})

ipcMain.handle('terminal:home-dir', async () => os.homedir())

// Resolves a `cd` target against the current cwd and confirms it's actually
// a directory — handled here rather than by just spawning `cd` as a command,
// since `cd` only changes the *spawned subprocess's* directory, not anything
// that persists to the next command (each terminal:run call is a fresh
// process). Terminal.jsx special-cases `cd` client-side to call this instead
// of running it as a real command — see its handleCommand.
ipcMain.handle('terminal:resolve-cwd', async (event, { cwd, target }) => {
  const base = cwd || os.homedir()
  const resolved = target.startsWith('~')
    ? path.join(os.homedir(), target.slice(1))
    : path.resolve(base, target)
  const stat = await fs.promises.stat(resolved)
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`)
  return resolved
})

// ── Git ───────────────────────────────────────────────────────────────────
// Thin wrapper around simple-git (already a listed dependency, previously
// unused). Every handler takes an explicit repoPath rather than assuming a
// single global cwd — see src/store.js's desktopFolderPath, set from
// GitPanel.jsx / Terminal.jsx via dialog:open-directory.
function gitAt(repoPath) {
  if (!repoPath) throw new Error('No folder selected')
  return simpleGit(repoPath)
}

ipcMain.handle('git:status', async (event, repoPath) => {
  try {
    return await gitAt(repoPath).status()
  } catch (err) {
    throw new Error(err.message)
  }
})

ipcMain.handle('git:log', async (event, { repoPath, limit }) => {
  try {
    const log = await gitAt(repoPath).log({ maxCount: limit || 30 })
    return log.all
  } catch (err) {
    throw new Error(err.message)
  }
})

ipcMain.handle('git:diff', async (event, { repoPath, file, staged }) => {
  try {
    const args = staged ? ['--cached'] : []
    if (file) args.push('--', file)
    return await gitAt(repoPath).diff(args)
  } catch (err) {
    throw new Error(err.message)
  }
})

ipcMain.handle('git:stage', async (event, { repoPath, files }) => {
  try {
    await gitAt(repoPath).add(files)
    return true
  } catch (err) {
    throw new Error(err.message)
  }
})

ipcMain.handle('git:unstage', async (event, { repoPath, files }) => {
  try {
    await gitAt(repoPath).reset(['--', ...files])
    return true
  } catch (err) {
    throw new Error(err.message)
  }
})

ipcMain.handle('git:commit', async (event, { repoPath, message }) => {
  try {
    return await gitAt(repoPath).commit(message)
  } catch (err) {
    throw new Error(err.message)
  }
})

ipcMain.handle('git:branches', async (event, repoPath) => {
  try {
    return await gitAt(repoPath).branchLocal()
  } catch (err) {
    throw new Error(err.message)
  }
})

ipcMain.handle('git:checkout', async (event, { repoPath, branch }) => {
  try {
    await gitAt(repoPath).checkout(branch)
    return true
  } catch (err) {
    throw new Error(err.message)
  }
})

ipcMain.handle('git:create-branch', async (event, { repoPath, branch }) => {
  try {
    await gitAt(repoPath).checkoutLocalBranch(branch)
    return true
  } catch (err) {
    throw new Error(err.message)
  }
})

ipcMain.handle('git:init', async (event, repoPath) => {
  try {
    await gitAt(repoPath).init()
    return true
  } catch (err) {
    throw new Error(err.message)
  }
})

ipcMain.handle('git:push', async (event, repoPath) => {
  try {
    return await gitAt(repoPath).push()
  } catch (err) {
    throw new Error(err.message)
  }
})

ipcMain.handle('git:pull', async (event, repoPath) => {
  try {
    return await gitAt(repoPath).pull()
  } catch (err) {
    throw new Error(err.message)
  }
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
  {
    label: 'Help',
    submenu: [
      {
        label: 'Getting Started',
        click: () => {
          mainWindow.webContents.send('menu:show-getting-started')
        },
      },
      // A "Check for Updates" item is a natural neighbor here once there's
      // an actual update-check mechanism (e.g. electron-updater against
      // GitHub Releases) wired up — nothing to hook it to yet, so it's left
      // out rather than added as a dead stub.
    ],
  },
]

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)
