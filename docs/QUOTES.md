# QQ 引用消息方案

## 易读概述

QQ 的引用事件不一定携带被引用消息的完整内容。尤其是 C2C 图片引用，当前事件可能只有 `ref_msg_idx`，没有正文、附件或可下载 URL。

因此引用不能只依赖当前事件解析。dsh-qqchat 后续采用“当前事件优先、历史引用索引兜底”的方案：

```text
普通消息到达
  -> 保存正文、消息 ID、msg_idx 和附件关系

引用消息到达
  -> 解析当前事件中的引用
  -> 按 ref_msg_idx 查询历史引用索引
  -> 复用已保存的正文和附件
  -> 进入 DSH Agent、Session 和 Web
```

最终目标是让群聊、私聊、图片引用、文件引用和机器人消息引用使用同一套消息关系和权限边界。

## 当前状态

当前已经完成：

- `message_reference`、`reference`、`quote` 和 QQ 原生 `message_scene.ext` 的基础解析；
- 引用正文、发送人和附件的独立数据结构；
- SQLite 消息、附件和消息附件关系；
- 引用附件的 `quoted` 标记和已有附件复用；
- Session 范围的附件读取权限；
- DSH Web 中独立的引用块和引用附件展示。
- `msg_idx` / `ref_msg_idx` 的标准化和 SQLite 引用索引；
- 引用索引 7 天 TTL、过期清理和聊天范围隔离；
- 当前事件缺少引用内容时的历史正文回填；
- 已保存引用附件的 `attachmentId` 复用。

当前仍缺少：

- 多次引用、过期引用和机器人消息引用的真实 QQ 验收；
- 网关重启后的真实 C2C 图片引用验收；
- 引用索引与当前 QQ 协议字段的更多兼容样本。

详细的媒体、附件和 Web 边界见 [MEDIA_AND_QUOTES.md](MEDIA_AND_QUOTES.md)。

## 设计原则

### 当前事件优先，历史索引兜底

引用解析顺序固定为：

1. `message_reference`、`reference` 或 `quote` 中的结构化引用；
2. `msg_elements` 中匹配 `ref_msg_idx` 的元素；
3. SQLite 引用索引中的历史消息；
4. 当前事件嵌套字段中的 URL 和附件信息作为最后兜底。

无法确认引用关系时，不猜测、不把普通正文误当成引用，只保留当前消息。

### 引用关系和消息正文分离

引用正文不能直接拼进当前消息正文。消息模型保持：

```ts
interface QQQuoteInput {
  messageId?: string
  senderId?: string
  senderName?: string
  text: string
  attachments: QQAttachmentInput[]
}

interface QQNormalizedMessage {
  messageId: string
  text: string
  quote?: QQQuoteInput
  // QQ 协议元数据，供引用索引使用
  msgIdx?: string
  refMsgIdx?: string
}
```

这样可以同时满足：

- Agent 能明确区分“引用内容”和“当前问题”；
- DSH Web 能渲染独立引用块；
- 记忆系统不会把引用正文误认为当前发言；
- 当前消息仍然保持原始用户输入。

### 使用稳定身份和聊天范围

引用索引的 key 必须带上账号和聊天范围：

```text
account_id:chat_type:chat_id:msg_idx
```

其中：

- 群聊的 `chat_id` 是 `group_openid`；
- 私聊的 `chat_id` 是对方稳定用户 ID；
- 账号 ID 用于隔离多个 QQ Bot；
- `msg_idx` 只作为同一聊天范围内的索引，不能单独使用。

不能使用昵称、引用文本或文件名作为引用关系的唯一键。

## 引用索引

### 推荐存储

使用现有 SQLite，不新增 JSONL 文件。建议增加：

```text
qq_quote_index
  id
  account_id
  chat_type                 c2c | group
  chat_id
  msg_idx
  platform_message_id
  sender_id
  sender_name
  content_summary           最多 200 字符
  created_at
  expires_at
```

唯一约束：

```text
UNIQUE(account_id, chat_type, chat_id, msg_idx)
```

附件不在索引中复制二进制数据，也不重复保存附件记录。通过 `platform_message_id` 和 `message_attachments` 关联现有附件。

### 为什么不直接复制咕咕的 JSONL

咕咕的 JSONL 索引适合独立 Gateway 进程，但 dsh-qqchat 已经具备：

- SQLite 消息持久化；
- account、group、member 和 Session 关系；
- 附件生命周期和权限查询；
- 消息去重。

直接使用 SQLite 可以避免两套持久化状态不一致，也能让引用附件继续经过现有 Session 权限检查。

### TTL 和清理

引用索引建议保留 7 天，与媒体附件 TTL 一致：

- 读取时检查 `expires_at`；
- 定期清除过期索引；
- 附件是否删除由附件表和物理文件生命周期决定；
- 删除索引不能直接删除附件，必须检查其他消息关系。

索引只保存结构化元数据，不把 QQ 签名 URL 长期写入数据库、Session、日志或前端。

## 入站处理流程

### 普通消息

```text
QQ DISPATCH
  -> 解析 chat_type / chat_id / sender_id
  -> 读取 msg_idx
  -> 标准化正文和附件
  -> 下载并保存允许接收的附件
  -> 写入 messages 和 message_attachments
  -> 写入 qq_quote_index
  -> 根据群聊接收模式决定是否触发 Agent
```

普通消息必须先登记，后续引用才能恢复它的正文和附件。

### 引用消息

```text
QQ DISPATCH
  -> 读取 ref_msg_idx
  -> 尝试解析当前事件引用
  -> 当前事件缺字段时查询 qq_quote_index
  -> 根据 source message 复用附件关系
  -> 标记引用附件 role=quoted
  -> 保存 quote_json
  -> 生成 Agent 上下文和 Web transcript
```

如果索引命中但附件已过期：

- 保留引用发送人和正文；
- 显示“引用附件已过期”或媒体摘要；
- 不返回原始签名 URL；
- 不让整轮 Agent 失败。

### 递归字段兜底

不同 QQ 适配器的附件字段可能不同，最后兜底可以读取：

```text
url
file_url
download_url
downloadUrl
href
file
image_url
origin_url
preview_url
```

这只用于当前事件解析，不能替代持久化引用索引，也不能绕过统一的 HTTPS、DNS、大小和超时校验。

## 附件复用策略

```text
命中引用索引
  -> 找到 source platform message
  -> 按 source_file_id 查询现有附件
  -> 附件有效：复用 storage_key / imageRef
  -> 附件不存在但当前事件有 URL：通过媒体下载器重新获取
  -> 两者都不存在：保留引用摘要，降级处理
```

引用关系提交前，源附件不能被清理。共享物理文件时：

- 新建消息附件关系；
- 不复制二进制文件；
- 延长源附件有效期；
- 清理前检查是否还有存活关系。

群成员是否允许接收媒体仍由现有 `groupMembersCanReceiveMedia` 控制。关闭媒体接收时，不应因为后续引用而绕过权限下载原始文件。

## Agent 和 Session

触发 Agent 的引用消息继续使用 DSH 原生 `user/message`，引用信息作为同一条消息中的结构化上下文：

```text
[引用消息]
发送人：Alice
消息 ID：...
内容：请看看这张图
附件：图片 image.png（attachment_id=...）

[当前消息]
用户：这是什么意思？
```

静默消息继续使用 `qqchat/message`，事件 payload 只能包含 JSON 可序列化摘要：

```json
{
  "messageId": "db:123",
  "quotedText": "原消息",
  "quote": {
    "messageId": "m-old",
    "senderName": "Alice",
    "attachments": [{ "id": "qqatt-1", "kind": "image", "quoted": true }]
  }
}
```

禁止把 Buffer、Blob、文件句柄、SDK 原始对象或循环引用写入 Session event。

## Web 展示

引用继续使用独立样式，但不新建第二套 DSH 气泡或附件系统：

```text
引用块
  ├─ 引用发送人
  ├─ 引用正文
  └─ 引用附件缩略图/摘要

当前消息气泡
  ├─ 当前正文
  └─ 当前消息附件
```

当前 Client 已提供引用块和引用附件展示。后续优化只补充：

- 引用消息来源用户名；
- 引用失效和附件过期状态；
- 多附件的顺序和数量限制；
- 引用图片的原生 DSH 预览入口。

不得把引用正文重新拼进 `content`，不得把 QQ 原始 URL 交给浏览器。

## 机器人消息引用

机器人自己的消息也应尽量登记到引用索引：

- QQ API 返回平台消息 ID 时，写入索引；
- 无法获得平台消息 ID 时，不伪造索引 key；
- 被引用时优先使用当前事件提供的结构化内容；
- 无法恢复时显示引用不可用，不影响当前消息处理。

机器人消息引用不能使用本地 DSH Session event ID 代替 QQ 平台消息 ID，因为 QQ 的 `ref_msg_idx` 只在 QQ 协议范围内有意义。

## 安全边界

- 索引按 account、chat type 和 chat ID 隔离；
- 引用附件必须重新通过当前 Session 的附件权限校验；
- 群附件不能通过同一成员的 C2C Session 读取；
- 不长期保存带签名的 QQ 下载 URL；
- 不把用户完整正文写入日志；
- 引用索引只能补全已收到、已登记的消息，不能凭空恢复 QQ 未提供的媒体；
- 下载仍使用统一媒体存储层的 HTTPS、DNS、重定向、大小和超时限制。

## 分阶段实施

### Phase 1：协议字段和索引契约（已完成）

- [x] 从 `message_scene.ext` 标准化 `msg_idx` 和 `ref_msg_idx`；
- [x] 为当前消息和引用关系增加内部类型；
- [x] 增加 normalize 测试覆盖群聊和 C2C；
- [x] 确认没有索引字段时的 message ID fallback 行为。

### Phase 2：SQLite 引用索引（已完成）

- [x] 增加 `qq_quote_index` 表和 account/chat scope 唯一约束；
- [x] 普通消息入站时登记正文摘要和附件关系；
- [x] 增加 7 天 TTL 和清理；SQLite 索引不需要单独 JSONL compact；
- [x] 进程重启后从 SQLite 恢复索引。

### Phase 3：引用回填和附件复用（基础能力已完成）

- [x] 当前事件缺少引用内容时查询索引；
- [x] 按 source message 和已保存的 attachment ID 复用附件；
- [x] 增加引用索引、范围隔离和过期测试；
- [ ] 完成连续引用、真实引用图片/文件和下载失败降级的集成测试。

### Phase 4：真实 QQ 和 Web 验收

- [ ] 群聊引用文字和图片；
- [ ] 私聊引用文字和图片；
- [ ] 重启后引用仍能恢复；
- [ ] 机器人消息引用；
- [ ] 多附件和引用附件顺序；
- [ ] DSH Web 中引用块、缩略图、过期状态和权限拒绝；
- [ ] 真实 Session、account、群和成员跨范围读取验证。

## 验收标准

- 普通消息没有引用时行为不变；
- 当前事件带引用内容时不依赖索引也能正常处理；
- 当前事件只有 `ref_msg_idx` 时，已登记消息可以恢复正文和附件；
- 引用附件不会重复下载或重复保存；
- 索引过期后不会返回旧附件；
- 网关重启后索引可恢复；
- 群和私聊之间不能越权读取引用附件；
- 引用解析失败不会导致 Agent turn 失败；
- Session event 始终 JSON 可序列化；
- Web 保持 DSH 原生消息和附件风格。
