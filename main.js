const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { Client, Authenticator } = require("minecraft-launcher-core");
const { Auth } = require("msmc");
const config = require("./config");

const MANIFEST = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const gameDir = path.join(app.getPath("appData"), config.gameDirName);
const settingsFile = path.join(app.getPath("userData"), "settings.json");
const authFile = path.join(app.getPath("userData"), "auth.json");

let win = null;
let game = null; // { client, proc }

// ---------- файлы настроек ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
const defaults = { memory: 4, version: "", snapshots: false, joinServer: false, demoName: "" };
const getSettings = () => ({ ...defaults, ...readJson(settingsFile, {}) });

// ---------- окно ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    frame: false,
    backgroundColor: "#09090f",
    title: config.name,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());

ipcMain.on("win:min", () => win && win.minimize());
ipcMain.on("win:close", () => win && win.close());

// ---------- конфиг, настройки ----------
ipcMain.handle("config:get", () => ({
  name: config.name,
  server: config.server,
  news: config.news,
  gameDir
}));
ipcMain.handle("settings:get", () => getSettings());
ipcMain.handle("settings:set", (_e, s) => {
  const next = { ...getSettings(), ...s };
  writeJson(settingsFile, next);
  return next;
});

// ---------- список версий ----------
ipcMain.handle("versions:list", async () => {
  const res = await fetch(MANIFEST);
  if (!res.ok) throw new Error("Манифест версий недоступен: HTTP " + res.status);
  const data = await res.json();
  return {
    latest: data.latest,
    versions: data.versions.map((v) => ({ id: v.id, type: v.type }))
  };
});

// ---------- вход через Microsoft ----------
let mcToken = null; // токен msmc текущей сессии

function describeToken(token) {
  const p = token.profile || {};
  return { name: p.name || "игрок", demo: !!p.demo };
}

ipcMain.handle("auth:session", async () => {
  const saved = readJson(authFile, null);
  if (!saved) return null;
  try {
    const authManager = new Auth("select_account");
    const xbox = await authManager.refresh(saved);
    mcToken = await xbox.getMinecraft();
    writeJson(authFile, xbox.save());
    return describeToken(mcToken);
  } catch {
    return null; // сессия протухла: нужен новый вход
  }
});

ipcMain.handle("auth:microsoft", async () => {
  const authManager = new Auth("select_account");
  const xbox = await authManager.launch("electron");
  mcToken = await xbox.getMinecraft();
  writeJson(authFile, xbox.save());
  return describeToken(mcToken);
});

ipcMain.handle("auth:logout", () => {
  mcToken = null;
  try { fs.unlinkSync(authFile); } catch {}
  return true;
});

// ---------- Java ----------
function javaVersion() {
  const r = spawnSync("java", ["-version"], { encoding: "utf8" });
  if (r.error) return null;
  const m = /version "(\d+)(?:\.(\d+))?/.exec(r.stderr || r.stdout || "");
  if (!m) return null;
  return m[1] === "1" ? Number(m[2]) : Number(m[1]);
}

function neededJava(id) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(id);
  if (!m) return 21; // снапшоты и новые схемы версий
  const minor = Number(m[2]), patch = Number(m[3] || 0);
  if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 18 || (minor === 17)) return 17;
  return 8;
}

// ---------- запуск игры ----------
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);

ipcMain.handle("game:play", async (_e, opts) => {
  if (game) return { ok: false, error: "Игра уже запущена" };

  const { version, memory, mode, name, joinServer } = opts;
  if (!version) return { ok: false, error: "Выбери версию" };

  const need = neededJava(version);
  const have = javaVersion();
  if (!have) {
    return { ok: false, error: `Не найдена Java. Для ${version} нужна Java ${need}+ (например, Temurin с adoptium.net)` };
  }
  if (have < need) {
    return { ok: false, error: `Для ${version} нужна Java ${need}+, у тебя ${have}. Обнови Java` };
  }

  let authorization;
  const extraArgs = [];
  if (mode === "microsoft") {
    if (!mcToken) return { ok: false, error: "Сначала войди через Microsoft" };
    authorization = mcToken.mclc();
    if (mcToken.profile && mcToken.profile.demo) extraArgs.push("--demo"); // аккаунт без купленной игры
  } else {
    // Демо-режим: клиент сам ограничивает игру (флаг --demo), это функция Mojang
    const nick = (name || "").trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nick)) {
      return { ok: false, error: "Ник: 3–16 символов, латиница, цифры и _" };
    }
    authorization = Authenticator.getAuth(nick);
    // extraArgs.push("--demo");
  }

  const client = new Client();
  const launchOpts = {
    authorization,
    root: gameDir,
    version: { number: version, type: /^\d+\.\d+(\.\d+)?$/.test(version) ? "release" : "snapshot" },
    memory: { max: `${Math.max(1, Math.min(32, memory || 4))}G`, min: "1G" },
    customLaunchArgs: extraArgs
  };
  if (joinServer && config.server.host) {
    launchOpts.server = { host: config.server.host, port: String(config.server.port || 25565) };
  }

  client.on("debug", (m) => send("game:log", { text: String(m) }));
  client.on("data", (m) => send("game:log", { text: String(m).trim(), game: true }));
  client.on("progress", (p) => send("game:progress", p));
  client.on("close", (code) => {
    game = null;
    send("game:state", { state: code === 0 ? "stopped" : "error", code });
  });

  game = { client, proc: null };
  send("game:state", { state: "loading" });
  try {
    const proc = await client.launch(launchOpts);
    if (!proc) {
      game = null;
      return { ok: false, error: "Запуск не удался, смотри журнал" };
    }
    game.proc = proc;
    send("game:state", { state: "running" });
    return { ok: true };
  } catch (e) {
    game = null;
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

ipcMain.handle("game:stop", () => {
  if (game && game.proc) game.proc.kill();
  return true;
});
