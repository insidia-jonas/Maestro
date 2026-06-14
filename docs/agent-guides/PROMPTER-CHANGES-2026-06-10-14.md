# Prompter changes documented for 2026-06-10 to 2026-06-14

This document records the Prompter work completed and documented during the four-day window ending 2026-06-14. It is intended for reviewers and future agents who need a single map of features, functions, and docs touched in this branch.

## Documentation updated in this pass

- Added public page: `docs/prompter.md`.
- Added Prompter to `docs/docs.json` navigation under Encore Features.
- Added Prompter to the Available Features table in `docs/encore-features.md`.
- Rewrote internal implementation guide: `docs/agent-guides/PROMPTER.md`.
- Added this four-day change record: `docs/agent-guides/PROMPTER-CHANGES-2026-06-10-14.md`.
- Did not edit `docs/releases.md`.

## Feature inventory

### Foundation and project lifecycle

Implemented modules:

- `prompter-types.ts`
- `prompter-path-safety.ts`
- `prompter-fs.ts`
- `prompter-generated-content.ts`
- `prompter-schema-registry.ts`
- `prompter-project-service.ts`

Documented behavior:

- Project planning and scaffold creation.
- Manifest-backed delete safety.
- Instruction scanning and hashing.
- Symlink and traversal guards.
- Atomic file writes.
- Generated project folder layout.

### Schemas and custom data

Implemented and documented:

- 15 builtin schemas.
- Schema selection step.
- Custom schemas from `2-test-schemas/`.
- `{{CUSTOM:*}}` placeholder collection in `CustomDataStep`.
- Default schemas: `adversarial-compliance-test`, `homoglyph-bypass-effectiveness`, `semantic-self-reference-tester`.

### Variation fixtures

Implemented and documented:

- 23 deterministic character/layout transforms.
- Generation into `4-advanced-tests/character-variations/tv-<stem>-<transform>.md`.
- Transform category selection in the wizard.
- Run-level `selectedTransforms` persistence.
- Task-specific transform detection for Crafter context.

### Executors, targets, and model configuration

Implemented and documented:

- Per-agent executor configuration.
- Stable model picker with discovered and curated model IDs.
- Per-agent instruction routing: all inputs, one input, or bare model.
- Per-agent CLI config-file slots copied into work dirs.
- Independent target model selection in `TargetModelsStep`.
- Target report metadata through `TestTarget` and `testTargets`.

### Run manager

Implemented and documented:

- Matrix building from agents, inputs, schemas, targets, and transforms.
- Per-agent lanes with max concurrency.
- Instruction-first session continuity by carrying provider session IDs forward.
- Bare-model probes without envelope or system prompt.
- Work dir creation, envelope writing, and attached config-file copying.
- Rate-limit backoff.
- Pause, resume, stop, persistence, and run recovery.
- Post-run hardening trigger.

### Evaluation

Implemented and documented:

- Failure classification.
- Refusal and provider error classification.
- Rule-based schema scoring.
- Custom task scoring through resolved custom data.
- Compliance score with coverage, structure, and behavior.
- Custom `.mjs` evaluator sandbox.
- Normalization audit for regular and custom evaluator outputs.
- Steganography carrier detection and decode-driven banding.

### Red-Team Crafter

Implemented and documented:

- `RedTeamCrafterConfig`.
- `CrafterAgent` pools.
- Strategies: semantic reframe, context blend, authority frame, task decompose, persona mirror, multi-vector, adaptive combined.
- Run-scoped Crafter instance.
- Instruction profile cache keyed by instruction hash.
- Feedback chains keyed by instruction file and target agent.
- Feedback-driven strategy selection.
- Work-dir-aware Crafter spawning.
- Crafter evidence fields on `PrompterTask`.
- Crafter provenance copied onto campaign findings.

### Campaigns

Implemented and documented:

- Campaign creation, start, pause, resume, stop, get, list.
- Fixed iteration, until findings, and until threshold stop modes.
- Iteration refinements.
- `focusTransforms`, `focusSchemas`, and `skipTransforms`.
- Stego schema focus without feeding schema IDs into transform filters.
- Finding extraction with reliability and compliance metadata.
- Verification runs.
- Auto-hardening between iterations.
- Full campaign snapshot events for live dashboard updates.
- Errored iteration handling for createRun and startRun failures.
- Cross-campaign learning persistence.

### Hardening and reports

Implemented and documented:

- Evidence markdown and JSON.
- Ampel files.
- Run reports.
- Defender Gap Reports.
- Shared `parseEvidenceResponse()` for safe extraction from evidence.
- Hardened instruction generation into `5-hardened-instructions/`.
- Hardened instruction notices in the run panel.

### Research export and UI panels

Implemented and documented:

- Run and campaign exports in CSV, JSON, and Markdown.
- Compliance score in task export.
- Campaign markdown with test optimization notes.
- Robustness panel.
- Consistency matrix.
- Test metrics panel.
- Search path panel.
- Injection builder panel.
- Weakness export panel.
- Campaign creator and campaign dashboard.

## Review fixes incorporated

Documented and implemented fixes include:

- Crafter feedback loop no longer dead code.
- Crafter profile cache survives across tasks in a run.
- Crafter active transforms are task-specific.
- Crafter spawns use task work dirs.
- Evidence extraction no longer falls back to whole evidence files.
- Campaign snapshot events reach the renderer store.
- Crafter strategy and modification propagate to campaign findings.
- Stego decode can affect banding.
- Stego refinement uses `focusSchemas`.
- `skipTransforms` replaces translated description string matching.
- `createRun` failures become errored iterations.
- Custom evaluators include normalization audit details.
- TypeScript lint is green after the final fixes.

## Validation recorded

Final validation after the 2026-06-14 fixes:

```bash
npm run lint
npm test -- --run $(find src/__tests__/main/prompter src/__tests__/shared src/renderer/stores/__tests__ src/__tests__/renderer/components/PrompterWizard -name '*prompter*.test.ts' -o -path '*PrompterWizard*' -name '*.test.tsx' 2>/dev/null | sort -u)
```

Result:

- TypeScript lint passed.
- Prompter slice passed: 18 test files, 212 tests.

## Still open

- Campaign reload recovery after app restart. Current campaign list is in-memory.
- Optional cleanup: make `CampaignUpdatedEvent.campaign` optional if the renderer fallback should remain part of the public type contract.
- Optional cleanup: decide whether `parseEvidenceResponse()` should preserve leading and trailing blank lines or remain a trimmed hardening extractor.
- Optional cleanup: consolidate remaining duplicated hardening generation structure.
