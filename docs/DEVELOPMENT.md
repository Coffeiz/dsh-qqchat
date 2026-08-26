# 开发与验证

## 易读概述

QQChat 是 TypeScript 插件，Host 和 Client 一起构建。日常开发不需要单独运行一套 QQChat Web；插件应加载到 DSH Web 中验证。

## 环境要求

- Node.js `^22.19.0 || >=24.0.0`
- 可用的 DSH workspace
- 需要真实网关验证时，准备 QQ 官方 Bot 凭据；凭据只放在本地 Host 配置中

仓库提交 `package-lock.json`，使用 `npm install` 安装依赖并保持发布安装结果一致。

## DSH 兼容要求

插件以官方发布版 DSH 为运行基线。安装者不需要修改 DSH 源码、锁文件或构建流程；插件自身也不能依赖本地 DSH patch 或未发布的私有接口。

验证插件兼容性时，应在干净的官方 DSH 工作区中检查：

1. DSH 本地工作区没有插件补丁或未提交修改。
2. 插件依赖的 DSH 包版本与官方发布版本一致。
3. 插件 `npm run check` 能独立通过。
4. 启动 DSH Web 后，插件 Host、Client 和设置页都能正常加载。

当前已知的宿主兼容边界见[架构说明](./ARCHITECTURE.md)和[媒体与引用方案](./MEDIA_AND_QUOTES.md)：自定义 `qqchat/message` 展示事件不属于官方 DSH 的标准 Agent 事件，插件会在加载时自动注册事件类型；若特殊打包环境无法找到宿主事件表，才会触发新建 Session 的降级，QQ 完整历史仍由自身 SQLite 保存。该兼容层不要求用户修改 DSH。

## 当前功能兼容矩阵

| 功能 | DSH 原生支持情况 | 插件行为 |
| --- | --- | --- |
| QQ 文本消息与独立 Session | 无 QQ 协议支持 | 转换为 DSH 标准 user message，并保留 QQ 身份元数据 |
| 群友静默记录、未 @ 消息展示 | 无 QQ 自定义展示事件 | 使用插件 Client 渲染 `qqchat/message`；不送入模型 |
| 图片输入 | 取决于当前 DSH 模型路由和附件服务 | 使用 DSH 原生图片块；不支持视觉时使用稳定文本降级和读取工具 |
| 音频、视频和普通文件 | DSH 不提供统一的 QQ 媒体理解能力 | 保存附件并提供类型提示、文件工具或媒体信息工具 |
| QQ 私聊流式回复 | DSH 不负责 QQ Gateway 流式协议 | 插件调用 QQ 官方接口；失败时回退普通发送，纯文本兼容模式自动关闭 |
| QQ 引用、@和气泡 | DSH 不认识 QQ 协议字段 | 插件把引用和 @ 转为可读文本/元数据，并由 Client 做展示 |
| DSH 原生命令 | DSH 只处理 DSH Web 自己收到的命令 | 插件将 `/qq...` 命令解析后转交或执行，避免与 DSH 原命令冲突 |

## 本地安装与检查

```bash
npm install
npm run typecheck
npm test
npm run build
```

完整检查：

```bash
npm run check
```

构建步骤：

```text
src/*.ts              -> lib/*.js       Host
client-src/*.cts      -> 临时 CJS       Client
临时 CJS              -> lib/client.js  DSH ModuleLoader factory
```

`lib/` 和临时 Client 构建目录是生成物，不是源码真相。

## 启动 DSH Web

在 DSH 仓库中：

```bash
pnpm dsh --profile qqchat --no-open --port 3080
```

打开 `http://127.0.0.1:3080`，进入设置中的 QQ Chat，检查：

1. 设置页面宽度、换行和弹窗滚动。
2. 群聊接收的三个按钮状态。
3. 群聊/私聊消息格式是否独立保存。
4. 消息发送人的用户名、@用户名和引用显示。
5. 记忆弹窗、日志弹窗在长内容下是否只在内部滚动。

修改 Client 后必须重新执行 `npm run build`，再重启 DSH；仅刷新浏览器不能保证 Host 已加载新的 `lib/client.js`。

## 测试约定

- 纯逻辑变化补充 `tests/*.test.ts` 回归测试。
- 测试名称说明触发路径和关键结果。
- 不通过删除断言、`skip` 或放宽校验来恢复绿色。
- 涉及真实 QQ Gateway、扫码、Session 恢复或 DSH Web 布局的变化，除了单测，还要做真实环境验证。

## Git 约定

- 提交前运行 `git diff --check`。
- 不提交 `qqchat.sqlite`、日志、截图、凭据和临时构建目录。
- 不使用 force push；需要同步远端时保留已有历史。
