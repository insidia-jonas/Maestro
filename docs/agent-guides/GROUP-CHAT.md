<!-- Verified 2026-06-02 against rc (wake-up-call feature added) -->

# Group Chat System

The group chat system enables multi-agent collaboration through a hub-and-spoke architecture where a central moderator coordinates messages between the user and multiple AI participant agents.

## Architecture

### Hub-and-Spoke Model

```text
                  +-----------+
                  |   User    |
                  +-----+-----+
                        |
                  +-----v-----+
                  | Moderator |  (hub - read-only AI agent)
                  +-----+-----+
                   /    |    \
          +-------+  +--+--+  +-------+
          |Agent A|  |Agent B|  |Agent C|  (spokes - participant agents)
          +-------+  +-------+  +-------+
```

- **User** sends a message to the group chat
- **Moderator** (hub) receives the message, decides which agents to delegate to via `@mentions`, and synthesizes responses
- **Participants** (spokes) are AI agents that receive tasks from the moderator and respond with results
- The moderator reviews all responses and either delegates further or returns a final answer to the user

### Message Flow

1. User submits a message via the renderer
2. The IPC handler (`groupChat:sendToModerator`) calls `routeUserMessage()`
3. The router auto-adds any `@mentioned` agents not yet in the chat (matching against available Maestro sessions)
4. The message is appended to the pipe-delimited chat log
5. A moderator batch process is spawned with the full system prompt, participant list, chat history, and user message
6. The moderator responds with `@mentions` targeting specific participants
7. The router extracts mentions, dispatches requests to each mentioned participant in parallel
8. Each participant runs as its own agent process and responds
9. When all pending participants have responded, a moderator synthesis round is spawned
10. The moderator reviews all responses and either delegates again or returns to the user

## Data Model

### GroupChat

Defined in `src/shared/group-chat-types.ts` and `src/main/group-chat/group-chat-storage.ts`:

```typescript
interface GroupChat {
	id: string; // UUID
	name: string; // Display name (sanitized for filesystem)
	createdAt: number; // Timestamp
	updatedAt: number; // Timestamp
	moderatorAgentId: string; // e.g. 'claude-code'
	moderatorSessionId: string; // Session ID prefix for routing
	moderatorAgentSessionId?: string; // Agent session UUID for continuity
	moderatorConfig?: ModeratorConfig; // Custom path, args, env vars, model, SSH
	participants: GroupChatParticipant[];
	logPath: string; // Path to chat.log
	imagesDir: string; // Path to images/
	archived?: boolean;
	wakeUpConfig?: WakeUpConfig; // Saved wake-up-call configuration (optional)
}
```

### GroupChatParticipant

```typescript
interface GroupChatParticipant {
	name: string; // Unique name within the chat
	agentId: string; // Agent type (e.g. 'claude-code')
	sessionId: string; // Internal process session ID for routing
	agentSessionId?: string; // Agent's conversation session ID for continuity
	addedAt: number;
	lastActivity?: number;
	lastSummary?: string;
	contextUsage?: number;
	color?: string; // Assigned color for UI
	tokenCount?: number;
	messageCount?: number;
	processingTimeMs?: number;
	totalCost?: number; // USD
	sshRemoteName?: string; // SSH remote display name
}
```

### GroupChatMessage

```typescript
interface GroupChatMessage {
	timestamp: string; // ISO 8601
	from: string; // 'user', 'moderator', or participant name
	content: string;
	readOnly?: boolean;
}
```

### GroupChatHistoryEntry

Stored in JSONL format for append-only activity tracking:

```typescript
interface GroupChatHistoryEntry {
	id: string;
	timestamp: number;
	summary: string; // One-sentence summary
	participantName: string;
	participantColor: string;
	type: 'delegation' | 'response' | 'synthesis' | 'error';
	elapsedTimeMs?: number;
	tokenCount?: number;
	cost?: number;
	fullResponse?: string;
}
```

### Chat State

```typescript
type GroupChatState = 'idle' | 'moderator-thinking' | 'agent-working';
```

## Storage Layout

Each group chat lives in its own directory under `{userData}/group-chats/{id}/`:

```text
group-chats/
  {uuid}/
    metadata.json    # GroupChat object
    chat.log         # Pipe-delimited message log
    history.jsonl    # Activity history entries (one JSON per line)
    images/          # Image attachments
```

**Atomic writes**: All metadata updates use write-to-temp-then-rename to prevent corruption on crash.

**Write serialization**: A per-chat write queue (see `enqueueWrite()`) serializes concurrent metadata writes to prevent race conditions between the router, usage listener, and session-ID listener.

### Chat Log Format

Pipe-delimited with escape sequences:

```text
TIMESTAMP|FROM|CONTENT
TIMESTAMP|FROM|CONTENT|readOnly
```

Escaping rules (applied in order):

- `\` becomes `\\`
- `|` becomes `\|`
- newlines become `\n`

## Main Process Modules

All located in `src/main/group-chat/`:

### group-chat-router.ts

The central message routing engine. Key exports:

| Function                           | Purpose                                                                                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routeUserMessage()`               | Routes user message to moderator batch process. Auto-adds `@mentioned` sessions as participants. Builds the full prompt with system prompt, participant list, chat history, and user request. |
| `routeModeratorResponse()`         | Parses moderator output for `@mentions`, dispatches to participants, tracks pending responses                                                                                                 |
| `routeAgentResponse()`             | Handles participant response, logs it, emits to renderer                                                                                                                                      |
| `spawnModeratorSynthesis()`        | Spawns synthesis round after all participants respond                                                                                                                                         |
| `respawnParticipantWithRecovery()` | Re-spawns a participant with recovery context after session loss                                                                                                                              |
| `extractMentions()`                | Extracts `@Name` patterns from text, matches against participants                                                                                                                             |
| `markParticipantResponded()`       | Removes participant from pending set, returns true if last                                                                                                                                    |

Module-level callbacks set during initialization:

- `setGetSessionsCallback()` - Looks up available Maestro sessions for auto-add
- `setGetCustomEnvVarsCallback()` - Resolves per-agent env vars
- `setGetAgentConfigCallback()` - Resolves per-agent config (custom args, model, etc.)
- `setSshStore()` - Provides SSH store for remote execution

### group-chat-moderator.ts

Manages the moderator lifecycle:

| Function                | Purpose                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `spawnModerator()`      | Initializes session mapping, stores session ID prefix                |
| `sendToModerator()`     | Logs message and writes to moderator process                         |
| `killModerator()`       | Kills process, clears state, removes power block                     |
| `startSessionCleanup()` | Periodic cleanup of stale sessions (30min threshold, 10min interval) |
| `stopSessionCleanup()`  | Stops cleanup on shutdown                                            |

The moderator runs in **read-only mode** to prevent unintended modifications.

### group-chat-agent.ts

Manages participant agents:

| Function                        | Purpose                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `addParticipant()`              | Resolves agent config, spawns process, stores session mapping. Supports SSH wrapping via `wrapSpawnWithSsh()`. |
| `sendToParticipant()`           | Routes message to participant, logs as `moderator->{name}`                                                     |
| `removeParticipant()`           | Kills process, removes from storage                                                                            |
| `clearAllParticipantSessions()` | Kills all participant processes for a chat                                                                     |

Participants run with **read-write access** (not read-only) so they can make code changes.

### group-chat-storage.ts

CRUD operations for group chat metadata:

| Function                      | Purpose                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `createGroupChat()`           | Creates directory structure, metadata, empty log          |
| `loadGroupChat()`             | Reads and parses metadata.json                            |
| `listGroupChats()`            | Lists all group chat directories                          |
| `deleteGroupChat()`           | Removes directory with retry logic for Windows file locks |
| `updateGroupChat()`           | Partial update with write serialization                   |
| `addParticipantToChat()`      | Appends participant to metadata                           |
| `removeParticipantFromChat()` | Filters participant from metadata                         |
| `updateParticipant()`         | Updates participant stats (tokens, cost, etc.)            |
| `addGroupChatHistoryEntry()`  | Appends JSONL history entry                               |
| `getGroupChatHistory()`       | Reads and sorts history entries                           |

### group-chat-log.ts

Log file I/O:

| Function                                | Purpose                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `appendToLog()`                         | Escapes content and appends timestamped line                                                 |
| `readLog()`                             | Parses pipe-delimited log into `GroupChatMessage[]`                                          |
| `saveImage()`                           | Saves image buffer to images directory with UUID filename and extension whitelist validation |
| `escapeContent()` / `unescapeContent()` | Pipe-delimited escape handling                                                               |

### wake-up-service.ts

Timed message sequencer for the Wake-Up Call feature:

| Function           | Purpose                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `startWakeUp()`    | Persists config, sends initial prompt, schedules message chain via `setTimeout`               |
| `stopWakeUp()`     | Aborts sequence, clears timers, emits `stopped` progress, cleans persisted pause state        |
| `pauseWakeUp()`    | Clears pending timer, saves `remainingMs`, sets phase to `paused`, persists pause state       |
| `resumeWakeUp()`   | Restores timer from saved `remainingMs`, sets phase back to `running`, clears persisted pause |
| `getWakeUpState()` | Returns ephemeral `WakeUpState` snapshot (or `null` if no active sequence)                    |
| `stopAllWakeUps()` | Stops all active sequences (intended for shutdown cleanup)                                    |

Internally uses `AbortController` for clean cancellation and a `dispatchInFlight` guard to prevent pause/stop from corrupting state while `ensureModeratorAndSend()` is awaiting.

### wake-up-prompt-overrides.ts

In-memory registry of prompt overrides for active wake-up sequences. Lives in its own module (no group-chat imports) so `wake-up-service.ts` and `group-chat-router.ts` can both depend on it without an import cycle.

| Function                       | Purpose                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `setWakeUpPromptOverrides()`   | Registers moderator prompt + per-participant prompts (called by `startWakeUp()`)       |
| `getWakeUpModeratorPrompt()`   | Read by the router; appended to the moderator system prompt while a sequence is active |
| `getWakeUpParticipantPrompt()` | Read by the router; appended to the matching participant's prompt (name-normalized)    |
| `clearWakeUpPromptOverrides()` | Clears overrides on stop/finish                                                        |

### group-chat-config.ts

Shared configuration callbacks:

| Function                          | Purpose                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `setGetCustomShellPathCallback()` | Registers callback for Windows shell preference                                        |
| `getWindowsSpawnConfig()`         | Returns shell and stdin flags for Windows agent spawning. Skipped when SSH is enabled. |

### output-buffer.ts

Buffers streaming output from group chat processes:

- Uses chunked array storage for O(1) append performance
- Enforces `MAX_GROUP_CHAT_BUFFER_SIZE` to prevent memory exhaustion
- Buffer is released on process exit, then routed through the output parser

### output-parser.ts

Extracts text content from agent JSON/JSONL output:

- Uses registered per-agent output parsers (`getOutputParser()`)
- Falls back to generic extraction for unknown agent types
- Prefers `result` messages over streaming `text` chunks

### session-parser.ts

Parses group chat session IDs to extract `groupChatId` and `participantName`:

```text
group-chat-{groupChatId}-participant-{name}-{uuid|timestamp}
group-chat-{groupChatId}-participant-{name}-recovery-{timestamp}
```

Handles hyphenated participant names by matching against UUID or timestamp suffixes.

### session-recovery.ts

Detects and recovers from `session_not_found` errors:

1. `detectSessionNotFoundError()` - Checks output against error patterns
2. `buildRecoveryContext()` - Builds rich context from chat history, emphasizing the participant's own prior statements
3. `initiateSessionRecovery()` - Clears `agentSessionId` so next spawn uses a fresh session

## IPC Handlers

Registered in `src/main/ipc/handlers/groupChat.ts`. All handler names are prefixed with `groupChat:`.

### CRUD

| Handler             | Description                                               |
| ------------------- | --------------------------------------------------------- |
| `groupChat:create`  | Creates a new group chat with name and moderator agent ID |
| `groupChat:list`    | Lists all group chats                                     |
| `groupChat:load`    | Loads a single group chat by ID                           |
| `groupChat:delete`  | Deletes a group chat and all data                         |
| `groupChat:archive` | Archives a group chat (soft delete)                       |
| `groupChat:rename`  | Renames a group chat                                      |
| `groupChat:update`  | Updates group chat metadata (name, moderator config)      |

### Chat Operations

| Handler                     | Description                                 |
| --------------------------- | ------------------------------------------- |
| `groupChat:sendToModerator` | Routes a user message through the moderator |
| `groupChat:appendMessage`   | Appends a message to the chat log           |
| `groupChat:getMessages`     | Gets all messages from the chat log         |
| `groupChat:saveImage`       | Saves an image attachment                   |
| `groupChat:getImages`       | Lists saved image attachments for the chat  |

### Moderator

| Handler                           | Description                                          |
| --------------------------------- | ---------------------------------------------------- |
| `groupChat:startModerator`        | Spawns the moderator agent                           |
| `groupChat:stopModerator`         | Kills the moderator                                  |
| `groupChat:stopAll`               | Kills moderator + all participants                   |
| `groupChat:getModeratorSessionId` | Returns the moderator's provider session ID (if any) |
| `groupChat:reportAutoRunComplete` | Signal from an Auto Run batch run that it finished   |

### Participants

| Handler                             | Description                                 |
| ----------------------------------- | ------------------------------------------- |
| `groupChat:addParticipant`          | Adds a participant agent                    |
| `groupChat:removeParticipant`       | Removes a participant                       |
| `groupChat:sendToParticipant`       | Sends a message to a specific participant   |
| `groupChat:resetParticipantContext` | Clears a participant's conversation context |

### History

| Handler                        | Description                                  |
| ------------------------------ | -------------------------------------------- |
| `groupChat:getHistory`         | Gets activity history entries                |
| `groupChat:addHistoryEntry`    | Appends a new history entry                  |
| `groupChat:deleteHistoryEntry` | Deletes a single history entry               |
| `groupChat:clearHistory`       | Clears all history                           |
| `groupChat:getHistoryFilePath` | Returns the on-disk path of the history file |

### Wake-Up Call

| Handler                    | Description                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| `groupChat:startWakeUp`    | Validates config, normalizes, starts the sequencer                       |
| `groupChat:stopWakeUp`     | Stops a running sequence (hard abort)                                    |
| `groupChat:pauseWakeUp`    | Pauses sequence, saves remaining time for resume                         |
| `groupChat:resumeWakeUp`   | Resumes a paused sequence from saved remaining time                      |
| `groupChat:getWakeUpState` | Returns ephemeral state (`phase`, `currentStep`, `totalSteps`) or `null` |

**Validation (throws IPC errors from `groupChat:startWakeUp`):** Messages array: 1–5 entries. `intervalMs`: 5 000–3 600 000. `initialPrompt` and `moderatorPrompt`: optional strings, max 10 000 chars (empty → `undefined`). Each message must target a known participant. Content required and max 10 000 chars when `generate` is off. Per-message `agentPrompt`: optional string, max 10 000 chars.

### Emitter System

The `groupChatEmitters` object provides real-time event broadcasting to the renderer:

| Emitter                   | Event                           | Purpose                    |
| ------------------------- | ------------------------------- | -------------------------- |
| `emitMessage`             | `groupChat:message`             | New message in chat        |
| `emitStateChange`         | `groupChat:stateChange`         | Chat state transition      |
| `emitParticipantsChanged` | `groupChat:participantsChanged` | Participant added/removed  |
| `emitModeratorUsage`      | `groupChat:moderatorUsage`      | Context/cost/token updates |
| `emitHistoryEntry`        | `groupChat:historyEntry`        | New history entry          |
| `emitParticipantState`    | `groupChat:participantState`    | Participant working/idle   |
| `emitWakeUpProgress`      | `groupChat:wakeUpProgress`      | Wake-up step/phase updates |

## Renderer Components

Located in `src/renderer/components/`:

| Component                   | Purpose                                                               |
| --------------------------- | --------------------------------------------------------------------- |
| `GroupChatPanel.tsx`        | Main panel displayed in the center workspace for an active group chat |
| `GroupChatMessages.tsx`     | Message list with sender attribution and colors                       |
| `GroupChatInput.tsx`        | User input area with `@mention` autocomplete                          |
| `GroupChatHeader.tsx`       | Chat name, state indicator, moderator controls                        |
| `GroupChatParticipants.tsx` | Participant list with stats and remove buttons                        |
| `GroupChatList.tsx`         | Left Bar list of group chats                                          |
| `GroupChatModal.tsx`        | Creation modal for new group chats                                    |
| `GroupChatRightPanel.tsx`   | Right panel with chat info and participants                           |
| `GroupChatInfoOverlay.tsx`  | Info overlay with chat metadata                                       |
| `GroupChatHistoryPanel.tsx` | Activity history timeline                                             |
| `ParticipantCard.tsx`       | Individual participant card with stats                                |
| `CreateGroupModal.tsx`      | Group creation dialog                                                 |
| `DeleteGroupChatModal.tsx`  | Deletion confirmation                                                 |
| `RenameGroupChatModal.tsx`  | Rename dialog                                                         |
| `WakeUpModal.tsx`           | Wake-up call config + progress modal (interval, messages, start/stop) |

## Wake-Up Call

The wake-up call feature sends a timed sequence of messages into a group chat at configurable intervals. It is triggered from the group chat context menu in the Left Bar.

### User Flow

1. Right-click a group chat → select **Wake up call** (AlarmClock icon).
2. The `WakeUpModal` opens with config view: interval selector (30 s – 15 min presets), system-prompt toggle + initial-prompt textarea, and 1–5 message rows.
3. Each message row has a target-agent dropdown (from `chat.participants`), a generate checkbox (moderator composes at send time), and a content textarea (hidden when generate is on).
4. Click **Start Wake-up** → renderer calls `window.maestro.groupChat.startWakeUp(chatId, config)`.
5. Main validates, persists config to `metadata.json`, sends the initial prompt immediately, then schedules each message at `intervalMs` intervals via a `setTimeout` chain.
6. The modal switches to progress view: step counter (`Step n/total`), phase indicator, and Pause / Resume / Stop buttons.
7. Progress events flow from main → renderer via `groupChat:wakeUpProgress`.

### Config Schema (`WakeUpConfig`)

```typescript
interface WakeUpConfig {
	useSystemPrompt: boolean; // true → initial msg references system prompt
	initialPrompt?: string; // used when useSystemPrompt is false (max 10 000 chars)
	moderatorPrompt?: string; // appended to moderator system prompt while active (max 10 000 chars)
	messages: WakeUpMessage[]; // 1–5 sequenced messages
	intervalMs: number; // delay between messages (5 000 – 3 600 000 ms)
	pausedAtStep?: number; // set on pause, cleared on resume/start
	pausedRemainingMs?: number; // remaining ms until next fire, set on pause
}

interface WakeUpMessage {
	content: string; // message body (ignored when generate is true)
	targetParticipant: string; // participant name from the group chat
	generate: boolean; // moderator generates content at send time
	agentPrompt?: string; // appended to this participant's prompt while active (max 10 000 chars)
}
```

Persisted as `wakeUpConfig` on the `GroupChat` object in `metadata.json`. Pause fields (`pausedAtStep`, `pausedRemainingMs`) are stripped on fresh start and on stop.

### Delivery Mechanism

Messages are routed through the **moderator** using `routeUserMessage()`. For generate-mode messages, the moderator receives a prompt like `[Wake-up call 2/5] Generate and send a contextually relevant wake-up message to @agent-name.` For manual messages, the content is sent as `@agent-name <content>`.

The sequencer auto-restarts the moderator via `ensureModeratorAndSend()` if it exited between turns.

**Gemini CLI @mention escaping:** all four group chat spawn sites (moderator, participant, synthesis, recovery) pass their prompt through `escapeAtMentionsForAgent()` from `src/main/utils/agent-args.ts`. Gemini CLI treats bare `@name` tokens as file-include directives and launches a recursive file search from the cwd to resolve them, which hangs indefinitely in large working directories - the process never responds and never exits, so the participant runs into the response timeout. Escaping as `\@name` disables the file lookup. Do not remove the escaping, and route any new gemini-bound prompt construction through the same helper.

### Per-Agent and Moderator Prompts

While a sequence is active (running or paused), `startWakeUp()` registers the config's `moderatorPrompt` and per-message `agentPrompt` values in `wake-up-prompt-overrides.ts`. The router reads them on every spawn: the moderator gets a `## Wake-Up Call Moderator Instructions` section appended to its system prompt, and each target participant gets an `## Additional Instructions (wake-up call)` section appended to its prompt. Overrides are cleared when the sequence stops or finishes.

### Pause / Resume

- **Pause** clears the pending timer, saves `remainingMs = nextFireAt - Date.now()`, persists `pausedAtStep` + `pausedRemainingMs` to `metadata.json`.
- **Resume** restores the timer using the saved `remainingMs`, then continues the chain with full `intervalMs` for subsequent messages.
- A `dispatchInFlight` guard prevents pause/stop from corrupting state while the async moderator send is in flight.

### Key Files

| File                                        | Role                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/main/group-chat/wake-up-service.ts`    | Sequencer: start, stop, pause, resume, state query                                                               |
| `src/main/ipc/handlers/groupChat.ts`        | IPC handlers + validation + progress emitter                                                                     |
| `src/main/preload/groupChat.ts`             | Preload bridge: `startWakeUp`, `stopWakeUp`, `pauseWakeUp`, `resumeWakeUp`, `getWakeUpState`, `onWakeUpProgress` |
| `src/renderer/components/WakeUpModal.tsx`   | Config + progress UI (~415 LOC)                                                                                  |
| `src/renderer/components/GroupChatList.tsx` | Context menu entry (AlarmClock icon, `onWakeUp` prop)                                                            |
| `src/shared/group-chat-types.ts`            | `WakeUpMessage`, `WakeUpConfig`, `WakeUpState`, `WakeUpProgress`                                                 |
| `src/renderer/constants/modalPriorities.ts` | `WAKE_UP_CALL: 635`                                                                                              |

## Symphony System

Symphony is a separate feature that connects Maestro users with open-source projects seeking contributions. It is not part of the group chat system, but shares some infrastructure:

- **Registry**: Hosted at `symphony-registry.json` in the Maestro GitHub repo. Contains registered repositories with categories, maintainer info, and active status.
- **Workflow**: Browse repositories, select an issue labeled `runmaestro.ai`, clone the repo, create a branch and draft PR, run Auto Run documents from the issue, then mark the PR as ready for review.
- **Types**: Defined in `src/shared/symphony-types.ts` - includes `SymphonyRegistry`, `SymphonyIssue`, `ActiveContribution`, `ContributorStats`, and `SymphonyState`.
- **Constants**: Defined in `src/shared/symphony-constants.ts` - registry URL, cache TTLs, branch/PR templates, category display info.
- **Session metadata**: Symphony sessions attach `SymphonySessionMetadata` to the agent session for cross-referencing contributions.

## Prompt Templates

Group chat uses four prompt templates from `src/prompts/`:

| File                                | Purpose                                                                                                                            | Template Variables                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `group-chat-moderator-system.md`    | System prompt for the moderator. Instructs it to assist directly for simple tasks and delegate via `@mentions` for complex ones.   | `{{CONDUCTOR_PROFILE}}`                                                                                                                                                                |
| `group-chat-moderator-synthesis.md` | Synthesis prompt shown when reviewing agent responses. Moderator decides whether to continue delegating or summarize for the user. | None                                                                                                                                                                                   |
| `group-chat-participant.md`         | System prompt for participants. Instructs response format (overview first, then details).                                          | `{{GROUP_CHAT_NAME}}`, `{{PARTICIPANT_NAME}}`, `{{LOG_PATH}}`                                                                                                                          |
| `group-chat-participant-request.md` | Per-message prompt for participants with chat history and the moderator's request.                                                 | `{{PARTICIPANT_NAME}}`, `{{GROUP_CHAT_NAME}}`, `{{GROUP_CHAT_FOLDER}}`, `{{HISTORY_CONTEXT}}`, `{{MESSAGE}}`, `{{READ_ONLY_NOTE}}`, `{{READ_ONLY_LABEL}}`, `{{READ_ONLY_INSTRUCTION}}` |

## Key Source Files

| File                                          | Purpose                                  |
| --------------------------------------------- | ---------------------------------------- |
| `src/main/group-chat/group-chat-router.ts`    | Message routing engine                   |
| `src/main/group-chat/group-chat-moderator.ts` | Moderator lifecycle management           |
| `src/main/group-chat/group-chat-agent.ts`     | Participant agent management             |
| `src/main/group-chat/group-chat-storage.ts`   | File-based CRUD with write serialization |
| `src/main/group-chat/group-chat-log.ts`       | Pipe-delimited log I/O                   |
| `src/main/group-chat/group-chat-config.ts`    | Shared Windows spawn config              |
| `src/main/group-chat/output-buffer.ts`        | Streaming output buffering               |
| `src/main/group-chat/output-parser.ts`        | Agent JSON/JSONL text extraction         |
| `src/main/group-chat/session-parser.ts`       | Session ID parsing                       |
| `src/main/group-chat/session-recovery.ts`     | Session-not-found recovery               |
| `src/main/group-chat/wake-up-service.ts`      | Wake-up call sequencer                   |
| `src/main/ipc/handlers/groupChat.ts`          | IPC handler registration and emitters    |
| `src/shared/group-chat-types.ts`              | Shared type definitions                  |
| `src/shared/symphony-types.ts`                | Symphony type definitions                |
| `src/shared/symphony-constants.ts`            | Symphony constants                       |
| `src/prompts/group-chat-*.md`                 | Prompt templates                         |
