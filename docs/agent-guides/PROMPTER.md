<!-- Verified 2026-06-14 against feat/prompter. Covers 15 builtins, 23 transforms, 9-step wizard, independent targets, Red-Team Crafter, autonomous campaigns, hardening, research export, stego decoder, and run dashboard panels. Do not edit docs/releases.md for Prompter changes. -->

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

## What it does

1. **Scaffold** a lab project with instructions, schemas, results, advanced fixtures, hardening output, docs, and evaluator tooling.
2. **Collect** every instruction under `1-generic-instructions/`, hash it, and optionally generate 23 deterministic character/layout variations under `4-advanced-tests/character-variations/`.
3. **Configure executors** with agent, model, instruction routing, optional bare-model mode, and CLI config-file attachments.
4. **Declare target models** independently from executors. Executor targets are preselected, but additional target-only agent/model pairs can be included for reporting and comparison.
5. **Select schemas** from 15 builtins plus custom schemas and fill `{{CUSTOM:*}}` placeholders.
6. **Run** the matrix in per-agent lanes with per-input conversation continuity and rate-limit backoff.
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
| `src/renderer/stores/prompterStore.ts`                | Wizard state, active run, active campaign, logs, resume snapshots, event reducers.                                       |
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

`prompter-variation-generator.ts` exports 23 transform names. Generated file names are `tv-<stem>-<transform>.md`. `selectedTransforms` is stored on `PrompterRun` and must be used for task-specific transform context. Do not infer transforms globally by checking for `tv-` anywhere in the run.

## Executor agents, target models, and config files

`PrompterAgentConfig` configures executor agents. Each executor can select:

- `instructionFile: '*'` for all inputs.
- `instructionFile: '<path>'` for one instruction.
- `instructionFile: 'none'` for bare-model probing.
- `attachedFiles` for provider-specific config files copied into the work dir.

`TestTarget` declares agent/model targets for reporting and comparison. Targets can be executor-backed or target-only. `TargetModelsStep` detects agents and model options, auto-seeds executor targets, and stores target metadata for reports.

`AGENT_FILE_SLOTS` / `agentFileSlots(agentId)` define CLI config-file slots. Add provider slots there and copy behavior in `PrompterAgentConfigWriter.writeAttachedFiles()`.

## Run manager

Important behavior in `prompter-run-manager.ts`:

- Builds task matrix from agents, instruction inputs, schemas, and independent targets.
- Groups lanes by `agentId` and tasks by instruction file.
- Keeps one provider session per input group by passing `agentSessionId` forward.
- Creates per-agent work dirs and writes provider envelopes before spawning.
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

## Testing

Relevant tests live in:

- `src/__tests__/main/prompter/`
- `src/__tests__/shared/prompter-*.test.ts`
- `src/__tests__/renderer/components/PrompterWizard/`
- `src/renderer/stores/__tests__/prompterStore.test.ts`

Current Prompter slice after the 2026-06-14 fixes: 18 files, 212 tests.

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
- Do not swallow unexpected errors silently. Use Sentry capture where the failure is not an expected optional-file case.
- Do not pass renderer callbacks across IPC. Use serializable event payloads.
- Do not edit `docs/releases.md`.
- Do not use em dashes or en dashes in docs, comments, tests, or UI copy.
