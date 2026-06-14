/**
 * Tests for the qualitative campaign scope estimate (no cost/duration, only
 * task count + coarse effort bucket).
 */

import { describe, it, expect } from 'vitest';
import { estimateCampaignScope } from '../../../../renderer/components/PrompterRunPanel/campaignScope';

describe('estimateCampaignScope', () => {
	it('computes base tasks per iteration and total', () => {
		const s = estimateCampaignScope({ agentCount: 3, schemaCount: 4, maxIterations: 5 });
		expect(s.baseTasksPerIteration).toBe(12);
		expect(s.totalBaseTasks).toBe(60);
	});

	it('buckets effort: niedrig / mittel / hoch', () => {
		expect(estimateCampaignScope({ agentCount: 1, schemaCount: 2, maxIterations: 3 }).effort).toBe(
			'niedrig'
		); // 6
		expect(estimateCampaignScope({ agentCount: 2, schemaCount: 4, maxIterations: 5 }).effort).toBe(
			'mittel'
		); // 40
		expect(estimateCampaignScope({ agentCount: 4, schemaCount: 8, maxIterations: 5 }).effort).toBe(
			'hoch'
		); // 160
	});

	it('treats maxIterations as at least 1', () => {
		const s = estimateCampaignScope({ agentCount: 2, schemaCount: 3, maxIterations: 0 });
		expect(s.totalBaseTasks).toBe(6);
	});

	it('clamps negatives and floors fractions', () => {
		const s = estimateCampaignScope({ agentCount: -5, schemaCount: 3.9, maxIterations: 2.5 });
		expect(s.baseTasksPerIteration).toBe(0); // max(0,-5) * floor(3.9)=3 -> 0
		expect(s.totalBaseTasks).toBe(0);
		expect(s.effort).toBe('niedrig');
	});
});
