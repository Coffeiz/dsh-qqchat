# 媒体与引用消息方案

## 易读概述

本文审查当前 `dsh-qqchat`、官方 `dsh-qqbot` 与咕咕的媒体和引用消息处理方式，并给出 `dsh-qqchat` 后续实现方案。

目标是让 QQ 中的图片、语音、视频、文件和引用消息能够：

- 被稳定接收、保存和清理；
- 正确进入 DSH Agent 上下文；
- 在模型支持时真正被理解，而不是只显示一个 URL；
- 在 DSH Web 和 QQ 侧保留清晰的消息关系；
- 不破坏现有 Session、记忆、权限和消息兼容格式。

本文是设计与审查文档，不代表所有功能已经实现。

当前实现进度：Phase 0–4 已完成官方方案范围内的基础链路。已包含标准化媒体/引用类型、QQ 附件解析、SQLite 附件关系、安全下载、媒体清理、图片附件接入、`qqchat_describe_image`、`qqchat_read_file`、`qqchat_media_info`、引用附件复用和 Web 媒体摘要卡片。视频、音频原生模型输入以及真实图片缩略图仍取决于 DSH/provider 的具体能力，暂不伪造通用 ContentBlock。

Web 渲染后续采用“DSH 原生优先”的方案：触发 Agent 的消息使用 DSH 原生消息内容和 `ImageBlock`；静默记录或未触发 Agent 的 QQ transcript 只增加最小的附件适配，不另建一套气泡、图片预览、文件卡片或媒体主题。这样不会为了显示媒体而改变群聊接收模式或额外唤醒 Agent。

## 结论

官方 `dsh-qqbot` 已经支持媒体和引用，但主链路采用“安全下载到本地文件，再把路径和元数据注入文本上下文”的方案。图片理解通过独立的视觉工具完成，视频和文件则交给 `ffmpeg`、文件工具等能力处理。

咕咕的实现更完整：它有持久化附件 ID、消息级附件关系、图片原生多模态输入、语音模型、视频压缩和模型能力路由。不过咕咕也依赖更多供应商扩展，复杂度和维护成本更高。

`dsh-qqchat` 建议采用分阶段方案：

1. 先建立统一的媒体与引用数据模型和安全下载层；
2. 默认采用官方兼容模式，媒体路径和元数据进入 Agent 上下文；
3. 图片在视觉模型可用时通过 DSH 官方 attachment seam 转成 `ImageBlock`；
4. 后续按模型能力逐步增加原生视频、音频输入；
5. 引用消息与普通消息共享同一套附件和生命周期管理。

## 现状审查

### dsh-qqchat 当前状态

当前插件已经支持引用文本的基础处理：

- 从 `message_reference`、`reference`、`quote` 和 QQ 原生 `message_scene.ext` 中提取引用文本；
- 将引用文本保存到 `messages.quoted_text`；
- 给 Agent 组装成 Markdown 引用块；
- 发送回复时使用当前 QQ 消息 ID 作为回复目标。

当前尚未形成完整的媒体/引用模型：

- `QQNormalizedMessage` 没有附件数组；
- `InsertMessageInput` 没有附件或引用消息元数据；
- SQLite 没有附件表和消息附件关系；
- `msg_elements` 中的图片、文件、语音、视频没有统一标准化；
- Agent 主消息目前只有文本 `ContentBlock`；
- 出站消息只有文本/Markdown 路径；
- 没有媒体目录、附件清理、文件大小限制和下载 SSRF 防护的专用实现。

因此现在的引用属于“引用文本”，不是完整的“引用消息上下文”。

### 官方 dsh-qqbot

官方仓库的入站链路会将消息拆成文本、引用、发送人标签、媒体元数据和历史上下文。媒体附件会被安全下载到本地目录，并在 Agent 文本上下文中标记类型、名称和本地路径。

图片分析由 `qqbot_describe_image` 完成：工具读取本地图片，保存为 DSH 图片附件引用，然后发起包含图片块的视觉请求。也就是说，官方支持 DSH 的原生图片输入，但不是把每一条 QQ 图片消息都直接作为主 Agent turn 的图片块。

官方还包含以下安全和生命周期措施：

- 仅允许 HTTPS；
- 下载前后检查域名解析结果，阻止内网和本机地址；
- 单文件和单消息大小限制；
- 超时和重定向限制；
- 文件名清理和随机文件名；
- 定期删除过期媒体文件。

参考：

- [官方仓库](https://github.com/tencent-connect/dsh-qqbot/tree/main)
- [官方媒体目录](https://github.com/tencent-connect/dsh-qqbot/tree/main/src/media)
- [官方图片视觉工具](https://github.com/tencent-connect/dsh-qqbot/blob/main/src/media/vision-tool.ts)
- [官方附件下载](https://github.com/tencent-connect/dsh-qqbot/blob/main/src/transport/attachment.ts)
- [官方入站上下文组装](https://github.com/tencent-connect/dsh-qqbot/blob/main/src/transport/inbound.ts)

### 咕咕

咕咕当前的媒体链路比官方方案更丰富：

- QQ 附件在 worker 侧统一下载和暂存；
- 使用 `attach_id` 和 `chat_attachments` 管理附件；
- 图片可根据当前模型能力构造成图片输入；
- 支持图片缩放、压缩、数量限制和格式转换；
- 语音可使用独立语音识别模型；
- 视频支持时长、大小、码率和分辨率限制，并可按供应商要求压缩或转为 `mm_file`；
- 文件可作为附件卡片显示，也可由 Agent 读取或保存到文件库；
- 引用附件会被识别并标记为 `quoted`；
- 会话删除、孤儿附件、视频转码缓存都有清理路径。

咕咕的“引用附件复用”方案还需要区分设计和完整落地状态：它已经有消息级引用附件接入和持久化附件基础，但通过稳定消息 ID 复用历史附件、引用计数和并发删除保护主要记录在其设计文档中，不能默认视为已经全部完成。

## 设计原则

### 身份和引用分离

引用关系必须使用 QQ 稳定消息 ID 和发送人稳定 ID，不能用昵称或引用文本作为唯一键。

昵称只用于显示；消息 ID 用于关联附件、查找历史消息和避免重复下载。

### 附件和消息分离

消息正文不直接保存二进制数据。消息只保存附件引用和必要的展示元数据，物理文件由附件存储层管理。

### 主 Agent 与媒体工具分层

默认不要因为收到图片就强制当前模型切换成视觉模型。媒体首先进入统一附件层，再根据当前模型能力决定：

- 直接构造原生图片/音视频输入；
- 调用图片描述工具；
- 交给文件工具或 `ffmpeg`；
- 只注入“当前模型无法处理”的清晰文本提示。

### 引用消息复用普通消息能力

引用消息不是另一种孤立的消息类型。它应当复用普通消息的文本、附件、记忆、权限和展示逻辑，仅额外携带引用关系。

### 可恢复优先

附件下载失败、模型不支持媒体、引用消息过期或附件被清理时，都应降级为可理解的文本提示，不能让整轮 Agent 因附件异常崩溃。

## 推荐数据模型

### 标准化入站结构

建议在 QQ Gateway 和 Agent 之间使用如下结构：

```ts
interface QQAttachmentInput {
  sourceUrl?: string
  filename?: string
  contentType?: string
  size?: number
  width?: number
  height?: number
  durationMs?: number
  platformFileId?: string
  quoted?: boolean
}

interface QQQuoteInput {
  messageId?: string
  senderId?: string
  senderName?: string
  text: string
  attachments: QQAttachmentInput[]
}

interface QQNormalizedMessage {
  // 现有字段省略
  text: string
  attachments: QQAttachmentInput[]
  quote?: QQQuoteInput
}
```

`raw` 仍可保留用于诊断，但 Agent、存储和 UI 不应直接依赖 QQ 原始 payload。

### 附件持久化结构

第一版可以使用 SQLite 管理元数据，物理文件存放在插件数据目录或 DSH 官方附件存储中：

```text
attachments
  id
  account_id
  owner_scope
  source_message_id
  source_file_id
  sha256
  kind                  image | audio | video | voice | file
  filename
  content_type
  size_bytes
  width
  height
  duration_ms
  storage_key
  status                staged | attached | expired | deleted | failed
  created_at
  expires_at

message_attachments
  message_id
  attachment_id
  role                  own | quoted
  ordinal

message_quotes
  message_id
  quoted_platform_message_id
  quoted_sender_id
  quoted_sender_name
  quoted_text
```

如果后续完全使用 DSH 的 durable attachment API，可以将 `storage_key` 替换为 DSH attachment ref，但消息级关系仍应由插件保存，因为 QQ 的消息 ID、引用角色和群范围属于插件领域数据。

## 入站媒体处理流程

```text
QQ dispatch
  ↓
校验 account / chat / sender stable ID
  ↓
解析正文、@、引用和原始附件
  ↓
标准化 QQAttachmentInput
  ↓
校验 URL、大小、类型、重定向和 DNS
  ↓
下载并写入 staged attachment
  ↓
写入消息与 message_attachments 关系
  ↓
根据接收模式决定：记录 / 回复 / 丢弃
  ↓
构造 Agent 上下文
  ↓
按模型能力选择媒体输入方式
```

下载必须在 worker 或 Host 的受控边界完成，不能让 Agent 自己根据 QQ URL 随意发起网络请求。

推荐的失败降级文本：

```text
用户发送了一张图片：文件名 xxx.png，附件 ID xxx。
当前模型不支持直接查看图片；如果用户要求保存，可使用附件保存能力。
```

不应把带签名的原始 QQ 下载 URL 长期写入 Session、日志或前端响应。

## 引用消息处理流程

### 解析顺序

引用解析建议按以下优先级执行：

1. 读取协议提供的结构化 `message_reference` / `reference` / `quote`；
2. 读取 QQ 原生 `message_scene.ext` 中的引用消息索引；
3. 在 `msg_elements` 中按引用索引定位被引用消息；
4. 从引用节点提取发送人、正文和附件；
5. 如果只有引用文本，仍然创建 quote 结构；
6. 如果无法确认引用关系，不要猜测，保留当前消息正文并记录受限诊断信息。

### 引用附件处理

引用附件应使用和当前消息附件完全相同的下载与安全校验流程，并在关系表中标记 `role=quoted`。

当引用消息已经处理过并且附件仍然有效时，可以按以下条件复用物理文件：

- 命中稳定的源消息 ID；
- 附件类型、文件 ID 或内容指纹一致；
- 源附件未过期、未删除；
- 新的消息附件关系提交成功前，源附件不能被并发清理。

复用时应创建新的消息附件关系或新的附件元数据行，共享物理 `storage_key`，不要让两条消息直接共用一个可独立删除的记录。

### Agent 上下文格式

建议让引用内容和当前正文明确分块：

```text
[引用消息]
发送人：Alice
消息 ID：...
内容：请看看这张图
附件：图片 xxx.png（attachment_id=...）

[当前消息]
用户：这个是什么意思？
```

不要把引用正文直接拼接到用户正文中作为无标记文本，否则模型和网页展示都会难以区分消息边界。

## 模型输入策略

### 第一阶段：官方兼容模式

默认采用官方 `dsh-qqbot` 的思路：

- 图片、视频、文件先保存为附件；
- Agent 文本上下文注入媒体类型、名称和附件 ID/受控本地路径；
- 图片通过 `qqchat_describe_image` 或等价工具分析；
- 视频交给 `ffmpeg` 和文件工具；
- 文本文件可以直接读取内容；
- 无能力处理的媒体只提供结构化提示。

优点是对模型要求低，不会改变所有 QQ turn 的模型路由，也不会把大量二进制内容直接塞进上下文缓存。

### 第二阶段：图片原生输入

当当前模型明确声明支持 image modality 时，可以将图片附件转换为 DSH 官方 `ImageAttachmentRef`，构造 `ImageBlock` 发送给视觉模型。

必须满足：

- 模型路由声明支持图片；
- 图片格式为 PNG、JPEG、WebP 或 GIF 等受支持格式；
- 图片大小、尺寸和数量经过限制；
- 使用 durable attachment ref，不在 Session event 中放入 Buffer、Blob 或其他不可 JSON 序列化对象；
- 失败时退回图片工具或文本提示。

### 第三阶段：音频和视频

音频和视频暂不应伪装成 DSH 通用 `ContentBlock`，因为 DSH 的核心内容块主要覆盖文本、推理、图片和工具结果。应按实际模型路由能力使用供应商适配层：

- 语音优先转写成文本；
- 音频多模态由明确支持的 provider 处理；
- 视频先做时长、大小和格式检查，必要时压缩；
- 不支持原生视频的模型使用抽帧、转写或 `ffmpeg` 分析降级。

## 存储、清理和安全

### 下载安全

必须复用统一下载器，至少包含：

- 只允许 HTTPS；
- 连接前和重定向后都检查 URL；
- DNS 解析结果阻止回环、私网、链路本地和保留地址；
- 设置连接、读取和总超时；
- 限制单文件和单消息总大小；
- 不信任远端文件名和 Content-Type；
- 使用随机安全文件名；
- 写入临时文件后原子移动；
- 下载失败只记录脱敏错误。

### 生命周期

建议附件状态遵循：

```text
staged → attached → expired → deleted
       ↘ failed
```

- `staged`：已下载但尚未与消息提交关联；
- `attached`：已被消息或引用关系使用；
- `expired`：超过保留时间但仍保留元数据；
- `deleted`：物理文件已经删除；
- `failed`：下载或转换失败。

删除物理文件前必须按 `storage_key` 检查是否仍有其他存活引用，避免引用附件复用后误删共享文件。

### 日志和隐私

日志只记录附件类型、大小、失败原因和脱敏 ID，不记录：

- 原始 QQ 签名 URL；
- 图片、音频或文件内容；
- AppSecret、Token 和临时密钥；
- 用户发送的完整文件名（如其中可能包含敏感信息）。

## DSH Session 与 Web 展示

### Agent turn

触发 Agent 的消息应该继续使用 DSH 原生 `user/message`。媒体作为该消息的附件引用或结构化上下文注入，不要额外创建一套并行 AgentLoop。

不触发 Agent 的群消息仍可以使用现有的 `qqchat/message` log-only event，但 event payload 必须是 JSON 可序列化的摘要：

```json
{
  "text": "看看这个",
  "attachments": [{
    "id": "att_...",
    "kind": "image",
    "name": "image.png",
    "quoted": false
  }]
}
```

不能把 `Buffer`、文件句柄、SDK 原始对象或包含循环引用的 payload 直接写入 Session event。这正是此前 `agent/inbox/spliced` 非 JSON 数据错误的同类风险。

### DSH Web

官方 `dsh-qqbot` 主要负责媒体接收和 Agent 处理，没有单独实现 QQ 媒体 Client 渲染层。`dsh-qqchat` 的 Web 展示需要区分 Agent 消息和 log-only QQ transcript。

#### Agent 消息：DSH 原生 ImageBlock

当当前模型明确支持图片时，入站图片可以在安全下载并通过 `ctx.attachments.saveImage()` 后，作为同一条 DSH 用户消息的图片块：

```ts
createUserMessage({
  content: [
    { type: 'text', text: '用户发来一张图片' },
    { type: 'image', attachment: imageRef },
  ],
})
```

这样图片由 DSH Web 原生消息渲染，同时可以进入视觉模型。文本模型或附件服务不可用时，必须退回当前的文本提示和 `qqchat_describe_image` 工具路径，不能让整轮消息失败。

#### 静默消息：最小适配的附件读取 RPC

静默记录、未 @ 的群消息和其他不触发 Agent 的消息继续使用 `qqchat/message`，不能为了显示图片改成普通 `user/message`。自定义事件只携带可序列化的附件摘要：

```json
{
  "messageId": "db:123",
  "content": "看看这个",
  "attachments": [
    {
      "id": "qqatt-xxx",
      "kind": "image",
      "filename": "image.png",
      "sizeBytes": 123456
    }
  ]
}
```

如果 DSH 原生 Conversation renderer 无法直接消费 `qqchat/message` 中的附件引用，Client 才请求受保护的 `attachment/read` RPC。该 RPC 只负责把插件附件转换为 DSH 原生渲染器可接受的输入，不负责定义新的视觉风格。Host 必须在返回内容前校验：

- 当前 Session 是否属于对应 QQ 群或私聊；
- 附件是否属于当前 account、消息和会话范围；
- 附件是否过期或已删除；
- 媒体类型和返回大小是否允许；
- 不向 Client 返回 QQ 原始签名 URL。

返回值可以是短期 data URL 或一次性、短 TTL 的本地受保护 URL：

```json
{
  "mime": "image/png",
  "dataUrl": "data:image/png;base64,...",
  "expiresAt": 1750000000000
}
```

Client 优先调用 DSH 原生附件/图片渲染能力显示缩略图，点击动作和加载状态也复用 DSH 原生组件。只有 DSH 没有适用于自定义 transcript event 的渲染入口时，才提供一个无主题、无独立布局的薄适配层。读取失败、附件过期或超出限制时，复用 DSH 原生错误/空状态，不显示原始 URL。

#### 文件、音频和视频

这些媒体优先映射到 DSH 已有的附件或文件展示能力，不强行伪装成图片：

- 文件：文件名、大小、类型和后续下载/保存动作；
- 语音：时长、播放按钮和转写状态；
- 视频：时长、尺寸、缩略图或视频播放入口；
- 不支持浏览器播放的格式：显示媒体信息，并提示可使用 Agent 工具处理。

如果 DSH 原生展示能力没有覆盖某种媒体，才增加最小的播放/下载适配。播放和下载也必须通过有权限、短期有效的附件读取 RPC，不能把 QQ 原始 URL直接暴露给浏览器。

#### 引用消息

引用消息复用同一套附件组件，但视觉上保持独立：

```text
引用块
  ├─ 引用发送人
  ├─ 引用文本
  └─ 引用附件预览

当前消息气泡
  ├─ 当前正文
  └─ 当前附件预览
```

引用附件和当前消息附件都使用 DSH 原生附件引用查询；`quoted` 只控制消息关系，不改变 DSH 的附件展示样式或权限校验逻辑。

网页显示必须复用 DSH 原生消息和附件样式：

- 图片显示缩略图和可选的打开动作；
- 语音显示播放条；
- 视频显示文件卡片或预览入口；
- 文件显示名称、大小和下载/保存入口；
- 引用消息显示独立的引用块，正文和引用附件分开；
- 不在插件里重新实现 DSH 的气泡、输入框、Modal、图片预览、文件卡片或附件基础样式；
- 插件 Client 只负责把 QQ 消息、引用和附件转换成 DSH renderer 能消费的结构。

## 媒体显示实施 TODO

### A. DSH 原生能力确认

- [x] 确认当前 DSH 核心对 `ImageBlock`、`ImageAttachmentRef` 和附件引用的输入边界；
- [ ] DSH 当前未向插件公开完整的图片预览、放大、加载失败和空状态组件接口，QQChat 不复制这些基础组件；
- [ ] 确认 DSH 原生文件、音频、视频展示组件是否可以由插件复用；
- [ ] 确认自定义 `qqchat/message` event 是否能直接承载 DSH 原生附件引用；
- [x] 自定义 event 不能直接变成原生 `ImageBlock` 时，记录并采用最小适配边界，不复制 DSH 基础组件。

### B. Host 附件读取和权限

- [x] 增加 `attachment/read` RPC，仅接受 `attachmentId` 和当前 Session 上下文；
- [x] 校验 Session 是否映射到当前 QQ account、群或私聊；
- [x] 校验附件是否已经关联到当前消息、引用消息和会话范围；
- [x] 校验附件状态、过期时间和图片读取大小；媒体类型由入站媒体归一化和 DSH 图片附件服务共同校验；
- [x] 图片响应优先带回 DSH 原生 `ImageAttachmentRef`；仅为当前自定义 transcript 的图片预览提供受限 data URL；
- [ ] 当前实现尚未使用短 TTL URL，而是使用受大小限制的 RPC 响应 data URL；后续接入 DSH renderer 后应移除该 fallback；
- [x] 不把 QQ 原始签名 URL、AppSecret、Token 或本地文件路径返回给 Client；
- [x] 无权限、过期、删除和超限附件会被拒绝；损坏文件由 RPC 失败处理，不泄露存储路径。

### C. Agent 消息原生渲染

- [x] 当前模型支持图片时，将 QQ 图片保存为 DSH `ImageAttachmentRef`；
- [x] 在同一条 DSH `user/message` 中加入文本块和 `ImageBlock`；
- [x] 让 DSH Web 原生显示 Agent 图片，同时让视觉模型直接接收图片；
- [x] 当前模型不支持图片时，退回 `qqchat_describe_image` 工具；
- [x] 附件服务不可用、图片损坏或图片超限时，保留文本提示/工具 fallback，不让整轮媒体失败；
- [x] 保证所有 `ImageBlock` 在 Session event 发布前已经持久提交；
- [x] 保证 Session event 中不存在 Buffer、Blob、本地路径、SDK 原始对象或循环引用。

### D. 静默 QQ transcript 最小适配

- [x] 静默消息继续使用 `qqchat/message`，不为了显示媒体改成 `user/message`；
- [x] event 只携带 JSON 可序列化的附件摘要：ID、类型、文件名、大小、引用标记；
- [ ] 优先寻找 DSH 原生 renderer 消费自定义 event 附件的方式；
- [x] 当前没有自定义 event 的原生入口，因此增加无主题的薄适配层；
- [x] 薄适配层只负责附件引用转换和加载状态，不复制气泡、Modal、按钮或预览组件；
- [x] 图片加载通过受保护的附件读取 RPC，保持与 DSH 原生附件引用相同的权限边界；
- [x] 文件、语音、视频先使用统一的 DSH 风格媒体卡片承载元数据；原生播放器待 DSH 暴露公开入口后接入；
- [x] 加载失败、过期和无权限状态不显示原始 URL 或路径。

### E. 引用消息显示

- [x] 引用正文、引用发送人和当前正文保持独立数据结构；
- [x] 引用附件和当前消息附件复用同一套附件摘要、读取权限和显示组件；
- [x] `quoted` 只表示消息关系，不改变附件权限和渲染主题；
- [x] 引用图片使用与普通图片相同的图片预览路径；原生放大能力待 DSH renderer 公开接口后自动接入；
- [x] 引用文件、语音和视频使用与普通媒体相同的媒体卡片；原生播放器待公开接口后接入；
- [x] 引用附件复用时延长物理附件生命周期，避免引用关系指向已删除文件；
- [x] 多附件、无文本引用和引用失效均有稳定的摘要/空状态；嵌套引用按当前 QQ 引用结构扁平化处理。

### F. 媒体类型显示

- [x] 图片：受保护的缩略图读取、文件名和失败状态；Agent 消息走 DSH 原生图片块；
- [x] 文件：文件名、大小和类型元数据；下载/保存动作待 DSH 文件 renderer 公开后接入；
- [x] 语音：统一媒体卡片承载类型、文件名和大小；播放/转写待 DSH 原生能力公开后接入；
- [x] 视频：统一媒体卡片承载类型、文件名和大小；播放/尺寸入口待 DSH 原生能力公开后接入；
- [x] 不支持的格式：显示媒体元数据，并可引导使用 Agent 工具处理；
- [x] 不把媒体 URL 直接拼进消息正文；
- [x] 不让浏览器直接访问 QQ 临时签名 URL。

### G. 测试和验收

- [ ] Agent 图片消息在视觉模型下能同时被 Web 显示和模型理解；
- [ ] 文本模型收到图片时不会导致 Agent turn 失败；
- [ ] 静默群图片不唤醒 Agent，但能在 Web 中按原生风格显示；
- [ ] 普通附件和引用附件都能显示；
- [ ] Session、account、群、成员跨范围读取附件会被拒绝；
- [ ] 过期、删除、损坏和超限附件不会泄露 URL 或本地路径；
- [ ] 图片、文件、语音和视频的 UI 不引入独立插件主题；
- [ ] 覆盖 Session 归档、消息去重、附件复用和并发清理；
- [ ] 使用真实 DSH Web 构建产物验证，而不是只通过 TypeScript 检查。

推荐先完成 A–D，形成最小可用版本；再完成 E–G，补齐引用媒体和真实环境验收。

## 权限边界

媒体访问必须继承当前 QQ 会话的权限：

- 群成员是否能使用工具仍由现有工具权限控制；
- 媒体附件只能在所属 account、群、成员和 Session 范围内查询；
- 引用附件不能因为可被 Agent 读取而绕过群成员权限；
- 保存到文件库需要单独的保存动作，不应默认把所有 QQ 附件永久保存；
- Owner、普通群成员和私聊用户沿用现有 stable sender ID 判断。

## 分阶段实施计划

### Phase 0：审计和契约

- 增加附件、引用和媒体类型的 TypeScript 类型；
- 明确 QQ payload 的图片、文件、语音、视频和引用样本；
- 增加 normalize 单测；
- 确定附件保留时间、大小限制和模型能力读取方式。

### Phase 1：统一入站和持久化

- 增加 `attachments` 和 `message_attachments` 表；
- 标准化当前消息和引用消息附件；
- 实现安全下载和 staged 状态；
- 把附件摘要写入消息记录；
- 保留当前纯文本引用行为作为降级路径。

### Phase 2：图片处理

- 增加图片附件展示数据；
- 增加 `qqchat_describe_image`；
- 复用 DSH attachment 服务构造图片输入；
- 增加模型不支持图片、图片过大和下载失败的测试。

### Phase 3：文件、语音和视频

- 文本文件读取；
- 语音转写适配；
- `ffmpeg` 探测、抽帧和转码；
- 供应商能力路由；
- 媒体缓存和转码缓存清理。

### Phase 4：引用附件复用和完整 Web 展示

- 按稳定 QQ 消息 ID 查找历史附件；
- 处理共享 `storage_key` 的引用计数；
- 增加引用附件预览和关系展示；
- 覆盖多附件、嵌套引用、过期附件和并发清理场景。

## 验收标准

### 解析

- [ ] 普通文本、纯图片、图片加文本、文件、语音、视频都能生成标准化消息；
- [ ] `message_reference` 和 QQ 原生 `message_scene.ext` 都能解析；
- [ ] 引用正文、引用发送人和引用消息 ID 不会混入当前正文；
- [ ] 引用附件会被标记为 `quoted`。

### Agent

- [ ] 图片模型可用时图片能被真正分析；
- [ ] 图片模型不可用时不会导致 Agent turn 失败；
- [ ] 文件能被识别为附件而不是裸 URL；
- [ ] 语音可以转写或明确提示不支持；
- [ ] 媒体摘要和附件引用均为 JSON 可序列化数据；
- [ ] 不会再次出现 `session event ... non-JSON-serializable data`。

### 存储和安全

- [ ] 下载 URL、重定向和 DNS 都经过安全检查；
- [ ] 单文件、单消息和视频时长限制生效；
- [ ] 附件失败不会留下无限增长的临时文件；
- [ ] 删除消息或 Session 后，附件关系和物理文件按引用计数清理；
- [ ] 日志和前端不泄露签名 URL、Token 或文件原文。

### UI 和 QQ

- [ ] DSH Web 使用原生附件和消息样式；
- [ ] 引用块和当前正文视觉上分离；
- [ ] QQ 回复仍然能正确引用触发消息；
- [ ] 私聊、群聊、Owner 和普通成员沿用现有权限与 Session 隔离。

## 不建议的实现方式

- 不要把 QQ 原始 payload 直接作为 Session event 写入；
- 不要把 Buffer、Blob、文件句柄或 SDK 实例放进 Session；
- 不要只把媒体 URL 拼进正文然后期待模型自动下载；
- 不要用昵称判断引用人或附件归属；
- 不要为引用消息另建一套 AgentLoop；
- 不要让每条图片消息无条件切换视觉模型；
- 不要在没有引用计数的情况下直接删除共享附件文件；
- 不要在插件 Client 里重新实现 DSH 的基础附件和气泡组件。
