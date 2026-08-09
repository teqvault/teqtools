// MOVED to preload.cjs — see electron.js's deprecation note for why.
throw new Error('public/preload.js is deprecated — use public/preload.cjs instead')
/* eslint-disable */
const { contextBridge, ipcRenderer } = require('electron')

// Expose file system API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  fs: {
    readFile: (filePath) => ipcRenderer.invoke('fs:read', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs:write', filePath, content),
    deleteFile: (filePath) => ipcRenderer.invoke('fs:delete', filePath),
    listFiles: (dirPath) => ipcRenderer.invoke('fs:list', dirPath),
  },
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:open-directory'),
    openFile: () => ipcRenderer.invoke('dialog:open-file'),
    saveFile: (defaultPath, filters) => ipcRenderer.invoke('dialog:save-file', defaultPath, filters),
  },
  ai: {
    // Routes the Anthropic API call through the main process, which isn't
    // subject to the browser CORS restriction that blocks a direct fetch
    // from the renderer (see electron.js's 'ai:send-message' handler).
    sendMessage: (apiKey, messages) => ipcRenderer.invoke('ai:send-message', { apiKey, messages }),
  },
  menu: {
    onOpenFolder: (callback) => ipcRenderer.on('menu:open-folder', callback),
    // Fired when the app is launched by double-clicking a .teq file, or
    // one is dropped on the dock icon / opened via "Open With" — see
    // electron.js's fileAssociations handling. `callback` receives the
    // absolute file path (a plain string) as its argument.
    onOpenProjectFile: (callback) =>
      ipcRenderer.on('menu:open-project-file', (event, filePath) => callback(filePath)),
  },
})
