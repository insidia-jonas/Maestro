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
	it('maps discovered models to options tagged cli-discovery (codex has no curated set)', async () => {
		const disc = new PrompterModelDiscovery({
			getAgentDetector: () => fakeDetector(async () => ['o3', 'o4-mini']),
		});
		const opts = await disc.getModelOptions('codex');
		expect(opts).toEqual([
			{ id: 'o3', label: 'o3', source: 'cli-discovery' },
			{ id: 'o4-mini', label: 'o4-mini', source: 'cli-discovery' },
		]);
	});

	it('appends curated claude-code suggestions on top of discovery', async () => {
		const disc = new PrompterModelDiscovery({
			getAgentDetector: () => fakeDetector(async () => ['opus', 'fable']),
		});
		const ids = (await disc.getModelOptions('claude-code')).map((o) => o.id);
		expect(ids.slice(0, 2)).toEqual(['opus', 'fable']); // discovery first
		expect(ids).toContain('claude-opus-4-8');
		expect(ids).toContain('claude-opus-4-6');
	});

	it('returns an empty list (never throws) when no detector and no curated set', async () => {
		const disc = new PrompterModelDiscovery({ getAgentDetector: () => null });
		await expect(disc.getModelOptions('codex')).resolves.toEqual([]);
	});

	it('still surfaces curated suggestions for claude-code without a detector', async () => {
		const disc = new PrompterModelDiscovery({ getAgentDetector: () => null });
		const ids = (await disc.getModelOptions('claude-code')).map((o) => o.id);
		expect(ids).toContain('claude-opus-4-8');
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
