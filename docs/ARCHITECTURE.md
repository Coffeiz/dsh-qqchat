# dsh-qqchat 架构

[English](./ARCHITECTURE.en.md)

## 边界

`dsh-qqchat` 是独立的 DSH out-of-tree 插件，不要求 fork DeepSeek Harness，也不依赖 PostgreSQL、Redis 或其他项目服务。

职责：

- `dsh-qqchat`：QQ 协议、身份、真实群历史、长期记忆、主动消息、插件 UI。
- DSH：Agent 执行、模型路由、工具，以及 Agent 真正参与 turn 的 canonical Session log。

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

Client 只负责展示和 RPC。QQ AppSecret、Token、扫码解密 key 都留在 Host。

## QQ 入站

`QQGateway` 接收 QQ 官方 dispatch event，`normalizeQQDispatch()` 转成插件内部消息。

稳定成员身份优先级：

```text
author.user_openid
  || author.member_openid
  || author.id
```

`senderName` 只用于展示。

Runtime 顺序：

1. upsert member；
2. upsert group / group-member；
3. 应用 `enabled / requiresAt / readEnabled`；
4. 写入消息；
5. 安排异步 memory reflection；
6. 只有需要回复时才交给 `DshQQBridge`。

所以普通群聊不会全部进入 DSH Agent queue。

## DSH Session 映射

- 群聊 → `groups.dsh_session_id`
- QQ 私聊 → `members.dsh_session_id`

一个群拥有一个稳定 Agent conversation identity，但未触发 Agent 的普通消息只存在 `messages` 表。

回复前 Bridge 注入模型可见 snapshot：

- 群记忆；
- 当前成员记忆；
- 带 stable sender ID 的近期群聊。

之后才 `followup()` 当前 QQ 用户消息。Agent 回复从 `session/event` 的 `assistant/message` 收集并发回 QQ。

## Memory scope

### Group

以 SQLite group row id 为 scope 主键，group 由 `(account_id, platform_group_id)` 唯一。

```text
profile
summary
daily
memory
```

### Member

以 SQLite member row id 为 scope 主键，member 由 `(account_id, platform_user_id)` 唯一。

```text
profile
pattern
summary
```

因此同一 Bot 下稳定个人身份可以跨群连续，但群内关系、决定和语境不会泄漏到其他群。

## Reflection

`reflection_state.last_message_id` 是持久化游标。

触发条件：

- idle debounce：`reflectionIdleMs`；
- 未处理消息达到 `reflectionBatchSize`。

LLM 输入包含已有 memory docs 和 reliable-ID transcript。无法对应稳定 member ID 的结果直接丢弃，不根据昵称猜人。

## UI

源码：

```text
client-src/plugin.cts
```

构建为：

```text
lib/client.js
```

插件注册 DSH 标准 `settings.section`：

```text
id    = qqchat
order = 35
label = QQ Chat
```

UI 使用 DSH `--dsw-*` CSS token 和平台 React，不修改 DSH 源码。

推荐独立 profile：

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app dsh-qqchat
npx @deepseek-ai/dsh --profile qqchat
```

自定义 profile 由 DSH 自动初始化 `dsh-base`，再通过 `@deepseek-ai/dsh-web-app` 提供 Web surface。

## RPC

Host 注册：

```text
ctx.connection.rpc.handle('/qqchat', handler, { authority: 'loopback' })
```

Endpoints：

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

QQ UI 数据放在独立 channel，同时复用 DSH 的 browser/host trust fence。

## 主动消息

`group/send` 立即主动发送到 QQ 群。SQLite 另有 `outbox`，以后定时任务/automation 应写入 outbox，不依赖某个 DSH Session 到期时仍保持 live。

## SQLite 所有权

`qqchat.sqlite` 完全由插件管理；DSH Session persistence 是独立子系统。

```text
QQ 真实历史 / 身份 / 群状态 / 记忆 -> qqchat.sqlite
Agent 可见 turn / tool call / 回复     -> DSH Session
```

## TypeScript 构建

```text
src/*.ts
client-src/plugin.cts
tests/*.test.ts
```

Host 使用 `tsc` 输出 `lib/*.js + lib/*.d.ts`。Client 先编译为临时 CJS，再由 `scripts/wrap-client.mjs` 包成 DSH `__ModuleLoader__` lazy-CJS factory。

`lib/` 是生成物，不作为源码提交。Git 安装用 `prepare` 构建，npm 发布前用 `prepublishOnly` 检查并构建。
