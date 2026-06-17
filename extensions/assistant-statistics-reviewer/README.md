# Statistics Reviewer

Turns the assistant into a quantitative-methods reviewer that scrutinizes claims, study design, assumptions, uncertainty, effect size, and reproducibility.

## What it does

Statistics Reviewer changes how the assistant behaves so it acts like a careful statistical reviewer rather than a general chat assistant. Instead of accepting numbers at face value, it checks the question behind the analysis, the study design, the data and measurement, and the way results are interpreted. It treats missing data, multiplicity, confounding, leakage, overfitting, and subgroup fishing as first-class risks, and it resists reducing evidence to a single p-value or metric. The result is a structured review that separates confirmed issues from likely risks and open questions, so you can tell whether a conclusion actually holds.

## Where it shows up

Selectable as the assistant's behavior for a chat. Choose "Statistics Reviewer" as the assistant mode, then ask your question in that chat.

## How to use it

1. Set the assistant's behavior for a chat to "Statistics Reviewer."
2. Paste or describe the work you want reviewed: a paper, an experiment, an A/B test, a dashboard metric, a regression, or a predictive model.
3. Ask for a review. The assistant responds with a structured critique tailored to the kind of work, for example:
   - "Review this A/B test writeup. Does the conclusion hold?"
   - "Here is our churn model's validation report. What would you check before we ship it?"
   - "This survey claims 62% support. What biases should I worry about?"

The reviewer adapts its output shape to the work: study reviews, A/B tests, model reviews, and dashboard claims each get their own section layout. When a calculation would help, it first checks whether the chat can actually run computation. If it cannot, it gives a precise analysis plan and asks for the outputs it needs rather than inventing results.

## Permissions

- `agent.behavior`: required so the extension can set how the assistant responds for the chat.

## How it's built

This is an agent-harness extension. It contributes a single `agentHarnesses` entry (`statistics_reviewer`, command `statistics-reviewer.render`) in `manifest.json` and implements `activate(msty)` in `extension.js`, returning a `run(command, input)` handler that produces a `systemPrompt` plus review `metadata`.

The prompt is assembled in `buildPrompt`, which concatenates three parts:

- `HARNESS_PROMPT`: a static, fully specified reviewer brief covering authority and analysis boundaries, reviewer stance, an 8-step operating loop, per-design method checklists, response contracts, and refusal boundaries (no p-hacking, no fabricated data, no unsupported causal claims).
- `availabilitySection`: reads `input.availability.shell` and `input.availability.web.search` from the host so the prompt states whether shell computation and web search are actually available. This is the "computation-aware" pattern: the harness never implies it ran checks the host cannot perform, and falls back to a reproducible analysis plan when computation is unavailable.
- `hostContextSection`: preserves host-provided context (user, project, and working-style instructions, workspace path, working brief, compaction summary, attached memory packs, and loaded skills) so the harness composes with the rest of the app instead of overriding it.

Input is read defensively through a `get(value, path, fallback)` helper plus `stringValue` / `objectValue` / `arrayText` / `isRecord` guards, so a missing or malformed `input` field degrades gracefully instead of throwing. Memory packs and skills are capped (4 packs, 6 skills) to keep the prompt bounded. The `run` handler returns `undefined` for any command other than `statistics-reviewer.render`, and `dispose()` is a no-op since the extension holds no resources.

The harness draws on established reporting and methods guidance, including the American Statistical Association statement on p-values (https://www.amstat.org/asa/files/pdfs/P-ValueStatement.pdf), the EQUATOR Network, CONSORT/SPIRIT, and STROBE, which are also surfaced in the review `metadata.references`.
