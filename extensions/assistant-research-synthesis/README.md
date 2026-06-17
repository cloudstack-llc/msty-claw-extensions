# Systematic Research Synthesizer

Turns the assistant into a transparent research synthesizer that converts messy source material into clear, evidence-grounded conclusions.

## What it does

This extension gives the assistant a complete research-methods behavior for evidence mapping, literature synthesis, and source-grounded analysis. It pushes the assistant to start from a sharp question, make its source-selection logic visible, appraise quality and bias, preserve disagreement instead of papering over it, and state confidence proportional to the evidence. It is useful for literature reviews, policy scans, customer-research synthesis, and evidence maps. A built-in guardrail keeps the assistant from claiming a full systematic review unless the search, screening, extraction, appraisal, and synthesis steps were actually performed.

## Where it shows up

Selectable as the assistant's behavior for a chat, listed as "Systematic Research Synthesizer." Once chosen, it shapes how the assistant responds for that chat.

## How to use it

1. Pick "Systematic Research Synthesizer" as the assistant behavior for a chat.
2. Describe your research question and paste or attach the sources you have.
3. Ask for the output you need, for example "Give me an evidence map of these eight papers," "Compare what these sources say about X and flag quality concerns," or "Draft a systematic review protocol for this question."

The assistant works through a defined loop: define the question, check what source access is available, set inclusion and exclusion criteria, extract findings consistently, appraise quality, synthesize claim by claim, and finish with explicit confidence, caveats, and next searches. If web search or browsing is not available in your setup, it tells you the result is a source-limited synthesis or a research plan rather than a completed literature search.

## Permissions

- `agent.behavior`: needed so the extension can supply the assistant's research-synthesis behavior for a chat.

## How it's built

The extension contributes a single `agentHarnesses` entry (`research_synthesis`) whose `command` (`research-synthesis.render`) is handled by the `run(command, input)` method returned from `activate(msty)` in `extension.js`. It requires no network and no other host capabilities.

On each turn the harness returns a `systemPrompt` assembled by `buildPrompt(input)`, which concatenates three parts:

- A static `HARNESS_PROMPT` covering authority and evidence boundaries, research stance, the operating loop, a synthesis methods menu, an appraisal checklist, response contracts, and refusal boundaries.
- An `availabilitySection(input)` that reads `availability.web.search` and `availability.web.browse` from the host input and instructs the assistant to use only host-available capabilities, falling back to a source-limited synthesis or research plan when source gathering is not available.
- A `hostContextSection(input)` that preserves user, project, and working-style instructions, workspace path, working brief, compaction summary, attached memory packs, and loaded skills.

Notable patterns for developers studying the source:

- Defensive input access via a small `get(value, path, fallback)` helper plus `isRecord`, `objectValue`, `arrayText`, and `stringValue`, so missing or malformed host context never throws and absent fields are simply omitted from the prompt.
- Memory packs and skills are bounded (`slice(0, 4)`, `slice(0, 3)`, `slice(0, 6)`) to keep injected context compact.
- The `run` result also returns `metadata` with the example id, research `references`, and an `availabilityMetadata(input)` snapshot of the web capability flags.
- The behavior is prompt-only. It grants no search, browse, file, or citation access on its own; all source access is still governed by what the host reports as available.

Research basis:

- PRISMA 2020 statement and checklist: https://www.prisma-statement.org/prisma-2020
- GRADE certainty and evidence-to-decision methods: https://www.gradeworkinggroup.org/
- EQUATOR Network reporting guidelines: https://www.equator-network.org/
