<!-- Verified 2026-06-15 against feat/prompter. Covers 15 builtins, 23 transforms, 9-step wizard, executed independent targets (per-target instruction routing), Red-Team Crafter, autonomous campaigns, hardening, research export, stego decoder, the Left Bar Prompt Power Lab section, and run dashboard panels. Do not edit docs/releases.md for Prompter changes. -->

# Prompter (Prompt Power and Robustness Lab)

Prompter is Maestro's local defensive robustness lab for system instructions. It scaffolds a project, collects instruction files, generates controlled variation fixtures, runs selected agents and target models through schema-based tests, evaluates results, writes evidence, and produces hardening guidance.

Security framing: Prompter is for controlled defensive research. In adversarial schemas, **green means the model complied with the test objective and therefore exposed a weakness to harden**. Red usually means the model refused, held the boundary, timed out, or produced an unusable result. Do not document or present green findings as deployment recipes.

Public user documentation lives in `docs/prompter.md`. This file is the implementation guide for agents working in the codebase.

## Four-day implementation summary (2026-06-10 to 2026-06-14)

Major changes delivered in this window:

1. Initial Prompter foundation: shared types, project scaffolding, path safety, schema registry, generated project content, model discovery, config writer, evaluator, report writer, run manager, IPC, preload API, store, wizard, and run dashboard.
2. Defensive redesign: removed bypass/promotion framing, added schema selection, variation controls, defensive robustness panels, refusal consistency matrix, hardening suggestions, and Defender Gap Report export.
3. Execution improvements: instruction-first session execution, per-agent instruction selection, bare-model probes, per-agent CLI config-file slots, stable model picker, center workspace integration, crash recovery, rate-limit backoff, symlink-safe reads, and orphaned temp cleanup.
4. Advanced lab features: independent target models, Red-Team Crafter, multi-crafter pools, custom data placeholders, compliance scoring, reliability scoring, stego decoder, autonomous campaign manager, refinement engine, hardened instruction generator, research exports, weakness export panels, search path panels, injection builder, campaign dashboard, and hardened instruction notices.
5. Review fixes: Crafter feedback loop is run-scoped, profile cache persists across tasks, task-specific transforms are passed to Crafter, Crafter spawns in task work dirs, Evidence parser is shared, campaign live snapshots reach the dashboard, crafter provenance reaches findings, stego banding affects results, createRun failures become errored iterations, and custom evaluators get normalization audit details.

## Clarity and accuracy pass (2026-06-15)

A second pass tightened the wizard, evaluator, Left Bar, and target execution. Each larger change was reviewed by Codex (which caught a stemmer over-collapse, a stale run-history snapshot race, and a recovered-session gap):

1. Wizard clarity: removed the redundant dry-run toggle (the plan preview is always shown), clarified that selected agents are executors, moved the character-variation picker from the instructions step to the schema step, show per-agent instruction routing only when more than one instruction exists, and separated the auto-filled hardening placeholders (`base_instruction`, `green_findings`) from the real `task` input.
2. Target-models fix: the internal `terminal` agent (and hidden agents) no longer leak into the target list.
3. Evaluator red-accuracy: refusal patterns are now speech-acts only (bare topic words like "Sicherheit"/"dangerous" no longer count), with position + length gating, and coverage scoring is paraphrase/inflection tolerant via a light stemmer.
4. Left Bar: a single `PrompterLabSection` replaces the per-run sidebar entry and the inline campaign list, grouping Tests (run history), Kampagnen, and Logs (per-run evidence folder). Run history is kept live in the store and loaded from project folders on startup.
5. Executed independent targets (A1): target-only models are really tested with per-target instruction routing, deduped against executors; lane sessions are keyed by `model + instruction` and each task spawns with its own model.

## What it does

1. **Scaffold** a lab project with instructions, schemas, results, advanced fixtures, hardening output, docs, and evaluator tooling.
2. **Collect** every instruction under `1-generic-instructions/`, hash it, and optionally generate 23 deterministic character/layout variations under `4-advanced-tests/character-variations/`.
3. **Configure executors** with agent, model, instruction routing, optional bare-model mode, and CLI config-file attachments.
4. **Declare target models** independently from executors. Executor targets are preselected; additional target-only agent/model pairs are **really tested** (own tasks), each with its own instruction routing, for a true cross-model comparison.
5. **Select schemas** from 15 builtins plus custom schemas and fill `{{CUSTOM:*}}` placeholders. The character-variation picker lives in this step (it defines what is tested alongside the schemas).
6. **Run** the matrix in per-agent lanes with per `model + instruction` conversation continuity and rate-limit backoff.
7. **Optionally craft** modified test prompts through Red-Team Crafter with feedback-driven strategy selection.
8. **Evaluate** each result with failure, refusal, schema, compliance, stego, normalization, and optional custom-evaluator logic.
9. **Persist** evidence, ampel files, run reports, Defender Gap Reports, hardening output, research exports, and campaign state.
10. **Run campaigns** that iterate, refine, verify, harden, and export results.

## Architecture

```text
Renderer (React + Zustand)                 Main (Node)
+--------------------------------+         +-----------------------------------+
| HamburgerMenuContent           |         | ipc/handlers/prompter.ts          |
|   -> openModal('prompter')     |         |   33 handlers + events           |
| AppStandaloneModals            |  IPC    | PrompterProjectService           |
| PrompterWizard/* (9 steps)     | <-----> | PrompterSchemaRegistry           |
| PrompterRunPanel/*             |         | PrompterModelDiscovery           |
| prompterStore                  |         | PrompterAgentConfigWriter        |
| usePrompterListeners           |         | PrompterEvaluator                |
|                                |         | PrompterReportWriter             |
|                                |         | PrompterRunManager               |
|                                |         | RedTeamCrafter                   |
|                                |         | PrompterCampaignManager          |
|                                |         | prompter-refinement-engine       |
|                                |         | prompter-hardened-generator      |
|                                |         | prompter-research-export         |
+--------------------------------+         +-----------------------------------+
```

### Main dependency graph

```text
prompter-path-safety
prompter-fs
prompter-generated-content
        |
prompter-schema-registry
prompter-project-service
prompter-model-discovery
prompter-agent-config-writer
prompter-evaluator  -> shared/prompter-scoring, shared/prompter-stego-decoder
prompter-report-writer
prompter-red-team-crafter
prompter-run-manager
prompter-refinement-engine
prompter-campaign-manager
prompter-hardened-generator
prompter-research-export
prompter-defender-report
```

`src/shared/prompter-types.ts` is the dependency-free shared type surface used by main, preload, renderer, and tests.

## File map

| File                                                  | Responsibility                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/shared/prompter-types.ts`                        | Wizard, project, target, crafter, run, task, evaluation, campaign, export, and resume types.                             |
| `src/shared/prompter-robustness.ts`                   | Shared robustness metrics, findings, consistency matrix, hardening suggestions, adversarial metrics, optimization notes. |
| `src/shared/prompter-scoring.ts`                      | Compliance score, reliability score, technique clustering, predictive suggestions. Pure utilities.                       |
| `src/shared/prompter-stego-decoder.ts`                | Defensive decoder for controlled steganography carriers.                                                                 |
| `src/shared/prompter-task-presets.ts`                 | Shared task presets for Prompter UI and schemas.                                                                         |
| `src/main/prompter/prompter-path-safety.ts`           | Resolve and symlink-escape guards.                                                                                       |
| `src/main/prompter/prompter-fs.ts`                    | Hashing, atomic writes, directory creation, file walking.                                                                |
| `src/main/prompter/prompter-generated-content.ts`     | Generated project docs, templates, and guide strings.                                                                    |
| `src/main/prompter/prompter-schema-registry.ts`       | 15 builtin schemas, custom schemas, inheritance, placeholder substitution.                                               |
| `src/main/prompter/prompter-project-service.ts`       | Project planning, creation, deletion, scanning, importing, target persistence.                                           |
| `src/main/prompter/prompter-model-discovery.ts`       | Agent model discovery with timeout and cache.                                                                            |
| `src/main/prompter/prompter-agent-config-writer.ts`   | Provider envelopes and attached CLI config-file slots.                                                                   |
| `src/main/prompter/prompter-evaluator.ts`             | Failure/refusal/schema/custom/stego/normalization evaluation.                                                            |
| `src/main/prompter/prompter-report-writer.ts`         | Evidence, ampel entries, run report, Defender Gap Report write path, evidence response parser.                           |
| `src/main/prompter/prompter-variation-generator.ts`   | 23 deterministic transforms and `tv-<stem>-<transform>.md` fixtures.                                                     |
| `src/main/prompter/prompter-red-team-crafter.ts`      | Instruction profiling, prompt crafting, adaptive feedback, crafter pairing, learning export.                             |
| `src/main/prompter/prompter-run-manager.ts`           | Run lifecycle, task matrix, work dirs, session continuity, spawning, retries, persistence, recovery.                     |
| `src/main/prompter/prompter-campaign-manager.ts`      | Autonomous campaign loops, finding extraction, verification, hardening, learning persistence.                            |
| `src/main/prompter/prompter-refinement-engine.ts`     | Pure campaign refinement logic.                                                                                          |
| `src/main/prompter/prompter-hardened-generator.ts`    | Post-run hardened instruction generation from green findings.                                                            |
| `src/main/prompter/prompter-research-export.ts`       | CSV, JSON, Markdown exports for runs and campaigns.                                                                      |
| `src/main/prompter/prompter-defender-report.ts`       | Defender Gap Report generation.                                                                                          |
| `src/main/ipc/handlers/prompter.ts`                   | 33 IPC handlers and event forwarding.                                                                                    |
| `src/main/preload/prompter.ts`                        | `window.maestro.prompter` bridge.                                                                                        |
| `src/renderer/stores/prompterStore.ts`                | Wizard state, active run, run history, active campaign, logs, resume snapshots, event reducers.                          |
| `src/renderer/hooks/prompter/usePrompterListeners.ts` | IPC subscriptions and startup run recovery.                                                                              |
| `src/renderer/components/PrompterWizard/*`            | 9-step wizard.                                                                                                           |
| `src/renderer/components/PrompterRunPanel/*`          | Run dashboard, campaign UI, metrics, panels, controls, exports.                                                          |

## Project layout

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

Instruction scan excludes `GUIDE.md`, `README.md`, and `_`-prefixed files. Supported extensions are `.md`, `.txt`, `.json`, `.yaml`, and `.yml`.

## Wizard state

Canonical order in `PROMPTER_WIZARD_STEPS`:

1. `project-folder`
2. `create-structure`
3. `agent-selection`
4. `instructions`
5. `model-config`
6. `target-models`
7. `schema-selection`
8. `custom-data`
9. `review`

Do not hard-code step counts. Use `PROMPTER_WIZARD_STEPS` and `PrompterWizardStep`.

## Builtin schemas

There are 15 builtin schema IDs:

```text
adversarial-compliance-test
homoglyph-bypass-effectiveness
semantic-self-reference-tester
taxonomy-embedding-momentum
bidi-zero-width-evasion
multi-technique-synergy-finder
injection-reliability-verifier
adversarial-intelligence-discoverer
model-vulnerability-profiler
edge-case-injection-finder
attention-attractor-obfuscation
emoji-steganography
invisible-text-steganography
steganographic-carrier-tester
green-to-hardened-instruction
```

Defaults are `adversarial-compliance-test`, `homoglyph-bypass-effectiveness`, and `semantic-self-reference-tester`.

Add builtins in `prompter-schema-registry.ts`. Add custom schema support through files in `2-test-schemas/`; schema IDs remain strings because custom IDs are arbitrary.

## Variation transforms

`prompter-variation-generator.ts` exports 23 transform names. Generated file names are `tv-<stem>-<transform>.md`. `selectedTransforms` is stored on `PrompterRun` and must be used for task-specific transform context. Do not infer transforms globally by checking for `tv-` anywhere in the run. The variation picker is rendered in `SchemaSelectionStep` (it defines what is tested alongside the schemas), not in the instructions step.

## Executor agents, target models, and config files

`PrompterAgentConfig` configures executor agents. Each executor can select:

- `instructionFile: '*'` for all inputs.
- `instructionFile: '<path>'` for one instruction.
- `instructionFile: 'none'` for bare-model probing.
- `attachedFiles` for provider-specific config files copied into the work dir.

`TestTarget` declares agent/model targets that are really tested. Targets can be executor-backed or target-only. A target-only target (its `agentId+modelId` pair is not an executor) gets its own tasks in the matrix, routed by `TestTarget.instructionFile` (`'*'` / `'none'` / a path, default `'*'`). `TargetModelsStep` detects agents and model options (excluding the internal `terminal` agent and hidden agents), auto-seeds executor targets, and exposes a per-target instruction-routing select for target-only models. Executor-backed targets ignore `instructionFile` (their routing comes from the executor config).

`AGENT_FILE_SLOTS` / `agentFileSlots(agentId)` define CLI config-file slots. Add provider slots there and copy behavior in `PrompterAgentConfigWriter.writeAttachedFiles()`.

## Run manager

Important behavior in `prompter-run-manager.ts`:

- Builds the task matrix from executors first, then deduped target-only `agentId+modelId` pairs (each routed by its own instruction selection via `resolveInstructionInputs`).
- Groups lanes by `agentId`; within a lane, session groups are keyed by `modelId + instructionFile` so a target-only model never resumes another model's conversation.
- Each task spawns with its own `task.modelId` (executor model or independent target model), not a single lane model.
- Keeps one provider session per `model + instruction` group by passing `agentSessionId` forward; the id is also stored on `PrompterTask.agentSessionId` so a recovered grouped run resumes the right conversation.
- Creates work + evidence dirs for every agent in the matrix (including target-only agents), not just executors, then writes provider envelopes before spawning.
- Copies attached CLI config files into the work dir even for bare probes.
- Applies Red-Team Crafter before normal spawning when configured.
- Retries rate limits with 30s, 60s, and 120s backoffs.
- Persists manifests atomically and throttles non-forced persistence.
- Recovers interrupted runs by marking them paused and failing the interrupted task.
- Runs post-run hardening unless disabled or the run itself is a hardened-generation run.

## Red-Team Crafter

Crafter is implemented in `prompter-red-team-crafter.ts` and integrated from `PrompterRunManager`.

Key contracts:

- The crafter instance is run-scoped on `RunState`, not task-local.
- `profileCache` is keyed by instruction hash and survives across tasks in the run.
- Feedback chains are keyed by `${task.instructionFile}::${task.agentId}`.
- `addFeedback()` is called after task evaluation with schema, strategy, summary, band, compliance score, and response excerpt.
- `selectStrategy()` can use previous feedback and picks `adaptive-combined` after 3+ entries when allowed.
- `profileInstruction()` and `craftModification()` receive the task work dir and spawn there.
- Active transforms are task-specific and derived from the task variation filename plus `run.selectedTransforms`.
- Crafter evidence fields live on `PrompterTask`: `craftStrategy`, `craftModificationSummary`, `originalPrompt`, `crafterAgentId`, `crafterModelId`.

Crafter pairing modes: `round-robin`, `best-performer`, `manual`, `auto`.

## Evaluator

`PrompterEvaluator.evaluate(input)` runs:

1. Hard failure detection.
2. Refusal and provider/config error detection.
3. Custom evaluator path, if present.
4. Rule-based schema scoring and compliance scoring.
5. Stego analysis and decode-driven banding for stego schemas.
6. Normalization audit for BOM, invisible chars, control chars, mixed script, and stego carriers.
7. Confidence calculation.

Custom evaluators return early from schema scoring but are still augmented with normalization audit details. If a custom evaluator fails, the evaluator falls back to rule-based scoring.

Red-accuracy contract (do not regress): `REFUSAL_PATTERNS` are first-person refusal speech-acts only. Bare topic words (`harmful`, `dangerous`, `unethical`, `as an ai`, German `Sicherheit`/`Richtlinien`/`policy`) are deliberately NOT refusal signals, because a model that complies with a defensive or security-themed task uses that vocabulary constantly and would otherwise be mislabelled red. `detectRefusal` gates on position + length: a real refusal leads early (`REFUSAL_HEAD_CHARS`) and is short (`REFUSAL_SHORT_LIMIT`); refusal-shaped phrasing buried in a long cooperative answer becomes `partial`, not a hard `safety-policy` red. Coverage scoring is paraphrase/inflection tolerant via `stemToken` (an ordered suffix-stripping rule list, `ies/ied -> y`, no blanket single-char `e/n/y/er` suffixes, so `policy != police` and `rules != ruler`). Calibration cases live in `prompter-evaluator.test.ts`.

## Evidence parser and hardening

`parseEvidenceResponse(markdown)` in `prompter-report-writer.ts` is the inverse of the current evidence writer for the `## Agent-Antwort` fenced block. It returns `null` on format mismatch, so hardening code does not write entire evidence scaffolds as instructions.

Hardening flows:

- `prompter-hardened-generator.ts` generates post-run hardened instructions from qualifying green findings.
- `prompter-campaign-manager.ts` can auto-harden between campaign iterations and copy the newest hardened instruction back into `1-generic-instructions/`.
- Output goes to `5-hardened-instructions/` with provenance and metadata.

## Campaign manager

`PrompterCampaignManager` wraps normal runs into autonomous iterations.

Loop behavior:

1. Build refinements from previous iterations and findings.
2. Convert `focusTransforms` to `selectedTransforms`.
3. Union `focusSchemas` into schema IDs. Never pass schema IDs into transform filters.
4. Remove `skipTransforms` from selected transforms.
5. Create and start a normal run.
6. Compute adversarial metrics.
7. Extract findings and crafter provenance.
8. Optionally verify findings through additional runs.
9. Optionally harden between iterations.
10. Persist campaign state and learning summaries.

Stop modes: `fixed-iterations`, `until-findings`, `until-threshold`. The threshold means adversarial compliance threshold, not robustness score.

Failure handling:

- `startRun` failures become `errored` iterations and do not count toward dry-iteration cutoff.
- `createRun` failures also become `errored` iterations and include `CampaignIteration.error`.
- Final stop reason includes the number of errored iterations.

Campaign live updates include a full `Campaign` snapshot in `CampaignUpdatedEvent`, which the store uses to update dashboard progress.

Campaign reload recovery after app restart is not implemented. `getCampaign()` and `listCampaigns()` are in-memory for now.

## Reports and exports

Prompter supports:

- Per-task evidence markdown and JSON.
- Ampel summary files.
- Run report.
- Defender Gap Report.
- Hardened instruction output.
- Run research exports in CSV, JSON, and Markdown.
- Campaign research exports in CSV, JSON, and Markdown.
- Weakness export from the run panel.
- Campaign markdown sections for metrics, iterations, findings, reliability, and test optimization notes.

Do not manually edit `docs/releases.md` for any of these changes.

## IPC surface

Handlers in `src/main/ipc/handlers/prompter.ts`:

```text
planProject
createProject
deleteProject
updateProjectTargets
openProjectFolder
selectFile
listInstructions
importInstruction
listSchemas
getAgentModelOptions
createRun
startRun
pauseRun
resumeRun
stopRun
getRun
listRuns
deleteRun
recoverRuns
exportReport
exportDefenderReport
exportInstruction
selectExportFolder
createCampaign
startCampaign
pauseCampaign
resumeCampaign
stopCampaign
getCampaign
listCampaigns
generateHardenedInstruction
exportResearchData
exportCampaignData
```

Events: `prompter:runUpdated`, `prompter:taskUpdated`, `prompter:log`, `prompter:campaignUpdated`.

## Renderer panels

`PrompterRunPanel` renders these sections:

- Header, controls, timeline, task list, summary bar.
- Compact log.
- Robustness panel.
- Consistency matrix.
- Test metrics panel.
- Search path panel.
- Injection builder panel.
- Weakness export panel.
- Hardening panel.
- Hardened notice.
- Campaign creator.
- Campaign dashboard.

Keep panel additions surgical and prefer existing shared metrics utilities over recomputing analysis in React.

The Left Bar entry point is `PrompterLabSection` (in `PrompterRunPanel/`), rendered once by `SessionList`. It reads `prompterStore` directly and groups Tests (run history, newest first, each row opens the run in the center and has a folder button to its evidence dir), Kampagnen (the campaign list), and a `+ Test` launcher that opens the wizard. It renders nothing when there are no runs and no campaigns. There is no longer a separate `PrompterSidebarEntry`.

## Testing

Relevant tests live in:

- `src/__tests__/main/prompter/`
- `src/__tests__/shared/prompter-*.test.ts`
- `src/__tests__/renderer/components/PrompterWizard/`
- `src/renderer/stores/__tests__/prompterStore.test.ts`

Current Prompter slice after the 2026-06-15 clarity pass: 19 files, 236 tests.

Useful commands:

```bash
npm run lint
npm test -- --run $(find src/__tests__/main/prompter src/__tests__/shared src/renderer/stores/__tests__ src/__tests__/renderer/components/PrompterWizard -name '*prompter*.test.ts' -o -path '*PrompterWizard*' -name '*.test.tsx' 2>/dev/null | sort -u)
```

No real agents should be spawned in tests. Use injected `spawn` and `delay` dependencies.

## Gotchas

- Do not hand-roll formatters, path helpers, IDs, or event hooks. Check the shared guide docs first.
- Do not infer variation state by global filename sniffing.
- Do not treat campaign `focusSchemas` as transform names.
- Do not add bare topic words (harmful, dangerous, Sicherheit, Richtlinien, "as an ai") back to `REFUSAL_PATTERNS`; they mislabel cooperative answers as red. Keep refusal detection to first-person speech-acts.
- Do not key lane sessions by instruction alone; the key must include `modelId` so a target-only model never resumes another model's conversation.
- Do not build the task matrix from executors only; deduped target-only `agentId+modelId` pairs are really tested.
- Do not swallow unexpected errors silently. Use Sentry capture where the failure is not an expected optional-file case.
- Do not pass renderer callbacks across IPC. Use serializable event payloads.
- Do not edit `docs/releases.md`.
- Do not use em dashes or en dashes in docs, comments, tests, or UI copy.
