# 开发与验证

## 易读概述

QQChat 是 TypeScript 插件，Host 和 Client 一起构建。日常开发不需要单独运行一套 QQChat Web；插件应加载到 DSH Web 中验证。

## 环境要求

- Node.js `^22.19.0 || >=24.0.0`
- 可用的 DSH workspace
- 需要真实网关验证时，准备 QQ 官方 Bot 凭据；凭据只放在本地 Host 配置中

仓库当前不提交 `package-lock.json`，使用 `npm install` 安装依赖。

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
