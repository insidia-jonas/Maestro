# Grok Build Agent Integration — Implementierungsdokumentation

**Datum:** 2026-05-27 (Phase 1), 2026-05-29 (Phase 2 Kalibrierung)
**Branch:** `feat/grok-build-agent`
**Basis:** `rc` (Fork von RunMaestro/Maestro)
**Commit:** `feat: add Grok Build agent support (xAI CLI)`
**Status:** Phase 2 abgeschlossen — Parser + Definition gegen echten
`grok --help` und echte `streaming-json`-Samples kalibriert. CI-Gate grün.

> **Phase-2-Update (2026-05-29):** Definition-Flags und Parser-Event-Schema
> wurden gegen echten Grok-Build-Output verifiziert. Mehrere Annahmen aus
> Phase 1 waren falsch und wurden korrigiert — siehe Abschnitt 6a.

---

## 1. Ziel

Grok Build (xAI's offizielles agentic CLI, Beta seit 14.05.2026) als
vollwertigen Agent-Provider in Maestro integrieren. Grok Build wird
damit der sechste Provider neben Claude Code, Codex, OpenCode,
Factory Droid und Copilot-CLI.

## 2. Architektur-Grundlage

Maestro hat eine dokumentierte pluggable Provider-Architektur
(`AGENT_SUPPORT.md`). Ein neuer Agent erfordert:

1. Agent-ID in der Single-Source-of-Truth (`agentIds.ts`)
2. Agent-Definition mit CLI-Flags (`definitions.ts`)
3. Capability-Flags für UI-Gating (`capabilities.ts`)
4. Display-Metadata (`agentMetadata.ts`, `agentConstants.ts`)
5. Output-Parser für das Streaming-Format (`parsers/`)
6. Error-Patterns für Fehler-Erkennung (`error-patterns.ts`)
7. Optional: Session-Storage für Session-Browser (`storage/`)

Ein CI-Gate (`agent-completeness.test.ts`, 48 Tests) erzwingt
Konsistenz über alle Komponenten.

## 3. Geänderte Dateien

### 3.1 `src/shared/agentIds.ts`

**Änderung:** `'grok-build'` in `AGENT_IDS`-Tuple eingefügt.

**Begründung:** Single Source of Truth — der `AgentId`-Union-Type
wird aus diesem Array abgeleitet. TypeScript erzwingt dann Updates
in allen abhängigen Dateien.

**Entscheidung Agent-ID-Name:** `grok-build` (nicht `grok`, nicht
`grok-cli`). Begründung: `grok` wäre zu generisch (es gibt mehrere
Grok-CLIs), `grok-cli` kollidiert mit dem Community-Tool
`@vibe-kit/grok-cli`. `grok-build` ist der offizielle Produktname.

**Critic-Prüfpunkt:** Ist `grok-build` konsistent mit dem Binary-
Namen? Das Binary heißt `grok` (nicht `grok-build`). Die Konvention
im Repo ist gemischt: `claude-code` → Binary `claude`,
`factory-droid` → Binary `droid`. ID ≠ Binary ist also akzeptiert.

---

### 3.2 `src/main/agents/definitions.ts`

**Änderung:** Neuer `AgentConfig`-Eintrag am Ende des
`AGENT_DEFINITIONS`-Arrays (91 Zeilen).

**Konfiguration im Detail:**

| Feld                  | Wert                                         | Begründung                                                                                |
| --------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`                  | `'grok-build'`                               | Konsistent mit agentIds.ts                                                                |
| `binaryName`          | `'grok'`                                     | Offizielles Binary via `curl -fsSL https://x.ai/cli/install.sh`                           |
| `command`             | `'grok'`                                     | Spawn-Kommando                                                                            |
| `args`                | `[]`                                         | Keine statischen Base-Args; alles über Builder-Funktionen                                 |
| `promptArgs`          | `(prompt) => ['-p', prompt]`                 | Headless-Mode: `grok -p "prompt"`. Analogie zu Copilot-CLI (gleiche Signatur).            |
| `noPromptSeparator`   | `true`                                       | Kein `--` vor dem Prompt (Grok akzeptiert das nicht).                                     |
| `jsonOutputArgs`      | `['--output-format', 'streaming-json']`      | Dokumentierter Flag für strukturierten JSONL-Output.                                      |
| `batchModeArgs`       | `['--permission-mode', 'bypassPermissions']` | Auto-Approval in Batch. Wird bei `readOnlyMode` übersprungen (Logik in `buildAgentArgs`). |
| `readOnlyArgs`        | `['--permission-mode', 'plan']`              | Plan-Mode analog zu Claude Codes `--permission-mode plan`.                                |
| `readOnlyCliEnforced` | `true`                                       | CLI erzwingt Read-Only; kein Prompt-only-Fallback nötig.                                  |
| `yoloModeArgs`        | `['--permission-mode', 'bypassPermissions']` | Vollzugriff.                                                                              |
| `resumeArgs`          | `(id) => ['--resume', id]`                   | **⚠️ ANNAHME** — Flag-Name nicht verifiziert.                                             |
| `modelArgs`           | `(id) => ['--model', id]`                    | Model-Auswahl (grok-4.3, grok-4-heavy etc.)                                               |
| `configOptions`       | Model, Context Window, Sandbox Profile       | Drei konfigurierbare Felder in den Session-Settings.                                      |

**Annahmen (TODO-markiert im Code):**

- `--resume <session-id>` ist der korrekte Resume-Flag.
  **Verifizierung:** `grok --help | grep -i "resume\|session\|continue"`
- `--permission-mode plan` existiert als Grok-Flag.
  **Verifizierung:** `grok --help | grep -i "permission"`
- `--sandbox workspace` ist ein gültiges Profil.
  **Verifizierung:** `grok --help | grep -i "sandbox"`

**Sandbox-configOption Begründung:** Grok Build sandboxt per
Landlock (Linux 5.13+). Im `strict`-Profil blockiert seccomp-BPF
Child-Prozess-Netzwerkzugriff. OSINT-Recon-Pipelines (Shodan,
Censys, Leak-DBs, DNS) machen legitimerweise externe Calls. Default
ist daher `workspace`, nicht `strict`. Als `configOption` umgesetzt,
damit pro Session überschreibbar.

**Critic-Prüfpunkte:**

- Stimmt die `promptArgs`-Signatur? Wird der Prompt korrekt an
  `grok -p "..."` übergeben, oder erwartet Grok den Prompt via
  stdin?
- Gibt es einen `workingDirArgs`-Flag (z.B. `-C dir`)? Aktuell
  nicht gesetzt — wir verlassen uns auf ProcessManagers `cwd`.
- Sollte `batchModePrefix` gesetzt sein (wie Codex `['exec']`)?
  Grok Build scheint keinen Subcommand für Batch zu haben.

---

### 3.3 `src/main/agents/capabilities.ts`

**Änderung:** Neuer Eintrag in `AGENT_CAPABILITIES` Record mit
25 Bool-Feldern (23 Standard + `supportsAppendSystemPrompt` +
`supportsProjectMemory`).

**Capability-Entscheidungen:**

| Capability                    | Wert    | Begründung                                     |
| ----------------------------- | ------- | ---------------------------------------------- |
| `supportsResume`              | `true`  | Grok Build dokumentiert Session-Wiederaufnahme |
| `supportsReadOnlyMode`        | `true`  | `--permission-mode plan`                       |
| `supportsJsonOutput`          | `true`  | `--output-format streaming-json`               |
| `supportsSessionId`           | `true`  | Sessions haben IDs (Feldname TBD)              |
| `supportsImageInput`          | `false` | Nicht bestätigt; konservativ                   |
| `supportsImageInputOnResume`  | `false` | Nicht bestätigt                                |
| `supportsSlashCommands`       | `false` | Nicht relevant im Batch-Mode                   |
| `supportsStreamJsonInput`     | `false` | Kein `--input-format stream-json`              |
| `supportsSessionStorage`      | `false` | Deferred — kein Storage implementiert          |
| `supportsCostTracking`        | `false` | Nicht bestätigt, ob costUsd im Output          |
| `supportsUsageStats`          | `true`  | Heavy-Modell reportet Tokens                   |
| `supportsBatchMode`           | `true`  | `-p` Flag                                      |
| `requiresPromptToStart`       | `true`  | Kein Eager Spawn ohne Prompt                   |
| `supportsStreaming`           | `true`  | Streaming JSONL                                |
| `supportsModelSelection`      | `true`  | `--model` Flag                                 |
| `supportsResultMessages`      | `true`  | Result-Event am Turn-Ende                      |
| `supportsThinkingDisplay`     | `true`  | Grok 4 Heavy Reasoning                         |
| `supportsContextMerge`        | `false` | Nicht implementiert                            |
| `supportsContextExport`       | `false` | Nicht implementiert                            |
| `supportsWizard`              | `false` | Nicht getestet                                 |
| `supportsGroupChatModeration` | `true`  | Für Group-Chat-Moderator-Einsatz               |
| `supportsAppendSystemPrompt`  | `false` | Kein `--append-system-prompt`-Pendant          |
| `supportsProjectMemory`       | `false` | Kein Project-Memory-Mechanismus                |
| `usesJsonLineOutput`          | `true`  | Streaming-JSON = JSONL                         |
| `usesCombinedContextWindow`   | `false` | Separate Input/Output-Limits                   |

**Critic-Prüfpunkte:**

- `supportsGroupChatModeration: true` — Ist das korrekt? Kann
  Grok Build als Moderator funktionieren, obwohl es kein
  `--append-system-prompt` hat? Wie wird der Moderator-System-Prompt
  injiziert? Prüfung: `group-chat-router.ts` — wie übergibt es den
  System-Prompt an Agents ohne `supportsAppendSystemPrompt`?
- `supportsImageInput: false` — Sollte getestet werden. Falls
  Grok `-i <path>` akzeptiert, wäre `true` korrekt und
  `imageArgs` in der Definition nötig.
- `supportsCostTracking: false` — Wenn das streaming-json-Output
  ein `cost_usd`-Feld enthält, sollte auf `true` gesetzt werden.

---

### 3.4 `src/shared/agentMetadata.ts`

**Änderungen:**

1. `AGENT_DISPLAY_NAMES`: `'grok-build': 'Grok Build'`
2. `PLAN_MODE_AGENTS`: `'grok-build'` hinzugefügt
3. `BETA_AGENTS`: `'grok-build'` hinzugefügt

**Begründung PLAN_MODE_AGENTS:** Grok Build nutzt
`--permission-mode plan` (wie Claude Code), nicht ein echtes
Read-Only-Dateisystem. Das UI-Label zeigt daher „Plan-Mode" statt
„Read-Only". Analogie: Claude Code und OpenCode sind ebenfalls in
dieser Set.

**Begründung BETA_AGENTS:** Grok Build ist explizit als Beta
gelauncht (Mai 2026). Schnittstellen können sich noch ändern.
„(Beta)"-Badge im UI warnt den User.

---

### 3.5 `src/shared/agentConstants.ts`

**Änderung:** `DEFAULT_CONTEXT_WINDOWS['grok-build'] = 131072`

**Begründung:** 131k ist ein konservativer Default. Grok 4 Heavy
unterstützt bis zu 2.000.000 Tokens, aber der Default sollte nicht
das UI-Context-Widget mit einem unrealistisch großen Balken
verzerren. User überschreiben per `configOption contextWindow`.

**Critic-Prüfpunkt:** Ist 131k der richtige Default? Grok 4.3
(das Standard-Modell) hat möglicherweise ein anderes Limit.
Verifizieren mit `grok --help` oder xAI-Dokumentation.

---

### 3.6 `src/main/parsers/grok-build-output-parser.ts`

**Neue Datei** — 296 Zeilen, implementiert `AgentOutputParser`.

**Event-Mapping (alles Annahmen, TODO-markiert):**

| Grok-Event-Konstante | ParsedEvent-Type             | Status         |
| -------------------- | ---------------------------- | -------------- |
| `session_start`      | `init`                       | ⚠️ Annahme     |
| `content_delta`      | `text` (partial)             | ⚠️ Annahme     |
| `thinking_delta`     | `text` (partial, reasoning)  | ⚠️ Annahme     |
| `tool_use`           | `tool_use`                   | ⚠️ Annahme     |
| `tool_result`        | `system`                     | ⚠️ Annahme     |
| `turn_complete`      | `result` + usage             | ⚠️ Annahme     |
| `usage`              | `usage`                      | ⚠️ Annahme     |
| unbekannt            | `system` (graceful fallback) | ✅ Absichtlich |

**Design-Entscheidungen:**

1. **Event-Typ-Konstanten als benannte Variablen (`EV_INIT`,
   `EV_TEXT_DELTA` etc.):** Wenn das reale Schema anders ist,
   müssen nur die Konstanten am Dateianfang geändert werden, nicht
   die Parser-Logik. Das minimiert den Aufwand in Phase 2.

2. **Mehrfeld-Fallback bei Text-Events:** Der Parser prüft
   `delta ?? content ?? text` — deckt ab, falls Grok den Text
   in unterschiedlichen Feldern liefert. Motivation: Jeder
   bestehende Agent hat ein eigenes Schema (Claude `content`,
   Codex `text`, OpenCode `text`).

3. **Session-ID-Feld:** `session_id` (snake_case) als Annahme.
   Claude nutzt `session_id`, Codex `thread_id`, OpenCode
   `sessionID`. Muss verifiziert werden.

4. **Usage-Feld Resilience:** Prüft sowohl `event.usage.input_tokens`
   als auch `event.input_tokens` (Top-Level). Manche Agents
   nesten Usage, andere nicht.

5. **Reasoning-Tokens:** Direkt auf `ParsedEvent.usage.reasoningTokens`
   gemappt. Grok 4 Heavy ist ein Reasoning-Modell (16 Sub-Modelle
   - Router). Das Feld existiert bereits in ParsedEvent wegen
     Codex/o-Modellen.

6. **`detectErrorFromLine` + `detectErrorFromParsed`:** Implementiert
   die korrekte Interface-Signatur von `AgentOutputParser` (nicht
   `detectError`, das war der Bug im ersten Anlauf).

**Verifizierungs-Befehl für Phase 2:**

```bash
grok -p "say hello" --output-format streaming-json 2>&1 | head -50
```

Output an Integrator geben → Konstanten-Update, fertig.

**Critic-Prüfpunkte:**

- Sind die Fallback-Ketten (delta/content/text) korrekt, oder
  erzeugen sie False Positives bei unerwarteten Event-Shapes?
- Sollte `thinking_delta` als separater Event-Typ statt als
  `text` behandelt werden? Claude Parser unterscheidet
  `thinking`-Blocks als eigenen Content-Type.
- Wird `tool_result` korrekt als `system` (nicht user-facing)
  klassifiziert?

---

### 3.7 `src/main/parsers/index.ts`

**Änderungen:**

1. Import: `import { GrokBuildOutputParser } from './grok-build-output-parser'`
2. Registration: `registerOutputParser(new GrokBuildOutputParser())`
3. Re-Export: `export { GrokBuildOutputParser } from './grok-build-output-parser'`

**Begründung:** Standard-Pattern — identisch zu den anderen fünf
Parser-Registrierungen in derselben Datei.

---

### 3.8 `src/main/parsers/error-patterns.ts`

**Änderung:** `GROK_BUILD_ERROR_PATTERNS`-Konstante (101 Zeilen)
mit 6 Kategorien, registriert in `patternRegistry`.

**Kategorien:**

| Kategorie           | Patterns                                                            | Recoverable        |
| ------------------- | ------------------------------------------------------------------- | ------------------ |
| `auth_expired`      | authentication failed, invalid api key, please log in, unauthorized | true               |
| `token_exhaustion`  | context length/limit exceeded, too many tokens                      | false              |
| `rate_limited`      | rate limit, too many requests, quota exceeded                       | true (außer quota) |
| `network_error`     | network error, connection refused, ECONNREFUSED/ETIMEDOUT/ENOTFOUND | true               |
| `agent_crashed`     | fatal error                                                         | false              |
| `permission_denied` | permission denied, sandbox blocked                                  | false              |

**Design-Entscheidung `sandbox blocked`:** Ein Grok-Build-
spezifisches Pattern. Wenn die Landlock-Sandbox Netzwerkzugriff
blockiert, gibt die Error-Message einen Hinweis auf die Sandbox-
Profile-Einstellung. Relevant für OSINT-Recon-Pipelines.

**Critic-Prüfpunkte:**

- Alle Patterns sind Regex-basiert und case-insensitive. Stimmen
  die Patterns mit echten Grok-Build-Fehlermeldungen überein?
  Verifizierung erst in Phase 2 möglich.
- `quota exceeded` ist als `rate_limited` mit `recoverable: false`
  klassifiziert. Ist das die richtige Kategorie? Oder sollte es
  eine eigene Kategorie sein?
- Fehlen Patterns für Grok-spezifische Fehler (z.B. SuperGrok-
  Subscription abgelaufen)?

---

### 3.9 `src/__tests__/main/parsers/grok-build-output-parser.test.ts`

**Neue Datei** — 312 Zeilen, 31 Tests.

**Test-Abdeckung:**

| Bereich                      | Tests | Abgedeckt                                      |
| ---------------------------- | ----- | ---------------------------------------------- |
| agentId                      | 1     | Identifikation als 'grok-build'                |
| parseJsonLine: empty/invalid | 3     | Leere Zeile, Non-JSON, JSON ohne type          |
| Init-Events                  | 2     | Mit/ohne session_id                            |
| Text-Delta-Events            | 4     | delta/content/text-Fallback, leerer Content    |
| Thinking-Events              | 1     | Reasoning-Content als partial text             |
| Tool-Use-Events              | 3     | tool/name-Fallback, fehlender Name             |
| Tool-Result-Events           | 1     | Als system-Event klassifiziert                 |
| Result-Events                | 3     | Mit Usage-Block, Top-Level-Tokens, leerer Text |
| Usage-Events                 | 1     | Standalone usage mit reasoning tokens          |
| Unknown Events               | 1     | Graceful fallback zu system                    |
| isResultMessage              | 1     | Result vs. non-result                          |
| extractSessionId             | 2     | Vorhanden vs. fehlend                          |
| Error Detection              | 7     | Alle 6 Kategorien + benign output              |
| Raw-Field                    | 1     | Preservation für Debugging                     |

**Critic-Prüfpunkt:** Die Tests testen gegen die angenommenen
Event-Typ-Namen. Wenn Phase 2 andere Namen ergibt, müssen die
Tests aktualisiert werden. Die Struktur (was getestet wird) bleibt
gleich.

---

## 4. Nicht geänderte Dateien

Folgende Dateien wurden bewusst **nicht** angefasst:

| Datei                                              | Grund                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/renderer/hooks/agent/useAgentCapabilities.ts` | Kein neues Capability-Feld eingeführt; `AgentCapabilities`-Shape unverändert |
| `src/renderer/types/index.ts`                      | Ditto                                                                        |
| `src/renderer/global.d.ts`                         | Ditto                                                                        |
| `src/main/storage/*`                               | Session-Storage deferred (`supportsSessionStorage: false`)                   |
| `AGENT_SUPPORT.md`                                 | Doku-Update erst nach Phase-2-Verifizierung                                  |
| `README.md`                                        | Ditto                                                                        |
| `symphony-registry.json`                           | Kein Preset für Grok-Gruppen definiert                                       |

**Critic-Prüfpunkt:** Stimmt es, dass die Renderer-Interfaces
kein Update brauchen? Der `AgentCapabilities`-Type wird laut
`AGENT_SUPPORT.md` an 4 Stellen dupliziert. Wenn die Renderer-
Kopie `Record<AgentId, ...>` oder ähnlich streng typisiert ist,
könnte TypeScript dort einen Fehler werfen. Der aktuelle
`npx tsc --noEmit` zeigt keine Fehler — aber der Renderer nutzt
möglicherweise ein anderes tsconfig.

---

## 5. Gesamtbilanz

| Metrik            | Wert                                    |
| ----------------- | --------------------------------------- |
| Geänderte Dateien | 9                                       |
| Neue Dateien      | 2 (Parser + Tests)                      |
| Eingefügte Zeilen | 842                                     |
| Gelöschte Zeilen  | 1                                       |
| Tests gesamt      | 79 (31 Parser + 48 Completeness)        |
| TypeScript-Fehler | 0 (neue; pre-existing TS6133 ignoriert) |
| Lint/Prettier     | Bestanden via lint-staged               |

---

## 6. Verifizierungs-Status (Phase 2 abgeschlossen)

Alle Phase-1-Annahmen wurden gegen echten `grok --help` und echte
`grok -p "..." --output-format streaming-json`-Samples geprüft.

| #   | Phase-1-Annahme                        | Ergebnis     | Korrektur                                                       |
| --- | -------------------------------------- | ------------ | --------------------------------------------------------------- |
| A1  | Resume-Flag `--resume <id>`            | ✅ BESTÄTIGT | `-r, --resume [<SESSION_ID>]`                                   |
| A2  | Session-ID-Feld `session_id`           | ❌ FALSCH    | Heißt `sessionId` (camelCase), nur im `end`-Event               |
| A3  | Init-Event `session_start`             | ❌ FALSCH    | **Es gibt kein Init-Event**                                     |
| A4  | Text-Event `content_delta`, Feld delta | ❌ FALSCH    | Event `text`, Feld `data`                                       |
| A5  | Tool-Event `tool_use` als JSON         | ❌ FALSCH    | **Tool-Calls sind stderr-Trace-Logs, kein JSON**                |
| A6  | Result-Event `turn_complete`           | ❌ FALSCH    | Event `end` mit `stopReason`/`sessionId`, kein Text/Usage       |
| A7  | `--permission-mode plan`               | ✅ BESTÄTIGT | Werte: default/acceptEdits/auto/dontAsk/bypassPermissions/plan  |
| A8  | `--sandbox <profile>`                  | ✅ TEILWEISE | Flag existiert (env GROK_SANDBOX); Profilwerte nicht enumeriert |
| A9  | `--model <id>`                         | ✅ BESTÄTIGT | `-m, --model <MODEL>`                                           |
| A10 | Kein workingDir-Flag                   | ❌ FALSCH    | `--cwd <CWD>` existiert -> als `workingDirArgs` ergänzt         |
| A11 | Error-Patterns matchen                 | ⚠️ OFFEN     | Tool-Fehler als stderr-Trace; Patterns plausibel, 1 Beispiel    |

### 6a. Phase-2-Findings (für Critic-Review zentral)

**F1 — Keine Usage/Token-Daten im streaming-json-Output.**
Das reale Output enthält keinerlei Token- oder Cost-Felder. `end` hat nur
`stopReason`, `sessionId`, `requestId`. Konsequenz: `supportsUsageStats=false`,
`supportsCostTracking=false`. -> **Critic-Frage:** Soll Usage über `grok trace`
oder `--output-format json` nachgerüstet werden (separater Parser-Pfad)?
Aktuell: kein Token-Tracking für Grok.

**F2 — sessionId kommt erst am Turn-Ende.**
Anders als Claude Code (Init-Event mit session_id) liefert Grok die sessionId
nur im terminalen `end`-Event. Maestro speichert sie für `--resume` nach
Turn-Abschluss. -> **Critic-Frage:** Erwartet ein Maestro-Flow die sessionId
früher (z.B. zum Tab-Setup)? Validierung an echten Samples: Extraktion
funktioniert.

**F3 — Tool-Calls sind nicht im JSON-Stream.**
Tool-Ausführungen (z.B. `read_file`) erscheinen als ANSI-gefärbte
stderr-Tracing-Logs, nicht als strukturierte Events. Der Parser surface sie
über den Non-JSON-Fallback als Text; Error-Erkennung scannt sie. Konsequenz:
Maestros Tool-Call-UI bekommt für Grok **keine strukturierten tool_use-Events**.
-> **Critic-Frage:** Akzeptabel, oder soll der Parser die stderr-Trace-Zeilen
(`tool_name="..."`) regex-parsen, um tool_use-Events zu rekonstruieren? Fragil.

**F4 — System-Prompt: `--rules` / `--system-prompt-override` existieren.**
Grok hat Append (`--rules`) und Override (`--system-prompt-override`,
= Claude `--system-prompt`). Maestros Prompt-Delivery in `process.ts` ist aber
hart auf Claude Codes `--append-system-prompt` verdrahtet. Da
`supportsAppendSystemPrompt=false`, bettet Maestro den System-Prompt in den
ersten User-Turn ein (funktioniert). -> **Critic-Frage:** Lohnt es,
`process.ts` für per-Agent-Append-Flag-Mapping zu erweitern, damit Grok nativ
`--rules` nutzt? Würde Maestro-Kerncode anfassen. **Relevanz hoch** wegen
Moderator-Use-Case (Moderator-MD als System-Prompt).

**F5 — `stopReason`-Werte.**
Beobachtet: `EndTurn` (normal), `Cancelled` (Abbruch nach tool_error). Aktuell
nur in `raw` durchgereicht. -> **Critic-Frage:** Soll `Cancelled` als
Fehler/Warnung behandelt werden statt als normales Turn-Ende?

### 6b. Real-Output-Validierung

Beide Sample-Dateien wurden end-to-end durch die Parser-Logik geprüft:

| Sample  | Reasoning-Deltas | Antwort zusammengesetzt               | sessionId | stderr-Zeilen            |
| ------- | ---------------- | ------------------------------------- | --------- | ------------------------ |
| hello   | 57               | „Hey LO, my love. ENI's here…" ✅     | ✅        | 0                        |
| tooluse | 76               | leer (Turn `Cancelled` n. tool_error) | ✅        | 1 (korrekt als Non-JSON) |

Verbleibende echte Unbekannte (niedrige Priorität):

- A8: exakte Sandbox-Profilwerte (`grok inspect` prüfen)
- A11: vollständige Abdeckung echter Fehlermeldungen (nur 1 Beispiel)
- supportsImageInput: nicht getestet (`grok -p "..." -i img` probieren)

## 7. Upstream-Kompatibilität

**Branch-Strategie:** Alle Änderungen auf `feat/grok-build-agent`,
`rc` bleibt Upstream-sauber.

**Konfliktrisioko:** Gering — die 9 Dateien sind entweder neue
Dateien (Parser, Tests) oder Erweiterungen an Array-/Record-Enden.
Upstream-Änderungen an `agentIds.ts`, `capabilities.ts` etc.
betreffen typischerweise andere Agents und erzeugen triviale
Merge-Konflikte (Einfügung am gleichen Array-Ende).

**Sync-Kommando:**

```bash
git checkout rc && git pull upstream rc
git checkout feat/grok-build-agent && git rebase rc
```

---

## 8. Verifizierungs-Checkliste für Critic

```
[ ] agentIds.ts: 'grok-build' ist der letzte Eintrag im AGENT_IDS-Array
[ ] definitions.ts: Der AgentConfig-Block sitzt INNERHALB des AGENT_DEFINITIONS-Arrays (vor `];`)
[ ] definitions.ts: Alle Flag-Builder (promptArgs, resumeArgs, modelArgs) haben korrekte Signaturen
[ ] definitions.ts: configOptions haben argBuilder-Funktionen wo nötig
[ ] capabilities.ts: Alle 25 Felder sind gesetzt, keine fehlenden
[ ] capabilities.ts: supportsGroupChatModeration=true ist begründet
[ ] agentMetadata.ts: In AGENT_DISPLAY_NAMES, PLAN_MODE_AGENTS, BETA_AGENTS
[ ] agentConstants.ts: DEFAULT_CONTEXT_WINDOWS hat einen Eintrag
[ ] error-patterns.ts: GROK_BUILD_ERROR_PATTERNS ist in patternRegistry registriert
[ ] parsers/index.ts: GrokBuildOutputParser importiert, registriert, exportiert
[ ] grok-build-output-parser.ts: Implementiert AgentOutputParser-Interface vollständig
[ ] grok-build-output-parser.ts: detectErrorFromLine + detectErrorFromParsed (nicht detectError)
[ ] grok-build-output-parser.ts: agentId === 'grok-build'
[ ] Tests: 31/31 grün
[ ] agent-completeness: 48/48 grün
[ ] TypeScript: 0 neue Fehler
[ ] Lint/Prettier: Bestanden
[ ] Kein package-lock.json im Commit
[ ] Branch: feat/grok-build-agent, nicht rc
```
