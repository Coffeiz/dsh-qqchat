# PRD-MEM-1：群记忆与群友记忆策略调整

> 状态：Phase 4 进行中；任务恢复、脱敏指标和成员批量灰度开关已接入，真实 DSH Web 长期观察待完成
> 创建：2026-08-29
> 最近更新：2026-08-29
> 关联模块：`src/storage/memory.ts`、`src/storage/db.ts`、`src/session/`、`tests/memory*.test.ts`
> 背景参考：Gugu 2026-08-29 群记忆与群友记忆策略、[记忆系统](../MEMORY.md)、[记忆上下文注入方案](../MEMORY_CONTEXT.md)

## 0. 实际状态

| 能力 | 结果 | 说明 |
| --- | --- | --- |
| Group/member scope | ✅ 已完成 | SQLite 已按群和 stable sender ID 保存记忆文档 |
| daily 日期归档 | ✅ 已完成 | 同一天使用一个 `## YYYY-MM-DD` 标题 |
| DSH Session 快照 | ✅ 已完成 | 使用 runtime-context snapshot、hash、TTL 和 compact stale |
| 群记忆反思 | 🟡 部分完成 | 已改为只写 group 文档，但触发阈值和任务恢复仍需继续完善 |
| 群友批量反思 | 🟡 部分完成 | 已接入按群的 `member-batch` 调度、50 条水位、独立成员游标、多成员输出校验和任务记录，完整恢复测试仍待补齐 |
| 私聊记忆 | 🟡 部分完成 | 已接入 `private-owner` 任务、用户/Bot 方向输入和独立幂等记录，长期观察仍待补齐 |
| daily → memory 压缩 | 🟡 部分完成 | 群压缩目标已调整为 200/100，成员压缩保留 100/50，事件型输出规则仍待继续收敛 |
| 自动化集成测试 | 🟡 部分完成 | 已覆盖 group/member/private 反思、迁移和 snapshot 基础生命周期，长期 Session 观察仍待完成 |

## 1. 背景与目标

### 1.1 现状问题

QQChat 的 SQLite 是 QQ 世界事实来源，DSH Session 负责 Agent 实际经历过的 turn
和当前模型上下文。当前 `MemoryEngine` 已经支持 group/member 文档、idle 反思、
批量阈值、daily 压缩和 Session 快照，但反思职责仍有耦合：群反思输入会携带成员
资料并可能同时更新群和成员文档，成员又容易按照单个成员重复触发。

这会导致：

- 群级事实和个人事实边界不清晰；
- 成员数量增加后，单次反思输入和输出规模不可控；
- 同一批群消息可能触发多次成员模型调用；
- 私聊的用户事实与 Bot 回复未被明确区分；
- 反思任务、游标和 Session 快照的失效关系难以审计。

Gugu 的新策略将群反思、群友批量反思和私聊反思拆成不同任务类型，并使用独立
游标。QQChat 采用同样的产品语义，但保留 TypeScript、SQLite 和 DSH 官方集成
边界，不复制 Gugu 的 Python 实现。

### 1.2 目标

1. 群记忆只保存群体事实，不直接写入成员个人画像。
2. 群友记忆改为按消息范围批量处理，一次调用可以更新多个成员。
3. 私聊记忆独立处理用户与 Bot 的对话边界，并拥有完整 daily 生命周期。
4. 不同任务使用独立游标、幂等键、状态和并发锁，失败可安全重试。
5. 记忆继续作为 DSH Session 上下文的一部分，不在每轮重复追加完整记忆。
6. 保持 account、group、member 和 stable sender ID 的数据隔离。

### 1.3 非目标

- 不修改、patch 或重新构建 DSH；只使用官方可用的 runtime-context、Session、RPC、
  Hook 和类型边界。
- 不复制 DSH AgentLoop、Session persistence 或工具运行时。
- 不把记忆移出 SQLite/DSH Session 的既有职责边界。
- 本阶段不支持每个群独立的回复模式覆盖；全局 `groupReceiveMode` 仍是唯一回复策略。
- 不把每次记忆变化编码成模型可见的长 diff。
- 不因群持续活跃而刷新没有发言成员的成员级快照。

## 2. 功能需求

### FR-MEM-001：群记忆只写入 Group scope

群反思可以读取当前群的成员名单、发送者 ID 和显示名来理解消息，但输出只能
更新当前群的 `profile`、`summary`、`daily` 和 `memory`。成员个人偏好、背景、
行为模式和个人事件不得由群反思直接写入 member scope。

群反思的长期记忆应保留群规、项目、决定、关系、公共约定和群体阶段变化；不应
把某个成员的个人资料原样复制到群记忆。

### FR-MEM-002：群友记忆使用 Member batch

群消息达到成员批量水位后，创建一个 `member-batch` 任务。任务可以包含多个真实
发送者，并按 stable sender ID 分组返回结果。相同群、相同消息范围和相同任务类型
只能产生一个有效任务。

本项目默认统计所有已经落库的群消息，包括触发 Agent 的消息、被 @ 的消息和静默
记录消息。是否送入 Agent 与是否参与记忆是两个独立判断，避免回复模式切换导致
owner 或活跃成员的画像事实丢失。

### FR-MEM-003：严格的个人事实归属

成员批量反思只能更新本批消息中真实出现的 sender ID。以下内容不能归属到个人：

- 第三方转述、引用或代为描述的事实；
- 没有明确主语的“他/她/他们”等代词；
- 模型根据语气、昵称或上下文自行推测的身份；
- 其他成员说出的个人信息；
- 仅由 Bot 回复或建议产生的结论。

昵称、历史昵称和群内称呼只用于展示或作为经过确认的画像字段，不能作为身份主键。

### FR-MEM-004：私聊反思区分用户和 Bot

私聊只有在一次正常 Agent turn 成功完成后才允许创建 `private-owner` 反思任务。
输入同时包含用户消息和 Bot 回复，但只有用户明确表达的内容才可成为用户事实。
Bot 的建议、猜测和普通回答只作为对话上下文，不能直接写入 profile 或 memory。

私聊使用对应用户的 member scope，支持 `profile`、`pattern`、`summary`、`daily`
和 `memory`；其游标不能与群反思或群友批量反思共用。

### FR-MEM-005：按日期维护 daily

同一 scope、同一天的记录必须追加到同一个日期标题下：

```markdown
## 2026-08-29
- 重要记录一
- 重要记录二
```

不得为每条消息重复创建日期标题。群、跨群成员和私聊的 daily 仍然属于各自 scope，
不因格式相同而合并数据。

### FR-MEM-006：daily 压缩和长期 memory

daily 是近期事实缓冲，达到水位后才压缩到长期 `memory`。目标策略参考 Gugu：

| Scope | 压缩水位 | 保留最近 | 单次硬上限 |
| --- | ---: | ---: | ---: |
| group | 200 条 | 100 条 | 300 条输入 |
| member/private | 100 条 | 50 条 | 由现有压缩预算限制 |

压缩输出应保留日期、事件背景、关键事实、结果和后续约定。压缩失败、空输出、
无效 JSON 或日期校验失败时，保留旧 memory 和原 daily，不推进游标、不删除记录。

### FR-MEM-007：记忆更新与 Session snapshot 协作

记忆文档更新后只标记对应 scope 的 version/hash 变化，不在每轮 Agent turn 追加一
份完整记忆。新 Session、默认 30 分钟 TTL 到期、Session compact 完成或显式 stale
时，重新组装当前有效的群记忆与当前发言成员记忆。

群持续活跃不能刷新潜水成员的成员快照。成员再次发言时，刷新该成员并将最新群级
记忆与该成员记忆组合为当前 Session snapshot。快照仍使用 DSH 官方 runtime-context
来源，事件数据必须可 JSON 序列化。

## 3. 技术方案

### 3.1 任务模型

反思任务至少区分：

```text
group          群体反思和群 daily 压缩
member-batch   群消息中的成员批量反思
private-owner  私聊用户记忆反思
```

任务需要表达 scope、scope ID、task type、消息范围、状态、重试次数、创建时间和
幂等键。幂等键必须包含 task type，避免 group 与 member-batch 消息范围相同而互相
覆盖。

### 3.2 游标和事务

群至少维护两条独立游标：

```text
last_reflected_message_id
last_member_reflected_message_id
```

group 成功只推进第一条；member-batch 成功只推进第二条；private-owner 使用私聊
自己的范围和游标。文档写入、输出校验和游标推进必须形成一个可重试的事务边界。

本项目采用整批成功后推进游标的语义：批量输出中任意成员 ID 无效、字段非法或写入
失败时，整批不推进，下一次按幂等键重试，避免出现已跳过但没有落库的消息。

### 3.3 Group reflection 输入输出

Group 输入包括当前群身份、已有 group 文档和游标之后的消息。成员名单只作为理解
上下文的只读参考。输出只能包含 group 文档字段：

```json
{
  "profile": [],
  "summary": "...",
  "daily": [],
  "memory": "..."
}
```

Host 必须拒绝或忽略 `members`、`profile_add` 等个人文档输出，不能因为模型返回了
额外字段就顺带写入成员记忆。

### 3.4 Member batch 输入输出

输入按当前群和消息范围提供成员已有文档：

```json
{
  "group": { "id": "group-id", "name": "群名" },
  "members": [
    {
      "senderId": "stable-sender-id",
      "displayName": "展示名",
      "existing": {
        "profile": "...",
        "pattern": "...",
        "summary": "...",
        "daily": "...",
        "memory": "..."
      }
    }
  ],
  "messages": []
}
```

输出按 sender ID 分组：

```json
{
  "members": [
    {
      "senderId": "stable-sender-id",
      "profile_add": [],
      "profile_remove": [],
      "pattern_add": [],
      "pattern_remove": [],
      "summary": "...",
      "daily": [],
      "memory": "..."
    }
  ]
}
```

Host 先验证 sender ID 属于当前 account、group 和本批消息，再合并文档。profile
使用类型化字段，pattern 区分观察和推断；所有字段限制长度并检查 JSON 可序列化。

### 3.5 Private-owner 输入输出

私聊输入必须保留消息方向：

```text
用户消息 -> 用户事实候选
Bot 回复  -> 对话上下文
```

私聊反思可以使用与 member batch 相同的文档合并器，但不能复用群消息游标和
group prompt。私聊 daily 使用相同的日期标题规范，长期压缩使用 member 侧预算。

### 3.6 并发、恢复和重试

同一个 scope + task type 同时只能运行一个任务；不同群和不同私聊可以并发。内存
Promise 锁用于同进程复用，数据库任务状态和幂等键用于进程重启后的恢复。

LLM 超时、无效 JSON、空结果、schema 校验失败或 SQLite 写入失败时：保留原文档，
不推进对应游标，并记录不包含正文的错误类别。重复任务必须在执行前按幂等键去重。

### 3.7 DSH 兼容边界

所有 Agent 调用继续通过 DSH 官方 Agent、Session 和模型路由能力完成；插件只负责
整理输入、保存结果和注入 snapshot。插件不能要求用户修改 DSH 源码、锁文件或私有
模块，也不能把自定义记忆事件写入不可恢复的非 JSON 数据。

### 3.8 Phase 0 基线盘点

当前实现的事实来源和职责映射如下：

| 能力 | 当前事实来源/入口 | Phase 0 约束 |
| --- | --- | --- |
| QQ 消息 | `messages`，按 `account_id`、`group_id`、`member_id` 隔离 | SQLite 是 QQ 世界事实来源，Session 不重放完整历史 |
| 群记忆 | `memory_documents(scope_type='group')` | 只允许 `group` task 写入 |
| 成员记忆 | `memory_documents(scope_type='member')` | 只接受 stable sender ID，成员可跨群复用 |
| 群反思游标 | `reflection_state.last_message_id` | 只由 `group` task 推进 |
| 群友批量游标 | `reflection_state.last_member_reflected_message_id` | 只由 `member-batch` task 推进，旧表默认值为 `0` |
| 私聊游标 | `plugin_settings.memberReflection:<memberId>` | 只由 `private-owner` 任务使用，需成功 Agent turn 后调度 |
| 任务幂等 | `reflection_tasks.idempotency_key` | key 必须包含 scope、消息范围和 task type |
| DSH 上下文 | runtime-context snapshot | 只在新 Session、TTL、hash 变化或 compact 后刷新 |

旧数据库兼容规则：缺少 `reflection_state.last_member_reflected_message_id` 时添加
`INTEGER NOT NULL DEFAULT 0`；缺少 `reflection_tasks` 时创建空任务表；既有
`last_message_id`、成员设置、memory_documents 和 Session 文件保持原样。历史 group
反思不会自动推进成员批量游标，升级后会按未处理消息范围重新生成 `member-batch`。

## 4. 验证与上线

### 4.1 自动化验证

需要覆盖以下行为：

- 群反思只改变 group 文档，成员文档保持不变；
- 50 条群消息生成一个 `member-batch`，且一次任务可以更新多个真实成员；
- 重复触发、并发触发和进程重启不会重复处理同一消息范围；
- 未知 sender ID、第三方转述和非法 JSON 不会写入个人记忆；
- group 与 member-batch 各自推进正确游标；
- 私聊反思包含用户和 Bot 消息，未完成成功 Agent turn 时不创建任务；
- group daily 200/100/300 和 member daily 100/50 的压缩失败保护；
- TTL 未过期不重复注入，TTL 到期和 compact 后只建立一次新 snapshot；
- snapshot 和 `qqchat/message` 事件始终可 JSON 序列化。

标准命令：

```bash
npm run typecheck
npm test
npm run build
```

### 4.2 真实环境验证

在未修改的官方 DSH 工作区中加载构建产物，验证 DSH Web 中的 Session 恢复、群静默
记录、群回复、私聊、记忆查看、Session compact 和长时间连续对话。验证日志只检查
scope、task type、数量、耗时和错误类别，不读取或展示聊天正文。

### 4.3 观测指标

Host 只记录脱敏指标：

```text
task_type
scope_type
message_count
member_count
duration_ms
retry_count
result_status
memory_version
```

不记录用户正文、附件内容、完整 QQ payload、Token、AppSecret 或模型原始 prompt。

### 4.4 灰度和回滚

新任务调度应先以设置或内部配置开关灰度，旧反思路径保留到新路径完成稳定验证。
灰度期间新旧任务不能同时推进同一条游标。出现异常时关闭新调度开关，继续读取
已有文档和 daily；失败任务不删除，待修复后按幂等键重试。

数据库迁移必须向前兼容。迁移失败时保留旧表和旧文档，不以空表或默认值覆盖已有
记忆。回滚代码时，旧实现应忽略新任务类型但不能误推进新游标。

## 5. 风险与待确认问题

### 5.1 风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 批量输出错误归因 | 错误修改成员画像 | stable sender ID 校验、主语归属规则、整批拒绝 |
| 群反思继续污染成员记忆 | 群级事实泄漏到个人 scope | group 输出 schema 白名单和成员文档不变回归测试 |
| 游标先推进后写入 | 消息永久丢失 | 文档写入成功后再推进，失败整批重试 |
| 多任务重复调用模型 | 成本上升、文档互相覆盖 | task type 幂等键、scope 锁和数据库状态 |
| 私聊把 Bot 观点当用户事实 | 个人画像失真 | 保留消息 direction，private prompt 明确事实来源 |
| Session 快照重复膨胀 | 上下文缓存率下降 | snapshot projection、hash、TTL 和 compact stale |
| 旧数据库迁移不完整 | 服务启动失败或记忆不可读 | 可回滚迁移、旧字段兼容和恢复测试 |

### 5.2 待确认问题

1. 成员批量反思的 50 条水位是否按“所有已落库群消息”计算，还是仅统计静默群消息。
   当前 PRD 选择前者，原因是记忆链路不应依赖回复模式。
2. `member-batch` 的消息范围是否按群切分，还是允许同一 account 下多个群合并处理。
   当前选择按群切分，优先保证群范围和失败重试的可解释性。
3. 成员批量输出中单个成员写入失败时，是否未来支持按成员部分提交。当前选择整批
   回滚，避免游标语义和审计复杂化。

## 6. 唯一实施 TODO

### Phase 0：契约与基线

- [x] `MEM1-001` 盘点当前 `MemoryEngine`、SQLite schema、反思游标和 Session snapshot；验收：已形成字段映射与旧数据库兼容说明，且未修改 DSH。
- [x] `MEM1-002` 固定 `group`、`member-batch`、`private-owner` 任务类型及 group/member/private scope 边界；验收：统一类型定义、Prompt 契约和文档术语。
- [x] `MEM1-003` 增加 group 输出白名单、stable sender ID 和个人事实归属校验；验收：group 反思忽略成员输出，成员批量输出只接受当前批真实成员，未知 ID 和重复 ID 会被拒绝。

### Phase 1：群记忆与成员批量任务

- [x] `MEM1-004` 增加反思任务 `task_type`、消息范围和幂等键；验收：相同 scope、范围和任务类型不会产生重复运行任务，失败范围可重试。
- [x] `MEM1-005` 增加成员批量独立游标并实现 50 条群消息水位和 idle 补偿；验收：group 与 member-batch 各自推进游标，失败不推进成员游标。
- [x] `MEM1-006` 将群友反思改为一次处理多个真实成员；验收：成员批量链路一次读取一个群的消息范围，并按 stable sender ID 合并多个成员文档。
- [ ] `MEM1-007` 增加同群并发、重复任务、进程重启、未知成员和整批回滚测试；验收：测试覆盖锁、幂等、恢复和失败重试。

### Phase 2：私聊记忆

- [x] `MEM1-008` 增加 `private-owner` Prompt、独立游标和用户/Bot 消息方向输入；验收：Bot 回复不会被写成用户事实，私聊任务使用独立幂等范围。
- [x] `MEM1-009` 将私聊 daily 接入 member 压缩和日期规范；验收：daily 标题按日期合并，压缩失败保留原始记录。

### Phase 3：压缩与上下文快照

- [x] `MEM1-010` 调整 group daily 压缩水位为 200/100/300，并校验事件日期与失败保护；验收：压缩成功才裁剪旧 daily，失败不覆盖 memory。
- [x] `MEM1-011` 将 batch 反思结果接入 memory version/hash 和 Session stale；验收：文档变化由 snapshot hash 感知，连续对话不重复追加完整快照，TTL 到期和 compact 后只刷新一次。
- [x] `MEM1-012` 增加可控时间的 group/member/private TTL 与 compact 集成测试；验收：已有 snapshot 测试覆盖内容变化、TTL 到期和 compact stale，group/private 反思测试覆盖新任务上下文。

### Phase 4：迁移、灰度与收尾

- [x] `MEM1-013` 实现旧数据库迁移、任务恢复和回滚保护；验收：旧数据库可启动，新增批量游标和任务表自动迁移，超时运行任务可重试，已有文档不丢失。
- [x] `MEM1-014` 增加脱敏任务指标和灰度开关；验收：日志只包含任务类型、数量和耗时，不含正文/凭据；关闭成员批量开关后旧 Session 与记忆仍可读取。
- [ ] `MEM1-015` 完成官方未修改 DSH 工作区的 typecheck、test、build、Session 恢复和 DSH Web 长期观察；验收：记录测试结果和真实 smoke test 结论，并同步相关文档。

## 7. 相关文档

- [记忆系统](../MEMORY.md)
- [记忆系统上下文注入方案](../MEMORY_CONTEXT.md)
- [架构说明](../ARCHITECTURE.md)
- [安全与数据边界](../SECURITY.md)
- [开发与验证](../DEVELOPMENT.md)
