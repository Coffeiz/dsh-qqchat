# dsh-qqchat

[English](./README.en.md)

`dsh-qqchat` 是一个为 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 开发的 QQ Chat 插件。

它通过 **QQ 官方 Bot** 接入 DSH，目标不是做一套独立聊天后台，而是让 **QQ 私聊和 QQ 群聊直接成为普通 DSH Session**：会话出现在 DSH 自己的 Session/工作区列表里，聊天发生在主 Conversation 区域，Agent、工具调用、模型输出和 Session 持久化继续走 DSH 原生链路。

> 当前接入的是 QQ 官方 Bot 授权，不是个人 QQ 账号扫码登录。

## 当前能力

- QQ 官方 Bot 扫码授权
- QQ Gateway WebSocket、心跳、断线重连与 Resume
- C2C 私聊与群聊
- 稳定成员身份：`user_openid → member_openid → id`
- 群聊接收模式：**自动回应 / @回复 / 静默记录**
- 群聊默认使用**纯文本兼容**，群聊与私聊可分别选择**智能兼容 / Markdown / 纯文本兼容**
- 群成员工具总开关
- Owner stable ID 权限判断
- 每个 QQ 群 / 私聊对象映射一个独立 DSH Session
- QQ Session 使用 DSH 原生 Session Title
- QQ 消息显示在 DSH 主聊天区
- QQ Session 专用发送框，直接向 QQ 主动发送消息
- 群记忆、成员记忆与私聊用户记忆查看
- 设置页查看插件日志
- 独立 SQLite，WAL 模式
- 群 scope + 成员 scope 长期记忆
- 空闲 / 批量异步记忆反思
- TypeScript Host / Client 源码

当前 alpha 仍需要真实 QQ + DSH 环境做完整 E2E；富媒体、完整 QQ 表情和生产级数据库迁移工具也不在第一版范围内。

## 安装

### 独立 `qqchat` profile

因为插件包含 DSH Web UI，独立 profile 第一次需要同时安装官方 Web bundle：

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app dsh-qqchat
npx @deepseek-ai/dsh --profile qqchat
```

### 已有 `web` profile

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-qqchat
npx @deepseek-ai/dsh --profile web
```

### 当前私有仓库分支

npm 发布前可以直接从 GitHub 安装：

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app "git+ssh://git@github.com/Coffeiz/dsh-qqchat.git#agent/typescript-migration"
npx @deepseek-ai/dsh --profile qqchat
```

Git dependency 会通过 `prepare` 从 TypeScript 构建 `lib`。

本地开发：

```bash
git clone git@github.com:Coffeiz/dsh-qqchat.git
cd dsh-qqchat
git switch agent/typescript-migration
npm install
npm run check
```

## 首次连接

1. 启动 DSH。
2. 打开 **设置 → QQ Chat**。
3. 点击 **扫码连接**。
4. 使用手机 QQ 扫码并选择需要授权的 QQ Bot。
5. 插件在 DSH Host 侧完成 AppSecret 解密并写入本地 SQLite。
6. QQ Gateway 自动启动。

扫码临时 AES key 不会发送到浏览器端。

## 设置页

Settings 只负责配置，不承载群列表、聊天记录或记忆浏览器。

```text
设置 → QQ Chat

连接状态 / 扫码

消息接收
  [ 自动回应 ] [ @回复 ] [ 静默记录 ]

消息兼容格式
  群聊：智能兼容 / Markdown / 纯文本兼容
  私聊：智能兼容 / Markdown / 纯文本兼容

工具权限
  群成员可用工具 [开/关]
  Owner stable ID

诊断
  [ 查看日志 ]
```

### 三种接收方式

| 模式 | 写入真实 QQ 历史 | 写入群记忆输入 | 唤醒 Agent | 自动回复 |
| --- | --- | --- | --- | --- |
| 自动回应 | 是 | 是 | 每条消息 | 是 |
| @回复 | 是 | 是 | 只有 @Bot | 仅 @Bot |
| 静默记录 | 是 | 是 | 否 | 否 |

“静默记录”不会偷偷调用 LLM。消息只进入 SQLite、DSH 的 log-only 展示事件和记忆活动窗口。

## QQ 会话就是 DSH Session

一个 peer 只对应一个 DSH Session：

```text
QQ群   -> qqchat-<uuid>
QQ私聊 -> qqchat-<uuid>
```

Session 标题使用：

```text
QQ群 · <群名>
QQ私聊 · <昵称>
```

插件不再注册独立的 QQ footer 会话选择器。QQ Session 由 DSH 自己的 Session 列表展示和打开；QQ Chat 不维护第二套路由或页面。

DSH 当前会隐藏从未打开过 turn 的 blank Session。对于只有静默消息的新 QQ 会话，插件会发出一次内部 `qq-chat-bootstrap` wake，并在 `agent/pre-step` 立即 reject：这只留下一个 `turn/start`/`turn/end` 边界，不进入 model step、不调用 LLM、也不会发消息到 QQ，因此 Session 能正常出现在 DSH 列表中而不污染模型上下文。

## 主聊天区与消息去重

QQ 消息分成两类：

### 会触发 Agent 的消息

直接走 DSH 原生 `user/message`：

```text
QQ inbound
   ↓
SQLite
   ↓
DSH Agent.followup()
   ↓
user/message
   ↓
DSH Conversation
   ↓
Assistant / Tool calls
   ↓
QQ reply
```

这类消息不会再额外 append 一份 `qqchat/message`，因此不会出现“QQ 气泡 + DSH user/context row”双份显示。

QQ stable sender ID、群 ID、message ID 等可靠元数据保留在 `MessageSource` 中；模型所需的完整身份锚点、近期群聊和记忆由独立 context snapshot 注入。

### 不触发 Agent 的消息

例如 `@回复` 下没有 @Bot 的消息，或 `静默记录` 下的所有群消息，只 append 插件自己的 log-only：

```text
qqchat/message
```

它只用于 DSH Conversation 展示，不进入模型 surface。真实完整历史仍以 `qqchat.sqlite` 为准。

## QQ Session 输入框

QQ Session 会接管 Conversation composer。

在这里发送的内容：

```text
DSH Web 输入框
   ↓
QQ API
   ↓
群聊 / 私聊
```

它是主动 QQ 消息，不会再次作为本地 DSH prompt 运行 Agent。

## 群记忆 / 用户记忆

QQ Session 顶部提供 **QQ 记忆** 入口。

### 群 scope

群聊可查看：

- `profile`：群长期画像、角色与结构
- `summary`：当前阶段紧凑摘要
- `daily`：近期重要变化
- `memory`：长期决定、关系、项目、约定与反复话题

### Member scope

群友列表使用 stable sender ID。点击任意成员可查看：

- `profile`
- `pattern`
- `summary`
- `memory`

成员 `daily` 仍会写入 SQLite 并参与压缩，目前不在成员弹窗中单独展示。

同一个 Bot 下，同一 stable sender 可以跨群保持个人层面的连续记忆；群内关系和群级事件仍留在各自 group scope，不跨群泄漏。

### 私聊

私聊 Session 查看该用户的：

- `profile`
- `pattern`
- `summary`

私聊 `daily` / `memory` 会写入 member scope 并参与反思与压缩；当前私聊弹窗暂未单独展示这两个文档。

## 模型上下文

真正进入 Agent turn 前，插件从 SQLite 重新装配：

```text
近期群聊
+ group profile/summary/memory/daily
+ 当前 sender profile/pattern/summary
+ 当前 sender stable ID
+ group ID
```

可靠身份规则：

```text
senderId = 身份 / 权限 / 记忆主键
senderName = 仅用于展示
```

不会根据昵称推断身份。

## 群成员工具权限

设置项 **群成员可用工具**：

开启：

```text
任意群友触发的 Agent turn
        ↓
可使用当前 Agent preset 暴露的全部工具
```

关闭：

```text
senderId == Owner stable ID
        ├─ 是 -> 允许工具
        └─ 否 -> tools/pre-execute 拒绝工具调用
```

权限走 DSH 正式 `tools/pre-execute` seam，不修改 AgentLoop。

如果关闭群友工具但没有设置 Owner stable ID，群成员触发的工具调用默认拒绝。

## 异步记忆反思

默认触发条件：

- 群聊空闲约 120 秒；或
- 未反思消息达到 20 条。

反思沿用该群实际 Agent 的 provider/model 路由。默认最多取 80 条未反思消息，并把 stable sender ID 一并交给记忆模型。

成员 daily 超过 100 条时压缩到 `memory`，保留最近 50 条；群 daily 超过 1000 条时压缩到 `memory`，保留最近 500 条。压缩失败或日期校验失败时保留原 daily，不删除历史。

## SQLite

默认：

```text
$DSH_HOME/plugins/dsh-qqchat/qqchat.sqlite
```

数据库初始化：

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
```

主要表：

```text
accounts            QQ AppID / Secret / Gateway 状态
auth_tasks          扫码 bind task
groups              QQ 群与 DSH Session 映射
members             stable sender 与私聊 Session 映射
group_members       群成员关系
messages            QQ 真实消息历史
memory_documents    group/member 记忆文档
reflection_state    反思游标
plugin_settings     UI/运行设置
outbox              主动消息队列
```

DSH Session 与插件数据库职责不同：

```text
DSH Session
  Agent 真正参与过什么、工具调用、模型输出、用户可见 transcript

qqchat.sqlite
  QQ 世界真实发生过什么、谁说了什么、群成员、完整历史、记忆状态
```

## 数据目录

```text
$DSH_HOME/plugins/dsh-qqchat/
├── qqchat.sqlite
└── ...
```

卸载 npm package 不会自动删除数据目录。

## 开发

```bash
npm run typecheck
npm test
npm run build
npm run check
```

Host 源码：`src/*.ts`  
Client 源码：`client-src/*.cts`  
构建产物：`lib/`

更多架构说明见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

开发约定见 [AGENTS.md](./AGENTS.md)，开发与验证见 [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)，记忆规则见 [docs/MEMORY.md](./docs/MEMORY.md)，安全边界见 [docs/SECURITY.md](./docs/SECURITY.md)。

## 当前需要真实环境验证的项目

代码侧已经按 DSH Session / Conversation / Tool policy seam 接入，但以下内容仍必须在真实环境最终确认：

1. 手机 QQ 扫码授权完整流程。
2. QQ Gateway Resume 与网络断开恢复。
3. 自动回应 / @回复 / 静默记录三种模式的真实群行为。
4. QQ Session 在当前 DSH Web 版本里的列表排序与刷新行为。
5. DSH Agent 流式输出、tool call 与 QQ 最终回复文本组合。
6. Markdown/兼容格式在不同 QQ 客户端的显示。
7. 长时间运行下的记忆反思与 SQLite 并发行为。

## License

当前私有 alpha 仓库暂未开放源码许可；发布前再确定正式 License。
