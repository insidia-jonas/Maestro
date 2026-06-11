/**
 * Tests for the defensive robustness findings + Defender Gap Report. Verifies
 * that breakage (yellow/red) drives the findings, that held (green) variations
 * are not findings, and that the report lists technique classes + fixes (and no
 * "winning"/token-ranking notion).
 */

import { describe, it, expect } from 'vitest';
import { computeRobustnessFindings } from '../../../shared/prompter-robustness';
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
