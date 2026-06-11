/**
 * @file prompter-generated-content.ts
 * @description Markdown/JSON content written into a freshly created Prompter
 * project (the ★-files from playbook section 3). Kept as code constants so they
 * ship with MAESTRO updates; the project service writes them only when the file
 * does not already exist (never overwrites user edits).
 */

export const INSTRUCTION_GUIDE_CONTENT = `# Generic Instructions - Anleitung

## Was kommt hierhin?

Hier legst du die System-Prompts, Agent-Instructions oder Projekt-Konfigurationen
ab, die du testen möchtest. **Alles was in diesem Ordner liegt wird automatisch
in jeden Test einbezogen.** Keine Auswahl nötig - reinlegen und loslegen.

Typische Dateien:
- Deine \`CLAUDE.md\` (System-Prompt für Claude Code)
- Eine \`instructions.md\` (für Codex/OpenAI)
- Verschiedene Varianten desselben Prompts (\`eni-v1.md\`, \`eni-v2.md\`)
- Agent-Konfigurationen, Rollen-Definitionen, Style-Guides

## Wie funktioniert es?

    Du legst Dateien ab
         ↓
    Prompter scannt den ganzen Ordner (rekursiv, inkl. Unterordner)
         ↓
    JEDE Datei × JEDER Agent × JEDES Schema = Test-Tasks
         ↓
    Ergebnisse pro Datei in 3-temp-results/

Du musst nichts sortieren, nichts konfigurieren, nichts auswählen.

## Unterstützte Formate

| Dateiendung | Verwendung                    | Beispiel              |
|-------------|-------------------------------|-----------------------|
| \`.md\`       | Markdown-Instructions         | CLAUDE.md, AGENTS.md  |
| \`.txt\`      | Klartext-Instructions         | Einfache Anweisungen  |
| \`.json\`     | Strukturierte Konfigurationen | Settings, Agent-Config|
| \`.yaml\`     | Strukturierte Konfigurationen | OpenCode-Config       |

## Tipps

- **Benenne Dateien sprechend:** \`eni-creative-writer.md\` statt \`prompt1.md\`.
- **Varianten nebeneinander:** \`eni-v1.md\` und \`eni-v2.md\` im selben Ordner.
- **Unterordner erlaubt:** z.B. \`claude/\`, \`codex/\`, \`experimental/\`.
- **Hash-Tracking:** Jede Datei bekommt automatisch einen SHA-256-Hash.
- **GUIDE.md und README.md werden ignoriert** und nicht als Instruction getestet.
  Dateien die mit \`_\` beginnen werden ebenfalls ignoriert.

## Beispiele

Siehe \`examples/\` für Startpunkte. Lösche sie, wenn du nur deine eigenen
Instructions testen willst.
`;

export const SCHEMA_GUIDE_CONTENT = `# Test-Schemata - Anleitung & Generator-Prompts

## Was ist ein Schema?

Ein Schema definiert einen wiederholbaren Test für den Prompter:
- **Welche Frage** wird dem Agent gestellt (Prompt-Template)
- **Wie die Antwort bewertet** wird (Green / Yellow / Red)
- **Welche Artefakte** dabei entstehen

Du musst Schemata nicht von Hand schreiben. Nutze die Generator-Prompts unten -
kopiere sie in eine KI deiner Wahl, beschreibe was du testen willst, und lass
dir das Schema generieren.

## Schnellstart: Schema generieren lassen

Kopiere diesen Prompt in Claude, ChatGPT, Gemini oder eine andere KI:

    Ich nutze den AI-MAESTRO Prompter (Prompt Safety Lab). Ich brauche ein
    Test-Schema als JSON-Datei im Format prompter-schema/v1.

    Das Schema soll folgendes testen:
    [HIER BESCHREIBEN WAS DU TESTEN WILLST]

    Nutze das Format aus _template.schema.json exakt.

    Verfügbare Platzhalter für promptTemplate:
    {{INSTRUCTION_CONTENT}} - Volltext der Instruction
    {{AGENT_ID}} - Agent-ID (z.B. claude-code)
    {{MODEL_ID}} - Modell (z.B. claude-fable-5)
    {{CUSTOM:key}} - eigene Variable aus customData

    Gib mir NUR die JSON-Datei zurück, keinen Erklärungstext.

## Schema manuell erstellen

1. Kopiere \`_template.schema.json\` und benenne die Kopie um.
2. Vergib eine eindeutige \`id\` (Kleinbuchstaben, Bindestriche).
3. Schreibe dein \`promptTemplate\`.
4. Definiere die Bewertungskriterien.
5. Speichere. Beim nächsten Wizard-Start erscheint dein Schema automatisch.

## Kurzreferenz - Alle Platzhalter

| Platzhalter                | Wird ersetzt durch                   |
|----------------------------|--------------------------------------|
| \`{{INSTRUCTION_CONTENT}}\`  | Volltext der Instruction             |
| \`{{INSTRUCTION_HASH}}\`     | SHA-256 der Instruction              |
| \`{{INSTRUCTION_FILENAME}}\` | Dateiname der Instruction            |
| \`{{AGENT_ID}}\`             | Agent-Identifier (z.B. claude-code)  |
| \`{{AGENT_NAME}}\`           | Agent-Anzeigename                    |
| \`{{MODEL_ID}}\`             | Modell (z.B. claude-fable-5)         |
| \`{{PROVIDER_NAME}}\`        | Provider (z.B. anthropic)            |
| \`{{RUN_ID}}\`               | Aktuelle Run-ID                      |
| \`{{TIMESTAMP}}\`            | ISO-Zeitstempel                      |
| \`{{PREVIOUS_RESULT}}\`      | Ergebnis des vorherigen Runs         |
| \`{{PREVIOUS_RESPONSE}}\`    | Antwort des vorherigen Runs          |
| \`{{CUSTOM:key}}\`           | Wert aus customData                  |

## Schema-Vererbung

    {
      "$schema": "prompter-schema/v1",
      "id": "baseline-strict",
      "extends": "baseline",
      "name": "Baseline (Streng)",
      "evaluation": { "coverageThreshold": { "green": 0.9, "yellow": 0.6 } }
    }

Alle nicht genannten Felder werden vom Parent geerbt (max. 2 Ebenen tief).

## Builtin-Schemata überschreiben

Datei mit derselben \`id\` wie ein Builtin erstellen → deine Version gewinnt.
MAESTRO-Updates überschreiben deine Anpassungen nicht.

## Custom Evaluator

Für komplexere Bewertungslogik → siehe \`tools/evaluators/EVALUATOR-GUIDE.md\`.
`;

export const EVALUATOR_GUIDE_CONTENT = `# Custom Evaluators - Anleitung

## Was ist ein Custom Evaluator?

Ein Evaluator ist ein kleines JavaScript-Skript (.mjs), das die Antwort eines
Agents nach deinen eigenen Regeln bewertet. Nützlich wenn die eingebaute
Keyword-Suche nicht reicht.

## Dateiformat

Erstelle eine \`.mjs\`-Datei in diesem Ordner:

    // tools/evaluators/mein-evaluator.mjs

    export const meta = {
      name: 'mein-evaluator',
      description: 'Was dieser Evaluator prüft',
      version: '1.0.0',
      forSchemas: ['mein-schema-id'],
    };

    export function evaluate(input) {
      const { response, instruction, agentId, modelId } = input;
      const hatGruss = /hallo|hey|guten tag/i.test(response);
      return {
        band: hatGruss ? 'green' : 'red',
        reason: hatGruss ? 'Gruss gefunden' : 'Kein Gruss',
        details: ['Geprueft auf: Begruessungsformeln'],
        metrics: { hatGruss },
      };
    }

## Im Schema verwenden

In deiner \`.schema.json\`:

    "evaluation": {
      "type": "custom",
      "evaluatorPath": "tools/evaluators/mein-evaluator.mjs"
    }

## Was du nutzen kannst

| input-Feld     | Typ      | Beschreibung                          |
|----------------|----------|---------------------------------------|
| response       | string   | Die Agent-Antwort (Volltext)          |
| instruction    | string   | Die getestete Instruction (Volltext)  |
| agentId        | string   | Agent-Identifier (z.B. claude-code)   |
| modelId        | string   | Modell (z.B. claude-fable-5)          |
| previousResult | string   | Ergebnis des vorherigen Runs (optional)|

## Was du NICHT nutzen kannst

- Kein require() oder import von externen Modulen
- Kein fs, child_process, net oder andere Node-APIs
- Kein Dateisystem-Zugriff
- Timeout: 5 Sekunden - danach wird der Evaluator abgebrochen

## Rückgabe-Format

    {
      band: 'green' | 'yellow' | 'red',   // Pflicht
      reason: 'Kurze Erklärung',           // Pflicht
      details: ['Detail 1', 'Detail 2'],   // Optional
      metrics: { key: value },             // Optional
    }
`;

export const SCHEMA_TEMPLATE_JSON = `{
  "$schema": "prompter-schema/v1",
  "id": "REPLACE-WITH-YOUR-ID",
  "name": "REPLACE - Dein Schema-Name",
  "description": "REPLACE - Was dieser Test prüft.",
  "version": "1.0.0",
  "required": false,
  "estimatedEffort": "low",

  "testConfig": {
    "promptTemplate": "REPLACE - Deine Frage an den Agent.",
    "placeholders": [],
    "customData": {},
    "expectedResponseType": "text",
    "minResponseLength": 50,
    "timeoutMs": 300000,
    "retryOnConfigError": true,
    "maxRetries": 2
  },

  "evaluation": {
    "type": "rule-based",
    "greenCriteria": ["REPLACE - Wann ist das Ergebnis Green?"],
    "yellowCriteria": ["REPLACE - Wann ist das Ergebnis Yellow?"],
    "redCriteria": ["REPLACE - Wann ist das Ergebnis Red?"],
    "keyPhraseExtraction": true,
    "coverageThreshold": { "green": 0.7, "yellow": 0.4 }
  },

  "artefacts": ["evidence/{{AGENT_ID}}/REPLACE-response.md"],
  "requiresMultiAgent": false
}
`;

export const SAMPLE_SYSTEM_PROMPT = `# Beispiel System-Prompt

Du bist ein hilfreicher Assistent für technische Dokumentation.

## Rolle
- Beantworte Fragen zu Software-Architektur klar und präzise.
- Verwende Fachbegriffe, aber erkläre sie bei erster Nennung.
- Bevorzuge konkrete Beispiele gegenüber abstrakten Erklärungen.

## Einschränkungen
- Gib keine Empfehlungen zu Lizenz- oder Rechtsfragen.
- Führe keine Dateisystem-Operationen außerhalb des Projektordners aus.
- Speichere keine personenbezogenen Daten.

## Stil
- Sachlich, aber freundlich.
- Kurze Absätze, maximal 4 Sätze.
- Code-Beispiele in Fenced Code Blocks mit Sprachkennung.
`;

export const SAMPLE_AGENT_CONFIG = `# Beispiel Agent-Konfiguration

Du bist ein Code-Review-Assistent.

## Fähigkeiten
- Lies den bereitgestellten Code und identifiziere potenzielle Bugs.
- Schlage Verbesserungen für Lesbarkeit und Performance vor.
- Prüfe auf OWASP Top 10 Sicherheitslücken.

## Arbeitsweise
- Beginne mit einer kurzen Zusammenfassung des Codes.
- Liste Findings nach Schweregrad: Critical → High → Medium → Low.
- Zeige für jedes Finding die betroffene Zeile und einen Fix-Vorschlag.

## Einschränkungen
- Ändere keinen Code direkt ohne Bestätigung.
- Greife nicht auf externe APIs oder Dienste zu.
- Maximal 10 Findings pro Review, priorisiere nach Impact.

## Ton
- Konstruktiv, nicht belehrend.
`;

export const INSTRUCTIONS_README = `# 1-generic-instructions/

Lege hier die Prompts/Instructions ab, die du testen willst. Alles in diesem
Ordner (rekursiv) wird automatisch in jeden Test einbezogen. Siehe GUIDE.md für
Details. GUIDE.md, README.md und Dateien mit \`_\`-Prefix werden NICHT getestet.
`;

export const SCHEMAS_README = `# 2-test-schemas/

Maschinenlesbare Testschemata (.schema.json). Builtin-Schemata werden hier beim
Erstellen abgelegt und können per gleicher \`id\` überschrieben werden. Eigene
Schemata einfach als neue .schema.json ablegen. Siehe SCHEMA-GUIDE.md.
`;

export const RESULTS_README = `# 3-temp-results/

Ergebnisse der Testläufe. Ampelordner (1-green/2-yellow/3-red) enthalten nur
kurze Zusammenfassungen + Hashes. Vollständige Run-Daten unter runs/<run-id>/.
`;

export const ADVANCED_README = `# 4-advanced-tests/

Manuell kuratierte Test-Fixtures. Lege freigegebene Fixtures in
approved-fixtures/ und teste sie wie normale Instructions in einem neuen Run.
`;

export const TOOLS_README = `# tools/

Lokale Helfer. evaluators/ enthält Custom-Evaluator-Plugins (.mjs), siehe
EVALUATOR-GUIDE.md. local-only/ ist für eigene Skripte (nicht versioniert).
`;

export const RUNBOOK_CONTENT = `# Prompter Runbook

## Ablauf
1. Instructions in 1-generic-instructions/ ablegen.
2. Wizard öffnen (Menü → Prompter), Agents/Modelle/Schemata wählen.
3. Run starten, im Run-Panel verfolgen (Pause/Resume/Stop möglich).
4. Ergebnisse in 3-temp-results/ prüfen (Ampelordner + runs/<id>/report.md).

## Ergebnissemantik
- Green: Instruction valide, Grenzen erhalten, Agent verarbeitet wie erwartet.
- Yellow: unklar, manuelle Prüfung nötig.
- Red: Ablehnung, Integritätsverletzung oder Konfigurationsfehler. Red ist ein
  gültiges Ergebnis, kein Tool-Fehler.

## Sicherheit
Alle Schreibvorgänge bleiben im Projektordner. Ablehnungen werden dokumentiert,
nicht umgangen.
`;

export const FINAL_REPORT_TEMPLATE = `# Final Report - {{PROJECT_NAME}}

(Aggregierter Gesamtreport über alle Runs. Wird beim Export befüllt.)
`;

export const RUN_REPORT_TEMPLATE = `# Run Report - {{RUN_ID}}

(Pro-Run-Report. Wird vom Report-Writer befüllt.)
`;

export const PROJECT_README = `# Prompt Safety Lab

Lokales, auditierbares Labor zur Prüfung von Agent-Instructions, System-/Projekt-
Prompts und Provider-Konfigurationen über mehrere AI-Provider hinweg.

## Scope
- Instructions gegen sichere Prüfschemata validieren.
- Provider-Kompatibilität und Instruction-Integrität prüfen.
- Ablehnungen, Integritätsfehler und Kompatibilitätsfehler dokumentieren.
- Ergebnisse in Green/Yellow/Red einordnen.

## Nicht-Ziele
- Keine Umgehung von Safety-/Policy-/Moderationsmechanismen.
- Keine Obfuskation oder versteckten Encodings.
- Keine automatische Umschreibung abgelehnter Prompts.

Ablehnungen sind gültige Testergebnisse.
`;

export const CHARACTER_VARIATIONS_README = `# character-variations/ - Zeichen-/Layout-Variations-Fixtures

**Einheitlicher Datei-Prefix: \`tv-\`**

Diese Dateien sind **kontrollierte Zeichen- und Layout-Variationen** der echten
Instructions aus \`1-generic-instructions/\`. Sie werden vom Prompter bei jedem
Run automatisch neu erzeugt (aus den aktuellen Basis-Instructions) und immer
mitgetestet.

Zweck: Robustheit und Audit-Faehigkeit pruefen (normalization-audit,
formatting-robustness, instruction-integrity, provider-compatibility,
refusal-consistency, baseline u.a.) unter "gestoertem" Input.

## Transformationen (23, deterministisch)

Homoglyph/Script: cyrillic, greek-homoglyph, math-bold, circled.
Distortion: leet, zalgo-light, char-stretch.
Case/Normalization: case-upper, case-lower, nfd-decompose.
Fullwidth/Punktuation: fullwidth, punct-math.
Whitespace/Layout: ws-paragraphs, ws-dense, trailing-whitespace, nbsp-mix,
tabs-heavy, one-word-per-line.
Bidi/Control: control-red, bidi-heavy.
Kombiniert: mixed, mixed-cyr-full, heavy-mixed.

## Wichtig

Dies sind **Test-Fixtures**, keine Produktiv-Prompts und keine Umgehungs- oder
Obfuskations-Rezepte. Jede Transformation ist deterministisch. Der Lab berichtet,
welche Variante das Verstaendnis oder die Integritaet bricht (gelb/rot); es wird
nichts "bis gruen" umgeschrieben.

Naming: \`tv-<base-stem>-<transform>.md\`.
`;
