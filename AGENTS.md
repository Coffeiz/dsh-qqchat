# dsh-qqchat 开发约定

## 修改前先确认边界

先判断改动属于 Host、Client、QQ 协议、记忆、数据库、权限还是 DSH 集成。优先阅读：

- [架构说明](docs/ARCHITECTURE.md)
- [开发与验证](docs/DEVELOPMENT.md)
- [记忆系统](docs/MEMORY.md)
- [安全与数据边界](docs/SECURITY.md)

插件不 fork DSH，也不复制 AgentLoop、Session、工具运行时或主 Conversation。需要扩展 DSH 时，优先使用官方 slot、RPC、Hook 和 policy seam。

## DSH 兼容边界

- 插件必须能够运行在官方发布版 DSH 上；用户安装插件时不应修改、patch、替换或重新构建 DSH。
- 不得通过修改 DSH 源码、锁文件或私有 API 来补齐插件能力。优先使用官方公开的 API、Slot、RPC、Hook 和类型定义。
- DSH 不支持的 QQ 展示、媒体和协议能力必须由插件自行适配，并提供明确的降级路径；不能把宿主缺少能力伪装成已支持。
- 提交前应在未修改的官方 DSH 工作区上完成插件 typecheck、test 和 build 验证。

## 调试原则

- 先定位真实根因，不用 fallback、吞异常或改宽断言掩盖问题。
- 静态分析连续无法定位时，使用 Host 日志、浏览器 DOM/截图或最小运行探针验证。
- 探针只用于定位，验证后清理，不把临时日志、真实数据或调试开关带入提交。
- 修复 UI 问题时必须检查实际构建产物和运行中的 DSH Web，不只看 TypeScript。

## 安全原则

- 聊天正文、附件名、Token、AppSecret、AES 临时 key 不写入可见日志、前端响应或 Git。
- 错误日志只保留定位所需信息；上游原始响应和敏感异常不得直接展示给用户。
- 身份、权限和记忆只使用 stable sender ID；昵称只用于展示，不能作为身份判断依据。
- 查询成员、群和消息时必须带 account/group/member 的范围约束，不能跨群泄漏记忆。
- 外部请求必须设置超时并遵守已有 URL、重试和发送策略。

## 代码与文档

- TypeScript 保持严格类型；Host 和 Client 的边界通过类型定义明确表达。
- UI 优先复用 DSH 原生 primitives、token 和 slot，不在插件里重新实现 Modal、Menu、Button 等基础组件。
- 日志、注释、用户文案和文档使用简体中文；代码标识遵循现有英文命名。
- 用户可感知变更写入 [CHANGELOG.md](CHANGELOG.md)，详细排查过程写入 [docs/devlog.md](docs/devlog.md)。
- 文档采用“易读概述 + 专业细节”的结构，并使用相对路径互相引用。

## 提交前验证

```bash
npm run typecheck
npm test
npm run build
```

也可以直接运行：

```bash
npm run check
```

禁止使用 `git push --force` 或 `--force-with-lease` 覆盖远端历史。提交前确认 `git diff --check` 通过，并检查没有把本地数据库、日志、截图、Token 或 lockfile 临时文件加入提交。
