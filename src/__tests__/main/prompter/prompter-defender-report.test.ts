/**
 * Tests for the defensive robustness findings + Defender Gap Report. Verifies
 * that breakage (yellow/red) drives the findings, that held (green) variations
 * are not findings, and that the report lists technique classes + fixes (and no
 * "winning"/token-ranking notion).
 */

import { describe, it, expect } from 'vitest';
import {
	computeRobustnessFindings,
	computeConsistencyMatrix,
	computeHardeningSuggestions,
} from '../../../shared/prompter-robustness';
import { buildDefenderGapReport } from '../../../main/prompter/prompter-defender-report';
import type { PrompterRun, PrompterTask, PrompterResultBand } from '../../../shared/prompter-types';

const VAR = '4-advanced-tests/character-variations';

function task(
	id: string,
	instructionFile: string,
	result: PrompterResultBand,
	schemaId = 'baseline',
	modelId = 'm'
): PrompterTask {
	return {
		id,
		runId: 'r1',
		agentId: 'claude-code',
		modelId,
		schemaId,
		instructionFile,
		instructionHash: 'h',
		status: 'completed',
		result,
	};
}

function run(tasks: PrompterTask[]): PrompterRun {
	return {
		id: 'run-x',
		projectId: 'p',
		projectRoot: '/tmp/lab',
		status: 'completed',
		phase: 'report',
		agents: [],
		schemas: [],
		tasks,
		maxParallelAgents: 4,
		createdAt: 1,
		updatedAt: 1,
	};
}

describe('computeRobustnessFindings', () => {
	it('lists only broken (yellow/red) variations as hardening opportunities', () => {
		const tasks = [
			task('1', `${VAR}/tv-eni-cyrillic.md`, 'red'),
			task('2', `${VAR}/tv-eni-cyrillic.md`, 'yellow', 'safety-boundary'),
			task('3', `${VAR}/tv-eni-bidi-heavy.md`, 'yellow'),
			task('4', `${VAR}/tv-eni-fullwidth.md`, 'green'), // held -> not a finding
			task('5', '1-generic-instructions/eni.md', 'green'), // base -> ignored
		];
		const { total, held, broke, findings } = computeRobustnessFindings(tasks);
		expect(total).toBe(4); // 4 variation tasks
		expect(held).toBe(1);
		expect(broke).toBe(3);
		const transforms = findings.map((f) => f.transform);
		expect(transforms).toContain('cyrillic');
		expect(transforms).toContain('bidi-heavy');
		expect(transforms).not.toContain('fullwidth'); // held
		// cyrillic worst = red (one red, one yellow), count 2, two schemas
		const cyr = findings.find((f) => f.transform === 'cyrillic')!;
		expect(cyr.worst).toBe('red');
		expect(cyr.count).toBe(2);
		expect(cyr.schemas.sort()).toEqual(['baseline', 'safety-boundary']);
		// red findings sort before yellow
		expect(findings[0].worst).toBe('red');
	});

	it('reports zero findings when everything held', () => {
		const { findings, broke } = computeRobustnessFindings([
			task('1', `${VAR}/tv-eni-cyrillic.md`, 'green'),
		]);
		expect(broke).toBe(0);
		expect(findings).toHaveLength(0);
	});
});

describe('buildDefenderGapReport', () => {
	it('renders a gap table + deduped fix list, no "winning"/token ranking', () => {
		const md = buildDefenderGapReport(
			run([
				task('1', `${VAR}/tv-eni-cyrillic.md`, 'red'),
				task('2', `${VAR}/tv-eni-bidi-heavy.md`, 'yellow'),
				task('3', `${VAR}/tv-eni-fullwidth.md`, 'green'),
			])
		);
		expect(md).toContain('# Defender Gap Report');
		expect(md).toContain('## Gap-Befunde');
		expect(md).toContain('cyrillic');
		expect(md).toContain('Bidi / Control');
		expect(md).toContain('## Empfohlene Normalizer-Haertung');
		// defensive: no offensive vocabulary
		expect(md.toLowerCase()).not.toContain('winning');
		expect(md.toLowerCase()).not.toContain('besttransform');
		expect(md.toLowerCase()).not.toContain('tokendelta');
		expect(md).not.toContain('promote');
	});

	it('says the instruction held when there are no breaks', () => {
		const md = buildDefenderGapReport(run([task('1', `${VAR}/tv-eni-cyrillic.md`, 'green')]));
		expect(md).toContain('Keine Brueche');
	});
});

describe('computeConsistencyMatrix', () => {
	it('aggregates per model x transform-class with the worst band', () => {
		const tasks = [
			task('1', '1-generic-instructions/eni.md', 'green', 'baseline', 'opus'), // Base
			task('2', `${VAR}/tv-eni-cyrillic.md`, 'green', 'baseline', 'opus'),
			task('3', `${VAR}/tv-eni-greek-homoglyph.md`, 'red', 'safety-boundary', 'opus'), // Homoglyph break
			task('4', `${VAR}/tv-eni-cyrillic.md`, 'green', 'baseline', 'sonnet'),
		];
		const m = computeConsistencyMatrix(tasks);
		expect(m.models.sort()).toEqual(['opus', 'sonnet']);
		expect(m.classes).toContain('Base');
		expect(m.classes).toContain('Homoglyph / Script');
		const opusHomoglyph = m.cells.find(
			(c) => c.model === 'opus' && c.klass === 'Homoglyph / Script'
		)!;
		// opus saw cyrillic green + greek red under Homoglyph -> worst red, 1/2 held
		expect(opusHomoglyph.worst).toBe('red');
		expect(opusHomoglyph.green).toBe(1);
		expect(opusHomoglyph.total).toBe(2);
		// 'Base' class first
		expect(m.classes[0]).toBe('Base');
		// consistencyScore is a percentage 0..100
		expect(m.consistencyScore).toBeGreaterThanOrEqual(0);
		expect(m.consistencyScore).toBeLessThanOrEqual(100);
	});
});

describe('computeHardeningSuggestions', () => {
	it('derives benign clarity/structure suggestions from broken classes, never obfuscation', () => {
		const suggestions = computeHardeningSuggestions([
			task('1', `${VAR}/tv-eni-cyrillic.md`, 'red'), // Homoglyph / Script
			task('2', `${VAR}/tv-eni-ws-dense.md`, 'yellow'), // Whitespace
			task('3', `${VAR}/tv-eni-fullwidth.md`, 'green'), // held -> no suggestion
		]);
		const categories = suggestions.map((s) => s.category);
		expect(categories).toContain('Homoglyph / Script');
		expect(categories).toContain('Whitespace');
		// always includes a generic clarity reminder
		expect(categories).toContain('Klarheit');
		// defensive: never recommends an evasion technique
		const blob = suggestions
			.map((s) => s.text)
			.join(' ')
			.toLowerCase();
		expect(blob).not.toContain('homoglyphe einbau');
		expect(blob).not.toContain('self-reference');
		expect(blob).not.toContain('obfusk');
		// the homoglyph advice explicitly tells the author NOT to embed homoglyphs
		const homo = suggestions.find((s) => s.category === 'Homoglyph / Script')!;
		expect(homo.text.toLowerCase()).toContain('keine homoglyphen');
	});

	it('adds a refusal-consistency suggestion when the boundary held inconsistently', () => {
		const suggestions = computeHardeningSuggestions([
			task('1', `${VAR}/tv-eni-cyrillic.md`, 'green', 'baseline', 'opus'),
			task('2', `${VAR}/tv-eni-cyrillic.md`, 'red', 'baseline', 'sonnet'),
		]);
		expect(suggestions.some((s) => s.category === 'Refusal-Konsistenz')).toBe(true);
	});

	it('still returns the generic clarity reminder when everything held', () => {
		const suggestions = computeHardeningSuggestions([
			task('1', `${VAR}/tv-eni-cyrillic.md`, 'green', 'baseline', 'opus'),
		]);
		expect(suggestions.map((s) => s.category)).toEqual(['Klarheit']);
	});
});
