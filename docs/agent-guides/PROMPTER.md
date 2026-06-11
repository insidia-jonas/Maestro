<!-- Verified 2026-06-11 against feat/prompter (initial implementation, playbook 05) -->

# Prompter (Prompt Safety Lab)

The Prompter is a self-contained feature for **auditing how AI agents understand and preserve a system instruction** across providers and models. The user scaffolds a project folder, drops generic instruction files into it, picks agents/models and test schemas, and runs a batch. Each agent is fed the instruction as a provider-specific envelope, asked a schema prompt, and its answer is classified into a traffic-light band (green/yellow/red). It is a **safety lab, not a bypass tool**: refusals are legitimate results, prompts are never obfuscated, and every write stays inside the chosen project folder.

Reached from the hamburger menu (`ShieldCheck` icon -> "Prompter / Prompt Safety Lab").

## What it does (function)

1. **Scaffold** a project folder with a fixed layout (instructions, schemas, results, docs, tools) plus generated guides and 9 builtin schemas.
2. **Collect** all instruction files under `1-generic-instructions/` (recursive, hashed). No cherry-picking: every file is tested.
3. **Configure** a test matrix: `agents x instructions x schemas`. Each agent gets a model (from CLI discovery, with manual fallback).
4. **Run** the matrix in per-agent lanes (agents in parallel, tasks serial per lane, capped at `maxParallelAgents`). Each task writes a provider envelope (CLAUDE.md / instructions.md / .github/copilot-instructions.md / AGENTS.md / GEMINI.md / GROK.md), spawns the agent in batch mode via the shared `spawnAgent()`, and evaluates the response.
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
| PrompterWizard/* (7 steps)    | <-----> |   PrompterSchemaRegistry          |
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

| File                                                  | Responsibility                                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/prompter-types.ts`                        | All shared types (wizard, agents, schemas, runs/tasks, evaluation, events, persistence). Zero main/cli/renderer imports.                                          |
| `src/main/prompter/prompter-path-safety.ts`           | Sandbox guard: lexical traversal check + symlink-escape check (`realpathSync` of deepest existing ancestor). `assertSafeWritePath` = resolve + symlink check.     |
| `src/main/prompter/prompter-fs.ts`                    | `sha256`, `atomicWriteFile` (temp -> rename, EPERM/EBUSY retry), `ensureDir`, `readFirstLines`, `walkFiles` (skips symlinks via Dirent).                          |
| `src/main/prompter/prompter-generated-content.ts`     | String constants for generated guides, READMEs, schema template, report templates.                                                                                |
| `src/main/prompter/prompter-schema-registry.ts`       | 9 builtin schemas; loads project + shared custom schemas; validation; override-by-id; single-level `extends` inheritance (max depth 2); placeholder substitution. |
| `src/main/prompter/prompter-project-service.ts`       | Plan / create / delete projects, scan + import instructions. All writes path-safety checked; deletes refuse without a manifest.                                   |
| `src/main/prompter/prompter-model-discovery.ts`       | Wraps `AgentDetector.discoverModels()` with a 10s timeout and a local cache; never throws.                                                                        |
| `src/main/prompter/prompter-agent-config-writer.ts`   | Writes the provider envelope file(s) into a per-agent working dir.                                                                                                |
| `src/main/prompter/prompter-evaluator.ts`             | 4-stage classifier + helpers + sandboxed custom `.mjs` evaluator.                                                                                                 |
| `src/main/prompter/prompter-report-writer.ts`         | Per-task evidence (md + json), traffic-light ampel entries, run report. All atomic.                                                                               |
| `src/main/prompter/prompter-run-manager.ts`           | Run lifecycle: task matrix, lanes, spawn (injected), timeout + rate-limit backoff, pause/resume/stop, manifest persistence, crash recovery.                       |
| `src/main/ipc/handlers/prompter.ts`                   | 18 IPC handlers (+ 3 events) wired with `withIpcErrorLogging`. Lazy-imports `spawnAgent`.                                                                         |
| `src/main/preload/prompter.ts`                        | `createPrompterApi()` contextBridge factory.                                                                                                                      |
| `src/renderer/stores/prompterStore.ts`                | Zustand store: wizard state machine, active run + event reducers, compact log, localStorage resume snapshot.                                                      |
| `src/renderer/hooks/prompter/usePrompterListeners.ts` | App-level event subscriptions + startup crash recovery; `rememberPrompterProjectRoot`.                                                                            |
| `src/renderer/components/PrompterWizard/*`            | 7-step wizard + stepper + exit-confirm + orchestrator.                                                                                                            |
| `src/renderer/components/PrompterRunPanel/*`          | Live run dashboard (timeline, task list, badges, log, controls, summary).                                                                                         |

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
3. **Schema scoring**: key-phrase coverage of the original instruction (`extractKeyPhrases` over headings, bullets, bold terms with >= 3 words) vs the schema's `coverageThreshold`. `normalization-audit` instead runs a static byte analysis (`analyzeNormalization`: BOM, zero-width/bidi, control chars, mixed Latin+Cyrillic/Greek). `evaluation.type === 'custom'` runs a sandboxed `.mjs` evaluator.
4. **Confidence** (`assessConfidence`): high/medium/low from classification, pattern hits, and response length.

The evaluator never rewrites or obfuscates a prompt. Refusals are reported, not retried with obfuscation.

### Custom evaluators

A `.mjs` in `tools/evaluators/` exporting `evaluate(input)` returning `{ band, reason, details?, metrics? }`. Run in a `vm` sandbox: no `require`, no Node APIs, `codeGeneration` disabled, 5s timeout. The path is validated inside the project before loading; any failure falls back to rule-based scoring.

## Concurrency, timeouts, crash recovery

- **Lanes**: tasks are grouped by `agentId`; each lane runs serially; lanes run through a concurrency pool capped at `maxParallelAgents` (default 4). The pool processes every lane (it does not silently drop agents beyond the cap).
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

`planProject`, `createProject`, `deleteProject`, `openProjectFolder`, `listInstructions`, `importInstruction`, `listSchemas`, `getAgentModelOptions`, `createRun`, `startRun` (fire-and-forget), `pauseRun`, `resumeRun`, `stopRun`, `getRun`, `listRuns`, `deleteRun`, `recoverRuns`, `exportReport`. Events: `prompter:runUpdated`, `prompter:taskUpdated`, `prompter:log`.

The handler dependency set is intentionally small: `getMainWindow`, `getAgentDetector`, `settingsStore`. `getProcessManager` is **not** a dependency (stop uses AbortController + timeout, never a process kill).

## Schema system (extensibility)

Three sources, precedence builtin < project (`2-test-schemas/`) < shared library (`~/.maestro/schemas/`). A schema with a builtin id overrides it (`isOverride`). `extends` gives single-level inheritance (max depth 2; `mergeSchema` deep-merges `testConfig`/`evaluation`). Prompt templates expand placeholders (`{{INSTRUCTION_CONTENT}}`, `{{AGENT_ID}}`, `{{MODEL_ID}}`, `{{CUSTOM:key}}`, etc.) via `buildPrompt`. Required schemas (always selected): `baseline`, `provider-compatibility`, `instruction-integrity`.

To add a builtin schema: append a `PrompterSchemaDefinition` to `BUILTIN_SCHEMAS` in `prompter-schema-registry.ts`. To add a provider envelope: extend `PROVIDER_ENVELOPE_FILES` in `prompter-agent-config-writer.ts`. To add a new agent's model discovery: add a case to `runModelDiscovery` in `src/main/agents/detector.ts` (the Grok `grok-build` case is the template: `<cli> models`, 5s timeout, empty-list fallback).

## Renderer state and wiring

- `prompterStore` (Zustand) holds the wizard state machine (`PROMPTER_WIZARD_STEPS`), agent/schema selection, the active run with live `updateRunFromEvent` / `updateTaskFromEvent` / `appendLog` reducers, and a localStorage resume snapshot (`saveStateForResume` / `restoreFromSavedState` / `clearResumeState`).
- Visibility is driven by the modal store id `'prompter'` (menu -> `openModal('prompter')`; `AppStandaloneModals` lazy-mounts the wizard on `prompterModalOpen`). The wizard closes via `closeModal('prompter')`.
- The run panel is a floating component mounted in `App.tsx`, shown only when `activeRun` is set, so it does not touch the existing layout or the group-chat router.
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
- `selectedSchemas` ids are plain `string` (not the `PrompterSchemaId` union) because custom schemas carry arbitrary ids.
- `startRun` mutates `run.status` inside lane callbacks that TS flow analysis cannot see; the post-lane status read is widened with a cast on purpose.
- Result bands map to theme colors: green -> `success`, yellow -> `warning`, red -> `error`.
