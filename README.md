# dsh-qqchat

[English](./README.en.md)

`dsh-qqchat` 是一个为 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 开发的 QQ 聊天插件。

它通过 **QQ 官方 Bot** 接入 DSH，支持私聊、群聊、扫码授权、群成员身份识别、群历史、群/成员长期记忆、主动消息，以及遵循 DSH 现有视觉风格的管理界面。

> 当前接入方式是 QQ 官方 Bot 授权，不是个人 QQ 账号登录。

## 功能

当前 `0.1.0-alpha.1` 包含：

- QQ 官方 Bot 扫码授权
- QQ Gateway WebSocket、心跳、断线重连与 Resume
- C2C 私聊与群聊消息
- 稳定群成员身份：`user_openid → member_openid → id`
- 群聊策略：启用/停用、是否必须 `@`、是否读取普通群消息
- 每个 QQ 群 / 私聊对象映射独立 DSH Agent Session
- 回复直接使用 DSH Agent loop，不再实现第二套 AgentLoop
- 主动群消息与持久化 outbox
- 独立 SQLite 数据库（WAL）
- 群 scope + 成员 scope 长期记忆
- DSH 原生 UI：扫码、群列表、群友对话气泡、群记忆、成员记忆、群设置
- TypeScript 源码

当前 alpha 暂未覆盖完整富媒体发送、完整 QQ 表情解析、生产级数据库迁移工具和真实 QQ + DSH 自动化 E2E。

## 安装

### 方式一：独立 `qqchat` profile（推荐）

使用方式可以和腾讯官方 QQ Bot 插件一样，为 QQ 单独准备一个 profile。

`dsh-qqchat` 自带扫码、对话气泡和记忆查看 UI，因此第一次安装时同时加入 DSH Web bundle：

```bash
# 安装到独立 qqchat profile
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app dsh-qqchat

# 启动
npx @deepseek-ai/dsh --profile qqchat
```

DSH 会为新的自定义 profile 自动初始化 `dsh-base`；`@deepseek-ai/dsh-web-app` 提供 DSH Web 界面，`dsh-qqchat` 提供 QQ Host + Client 插件。

启动后打开 DSH Web UI，进入 **Settings → QQ Chat**，点击 **扫码连接**。

> 当前仓库仍是私有 alpha。在 `dsh-qqchat` 发布到 npm 前，请使用下面的 Git 安装方式。

### 方式二：安装到已有 `web` profile

如果你本来就在使用 DSH 的 `web` profile，不需要再创建 `qqchat`：

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-qqchat
npx @deepseek-ai/dsh --profile web
```

### 方式三：从私有 GitHub 安装

当前测试 TypeScript 分支：

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app "git+ssh://git@github.com/Coffeiz/dsh-qqchat.git#agent/typescript-migration"
npx @deepseek-ai/dsh --profile qqchat
```

以后 `main` 稳定后可去掉分支后缀：

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app "git+ssh://git@github.com/Coffeiz/dsh-qqchat.git"
npx @deepseek-ai/dsh --profile qqchat
```

Git 安装要求本机已经配置 GitHub SSH 权限。Git 依赖会通过 `prepare` 从 TypeScript 生成 `lib`；如果 pnpm 阻止 Git 依赖执行构建脚本，请按 DSH / pnpm 的提示允许 `dsh-qqchat` 构建后重新安装。

### 本地源码安装

```bash
git clone git@github.com:Coffeiz/dsh-qqchat.git
cd dsh-qqchat
git switch agent/typescript-migration

npm install
npm run build

npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app .
npx @deepseek-ai/dsh --profile qqchat
```

### 更新与卸载

npm 发布后：

```bash
npx @deepseek-ai/dsh plugin --profile qqchat update dsh-qqchat
npx @deepseek-ai/dsh plugin --profile qqchat remove dsh-qqchat
```

卸载插件不会主动删除本地数据。默认数据库：

```text
$DSH_HOME/plugins/dsh-qqchat/qqchat.sqlite
```

## 扫码连接

1. 打开 **Settings → QQ Chat**。
2. 点击 **扫码连接**。
3. Host 创建 QQ `bind_task` 和临时 AES-256 key。
4. 使用手机 QQ 扫码并选择需要授权的 QQ Bot。
5. QQ 返回 AppID 与 AES-GCM 加密的 AppSecret。
6. AppSecret 只在 DSH Host 进程中解密，并写入插件 SQLite。
7. 插件立即启动 QQ Gateway WebSocket。

临时 AES key 不会发到浏览器；Client 只得到展示二维码和查询状态需要的数据。

## UI

插件直接注册到 DSH `settings.section`，不另起后台网页或管理端口。

```text
┌──────────────┬───────────────────────────────┬──────────────────┐
│ 群列表       │ 群聊                         │ 群信息           │
│              │                               │                  │
│ 项目群       │ Alice  …stable-id             │ 群记忆           │
│ 朋友群       │ ┌──────────────────────────┐  │ 群友             │
│ ...          │ │ 群友消息气泡             │  │ 设置             │
│              │ └──────────────────────────┘  │                  │
│              │                  DSH Agent    │ profile          │
│              │             ┌─────────────┐   │ summary          │
│              │             │ 回复气泡    │   │ memory / daily   │
└──────────────┴───────────────────────────────┴──────────────────┘
```

UI 优先使用 DSH 的 `--dsw-*` design token，因此明暗主题和层级会跟随 DSH。

## 消息与 Session

QQ 群真实历史和 DSH Agent 对话是两套不同的数据面：

```text
QQ Gateway
    │
    ├─ 规范化 sender / group identity
    ├─ 写入 SQLite：message / member / group
    ├─ 普通未触发消息 ───────► 群历史 / 记忆
    └─ 需要回复
              │
              ▼
          DSH Agent
              │
              ▼
          QQ outbound
```

一个群对应一个 DSH Session，但**不会把完整群历史全部塞进 DSH Session**。只有 Agent 真正参与的 turn 进入 DSH 会话；回复前再注入近期群聊、群记忆和当前成员记忆。

## 群成员身份

身份优先级：

```text
user_openid
  ↓ fallback
member_openid
  ↓ fallback
id
```

昵称只用于展示，不作为身份、权限或记忆主键。

## 记忆系统

第一版沿用咕咕群记忆系统的核心语义，但持久化统一放在插件自己的 SQLite。

### 群 scope

- `profile`：稳定群画像、角色和结构
- `summary`：当前阶段紧凑总结
- `daily`：近期重要变化
- `memory`：长期决定、关系、项目、约定和重复话题

群相关事实不会跨群泄漏。

### 成员 scope

- `profile`：较稳定个人事实
- `pattern`：反复出现的偏好 / 行为模式
- `summary`：当前个人摘要

同一个 QQ Bot 下，同一 stable sender 可以跨群保持个人层面的连续记忆；群内关系和群内事件仍属于对应群 scope。

### 异步反思

默认在群聊空闲约 120 秒，或未反思消息达到约 20 条时整理记忆，不会每条消息都调用一次 LLM。反思沿用该群 DSH Agent 实际使用的 provider/model 路由。

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
accounts
 auth_tasks
groups
members
group_members
messages
memory_documents
reflection_state
outbox
```

职责边界：

```text
QQ 真实历史 / 身份 / 群状态 / 记忆 -> qqchat.sqlite
Agent 可见 turn / tool call / 回复     -> DSH Session
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

常用配置：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `dataDir` | `$DSH_HOME/plugins/dsh-qqchat` | 插件数据目录 |
| `agentPreset` | DSH 默认 | QQ Session 使用的 preset |
| `provider` / `model` | DSH 当前路由 | 可选固定模型 |
| `groupChatEnabled` | `true` | 群聊总开关 |
| `groupRequiresAt` | `true` | 新群默认要求 @ |
| `groupReadEnabled` | `true` | 记录普通未 @ 群消息 |
| `recentGroupMessages` | `40` | 回复前注入的近期消息数 |
| `reflectionIdleMs` | `120000` | 空闲反思等待时间 |
| `reflectionBatchSize` | `20` | 立即反思阈值 |

每个群也可以直接在 QQ Chat UI 中单独修改。

## TypeScript 开发

TypeScript 是源码真相：

```text
src/*.ts                 Host
client-src/plugin.cts    DSH Client UI
tests/*.test.ts          测试
lib/*.js + lib/*.d.ts    构建产物（不提交）
```

```bash
npm install
npm run typecheck
npm test
npm run build
```

Git 安装通过 `prepare` 构建；npm 发布前通过 `prepublishOnly` 重新检查和构建。最终 DSH 运行的是普通 JavaScript，不需要 TypeScript runtime。

详细边界见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)。

## 安全

- QQ AppSecret 不通过插件 RPC 返回给 UI。
- 扫码 AES key 只保留在 Host 侧。
- 插件 RPC 使用 DSH Connection `authority: 'loopback'`。
- 成员记忆以 stable sender ID 为主键。
- 原始 QQ event 会保存在本地数据库，因此 `qqchat.sqlite` 应视为私有用户数据。
- 当前 `0.1.x` 会把 QQ AppSecret 保存在本地 SQLite，后续可迁移到系统 Keychain 或 DSH credential store。

## 文档

- 中文：[`README.md`](./README.md)、[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- English：[`README.en.md`](./README.en.md)、[`docs/ARCHITECTURE.en.md`](./docs/ARCHITECTURE.en.md)

## License

当前私有开发阶段：`UNLICENSED`。
