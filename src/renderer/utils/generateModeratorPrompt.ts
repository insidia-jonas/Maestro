/**
 * @file generateModeratorPrompt.ts
 * @description Generate a German moderator system-prompt (markdown) for a group
 * chat from the wizard's inputs. Mirrors the structure of the existing INSIDIA
 * moderator files in ~/.maestro/prompts/ (Rolle / Topologie / Teilnehmer /
 * Routing / Antwort-Format / Sprache / Projekt-Kontext) and appends a Gemini
 * research-routing block when a gemini-cli participant is docked.
 *
 * The file is written to ~/.maestro/prompts/moderator-<slug>.md and referenced
 * from the group chat's moderatorConfig via `--system-prompt-file`.
 */

import { normalizeMentionName } from '../../shared/group-chat-types';
import { getAgentDisplayName } from '../../shared/agentMetadata';

export interface WizardParticipant {
	/** Session name; becomes the @mention and must match the docked session. */
	name: string;
	/** Agent tool type, e.g. 'claude-code', 'gemini-cli'. */
	agentId: string;
	/** Working directory of the session (shown for context). */
	cwd?: string;
}

export interface GenerateModeratorPromptInput {
	groupName: string;
	/** Moderator model label, e.g. 'opus' / 'claude-opus-4-8'. */
	moderatorModel?: string;
	participants: WizardParticipant[];
	/** Free-text project description / tech stack from the user. */
	description?: string;
}

/** Turn a group name into a filesystem-safe slug for the prompt filename. */
export function slugifyGroupName(name: string): string {
	return (
		name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'group'
	);
}

/** The prompt filename (not path) for a group, e.g. "moderator-my-group.md". */
export function moderatorPromptFilename(groupName: string): string {
	return `moderator-${slugifyGroupName(groupName)}.md`;
}

// Derive a short German role line from the session-name suffix (best-effort).
const ROLE_BY_SUFFIX: Record<string, string> = {
	architect: 'Architektur, Cross-Cutting Concerns, ADRs',
	backend: 'Server / API / Persistenz',
	frontend: 'UI / SPA / Komponenten',
	'report-ai': 'KI-Integration / Prompts / Report-Pipelines',
	devops: 'Deploy / CI / systemd / Cloud / Backups',
	ops: 'Betrieb / Tooling / Automatisierung',
	modules: 'Module / Erweiterungen',
	toolkit: 'Toolkit / Tooling',
	c2: 'C2 / Steuerung',
	research: 'Recherche / Analyse',
	critic: 'Review / Second Opinion (kein Implementierer)',
	codex: 'Cross-Model Second Opinion (Codex)',
	grok: 'Cross-Model Second Opinion (Grok)',
	copilot: 'Cross-Model Second Opinion (Copilot)',
	gemini: 'Web-Recherche (Google Grounding) & Dokumentation, LOKAL ohne Repo-Checkout',
};

function roleFor(participant: WizardParticipant): string {
	const tokens = participant.name.toLowerCase().split('-');
	for (let i = tokens.length - 1; i >= 0; i--) {
		const two = tokens.slice(i).join('-');
		if (ROLE_BY_SUFFIX[two]) return ROLE_BY_SUFFIX[two];
	}
	const last = tokens[tokens.length - 1];
	if (last && ROLE_BY_SUFFIX[last]) return ROLE_BY_SUFFIX[last];
	if (participant.agentId === 'gemini-cli') return ROLE_BY_SUFFIX.gemini;
	return `Spezialist (${getAgentDisplayName(participant.agentId)})`;
}

export function generateModeratorPrompt(input: GenerateModeratorPromptInput): string {
	const { groupName, moderatorModel, participants, description } = input;
	const mention = (p: WizardParticipant) => `@${normalizeMentionName(p.name)}`;

	const participantBlocks = participants
		.map((p) => {
			const cwd = p.cwd ? ` · cwd \`${p.cwd}\`` : '';
			return `## ${mention(p)} (${getAgentDisplayName(p.agentId)}${cwd})\n${roleFor(p)}`;
		})
		.join('\n\n');

	const routingRows = participants.map((p) => `| ${roleFor(p)} | ${mention(p)} |`).join('\n');

	const gemini = participants.find((p) => p.agentId === 'gemini-cli');
	const geminiBlock = gemini
		? `\n\n## Gemini-Research-Agent (${mention(gemini)})\n\n` +
			`Live-Google-Search-Grounding (zitierte Quellen). Routing:\n\n` +
			`- Externes/aktuelles Wissen (Tool-/Library-Versionen, CVEs, Advisories, ` +
			`Release-Notes, API-Änderungen, Hersteller-Docs, "aktueller Stand zu X") → ` +
			`zuerst an ${mention(gemini)}; zitierte Findings an die Spezialisten zum Umsetzen.\n` +
			`- Dokumentation (READMEs, Design-Docs, Runbooks, Threat-Models, Reports) → ` +
			`${mention(gemini)}.\n` +
			`- ${mention(gemini)} läuft LOKAL ohne Repo-Checkout: nicht zum Lesen/Bauen/` +
			`Editieren von Repo-Dateien einsetzen, Kontext in der Nachricht mitgeben.\n` +
			`- Reine Code-/Build-/Test-Arbeit ohne externen Wissens- oder Doku-Anteil: ` +
			`${mention(gemini)} NICHT einbinden.`
		: '';

	const modelLine = moderatorModel ? ` (Modell: ${moderatorModel})` : '';

	return `# Rolle

Du bist der Moderator der ${groupName}-Gruppe${modelLine}. Du implementierst NICHT
selbst. Deine Aufgabe ist, eingehende Anfragen zu zerlegen, an die passenden
Teilnehmer zu routen, deren Antworten zu integrieren und das Ergebnis dem User
zurückzugeben.

# Topologie

- DU läufst als Moderator-Prozess und hast keinen direkten Code-Zugriff.
- Die Teilnehmer arbeiten je in ihrem eigenen Projekt-/Codebase-Kontext und
  antworten auf deine Delegationen.

# Teilnehmer und Zuständigkeiten

${participantBlocks || '(Noch keine Teilnehmer angedockt.)'}${geminiBlock}

# Routing-Logik

Eindeutige Domain → genau ein Mention. Nicht zerstückeln, was ein Teilnehmer in
einer Antwort behandeln kann. Parallel-Routing nur, wenn die Sub-Tasks wirklich
unabhängig sind.

| Anfrage-Signal | Routing |
| -------------- | ------- |
${routingRows || '| (keine Teilnehmer) | - |'}

# Antwort-Format

## An die Teilnehmer (Mentions)
- Klar, knapp, mit konkreter Frage am Ende.
- Nur den Kontext liefern, der für die jeweilige Rolle nötig ist.

## An den User (Synthese)
- Mit einer Ein-Satz-Zusammenfassung beginnen.
- Strukturierte Findings, wenn mehrere Teilnehmer geantwortet haben.
- Bei Konflikt zwischen Teilnehmern: Konflikt explizit benennen, NICHT auflösen
  (User-Entscheidung).

# Verhaltens-Regeln

1. Du fragst NIE den User, an welchen Agent etwas gehen soll - das ist deine Aufgabe.
2. Du redest NIE selbst in Code; Code kommt wortwörtlich von einem Teilnehmer.
3. Eskaliere sofort an den User bei irreversiblen oder external-sichtbaren Aktionen
   (\`git push\`, Release, Mail-Versand, externe API-Calls über Test hinaus).

# Sprache

Standardsprache ist Deutsch. Code, Bezeichner, Commit-Messages und Pfade bleiben
Englisch.

# Projekt-Kontext ${groupName}

${description?.trim() || '(Keine Projektbeschreibung angegeben.)'}
`;
}
