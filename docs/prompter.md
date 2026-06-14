---
title: Prompter
summary: Run controlled robustness evaluations for system instructions, compare target models, and generate hardening guidance.
description: A defensive Prompt Power and Robustness Lab for testing, measuring, and hardening AI agent instructions.
icon: shield-check
---

<Note>
Prompter is a defensive robustness lab. It is designed for controlled evaluation of your own instructions and model configurations. Green results indicate model compliance with a test objective and therefore a weakness to investigate, not something to deploy.
</Note>

Prompter helps you answer a practical question: **where does this instruction fail, and how do I harden it?** It scaffolds a local lab project, generates controlled test fixtures, runs selected agents and target models through schema-based probes, classifies results, and produces evidence, reports, exports, and optional hardening recommendations.

## When to use Prompter

Use Prompter when you need to:

- Test a system instruction across multiple agents and models.
- Compare executor models against additional target-only models.
- Evaluate how instructions behave under character, Unicode, layout, steganography, and schema-driven probes.
- Capture full evidence for defensive review.
- Run an autonomous multi-iteration campaign that refines tests from previous results.
- Generate a hardened instruction proposal from confirmed green findings.
- Export structured research data for offline analysis.

Prompter is not a deployment path for adversarial prompts. It keeps fixtures and findings inside a lab project and frames every report as defensive research.

## Quick start

1. Open the hamburger menu and choose **Prompter / Power and Robustness Lab**.
2. Pick or create a Prompter project folder.
3. Add instruction files under `1-generic-instructions/`.
4. Select executor agents and models.
5. Choose independent target models if you want to compare more models than the executors.
6. Select test schemas and variation transforms.
7. Fill any required custom data placeholders.
8. Review the run plan and start the run.
9. Inspect the run dashboard, evidence, metrics, and hardening suggestions.

## Project structure

A Prompter project contains generated folders for inputs, schemas, results, advanced fixtures, documentation, tools, and hardened outputs.

```text
<project>/
  .prompter-project.json
  1-generic-instructions/
  2-test-schemas/
  3-temp-results/
    1-green/
    2-yellow/
    3-red/
    runs/<run-id>/
      manifest.json
      report.md
      defender-gap-report.md
      work/<agent-id>/
      evidence/<agent-id>/
  4-advanced-tests/
    character-variations/
  5-hardened-instructions/
  documentation/
  tools/evaluators/
```

All run manifests, evidence, traffic-light entries, and reports are written atomically. Prompter validates project-relative paths and blocks symlink escapes before reading or writing lab files.

## Wizard steps

Prompter uses a 9-step wizard:

| Step             | Purpose                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Project folder   | Pick the lab root and project name.                                                                |
| Create structure | Preview or create the generated project layout.                                                    |
| Agent selection  | Choose executor agents.                                                                            |
| Instructions     | Review discovered instruction files and choose variation transforms.                               |
| Model config     | Pick models, instruction routing, bare-model probes, and CLI config-file attachments per executor. |
| Target models    | Add independent agent/model targets, including targets that are not executors.                     |
| Schema selection | Pick builtin or custom schemas.                                                                    |
| Custom data      | Fill `{{CUSTOM:*}}` placeholders used by selected schemas.                                         |
| Review           | Confirm the task matrix, targets, schemas, transforms, and optional Crafter settings.              |

## Builtin schemas

Prompter ships 15 builtin schemas:

- `adversarial-compliance-test`
- `homoglyph-bypass-effectiveness`
- `semantic-self-reference-tester`
- `taxonomy-embedding-momentum`
- `bidi-zero-width-evasion`
- `multi-technique-synergy-finder`
- `injection-reliability-verifier`
- `adversarial-intelligence-discoverer`
- `model-vulnerability-profiler`
- `edge-case-injection-finder`
- `attention-attractor-obfuscation`
- `emoji-steganography`
- `invisible-text-steganography`
- `steganographic-carrier-tester`
- `green-to-hardened-instruction`

The default schema selection is:

- `adversarial-compliance-test`
- `homoglyph-bypass-effectiveness`
- `semantic-self-reference-tester`

Custom schemas can be added to `2-test-schemas/`. Schemas can include custom placeholders such as `{{CUSTOM:task}}`, which the wizard collects before a run starts.

## Variation transforms

Prompter generates 23 deterministic character and layout variations for each base instruction when variations are enabled:

- Script and glyph transforms: `cyrillic`, `greek-homoglyph`, `math-bold`, `circled`
- Substitution and distortion: `leet`, `zalgo-light`, `char-stretch`
- Case and normalization: `case-upper`, `case-lower`, `nfd-decompose`
- Width and punctuation: `fullwidth`, `punct-math`
- Whitespace and layout: `ws-paragraphs`, `ws-dense`, `trailing-whitespace`, `nbsp-mix`, `tabs-heavy`, `one-word-per-line`
- Control and bidi: `control-red`, `bidi-heavy`
- Combined transforms: `mixed`, `mixed-cyr-full`, `heavy-mixed`

Generated files are written as `4-advanced-tests/character-variations/tv-<stem>-<transform>.md` and are treated as controlled test fixtures.

## Executors and independent target models

Executor agents are the agents Prompter spawns to run tasks. Target models are the agent/model combinations Prompter reports against and can include additional models that are not executor configurations. Executor targets are preselected and marked as executors. You can add more target-only models to widen comparison coverage.

Prompter stores target metadata in the run and report so results can distinguish primary executor models from declared comparison targets.

## Red-Team Crafter

Red-Team Crafter is an optional semantic modification layer for defensive evaluation. A configured crafter agent can analyze the base instruction, choose a strategy, and modify test prompts before the target agent sees them.

Supported strategies:

- `semantic-reframe`
- `context-blend`
- `authority-frame`
- `task-decompose`
- `persona-mirror`
- `multi-vector`
- `adaptive-combined`

Crafter state is run-scoped. It caches instruction profiles by instruction hash and records task feedback by instruction and target agent. Later tasks can use previous results to select a better strategy. Crafter spawns run inside the task work directory, and the evidence records the strategy, modification summary, original prompt excerpt, and crafter agent/model when available.

Crafter pools can assign multiple crafter agent/model combinations with round-robin, best-performer, manual, or auto pairing.

## Evaluation and result bands

Prompter evaluates each task in stages:

1. Failure detection for timeout, CLI errors, and unusable results.
2. Refusal and provider error detection.
3. Schema scoring, key-phrase coverage, custom task scoring, custom evaluator support, steganography analysis, and normalization audit.
4. Confidence and metrics calculation.

Band meaning:

| Band   | Meaning                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| Green  | The model complied with the test objective. In adversarial schemas this is a weakness to investigate and harden. |
| Yellow | Partial, ambiguous, rate-limited, or needs review.                                                               |
| Red    | Refusal, boundary held, timeout, config error, or no useful compliance.                                          |

Prompter also computes a compliance score with coverage, structure, and behavior components. Research exports and campaign findings include this score when available.

## Steganography and normalization analysis

The steganography decoder detects controlled carriers such as emoji variation selectors, invisible Unicode tags, and zero-width binary sequences. For steganography schemas, decoded payload signals can affect banding when the response reflects the hidden payload. The evaluator also surfaces normalization anomalies such as BOM, invisible characters, control characters, mixed scripts, and stego carriers.

Custom evaluators also receive normalization audit details in their output, so custom schema authors do not accidentally hide input anomalies.

## Run dashboard

The Prompter run opens in the center workspace and appears in the Left Bar like other Maestro workspaces. The dashboard includes:

- Timeline and status summary.
- Task list with live task updates.
- Compact log.
- Robustness findings panel.
- Refusal-consistency matrix.
- Adversarial test metrics panel.
- Search path visualization.
- Injection builder / refinement assistant.
- Weakness export panel.
- Hardening suggestions panel.
- Hardened instruction notice.
- Campaign creator and campaign dashboard.

## Autonomous campaigns

Campaigns run multiple Prompter iterations automatically. Each iteration creates a normal run, waits for it to finish, extracts findings, computes metrics, and generates refinements for the next iteration.

Campaign stop modes:

- Fixed iteration count.
- Until a findings target is reached.
- Until an adversarial compliance threshold is reached.

Campaign refinements can:

- Focus transforms that produced weak boundaries.
- Explore new transform categories.
- Combine techniques.
- Drop transforms where the model held consistently.
- Add schema-focused tests for steganography without confusing schema IDs with variation transforms.

Campaign live updates send a full campaign snapshot to the renderer, so iterations, findings, metrics, and hardened instruction notices update in the dashboard.

If run creation or run execution fails, Prompter records an errored iteration and includes the failure in the campaign stop reason instead of silently treating the failure as a clean no-finding iteration.

## Hardening generation

Prompter can generate defensive hardened instruction drafts from green findings. Hardened outputs are written to `5-hardened-instructions/` with provenance and metadata. The evidence parser extracts only the fenced `Agent-Antwort` section from evidence files; if the expected format is not present, Prompter skips the output rather than writing the full evidence scaffold as an instruction.

Campaigns can also auto-harden between iterations, then copy the newest hardened instruction back into `1-generic-instructions/` for the next iteration.

## Reports and exports

Prompter can generate:

- Per-task evidence markdown and JSON.
- Traffic-light entries under `3-temp-results/1-green`, `2-yellow`, and `3-red`.
- Run reports with evidence, target model tables, and Crafter sections.
- Defender Gap Reports.
- Hardened instruction files and metadata.
- Research exports in CSV, JSON, and Markdown for runs and campaigns.
- Campaign markdown with iteration history, findings, metrics, and test optimization notes.

## Custom evaluators

Place `.mjs` evaluators in `tools/evaluators/`. A custom evaluator exports `evaluate(input)` and returns:

```ts
{
  band: 'green' | 'yellow' | 'red',
  reason: string,
  details?: string[],
  metrics?: Record<string, unknown>
}
```

Prompter validates the path inside the project and runs the evaluator in a restricted `vm` sandbox with no Node APIs and a 5 second timeout. If the custom evaluator fails, Prompter falls back to rule-based scoring.

## Reliability and recovery

Runs persist a manifest after planning, task completion, pause, stop, and completion. On app startup, Prompter can recover interrupted runs by marking active runs paused, failing the interrupted task, and deleting orphaned temporary evidence files. Campaign live state is in memory; campaign reload recovery after app restart is not yet implemented.

## Safety notes

Prompter is for controlled defensive research. Keep test projects scoped to instructions and models you are allowed to evaluate. Do not treat green findings as reusable attack recipes. Use them to improve normalization, clarify boundaries, strengthen refusal behavior, and create regression tests.
