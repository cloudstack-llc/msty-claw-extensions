# Bug Triage Playbook

A runnable workflow that turns a vague bug report into a reliable repro, a severity, root-cause hypotheses, and the smallest safe fix.

## What it does

Bug reports often arrive vague: "it's broken on mobile sometimes." This playbook gives you a structured path from that report to a verified fix. It walks the assistant through reproducing the issue, isolating it to the smallest failing case, ranking likely root causes, proposing the minimal change, and defining a check that proves the fix holds. The built-in guardrails keep the work honest: reproduce before theorizing, and fix the root cause rather than the symptom.

## Where it shows up

Available as a runnable playbook named Bug Triage in your Playbooks. When you start it, it asks for a bug summary (required), and optionally steps to reproduce and the environment (browser, OS, version, build).

## How to use it

1. Open your Playbooks and start Bug Triage.
2. Fill in the bug summary, for example "Sign-in button does nothing on Safari." Add steps to reproduce and the environment if you have them.
3. The assistant then works through five steps: Reproduce, Isolate, Hypotheses, Smallest fix, and Verify.
4. Before any change to shared code, it pauses to confirm the smallest fix with you.

You're done when there's a reliable repro, the root cause is identified (not just the symptom), and a verification step is defined.

## Permissions

- `playbooks.provide`: adds the Bug Triage playbook to your Playbooks.

## How it's built

A declarative, manifest-only extension with no entry script. It uses a single `playbooks` contribution under `contributes` in `manifest.json`, gated by the `playbooks.provide` permission.

The playbook's behavior lives entirely in its `manifest` object:

- `inputs` define the form the user fills in (`summary` required; `repro` and `environment` optional), each with a label, type, description, and placeholder.
- `steps` define the ordered workflow the assistant follows (Reproduce, Isolate, Hypotheses, Smallest fix, Verify), each a `title` plus `detail`.
- `guardrails` and `approvals` constrain the run: guardrails enforce reproduce-before-theorize and minimal root-cause fixes; the approval requires confirming the smallest fix before touching shared code.
- `intentSummary`, `whenToUse`, `successCriteria`, and `examples` give the runtime the context to present and complete the playbook.

The contribution sets `scope: "personal"`, so the playbook is added to the current user's Playbooks rather than shared across a workspace.
