# 记忆系统

## 易读概述

QQChat 的 SQLite 是 QQ 世界事实来源，DSH Session 只保存 Agent 实际经历过的 turn 和展示事件。记忆反思从 SQLite 读取消息，再写回 group/member scope。群记忆和群友批量记忆的后续调整见 [PRD-MEM-1](prds/PRD-MEM-1-群记忆与群友记忆策略调整.md)。

身份主键始终是 stable sender ID；昵称、群内称呼和历史昵称是展示或画像信息，不能替代身份主键。

## Scope

### Group scope

群记忆按 `group` scope 保存：

- `profile`：群体画像、角色和结构
- `summary`：当前阶段的紧凑摘要
- `daily`：按日期组织的近期重要记录
- `memory`：长期决定、关系、项目、约定和反复话题

### Member scope

成员和私聊用户按 `member` scope 保存：

- `profile`：typed entries，包含 `type/text/ts`
- `pattern`：行为模式
- `summary`：成员摘要
- `daily`：该成员或私聊的按日期近期记录
- `memory`：成员长期记忆

同一个 Bot 下，stable sender 可以跨群复用 member scope；群内关系和群级事件只能进入对应 group scope。

## daily 格式

同一天共用一个标题：

```markdown
## 2026-08-20
- 发生了第一件事
- 发生了第二件事
```

新消息追加到对应日期标题下，不应为每条消息重复创建日期标题。数据库启动时会把旧的逐条日期格式规范化为这种结构。

## 反思触发

默认配置：

- 空闲约 120 秒触发一次反思
- 群反思未反思消息达到 20 条时立即触发；成员批量反思达到 50 条群消息时触发
- 单次最多取 80 条未反思消息

当前已拆分群记忆与成员记忆：群反思只写 group scope；群友批量反思使用独立的成员游标，累计 50 条已落库群消息或空闲时触发，一次处理本批真实出现的多个成员。私聊反思使用独立的 `private-owner` 任务，并保留用户/Bot 消息方向。任务、游标和 snapshot 集成仍在持续完善。

成员批量反思可以通过运行时设置 `memoryMemberBatchEnabled` 灰度关闭；关闭只停止
新的群友批量调度，不删除已有成员记忆，也不影响群反思和私聊记忆。

群聊和私聊分别维护反思游标和模型路由。私聊首次没有成功 Agent 路由时不能凭空创建反思请求；需要先完成一次正常 Agent 回复。

反思任务统一使用以下 scope/task 契约：

```text
scope: group | member | private
task:  group | member-batch | private-owner
```

群反思和群友批量反思共享群消息，但使用两条独立游标；私聊任务使用 member scope
和私聊自己的消息范围。旧数据库如果缺少成员批量游标或任务表，启动迁移会补齐
默认值，不会删除已有记忆或跳过未处理消息。

## 压缩策略

记忆如何进入 DSH Session 的生命周期、TTL 和 Session compact 处理，见[记忆系统上下文注入方案](./MEMORY_CONTEXT.md)。

压缩规则与 Gugu 的 daily → memory 规则保持一致：

| Scope | 触发条数 | 保留最近 | 压缩到 |
| --- | ---: | ---: | --- |
| member | 100 | 50 | `memory` |
| group | 200 | 100 | `memory` |

压缩模型最多使用 `memoryCompressionMaxTokens=15000`。压缩输入包含已有 memory、相关 profile/pattern 和待压缩 daily。

安全条件：

- 压缩输出必须非空。
- 输出必须保留待压缩记录涉及的日期。
- 模型失败、JSON 无效或校验失败时，保留原 daily，不截断、不删除。
- 只有 memory 成功写入且校验通过后，才删除已压缩的旧 daily，保留最近记录。

## Agent context

记忆上下文通过 DSH 官方 runtime-context snapshot 机制注入：快照使用
`@deepseek-ai/dsh-system-prompt` 来源标记。注入策略遵循“新 Session、TTL
过期、Session compact 后刷新”的生命周期规则，连续对话只刷新对应群或当前
成员的 TTL，不重复注入完整记忆。群持续活跃不会替潜水成员刷新成员 TTL。
具体状态、hash、版本和失败处理见[记忆系统上下文注入方案](./MEMORY_CONTEXT.md)。
当前 QQ 消息仍作为正常 user prompt 进入 turn。

### 反思提示词策略

三类反思提示词分别对应不同的记忆主体，不共享一套模糊的“总结聊天”指令：

- **群组反思**只维护当前群的公开事实、规则、协作约定、群项目和群状态；不写成员个人资料，也不把昵称、引用、转述或推测当成群事实。
- **群友批量反思**先判断语义主体，再按真实 `senderId` 分配成员记忆；只允许本批实际发言且有明确个人事实的成员进入输出，群规、群项目和第三方属性留在群 scope。
- **私聊反思**使用消息 `direction` 作为事实边界：只有用户入站消息可以产生用户画像，BOT 出站消息只能作为上下文，不能反向证明用户的身份、偏好或经历。

三类提示词都要求增量输出、保留已有事实、使用绝对日期，并在主体不明确时宁可漏记；`profile`、`pattern`、`summary`、`daily` 和 `memory` 的字段职责分别受证据门槛约束。具体提示词实现位于 `src/storage/memory.ts`，压缩提示词则单独负责 `daily → memory` 沉淀，不参与成员主体判断。

群聊 Agent turn 注入：

```text
group profile/summary/memory/daily
+ 当前 sender profile/pattern/summary
+ stable sender ID
+ group ID
```

私聊 Agent turn 注入对应 member scope：

```text
member profile/pattern/summary/daily/memory
+ stable sender ID
```

当前消息的 `senderName` 只用于展示；@消息会在写入 DSH 和记忆上下文前，优先解析为用户名。
