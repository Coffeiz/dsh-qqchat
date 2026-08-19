# dsh-qqchat

[中文](./README.md)

`dsh-qqchat` is a QQ Chat plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).

It connects through the **official QQ Bot** platform. The plugin does not build a second chat backend: **QQ groups and direct messages are mapped to ordinary DSH Sessions**, shown in DSH's normal Session/workspace list and rendered in the main Conversation surface.

> This is official QQ Bot authorization, not personal QQ-account QR login.

## Features

- Official QQ Bot QR authorization
- Gateway WebSocket heartbeat, reconnect and resume
- Group chat and C2C direct messages
- Stable sender identity: `user_openid -> member_openid -> id`
- Group receive modes: **Auto reply / Mention only / Silent record**
- Reply formats: **Smart / Markdown / Plain compatibility**
- Group-member tool permission switch and Owner stable ID
- One DSH Session per QQ group/direct peer
- Native DSH Session titles and Conversation UI
- Direct QQ composer for proactive messages
- Group memory, member memory and direct-user memory views
- Plugin logs in Settings
- Dedicated SQLite database in WAL mode
- Group-scope and member-scope long-term memory
- Idle/batch asynchronous memory reflection
- TypeScript Host and Client sources

The alpha still needs full real-world QQ + DSH E2E validation. Rich media, full QQ emoji handling and production migration tooling are outside the first release scope.

## Install

### Dedicated `qqchat` profile

Because the plugin includes Web UI, install the official DSH Web bundle together with it:

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app dsh-qqchat
npx @deepseek-ai/dsh --profile qqchat
```

### Existing `web` profile

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-qqchat
npx @deepseek-ai/dsh --profile web
```

### Current private branch

Before npm publication:

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app "git+ssh://git@github.com/Coffeiz/dsh-qqchat.git#agent/typescript-migration"
npx @deepseek-ai/dsh --profile qqchat
```

Git installs build TypeScript through `prepare`.

For local development:

```bash
git clone git@github.com:Coffeiz/dsh-qqchat.git
cd dsh-qqchat
git switch agent/typescript-migration
npm install
npm run check
```

## First connection

1. Start DSH.
2. Open **Settings -> QQ Chat**.
3. Choose **Scan to connect**.
4. Scan with QQ and authorize the desired Bot.
5. The Host decrypts the AppSecret and stores it in the local plugin database.
6. The QQ Gateway starts automatically.

The temporary QR AES key never travels through the browser Client RPC.

## Settings only contains configuration

The Settings page does not host chat lists, transcripts or memory browsing. It contains:

```text
Connection / QR authorization

Receive mode
  Auto reply / Mention only / Silent record

Reply format
  Smart / Markdown / Plain compatibility

Tool permissions
  Group members can use tools [on/off]
  Owner stable ID

Diagnostics
  View logs
```

Receive behavior:

| Mode | Store QQ history | Feed memory | Wake Agent | Reply |
| --- | --- | --- | --- | --- |
| Auto reply | yes | yes | every message | yes |
| Mention only | yes | yes | only @Bot | only @Bot |
| Silent record | yes | yes | no | no |

Silent record never invokes the LLM just for observing a message.

## QQ chats are normal DSH Sessions

Each peer maps to one Session:

```text
QQ group  -> qqchat-<uuid>
QQ direct -> qqchat-<uuid>
```

Session titles:

```text
QQ Group · <group name>
QQ Direct · <nickname>
```

The plugin no longer registers a separate QQ footer chat picker. DSH's normal Session list is the navigation authority.

DSH hides sessions that never opened a turn. For a new silent-only QQ peer, the plugin submits an internal `qq-chat-bootstrap` wake and rejects it in `agent/pre-step`. This records a turn boundary without opening a model step, calling an LLM or sending anything to QQ, making the Session visible without adding model-visible chat content.

## Conversation and duplicate prevention

Messages that should trigger the Agent use DSH's native `user/message` flow:

```text
QQ inbound -> SQLite -> Agent.followup() -> user/message
           -> DSH Conversation -> Assistant/Tools -> QQ reply
```

They are **not** also appended as `qqchat/message`, so the same incoming QQ message is not rendered twice.

Reliable QQ identity is retained in the user message source metadata, while recent group history, group memory, member memory and stable sender IDs are injected as a separate context snapshot before the model step.

Messages that do not wake the Agent use the plugin's log-only event:

```text
qqchat/message
```

That event is visible in the Conversation transcript but never enters the model surface. The complete real-world QQ transcript remains in `qqchat.sqlite`.

## QQ Session composer

The composer in a QQ Session sends directly to QQ:

```text
DSH Web composer -> QQ API -> group/direct peer
```

It does not run another local Agent turn.

## Memory UI

The **QQ Memory** action in a QQ Session shows:

For a group:
- `profile`
- `summary`
- `daily`
- `memory`
- member list with stable sender IDs

Clicking a member opens that member's:
- `profile`
- `pattern`
- `summary`

For a direct chat:
- `profile`
- `pattern`
- `summary`

The same stable sender may preserve personal memory across groups under the same Bot, while group relationships and group-specific facts stay isolated in each group scope.

## Tool permissions

When **Group members can use tools** is enabled, any group-triggered Agent turn can use every tool exposed by the current preset.

When disabled, only the configured Owner stable ID may execute tools. Other group members can still talk to the Agent, but `tools/pre-execute` denies tool execution.

The permission gate uses DSH's official tool policy seam rather than modifying AgentLoop.

## Memory reflection

Default reflection triggers:

- about 120 seconds of group inactivity, or
- 20 unreflected messages.

Reflection reuses the group's actual Agent provider/model route and includes stable sender IDs.

## SQLite

Default path:

```text
$DSH_HOME/plugins/dsh-qqchat/qqchat.sqlite
```

Initialization:

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
```

Core tables cover accounts, QR tasks, groups, members, group membership, complete QQ message history, memory documents, reflection cursors, plugin settings and proactive-message outbox state.

DSH Session and plugin persistence remain separate concerns:

```text
DSH Session
  Agent participation, model output, tools, visible DSH transcript

qqchat.sqlite
  What actually happened on QQ, identities, full history and memory state
```

## Development

```bash
npm run typecheck
npm test
npm run build
npm run check
```

Host source: `src/*.ts`  
Client source: `client-src/*.cts`  
Build output: `lib/`

See [docs/ARCHITECTURE.en.md](./docs/ARCHITECTURE.en.md) for more detail.

## Remaining real-environment checks

The code follows DSH Session / Conversation / Tool-policy extension points, but these items still require a real QQ + DSH run:

1. Complete mobile QR authorization.
2. Gateway reconnect/resume under real network failures.
3. All three receive modes in a real group.
4. Session-list ordering/refresh behavior on the target DSH Web version.
5. Streaming model output and tool-call completion before QQ delivery.
6. Markdown/plain compatibility across QQ clients.
7. Long-running memory reflection and SQLite concurrency.

## License

The private alpha currently has no open-source grant. A public license will be selected before release.
