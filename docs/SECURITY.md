# 安全与数据边界

## 易读概述

QQChat 同时接触 QQ 凭据、用户身份、群消息和 DSH Session。安全原则是：凭据留在 Host，身份使用 stable ID，数据按 account/group/member 隔离，日志不泄漏聊天正文。

## 凭据边界

- AppSecret、QQ Token、扫码 AES 临时 key 只存在 Host；手动连接表单只通过 loopback RPC 提交 AppSecret，验证失败时不保存新凭据。
- 浏览器只通过受限 RPC 获取状态和已经脱敏的展示数据。
- 凭据不写入 URL、日志、前端状态、测试 fixture 或 Git。
- SQLite 数据目录默认位于 `$DSH_HOME/plugins/dsh-qqchat/`，应由本地用户权限保护。

## 身份边界

稳定身份优先级：

```text
author.user_openid
  || author.member_openid
  || author.id
```

规则：

- `senderId` 用于权限、记忆、Session 映射和数据归属。
- `senderName`、nickname、alias 只用于展示或画像。
- Owner 判断只比较 stable sender ID。
- 不因昵称变化而创建新的身份，不因昵称相同而合并身份。

## 群与成员隔离

- 查询 group/member/message 时必须携带 account 和 scope 条件。
- group memory 不能因为当前成员查询而泄漏到其他群。
- member memory 可以按 stable sender 跨群连续，但不得混入特定群的关系事件。
- 日志、RPC 和 UI 不应显示不在当前会话范围内的成员数据。

## 工具权限

工具权限通过 DSH `tools/pre-execute` seam 判断：

```text
非 QQ 群 turn                  -> 放行
群成员工具开关开启              -> 放行
senderId == ownerUserId       -> 放行
其他                           -> 拒绝
```

没有配置 Owner 且关闭群成员工具时，群友触发的工具调用默认拒绝。

## 日志与错误

- 可见日志不得包含聊天正文、完整 QQ payload、凭据或用户敏感信息。
- 错误消息应包含足够的 endpoint、阶段和错误类型，但不直接回显未经脱敏的上游响应。
- 调试真实问题时使用虚构用户名、群 ID 和 sender ID 写入测试、文档和 commit message。
- 临时探针和真实数据在问题定位后清理。

## 外部请求

- QQ API 请求必须复用 QQApiClient 的认证、超时和发送格式逻辑。
- 不在新代码中直接拼接未校验的外部 URL。
- 非幂等发送不做无边界自动重试；发送失败交由现有 outbox/active fallback 处理。
