# dsh-qqchat

[English](./README.en.md)

`dsh-qqchat` 是一个为 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 开发的 QQ Chat 插件。

它通过 **QQ 官方 Bot** 接入 DSH，支持扫码授权、QQ 私聊、QQ群聊、群成员稳定身份识别、群/成员长期记忆、主动消息，以及直接嵌入 DSH 主工作区的 QQ 会话体验。

> 当前接入方式是 QQ 官方 Bot 授权，不是个人 QQ 账号登录。

## 当前状态

当前版本：`0.1.0-alpha.1`

已实现：

- QQ 官方 Bot 扫码授权
- QQ Gateway WebSocket、心跳、断线重连与 Resume
- C2C 私聊与群聊消息
- 稳定成员身份：`user_openid → member_openid → id`
- 群聊接收模式：**自动回应 / @回复 / 静默记录**
- 消息发送兼容格式：**智能兼容 / Markdown / 纯文本兼容**
- 群成员工具权限开关：开启时群友可使用当前 preset 的全部工具；关闭时仅 Owner 可使用工具
- 每个 QQ 群 / 私聊对象映射一个独立 DSH Session
- QQ 消息直接显示在 DSH 主聊天区，而不是塞在 Settings 中
- QQ 群聊与私聊选择入口
- QQ Session 专用发送框，输入内容直接发送到 QQ
- Session 顶部的群记忆 / 用户记忆查看入口
- 设置页中的插件日志查看
- 独立 SQLite，WAL 模式
- 群 scope + 成员 scope 的长期记忆系统
- 回复直接走 DSH Agent loop，不实现第二套 AgentLoop
- TypeScript Host / Client 源码

当前 alpha 暂未覆盖：完整富媒体、完整 QQ 表情解析、生产级数据库迁移工具，以及真实 QQ + DSH 的自动化 E2E。

## 安装

### 方式一：独立 `qqchat` profile（发布后推荐）

因为 `dsh-qqchat` 有 DSH Web UI，独立 profile 第一次需要同时加入官方 Web bundle：

```bash
# 安装
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app dsh-qqchat

# 启动
npx @deepseek-ai/dsh --profile qqchat
```

DSH 会为新的自定义 profile 自动初始化 `dsh-base`；`@deepseek-ai/dsh-web-app` 提供 DSH Web 工作区，`dsh-qqchat` 提供 QQ Host + Client 插件。

如果你已经在使用 DSH 自带的 `web` profile，也可以直接安装进去：

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-qqchat
npx @deepseek-ai/dsh --profile web
```

> 当前仓库仍是私有 alpha。在发布到 npm 前使用下面的 Git / 本地安装方式。

### 方式二：私有 GitHub 安装

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app "git+ssh://git@github.com/Coffeiz/dsh-qqchat.git#agent/typescript-migration"
npx @deepseek-ai/dsh --profile qqchat
```

Git 方式要求本机已经配置 GitHub SSH 权限。Git dependency 会通过 `prepare` 自动从 TypeScript 构建 `lib`。

如果 pnpm 阻止 Git dependency 的构建脚本，请按 DSH / pnpm 输出提示，在对应 profile 的 `pnpm-workspace.yaml` 中允许 `dsh-qqchat` 构建，然后重新安装。

### 方式三：本地源码

```bash
git clone git@github.com:Coffeiz/dsh-qqchat.git
cd dsh-qqchat
git switch agent/typescript-migration

npm install
npm run build
npm test

npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app .
npx @deepseek-ai/dsh --profile qqchat
```

### 更新 / 卸载

npm 发布后：

```bash
npx @deepseek-ai/dsh plugin --profile qqchat update dsh-qqchat
npx @deepseek-ai/dsh plugin --profile qqchat remove dsh-qqchat
```

卸载 package 不会自动删除插件数据。默认数据目录：

```text
$DSH_HOME/plugins/dsh-qqchat/
└── qqchat.sqlite
```

## 首次连接

1. 启动 DSH。
2. 打开 **设置 → QQ Chat**。
3. 点击 **扫码连接**。
4. 使用手机 QQ 扫码并选择需要授权的 QQ Bot。
5. QQ 返回 AppID 与 AES-GCM 加密的 AppSecret。
6. AppSecret 只在 DSH Host 中解密并写入本地 SQLite。
7. 插件立即启动 QQ Gateway。

扫码临时 AES key 不会通过 Client RPC 发送到浏览器。

## UI 设计

### Settings 只负责配置

Settings 中不再放群列表、聊天记录或记忆浏览器，只保留 QQ Chat 的控制面：

```text
设置 → QQ Chat

连接状态 / 扫码

消息接收
  群聊接收方式
    [ 自动回应 ] [ @回复 ] [ 静默记录 ]

  消息兼容格式
    智能兼容 / Markdown / 纯文本兼容

工具权限
  群成员可用工具  [开/关]
  Owner stable ID [关闭群友工具时使用]

诊断
  [ 查看日志 ]
```

三种群聊模式：

| 模式 | 记录群消息 | 唤醒 Agent | 自动回复 |
| --- | --- | --- | --- |
| 自动回应 | 是 | 每条消息 | 是 |
| @回复 | 是 | 只有 @Bot | 仅 @Bot |
| 静默记录 | 是 | 否 | 否 |

无论哪种模式，群消息都可以进入真实 QQ 历史和记忆系统。

### QQ 聊天进入 DSH 主工作区

插件通过 DSH 的 Sidebar / Conversation 扩展点接入，而不是在 Settings 内自己造聊天后台。

侧边栏底部会出现 **QQ Chat** 入口：

```text
QQ Chat
├── 群聊
│   ├── 项目群
│   └── 朋友群
└── 私聊
    ├── Alice
    └── Bob
```

选择一个 QQ 会话后，插件确保该 peer 对应的 DSH Session 存在，并使用 DSH 自己的 `sessions.open()` 打开它。此后聊天就在普通 DSH 主聊天区域中显示。

QQ Session 会使用类似下面的标题：

```text
QQ群 · <群名>
QQ私聊 · <昵称>
```

### 主聊天区

QQ群友消息通过自定义 `qqchat/message` Session event 显示成 QQ 对话气泡，包含：

- 群友显示名
- stable sender ID 的短显示
- 消息正文
- 引用内容
- 时间

QQ Session 的底部 composer 会替换成 QQ 发送框：输入的内容**直接发往 QQ**，不会被当作本地 DSH 用户 prompt 再跑一次 Agent。

Agent 真正被 QQ 消息触发时仍然走 DSH 原生 Agent loop，因此模型回复、tool call 和 DSH 的运行信息仍属于该 Session。

### 群记忆 / 用户记忆

QQ Session 顶部会出现 **QQ 记忆** 按钮。

群聊可查看：

- `profile`
- `summary`
- `daily`
- `memory`
- 群成员 stable ID

私聊可查看：

- `profile`
- `summary`
- `pattern`

记忆不再放在 Settings 主体中。

## 消息与 Session 路由

QQ 的“真实聊天历史”和 DSH 的“模型可见对话历史”仍然是两个不同概念。

```text
QQ Gateway
    │
    ▼
normalize identity
    │
    ├──────────────► qqchat.sqlite
    │                 messages / members / groups / memory
    │
    ├──────────────► DSH Session: qqchat/message
    │                 只用于主工作区聊天显示
    │                 不进入模型 surface
    │
    └─ 是否应该回复？
          │
          ├─ 否 ──► 结束
          │
          └─ 是
               │
               ▼
           DSH Agent
               │
               ▼
             QQ API
```

这意味着**静默记录的普通群消息现在也可以出现在 DSH 主聊天区**，但不会因为显示在 Session 中就污染模型上下文。

DSH 的工作区只会显示已经发生过 `turn/start` 的非空 Session。为了让一个只有静默 QQ 记录的新会话也能进入工作区，插件在首次创建 QQ Session 时会提交一次内部 `qq-chat-bootstrap` 唤醒；`agent/pre-step` 会立即 `reject` 这次 bootstrap，因此它只产生一个空的 turn 边界，**不会进入 model step、不会调用 LLM、也不会向 QQ 发送任何内容**。

真正进入模型的只有接收策略选中的 Agent turn：回复前插件从 SQLite 重新装配近期群聊、群记忆、当前 sender 记忆和可靠身份元数据，再交给 DSH Agent。

## 群成员工具权限

设置项 **群成员可用工具** 控制 QQ 群触发的 Agent turn。

开启：

```text
任意群友触发 Agent
        ↓
可使用当前 Agent preset 暴露的全部工具
```

关闭：

```text
senderId == Owner stable ID
        ├─ 是 → 允许工具
        └─ 否 → tools/pre-execute 拒绝工具调用
```

这里使用 DSH 官方 `tools/pre-execute` policy seam，不修改 Agent loop。

Owner 身份只根据 stable QQ sender ID 判断，不根据昵称猜测。如果关闭群友工具但没有设置 Owner stable ID，则群聊中的工具调用默认拒绝。

## 群成员身份

身份优先级：

```text
user_openid
  ↓ fallback
member_openid
  ↓ fallback
id
```

昵称只用于展示，不用于权限或记忆主键。

## 记忆系统

第一版沿用咕咕现有群记忆系统的核心语义，但持久化统一放在插件自己的 SQLite。

### Group scope

每个群维护：

- `profile`：长期稳定的群画像、群角色与结构
- `summary`：当前阶段紧凑总结
- `daily`：近期重要变化
- `memory`：长期决定、关系、项目、约定和反复话题

群内关系和群内事件不会泄漏到其他群。

### Member scope

每个稳定 QQ sender 维护：

- `profile`：较稳定个人事实
- `pattern`：反复出现的偏好 / 行为模式
- `summary`：当前个人状态摘要

同一个 Bot 下，同一 stable sender 可以在不同群之间保持个人层面的连续记忆。

### 异步反思

记忆不会每条消息都单独调用 LLM。默认触发：

- 群聊空闲约 120 秒；或
- 未反思消息达到 20 条。

反思沿用该群 Agent 实际 provider / model 路由，输入带 stable sender ID，不根据昵称推断成员身份。

## SQLite

默认数据库：

```text
$DSH_HOME/plugins/dsh-qqchat/qqchat.sqlite
```

使用 Node `node:sqlite` `DatabaseSync`，默认：

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
```

主要表：

```text
accounts            QQ AppID / AppSecret 与 Gateway 状态
auth_tasks          扫码 bind-task 状态
groups              QQ 群与 DSH Session 映射
members             stable QQ sender 与私聊 Session 映射
group_members       群成员关系
messages            私聊 / 群聊真实消息
memory_documents    group/member 长期记忆
reflection_state    记忆反思游标
plugin_settings     QQ Chat UI 运行设置
outbox              主动消息队列
```

## 配置

bundle 默认插入：

```yaml
- insert:
    - id: dsh-qqchat
      name: dsh-qqchat
      config:
        dataDir: !!js dshHomePath('plugins/dsh-qqchat')
```

大多数用户行为配置现在直接在 **设置 → QQ Chat** 修改并写入 SQLite；`cordis.patch.yml` 主要保留部署级配置。

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `dataDir` | `$DSH_HOME/plugins/dsh-qqchat` | 插件数据目录 |
| `agentPreset` | DSH 默认 | QQ Session 使用的 Agent preset |
| `provider` / `model` | DSH 当前路由 | 可选固定模型路由 |
| `maxTokens` | DSH 默认 | Agent 最大输出 token |
| `recentGroupMessages` | `40` | 回复前注入近期群消息数量 |
| `reflectionIdleMs` | `120000` | 空闲反思等待时间 |
| `reflectionBatchSize` | `20` | 立即反思消息阈值 |
| `reflectionMaxMessages` | `80` | 单次反思最多消息数 |
| `memoryMaxTokens` | `1400` | 记忆反思最大输出 token |

兼容旧配置的 `groupChatEnabled / groupRequiresAt / replyFormat` 会用于第一次生成插件运行设置；之后以 SQLite 中的 QQ Chat 设置为准。

## TypeScript 开发

源码真相：

```text
src/*.ts                 Host
client-src/*.cts    DSH Client
tests/*.test.ts          tests
lib/                     build output，不提交
```

常用命令：

```bash
npm install
npm run typecheck
npm test
npm run build
```

Git 安装通过 `prepare` 构建；npm 发布通过 `prepublishOnly` 执行检查与构建。

## 仓库结构

```text
dsh-qqchat/
├── cordis.patch.yml
├── client-src/
│   └── plugin.cts
├── scripts/
│   └── wrap-client.mjs
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── config.ts
│   ├── runtime.ts
│   ├── logging.ts
│   ├── qq-auth.ts
│   ├── qq-gateway.ts
│   ├── qq-api.ts
│   ├── normalize.ts
│   ├── agent-bridge.ts
│   ├── memory.ts
│   ├── rpc.ts
│   ├── db.ts
│   └── crypto.ts
├── tests/
├── docs/
├── tsconfig.json
├── tsconfig.build.json
└── tsconfig.client.json
```

详细边界见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。

## 安全说明

- QQ AppSecret 不会通过插件 RPC 返回 Client。
- 扫码 AES key 只留在 Host。
- `/qqchat` RPC 使用 DSH Connection 的 `authority: 'loopback'`。
- 权限与记忆使用 stable sender ID，不使用昵称做身份判断。
- 群成员工具权限通过 DSH `tools/pre-execute` 拦截，而不是改 Agent loop。
- 原始 QQ event 与长期记忆属于私有用户数据，请妥善保护 `qqchat.sqlite`。
- `0.1.x` 暂时把 QQ AppSecret 保存到本地 SQLite，后续可迁移系统 Keychain / DSH credential store。

## 文档

- 中文 README：[`README.md`](./README.md)
- English README：[`README.en.md`](./README.en.md)
- 中文架构：[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- English architecture：[`docs/ARCHITECTURE.en.md`](./docs/ARCHITECTURE.en.md)

## License

当前私有开发阶段：`UNLICENSED`。
