import { React, h, useEffect, useState, call, getQQRpc, Modal, Button, time } from './shared.cjs'
import type { ChatInfo, ChatMember, QQAttachmentData, QQEventData, QQNode, Rpc, SessionUtilityProps } from './shared.cjs'

function formatBytes(value: number): string {
  if (!value || value < 1024) return `${value || 0} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function AttachmentCards({ attachments, sessionId }: { attachments?: QQAttachmentData[]; sessionId?: string }) {
  if (!attachments?.length) return null
  const rpc = getQQRpc()
  const [previews, setPreviews] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!rpc || !sessionId) return
    let cancelled = false
    void Promise.all(attachments.filter(item => item.kind === 'image').map(async item => {
      try {
        const result = await call<{ dataUrl?: string }>(rpc, 'attachment/read', { sessionId, attachmentId: item.id })
        return result.dataUrl ? [item.id, result.dataUrl] as const : null
      } catch { return null }
    })).then(items => {
      if (cancelled) return
      setPreviews(current => ({ ...current, ...Object.fromEntries(items.filter((item): item is readonly [string, string] => Boolean(item))) }))
    })
    return () => { cancelled = true }
  }, [attachments, rpc, sessionId])
  return h('div', { className: 'qqMediaList' }, ...attachments.map(attachment =>
    h('div', { className: 'qqMediaCard', key: `${attachment.id}:${attachment.quoted ? 'quote' : 'own'}` },
      h('span', { className: 'qqMediaKind' }, attachment.kind === 'image' ? '图片' : attachment.kind === 'video' ? '视频' : attachment.kind === 'voice' || attachment.kind === 'audio' ? '语音' : '文件'),
      previews[attachment.id] ? h('img', { className: 'qqMediaPreview', src: previews[attachment.id], alt: attachment.filename }) : null,
      h('span', { className: 'qqMediaName' }, attachment.filename),
      h('span', { className: 'qqMediaSize' }, formatBytes(attachment.sizeBytes)),
      attachment.quoted ? h('span', { className: 'qqMediaQuoted' }, '引用') : null)))
}

export function QQTranscriptNode({ node }: { node: QQNode }) {
  const data = node.data
  const outbound = data.direction === 'outbound' || data.isOwner === true
  const hasQuote = Boolean(data.quote) || Boolean(data.quotedText)
  const quoteText = data.quote?.text || data.quotedText || ''
  return h('div', { className: `qqTranscript${outbound ? ' out' : ''}` },
    h('div', { className: 'qqTranscriptBody' },
      !data.isOwner && h('div', { className: 'qqTranscriptMeta' }, data.senderName || (outbound ? 'Owner' : 'QQ 用户'), ' · ', time(data.createdAt)),
      hasQuote && h('div', { className: 'qqQuote', title: quoteText },
        h('div', { className: 'qqQuoteLabel' }, '引用消息'),
        quoteText ? h('div', { className: 'qqQuoteText' }, quoteText) : null,
        data.quote?.senderName ? h('div', { className: 'qqQuoteSender' }, data.quote.senderName) : null,
        h(AttachmentCards, { attachments: data.quote?.attachments, sessionId: data.sessionId })),
      h('div', { className: 'qqBubble' }, data.content),
      h(AttachmentCards, { attachments: data.attachments, sessionId: data.sessionId })))
}

export function MemoryCard({ title, value }: { title: string; value: string }) {
  return h('section', { className: 'qqMemoryCard' },
    h('h4', null, title),
    h('div', { className: 'qqMemoryDoc' }, value || '还没有形成这部分记忆。'))
}

function MemberMemory({ member, onBack }: { member: ChatMember; onBack(): void }) {
  return h(React.Fragment, null,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 } },
      h(Button, { size: 'sm', variant: 'outline', onClick: onBack }, '返回群记忆'),
      h('div', { className: 'qqGrow' },
        h('div', { className: 'qqsTitle' }, member.displayName || '群友'),
        h('div', { className: 'qqMemberId' }, member.platformUserId))),
    h('div', { className: 'qqMemoryGrid' },
      h(MemoryCard, { title: '成员画像 · profile', value: member.memory.profile }),
      h(MemoryCard, { title: '行为模式 · pattern', value: member.memory.pattern }),
      h(MemoryCard, { title: '成员摘要 · summary', value: member.memory.summary }),
      h(MemoryCard, { title: '成员长期记忆 · memory', value: member.memory.memory })))
}

function QQSendFile({ sessionId, rpc, voice = false }: SessionUtilityProps & { rpc: Rpc; voice?: boolean }) {
  const label = voice ? '语音' : '文件'
  const limit = voice ? 20 : 30
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState('')
  const send = async () => {
    if (!file || sending) return
    setSending(true)
    setStatus('正在发送…')
    try {
      if (!file.size || file.size > limit * 1024 * 1024) throw new Error(`${label}大小必须在 1 字节到 ${limit} MiB 之间`)
      const info = await call<ChatInfo>(rpc, 'chat/info', { sessionId })
      const { id } = await call<{ id: string }>(rpc, 'chat/upload/start', {
        chatType: info.chatType, rowId: info.rowId, filename: file.name, size: file.size, voice,
      })
      try {
        const partSize = 128 * 1024
        for (let offset = 0; offset < file.size; offset += partSize) {
          const bytes = new Uint8Array(await file.slice(offset, offset + partSize).arrayBuffer())
          await call(rpc, 'chat/upload/part', { id, offset, bytes: Array.from(bytes) })
        }
        await call(rpc, 'chat/upload/finish', { id })
      } catch (error) {
        void call(rpc, 'chat/upload/cancel', { id }).catch(() => {})
        throw error
      }
      setFile(null)
      setStatus(`${label}已发送。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '文件发送失败。')
    } finally {
      setSending(false)
    }
  }
  return h(React.Fragment, null,
    h(Button, { size: 'sm', variant: 'outline', onClick: () => setOpen(true) }, `发送${label}`),
    open ? h(Modal, { title: `向当前 QQ 会话发送${label}`, onClose: () => {
      if (!sending) { setOpen(false); setFile(null); setStatus('') }
    } }, h('div', null,
      h('input', { type: 'file', accept: voice ? 'audio/*,.silk,.amr' : undefined, 'aria-label': `选择本地${label}`, disabled: sending,
        onChange: (event: { currentTarget: HTMLInputElement }) => {
          setFile(event.currentTarget.files?.[0] ?? null)
          setStatus('')
        } }),
      h(Button, { disabled: !file || sending, onClick: () => void send() }, '发送'),
      h('p', { role: 'status' }, status))) : null)
}

export function QQSessionUtility({ sessionId, rpc }: SessionUtilityProps & { rpc: Rpc }) {
  const [info, setInfo] = useState<ChatInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedMember, setSelectedMember] = useState<ChatMember | null>(null)
  const isQQSession = String(sessionId).startsWith('qqchat-')
  if (!isQQSession) return null

  const show = async () => {
    try {
      setInfo(await call<ChatInfo>(rpc, 'chat/info', { sessionId }))
      setSelectedMember(null)
      setOpen(true)
    } catch {
      // Host may still be reconciling a just-created Session.
    }
  }

  const memoryBody = info
    ? selectedMember
      ? h(MemberMemory, { member: selectedMember, onBack: () => setSelectedMember(null) })
      : h(React.Fragment, null,
          h('div', { className: 'qqMemoryGrid' },
            h(MemoryCard, { title: '画像 · profile', value: info.memory.profile }),
            h(MemoryCard, { title: '摘要 · summary', value: info.memory.summary }),
            info.chatType === 'group'
              ? h(MemoryCard, { title: '长期记忆 · memory', value: info.memory.memory })
              : h(MemoryCard, { title: '行为模式 · pattern', value: info.memory.pattern }),
            info.chatType === 'group'
              ? h(MemoryCard, { title: '近期沉淀 · daily', value: info.memory.daily })
              : null),
          info.chatType === 'group'
            ? h('div', { className: 'qqMemberList' },
                h('div', { className: 'qqChatSection' }, `群友 · ${info.members.length} · 点击查看成员记忆`),
                ...info.members.map(member => h('button', {
                  type: 'button',
                  key: member.id,
                  className: 'qqMemberRow',
                  onClick: () => setSelectedMember(member),
                  style: { width: '100%', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' },
                },
        h('div', { className: 'qqGrow' },
          h('div', null, member.displayName || '群友'),
          member.aliases?.length ? h('div', { className: 'qqMemberId' }, `历史昵称：${member.aliases.join('、')}`) : null,
          member.nicknames?.length ? h('div', { className: 'qqMemberId' }, `群内称呼：${member.nicknames.join('、')}`) : null),
                h('span', { className: 'qqBadge' }, '查看记忆'))))
            : null)
    : null

  return h(React.Fragment, null,
    h(QQSendFile, { key: String(sessionId), sessionId, rpc }),
    h(QQSendFile, { key: `voice:${sessionId}`, sessionId, rpc, voice: true }),
    h(Button, { size: 'sm', variant: 'outline', onClick: () => void show() }, 'QQ 记忆'),
    open && info
      ? h(Modal, {
          title: selectedMember
            ? `${selectedMember.displayName || '群友'} · 成员记忆`
            : info.chatType === 'group' ? `${info.title} · 群记忆` : `${info.title} · 用户记忆`,
          onClose: () => { setOpen(false); setSelectedMember(null) },
        }, memoryBody)
      : null)
}

export function createQQMessageDefinition(): Record<string, unknown> {
  return {
    kind: 'qqchat-message',
    target: 'chat',
    match: (event: { type?: string; data?: QQEventData }) => (event.type === 'plugin:qqchat/message' || event.type === 'qqchat/message') && event.data
      ? { id: event.data.messageId, role: 'start' }
      : null,
    start: (_context: unknown, match: { event: { data: QQEventData } }) => match.event.data,
    update: (context: { state?: QQEventData }) => context.state,
    buildViewNode: (context: {
      key: string
      id: string
      state?: QQEventData
      start?: { event: { seq: number }; location?: unknown }
      matches?: Array<{ event: { seq: number }; location?: unknown }>
    }) => {
      if (!context.state) return null
      const first = context.start ?? context.matches?.[0]
      return {
        key: context.key,
        kind: 'qqchat-message',
        id: context.id,
        target: 'chat',
        anchorSeq: first?.event.seq ?? 0,
        location: first?.location ?? { kind: 'unresolved' },
        visibility: 'visible',
        data: context.state,
      }
    },
  }
}
