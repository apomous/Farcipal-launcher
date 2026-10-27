const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcher", {
  config: () => ipcRenderer.invoke("config:get"),
  versions: () => ipcRenderer.invoke("versions:list"),
  session: () => ipcRenderer.invoke("auth:session"),
  login: () => ipcRenderer.invoke("auth:microsoft"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  play: (opts) => ipcRenderer.invoke("game:play", opts),
  stop: () => ipcRenderer.invoke("game:stop"),
  settings: { get: () => ipcRenderer.invoke("settings:get"), set: (s) => ipcRenderer.invoke("settings:set", s) },
  win: (action) => ipcRenderer.send("win:" + action),
  on: (channel, fn) => {
    const allowed = ["game:log", "game:progress", "game:state"];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => fn(data));
  }
});
