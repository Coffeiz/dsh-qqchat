# Session 数据迁移

[English](./SESSION_MIGRATIONS.en.md) | 简体中文

## 概述

升级 dsh-qqchat 后，插件会在启动阶段检查当前 DSH profile 可见的 QQChat Sessions，并自动迁移旧的被动消息记录。迁移只转换 `qqchat/message` 展示事件，不改变 Agent 对话内容、Session ID 或 QQChat SQLite 历史。

迁移完成后，被动消息以 DSH 可忽略的 `plugin:qqchat/message` 记录保存。DSH 不认识该记录时可以安全保留并忽略；插件 Client 加载后会继续渲染这些消息。

## 迁移过程

迁移由 [启动迁移入口](../src/migrations/index.ts) 注册并按顺序调度，当前迁移位于 [qqchat-display-events.ts](../src/migrations/qqchat-display-events.ts)。插件先使用公开的 Session Persistence `list` 接口取得实际存储根，再扫描该根下所有 `qqchat-*` Session 目录；升级旧代际时使用公开的 `open` 和 `stat` 接口，并按来源格式处理：

| 来源格式 | 处理方式 |
| --- | --- |
| v4 | 将旧事件改名为 `plugin:qqchat/message`，并标记 `ignorable: true` |
| v3 | 先标记旧事件可忽略，再调用 DSH 写入打开流程发布当前格式；DSH 将事件命名空间化 |
| v0–v2 | 临时转换为无对话表面影响的反馈记录，调用 DSH 官方格式迁移器升级，再恢复为插件记录 |

迁移按 Session 逐个执行。每个被替换的日志都会先在同目录生成完整备份，再写入临时文件、校验 header 和事件顺序，最后原子替换。v0–v2 尚未带事件序号，升级时由 DSH 官方迁移器补齐；v3 及之后会校验原有连续序号。迁移也会移除早期 QQChat 写入 `user/message` 与待处理消息来源字段中的 QQ 专用扩展，保留展示所需信息在插件记录里。

旧版本可能在 `step/start` 前额外写入带有 `source.channel=qq` 的 `user/message` 表面副本。迁移会严格识别这些 QQ 记录，将它们临时存成反馈占位记录；DSH 官方迁移成功后，再恢复成 `ignorable` 的 QQ 气泡事件，并保留原消息载荷。这样不需要重排 DSH 的对话事件，也不会把旧 QQ 消息作为模型输入重放。其他来源的前置表面消息不会被改写，会计入 `deferred` 并保留原文件。其他升级失败会回滚本次暂存，并保留备份供后续版本重试。迁移标记放在 Session 目录中；已完成的 Session 后续启动会跳过。

## 数据范围与恢复

- 只处理持久化索引中 ID 以 `qqchat-` 开头的 Session，并且只迁移 DSH 当前选中的代际。
- 较早的不可变代际不直接重写；由 DSH 正常格式迁移生成当前代际。每个被替换的原始文件仍保留备份。
- 迁移日志只输出 Session ID、数量和失败原因，不输出消息正文、附件名或密钥。
- 迁移失败不会阻止插件继续启动。失败的 Session 不会写完成标记，后续启动会再次尝试。
- 不要在 DSH 正在写入同一批 Session 时手动运行或复制迁移文件；插件迁移在 Host 启动、QQ Gateway 启动之前执行。

旧版插件写入的 `qqchat/message` 是非 ignorable 自定义事件，DSH 会因而拒绝加载整份 Session。迁移后 Web 可以读取完整历史；迁移前的备份可用于人工恢复或重新迁移。
