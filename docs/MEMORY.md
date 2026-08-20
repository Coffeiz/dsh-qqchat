# 记忆系统

## 易读概述

QQChat 的 SQLite 是 QQ 世界事实来源，DSH Session 只保存 Agent 实际经历过的 turn 和展示事件。记忆反思从 SQLite 读取消息，再写回 group/member scope。

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
- 未反思消息达到 20 条时立即触发
- 单次最多取 80 条未反思消息

群聊和私聊分别维护反思游标和模型路由。私聊首次没有成功 Agent 路由时不能凭空创建反思请求；需要先完成一次正常 Agent 回复。

## 压缩策略

压缩规则与 Gugu 的 daily → memory 规则保持一致：

| Scope | 触发条数 | 保留最近 | 压缩到 |
| --- | ---: | ---: | --- |
| member | 100 | 50 | `memory` |
| group | 1000 | 500 | `memory` |

压缩模型最多使用 `memoryCompressionMaxTokens=15000`。压缩输入包含已有 memory、相关 profile/pattern 和待压缩 daily。

安全条件：

- 压缩输出必须非空。
- 输出必须保留待压缩记录涉及的日期。
- 模型失败、JSON 无效或校验失败时，保留原 daily，不截断、不删除。
- 只有 memory 成功写入且校验通过后，才删除已压缩的旧 daily，保留最近记录。

## Agent context

群聊 Agent turn 注入：

```text
近期群聊
+ group profile/summary/memory/daily
+ 当前 sender profile/pattern/summary
+ stable sender ID
+ group ID
```

私聊 Agent turn 注入对应 member scope：

```text
近期私聊
+ member profile/pattern/summary/daily/memory
+ stable sender ID
```

当前消息的 `senderName` 只用于展示；@消息会在写入 DSH 和记忆上下文前，优先解析为用户名。
