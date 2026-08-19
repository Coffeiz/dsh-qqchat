# dsh-qqchat

`dsh-qqchat` is a private, self-contained QQ channel plugin for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).

It connects DSH to the **official QQ Bot** platform, keeps QQ/group state in its own SQLite database, and adds a DSH-native settings surface for QR authorization, group chat inspection, group/member memory, and proactive group messages.

> This is official QQ Bot authorization. It does **not** log into a personal QQ account.

## Status

Current version: `0.1.0-alpha.1`

Implemented in this alpha:

- QQ official QR bot authorization (`q.qq.com` bind-task flow)
- Raw QQ Gateway WebSocket with heartbeat, reconnect, resume, C2C and group events
- Stable group-member identity (`user_openid` → `member_openid` → `id` fallback)
- Group read/reply policy: enable group, require `@`, optionally read silent group traffic
- One DSH Agent session per QQ group / private peer
- DSH model/tool loop used for actual replies; no second custom agent loop
- Passive QQ reply with active-send fallback
- Proactive group sending from the plugin UI and a durable outbox table
- Dedicated SQLite database, WAL mode
- Gugu-style memory semantics: group scope + member scope, recent history, `profile`, `summary`, `daily`, `memory`, `pattern`, asynchronous reflection
- DSH-native client surface using the current `settings.section` slot and DSH `--dsw-*` design tokens
- Group list, member-aware conversation bubbles, group memory viewer, member memory viewer and group controls

Not yet covered by this alpha: rich QQ media/file send, the full Gugu QQ-face parser, production migration tooling, and a live QQ/DSH end-to-end CI fixture.

## Requirements

- DeepSeek Harness `0.1.0-rc.8` compatible runtime
- Node.js `^22.19.0` or `>=24`
- `pnpm` available to the `dsh plugin` command
- A DSH profile with the Web UI (examples below use profile `web`)
- GitHub SSH access if installing directly from this private repository

## Install from the private GitHub repository

DSH's plugin command is a profile-scoped `pnpm` forwarder. Because this package declares `dsh.bundle`, installing it also activates its `cordis.patch.yml` layer in that profile.

```bash
dsh plugin --profile web add "git+ssh://git@github.com/Coffeiz/dsh-qqchat.git"
```

Then restart DSH:

```bash
dsh --profile web
```

Open **Settings → QQ Chat** and click **扫码连接**.

If your DSH profile is not named `web`, replace `web` with that profile name.

### Update

```bash
dsh plugin --profile web update dsh-qqchat
```

### Remove

```bash
dsh plugin --profile web remove dsh-qqchat
```

Removing the package does not intentionally delete the plugin data directory. The default data file is:

```text
$DSH_HOME/plugins/dsh-qqchat/qqchat.sqlite
```

Delete that directory manually only when you also want to remove local QQ credentials, chat history and memory.

## Install from a local checkout

Useful during development:

```bash
git clone git@github.com:Coffeiz/dsh-qqchat.git
cd dsh-qqchat
npm install
npm run build
npm test

dsh plugin --profile web add .
```

DSH anchors relative plugin paths to the directory in which you invoke the command, so `add .` can be run directly from this repository.

## First connection

1. Open **Settings → QQ Chat**.
2. Click **扫码连接**.
3. The Host generates a random AES-256 key and starts a QQ `bind_task`.
4. Scan the QR code in the QQ mobile app and choose the QQ Bot to authorize.
5. QQ returns the AppID and an AES-GCM encrypted AppSecret.
6. The secret is decrypted only in the DSH Host process and written to the local plugin SQLite database.
7. `dsh-qqchat` starts the QQ Gateway WebSocket immediately.

The temporary AES key is never sent to the browser. The QR panel receives only the QR data URL / task id needed for polling.

## UI

The browser half is a normal DSH client plugin. It does not open another local web server and does not ship a separate admin application.

It registers a **QQ Chat** section into DSH Settings and communicates with the Host through DSH's existing Connection RPC transport (`/qqchat`, loopback authority).

The connected view has three areas:

```text
┌──────────────┬───────────────────────────────┬──────────────────┐
│ Groups       │ Conversation                  │ Group inspector  │
│              │                               │                  │
│ Project A    │ Alice  …stable-id             │ Group memory     │
│ Friends      │ ┌──────────────────────────┐  │ Members          │
│ ...          │ │ message bubble           │  │ Settings         │
│              │ └──────────────────────────┘  │                  │
│              │                  DSH Agent    │ profile          │
│              │             ┌─────────────┐   │ summary          │
│              │             │ reply bubble│   │ memory / daily   │
└──────────────┴──────────────┴─────────────┴──────────────────────┘
```

The CSS intentionally consumes DSH's own `--dsw-*` design tokens so light/dark theme and visual hierarchy follow the host application.

## Message routing

Every QQ message that the configured read policy accepts is written to `qqchat.sqlite` first.

```text
QQ Gateway
    │
    ├─ normalize reliable sender/group identity
    │
    ├─ persist message / member / group
    │
    ├─ silent non-@ traffic ───────► memory history only
    │
    └─ message requiring response
              │
              ▼
          DSH Agent
              │
              ▼
          QQ outbound
```

A group is mapped to one DSH Session, but **the complete group history is not copied into the DSH Session**. Only the turns where the Agent participates enter the DSH conversation. Recent group traffic and long-term memory are injected as a model-visible snapshot before the current QQ turn.

This keeps the DSH Session focused while still allowing the Agent to understand ongoing group context.

## Reliable member identity

For QQ group messages the identity order is:

```text
user_openid
  ↓ fallback
member_openid
  ↓ fallback
id
```

Nicknames / usernames are presentation metadata only. Memory and attribution are keyed by the stable platform sender ID, and the model-facing context explicitly says not to infer identity from nicknames.

## Memory model

The first version deliberately mirrors the semantics used by Gugu's group memory system while using a single SQLite database instead of Gugu's server-side file/database combination.

### Group scope

A group stores:

- `profile` — stable group profile / roles / recurring structure
- `summary` — current compact group summary
- `daily` — date-stamped recent durable developments
- `memory` — long-lived decisions, relationships, projects, agreements, recurring topics

Group-specific facts never flow to another group.

### Member scope

A stable QQ member stores:

- `profile` — stable facts about the person
- `pattern` — recurring preferences / behavior patterns with conservative extraction
- `summary` — compact current member summary

Member scope is keyed under the same QQ Bot account, so the same stable QQ sender can retain personal context across groups while group-specific facts stay in the group scope.

### Reflection

Reflection is asynchronous rather than one model call per chat message:

- trigger after an idle window (default 120 seconds), or
- trigger when enough unreflected messages accumulate (default 20)

The reflection call reuses the provider/model route actually used by that group's DSH Agent. It receives reliable sender IDs, the existing memory documents, and the unreflected transcript, then returns structured JSON updates.

## SQLite

Default database:

```text
$DSH_HOME/plugins/dsh-qqchat/qqchat.sqlite
```

The plugin uses Node's built-in `node:sqlite` `DatabaseSync` and enables:

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
```

The database contains these main tables:

```text
accounts            QQ AppID / AppSecret and gateway state
auth_tasks          short-lived QR bind-task AES keys
groups              QQ group settings + mapped DSH Session id
members             stable QQ sender identity + private Session id
group_members       group-local display identity
messages            accepted inbound / outbound chat history
memory_documents    group/member profile/summary/daily/memory/pattern
reflection_state    memory reflection cursor
outbox              proactive-send queue
```

The data directory is created with mode `0700` and the SQLite file is chmodded to `0600` where the platform supports POSIX modes. `0.1.x` stores the QQ AppSecret in that local database; OS-keychain / DSH credential-store integration is a possible hardening step for a later release.

## Configuration

The bundle defaults to:

```yaml
- insert:
    - id: dsh-qqchat
      name: dsh-qqchat
      config:
        dataDir: !!js dshHomePath('plugins/dsh-qqchat')
```

You can override the row in the profile's later `cordis.patch.yml` layer. A patch replaces the row config, so restate `dataDir` when adding fields:

```yaml
- id: dsh-qqchat
  config:
    dataDir: !!js dshHomePath('plugins/dsh-qqchat')
    agentPreset: default
    groupRequiresAt: true
    groupReadEnabled: true
    replyFormat: smart
    reflectionIdleMs: 120000
    reflectionBatchSize: 20
```

Available Host options:

| Field | Default | Purpose |
| --- | --- | --- |
| `dataDir` | `$DSH_HOME/plugins/dsh-qqchat` | Plugin state directory |
| `source` | `dsh-qqchat` | QQ bind page source label |
| `sandbox` | `false` | QQ sandbox API |
| `agentPreset` | DSH default | Preset mounted for QQ Agent sessions |
| `provider` / `model` | DSH route | Optional explicit model route |
| `maxTokens` | DSH default | Optional Agent output limit |
| `groupChatEnabled` | `true` | Master group handling switch |
| `groupRequiresAt` | `true` | Default for newly discovered groups |
| `groupReadEnabled` | `true` | Record silent non-@ messages by default |
| `replyFormat` | `smart` | `smart`, `markdown`, or `compat` |
| `recentGroupMessages` | `40` | Recent context lines injected before a group turn |
| `reflectionIdleMs` | `120000` | Idle reflection delay |
| `reflectionBatchSize` | `20` | Immediate reflection threshold |
| `reflectionMaxMessages` | `80` | Max messages per reflection call |
| `memoryMaxTokens` | `1400` | Reflection output token cap |

Per-group `enabled`, `requires @`, and `read group messages` are editable directly in the QQ Chat UI and persisted in SQLite.

## Development

```bash
npm install
npm run check
npm test
npm run build
```

`npm run build` wraps `client-src/plugin.cjs` in the current DSH lazy-CJS client-module factory format and writes `lib/client.js`:

```js
window.__ModuleLoader__.load({ id: 'dsh-qqchat', factory: (require) => {
  // ...client module...
  return module.exports
} })
```

This small local builder exists because DSH's own `clientBundle()` tsdown preset is currently internal to the DeepSeek Harness monorepo rather than published for third-party packages.

## Repository layout

```text
dsh-qqchat/
├── cordis.patch.yml
├── client-src/
│   └── plugin.cjs            # DSH-native Settings UI source
├── lib/
│   ├── index.js              # package Host entry
│   └── client.js             # generated lazy-CJS DSH client bundle
├── scripts/
│   └── build-client.mjs
├── src/
│   ├── index.js              # Cordis Host plugin entry
│   ├── runtime.js            # QQ runtime / group reply policy / outbox
│   ├── qq-auth.js            # QR bind task
│   ├── qq-gateway.js         # raw QQ WebSocket gateway
│   ├── qq-api.js             # token + outbound QQ REST calls
│   ├── normalize.js          # QQ event normalization / reliable IDs
│   ├── agent-bridge.js       # QQ ↔ DSH Agent/Session bridge
│   ├── memory.js             # group/member memory + reflection
│   ├── rpc.js                # loopback DSH Connection RPC endpoints
│   ├── db.js                 # SQLite schema / repositories
│   ├── crypto.js
│   └── config.js
└── tests/
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the internal data flow and boundaries.

## Security notes

- QQ AppSecret is never exposed through the plugin RPC or UI status payload.
- The QR AES key remains Host-side in SQLite and is deleted after success / expiry pruning.
- Plugin RPC is registered with DSH Connection using `authority: 'loopback'`.
- Raw QQ API error handling avoids returning the AppSecret.
- Stable sender IDs, not nicknames, own member memory.
- The full raw QQ event is stored in message history for debugging/context provenance; treat `qqchat.sqlite` as private user data.

## License

Private / proprietary for now (`UNLICENSED`).
