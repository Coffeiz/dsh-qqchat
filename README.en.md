# dsh-qqchat

[简体中文](./README.md)

`dsh-qqchat` is a QQ chat plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).

It connects DSH to the **official QQ Bot** platform and provides private/group chat, QR authorization, stable member identity, group history, group/member long-term memory, proactive messages, and a DSH-native management UI.

> This uses official QQ Bot authorization. It does **not** log into a personal QQ account.

## Features

Current alpha includes:

- Official QQ Bot QR authorization
- Gateway WebSocket, heartbeat, reconnect and resume
- C2C and group messages
- Stable member identity: `user_openid → member_openid → id`
- Per-group enable / mention / ambient-read policies
- One DSH Agent Session per QQ group or private peer
- Replies through the DSH Agent loop, without a second custom AgentLoop
- Proactive group messages and durable outbox state
- Dedicated SQLite database in WAL mode
- Group-scope and member-scope memory
- DSH-native Settings UI for QR binding, group conversation bubbles, group/member memory and group controls
- TypeScript source

## Install

### Dedicated `qqchat` profile (recommended)

Because `dsh-qqchat` includes a browser UI, install both the DSH Web bundle and the plugin into a dedicated profile:

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app dsh-qqchat
npx @deepseek-ai/dsh --profile qqchat
```

DSH initializes `dsh-base` automatically for a new custom profile. `@deepseek-ai/dsh-web-app` supplies the browser surface and `dsh-qqchat` supplies the QQ Host + Client plugin.

Open **Settings → QQ Chat** and choose **扫码连接**.

> The repository is currently a private alpha. Until `dsh-qqchat` is published to npm, use the Git installation below.

### Existing `web` profile

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-qqchat
npx @deepseek-ai/dsh --profile web
```

### Private GitHub branch

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app "git+ssh://git@github.com/Coffeiz/dsh-qqchat.git#agent/typescript-migration"
npx @deepseek-ai/dsh --profile qqchat
```

Git dependencies build TypeScript through `prepare`. If pnpm blocks Git dependency build scripts, allow the `dsh-qqchat` build as instructed by DSH/pnpm and retry.

### Local checkout

```bash
git clone git@github.com:Coffeiz/dsh-qqchat.git
cd dsh-qqchat
git switch agent/typescript-migration
npm install
npm run build

npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app .
npx @deepseek-ai/dsh --profile qqchat
```

## QR authorization

1. Open **Settings → QQ Chat**.
2. Click **扫码连接**.
3. The Host creates a QQ bind task with a temporary AES-256 key.
4. Scan the QR code with mobile QQ and authorize a Bot.
5. QQ returns the AppID and AES-GCM encrypted AppSecret.
6. The secret is decrypted only in the DSH Host process and stored in the plugin SQLite database.
7. The QQ Gateway WebSocket starts immediately.

The temporary AES key never enters the browser.

## UI

The client registers directly into DSH `settings.section`; it does not start another admin server.

```text
┌──────────────┬───────────────────────────────┬──────────────────┐
│ Groups       │ Conversation                  │ Inspector        │
│              │                               │                  │
│ Project      │ Alice  …stable-id             │ Group memory     │
│ Friends      │ ┌──────────────────────────┐  │ Members          │
│ ...          │ │ member message bubble    │  │ Settings         │
│              │ └──────────────────────────┘  │                  │
│              │                  DSH Agent    │ profile          │
│              │             ┌─────────────┐   │ summary          │
│              │             │ reply bubble│   │ memory / daily   │
└──────────────┴───────────────────────────────┴──────────────────┘
```

The UI uses DSH `--dsw-*` design tokens so it follows the host light/dark theme and hierarchy.

## Routing

Every accepted QQ message is persisted first. Only a response-worthy message wakes the DSH Agent.

```text
QQ Gateway
    │
    ├─ normalize reliable sender/group identity
    ├─ persist message / member / group
    ├─ ambient non-trigger message ──► history + memory only
    └─ response-worthy message
              │
              ▼
          DSH Agent
              │
              ▼
          QQ outbound
```

One group maps to one DSH Session, but the complete ambient group history is **not** copied into that Session. Recent group traffic, group memory and the current member memory are injected before an Agent turn.

## Identity

QQ group sender identity uses:

```text
user_openid
  ↓ fallback
member_openid
  ↓ fallback
id
```

Nicknames are presentation data only. Permissions and memory are keyed by stable sender ID.

## Memory

The first version mirrors the core semantics of Gugu's group memory system while keeping all plugin persistence in SQLite.

Group scope:

- `profile`
- `summary`
- `daily`
- `memory`

Member scope:

- `profile`
- `pattern`
- `summary`

The same stable QQ sender can keep personal context across groups under one Bot account, while group-specific relationships and events remain isolated.

Reflection is asynchronous instead of one LLM call per message. It follows the provider/model route actually used by the group's DSH Agent.

## SQLite

Default database:

```text
$DSH_HOME/plugins/dsh-qqchat/qqchat.sqlite
```

The plugin uses Node `node:sqlite` `DatabaseSync` with WAL, foreign keys and a busy timeout.

The boundary is intentional:

```text
QQ reality / identity / memory             -> qqchat.sqlite
Agent-visible turns / tools / model output -> DSH Session
```

## TypeScript development

TypeScript is the source of truth:

```text
src/*.ts                 Host
client-src/plugin.cts    DSH Client UI
tests/*.test.ts          Tests
lib/*.js + lib/*.d.ts    Generated artifacts (not committed)
```

```bash
npm install
npm run typecheck
npm test
npm run build
```

Git installs build through `prepare`; npm publication rebuilds through `prepublishOnly`. DSH ultimately runs ordinary generated JavaScript and does not require a TypeScript runtime.

See [docs/ARCHITECTURE.en.md](./docs/ARCHITECTURE.en.md) for internal boundaries.

## Security

- QQ AppSecret is never returned through plugin RPC.
- QR AES keys stay Host-side.
- Plugin RPC uses DSH Connection with `authority: 'loopback'`.
- Stable sender IDs, never nicknames, own member memory.
- Raw QQ events are local private data inside `qqchat.sqlite`.

## License

Private alpha: `UNLICENSED`.
