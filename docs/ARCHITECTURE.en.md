# dsh-qqchat architecture

[简体中文](./ARCHITECTURE.md)

## Boundaries

`dsh-qqchat` is an out-of-tree DSH plugin. It does not require a DeepSeek Harness fork, PostgreSQL, Redis, or Gugu services.

Responsibilities:

- `dsh-qqchat`: QQ protocol, identity, real group history, long-term memory, proactive messages and plugin UI.
- DSH: Agent execution, model routing, tools and the canonical Session log for Agent-participating turns.

## Host / Client

```text
DSH Browser / Electron WebView
        │
        │ DSH Connection RPC (/qqchat, loopback)
        ▼
┌──────────────────────────────────────────────┐
│ dsh-qqchat Host                              │
│                                              │
│ QQBindService      QQGateway + QQApiClient   │
│       │                    │                 │
│       └──────────┬─────────┘                 │
│                  ▼                           │
│           QQChatRuntime                      │
│             │       │                        │
│             │       ├────► SQLite            │
│             ▼       ▼                        │
│          DshQQBridge ───► MemoryEngine       │
│             │                  │             │
└─────────────┼──────────────────┼─────────────┘
              ▼                  ▼
          DSH Agent          ctx.llm.stream
```

The Client owns presentation and RPC only. QQ credentials, tokens and QR decryption keys remain Host-side.

## QQ ingress

`QQGateway` receives official QQ dispatch events and `normalizeQQDispatch()` converts them into plugin-internal messages.

Stable sender identity priority:

```text
author.user_openid
  || author.member_openid
  || author.id
```

`senderName` is presentation-only.

Runtime order:

1. upsert member;
2. upsert group / group-member relation;
3. apply `enabled / requiresAt / readEnabled`;
4. persist the message;
5. schedule asynchronous memory reflection;
6. forward to `DshQQBridge` only when a reply is required.

Ambient group traffic therefore does not all enter the DSH Agent queue.

## DSH Session mapping

- Group chat → `groups.dsh_session_id`
- QQ C2C peer → `members.dsh_session_id`

A group has one durable Agent conversation identity, while ordinary non-triggering traffic stays in the plugin `messages` table.

Before a reply, the bridge injects a model-visible snapshot containing group memory, current-member memory and recent group history with stable sender IDs, then calls `followup()` with the current QQ message.

Assistant output is collected from `session/event` `assistant/message` events and sent back to QQ.

## Memory scopes

### Group

SQLite group row id is the scope key. Groups are unique on `(account_id, platform_group_id)`.

```text
profile
summary
daily
memory
```

### Member

SQLite member row id is the scope key. Members are unique on `(account_id, platform_user_id)`.

```text
profile
pattern
summary
```

This preserves cross-group personal continuity under the same Bot while keeping group-specific relationships, decisions and context isolated.

## Reflection

`reflection_state.last_message_id` is the durable cursor.

Triggers:

- idle debounce through `reflectionIdleMs`;
- immediate work when unprocessed traffic reaches `reflectionBatchSize`.

The LLM receives existing memory docs plus a reliable-ID transcript. Unknown member IDs are discarded rather than inferred from nicknames.

## Client UI

Source:

```text
client-src/plugin.cts
```

Generated runtime bundle:

```text
lib/client.js
```

The plugin registers into the standard DSH `settings.section` slot:

```text
id    = qqchat
order = 35
label = QQ Chat
```

The UI uses DSH `--dsw-*` design tokens and platform React; no DSH source patch is needed.

Recommended dedicated profile:

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app dsh-qqchat
npx @deepseek-ai/dsh --profile qqchat
```

DSH initializes `dsh-base` for a new custom profile, while `@deepseek-ai/dsh-web-app` supplies the Web surface.

## RPC

Host registration:

```text
ctx.connection.rpc.handle('/qqchat', handler, { authority: 'loopback' })
```

Endpoints:

```text
status
auth/start
auth/poll
account/reconnect
account/disconnect
groups/list
group/get
group/messages
group/update
group/send
group/reflect
```

The dedicated channel keeps QQ UI data separate from core DSH API vocabulary while reusing DSH browser/host trust fencing.

## Proactive messages

`group/send` performs an immediate active QQ group send. SQLite also owns an `outbox`; future schedulers and automations should enqueue there instead of requiring a DSH Session to remain live until delivery time.

## SQLite ownership

`qqchat.sqlite` is fully plugin-owned. DSH Session persistence is a separate subsystem.

```text
QQ reality / identity / group state / memory -> qqchat.sqlite
Agent-visible turns / tool calls / replies   -> DSH Session
```

## TypeScript build

```text
src/*.ts
client-src/plugin.cts
tests/*.test.ts
```

The Host is compiled with `tsc` to `lib/*.js + lib/*.d.ts`. The Client is compiled to temporary CJS and wrapped by `scripts/wrap-client.mjs` as a DSH `__ModuleLoader__` lazy-CJS factory.

`lib/` is generated rather than committed. Git installs build through `prepare`; npm publication checks and rebuilds through `prepublishOnly`.
