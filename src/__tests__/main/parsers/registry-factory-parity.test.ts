import { describe, it, expect, beforeAll } from 'vitest';
import { getAllOutputParsers } from '../../../main/parsers/agent-output-parser';
import { createOutputParser } from '../../../main/parsers/parser-factory';

// Force parser registration (index.ts populates the registry on import)
import '../../../main/parsers/index';

describe('Parser Registry / Factory Parity', () => {
	let registryAgentIds: string[];

	beforeAll(() => {
		registryAgentIds = getAllOutputParsers()
			.map((p) => p.agentId)
			.sort();
	});

	it('every parser in the registry must have a matching factory constructor', () => {
		const missingInFactory: string[] = [];
		for (const agentId of registryAgentIds) {
			const instance = createOutputParser(agentId);
			if (!instance) {
				missingInFactory.push(agentId);
			}
		}
		expect(
			missingInFactory,
			`Factory missing constructors for: ${missingInFactory.join(', ')}`
		).toEqual([]);
	});

	it('every factory constructor must produce a parser whose agentId matches the key', () => {
		for (const agentId of registryAgentIds) {
			const instance = createOutputParser(agentId);
			if (instance) {
				expect(instance.agentId).toBe(agentId);
			}
		}
	});

	it('registry and factory cover the same set of agent IDs', () => {
		const factoryIds: string[] = [];
		for (const agentId of registryAgentIds) {
			if (createOutputParser(agentId)) {
				factoryIds.push(agentId);
			}
		}
		expect(factoryIds.sort()).toEqual(registryAgentIds);
	});
});
