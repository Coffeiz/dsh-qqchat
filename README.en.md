# dsh-qqchat

[中文](./README.md)

`dsh-qqchat` is a QQ Chat plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).

It connects DSH to the **official QQ Bot** platform and provides QR binding, direct messages, group chats, stable member identity, Gugu-style group/member memory, proactive sending, and a QQ experience embedded into DSH's main workspace.

> This uses official QQ Bot authorization, not personal QQ-account login.

## Features

Current alpha features include:

- official QQ Bot QR authorization
- Gateway WebSocket heartbeat/reconnect/resume
- C2C and group messages
- stable sender identity: `user_openid → member_openid → id`
- group receive modes: **Auto reply / Mention only / Silent record**
- outbound compatibility modes: **Smart / Markdown / Plain compatibility**
- group-member tool permission switch
- one DSH Session per QQ group or direct peer
- QQ messages rendered in the normal DSH conversation workspace
- a QQ group/direct-chat picker
- a QQ-specific composer that sends directly to QQ
- group/member memory viewer in the session header
- plugin log viewer in Settings
- dedicated SQLite persistence with WAL
- group-scope and member-scope long-term memory
- DSH Agent loop integration instead of a second AgentLoop
- TypeScript Host and Client sources

## Installation

### Dedicated `qqchat` profile

Because the plugin includes Web UI, install the official DSH Web bundle together with it:

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app dsh-qqchat
npx @deepseek-ai/dsh --profile qqchat
```

If you already use the built-in `web` profile:

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-qqchat
npx @deepseek-ai/dsh --profile web
```

### Private GitHub alpha

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app "git+ssh://git@github.com/Coffeiz/dsh-qqchat.git#agent/typescript-migration"
npx @deepseek-ai/dsh --profile qqchat
```

Git installation uses `prepare` to build the TypeScript sources. If pnpm blocks the Git dependency build script, allow `dsh-qqchat` in the profile's `pnpm-workspace.yaml` as instructed by DSH/pnpm and reinstall.

## UI model

### Settings is configuration only

**Settings → QQ Chat** contains:

- connection / QR binding
- group receive mode
- message compatibility format
- group-member tool permission
- Owner stable sender ID
- **View logs**

It does not contain the actual group/direct conversation browser anymore.

Group modes:

| Mode | Record messages | Wake Agent | Reply |
| --- | --- | --- | --- |
| Auto reply | yes | every message | yes |
| Mention only | yes | only `@Bot` | only `@Bot` |
| Silent record | yes | no | no |

### Chats live in the DSH workspace

A **QQ Chat** action is added to the DSH sidebar. It lists both groups and direct peers. Selecting one ensures its DSH Session exists and opens it with DSH's own `sessions.open()` API.

QQ sessions use titles such as:

```text
QQ Group · <name>
QQ DM · <name>
```

Incoming QQ messages are rendered as QQ-specific conversation bubbles in the standard DSH conversation area. The QQ session composer sends directly to QQ rather than creating a local DSH prompt.

A **QQ Memory** button in the session header opens group or member memory.

## Data and model-history separation

The plugin intentionally separates three layers:

```text
QQ real history      -> qqchat.sqlite
DSH display transcript -> qqchat/message Session events
Model-visible Agent history -> DSH surface (user/assistant/tool events)
```

Every QQ message may be recorded as a custom `qqchat/message` event so silent group traffic can still appear in the main DSH workspace. That event is display-only and does not enter the model-visible surface.

DSH only treats Sessions with a `turn/start` as engaged workspace conversations. When a QQ Session is created for the first time, the plugin therefore submits one internal `qq-chat-bootstrap` wake and immediately rejects it in `agent/pre-step`. The bootstrap creates only an empty turn boundary: it has no model step, performs no LLM request, and sends nothing to QQ.

Only messages selected by the receive policy run a real Agent turn. Before `followup()`, recent QQ history, group memory, member memory, and stable sender metadata are reconstructed from SQLite.

## Tool permission

When **Group members can use tools** is enabled, any group member who triggers the Agent may use all tools visible from the current Agent preset.

When disabled, the plugin uses DSH's `tools/pre-execute` policy seam:

```text
senderId == Owner stable ID -> allow
otherwise                   -> deny
```

If no Owner stable ID is configured, group-triggered tool calls fail closed. Identity is never inferred from nickname.

## Memory

Group scope:

- `profile`
- `summary`
- `daily`
- `memory`

Member scope:

- `profile`
- `pattern`
- `summary`

Reflection is asynchronous and batched/idle-triggered rather than one LLM call per message.

## SQLite

Default database:

```text
$DSH_HOME/plugins/dsh-qqchat/qqchat.sqlite
```

Core tables include `accounts`, `auth_tasks`, `groups`, `members`, `group_members`, `messages`, `memory_documents`, `reflection_state`, `plugin_settings`, and `outbox`.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Source layout:

```text
src/*.ts                 Host
client-src/*.cts    DSH Client
tests/*.test.ts          tests
lib/                     generated output
```

See [docs/ARCHITECTURE.en.md](./docs/ARCHITECTURE.en.md) for implementation boundaries.

## Security

- QQ AppSecret is never returned through Client RPC.
- QR AES keys remain Host-only.
- `/qqchat` RPC uses DSH Connection with `authority: 'loopback'`.
- permissions and memory keys use stable sender IDs, never nicknames.
- group tool authorization uses DSH `tools/pre-execute`, not AgentLoop patches.
- `qqchat.sqlite` contains private message and memory data and should be protected accordingly.

## License

Private development stage: `UNLICENSED`.
