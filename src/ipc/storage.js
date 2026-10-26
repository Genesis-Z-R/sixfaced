// ── IPC: Secure key store + Scheduled Backups ─────────────────────────────────
// Handles safeStorage (OS keychain) and scheduled backup read/write/trigger.
//
// Exports register(ipcMain) + helpers used by index.js (migration, backup trigger)

const { app, ipcMain, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const {
  writeFileAtomic,
  writeJsonAtomic,
  readJsonWithBackup,
  keepBackup,
} = require("./fsSafe");

// ── Secure key/value store ────────────────────────────────────────────────────
// Falls back to plain base64 when OS encryption is unavailable (rare Linux).

let _secureStoreFile = null;
const secureStoreFile = () =>
  _secureStoreFile ||
  (_secureStoreFile = path.join(app.getPath("userData"), "secure-store.json"));

let _secureStoreCache = null;

function readSecureStore() {
  if (_secureStoreCache) return _secureStoreCache;
  const file = secureStoreFile();
  _secureStoreCache = readJsonWithBackup(file, {}, "secure-store");
  return _secureStoreCache;
}

function writeSecureStore(data) {
  _secureStoreCache = data;
  const file = secureStoreFile();
  // Keep the last readable store around in case the next write is interrupted.
  keepBackup(file);
  writeJsonAtomic(file, data, { mode: 0o600 });
}

function secureStoreGet(key) {
  const store = readSecureStore();
  const raw = store[key];
  if (!raw) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(raw, "base64"));
    }
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function secureStoreSet(key, value) {
  const store = readSecureStore();
  if (value === null || value === undefined || value === "") {
    delete store[key];
  } else {
    if (safeStorage.isEncryptionAvailable()) {
      store[key] = safeStorage.encryptString(value).toString("base64");
    } else {
      store[key] = Buffer.from(value, "utf8").toString("base64");
    }
  }
  writeSecureStore(store);
}

// ── Secret migration (AppImage update key re-encryption) ──────────────────────
// When the AppImage binary is replaced, safeStorage can no longer decrypt the
// old ciphertext. We write a short-lived plaintext file before exit and
// re-encrypt it on the next startup.

const migrationFile = () =>
  path.join(app.getPath("userData"), ".secret-migration.json");

// Plaintext secrets must never linger if the app crashes before the next boot.
const MIGRATION_TTL_MS = 10 * 60 * 1000;
let _migrationTimer = null;

function writeSecretMigration() {
  try {
    const store = readSecureStore();
    const plain = {};
    for (const [k, raw] of Object.entries(store)) {
      if (!raw) continue;
      try {
        if (safeStorage.isEncryptionAvailable()) {
          plain[k] = safeStorage.decryptString(Buffer.from(raw, "base64"));
        } else {
          plain[k] = Buffer.from(raw, "base64").toString("utf8");
        }
      } catch {
        /* skip unreadable keys */
      }
    }
    if (Object.keys(plain).length > 0) {
      writeFileAtomic(migrationFile(), JSON.stringify(plain), { mode: 0o600 });
      if (_migrationTimer) clearTimeout(_migrationTimer);
      _migrationTimer = setTimeout(() => {
        try {
          fs.unlinkSync(migrationFile());
        } catch {}
      }, MIGRATION_TTL_MS);
      if (typeof _migrationTimer.unref === "function") _migrationTimer.unref();
    }
  } catch {
    /* best-effort */
  }
}

function applySecretMigrationIfNeeded() {
  const mf = migrationFile();
  if (!fs.existsSync(mf)) return;
  let plain = null;
  try {
    const raw = fs.readFileSync(mf, "utf8");
    // Delete IMMEDIATELY after reading
    try {
      fs.unlinkSync(mf);
    } catch {
      try {
        writeFileAtomic(mf, "{}", { mode: 0o600 });
      } catch {}
    }
    plain = JSON.parse(raw);
  } catch {
    return;
  }
  if (!plain) return;
  for (const [k, v] of Object.entries(plain)) {
    try {
      if (v) secureStoreSet(k, v);
    } catch {}
  }
}

// Safety-net: nuke migration file on quit if it somehow survived
app.on("quit", () => {
  try {
    fs.unlinkSync(migrationFile());
  } catch {}
});

// ── Scheduled backup store ────────────────────────────────────────────────────

const scheduledBackupSettingsFile = () =>
  path.join(app.getPath("userData"), "scheduled-backup-settings.json");

function loadScheduledBackupSettings() {
  const fallback = {
    enabled: false,
    path: "",
    keepCount: 5,
    frequency: "startup",
    lastRun: null,
  };
  return { ...fallback, ...readJsonWithBackup(scheduledBackupSettingsFile(), fallback, "backup-settings") };
}

function saveScheduledBackupSettings(settings) {
  const file = scheduledBackupSettingsFile();
  keepBackup(file);
  writeJsonAtomic(file, settings);
}

function shouldRunScheduledBackup(settings) {
  if (!settings.enabled || !settings.path) return false;
  if (settings.frequency === "startup") return true;
  if (!settings.lastRun) return true;
  const diff = Date.now() - new Date(settings.lastRun).getTime();
  if (settings.frequency === "daily") return diff >= 86_400_000;
  if (settings.frequency === "weekly") return diff >= 604_800_000;
  if (settings.frequency === "monthly") return diff >= 2_592_000_000;
  return false;
}

// ── IPC registration ──────────────────────────────────────────────────────────

function register() {
  ipcMain.handle("get-app-version", () => app.getVersion());

  ipcMain.handle("secure-store-get", (_, key) => {
    try {
      return { ok: true, value: secureStoreGet(key) };
    } catch {
      return { ok: false, value: null };
    }
  });

  ipcMain.handle("secure-store-set", (_, { key, value }) => {
    try {
      secureStoreSet(key, value);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("get-scheduled-backup-settings", () =>
    loadScheduledBackupSettings(),
  );

  ipcMain.handle("set-scheduled-backup-settings", (_, settings) => {
    try {
      saveScheduledBackupSettings(settings);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("perform-scheduled-backup", (_, { data, settings }) => {
    try {
      const backupDir = settings.path;
      if (!backupDir) return { ok: false, error: "No backup path set" };

      const resolvedDir = path.resolve(backupDir);

      fs.mkdirSync(resolvedDir, { recursive: true });

      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const filename = `streambert-backup-${timestamp}.json`;
      const fullPath = path.join(resolvedDir, filename);
      writeJsonAtomic(fullPath, {
        version: 1,
        exportedAt: new Date().toISOString(),
        scheduledBackup: true,
        data,
      });

      // Record the run before pruning: a failed prune must not make the
      // scheduled backup fire again on every launch.
      saveScheduledBackupSettings({
        ...settings,
        lastRun: new Date().toISOString(),
      });

      // Prune old backups (a file vanishing mid-scan is not fatal)
      const keepCount = Math.max(1, Number(settings.keepCount) || 5);
      const entries = [];
      for (const f of fs.readdirSync(resolvedDir)) {
        if (!f.startsWith("streambert-backup-") || !f.endsWith(".json")) continue;
        try {
          entries.push({ name: f, mtime: fs.statSync(path.join(resolvedDir, f)).mtimeMs });
        } catch {}
      }
      entries
        .sort((a, b) => b.mtime - a.mtime)
        .slice(keepCount)
        .forEach(({ name }) => {
          try {
            fs.unlinkSync(path.join(resolvedDir, name));
          } catch {}
        });

      return { ok: true, path: fullPath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("save-auto-backup", (_, data) => {
    try {
      const payload = JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          autoBackup: true,
          data,
        },
        null,
        2,
      );

      // Primary: Documents folder ~/Documents/Streambert/streambert_backup.json
      try {
        let docsDir = null;
        try {
          docsDir = app.getPath("documents");
        } catch {}
        if (!docsDir) {
          docsDir = path.join(app.getPath("home"), "Documents");
        }
        const targetDir = path.join(docsDir, "Streambert");
        fs.mkdirSync(targetDir, { recursive: true });
        writeFileAtomic(path.join(targetDir, "streambert_backup.json"), payload);
      } catch (e) {
        console.warn("[AutoBackup] Documents write failed:", e.message);
      }

      // Secondary: userData folder streambert_backup.json
      try {
        const userDir = app.getPath("userData");
        fs.mkdirSync(userDir, { recursive: true });
        writeFileAtomic(path.join(userDir, "streambert_backup.json"), payload);
      } catch (e) {
        console.warn("[AutoBackup] UserData write failed:", e.message);
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = {
  register,
  applySecretMigrationIfNeeded,
  writeSecretMigration,
  loadScheduledBackupSettings,
  shouldRunScheduledBackup,
};
