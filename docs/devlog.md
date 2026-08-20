# 开发日志

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
