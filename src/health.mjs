import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redact } from "./redact.mjs";
import { ensureDir, jevisHome } from "./state.mjs";

export const FAILURE_WINDOW = 10 * 60_000;
export const FAILURE_STREAK = 3;

/** Error payloads are often objects, not strings. Mask before bounding. */
export function errorMessage(value, fallback = "unknown error") {
  let message;
  if (typeof value === "string") message = value;
  else if (value && typeof value === "object") {
    const preferred = value.error?.message ?? value.message ?? value.error?.code ?? value.code ?? value.detail ?? value.error;
    if (preferred !== undefined && preferred !== value) return errorMessage(preferred, fallback);
    try { message = JSON.stringify(value); } catch { message = fallback; }
  } else if (value != null) message = String(value);
  return redact(message || fallback).replace(/\s+/g, " ").replaceAll("[object Object]", "unknown error").slice(0, 200);
}

/** Works for new errors and historical log strings (including old 402s). */
export function errorClass(error) {
  const message = errorMessage(error);
  const status = Number(error?.status ?? message.match(/HTTP\s+(\d{3})/i)?.[1]);
  if ([401, 402, 403].includes(status)) return "auth/billing";
  if (status === 429) return "rate-limit";
  if (status >= 500 && status < 600) return "server";
  if (error?.name === "TimeoutError" || /timeout|timed out|ETIMEDOUT/i.test(message)) return "timeout";
  if (/fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|socket|ENETUNREACH/i.test(message)) return "network";
  return "other";
}

const healthFile = () => join(jevisHome(), "jev-health.json");
export function recentHealth() {
  try { return JSON.parse(readFileSync(healthFile(), "utf8")); } catch { return null; }
}

/** One tiny, atomic, best-effort file. Off/unconfigured calls never start an outage. */
export function recordHealth(error, { now = Date.now() } = {}) {
  let tmp;
  try {
    const before = recentHealth();
    const continuing = before?.count > 0 && now >= before.lastAt && now - before.lastAt <= FAILURE_WINDOW;
    const next = error ? {
      since: continuing ? before.since : now, lastAt: now,
      count: continuing ? before.count + 1 : 1,
      classes: { ...(continuing ? before.classes : {}), [errorClass(error)]: (continuing ? before.classes?.[errorClass(error)] ?? 0 : 0) + 1 },
      class: errorClass(error), status: Number(errorMessage(error).match(/HTTP\s+(\d{3})/)?.[1]) || null,
    } : { count: 0, lastAt: now };
    ensureDir();
    tmp = `${healthFile()}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    renameSync(tmp, healthFile());
  } catch {
    if (tmp) try { unlinkSync(tmp); } catch { /* best effort */ }
  }
}

export function outageLine({ now = Date.now() } = {}) {
  if (process.env.JEVIS_MODE === "shadow" || process.env.JEVIS_JEV === "off") return null;
  const health = recentHealth();
  if (!(health?.count >= FAILURE_STREAK) || !Number.isFinite(health.since) || !Number.isFinite(health.lastAt) || now < health.lastAt || now - health.lastAt > FAILURE_WINDOW) return null;
  return "Jevis is unavailable right now.";
}
