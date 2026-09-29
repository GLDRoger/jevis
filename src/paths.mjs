import { delimiter, posix, win32 } from "node:path";

/** Folder lists use the shell platform's separator, not the colon in a drive letter. */
export const splitFolders = (value, separator = delimiter) => String(value ?? "").split(separator).filter(Boolean);

/** Windows accepts either separator and compares folder names without case. POSIX names stay exact. */
export function pathKey(value, platform = process.platform) {
  if (platform !== "win32") return value;
  const p = win32.normalize(value).toLowerCase();
  return p.length > win32.parse(p).root.length ? p.replace(/\\+$/, "") : p;
}
export const samePath = (a, b, platform = process.platform) => pathKey(a, platform) === pathKey(b, platform);

/** A folder boundary, so app never includes application. */
export function insideFolder(path, folder, platform = process.platform) {
  const slash = platform === "win32" ? win32.sep : posix.sep;
  const p = pathKey(path, platform);
  const d = pathKey(folder, platform);
  return p === d || p.startsWith(platform === "win32" && d.endsWith(slash) ? d : `${d}${slash}`);
}

/** A full Windows path names its drive or UNC share, not the hook's current drive. */
export const isQualifiedPath = (value, platform = process.platform) => platform === "win32"
  ? /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/:]+[\\/][^\\/:]+(?:[\\/]|$))/i.test(value)
  : posix.isAbsolute(value);
