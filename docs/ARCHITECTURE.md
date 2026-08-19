# dsh-qqchat 架构

[English](./ARCHITECTURE.en.md)

## 设计目标

`dsh-qqchat` 是独立的 DSH out-of-tree 插件，不 fork DeepSeek Harness，也不依赖 PostgreSQL、Redis 或外部业务后端。

职责边界：

```text
dsh-qqchat
  QQ protocol / identity
  real IM history
  group + member memory
  QQ receive policy
  QQ tool authority policy
  proactive sending
  QQ-specific Client UI

DSH
  Agent loop
  Session runtime
  model routing
  tools
  main workspace / conversation shell
```

## UI 边界

### Settings 是控制面

`settings.section: qqchat` 只放：

- 扫码与连接状态
- 自动回应 / @回复 / 静默记录
- 消息兼容格式
- 群成员工具权限
- Owner stable ID
- 查看日志

Settings 不再承担群列表、私聊列表、聊天记录或记忆浏览器。

### 主工作区是聊天面

Client 通过 DSH 标准扩展点接入：

```text
sidebar.footer.action
  └── QQ Chat 会话选择器

conversation.chat.node
  └── qqchat-message 群友/Owner 气泡

conversation.composer
  └── QQ Session 专用 composer

conversation.session.header.utilities
  └── QQ 记忆
```

选中群聊或私聊后，Client 调用 Host `chat/ensure`，Host 保证该 peer 有稳定 DSH Session，然后 Client 调用 `ctx.sessions.open(sessionId)`。因此聊天真正运行在 DSH 自己的 Conversation 工作区。

## Host / Client

```text
DSH Browser
   │
   │ Connection RPC /qqchat
   ▼
┌───────────────────────────────────────────────┐
│ dsh-qqchat Host                               │
│                                               │
│ QQBindService       QQGateway / QQApiClient   │
│       │                    │                  │
│       └────────────┬───────┘                  │
│                    ▼                          │
│              QQChatRuntime                    │
│              │    │    │                      │
│              │    │    ├── QQChatLogger       │
│              │    └──────► SQLite             │
│              ▼                                │
│           DshQQBridge ─────► MemoryEngine      │
│              │                                │
└──────────────┼────────────────────────────────┘
               ▼
           DSH Agent
```

QQ credential、Token、AES 临时 key 都只存在 Host。

## 三个数据层

当前实现明确区分：

### 1. QQ 真实数据层

SQLite 是 QQ 世界发生了什么的事实来源：

```text
messages
members
groups
group_members
memory_documents
plugin_settings
```

### 2. DSH UI transcript 层

每条 QQ 消息可追加一个自定义 Session event：

```text
qqchat/message
```

它是 **log-only display event**，Client Conversation Definition 把它渲染成 QQ 气泡。

DSH 核心的模型 surface 只派生：

```text
user/message
assistant/message
tool/result
```

因此 `qqchat/message` 出现在 DSH Session log 中并不等于进入模型 history。

DSH 的工作区列表用 `turn/start` 判断 Session 是否已经启用；单纯追加自定义 display event 仍会保持 blank。QQ Session 第一次创建时会额外提交一次内部 `qq-chat-bootstrap`，并由 `agent/pre-step` 立即 `reject`。它只留下 `turn/start` / `turn/end` 边界，不产生 model step、不调用 LLM、也不发送 QQ 消息。

这让静默群消息也能进入主工作区，同时保持模型上下文干净。

### 3. Agent turn 层

只有接收策略决定“应该回应”时才：

```text
memory/context assemble
       ↓
agent.inject(...)
       ↓
agent.followup(...)
       ↓
DSH Agent loop
```

近期群聊与长期记忆在 turn 前从 SQLite 重新装配。

## QQ 入站状态机

```text
QQ dispatch
   ↓
normalize
   ↓
upsert member/group
   ↓
insert messages
   ↓
append qqchat/message display event
   ↓
receive mode?
   ├── silent  ───────────────► stop
   ├── mention + not @ ───────► stop
   └── auto / mentioned
             ↓
          DSH Agent
             ↓
          QQ outbound
```

三种模式都记录消息；区别只在是否唤醒 Agent。

## Session 映射

```text
group  -> groups.dsh_session_id
c2c    -> members.dsh_session_id
```

Session id 由插件生成：

```text
qqchat-<uuid>
```

Session title 尽量通过 DSH `sessionTitle.rename()` 写成：

```text
QQ群 · <group>
QQ私聊 · <member>
```

Session 创建时会把 SQLite 最近 transcript 作为 `qqchat/message` display events seed 进来；这些 seed 不进入 model surface。

## 群成员工具权限

插件不复制 Tool Runtime，也不修改 Agent loop。

使用官方 waterfall：

```text
tools/pre-execute
```

QQ Agent turn 开始时，`DshQQBridge` 临时保存当前 actor：

```text
sessionId -> { chatType, senderId }
```

当工具执行时：

```text
非 group QQ turn
  -> next()

groupMembersCanUseTools == true
  -> next()

senderId == ownerUserId
  -> next()

其他情况
  -> { kind: 'deny', reason: ... }
```

这个 actor 状态只覆盖当前 Agent turn；权限主键永远是 stable sender ID。

## Identity

优先级：

```text
author.user_openid
  || author.member_openid
  || author.id
```

`display_name` / nickname 只用于 UI。

## Memory scope

### Group

```text
profile
summary
daily
memory
```

### Member

```text
profile
pattern
summary
```

Group scope 不跨群；Member scope 在同一个 Bot 下可以跨群连续。

Reflection 使用 `reflection_state.last_message_id` 做持久化 cursor，按 idle debounce / batch threshold 触发。

## RPC

Host：

```text
ctx.connection.rpc.handle('/qqchat', handler, { authority: 'loopback' })
```

主要 endpoints：

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

# legacy / compatibility
groups/list
group/get
group/messages
group/update
group/send
group/reflect
```

`chat/*` 是当前主 UI 使用的统一 group/c2c API。

## 日志

`QQChatLogger` 同时：

1. 转发到 DSH logger；
2. 保留最近一段插件日志的内存 ring buffer；
3. 通过 `logs/list` 给 Settings 的“查看日志”弹窗。

它不把 AppSecret 等 credential 放入 UI RPC。

## 主动发送

主工作区 QQ composer 调用：

```text
chat/send
```

Host 根据 `chatType` 选择：

```text
group -> /v2/groups/.../messages
c2c   -> /v2/users/.../messages
```

发送成功后写 SQLite，并追加 QQ transcript display event。

`outbox` 继续保留给将来的定时 / 主动消息任务，不依赖某个 DSH Session 必须持续 live。

## SQLite

`qqchat.sqlite` 由插件独占管理，与 DSH Session persistence 分离。

```text
QQ world truth      -> qqchat.sqlite
DSH UI transcript   -> qqchat/message events
Agent model history -> DSH model surface
```

这种三层分离是当前架构最重要的边界。

## TypeScript 构建

源码：

```text
src/*.ts
client-src/*.cts
tests/*.test.ts
```

Host 由 `tsc` 编译；Client 先编译成临时 CJS，再由 `scripts/wrap-client.mjs` 包装成 DSH `__ModuleLoader__` factory。

`lib/` 是生成物，不作为源码提交。
