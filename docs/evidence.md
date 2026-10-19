# Evidence and model choice

## Evidence

The current tips haven't been through a controlled evaluation yet. The numbers below measured **Jevis v1**, which injected model-chosen notes on every message and had a model judge every turn ending. A month of real use didn't reproduce a net benefit for either, and both were retired. They're here for what they show about the design review and the cost of checking work.

On Sep 27–28 2026, 9 tasks (3 web pages, 6 engineering) ran bare and with Jevis, in both Codex (GPT-6 Sol) and Claude Code (Opus 5.5). A simulated user wrote follow-ups, a blind judge compared each pair, and hidden checks tested the result.

- **Where Jevis acted, it mostly won:** 20 wins, 6 losses, 1 tie across 27 pairs. Design pages went 10–2, engineering 10–4. Jevis caused no new hidden-check failures.
- **The judge is noisy:** in the 9 pairs where Jevis did nothing, it still picked one side 5–1.
- **It takes longer:** a median 1.56× the bare time, 2.2–2.6× on design. Almost none of that is Jevis (hook calls took about half a second each); it's the agent checking its work and fixing what the review sent back. `--critic off` removes most of it.
- **It narrows the gap between models, without closing it:** bare Codex lost to bare Claude Code 1–5; Codex with Jevis beat bare Claude Code 4–2.

The evaluation is small: one seed of most tasks and a model as the judge. There are no SWE-bench or Terminal-Bench numbers. The best test is your own work: run in shadow mode for a few days, then read `jevis stats`. To rerun the simulations: `node eval/sim.mjs`, then `node eval/sim-report.mjs <summary.json>`. [`docs/flow.html`](flow.html) walks through each hook.

## Which coding model to use

Jevis works with any model. The maintainer's ranking from daily use, as of 28 September 2026, best first:

| Model | Harness | Take |
|---|---|---|
| Claude Opus 5.5 | Claude Code | The best available, and cheaper than Fable 5.1 |
| GPT-6 Astra | Codex | Better than Sol, including at design, but slower and costlier |
| Claude Fable 5.1 | Claude Code | Strong, but Opus 5.5 is better and cheaper |
| GPT-6 Sol | Codex | Faster and cheaper than Astra, less capable |

Jevis made the biggest difference to GPT-6 Sol and GPT-6 Luna. Gemini models, including Gemini 3.8 Flash, aren't recommended: they tend to reread the same files and drift off the task.

<details>
<summary>The full tier list</summary>

| Tier | Models |
|---|---|
| SSS | Claude Opus 5.5 |
| SS | GPT-6 Astra |
| S | Claude Fable 5.1, GPT-6 Sol |
| A | Claude Opus 5, Claude Fable 5, GPT-5.6 Sol, Kimi K3, Grok 4.6, Qwen3.8 Max 0902, GLM-5.3, GPT-6 Luna, Muse Spark 1.3, DeepSeek V4.1 Flash, Hy-4 Preview, Grok 4.7 |
| B | GPT-5.6 Terra, Qwen3.8-Flash-Next, GLM-5.3 Flash, Claude Sonnet 5, K2 Horizon 375B A23B |
| C | GPT-5.6 Luna, Grok 4.5, Qwen3.8 27B, Muse Spark 1.2, MiMo V2.5 Pro, Hy-3, MiniMax-M3 |
| D | Thinking Machines Inkling, Nemotron 3 Ultra, Muse Glimmer |
| E | Claude Haiku 4.5, Mistral Medium 3.5, Nemotron 3.5 Lightning |
| Below E | Gemini 3.8 Flash, Gemini 3.7 Flash, Gemini 3.6 Flash, Gemini 3.5 Flash |

</details>
