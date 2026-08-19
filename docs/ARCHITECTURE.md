# dsh-qqchat architecture

## Design goals

`dsh-qqchat` is an out-of-tree DSH plugin. It should not require a fork of DeepSeek Harness, a second web application, PostgreSQL, Redis, or Gugu services.

The plugin owns QQ transport and IM-domain persistence; DSH owns Agent execution, model routing, tools and the canonical Session log for Agent-participating turns.

## Host / Client split

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
│             │       │                        │
│             ▼       ▼                        │
│          DshQQBridge ───► MemoryEngine       │
│             │                  │             │
└─────────────┼──────────────────┼─────────────┘
              ▼                  ▼
          DSH Agent          ctx.llm.stream
```

The client half contains only presentation and RPC calls. Credentials, QQ tokens and QR decryption keys never enter the browser module.

## QQ ingress

`QQGateway` receives official QQ dispatch events and `normalizeQQDispatch()` converts them to a small platform-neutral internal record.

Group identity priority:

```text
author.user_openid
  || author.member_openid
  || author.id
```

`senderName` is never a key.

The runtime then:

1. resolves/upserts the account member;
2. resolves/upserts the group and group-member relation;
3. applies `enabled / requiresAt / readEnabled`;
4. persists the accepted message;
5. schedules memory reflection;
6. only when a reply is required, forwards the turn to `DshQQBridge`.

This is intentionally different from forwarding all visible group traffic into the DSH Agent queue.

## DSH session mapping

- Group chat → `groups.dsh_session_id`
- QQ C2C peer → `members.dsh_session_id`

A group therefore has one durable Agent conversation identity, but silent group traffic remains in `messages`, not in the DSH Session log.

Before a reply turn, `DshQQBridge` injects one synthetic model-facing context message with:

- group memory;
- current member memory;
- recent group history with reliable sender IDs.

It then follows up with the current QQ user message. The Agent's response is collected from `session/event` `assistant/message` events.

The latest real `request/header` provider/model route is captured for memory reflection so auxiliary memory calls follow the group's actual DSH route instead of introducing a second model configuration source.

## Memory scopes

### Group

Primary key: SQLite group row id, itself unique on `(account_id, platform_group_id)`.

Documents:

```text
profile
summary
daily
memory
```

### Member

Primary key: SQLite member row id, itself unique on `(account_id, platform_user_id)`.

Documents:

```text
profile
pattern
summary
```

The split preserves the key Gugu invariant: cross-group personal identity can be stable under the same bot, while group-specific relationships/decisions cannot leak to another group.

## Reflection

`reflection_state.last_message_id` is the durable cursor. The engine reads at most `reflectionMaxMessages` newer messages.

Triggers:

- debounce idle trigger (`reflectionIdleMs`), or
- immediate trigger when `reflectionBatchSize` is reached.

The LLM receives JSON containing existing docs + reliable-ID transcript and must return strict JSON. Unknown member IDs are discarded rather than guessed from display names.

## Client UI

The package declares `dsh.client` and exports `./client`. `lib/client.js` is a DSH lazy-CJS factory loaded by the existing DSH client module system.

It registers into the standard `settings.section` slot:

```text
id    = qqchat
order = 35
label = QQ Chat
```

No DSH source patch is needed.

The UI deliberately relies on the DSH CSS variable vocabulary (`--dsw-*`) and the platform-provided React module. The only hardcoded white surface is the QR image backing needed for scanner contrast.

## RPC boundary

Host registers:

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

The custom channel keeps UI-specific data separate from the DSH core API vocabulary and inherits DSH's existing browser/host trust fencing.

## Proactive sends

`group/send` performs an immediate active group send. The SQLite `outbox` is also present for scheduler/automation integration without depending on DSH's current session-local reminder delivery semantics.

Future scheduled-message support should enqueue to this outbox rather than require a live DSH Session at the due time.

## SQLite ownership

`qqchat.sqlite` is plugin-owned state. DSH Session persistence remains a separate subsystem.

This boundary is deliberate:

```text
QQ reality / history / identity / memory  -> qqchat.sqlite
Agent-visible turns / tool calls / output -> DSH Session
```

It avoids turning every ambient group message into model conversation history.
