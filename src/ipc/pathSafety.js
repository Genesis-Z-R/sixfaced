// ── Path containment helpers ─────────────────────────────────────────────────
// Renderer-supplied paths must never be trusted for writes/deletes. These
// helpers resolve symlinks before comparing, so `../` and symlink tricks are
// rejected as well as plain outside-the-folder paths.

const fs = require("fs");
const path = require("path");

function realPath(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return path.resolve(target);
  }
}

/** True when `candidate` is `root` itself or lives inside it. */
function isWithin(root, candidate) {
  if (!root || !candidate) return false;
  const rel = path.relative(realPath(root), realPath(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** True when `candidate` lives inside at least one of `roots`. */
function isWithinAny(roots, candidate) {
  return (roots || []).some((root) => root && isWithin(root, candidate));
}

/** Collects the download roots for a list of download entries. */
function downloadRoots(entries) {
  const roots = [];
  for (const entry of entries || []) {
    if (entry?.downloadPath) roots.push(entry.downloadPath);
    if (entry?.filePath) roots.push(path.dirname(entry.filePath));
  }
  return [...new Set(roots)];
}

module.exports = { isWithin, isWithinAny, downloadRoots };
