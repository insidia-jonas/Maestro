/**
 * @file generateModeratorPrompt.ts
 * @description Generate a German moderator system-prompt (markdown) for a group
 * chat from the wizard's inputs. Mirrors the structure of the existing INSIDIA
 * moderator files in ~/.maestro/prompts/ (Rolle / Topologie / Teilnehmer /
 * Routing / Antwort-Format / Sprache / Projekt-Kontext). When a gemini-cli
 * participant is docked it is woven in the same way as the hand-written files:
 * a Topologie note, a dedicated Teilnehmer block, and a routing row.
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

	// The Gemini research agent gets its own dedicated Teilnehmer block (below),
	// so it is excluded from the generic specialist list to avoid listing it twice.
	const gemini = participants.find((p) => p.agentId === 'gemini-cli');
	const specialists = participants.filter((p) => p.agentId !== 'gemini-cli');

	const participantBlocks = specialists
		.map((p) => {
			const cwd = p.cwd ? ` · cwd \`${p.cwd}\`` : '';
			return `## ${mention(p)} (${getAgentDisplayName(p.agentId)}${cwd})\n${roleFor(p)}`;
		})
		.join('\n\n');

	const routingRows = [
		...specialists.map((p) => `| ${roleFor(p)} | ${mention(p)} |`),
		// Gemini routes on research/doc signal words, not its role text.
		...(gemini
			? [`| "Recherche", "aktuelle Version", "CVE", "Docs", "Stand zu X" | ${mention(gemini)} |`]
			: []),
	].join('\n');

	const geminiBlock = gemini
		? `\n\n## ${mention(gemini)} (Gemini 3 Pro, LOKAL) — Research & Dokumentation\n` +
			`- AUSSCHLIESSLICH Web-Recherche & Dokumentation, kein Implementierer\n` +
			`- Live-Google-Search-Grounding → liefert zitierte Quellen\n` +
			`- Läuft LOKAL auf der Maestro-VM, hat das Repo NICHT ausgecheckt → Kontext in ` +
			`der Nachricht mitgeben, Spezialisten setzen die Findings um\n` +
			`- Für: aktuelle Tool-/Library-Versionen, CVEs/Advisories, Release-Notes, ` +
			`API-Änderungen, Hersteller-Docs; Doku (READMEs, Runbooks, Threat-Models, Reports) ` +
			`aus den Ergebnissen der Spezialisten\n` +
			`- NICHT als Faktencheck-Ersatz, NICHT für Repo-Code/Build/Test`
		: '';

	// Topology note for the local Gemini agent (mirrors the hand-written files).
	const geminiTopology = gemini
		? `\n- ${mention(gemini)} (Gemini 3 Pro) ist der Research-/Doku-Agent. Er läuft LOKAL ` +
			`auf der Maestro-VM (kein SSH) mit Live-Google-Search-Grounding und hat das ` +
			`Projekt-Repo NICHT ausgecheckt — er recherchiert und dokumentiert, setzt aber ` +
			`keinen Repo-Code um.`
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
  antworten auf deine Delegationen.${geminiTopology}

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
