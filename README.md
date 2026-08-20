<div align="center">

# dsh-qqchat

### 让 QQ 群聊与私聊接入 DeepSeek Harness

<p>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/DSH-Plugin-6f42c1.svg" alt="DSH Plugin">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6.svg" alt="TypeScript">
</p>

<p>
  <a href="./README.en.md">English</a> ·
  <a href="./docs/DEVELOPMENT.md">开发文档</a> ·
  <a href="./docs/ARCHITECTURE.md">架构说明</a>
</p>

<p><em>在 QQ 中聊天，在 DSH Web 中查看完整 Session、记忆和工具调用。</em></p>

</div>

`dsh-qqchat` 是 DeepSeek Harness（DSH）的 QQ 官方 Bot 插件，支持 QQ 群聊、私聊、会话隔离、记忆系统和 DSH 原生命令。

## 主要功能

| 功能 | 说明 | 备注 |
| --- | --- | --- |
| QQ 群聊与私聊 | 接收 QQ 官方 Bot 的群聊和私聊消息 | 每个群、每个私聊对象对应独立 DSH 会话 |
| 扫码连接 | 在 **设置 → QQ Chat** 中扫码绑定 QQ Bot | 支持取消连接后重新绑定 |
| 断线重连 | QQ Gateway 断线后自动恢复连接 | 无需重复扫码 |
| 群聊回复模式 | 自动回应、@回复、静默记录 | 可在设置页随时切换 |
| 消息格式兼容 | 智能兼容、Markdown、纯文本兼容 | 群聊和私聊可分别设置；群聊默认纯文本兼容 |
| 消息引用与 @ | 支持引用消息和 QQ @消息 | @用户优先显示用户名 |
| 会话隔离 | QQ 群聊和私聊分别使用独立会话 | 不同群、不同用户的上下文互相隔离 |
| 记忆系统 | 保存群聊、群成员和私聊用户的独立记忆 | 设置中可关闭；关闭不会删除已有记忆 |
| 记忆整理 | 自动将近期记录整理为长期记忆 | 后台执行，不阻塞正常回复 |
| 工具权限 | 控制群成员是否可以使用 Agent 工具 | 可指定 Owner，按稳定用户 ID 判断 |
| DSH / QQChat 命令 | QQ 中直接执行 `/compact`、`/goal`、`/plan`、`/model`、`/status` 等命令 | 命令不经过模型；发送 `/help` 查看完整列表 |
| DSH 原生界面 | 使用 DSH 默认会话、聊天区和输入框 | 支持从 DSH 主动向 QQ 发送消息 |
| 日志查看 | 在设置页查看 QQ Chat 运行日志 | 方便排查连接和消息问题 |

## 如何使用

<table>
  <tr>
    <td colspan="2" align="center" valign="top">
      <img src="./docs/assets/扫码链接.jpg" width="560" alt="QQ Chat 扫码连接">
      <h3>扫码连接</h3>
      <p>在 DSH Web 的 <strong>设置 → QQ Chat</strong> 中生成二维码，使用手机 QQ 扫描即可完成官方 Bot 授权。连接状态、重新生成二维码和取消绑定都可以在同一页面完成。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/assets/群聊界面.jpg" width="100%" alt="QQ 群聊在 DSH Web 中的显示">
      <h3>群聊与私聊</h3>
      <p>QQ 群聊和私聊都会接入 DSH Agent，并在 DSH Web 中以独立 Session 展示。群聊支持自动回应、@回复和静默记录，也支持引用消息、用户名显示和 @用户转换。</p>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/assets/记忆系统.jpg" width="100%" alt="QQ Chat 群聊记忆系统">
      <h3>记忆系统</h3>
      <p>插件会分别维护群聊、群成员和私聊用户的记忆。成员记忆支持资料、群内称呼、历史昵称和长期信息；近期消息会在空闲或达到阈值后自动整理为长期记忆。设置中可以关闭记忆系统，关闭后停止记忆注入和后台整理，但不会删除已有数据。</p>
    </td>
  </tr>
</table>

## 安装

### 新建一个 QQ Chat profile

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app dsh-qqchat
npx @deepseek-ai/dsh --profile qqchat
```

### 安装到已有的 Web profile

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-qqchat
npx @deepseek-ai/dsh --profile web
```

当前开发分支也可以直接从 GitHub 安装：

```bash
npx @deepseek-ai/dsh plugin --profile qqchat add @deepseek-ai/dsh-web-app "git+ssh://git@github.com/Coffeiz/dsh-qqchat.git#agent/typescript-migration"
npx @deepseek-ai/dsh --profile qqchat
```

## 第一次连接 QQ

1. 启动 DSH Web。
2. 打开 **设置 → QQ Chat**。
3. 点击 **扫码连接**。
4. 使用手机 QQ 扫描二维码，并选择要授权的官方 Bot。
5. 授权完成后，QQ Gateway 会自动连接。

连接成功后，QQ Chat 的设置和对话会出现在 DSH 中。

## 群聊接收方式

在 **设置 → QQ Chat → 消息接收** 中可以选择：

| 模式 | 行为 |
| --- | --- |
| 自动回应 | 每条群消息都会交给 Agent，Agent 可以自动回复 |
| @回复 | 所有消息都会记录，但只有 @Bot 的消息会触发回复 |
| 静默记录 | 只保存消息和记忆，不主动回复 |

群聊默认使用纯文本兼容格式，适合不同 QQ 客户端。私聊和群聊可以分别选择智能兼容、Markdown 或纯文本兼容。

## 命令

QQ 中以 `/` 开头的消息会交给命令系统处理，不会作为普通消息发送给模型。群聊中可以发送 `@Bot /help`。

| 命令 | 用途 |
| --- | --- |
| `/help`、`/commands` | 查看 QQChat 和 DSH 命令 |
| `/new`、`/reset`、`/clear` | 保留旧 Session，下一条消息开始新的 QQ Session |
| `/compact` | 手动压缩较早的会话历史 |
| `/model [provider/]model` | 查看或切换当前群聊/私聊的模型 |
| `/stop` | 中止当前生成 |
| `/status` | 查看当前 Session、模型和生成状态 |
| `/ping` | 测试 QQChat 连通性 |
| `/version` | 查看 QQChat 版本 |
| `/goal` | 查看、创建、编辑、暂停、恢复或清除 Goal |
| `/plan` | 进入或退出 Plan 模式 |
| `/feedback` | 提交反馈 |
| `/permission` | 查看或切换工具权限预设 |

`/export` 是 DSH Web 的浏览器下载命令，QQ 中会提示暂不支持。模型切换按群聊/私聊分别生效，并保留已有对话上下文。

## 记忆内容

QQ Chat 会分别保存：

- 群聊记忆：群里的重要事件、约定、话题和关系
- 群成员记忆：成员的资料、群内称呼、历史昵称、行为特点和长期信息
- 私聊记忆：与某个 QQ 用户的长期对话信息

记忆会在聊天空闲或积累到一定数量后异步整理，不会阻塞正常回复。可以从 QQ Session 顶部的 **QQ 记忆** 入口查看群和成员记忆。记忆内容会注入每轮 Agent 上下文，启用后可能降低上下文缓存命中率并增加输入 token；可在 **设置 → QQ Chat → 记忆系统** 中关闭。

## 工具权限

在设置中打开 **群成员可用工具** 后，群友触发的 Agent 也可以使用当前配置的工具。

关闭后，只有设置为 Owner 的账号可以在群聊中使用工具；其他群友仍然可以正常聊天和获得回复。

Owner 使用 QQ 的稳定用户 ID 判断，不根据昵称判断身份。

## 消息显示

QQ 对话会使用 DSH 的默认聊天界面显示：

- 显示发送人用户名
- 区分自己发送和他人发送的消息
- 支持消息引用显示
- 支持 QQ @消息转换为用户名
- 支持从 DSH 会话输入框主动发送 QQ 消息

## 注意事项

- 需要 QQ 官方 Bot，不支持个人 QQ 账号登录。
- 当前版本仍属于 alpha，建议先在测试 Bot 和测试群中使用。
- 富媒体、完整 QQ 表情和部分复杂消息格式可能需要使用兼容模式。
- 卸载插件不会自动删除已经保存的聊天和记忆数据。

## 本地开发

```bash
npm install
npm run check
```

更多开发约定和内部说明见：

- [开发说明](./docs/DEVELOPMENT.md)
- [记忆规则](./docs/MEMORY.md)
- [安全边界](./docs/SECURITY.md)
- [架构说明](./docs/ARCHITECTURE.md)

## License

本项目使用 [MIT License](./LICENSE)。
