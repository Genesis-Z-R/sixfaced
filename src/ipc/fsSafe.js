// ── Safe file persistence helpers ────────────────────────────────────────────
// Small utilities shared by the IPC modules so every persisted JSON file is
// written atomically (tmp + rename) and survives a truncated/corrupt file.

const fs = require("fs");
const path = require("path");

/**
 * Writes a file atomically: the content is written to a temporary sibling and
 * renamed over the target, so a crash mid-write can never leave a half file.
 */
function writeFileAtomic(file, data, { mode, encoding = "utf8" } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, mode ? { mode, encoding } : { encoding });
  fs.renameSync(tmp, file);
}

/**
 * Reads and validates JSON. Objects are expected by default; pass
 * `{ allowArray: true }` for stores that persist arrays (e.g. downloads.json).
 */
function readJsonFile(file, { allowArray = false } = {}) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("unexpected JSON shape");
  }
  if (Array.isArray(parsed) && !allowArray) {
    throw new Error("unexpected JSON shape");
  }
  return parsed;
}

/**
 * Reads a JSON object, falling back to `<file>.bak` when the primary file is
 * corrupt. An unreadable primary is moved aside so it is never silently
 * overwritten (and can be inspected later).
 */
function readJsonWithBackup(file, fallback, label = "storage", options = {}) {
  try {
    return readJsonFile(file, options);
  } catch (err) {
    if (err && err.code === "ENOENT") return fallback;
    try {
      const backup = readJsonFile(`${file}.bak`, options);
      console.warn(`[${label}] recovered ${path.basename(file)} from backup`);
      return backup;
    } catch {
      console.warn(`[${label}] unreadable ${path.basename(file)}: ${err.message}`);
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {}
      return fallback;
    }
  }
}

/** Keeps a copy of the last readable version before an overwrite. */
function keepBackup(file, options = {}) {
  try {
    if (!fs.existsSync(file)) return;
    readJsonFile(file, options); // only back up a file we can actually read
    fs.copyFileSync(file, `${file}.bak`);
  } catch {}
}

function writeJsonAtomic(file, value, opts) {
  writeFileAtomic(file, JSON.stringify(value, null, 2), opts);
}

module.exports = {
  writeFileAtomic,
  writeJsonAtomic,
  readJsonFile,
  readJsonWithBackup,
  keepBackup,
};
