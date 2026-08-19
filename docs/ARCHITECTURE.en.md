# dsh-qqchat architecture

[中文](./ARCHITECTURE.md)

## Boundaries

`dsh-qqchat` is an out-of-tree DSH plugin. It owns QQ transport, identity, real IM history, group/member memory, receive policy, QQ-specific tool authorization, proactive sending, and QQ-specific UI. DSH remains responsible for the Agent loop, model routing, tools, Sessions, and the main workspace shell.

## UI boundary

Settings is a control plane only: QR binding, receive mode, compatibility format, group-member tool policy, Owner stable ID, and logs.

Actual chats use standard DSH extension seams:

```text
sidebar.footer.action                 QQ Chat picker
conversation.chat.node                qqchat-message bubbles
conversation.composer                 QQ direct-send composer
conversation.session.header.utilities QQ Memory
```

Selecting a group or direct peer calls `chat/ensure`, then the Client opens the returned Session via `ctx.sessions.open(sessionId)`.

## Three data layers

```text
QQ world truth      -> qqchat.sqlite
UI transcript       -> custom qqchat/message Session events
Agent model history -> DSH model surface
```

`qqchat/message` is a log-only custom event rendered by a Client Conversation Definition. It is not one of DSH's model-producing `user/message`, `assistant/message`, or `tool/result` events, so silent group traffic can be visible without polluting model history.

Because DSH workspace visibility uses `turn/start` to distinguish an engaged Session from a blank one, a newly created QQ Session performs one internal `qq-chat-bootstrap` wake. `agent/pre-step` immediately rejects that bootstrap, producing only an empty turn boundary with no model step, no LLM request, and no QQ output.

Only receive-policy-selected messages execute a real `agent.followup()` turn.

## Receive state machine

```text
QQ dispatch
  -> normalize
  -> upsert identity
  -> persist message
  -> append display event
  -> policy
       silent              -> stop
       mention + not @     -> stop
       auto / mentioned    -> DSH Agent -> QQ outbound
```

## Session mapping

```text
group -> groups.dsh_session_id
c2c   -> members.dsh_session_id
```

Sessions use `qqchat-<uuid>` identifiers. The plugin attempts to set DSH log-backed titles through `sessionTitle.rename()`.

## Tool authorization

During a QQ-triggered Agent turn, the bridge associates the Agent Session with the stable sender ID. The plugin listens on DSH's `tools/pre-execute` waterfall:

```text
not a QQ group turn                  -> delegate
groupMembersCanUseTools              -> delegate
senderId == ownerUserId              -> delegate
otherwise                            -> deny
```

No AgentLoop fork is required.

## Memory

Group documents: `profile`, `summary`, `daily`, `memory`.

Member documents: `profile`, `pattern`, `summary`.

Group facts remain group-local; stable member facts may continue across groups under the same bot account.

## RPC

Main endpoints:

```text
status
auth/start
auth/poll
settings/get
settings/update
logs/list
chats/list
chat/ensure
chat/send
chat/info
```

Legacy `group/*` RPCs remain for compatibility.

## Logging

`QQChatLogger` forwards to the DSH logger and keeps a bounded in-memory ring buffer exposed through `logs/list` for the Settings log viewer.

## TypeScript build

```text
src/*.ts
client-src/*.cts
tests/*.test.ts
```

Host code is compiled by `tsc`; the Client is compiled to temporary CJS and wrapped by `scripts/wrap-client.mjs` into the DSH `__ModuleLoader__` factory. `lib/` is generated output.
