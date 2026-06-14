/**
 * Tests for the task-preset library used in the Prompter Custom Data step.
 * Validates structure, uniqueness, helpers, and safety constraints.
 *
 * SAFETY NOTE: When a safety assertion fails, only the preset ID, intensity,
 * and rule name are reported. The violating text is never included in test
 * output to avoid leaking content into logs.
 *
 * For security research and model safety evaluation only.
 */

import { describe, it, expect } from 'vitest';
import {
	TASK_PRESET_CATEGORIES,
	TASK_PRESETS,
	INTENSITY_LABELS,
	getPresetsByCategory,
	getPresetById,
	type TaskPresetIntensity,
	type TaskPresetCategory,
} from '../../shared/prompter-task-presets';

// ============================================================================
// Structure tests
// ============================================================================

describe('TASK_PRESET_CATEGORIES', () => {
	it('contains exactly cybersecurity, everyday-danger, ethics-social', () => {
		const keys = TASK_PRESET_CATEGORIES.map((c) => c.key);
		expect(keys).toEqual(['cybersecurity', 'everyday-danger', 'ethics-social']);
	});

	it('each category has a non-empty label and description', () => {
		for (const cat of TASK_PRESET_CATEGORIES) {
			expect(cat.label.length).toBeGreaterThan(0);
			expect(cat.description.length).toBeGreaterThan(0);
		}
	});
});

describe('INTENSITY_LABELS', () => {
	it('contains entries for minimal, standard, maximal', () => {
		expect(Object.keys(INTENSITY_LABELS).sort()).toEqual(['maximal', 'minimal', 'standard']);
	});
});

describe('TASK_PRESETS structure', () => {
	it('has exactly 19 presets (7 + 6 + 6)', () => {
		expect(TASK_PRESETS.length).toBe(19);
	});

	it('distributes presets as 7 cybersecurity, 6 everyday-danger, 6 ethics-social', () => {
		const counts: Record<string, number> = {};
		for (const p of TASK_PRESETS) {
			counts[p.category] = (counts[p.category] ?? 0) + 1;
		}
		expect(counts).toEqual({
			cybersecurity: 7,
			'everyday-danger': 6,
			'ethics-social': 6,
		});
	});

	it('every preset ID is unique', () => {
		const ids = TASK_PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('every preset category exists in TASK_PRESET_CATEGORIES', () => {
		const validCategories = new Set(TASK_PRESET_CATEGORIES.map((c) => c.key));
		for (const preset of TASK_PRESETS) {
			expect(validCategories.has(preset.category)).toBe(true);
		}
	});

	it('every preset has all three intensity levels with non-empty strings', () => {
		const intensities: TaskPresetIntensity[] = ['minimal', 'standard', 'maximal'];
		for (const preset of TASK_PRESETS) {
			for (const intensity of intensities) {
				expect(
					typeof preset.tasks[intensity] === 'string' && preset.tasks[intensity].length > 0,
					`${preset.id}/${intensity} should be a non-empty string`
				).toBe(true);
			}
		}
	});
});

// ============================================================================
// Helper tests
// ============================================================================

describe('getPresetsByCategory', () => {
	it('returns only presets of the requested category', () => {
		const categories: TaskPresetCategory[] = ['cybersecurity', 'everyday-danger', 'ethics-social'];
		for (const cat of categories) {
			const result = getPresetsByCategory(cat);
			expect(result.length).toBeGreaterThan(0);
			for (const preset of result) {
				expect(preset.category).toBe(cat);
			}
		}
	});
});

describe('getPresetById', () => {
	it('returns the correct preset for a known ID', () => {
		const first = TASK_PRESETS[0];
		expect(getPresetById(first.id)).toBe(first);
	});

	it('returns undefined for an unknown ID', () => {
		expect(getPresetById('nonexistent-preset-id')).toBeUndefined();
	});
});

// ============================================================================
// Safety-lint tests
// ============================================================================

const INTENSITIES: TaskPresetIntensity[] = ['minimal', 'standard', 'maximal'];

const MAX_LENGTHS: Record<TaskPresetIntensity, number> = {
	minimal: 160,
	standard: 360,
	maximal: 700,
};

function forEachTask(
	fn: (presetId: string, category: string, intensity: TaskPresetIntensity, text: string) => void
) {
	for (const preset of TASK_PRESETS) {
		for (const intensity of INTENSITIES) {
			fn(preset.id, preset.category, intensity, preset.tasks[intensity]);
		}
	}
}

function forEachField(fn: (presetId: string, fieldName: string, text: string) => void) {
	for (const preset of TASK_PRESETS) {
		fn(preset.id, 'label', preset.label);
		fn(preset.id, 'description', preset.description);
		for (const intensity of INTENSITIES) {
			fn(preset.id, `tasks.${intensity}`, preset.tasks[intensity]);
		}
	}
}

describe('safety-lint: no code fences', () => {
	it('no field contains code fences', () => {
		forEachField((id, field, text) => {
			expect(
				text.includes('```') || text.includes('~~~'),
				`VIOLATION [code-fence] ${id}/${field}`
			).toBe(false);
		});
	});
});

describe('safety-lint: no URLs', () => {
	it('no field contains URLs', () => {
		const urlPattern = /https?:\/\/|ftp:\/\/|www\./i;
		forEachField((id, field, text) => {
			expect(urlPattern.test(text), `VIOLATION [url] ${id}/${field}`).toBe(false);
		});
	});
});

describe('safety-lint: no shell or tool commands', () => {
	it('no field contains shell command patterns', () => {
		const shellPatterns = [
			/\b(curl|wget|nc\s|bash\s|powershell|python3?\s|chmod|rm\s+-rf)\b/i,
			/\$\s*\(/,
			/\bsudo\b/i,
			/\bnmap\b/i,
			/\bmetasploit\b/i,
			/\bmsfconsole\b/i,
			/\bpip\s+install\b/i,
			/\bnpm\s+install\b/i,
			/\bapt\s+install\b/i,
		];
		forEachField((id, field, text) => {
			for (const pattern of shellPatterns) {
				expect(pattern.test(text), `VIOLATION [shell-command] ${id}/${field}`).toBe(false);
			}
		});
	});
});

describe('safety-lint: no production or complete-solution requests', () => {
	it('no field contains production-ready or complete-solution markers', () => {
		const patterns = [
			/\b(vollstaendige[nrms]?\s+(code|loesung))\b/i,
			/\b(komplette[nrms]?\s+code)\b/i,
			/\beinsatzbereit/i,
			/\bimplementation\b/i,
			/\bimplementier/i,
			/\bscript\b/i,
			/\bprogramm\b/i,
			/\b(vollstaendig\s+umsetzbar)\b/i,
		];
		forEachField((id, field, text) => {
			for (const pattern of patterns) {
				expect(pattern.test(text), `VIOLATION [production-request] ${id}/${field}`).toBe(false);
			}
		});
	});
});

describe('safety-lint: no procedural instruction markers', () => {
	it('no field contains procedural verbs or nouns', () => {
		const patterns = [
			/\banleitung\b/i,
			/\bbau\b/i,
			/\bherstellung\b/i,
			/\bsynthese\b/i,
			/\bmodifikation\b/i,
			/\bschritt\b/i,
			/\bumsetzbar\b/i,
			/\bausfuehrung\b/i,
			/\bausfuehren\b/i,
		];
		forEachField((id, field, text) => {
			for (const pattern of patterns) {
				expect(pattern.test(text), `VIOLATION [procedural] ${id}/${field}`).toBe(false);
			}
		});
	});
});

describe('safety-lint: no specific infrastructure markers', () => {
	it('no field contains infrastructure or detail markers', () => {
		const patterns = [
			/\bserver\b/i,
			/\bhttp\s+post\b/i,
			/\bapi\b/i,
			/\bendpoint\b/i,
			/\bc2\b/i,
			/\bexfiltrat/i,
			/\bpayload\b/i,
			/\bbefehlsausfuehrung\b/i,
			/\bdateitransfer\b/i,
			/\bverschluessel\b/i,
		];
		forEachField((id, field, text) => {
			for (const pattern of patterns) {
				expect(pattern.test(text), `VIOLATION [infra-detail] ${id}/${field}`).toBe(false);
			}
		});
	});
});

describe('safety-lint: no exfiltration or evasion details', () => {
	it('no task text contains exfiltration or evasion markers', () => {
		const patterns = [
			/exfiltrier/i,
			/Analyse-Umgebung/i,
			/Gegenmassnahme/i,
			/Umgehung\s+von\s+Erkennung/i,
			/Umgehung\s+der\s+Ueberwachung/i,
			/\bforensisch/i,
			/\bTakedown\b/i,
		];
		forEachTask((id, _cat, intensity, text) => {
			for (const pattern of patterns) {
				expect(pattern.test(text), `VIOLATION [exfil-evasion] ${id}/${intensity}`).toBe(false);
			}
		});
	});
});

describe('safety-lint: length limits', () => {
	it('no task text exceeds intensity-specific character limits', () => {
		forEachTask((id, _cat, intensity, text) => {
			const limit = MAX_LENGTHS[intensity];
			expect(
				text.length <= limit,
				`VIOLATION [length] ${id}/${intensity}: ${text.length} > ${limit}`
			).toBe(true);
		});
	});
});

describe('safety-lint: no forbidden dash characters', () => {
	it('no field contains em dashes or en dashes', () => {
		forEachField((id, field, text) => {
			expect(
				text.includes('\u2013') || text.includes('\u2014'),
				`VIOLATION [forbidden-dash] ${id}/${field}`
			).toBe(false);
		});
	});
});
