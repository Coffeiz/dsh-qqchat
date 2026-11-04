# 开发日志

## 2026-11-05 · 旧 QQ Session 受保护提示头迁移

### 根因

旧版 QQChat 曾在 `step/start` 之前额外追加带有 `source.channel=qq` 的 `user/message` 表面副本。DSH 需要受保护的系统提示头作为首条表面事件，因此官方格式迁移无法接收这些历史记录；插件此前只会反复跳过它们。

### 修复

- 只识别 QQ channel 的旧用户表面副本，暂存成反馈占位记录；DSH 官方迁移完成后恢复成 ignorable 的 QQ 气泡事件，完整保留原载荷。
- 私聊旧记录标记为 Owner 气泡，并从 `正文:` 段提取显示正文，避免展示历史提示包装。
- 其他来源的前置表面消息不碰数据，单独计入 deferred；不再把可预期的延期计为迁移失败。
- 迁移标记升级到 v4，避免旧标记阻止新的迁移步骤；增加正常恢复和安全延期测试。

### 验证

Node 24 下完整 `npm run check` 通过：类型检查、72 项测试和构建全部成功。依赖副本测试使用隔离 fixture，覆盖 CLI、插件和 persistence 各自解析出的三个 Session 模块。运行中的 DSH 通过官方 Persistence `open` 将 31 个 QQ Session 升至 v4；结构检查确认旧必需 `qqchat/message` 为 0、占位记录为 0、所有 QQ 插件事件均标记 ignorable，原始备份保留。21 个有表面事件的 Session 以 `system/message` 开头，另外 10 个没有表面事件；没有发现错误首表面事件。

## 2026-11-05 · QQ 流式回复定稿保护

### 根因

QQ 已接受一段流式正文后，模型最终正文可能改写已发送前缀。QQ 会拒绝覆盖已确认内容；若随后退回普通发送全文，用户会看到重复回复。

### 修复

- 流结束前先排空已排队的更新，并检查最终正文是否以已送达前缀开头。
- 若不匹配，使用最后确认的正文发送结束帧并报告部分交付，不再补发完整普通回复。
- 增加模拟 HTTP 回归测试并更新流式设计文档。

### 验证

Node 24 下 `npm run check` 通过，流式定稿回归验证了已确认前缀不会被覆盖，也不会补发完整回复。

## 2026-11-05 · QQ 用户气泡正文与身份上下文分离

### 根因

私聊和 Owner 消息已经走 DSH 原生用户气泡，但 Agent 输入正文仍由 `currentMessageText()` 拼接发送人 ID、@状态、引用和“正文”标签，DSH 因此把整段元数据显示在气泡中。

### 修复

- 原生气泡只写 QQ 实际正文和 DSH 图片块，不再混入身份包装或附件文件名。
- 身份、引用及媒体工具所需附件 ID 通过单独的 Agent 上下文消息提供，模型仍能获得可靠身份信息。
- 增加回归断言，覆盖气泡纯正文及上下文保留身份、@状态和附件 ID。

## 2026-11-04 · QQ 私聊与群主消息气泡

### 现象与根因

私聊和群主消息在 DSH Web 中显示为可展开的“收到执行请求”上下文卡片。入 Agent 时插件将它们统一标为 `kind: qq-chat`、`form: notice`；DSH 会把所有非 `user` 来源渲染为上下文，而不会生成标准用户气泡。

### 修复

- 私聊与群主消息改用 `kind: user`、`channel: qq`，并保留 bot、聊天、发送人和 QQ 消息 ID 元数据，让 DSH 按原生用户消息渲染。
- 普通群成员触发的消息继续使用 notice 来源，维持群聊上下文展示语义。
- 增加来源类型回归测试覆盖私聊、群主和普通群成员三种情况。

### 验证

Node 24 下类型检查和消息来源测试通过。重新构建并重启后可在 DSH Web 用私聊或群主消息确认最终气泡效果。

## 2026-11-04 · DSH v4 记忆快照来源

### 现象与根因

消息触发“format v4 message requires a producer-owned source kind”。检查 DSH `session-format-v3-to-v4` 的校验后确认，插件仍将记忆快照作为 `source.kind = plugin`、`source.plugin = @deepseek-ai/dsh-system-prompt` 写入；v4 不再接受该通用包装来源，要求每个生产者使用自己的 `source.kind`。

### 修复

- 新记忆快照使用 `qq-chat-memory` 来源类型和 `snapshot` 表单，不再写入保留的 `plugin` kind。
- 恢复快照时同时识别新来源和历史包装来源，避免升级后重复注入已有记忆。
- 将来源类型加入 DSH LLM 类型扩展，并增加新旧格式恢复回归用例。

### 验证

Node 24 下类型检查、记忆快照测试（5 项）和插件构建通过。重启 DSH 后 QQ Gateway 状态恢复为 online；尚未通过真实 QQ 消息做端到端验证。

## 2026-11-04 · DSH QQChat Session 兼容迁移

### 背景

DSH 新版拒绝读取未标记为可忽略的未知 Session 事件。插件此前将静默 QQ 消息以必需事件 `qqchat/message` 写入，因此仅靠启动时动态扩展 known-event 集合无法保证 Web 历史读取和多依赖副本下的恢复。

### 决策

- 新记录使用 `plugin:qqchat/message` 和 `appendPluginRecord`，由 DSH 作为 ignorable、log-only 数据保存；Client 仍以原生 Conversation event slot 渲染。
- 对 v4 直接做原子事件转换；对 v3 设置 ignorable 后使用 DSH 写入打开路径；对 v0–v2 暂存成无表面效果的 `feedback/record`，由 DSH 官方迁移器升级后再还原为插件记录。
- 迁移只发现当前 profile 的 `qqchat-*` Session 当前代际；保留每份被替换日志的同目录备份，并用完成标记保证幂等。
- v0–v2 事件记录没有 `seq` 字段，迁移校验只要求保留原有行序，由 DSH 官方迁移器生成新版序号；v3 及之后仍严格校验连续序号。
- 在独立 `src/migrations/` 目录建立有序迁移注册表，后续数据升级按 migration ID 追加，每一步独立幂等；发现同目录多代 Session 时按最新实际文件迁移，并在发布后校验旧事件已全部转换。
- v0→v4 的实际升级还会检查旧 Session 首条表面事件与 step 顺序；DSH 明确拒绝需要重排的历史，因此插件预检跳过这些文件。其他升级失败会恢复本次暂存字节，避免留下占位记录。
- 迁移失败时保留可重试状态并允许插件继续启动；不会用忽略异常的方式伪装完成。

### 验证边界

构建和启动 DSH 后应检查迁移摘要、旧 Session 历史读取、被动群消息气泡及新消息追加。不要在 DSH 进程正在写相同 Session 时手动搬动日志文件。

## 2026-08-20 · 文档规范补充

### 背景

QQChat 已经具备 DSH Session、QQ Gateway、SQLite 记忆和 Client UI，但原仓库只有 README 与架构文档，缺少面向贡献者的安全、测试和记忆维护约定。

### 决策

- 采用 Gugu 的“根约定 + 领域文档 + devlog”结构。
- 将 Gugu 中与 Python、Vue、Mutagen、systemd 绑定的内容排除，只迁移根因调试、安全日志、测试回归和文档组织原则。
- 记忆文档明确记录 group/member scope、daily 格式、压缩阈值和失败保护，避免后续改动破坏已建立的数据契约。
- 把 DSH 原生 UI primitives、slot 和权限 seam 写入开发边界，防止插件重新实现宿主基础设施。

### 验证

文档补充不改变运行时代码。代码变更仍需执行：

```bash
npm run typecheck
npm test
npm run build
```
