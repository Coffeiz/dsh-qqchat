# dsh-qqchat 文档导航

## 易读概述

QQChat 是 DSH 的 out-of-tree QQ 官方 Bot 插件。文档按“如何开发、数据如何保存、边界如何保证”组织。

## 专业细节

| 文档 | 内容 |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | DSH、QQ Gateway、SQLite、Agent、Client 的职责边界 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 安装、构建、测试、启动和 UI 验证 |
| [MEMORY.md](MEMORY.md) | group/member scope、daily、memory、反思和压缩 |
| [MEMORY_CONTEXT.md](MEMORY_CONTEXT.md) | DSH Session 内的记忆快照、TTL、compact 刷新和注入生命周期 |
| [MEDIA_AND_QUOTES.md](MEDIA_AND_QUOTES.md) | 媒体输入、引用消息、附件存储、安全和分阶段实现方案 |
| [STREAMING.md](STREAMING.md) | QQ 私聊官方流式传输、队列、降级和故障复盘 |
| [SECURITY.md](SECURITY.md) | 凭据、身份、权限、日志和数据隔离 |
| [CHANGELOG.md](../CHANGELOG.md) | 面向用户的简短变更记录 |
| [devlog.md](devlog.md) | 具体排查、决策和踩坑记录 |

根目录 [AGENTS.md](../AGENTS.md) 是修改代码前必须遵守的通用约定。
