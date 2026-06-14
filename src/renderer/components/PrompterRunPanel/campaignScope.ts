/**
 * Pure, qualitative scope estimate for an autonomous campaign.
 *
 * Deliberately NOT a cost or duration estimate: there is no reliable per-provider
 * token/pricing/timing model. We only report a concrete base task count
 * (agents x schemas, multiplied over iterations) and a coarse qualitative effort
 * bucket, so the operator gets a rough sense of magnitude without a fabricated
 * number. Variations and the pruef-agent (crafter) increase the real count
 * beyond the base, which the UI states explicitly.
 *
 * For security research and model robustness evaluation only.
 */

export type CampaignEffort = 'niedrig' | 'mittel' | 'hoch';

export interface CampaignScope {
	/** Base tasks per iteration: agents x schemas (before variations/crafter). */
	baseTasksPerIteration: number;
	/** Base tasks across all iterations (before variations/crafter). */
	totalBaseTasks: number;
	/** Coarse qualitative bucket derived from totalBaseTasks. */
	effort: CampaignEffort;
}

export function estimateCampaignScope(input: {
	agentCount: number;
	schemaCount: number;
	maxIterations: number;
}): CampaignScope {
	const agents = Math.max(0, Math.floor(input.agentCount));
	const schemas = Math.max(0, Math.floor(input.schemaCount));
	const iterations = Math.max(1, Math.floor(input.maxIterations));

	const baseTasksPerIteration = agents * schemas;
	const totalBaseTasks = baseTasksPerIteration * iterations;

	let effort: CampaignEffort = 'niedrig';
	if (totalBaseTasks > 120) effort = 'hoch';
	else if (totalBaseTasks > 30) effort = 'mittel';

	return { baseTasksPerIteration, totalBaseTasks, effort };
}
