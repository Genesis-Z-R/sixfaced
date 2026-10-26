// ── Block stats store ─────────────────────────────────────────────────────────
// Tracks blocked ad/tracker requests per domain, debounces IPC + disk writes.

const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const { writeJsonAtomic, readJsonWithBackup } = require("./fsSafe");

const blockStatsFile = () =>
  path.join(app.getPath("userData"), "blockStats.json");

let allBlockStats = { total: 0, domains: {} };
let pendingBlockBatch = null;
let blockBatchTimer = null;
let blockSaveTimer = null;

// Injected by init(), returns the current BrowserWindow (or null)
let _getMainWindow = () => null;

function init(getMainWindow) {
  _getMainWindow = getMainWindow;
}

function loadBlockStats() {
  const parsed = readJsonWithBackup(blockStatsFile(), {}, "block-stats");
  allBlockStats = {
    total: Number(parsed.total) || 0,
    domains: parsed.domains && typeof parsed.domains === "object" ? parsed.domains : {},
  };
}

function saveBlockStats() {
  try {
    writeJsonAtomic(blockStatsFile(), {
      total: allBlockStats.total,
      domains: allBlockStats.domains,
    });
  } catch {}
}

/** Flush pending debounced state (called on quit). */
function flush() {
  if (blockSaveTimer) {
    clearTimeout(blockSaveTimer);
    blockSaveTimer = null;
  }
  saveBlockStats();
}

function recordBlockedRequest(url) {
  let domain;
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return;
  }

  // Update alltime in-memory
  allBlockStats.total++;
  allBlockStats.domains[domain] = (allBlockStats.domains[domain] || 0) + 1;

  // Accumulate into pending batch
  if (!pendingBlockBatch) {
    pendingBlockBatch = { total: 0, domains: {} };
  }
  pendingBlockBatch.total++;
  pendingBlockBatch.domains[domain] =
    (pendingBlockBatch.domains[domain] || 0) + 1;

  // Debounced IPC send to renderer (250ms after last block in burst)
  if (blockBatchTimer) clearTimeout(blockBatchTimer);
  blockBatchTimer = setTimeout(() => {
    blockBatchTimer = null;
    const mw = _getMainWindow();
    if (mw && !mw.isDestroyed() && pendingBlockBatch) {
      mw.webContents.send("blocked-stats-update", pendingBlockBatch);
    }
    pendingBlockBatch = null;
  }, 250);

  // Debounced disk write (3s to reduce I/O during active playback)
  if (blockSaveTimer) clearTimeout(blockSaveTimer);
  blockSaveTimer = setTimeout(saveBlockStats, 3000);
}

function getBlockStats() {
  return { total: allBlockStats.total, domains: allBlockStats.domains };
}

module.exports = {
  init,
  loadBlockStats,
  recordBlockedRequest,
  getBlockStats,
  flush,
};
