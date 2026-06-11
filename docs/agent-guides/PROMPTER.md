<!-- Verified 2026-06-11 against feat/prompter. Post-redesign: fixed refusal-probe
test (no schema picker), instruction-first session execution, bare-model probing,
per-agent CLI config-file slots, run shown in the center via a left-bar entry. -->

# Prompter (Prompt Power & Robustness Lab)

The Prompter is a local **defensive robustness lab** for AI agent instructions. It finds WHERE an instruction breaks under controlled character/layout variations (homoglyphs, bidi/zero-width controls, whitespace, layout transforms) so the instruction can be hardened and a defender can improve their normalizer. The user scaffolds a project folder, drops instruction files into it, picks agents and models, and runs the variations as test fixtures. Results are classified into traffic-light bands (green = held, yellow/red = broke = a hardening opportunity). It is a **safety/robustness lab, not a bypass tool**: refusals and breakage are the useful signals; there is no ranking by token-output/compliance and no promoting an obfuscated variant into a deployed instruction.

Reached from the hamburger menu (`ShieldCheck` icon -> "Prompter / Power & Robustness Lab").

## What it does (function)

1. **Scaffold** a project folder with a fixed layout (instructions, schemas, results, docs, tools) plus generated guides and 9 builtin schemas.
2. **Collect** all instruction files under `1-generic-instructions/` (recursive, hashed). No cherry-picking: every file is tested. In addition, each top-level base instruction is run through 23 deterministic character/layout transforms (`prompter-variation-generator.ts`) into `4-advanced-tests/character-variations/tv-<stem>-<transform>.md`, which are always tested too (controlled by `PrompterRunConfig.includeVariations`, default true).
3. **Configure** per agent: a model (stable select of discovered + curated versions, or a typed custom id), an instruction selection (`*` all inputs, a specific file, or `none` = bare model), and optional CLI config-file slots (skills/settings/agent files copied into the work dir).
4. **Run** the matrix `agents x inputs x probes` in per-agent lanes (agents in parallel, capped at `maxParallelAgents`). The probe set is fixed (`PROMPTER_REFUSAL_PROBES`: baseline, safety-boundary, refusal-consistency) - there is no schema picker. Each input runs as ONE conversation per agent: the instruction is delivered on the first turn (provider envelope + appendSystemPrompt), then the probes resume that session. A `none`/bare input sends no instruction. Spawning goes through the shared `spawnAgent()` in batch mode.
5. **Classify** each result: green (instruction understood and preserved), yellow (partial / needs review / normalization anomaly), red (refusal, integrity break, timeout, or config error). Red is a valid outcome.
6. **Persist** evidence (full response + evaluation JSON), traffic-light summary files, a run report, and a crash-recovery manifest.

## Architecture

```text
Renderer (React + Zustand)                Main (Node)
+-------------------------------+         +-----------------------------------+
| HamburgerMenuContent          |         | ipc/handlers/prompter.ts          |
|   -> openModal('prompter')    |         |   (18 handlers + 3 events)        |
| AppStandaloneModals (lazy)    |         |       |                           |
|   -> PrompterWizardModal      |  IPC    |   PrompterProjectService          |
| PrompterWizard/* (6 steps)    | <-----> |   PrompterSchemaRegistry          |
| PrompterRunPanel/* (8 comps)  |         |   PrompterModelDiscovery          |
| stores/prompterStore (Zustand)|         |   PrompterAgentConfigWriter       |
| hooks/usePrompterListeners    |         |   PrompterEvaluator               |
+-------------------------------+         |   PrompterReportWriter            |
        ^   run/task/log events           |   PrompterRunManager --> spawnAgent|
        +---------------------------------|     (dynamic import, cli)         |
                                          |   prompter-path-safety (sandbox)  |
                                          +-----------------------------------+
```

### Module dependency graph (main)

```text
prompter-path-safety        (0 deps; sandbox guard)
prompter-fs                 (sha256 + atomic write + dir walk)
prompter-generated-content  (guide/template strings)
        |
prompter-schema-registry    (9 builtins, custom load, inheritance, prompt build)
prompter-project-service    (path-safety, fs, registry, generated-content)
prompter-model-discovery    (AgentDetector wrapper)
prompter-agent-config-writer(path-safety, fs)
prompter-evaluator          (path-safety; AgentResultLike structural type)
prompter-report-writer      (path-safety, fs)
prompter-run-manager        (project-service, config-writer, evaluator,
                             report-writer, schema-registry; spawn injected)
```

`prompter-types.ts` (in `src/shared/`) is a dependency-free leaf shared by main, preload and renderer. Types that reference main/cli shapes (e.g. `AgentResult`) deliberately stay out of it; the evaluator uses a local `AgentResultLike` structural type instead.

## File map

| File                                                  | Responsibility                                                                                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/prompter-types.ts`                        | All shared types (wizard, agents, schemas, runs/tasks, evaluation, events, persistence). Zero main/cli/renderer imports.                                                                     |
| `src/main/prompter/prompter-path-safety.ts`           | Sandbox guard: lexical traversal check + symlink-escape check (`realpathSync` of deepest existing ancestor). `assertSafeWritePath` = resolve + symlink check.                                |
| `src/main/prompter/prompter-fs.ts`                    | `sha256`, `atomicWriteFile` (temp -> rename, EPERM/EBUSY retry), `ensureDir`, `readFirstLines`, `walkFiles` (skips symlinks via Dirent).                                                     |
| `src/main/prompter/prompter-generated-content.ts`     | String constants for generated guides, READMEs, schema template, report templates.                                                                                                           |
| `src/main/prompter/prompter-schema-registry.ts`       | 9 builtin schemas; loads project + shared custom schemas; validation; override-by-id; single-level `extends` inheritance (max depth 2); placeholder substitution.                            |
| `src/main/prompter/prompter-project-service.ts`       | Plan / create / delete projects, scan + import instructions. All writes path-safety checked; deletes refuse without a manifest.                                                              |
| `src/main/prompter/prompter-model-discovery.ts`       | Wraps `AgentDetector.discoverModels()` with a 10s timeout and a local cache; never throws.                                                                                                   |
| `src/main/prompter/prompter-agent-config-writer.ts`   | Writes the provider envelope file(s) + user-attached CLI config files (`writeAttachedFiles`) into a per-agent working dir.                                                                   |
| `src/main/prompter/prompter-evaluator.ts`             | 4-stage classifier + helpers + sandboxed custom `.mjs` evaluator.                                                                                                                            |
| `src/main/prompter/prompter-report-writer.ts`         | Per-task evidence (md + json), traffic-light ampel entries, run report. All atomic.                                                                                                          |
| `src/main/prompter/prompter-variation-generator.ts`   | 23 deterministic character/layout transforms; `generateVariations()` builds tv-fixtures from a base instruction.                                                                             |
| `src/main/prompter/prompter-run-manager.ts`           | Run lifecycle: per-agent input matrix (bare-model supported), instruction-first session execution, spawn (injected), timeout + rate-limit backoff, pause/resume/stop, persistence, recovery. |
| `src/main/ipc/handlers/prompter.ts`                   | 18 IPC handlers (+ 3 events) wired with `withIpcErrorLogging`. Lazy-imports `spawnAgent`.                                                                                                    |
| `src/main/preload/prompter.ts`                        | `createPrompterApi()` contextBridge factory.                                                                                                                                                 |
| `src/renderer/stores/prompterStore.ts`                | Zustand store: wizard state machine, active run + event reducers, compact log, localStorage resume snapshot.                                                                                 |
| `src/renderer/hooks/prompter/usePrompterListeners.ts` | App-level event subscriptions + startup crash recovery; `rememberPrompterProjectRoot`.                                                                                                       |
| `src/renderer/components/PrompterWizard/*`            | 7-step wizard + stepper + exit-confirm + orchestrator.                                                                                                                                       |
| `src/renderer/components/PrompterRunPanel/*`          | Live run dashboard (timeline, task list, badges, log, controls, summary).                                                                                                                    |

## Project folder layout (generated)

```text
<project>/
  .prompter-project.json          manifest (id, name, root, createdAt, toolVersion)
  1-generic-instructions/         instructions under test (recursive)
    examples/                      sample-system-prompt.md, sample-agent-config.md
    GUIDE.md, README.md            excluded from the test matrix
  2-test-schemas/                 *.schema.json (9 builtins + user/custom), SCHEMA-GUIDE.md, _template.schema.json
  3-temp-results/
    1-green/ 2-yellow/ 3-red/      traffic-light summary files (hash + pointer only)
    runs/<run-id>/
      manifest.json               crash-recovery state
      report.md                   run report
      work/<agent-id>/            cwd for the spawned agent (envelope lives here)
      evidence/<agent-id>/        <schema>-<task>.md + .json
  4-advanced-tests/               approved fixtures (manual)
  documentation/                  FINAL-REPORT.md, RUNBOOK.md, templates/
  tools/evaluators/               custom .mjs evaluators, EVALUATOR-GUIDE.md
```

Instruction scan excludes `GUIDE.md`, `README.md`, and `_`-prefixed files; extensions `.md/.txt/.json/.yaml/.yml`.

## The 4-stage evaluator

`PrompterEvaluator.evaluate(input)` (`prompter-evaluator.ts`):

1. **Failure detection** (`classifyFailure`): no result + `ETIMEDOUT` -> timeout; `ENOENT`/`spawn` -> cli-error; else unknown. These short-circuit to red. Non-success but with a response -> partial.
2. **Refusal detection** (`detectRefusal`): `REFUSAL_PATTERNS` (safety/policy, EN+DE) and `CONFIG_ERROR_PATTERNS` (incl. rate-limit). 2+ safety hits, or 1 hit on a short answer -> `safety-policy` (red). Config hit -> `syntax-config` (red). 1 safety hit on a long answer -> `partial` (caps band at yellow).
3. **Schema scoring**: key-phrase coverage of the original instruction (`extractKeyPhrases` over headings, bullets, bold terms with >= 3 words) vs the schema's `coverageThreshold`. A phrase counts as covered when >= 50% of its significant words (`significantWords`, stopword-filtered) appear in the response, so paraphrased summaries are not falsely scored red (`isPhraseCovered`). `normalization-audit` instead runs a static byte analysis (`analyzeNormalization`: BOM, zero-width/bidi, control chars, mixed Latin+Cyrillic/Greek). `evaluation.type === 'custom'` runs a sandboxed `.mjs` evaluator.
4. **Confidence** (`assessConfidence`): high/medium/low from classification, pattern hits, and response length.

The evaluator never rewrites or obfuscates a prompt. Refusals are reported, not retried with obfuscation.

### Custom evaluators

A `.mjs` in `tools/evaluators/` exporting `evaluate(input)` returning `{ band, reason, details?, metrics? }`. Run in a `vm` sandbox: no `require`, no Node APIs, `codeGeneration` disabled, 5s timeout. The path is validated inside the project before loading; any failure falls back to rule-based scoring.

## Concurrency, timeouts, crash recovery

- **Lanes & sessions**: tasks are grouped by `agentId` (lane), and within a lane by input/instruction file (`groupByInstruction`). Each input group is ONE conversation: the first probe establishes the instruction, the rest resume it via the threaded `agentSessionId` (`executeTask` returns the session id to carry forward). Lanes run through a concurrency pool capped at `maxParallelAgents` (default 4); the pool processes every lane (no silent drop).
- **Pause/Resume/Stop**: `status` flag + an `AbortController`. Pausing lets the active task finish and parks subsequent tasks on `waitForResume` (woken on resume or abort). Stop aborts; remaining tasks are skipped; the active task drains via timeout.
- **Timeouts**: per-schema `testConfig.timeoutMs` (default 5 min) raced against the spawn. Model discovery uses a 10s timeout.
- **Rate limits**: `rate[- ]?limit` in the error/response triggers exponential backoff `30s -> 60s -> 120s`, max 3 retries (`RATE_LIMIT_BACKOFFS_MS`); then the task is `failed` with band yellow, reason `rate-limit`. No infinite loop.
- **Persistence**: `manifest.json` written atomically, throttled to 1/sec, force-persisted on task complete / pause / stop / run complete.
- **Recovery**: on startup `usePrompterListeners` calls `recoverRuns(roots)` (roots remembered in localStorage). `recoverInterruptedRuns` flips `running`/`preparing` -> `paused`, the running task -> `failed`, deletes orphaned `*.tmp` evidence, and returns the runs. No auto-resume: a recovered run is surfaced in the run panel (paused) for the user to resume or delete.

## Security model

- **Sandbox**: every write/delete/read of a project-relative path goes through `prompter-path-safety` (`assertSafeWritePath` / `resolveAndValidatePath` / `checkNoSymlinkEscape`). Reads of the instruction file (run-manager `executeTask`), the manifest (`readRun`), and during `scanInstructions` are symlink-validated to block TOCTOU escapes.
- **Deletes** are scoped: `deleteProject` refuses a folder without a `.prompter-project.json` manifest and symlink-checks the target; `deleteRun` symlink-checks the run dir.
- **No shell strings**: model discovery uses `execFileNoThrow` with a timeout; agent spawning uses the array-form `spawnAgent()`. Prompter never touches `ProcessManager` directly and runs only in batch mode.
- **Atomic evidence**: all evidence/manifest/report writes are temp -> rename.
- **Auditability**: every evidence and ampel file carries the instruction SHA-256, run id, schema id, model and timestamps.

## IPC surface

`window.maestro.prompter.*` (handlers in `ipc/handlers/prompter.ts`, preload in `preload/prompter.ts`, types in `renderer/global.d.ts`):

`planProject`, `createProject`, `deleteProject`, `openProjectFolder`, `selectFile` (open-file dialog for per-agent config slots), `listInstructions`, `importInstruction`, `listSchemas`, `getAgentModelOptions`, `createRun`, `startRun` (fire-and-forget), `pauseRun`, `resumeRun`, `stopRun`, `getRun`, `listRuns`, `deleteRun`, `recoverRuns`, `exportReport`. Events: `prompter:runUpdated`, `prompter:taskUpdated`, `prompter:log`.

The handler dependency set is intentionally small: `getMainWindow`, `getAgentDetector`, `settingsStore`. `getProcessManager` is **not** a dependency (stop uses AbortController + timeout, never a process kill).

## Test model: fixed refusal probes (no schema picker)

Every run uses the fixed `PROMPTER_REFUSAL_PROBES` set (`baseline`, `safety-boundary`, `refusal-consistency`) - the wizard has no schema-selection step. The lab measures whether the (possibly character-varied) instruction is accepted or refused and whether the agent holds its stated boundaries consistently. Benign probes only, audit report, no bypass/optimization loop, no prohibited target content.

The probe prompts are still built by `PrompterSchemaRegistry` (the 9 builtin schema definitions remain the prompt source; only the 3 above are used at runtime). The registry stays for advanced/custom use: three sources with precedence builtin < project (`2-test-schemas/`) < shared library (`~/.maestro/schemas/`); a project/shared schema with a builtin id overrides it (`isOverride`); `extends` gives single-level inheritance (max depth 2, `mergeSchema` deep-merges `testConfig`/`evaluation`); prompt templates expand placeholders (`{{INSTRUCTION_CONTENT}}`, `{{AGENT_ID}}`, `{{MODEL_ID}}`, `{{CUSTOM:key}}`, ...) via `buildPrompt`. To change the probe set, edit `PROMPTER_REFUSAL_PROBES` in `src/shared/prompter-types.ts`.

## Per-agent config files

`AGENT_FILE_SLOTS` / `agentFileSlots(agentId)` (`src/shared/prompter-types.ts`) define CLI-appropriate slots: claude-code (`.claude/settings.json`, `.claude/skills/SKILL.md`, `AGENTS.md`), codex (`AGENTS.md`, `config.toml`), copilot-cli (`.github/copilot-instructions.md`), opencode (`AGENTS.md`, `opencode.json`), gemini (`GEMINI.md`, `.gemini/settings.json`), grok-build (`GROK.md`). The model step lets the user pick a file per slot (`prompter:selectFile`); it is stored in `PrompterAgentConfig.attachedFiles` and copied into the agent work dir at the slot target by `PrompterAgentConfigWriter.writeAttachedFiles` before each spawn (also in bare mode). To add a provider envelope (the main instruction file), extend `PROVIDER_ENVELOPE_FILES`; to add a model-discovery case for a new agent, add a case to `runModelDiscovery` in `src/main/agents/detector.ts` (the Grok `grok-build` case is the template).

To add a builtin schema: append a `PrompterSchemaDefinition` to `BUILTIN_SCHEMAS` in `prompter-schema-registry.ts`. To add a provider envelope: extend `PROVIDER_ENVELOPE_FILES` in `prompter-agent-config-writer.ts`. To add a new agent's model discovery: add a case to `runModelDiscovery` in `src/main/agents/detector.ts` (the Grok `grok-build` case is the template: `<cli> models`, 5s timeout, empty-list fallback).

## Renderer state and wiring

- `prompterStore` (Zustand) holds the wizard state machine (`PROMPTER_WIZARD_STEPS`), agent/schema selection, the active run with live `updateRunFromEvent` / `updateTaskFromEvent` / `appendLog` reducers, and a localStorage resume snapshot (`saveStateForResume` / `restoreFromSavedState` / `clearResumeState`).
- Visibility is driven by the modal store id `'prompter'` (menu -> `openModal('prompter')`; `AppStandaloneModals` lazy-mounts the wizard on `prompterModalOpen`). The wizard closes via `closeModal('prompter')`.
- The run opens in the **center workspace** (like a group chat) when `prompterFocused` is set. `PrompterSidebarEntry` is a left-bar row (rendered inside `SessionList`, reading the store directly like `GroupChatList`) that focuses the run; selecting an agent or opening a group chat blurs it (last action wins). Starting a run from the wizard focuses it automatically. The wizard is 6 steps: project-folder, create-structure, agent-selection, instructions, model-config, review (no schema step). The model field is a stable `<select>` (always lists every discovered + curated model, plus an "Eigene Modell-ID" custom field) - not a value-filtered `<datalist>`; `model-discovery` adds curated Claude version IDs (`claude-opus-4-8`/`4-6`, etc.) on top of CLI discovery. The model step also holds the per-agent instruction selection (`*` / specific / `none`) and the CLI config-file slots.
- `usePrompterListeners` (mounted once in `App.tsx`) wires the three IPC event subscriptions and the startup recovery.

## Testing

Unit + integration tests in `src/__tests__/main/prompter/` and `src/renderer/stores/__tests__/prompterStore.test.ts`:

- Path safety (incl. a real symlink escape).
- Schema registry (validation, override, inheritance, `buildPrompt`).
- Project service (scaffold, scan, delete, and a sandbox-escaping-symlink exclusion).
- Evaluator (all 4 stages, refusal patterns, key-phrase extraction, normalization audit, sandboxed custom evaluator).
- Run manager (task matrix, a full dry run via an injected fake spawn, refusal -> red, multi-agent lanes, crash recovery, pause/resume/stop, list/delete).
- Model discovery (cli-discovery / cache / empty fallbacks).
- Store (navigation clamping, agent/schema toggles, event reducers, log filter, resume).

The injected `spawn` + `delay` deps mean **no real agents are spawned in tests**.

## Gotchas

- `walkFiles` skips symlink entries (Dirent `isFile`/`isDirectory` are false for symlinks), so `scanInstructions` cannot emit a path that escapes via symlink; the extra read-time checks guard the TOCTOU window only.
- `spawnAgent` is loaded via dynamic `import()` in the IPC handler so the cli chain stays out of the main bundle; the run manager takes `spawn` as an injected dep and never imports cli statically.
- `selectedSchemas` / `toggleSchema` remain in the store but are no longer used by the UI (the schema step was removed); the run always uses `PROMPTER_REFUSAL_PROBES`. Schema ids are plain `string` because custom schemas carry arbitrary ids.
- An empty `task.instructionFile` is the bare-model sentinel: `executeTask` reads no file, writes no envelope, sends no system prompt.
- `startRun` mutates `run.status` inside lane callbacks that TS flow analysis cannot see; the post-lane status read is widened with a cast on purpose.
- Result bands map to theme colors: green -> `success`, yellow -> `warning`, red -> `error`.
