import assert from "node:assert/strict";
import { test } from "node:test";
import { luhn, redact, redactDeep } from "../src/redact.mjs";

const hidden = (text, secret) => {
  const out = redact(text);
  assert.ok(!out.includes(secret), `leaked ${secret} in: ${out}`);
  return out;
};

/** Fake credentials, split in two so secret scanners don't mistake the test data for leaked keys. */
const fake = (prefix, rest) => prefix + rest;

test("private keys: SSH, PEM, PGP, and a block a clip cut short", () => {
  const ssh = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH PRIVATE KEY-----";
  assert.equal(redact(`cat id_ed25519\n${ssh}\ndone`), "cat id_ed25519\n[redacted openssh private key]\ndone");
  hidden("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo\n-----END RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo");
  hidden("-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC", "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");
  hidden("-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF0xyz\n-----END PGP PRIVATE KEY BLOCK-----", "lQOYBF0xyz");
  assert.match(redact("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMq user@mac"), /AAAAC3NzaC1lZDI1NTE5AAAAIOMq/, "a public key is not a secret");
});

test("card numbers: grouped or not, only when the Luhn check passes, with their security codes", () => {
  assert.ok(luhn("4242424242424242"));
  assert.ok(!luhn("4242424242424241"));
  hidden("charge 4242 4242 4242 4242 exp 12/28", "4242 4242 4242 4242");
  hidden("card=5555-5555-5555-4444", "5555-5555-5555-4444");
  hidden("amex 378282246310005", "378282246310005");
  hidden('{"number":"4000056655665556","cvc":"123"}', "4000056655665556");
  hidden("cvv: 737", "737");
  assert.match(redact("order 1234567890123 shipped"), /1234567890123/, "a number that fails the check stays");
  assert.match(redact("version 1.2.3 build 20260927"), /20260927/);
});

test("passwords: assignments, JSON, env files, flags, URLs, curl, headers", () => {
  hidden("DB_PASSWORD=hunter22 npm start", "hunter22");
  hidden("export PGPASSWORD='s3cr3t!x'", "s3cr3t!x");
  hidden('{"password": "correct horse"}', "correct");
  hidden('{"user":"a","password":"Tr0ub4dor&3"}', "Tr0ub4dor");
  const stripe = fake("sk_", "live_51HxYzABCDEFGHIJKLMNOP");
  hidden(`STRIPE_SECRET_KEY=${stripe}`, stripe);
  hidden("mysql --password=rootpass123 -u root", "rootpass123");
  hidden("psql --password hunter22", "hunter22");
  hidden("sshpass -p 'hunter22' ssh me@host", "hunter22");
  hidden("git clone https://nish:ghpass123@github.com/x/y", "ghpass123");
  hidden("curl -u admin:letmein https://api.example.com", "letmein");
  hidden('curl -H "Authorization: Basic YWRtaW46bGV0bWVpbg==" https://x', "YWRtaW46bGV0bWVpbg");
  hidden("curl -H 'Cookie: session=abc123def456' https://x", "abc123def456");
  hidden("https://api.example.com/v1?api_key=abcd1234efgh&x=1", "abcd1234efgh");
  hidden("clientSecret: 'q8x7c6v5b4n3'", "q8x7c6v5b4n3");
  assert.equal(redact("DB_PASSWORD=hunter22"), "DB_PASSWORD=[redacted]", "the name stays so Jev can read the command");
});

test("secrets as quoted phrases, separate arguments, piped logins, connection strings, and signed URLs", () => {
  const v = fake("FAKEq7Lm2Zp9", "Xw4Rt8Yv3Nb6Kc1");
  assert.equal(redact(`export DB_PASSWORD="correct horse battery staple"`), 'export DB_PASSWORD="[redacted]"', "every word of a quoted password");
  hidden(`aws configure set aws_secret_access_key ${v}`, v);
  // Quoted values are masked whole, in every form that takes a secret as its own argument.
  for (const cmd of [`aws configure set aws_secret_access_key "correct horse ${v}"`, `gh secret set FOO --body 'correct horse ${v}'`, `printf '%s' "correct horse ${v}" | gh auth login --with-token`, `mysql --password "correct horse ${v}"`, `sshpass -p 'correct horse ${v}' ssh host`]) {
    const out = hidden(cmd, "horse");
    assert.ok(!out.includes(v), out);
  }
  hidden(`npm config set //registry.npmjs.org/:_authToken ${v}`, v);
  hidden(`gh secret set STRIPE_KEY --body ${v}`, v);
  hidden(`echo ${v} | gh auth login --with-token`, v);
  hidden(`printf '%s' ${v} | docker login -u me --password-stdin ghcr.io`, v);
  hidden(`DefaultEndpointsProtocol=https;AccountName=ex;AccountKey=${v}+/==;EndpointSuffix=core.windows.net`, v);
  hidden(`curl 'https://acct.blob.core.windows.net/c/f?sv=2024-01-01&sig=${v}%2B'`, v);
  // Names that continue past the secret word are still secrets.
  for (const name of ["SECRET_KEY_BASE", "DB_PASSWORD_FILE", "GITHUB_TOKEN_2"]) hidden(`${name}=${v}`, v);
  assert.equal(redact("aws configure set region us-east-1"), "aws configure set region us-east-1");
});

test("provider tokens", () => {
  for (const t of [
    fake("sk", "-ant-api03-abcdefghijklmnopqrstuvwx"),
    fake("sk", "-proj-abcdefghijklmnopqrstuvwx"),
    fake("rk", "_test_abcdefghijklmnopqrstuv"),
    fake("gh", "p_abcdefghijklmnopqrstuvwxyz0123"),
    fake("git", "hub_pat_11ABCDEFG0123456789_abcdefghij"),
    fake("gl", "pat-abcdefghijklmnopqrst"),
    fake("AK", "IAIOSFODNN7EXAMPLE"),
    fake("AI", "zaSyA1234567890abcdefghijklmnopqrstu"),
    fake("xo", "xb-123456789012-abcdefghij"),
    fake("SG", ".abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"),
    fake("np", "m_abcdefghijklmnopqrstuvwxyz0123456789"),
    "apikey_ABCDEFGHIJKLMNOPQRST",
    fake("ey", "JhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"),
    fake("https://hooks.", "slack.com/services/T000/B000/XXXXXXXX"),
  ]) hidden(`use ${t} now`, t);
  hidden("Bearer abcdefghijklmnopqrstuvwxyz", "abcdefghijklmnopqrstuvwxyz");
});

test("what is not a secret survives, so Jev can still read the work", () => {
  // Design tokens hold colors and lengths, and the slop checks must read them.
  for (const css of ["--token-color: #abcdef;", "--token-radius: 8px;", "--token-accent: var(--brand);", "--token-ink: oklch(0.2 0.02 250);", "--token-accent: red;", ":root { --brand-token: rebeccapurple; }"]) assert.equal(redact(css), css);
  // The same words outside a custom property are still secrets.
  assert.equal(redact("token: abc123def"), "token: [redacted]");
  assert.equal(redact("--db-password=abc123def"), "--db-password=[redacted]");
  const keep = [
    "type Login = { email: string; password: string }",
    "const token = process.env.API_TOKEN",
    "password: ${{ secrets.DB_PASSWORD }}",
    "<input type=\"password\" name=\"password\">",
    "items.map((m) => <li key={m.id}>{m.name}</li>)",
    "git push origin main && npm test",
    "rg -n 'password' src",
    "author: Jane Doe",
  ];
  for (const k of keep) assert.equal(redact(k), k);
});

test("redactDeep masks strings anywhere in a state", () => {
  const out = redactDeep({ request: "my card is 4242424242424242", evidence: { commands: ["export API_KEY=abc123xyz789"] }, n: 3 });
  assert.equal(out.request, "my card is [redacted card number]");
  assert.equal(out.evidence.commands[0], "export API_KEY=[redacted]");
  assert.equal(out.n, 3);
});

test("binary content: data URIs and long base64 become a type and a size, never bytes", () => {
  const png = "iVBORw0KGgo" + "A".repeat(2000);
  const out = redact(`<img src="data:image/png;base64,${png}"> and a favicon`);
  assert.equal(out, '<img src="[image/png file, 1 KB, omitted]"> and a favicon');
  const blob = "QUJD".repeat(300);
  assert.equal(redact(`upload({ data: "${blob}" })`), 'upload({ data: "[binary data, 1 KB, omitted]" })');
  assert.match(redact("data:image/svg+xml,%3Csvg%3E"), /%3Csvg/, "a non-base64 SVG URI is text and stays");
  assert.match(redact("const shortId = 'aGVsbG8gd29ybGQ='"), /aGVsbG8/, "a short base64 value stays");
});
