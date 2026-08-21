# QQ 私聊流式传输设计方案

## 文档目的

本文记录 `dsh-qqchat` 当前采用的 QQ C2C 私聊流式回复方案，并总结已经遇到的故障，方便后续将同一套机制复用到咕咕或其他 QQ Bot 适配器中。

本文讨论的是 QQ 官方 `stream_messages` 接口，不是 DSH Web 的前端打字机效果。QQ 负责更新客户端中的一条消息，DSH 负责产生文本增量，插件负责把增量可靠地转成 QQ 流式帧。

## 结论先行

推荐采用以下结构：

```text
DSH assistant/chunk
  -> StreamingWriter
  -> 累计完整文本
  -> 节流定时器
  -> 串行发送队列
  -> QQ POST /v2/users/{openid}/stream_messages
  -> 首帧返回 stream_msg_id
  -> 后续 replace 更新
  -> 最终 DONE 帧
```

关键原则：

1. 只对 C2C 私聊启用，群聊继续使用普通发送。
2. 每一帧发送当前完整文本，使用 `input_mode: replace`。
3. 同一条流式消息的所有帧共用 `msg_seq`，但不同流式会话要生成新的序列。
4. 后续帧必须在真正发送前读取首帧返回的 `stream_msg_id`。
5. 所有 HTTP 请求必须串行，不能让多个更新同时发出。
6. 流式失败时：尚未成功发送任何帧才允许降级为普通消息；已经发送过部分内容时不能再发送完整文本，避免重复。

## 官方协议

QQ 官方接口为：

```text
POST /v2/users/{user_openid}/stream_messages
```

该接口只适用于 C2C 私聊。官方 Node SDK 的 `StreamSession` 使用 `replace` 模式，把“截至当前为止的完整文本”作为 `content_raw` 发送；首帧成功后保存返回的消息 ID，后续请求携带 `stream_msg_id`，最后使用 `input_state: 10` 结束流式消息。

参考实现：

- [官方 dsh-qqbot outbound-buffer](https://raw.githubusercontent.com/tencent-connect/dsh-qqbot/main/src/transport/outbound-buffer.ts)
- [官方 dsh-qqbot streaming-writer](https://raw.githubusercontent.com/tencent-connect/dsh-qqbot/main/src/transport/streaming-writer.ts)
- [官方 QQ Node SDK streaming](https://raw.githubusercontent.com/tencent-connect/qqbot-nodejs/main/src/streaming.ts)
- [官方 QQ Node SDK 消息 API](https://raw.githubusercontent.com/tencent-connect/qqbot-nodejs/main/src/protocol/api/messages.ts)

### 请求字段

典型请求结构如下：

```json
{
  "input_mode": "replace",
  "input_state": 1,
  "content_type": "text",
  "content_raw": "当前已经生成的完整文本",
  "event_id": "入站消息 ID",
  "msg_id": "入站消息 ID",
  "msg_seq": 12345,
  "index": 0
}
```

后续帧增加：

```json
{
  "stream_msg_id": "首帧响应返回的流式消息 ID"
}
```

结束帧使用 `input_state: 10`，并继续携带最后的完整文本和 `stream_msg_id`。

字段约束：

| 字段 | 规则 |
| --- | --- |
| `input_mode` | 使用 `replace`，后续内容替换上一帧 |
| `input_state` | `1` 表示生成中，`10` 表示结束 |
| `content_raw` | 当前完整文本，不是本次增量 |
| `msg_seq` | 同一流内保持一致；新的流要生成新的值 |
| `index` | 从 `0` 开始递增，不能重复或跳号 |
| `msg_id` / `event_id` | 用入站消息或事件 ID 关联被动回复 |
| `stream_msg_id` | 只有首帧响应成功后才能获得，后续帧必须使用 |

## 推荐组件设计

### 1. StreamingWriter

`StreamingWriter` 是面向 DSH 的适配层，接收文本增量：

```ts
writer.append(delta)
await writer.finish()
writer.abort()
```

内部状态建议包括：

```ts
interface StreamingWriterState {
  fullText: string
  lastSentText: string
  streamMsgId?: string
  msgSeq: number
  nextIndex: number
  sentFrameCount: number
  finished: boolean
  failed: boolean
  pendingTimer?: ReturnType<typeof setTimeout>
  chain: Promise<void>
}
```

### 2. 累计全文，不累计分片

DSH 的 `assistant/chunk` 通常是增量文本：

```text
"你好"
"，这里是"
"完整回复"
```

插件必须先累计：

```text
"你好，这里是完整回复"
```

再将累计结果作为 `replace` 请求发送。不能把每个 delta 直接作为 `append` 请求发送，除非已经严格实现并验证 QQ 的 append 语义、序列和首帧关联。

### 3. 节流

不能每个 token 发一次 HTTP 请求，否则很容易触发 QQ 频率限制或造成客户端更新抖动。

建议：

- 默认 500ms 一次；
- 不低于 300ms；
- 使用固定间隔 throttle，不使用持续输出时永远不触发的 debounce；
- 结束时取消定时器并立即发送最终内容。

### 4. 串行队列

所有更新进入同一个 Promise 队列：

```ts
chain = chain.then(async () => {
  const body = buildBodyFromCurrentState()
  const response = await send(body)
  updateStreamId(response)
})
```

重要的是：请求体必须在队列任务真正执行时构造，而不是在入队时构造。这样首帧返回 `stream_msg_id` 后，排队中的后续帧才能读取到最新 ID。

## 生命周期

### 开始

收到第一个文本增量时创建 Writer，但可以延迟到第一个 throttle flush 时才调用 QQ 接口。

### 更新

```text
append(delta)
  -> fullText += delta
  -> 启动或等待 throttle timer
  -> enqueue(GENERATING, fullText)
  -> 首帧成功后保存 stream_msg_id
```

### 结束

```text
finish(finalText)
  -> 取消 timer
  -> fullText = finalText
  -> 等待已有更新队列
  -> 发送最终 GENERATING 帧（必要时）
  -> 发送 DONE 帧
  -> 清理 Writer
```

### 中止

```text
abort()
  -> 标记 finished
  -> 取消 timer
  -> 不再接受新的 delta
  -> 如果已打开流，尽力发送 complete/关闭请求
```

## 降级策略

流式不是回复成功的唯一路径。发送逻辑必须记录 `sentFrameCount`：

| 状态 | 处理 |
| --- | --- |
| 首帧尚未成功 | 记录警告，使用普通文本/Markdown 发送完整回复 |
| 已成功发送部分流式内容 | 不发送完整普通消息，避免用户收到重复回复 |
| DONE 帧失败但已有内容 | 记录错误，不重复发送全文 |
| 模型没有文本输出 | 不创建流，沿用插件已有的空回复处理 |
| 设置关闭 | 完全跳过流式接口，直接使用普通发送 |

普通发送也要继续使用已有的 Markdown/纯文本兼容格式和主动发送回退逻辑。

## 设置设计

建议将开关放在私聊消息设置中，而不是群聊设置中：

```ts
interface QQChatRuntimeSettings {
  directStreamingEnabled: boolean
}
```

推荐默认值：`true`，保持官方流式能力；如果目标客户端普遍看不到流式效果，也可以在产品层默认关闭。

设置说明应明确：

> 私聊流式回复使用 QQ 官方流式接口逐步更新消息；部分 QQ 客户端可能看不到流式效果。关闭后使用普通一次性消息发送。

群聊不应被这个开关影响，因为 QQ 官方 `stream_messages` 方案只覆盖 C2C 私聊。

## 已遇到的问题与修复

### 问题一：所有流式会话使用相同的 `msg_seq`

现象：

```text
QQ API HTTP 400 code=40054005
消息被去重，请检查请求msgseq
```

早期实现使用“入站消息 ID → 本地序列”的方式生成流式 `msg_seq`。由于每个新消息的初始值都是 `1`，不同流式会话可能反复使用相同序列，增加了 QQ 判重风险。

修复：

- 为每个新的流式会话生成新的 16 位 `msg_seq`；
- 同一流式会话的所有帧继续共用该值；
- 在进程内用单调序列避免并发流撞值；
- 保留跨会话测试。

注意：`msg_seq` 的作用域必须结合实际 QQ API 行为验证，不能简单假设“每个入站消息都从 1 开始安全”。

### 问题二：后续帧没有带上 `stream_msg_id`

现象：

- 首帧可能成功；
- 后续请求报 `40054005`；
- 日志表现为流式失败并触发降级。

根因：请求体在进入 Promise 队列时就已经构造完成。当多个更新快速进入队列时，首帧的 HTTP 响应还没有返回，后续请求体中的 `stream_msg_id` 仍然为空。

错误模式：

```ts
// 错误：入队时读取 streamMsgId
const body = { stream_msg_id: streamMsgId }
chain = chain.then(() => send(body))
```

正确模式：

```ts
// 正确：执行队列任务时读取最新 streamMsgId
chain = chain.then(async () => {
  const body = { stream_msg_id: streamMsgId }
  const response = await send(body)
  streamMsgId = response.id
})
```

这是迁移到咕咕时最需要保留的实现细节之一。

### 问题三：流式失败后重复发送

如果已经有一帧成功显示，又在异常处理中把完整回复作为普通消息再发送，用户会看到重复内容。

修复：

```ts
if (writer.sentFrameCount === 0) {
  await sendNormal(fullText)
} else {
  logFailure()
}
```

## 当前实现核对清单

以下是当前 `dsh-qqchat` 对官方方案的落地情况：

- [x] 使用 QQ 官方 `stream_messages` 请求和响应字段；
- [x] 仅为 C2C 私聊创建流式 Writer；
- [x] 从 DSH assistant text-delta 累计全文；
- [x] 使用 `replace`，不把 delta 当作独立消息；
- [x] 为每个流生成新的 `msg_seq`；
- [x] `index` 从 0 开始严格递增；
- [x] 首帧响应后再读取和保存 `stream_msg_id`；
- [x] 所有请求通过串行队列；
- [x] 使用节流减少更新频率；
- [x] 对发送失败区分“尚未发送”和“已经发送部分”；
- [x] 提供流式开关和普通发送回退；
- [x] 使用模拟 HTTP 测试覆盖首帧、后续帧、结束帧和队列竞态；
- [ ] 真实 QQ 手机端和桌面端分别验证所有客户端的可见性；
- [x] 日志只记录 `msg_seq`、`index`、是否有 `stream_msg_id` 等定位信息，不记录完整敏感正文。

### 已知故障：QQ `40054005` 去重

QQ 会在 `msg_seq` 重复或流式上下文不完整时返回 `40054005`。当前实现为每个流生成新的序列号，并在首帧成功后把返回的 `stream_msg_id` 传给后续帧；如果流式首帧尚未成功，运行时会回退到普通发送，避免用户收不到回复。如果已经成功显示过部分流式内容，插件不会再发送一条完整重复消息，而是记录失败并结束本轮。

## 测试矩阵

至少覆盖：

| 场景 | 预期 |
| --- | --- |
| 短回复 | 首帧 + DONE 帧，内容一致 |
| 持续输出 | 按 throttle 更新，内容单调增长 |
| 快速连续 delta | 后续帧带首帧 `stream_msg_id`，无并发请求 |
| 多次私聊 | 不同流使用不同 `msg_seq` |
| 首帧失败 | 普通发送一次，不重复 |
| 中途失败 | 不发送完整重复消息 |
| 429/50002 | 按退避策略重试，超过次数后降级或报错 |
| 空回复 | 不发送空流式消息 |
| 设置关闭 | 不访问 `stream_messages` |
| 群聊 | 不访问 `stream_messages` |

## 当前实现位置

在 `dsh-qqchat` 中：

- QQ 流式 API：`src/gateway/api.ts`
- DSH 增量接收：`src/session/agent-bridge.ts`
- 私聊/群聊路由与降级：`src/session/runtime.ts`
- 设置类型：`src/types.ts`
- 设置持久化：`src/storage/db.ts`
- 设置 RPC：`src/transport/rpc.ts`
- Web 设置页面：`client-src/settings.cts`
- 协议测试：`tests/api.test.ts`
