import { readFileSync } from "node:fs";

// No shipped code predicate describes Stop state. Inject only the evaluator's
// fired list, keeping the real hook's evidence, budgets, persistence and output.
// Import a private module instance so ordinary hook tests still use the engine.
let fired = [];
export const stopEvaluations = [];
export function setStopFired(entries) {
  fired = entries;
  stopEvaluations.length = 0;
}
export async function evaluateStop(args) {
  stopEvaluations.push(args);
  return { fired, profile: {}, scores: Object.fromEntries(fired.map((e) => [e.id, 1])), ms: 0 };
}
const hooks = new URL("../../src/hooks.mjs", import.meta.url);
const source = readFileSync(hooks, "utf8").replace(/from "(\.\/[^"\n]+)"/g, (_, path) =>
  path === "./engine.mjs"
    ? `from ${JSON.stringify(import.meta.url)}`
    : `from ${JSON.stringify(new URL(path, hooks).href)}`
).replace('import { evaluate }', 'import { evaluateStop as evaluate }');
// Avoid an import cycle: evaluateStop is initialized before hooks calls it.
export const stopHooks = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
