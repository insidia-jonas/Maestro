import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wrapSpawnWithSsh } from '../../../main/utils/ssh-spawn-wrapper';
import type { AgentSshRemoteConfig } from '../../../shared/types';

// Mock SSH remote resolver
vi.mock('../../../main/utils/ssh-remote-resolver', () => ({
	getSshRemoteConfig: vi.fn().mockReturnValue({
		config: {
			id: 'test-remote-1',
			name: 'Test Remote',
			host: 'dev.example.com',
			port: 22,
			username: 'testuser',
			privateKeyPath: '~/.ssh/id_ed25519',
			enabled: true,
		},
	}),
}));

// Mock resolveSshPath
vi.mock('../../../main/utils/cliDetection', () => ({
	resolveSshPath: vi.fn().mockResolvedValue('ssh'),
}));

// Mock os.homedir()
vi.mock('os', async () => {
	const actual = await vi.importActual('os');
	return {
		...actual,
		homedir: vi.fn(() => '/Users/testuser'),
	};
});

describe('ssh-spawn-wrapper: grok-build prompt delivery', () => {
	const sshConfig: AgentSshRemoteConfig = {
		enabled: true,
		remoteId: 'test-remote-1',
	};

	const mockSshStore = {
		getSshRemotes: () => [
			{
				id: 'test-remote-1',
				name: 'Test Remote',
				host: 'dev.example.com',
				port: 22,
				username: 'testuser',
				privateKeyPath: '~/.ssh/id_ed25519',
				enabled: true,
			},
		],
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('grok short prompt: delivers via -p arg in SSH command line', async () => {
		const result = await wrapSpawnWithSsh(
			{
				command: 'grok',
				args: ['--output-format', 'streaming-json', '--cwd', '/project'],
				cwd: '/project',
				prompt: 'Say hello',
				promptArgs: (p: string) => ['-p', p],
				agentBinaryName: 'grok',
			},
			sshConfig,
			mockSshStore
		);

		// Should NOT be stdin passthrough (no sshStdinScript with prompt appended after exec)
		expect(result.prompt).toBeUndefined();
		expect(result.sshRemoteUsed).not.toBeNull();
		expect(result.command).toBe('ssh');

		// The SSH command line args should contain grok's `-p` with the prompt text.
		// buildSshCommand embeds the full command including -p 'Say hello' in the args.
		const argsStr = result.args.join(' ');
		const hostIdx = argsStr.indexOf('dev.example.com');
		const remoteCommandPart = hostIdx >= 0 ? argsStr.slice(hostIdx) : argsStr;
		expect(remoteCommandPart).toContain('-p');
		expect(remoteCommandPart).toContain('Say hello');
		// Should NOT use --prompt-file for short prompts
		expect(remoteCommandPart).not.toContain('--prompt-file');
	});

	it('grok large prompt (>4000 chars): delivers via --prompt-file with UUID name', async () => {
		const largePrompt = 'x'.repeat(5000);

		const result = await wrapSpawnWithSsh(
			{
				command: 'grok',
				args: ['--output-format', 'streaming-json', '--cwd', '/project'],
				cwd: '/project',
				prompt: largePrompt,
				promptArgs: (p: string) => ['-p', p],
				agentBinaryName: 'grok',
			},
			sshConfig,
			mockSshStore
		);

		expect(result.sshRemoteUsed).not.toBeNull();
		expect(result.prompt).toBeUndefined();
		// Should use sshStdinScript (base64 heredoc approach)
		expect(result.sshStdinScript).toBeDefined();
		// The script should contain base64 decode for the prompt file
		expect(result.sshStdinScript).toContain('base64 -d >');
		expect(result.sshStdinScript).toContain('MAESTRO_PROMPT_EOF');
		// The args in the script should contain --prompt-file
		expect(result.sshStdinScript).toContain('--prompt-file');
		// Temp file name should use UUID pattern, not numeric timestamp
		expect(result.sshStdinScript).toMatch(
			/maestro-grok-prompt-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.txt/
		);
		// The base64 content should be present
		const expectedBase64 = Buffer.from(largePrompt, 'utf-8').toString('base64');
		expect(result.sshStdinScript).toContain(expectedBase64);
		// Exit code must be preserved (not masked by cleanup)
		expect(result.sshStdinScript).toContain('__maestro_st=$?');
		expect(result.sshStdinScript).toContain('exit $__maestro_st');
	});

	it('non-grok agent large prompt: delivers via stdin passthrough', async () => {
		const largePrompt = 'x'.repeat(5000);

		const result = await wrapSpawnWithSsh(
			{
				command: 'opencode',
				args: ['run', '--format', 'json'],
				cwd: '/project',
				prompt: largePrompt,
				agentBinaryName: 'opencode',
			},
			sshConfig,
			mockSshStore
		);

		expect(result.sshRemoteUsed).not.toBeNull();
		expect(result.prompt).toBeUndefined();
		expect(result.sshStdinScript).toBeDefined();
		// Non-grok: stdin passthrough (prompt appended after exec)
		expect(result.sshStdinScript).toContain('exec opencode');
		expect(result.sshStdinScript).toContain(largePrompt);
		// Should NOT have prompt-file
		expect(result.sshStdinScript).not.toContain('--prompt-file');
		expect(result.sshStdinScript).not.toContain('MAESTRO_PROMPT_EOF');
	});

	it('grok with no prompt: no -p or --prompt-file', async () => {
		const result = await wrapSpawnWithSsh(
			{
				command: 'grok',
				args: ['--resume', 'session-123'],
				cwd: '/project',
				promptArgs: (p: string) => ['-p', p],
				agentBinaryName: 'grok',
			},
			sshConfig,
			mockSshStore
		);

		expect(result.sshRemoteUsed).not.toBeNull();
		// No prompt, no -p (as grok prompt flag), no --prompt-file
		// Note: result.args contains SSH's own `-p 22` port flag — we check the
		// remote command portion (everything after the hostname) for absence of
		// grok's prompt delivery flags.
		const argsStr = result.args.join(' ');
		const hostIdx = argsStr.indexOf('dev.example.com');
		const remoteCommandPart = hostIdx >= 0 ? argsStr.slice(hostIdx) : argsStr;
		expect(remoteCommandPart).not.toContain('--prompt-file');
		// grok's -p flag would appear as `-p <prompt text>`, not `-p 22`
		// Check that no `-p` followed by non-numeric content exists in the remote command
		expect(remoteCommandPart).not.toMatch(/-p\s+[^0-9]/);
	});

	it('SSH disabled: returns config unchanged', async () => {
		const result = await wrapSpawnWithSsh(
			{
				command: 'grok',
				args: ['--output-format', 'streaming-json'],
				cwd: '/project',
				prompt: 'Hello',
				promptArgs: (p: string) => ['-p', p],
				agentBinaryName: 'grok',
			},
			{ enabled: false },
			mockSshStore
		);

		expect(result.sshRemoteUsed).toBeNull();
		expect(result.command).toBe('grok');
		expect(result.prompt).toBe('Hello');
	});
});
