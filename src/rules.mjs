/** Closed, code-owned predicates: true/false is exact; null needs Jev.
 * Never execute input or decide permission. Unproven inputs and rule errors
 * go to Jev; a Jev failure still lets the agent carry on.
 */
export const RULES = ["claim_contradicted"];
export function codeDecision(name, state) {
  try {
    if (!RULES.includes(name)) return null;
    return predicates[name](state);
  } catch {
    return null;
  }
}

/**
 * Stop: the final message says checks pass while a check run after the last
 * edit failed by its recorded exit code. Code only, never the model: the
 * model-judged version blocked harmfully 34 times in a month of real use.
 * Precision over recall: a line that also mentions failure, an exception, or
 * a negation is not a pass claim, and a check whose latest run passed or has
 * no recorded result proves nothing.
 */
const PASS_CLAIM = /\b(?:tests?|test suite|suite|specs?|checks?|build|lint|typecheck|type[- ]check|tsc|ci|gates?)\b[^\n.;]{0,60}?\b(?:pass(?:es|ed|ing)?|green|clean|succeed(?:s|ed)?)\b/i;
const NOT_A_CLAIM = /\b(?:fail\w*|not|never|except|but|broken|errors?|red|skipp\w*|flak\w*|unverified|didn'?t|doesn'?t|won'?t|can'?t|couldn'?t)\b|n't\b|^\s*>/i;
function claimContradicted(state) {
  const claims = String(state.final_message ?? "").split("\n").some((line) => PASS_CLAIM.test(line) && !NOT_A_CLAIM.test(line));
  if (!claims) return false;
  const latest = new Map();
  for (const c of state.evidence?.checks_after_last_edit ?? []) if (c?.command && c.success !== null && c.success !== undefined) latest.set(c.command, c.success);
  return [...latest.values()].some((ok) => ok === false);
}

const predicates = { claim_contradicted: claimContradicted };
