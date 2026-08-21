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
    match: (event: { type?: string; data?: QQEventData }) => event.type === 'qqchat/message' && event.data
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
