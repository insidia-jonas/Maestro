/**
 * Tests for prompter-model-discovery.ts — wraps AgentDetector.discoverModels
 * with a timeout and Prompter-local cache, never throwing.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PrompterModelDiscovery } from '../../../main/prompter/prompter-model-discovery';
import type { AgentDetector } from '../../../main/agents/detector';

function fakeDetector(discover: (id: string) => Promise<string[]>): AgentDetector {
	return { discoverModels: vi.fn(discover) } as unknown as AgentDetector;
}

describe('PrompterModelDiscovery', () => {
	it('maps discovered models to options tagged cli-discovery', async () => {
		const disc = new PrompterModelDiscovery({
			getAgentDetector: () => fakeDetector(async () => ['opus', 'fable']),
		});
		const opts = await disc.getModelOptions('claude-code');
		expect(opts).toEqual([
			{ id: 'opus', label: 'opus', source: 'cli-discovery' },
			{ id: 'fable', label: 'fable', source: 'cli-discovery' },
		]);
	});

	it('returns an empty list (never throws) when no detector is available', async () => {
		const disc = new PrompterModelDiscovery({ getAgentDetector: () => null });
		await expect(disc.getModelOptions('claude-code')).resolves.toEqual([]);
	});

	it('falls back to the cache (tagged cache) when discovery later fails', async () => {
		let call = 0;
		const disc = new PrompterModelDiscovery({
			getAgentDetector: () =>
				fakeDetector(async () => {
					call++;
					if (call === 1) return ['opus'];
					throw new Error('boom');
				}),
		});
		const first = await disc.getModelOptions('claude-code');
		expect(first[0].source).toBe('cli-discovery');
		const second = await disc.getModelOptions('claude-code', true); // force refresh -> fails
		expect(second[0]).toEqual({ id: 'opus', label: 'opus', source: 'cache' });
	});
});
