# dsh-qqchat 架构

[English](./ARCHITECTURE.en.md)

## 核心边界

`dsh-qqchat` 是独立的 DSH out-of-tree 插件，不 fork DeepSeek Harness。

```text
dsh-qqchat
  QQ protocol / auth / identity
  QQ real history
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

QQ Chat 不维护第二套 AgentLoop，也不维护第二套聊天导航。

## Session 是主导航单位

每个 QQ peer 映射一个正常 DSH Session：

```text
group -> groups.dsh_session_id
c2c   -> members.dsh_session_id

sessionId = qqchat-<uuid>
```

标题通过 DSH `sessionTitle` 写入：

```text
QQ群 · <群名>
QQ私聊 · <昵称>
```

Client 不再注册 `sidebar.footer.action` 会话选择器。QQ Session 直接由 DSH 自己的 Session/Workspace Browser 展示和打开。

DSH 用 `turn/start` 判断一个 Session 是否仍为 blank。只有静默记录的新 QQ peer 没有正常 Agent turn，因此插件创建 Session 后提交一次 `qq-chat-bootstrap` wake，并在 `agent/pre-step` 立即 reject。结果是：

- 有 durable turn boundary；
- Session 能进入 DSH 正常列表；
- 没有 model step；
- 不调用 LLM；
- 不发送 QQ 消息；
- bootstrap 不进入模型 history。

## Settings 边界

`settings.section: qqchat` 只放控制面：

```text
扫码 / 连接状态
自动回应 / @回复 / 静默记录
消息兼容格式
群成员可用工具
Owner stable ID
查看日志
```

Settings 不包含群列表、私聊列表、聊天记录或记忆主界面。

## Conversation 边界

QQ Session 使用 DSH 主 Conversation。

```text
conversation.chat.node
  qqchat-message      # 仅静默/未触发 Agent 的 QQ transcript

conversation.composer
  QQ Session composer # 主动发 QQ，不触发本地 Agent

conversation.session.header.utilities
  QQ 记忆
```

### 触发 Agent 的 QQ 消息

接收策略决定需要回复时，消息直接走 DSH 原生 `user/message`：

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

Source 的 `kind` 保持 `user`，同时附带 QQ metadata：

```text
channel=qq
botId
chatType
chatId
senderId
senderName
messageId
mentioned
```

因此 DSH Conversation 把它当普通 user turn；插件不再为同一条消息额外 append `qqchat/message`，避免双份显示。

### 不触发 Agent 的 QQ 消息

`@回复` 下未 @Bot 的消息、以及 `静默记录` 下的群消息：

```text
session.append('qqchat/message', ...)
```

`qqchat/message` 是 log-only 自定义 Session event：

- Client 可渲染 QQ 群友气泡；
- 不属于 DSH model surface；
- 不会唤醒 Agent；
- 不会调用 LLM。

插件不再从 SQLite 重放整段历史到 DSH Session。DSH Session 保存它实际经历过的 display/Agent events，完整 QQ 世界历史始终由 SQLite 负责。

## Host / Client

```text
DSH Web Client
      │
      │ Connection RPC /qqchat
      ▼
┌──────────────────────────────────────┐
│ dsh-qqchat Host                      │
│                                      │
│ QQBindService                        │
│ QQGateway ── QQApiClient             │
│      │                               │
│      ▼                               │
│ QQChatRuntime                        │
│   │       │                          │
│   │       ├── QQChatDatabase         │
│   │       ├── MemoryEngine           │
│   │       └── QQChatLogger           │
│   ▼                                  │
│ DshQQBridge                          │
└───┬──────────────────────────────────┘
    ▼
 DSH Agent / Session / Tools
```

QQ credential、Token、扫码 AES 临时 key 都只存在 Host。

## 三个数据面

### 1. QQ 真实数据面

SQLite 是 QQ 世界事实来源：

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

### 2. DSH Session / UI 数据面

记录：

- Agent 真正参与的 turn；
- assistant/tool events；
- 不唤醒 Agent 的 log-only QQ transcript；
- Session title 和 turn boundary。

### 3. Model surface

模型只看到 DSH 正常 surface 以及插件明确注入的 context snapshot。

完整群聊不会因为存在 SQLite 或 QQ UI transcript 就自动进入模型 history。

## 入站状态机

```text
QQ dispatch
   ↓
normalize stable identity
   ↓
upsert member/group
   ↓
insert SQLite message
   ↓
receive mode
   ├─ silent
   │    └─ qqchat/message -> stop
   │
   ├─ mention + not @
   │    └─ qqchat/message -> stop
   │
   └─ auto / mentioned / c2c
        ├─ assemble memory/context
        ├─ Agent.followup(user message)
        ├─ DSH tools/model loop
        └─ QQ outbound
```

三种模式都会留下真实 QQ 历史并参与记忆活动；区别只是是否进入 Agent turn。

## Identity

稳定身份优先级：

```text
author.user_openid
  || author.member_openid
  || author.id
```

原则：

```text
senderId   -> 身份 / 权限 / 记忆主键
senderName -> 仅展示
```

不根据昵称推断身份。

## Agent context

群聊每次 Agent turn 前从 SQLite 重新装配：

```text
recent group history
+ group profile
+ group summary
+ group memory
+ group daily
+ current member profile
+ current member pattern
+ current member summary
+ stable sender/group metadata
```

当前 QQ 消息本身以正常 user prompt 进入 turn；可靠身份信息则由 source metadata 和 context snapshot 提供。

## 工具权限

使用 DSH 官方：

```text
tools/pre-execute
```

当前 QQ Agent turn 临时记录：

```text
sessionId -> { chatType, senderId }
```

规则：

```text
非 QQ group turn                    -> next()
groupMembersCanUseTools == true    -> next()
senderId == ownerUserId            -> next()
其他                                -> deny
```

不修改 Tool Runtime 或 AgentLoop。

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

Group scope 不跨群；同一 Bot 下的 Member scope 可以跨群连续。

反思以 idle debounce / batch threshold 触发，并使用 stable sender ID 做归属。

## 记忆 UI

QQ Session 顶部 `QQ 记忆`：

群聊：

```text
group profile / summary / memory / daily
member list
  -> 点击成员
     -> member profile / pattern / summary
```

私聊：

```text
member profile / pattern / summary
```

## 主动发送

QQ Session composer 调用：

```text
chat/send
```

Host：

```text
group -> /v2/groups/.../messages
c2c   -> /v2/users/.../messages
```

主动发送直接进 QQ，不再作为本地 Agent prompt。

`outbox` 独立于 Session live 生命周期，留给定时/主动任务。

## RPC

Host 注册 loopback RPC：

```text
/qqchat
```

主要 endpoints：

```text
status
auth/start
auth/poll
settings/get
settings/update
logs/list
chat/send
chat/info
```

旧的 `chats/list` / `chat/ensure` / `group/*` 仍可作为兼容 API，但当前主导航不再依赖它们。

## SQLite 与 DSH persistence 的关系

```text
qqchat.sqlite
  QQ 真实历史 / identity / memory / settings / outbox

DSH Session persistence
  Agent turns / model output / tools / DSH transcript
```

二者互不替代。

## TypeScript 构建

```text
src/*.ts
client-src/*.cts
tests/*.test.ts
```

Host 使用 `tsc`；Client 编译到临时 CJS 后由 `scripts/wrap-client.mjs` 包装成 DSH Client factory。

`lib/` 是生成物，不作为源码真相。
