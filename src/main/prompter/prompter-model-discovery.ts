/**
 * @file prompter-model-discovery.ts
 * @description Thin wrapper around AgentDetector.discoverModels() that adds a
 * hard timeout (playbook section 12: model discovery = 10s) and a Prompter-local
 * cache, returning PrompterModelOption[] for the wizard. Never throws: on any
 * failure it falls back to the last cached result, or an empty list (the wizard
 * then lets the user type a model manually).
 *
 * Playbook reference: sections 8 (Task B), 12 (timeouts).
 */

import { logger } from '../utils/logger';
import type { AgentDetector } from '../agents/detector';
import type { PrompterModelOption } from '../../shared/prompter-types';

const LOG = 'PrompterModelDiscovery';
const DISCOVERY_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Known full model IDs offered as extra combobox suggestions on top of CLI
 * discovery (which often returns only aliases like "opus"/"sonnet"). The user
 * can still type any other version. Keep this short and current.
 */
const CURATED_MODELS: Record<string, string[]> = {
	'claude-code': [
		'claude-opus-4-8',
		'claude-opus-4-6',
		'claude-sonnet-4-6',
		'claude-haiku-4-5',
		'claude-fable-5',
	],
};

function mergeCurated(agentId: string, options: PrompterModelOption[]): PrompterModelOption[] {
	const curated = CURATED_MODELS[agentId];
	if (!curated) return options;
	const have = new Set(options.map((o) => o.id));
	const extra = curated
		.filter((id) => !have.has(id))
		.map((id): PrompterModelOption => ({ id, label: id, source: 'api' }));
	return [...options, ...extra];
}

export interface ModelDiscoveryDeps {
	getAgentDetector: () => AgentDetector | null;
}

interface CacheEntry {
	options: PrompterModelOption[];
	timestamp: number;
}

export class PrompterModelDiscovery {
	private cache = new Map<string, CacheEntry>();

	constructor(private deps: ModelDiscoveryDeps) {}

	/**
	 * Return the model options for an agent. Uses the live AgentDetector when
	 * available (10s timeout), otherwise the Prompter-local cache or an empty
	 * list. Marks the source so the UI can show how each option was obtained.
	 */
	async getModelOptions(agentId: string, forceRefresh = false): Promise<PrompterModelOption[]> {
		if (!forceRefresh) {
			const cached = this.cache.get(agentId);
			if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
				return cached.options;
			}
		}

		const detector = this.deps.getAgentDetector();
		if (!detector) {
			logger.warn(`No AgentDetector available for model discovery (${agentId})`, LOG);
			return this.cachedOrEmpty(agentId);
		}

		try {
			const models = await withTimeout(
				detector.discoverModels(agentId, forceRefresh),
				DISCOVERY_TIMEOUT_MS
			);
			const discovered: PrompterModelOption[] = models.map((id) => ({
				id,
				label: id,
				source: 'cli-discovery',
			}));
			const options = mergeCurated(agentId, discovered);
			this.cache.set(agentId, { options, timestamp: Date.now() });
			logger.info(`Discovered ${discovered.length} models for ${agentId}`, LOG);
			return options;
		} catch (error) {
			logger.warn(`Model discovery failed for ${agentId}; using fallback`, LOG, { error });
			return this.cachedOrEmpty(agentId);
		}
	}

	/** Drop the Prompter-local cache (the detector keeps its own). */
	clearCache(agentId?: string): void {
		if (agentId) this.cache.delete(agentId);
		else this.cache.clear();
	}

	private cachedOrEmpty(agentId: string): PrompterModelOption[] {
		const cached = this.cache.get(agentId);
		if (cached) {
			return cached.options.map((o) => ({ ...o, source: 'cache' }));
		}
		// No detector and no cache: still surface curated suggestions so the user
		// can pick a known version (or type any other).
		return mergeCurated(agentId, []);
	}
}

/** Reject after `ms` if the wrapped promise has not settled. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`Model discovery timed out after ${ms}ms`)),
			ms
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			}
		);
	});
}
