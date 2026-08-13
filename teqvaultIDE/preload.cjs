const { contextBridge, ipcRenderer } = require('electron')

// Expose file system API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  fs: {
    // `binary` reads/writes a base64 data URL instead of UTF-8 text — see
    // electron.cjs's fs:read/fs:write. Omit it (or pass false) for ordinary
    // text files; existing callers that don't pass it keep working exactly
    // as before.
    readFile: (filePath, binary) => ipcRenderer.invoke('fs:read', filePath, binary),
    writeFile: (filePath, content, binary) => ipcRenderer.invoke('fs:write', filePath, content, binary),
    deleteFile: (filePath) => ipcRenderer.invoke('fs:delete', filePath),
    listFiles: (dirPath) => ipcRenderer.invoke('fs:list', dirPath),
    // A fresh scratch directory for the "Run" button (see Terminal.jsx's
    // runRequest) to write a file's current content into before running
    // it — see electron.cjs's fs:get-temp-dir for why this exists.
    getTempDir: () => ipcRenderer.invoke('fs:get-temp-dir'),
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:open-directory'),
    openFile: () => ipcRenderer.invoke('dialog:open-file'),
    saveFile: (defaultPath, filters) => ipcRenderer.invoke('dialog:save-file', defaultPath, filters),
  },
  ai: {
    // Routes the AI provider call through the main process, which isn't
    // subject to the browser CORS restriction that blocks a direct fetch
    // from the renderer (see electron.cjs's 'ai:send-message' handler and
    // src/aiProviders.js for the provider list).
    sendMessage: (provider, apiKey, messages, systemPrompt, model) =>
      ipcRenderer.invoke('ai:send-message', { provider, apiKey, messages, systemPrompt, model }),
  },
  terminal: {
    // Runs one command to completion in `cwd` (defaults to the OS home dir
    // if omitted — see electron.cjs's terminal:run) and resolves with
    // { code, error? } once it exits. Streamed output arrives separately via
    // onData while it runs, same pattern as everything else in this file:
    // request/response over invoke, live updates over a plain event.
    run: (command, cwd) => ipcRenderer.invoke('terminal:run', { command, cwd }),
    kill: () => ipcRenderer.invoke('terminal:kill'),
    homeDir: () => ipcRenderer.invoke('terminal:home-dir'),
    resolveCwd: (cwd, target) => ipcRenderer.invoke('terminal:resolve-cwd', { cwd, target }),
    // Only one Terminal panel instance ever exists at a time, so replacing
    // rather than stacking listeners on each call is deliberate — avoids
    // duplicate output if the panel unmounts/remounts (e.g. toggled closed
    // and reopened).
    onData: (callback) => {
      ipcRenderer.removeAllListeners('terminal:data')
      ipcRenderer.on('terminal:data', (event, chunk) => callback(chunk))
    },
  },
  git: {
    // Every call takes an explicit repoPath (see src/store.js's
    // desktopFolderPath) rather than assuming a single global cwd — see
    // electron.cjs's gitAt() helper for the shared validation.
    status: (repoPath) => ipcRenderer.invoke('git:status', repoPath),
    log: (repoPath, limit) => ipcRenderer.invoke('git:log', { repoPath, limit }),
    diff: (repoPath, file, staged) => ipcRenderer.invoke('git:diff', { repoPath, file, staged }),
    stage: (repoPath, files) => ipcRenderer.invoke('git:stage', { repoPath, files }),
    unstage: (repoPath, files) => ipcRenderer.invoke('git:unstage', { repoPath, files }),
    commit: (repoPath, message) => ipcRenderer.invoke('git:commit', { repoPath, message }),
    branches: (repoPath) => ipcRenderer.invoke('git:branches', repoPath),
    checkout: (repoPath, branch) => ipcRenderer.invoke('git:checkout', { repoPath, branch }),
    createBranch: (repoPath, branch) => ipcRenderer.invoke('git:create-branch', { repoPath, branch }),
    init: (repoPath) => ipcRenderer.invoke('git:init', repoPath),
    push: (repoPath) => ipcRenderer.invoke('git:push', repoPath),
    pull: (repoPath) => ipcRenderer.invoke('git:pull', repoPath),
  },
  menu: {
    onOpenFolder: (callback) => ipcRenderer.on('menu:open-folder', callback),
    // Fired when the app is launched by double-clicking a .teq file, or
    // one is dropped on the dock icon / opened via "Open With" — see
    // electron.cjs's fileAssociations handling. `callback` receives the
    // absolute file path (a plain string) as its argument.
    onOpenProjectFile: (callback) =>
      ipcRenderer.on('menu:open-project-file', (event, filePath) => callback(filePath)),
    // Same idea as onOpenProjectFile, but for a plain code/text file opened
    // via double-click / "Open with Teq Vault IDE" / "set as default app"
    // for one of the non-.teq extensions in package.json's
    // fileAssociations — see electron.cjs's OPENABLE_TEXT_EXTENSIONS. The
    // file's raw content should be loaded as-is, not JSON.parse'd like a
    // .teq project file.
    onOpenSingleFile: (callback) =>
      ipcRenderer.on('menu:open-single-file', (event, filePath) => callback(filePath)),
    // Fired from the Help menu's "Getting Started" item (see electron.cjs) —
    // reopens the same first-launch guide shown by App.jsx on a fresh
    // install (src/components/GettingStarted.jsx).
    onShowGettingStarted: (callback) => ipcRenderer.on('menu:show-getting-started', () => callback()),
  },
})
