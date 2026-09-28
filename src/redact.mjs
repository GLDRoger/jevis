/**
 * Privacy: secrets are masked before anything leaves this machine (Jev, the
 * critic) or lands on disk (the call record, the decision log).
 *
 * Covered: private keys (SSH, PEM, PGP), payment card numbers (Luhn-checked)
 * and their security codes, passwords in assignments, JSON, flags, URLs, and
 * HTTP headers, and the token formats of common providers. A masked value
 * keeps its name ("DB_PASSWORD=[redacted]") so Jev can still tell what the
 * command does.
 *
 * Binary content (data: URIs, long base64 runs) is replaced by its type and
 * size first: Jev reads text only.
 *
 * Masking errs toward hiding: a long id that passes the card check is lost,
 * which costs a little context and never a secret.
 */

const MASK = "[redacted]";

/** Luhn checksum: what separates a card number from any other 13-19 digit run. */
export function luhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double && (d *= 2) > 9) d -= 9;
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Values that name a type, a variable, or a placeholder rather than hold a secret. */
const PLACEHOLDER = /^(string|number|boolean|null|undefined|none|true|false|optional|required|secret|password|token|process\.env\.\w+|os\.environ.*|env\(.*|\$\{?[\w.]+\}?|\$?\{\{.*|<[^>]*>|\*+|x+|\.\.\.|…|\[redacted[^\]]*\])$/i;

/** Names whose value is a secret: password, pass, pwd, passphrase, secret, token, api key, access or private key, credentials, cvv. */
const SECRET_NAME = String.raw`[A-Za-z0-9_.-]*?(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|credentials?|cvv|cvc|csc|security[_-]?code)[A-Za-z0-9_.-]*`;

/** Binary content is replaced by what it is and how big: Jev reads text only, and base64 would only crowd out the words. */
const kb = (chars) => Math.max(1, Math.round((chars * 3) / 4 / 1024));
const BINARY = [
  [/data:([\w.+-]+\/[\w.+-]+)?((?:;[\w=.-]+)*);base64,([A-Za-z0-9+/=]{16,})/g, (_, mime, __, data) => `[${mime ?? "data"} file, ${kb(data.length)} KB, omitted]`],
  [/(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{400,}={0,2}(?![A-Za-z0-9+/=])/g, (m) => `[binary data, ${kb(m.length)} KB, omitted]`],
];

const RULES = [
  ...BINARY,
  // Whole private key blocks, including one a clip cut before its END line.
  [/-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY( BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g, (_, kind) => `[redacted ${kind.trim() ? `${kind.trim().toLowerCase()} ` : ""}private key]`],
  // HTTP credentials: everything after the header name, to the end of the line.
  [/\b(authorization|proxy-authorization|x-api-key|api-key|x-auth-token|cookie|set-cookie)(\s*:\s*)([^\n"'\\]+)/gi, (_, name, sep) => `${name}${sep}${MASK}`],
  // user:password in URLs, and curl's -u / --user.
  [/(?<=:\/\/[^\s:/@]+:)[^\s@/]+(?=@)/g, () => MASK],
  [/((?:^|\s)(?:-u|--user)\s+["']?[^\s:"']+:)([^\s"']+)/g, (_, head) => `${head}${MASK}`],
  // Password flags: --password x, --password=x, sshpass -p x.
  [/(--?(?:password|passwd|pass|pw|token|api-key|secret)(?:\s+|=))(["']?)([^\s"']+)\2/gi, (_, flag, q) => `${flag}${q}${MASK}${q}`],
  [/(\bsshpass\s+-p\s*)(["']?)([^\s"']+)\2/g, (_, flag, q) => `${flag}${q}${MASK}${q}`],
  // name = value, name: value, "name": "value", with the name anywhere in a longer identifier (DB_PASSWORD, stripeSecretKey).
  [new RegExp(String.raw`(["']?\b${SECRET_NAME}["']?)(\s*(?::|=|=>|:=)\s*)(["'\x60]?)([^\s"'\x60,;&}\)]{3,})`, "gi"), (m, name, sep, q, value) => (PLACEHOLDER.test(value) ? m : `${name}${sep}${q}${MASK}`)],
  // Provider token formats.
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, () => MASK],
  [/\b(?:sk|pk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9_-]{16,}/g, () => MASK],
  [/\bapikey_[A-Za-z0-9_]{16,}/g, () => MASK],
  [/\b(?:ghp|gho|ghs|ghu|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, () => MASK],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, () => MASK],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, () => MASK],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, () => MASK],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, () => MASK],
  [/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, () => MASK],
  [/\b(?:npm|hf|shpat|shpss|dop_v1|pypi-)_?[A-Za-z0-9_-]{30,}/g, () => MASK],
  [/https:\/\/(?:hooks\.slack\.com\/services|discord(?:app)?\.com\/api\/webhooks)\/[^\s"'<>]+/g, () => MASK],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, () => MASK],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, () => `Bearer ${MASK}`],
  [/\b[0-9a-f]{40,}\b/gi, () => MASK],
  // Card numbers: 13-19 digits, optionally grouped by spaces or dashes, that pass the Luhn check.
  [/(?<![\d.])\d(?:[ -]?\d){12,18}(?![\d.])/g, (m) => (luhn(m.replace(/[ -]/g, "")) ? "[redacted card number]" : m)],
];

export function redact(text) {
  let out = String(text ?? "");
  for (const [re, fn] of RULES) out = out.replace(re, fn);
  return out;
}

export const redactDeep = (value) =>
  typeof value === "string" ? redact(value) : Array.isArray(value) ? value.map(redactDeep) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)])) : value;
