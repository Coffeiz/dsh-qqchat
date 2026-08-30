# 记忆系统上下文注入方案

## 1. 目标

QQChat 的记忆属于 DSH Session 上下文的一部分，不脱离 Session 单独维护一套模型上下文。

上下文注入需要同时满足：

- Session 恢复后仍能获得正确的群、成员或私聊记忆；
- 连续对话时不重复写入完整记忆；
- Session 压缩后重新建立完整、可追溯的记忆基线；
- 记忆内容发生变化时能够在后续回合生效；
- 记忆注入不会无限增加 Session 的重复内容。

本方案采用“完整快照 + 生命周期刷新 + 压缩后重建”的方式，不把记忆作为脱离 Session 的临时请求上下文。

## 2. 记忆快照的范围

### 2.1 直注入预算

记忆快照遵循与咕咕一致的按 scope 限制策略，避免 profile、daily 或长期
memory 无限增长后挤占 DSH 对话上下文：

- 群级记忆字段合计最多直注入 2000 个字符；
- 当前发言成员的记忆字段合计最多直注入 2000 个字符；
- 私聊成员记忆字段合计最多直注入 2000 个字符；
- 近期沉淀优先保留末尾的最新内容；其他字段从开头保留；
- 被裁剪的内容仍保存在 SQLite 中，不会因为注入预算被删除；
- 预算只限制本轮 snapshot 文本，不改变 DSH Session 的历史或 compact 规则。

这里的 2000 是稳定、可预测的字符预算，不是模型输出 `maxTokens`。反思和
`daily → memory` 压缩仍分别使用 `memoryMaxTokens` 与
`memoryCompressionMaxTokens` 控制输出长度。

快照按照 Session 的聊天范围生成：

### 群聊 Session

- 群稳定 ID、群名；
- 群 profile、summary、daily、memory；
- 当前发言成员的稳定 ID、显示名；
- 当前成员 profile、pattern、summary、daily、memory；
- 必要的身份和归属约束。

### 私聊 Session

- 用户稳定 ID、显示名；
- 成员 profile、pattern、summary、daily、memory。

群聊快照只注入当前发言成员的成员记忆，不能把其他群成员的个人记忆混入当前回合。

最近 QQ 消息属于 Session 的真实消息历史，不应在每轮记忆快照中重复复制。若需要补充历史，应由 DSH Session 历史和原生 compact 机制负责。

## 3. 注入时机

记忆快照不是每条消息都重新注入，而是在以下时机注入全量快照。

### 3.1 新 Session 或首次进入

Session 没有有效记忆基线时，注入一次完整快照，并记录：

```text
memoryVersion
memoryHash
lastInjectedAt
lastActiveAt
```

### 3.2 TTL 过期

默认 TTL 为 30 分钟。TTL 按记忆作用域分别维护：群级记忆使用群级 TTL，当前发言成员的记忆使用成员级 TTL。连续对话期间，每条消息只刷新对应作用域的活跃时间，不重复注入完整记忆。

当某个作用域距离上次使用或注入超过 TTL，下一条相关消息到达时：

1. 重新读取 SQLite 中的最新记忆；
2. 生成新的完整快照；
3. 注入到当前 DSH Session；
4. 更新对应作用域的 `memoryHash`、`memoryVersion` 和时间戳。

TTL 表示“记忆上下文的新鲜度”，不是记忆数据的删除时间。过期不会删除 SQLite 中的 profile、daily 或长期 memory。

### 群活跃与成员活跃是两回事

群一直有人聊天，不能替每个群成员刷新 TTL。例如：

```text
群里其他成员持续聊天
群友 1 潜水超过 30 分钟
群友 1 再次发言
```

群级记忆可以继续使用已有快照，但群友 1 的成员记忆已经过期。群友 1 再次发言时，应刷新当前成员快照，并重新组装：

```text
最新群级记忆
+ 群友 1 的最新成员记忆
```

反过来，群友 1 持续发言不会自动刷新其他成员的成员 TTL。每个成员只在自己参与对话或其记忆被显式标记过期时刷新。

推荐记录以下三类状态：

```text
groupSnapshot:
  hash
  version
  lastInjectedAt
  lastActiveAt
  stale

memberSnapshot[groupMemberId]:
  hash
  version
  lastInjectedAt
  lastActiveAt
  stale

session:
  compactedAt
  memorySnapshotStale
```

一个群对应一个 DSH Session 时，runtime-context snapshot 仍然可以整体替换；TTL 只是决定何时需要重新组装该 Session 当前有效的“群级记忆 + 当前成员记忆”，而不是为每个成员创建独立 DSH Session。

### 3.3 Session 压缩完成后

Session compact 会改变模型可见的历史上下文，因此压缩完成后需要重新建立记忆基线。

推荐流程：

```text
Session compact 完成
        ↓
标记 memory snapshot stale
        ↓
下一次 Agent 输出前或下一条 QQ 消息到达
        ↓
注入最新完整记忆快照
        ↓
清除 stale 标记并记录新版本
```

压缩后的第一次模型输出应能看到完整记忆快照。后续连续消息继续复用该快照，不重复注入。

## 4. Hash 与版本判断

不能只根据“本轮是否有新消息”决定是否注入。应分别判断 Session 状态和记忆状态：

```text
需要注入 =
  没有快照
  或群级快照已过期
  或当前成员快照已过期
  或 Session 刚完成 compact
  或群/当前成员的 memoryVersion / memoryHash 与 Session 记录不一致
```

Hash 应由规范化后的结构化字段计算，而不是直接对不稳定的 Markdown 排版计算。建议按字段计算后再合并：

```text
scope + profileHash + patternHash + summaryHash
      + dailyHash + memoryHash + identityHash
```

这样可以避免无意义的空白、排序或格式变化导致重复注入。

## 5. 记忆变化的处理

记忆反思在后台更新 SQLite 后，不需要立即为每条消息重新注入完整快照。

处理规则：

- 连续对话中发现群级记忆版本变化：只标记群级 pending/stale；
- 发现某个成员记忆版本变化：只标记该成员 pending/stale；
- 当前回合继续使用已有 Session 快照，避免在同一连续对话中反复插入；
- 对应 TTL 过期、Session compact 或下一次安全刷新点到达时，注入最新完整快照；
- 若某次记忆变化必须立即生效（例如权限、身份纠正），可以显式标记对应作用域和 Session stale，优先刷新。

这样可以避免“后台反思每更新一次，Session 就追加一份完整成员记忆”。

## 6. Session 中的表示

快照应继续使用 DSH 官方 runtime-context snapshot 来源，不创建另一套 AgentLoop 或普通用户对话格式。

快照内容建议带有明确的版本和生命周期标记：

```text
[QQ 记忆上下文快照]
scope=group:123
memoryVersion=42
generatedAt=2026-08-21T00:00:00.000Z
expiresAt=2026-08-21T00:30:00.000Z

...
```

相同 scope 的新快照应由 DSH 的 runtime-context projection 替换旧快照，而不是作为普通 user message 无限追加。Session 仍然保留 DSH 所需的事件和恢复信息，但模型上下文只使用当前有效快照。

## 7. 与记忆压缩的关系

这里的“记忆快照刷新”和“记忆系统的 daily → memory 压缩”是两个不同过程：

| 过程 | 作用 | 触发条件 |
| --- | --- | --- |
| 记忆反思/压缩 | 把 SQLite 中近期记录整理为 profile、summary、memory | 空闲、消息数量阈值、daily 压缩阈值 |
| Session 记忆快照 | 把当前已保存的记忆提供给 DSH Agent | 新 Session、TTL、Session compact、显式 stale |

记忆压缩完成后，如果产生了新的 `memoryVersion`，当前 Session 不需要立即每轮重复注入；应在下一个记忆刷新点生成新的完整快照。

## 8. 边界与失败处理

- 记忆系统关闭时，不注入快照，也不启动后台反思；已有 SQLite 数据不删除；
- SQLite 读取失败时，不写入空快照，保留上一次有效 Session 快照并记录日志；
- 快照生成失败时，不覆盖上一次有效快照；
- compact 状态未知时，宁可在下一条消息刷新一次，也不要每轮重复刷新；
- 群成员记忆必须按稳定 sender ID 查询，不能按昵称匹配；
- 快照中不得携带不可 JSON 序列化对象、文件句柄或媒体对象引用。

## 9. 实施 TODO

### Phase 0：基础能力与约束（已完成）

- [x] group/member/directed-chat 记忆 scope 分离；
- [x] profile、pattern、summary、daily、memory 文档分层；
- [x] daily 按日期归档，后台反思和 daily → memory 压缩；
- [x] 记忆系统设置开关，关闭时不删除已有数据；
- [x] 使用 DSH runtime-context snapshot 来源注入记忆；
- [x] 群成员记忆按 stable sender ID 隔离，避免按昵称归属。

### Phase 1：Session 级快照状态（已完成）

- [x] 为每个 QQ Session 保存 memory snapshot 状态：hash、注入时间和 stale 标记；
- [x] 以群/当前成员组合快照实现群级和成员级上下文边界；
- [x] 从已有 Session 的 runtime-context 事件恢复快照 hash 和时间；
- [x] 使用规范化后的完整上下文计算 hash，避免内容未变化时重复注入。

### Phase 2：TTL 与差异状态判断（已完成）

- [x] 将每轮无条件 `agent.inject()` 改为按 Session snapshot 状态判断；
- [x] 新 Session 或没有有效基线时注入完整快照；
- [x] 默认 30 分钟 TTL 过期后注入完整快照；
- [x] 当前群员上下文变化或记忆内容 hash 变化时重新组装快照；
- [x] 连续对话中只刷新缓存时间，不写入重复 runtime-context 事件。

### Phase 3：Session compact 衔接（已完成）

- [x] 监听 DSH Session compact 完成事件；
- [x] compact 完成后将当前记忆快照标记为 stale；
- [x] 确保压缩后的下一条 QQ 消息重新注入完整记忆快照；
- [x] 避免 compact 后每个连续回合重复注入，只建立一次新的记忆基线。

### Phase 4：上下文裁剪与验证（已完成）

- [x] 从记忆快照中移除已经存在于 DSH Session 的重复最近 QQ 消息；
- [x] 通过可控时间测试验证 TTL 未过期、TTL 到期、内容变化和 compact 后刷新；
- [x] 通过全量 typecheck、23 项测试和构建验证快照改动不破坏现有功能；
- [x] 利用 DSH runtime-context projection 保证模型侧只保留当前有效快照；
- [x] 验证快照读取失败路径不会覆盖已有有效上下文；
- [x] 重启 DSH Web 并完成运行时 HTTP smoke 检查；
- [x] 在真实持续 QQ 对话中做长期 Session 观察，确认跨多次 compact 后仍保持单份有效快照。

## 10. 非目标

本方案不做以下事情：

- 不把记忆移出 DSH Session；
- 不把每条记忆更新都编码成一长串模型可见 diff；
- 不修改 DSH Session 的追加式存储规则；
- 不删除 SQLite 中已经保存的记忆；
- 不让群成员记忆跨群泄漏。
