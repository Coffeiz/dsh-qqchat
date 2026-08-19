# dsh-qqchat Architecture

[中文](./ARCHITECTURE.md)

## Core boundary

`dsh-qqchat` is an out-of-tree DSH plugin and does not fork DeepSeek Harness.

```text
dsh-qqchat
  QQ protocol / auth / identity
  real QQ history
  receive policy
  group + member memory
  tool authority
  proactive sending
  QQ-specific Client presentation

DSH
  Agent loop
  Session lifecycle
  model routing
  tools
  Session list
  Conversation shell
```

QQ Chat owns neither a second AgentLoop nor a second chat-navigation system.

## Sessions are the navigation unit

Each QQ peer maps to one ordinary DSH Session:

```text
group -> groups.dsh_session_id
c2c   -> members.dsh_session_id

sessionId = qqchat-<uuid>
```

Titles are persisted through DSH session titles:

```text
QQ Group · <group name>
QQ Direct · <nickname>
```

The Client no longer registers a `sidebar.footer.action` chat picker. QQ Sessions are listed and opened by DSH's normal Session/Workspace Browser.

A new silent-only peer would otherwise remain blank because DSH uses `turn/start` to decide whether a Session has begun. The plugin submits one internal `qq-chat-bootstrap` wake and rejects it in `agent/pre-step`. This leaves a durable turn boundary while producing no model step, no LLM call, no QQ output and no model-visible bootstrap content.

## Settings boundary

`settings.section: qqchat` contains only the control plane:

```text
QR authorization / connection
Auto reply / Mention only / Silent record
reply compatibility format
group-member tool permission
Owner stable ID
plugin logs
```

Settings does not contain chat lists, transcripts or memory browsing.

## Conversation boundary

QQ Sessions use the main DSH Conversation surface.

```text
conversation.chat.node
  qqchat-message      # only QQ transcript rows that do not wake the Agent

conversation.composer
  QQ Session composer # proactive QQ send, no local Agent turn

conversation.session.header.utilities
  QQ Memory
```

### Agent-triggering QQ messages

Messages selected by the receive policy use DSH's native `user/message` path:

```text
QQ inbound
  -> SQLite
  -> context snapshot
  -> Agent.followup()
  -> user/message
  -> DSH Agent loop
  -> assistant/tool events
  -> QQ API
```

The source keeps `kind: user` while adding reliable QQ metadata such as channel, bot id, chat id, sender id, message id and mention state. The same incoming message is therefore not also appended as `qqchat/message`, preventing duplicate transcript rows.

### Messages that do not wake the Agent

Messages observed in Mention-only or Silent-record modes append the plugin's log-only event:

```text
qqchat/message
```

It can be rendered by the Client but is not part of the DSH model surface and never wakes the Agent.

The plugin no longer replays SQLite history into new DSH Sessions. SQLite remains the complete QQ-world history; DSH persistence records the Session events that actually happened while the plugin was running.

## Host / Client

```text
DSH Web Client
      |
      | Connection RPC /qqchat
      v
+--------------------------------------+
| dsh-qqchat Host                      |
|                                      |
| QQBindService                        |
| QQGateway -- QQApiClient             |
|      |                               |
|      v                               |
| QQChatRuntime                        |
|   |       |                          |
|   |       +-- QQChatDatabase         |
|   |       +-- MemoryEngine           |
|   |       +-- QQChatLogger           |
|   v                                  |
| DshQQBridge                          |
+---+----------------------------------+
    v
 DSH Agent / Session / Tools
```

Credentials, tokens and temporary QR AES keys stay on the Host side.

## Three data planes

### QQ world truth

SQLite owns:

```text
accounts
groups
members
group_members
messages
memory_documents
reflection_state
plugin_settings
outbox
```

### DSH Session/UI plane

The Session log owns Agent turns, assistant/tool events, log-only QQ transcript rows, titles and turn boundaries.

### Model surface

The model receives the normal DSH surface plus context snapshots explicitly injected by the plugin. Full QQ history does not become model history merely because it exists in SQLite or the UI transcript.

## Inbound state machine

```text
QQ dispatch
   |
normalize stable identity
   |
upsert member/group
   |
insert SQLite message
   |
receive mode
   +-- silent -----------------> qqchat/message -> stop
   +-- mention + not @ --------> qqchat/message -> stop
   `-- auto / mentioned / c2c
        +-- assemble memory/context
        +-- Agent.followup(user message)
        +-- DSH tools/model loop
        `-- QQ outbound
```

Every mode preserves real QQ history and memory input. The receive mode only controls whether a message enters an Agent turn.

## Identity

Stable sender priority:

```text
author.user_openid
  || author.member_openid
  || author.id
```

```text
senderId   -> identity / authority / memory key
senderName -> display only
```

Nicknames are never treated as identity evidence.

## Agent context

Before a group turn the plugin reconstructs:

```text
recent group history
+ group profile / summary / memory / daily
+ current member profile / pattern / summary
+ stable sender and group metadata
```

The current QQ text enters as the normal user prompt; reliable identity is retained in source metadata and the injected context snapshot.

## Tool authority

The plugin uses DSH's official:

```text
tools/pre-execute
```

During one QQ turn it tracks:

```text
sessionId -> { chatType, senderId }
```

Policy:

```text
non-group QQ turn                  -> allow
groupMembersCanUseTools == true   -> allow
senderId == ownerUserId           -> allow
otherwise                         -> deny
```

No Tool Runtime or AgentLoop fork is required.

## Memory scope

Group:

```text
profile
summary
daily
memory
```

Member:

```text
profile
pattern
summary
```

Group scope never crosses groups. Member scope may remain continuous across groups under the same Bot.

Reflection is triggered by idle debounce or batch threshold and attributes updates by stable sender id.

## Memory UI

The `QQ Memory` Session utility shows group profile/summary/memory/daily and a member list. Selecting a member opens that member's profile/pattern/summary. Direct Sessions show the corresponding member profile/pattern/summary.

## Proactive sending

The QQ Session composer calls `chat/send`:

```text
group -> /v2/groups/.../messages
c2c   -> /v2/users/.../messages
```

This sends directly to QQ and does not create another local Agent prompt. The durable outbox remains independent of a Session being live.

## Persistence boundary

```text
qqchat.sqlite
  QQ real history / identity / memory / settings / outbox

DSH Session persistence
  Agent turns / model output / tools / DSH transcript
```

Neither layer replaces the other.

## TypeScript build

```text
src/*.ts
client-src/*.cts
tests/*.test.ts
```

The Host is built with `tsc`. The Client is compiled to temporary CJS and then wrapped by `scripts/wrap-client.mjs` as a DSH Client factory. `lib/` is generated output rather than source truth.
