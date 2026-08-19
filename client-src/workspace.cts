import { React, h, useCallback, useEffect, useMemo, useState, useSyncExternalStore, call, Modal, short, initials, time } from './shared.cjs'
import type { ChatInfo, ChatItem, ComposerProps, QQEventData, QQNode, Rpc, SessionUtilityProps, SessionsService, SidebarActionProps } from './shared.cjs'

export function QQTranscriptNode({ node }: { node: QQNode }) {
  const data = node.data
  const outbound = data.direction === 'outbound'
  return h('div', { className: `qqTranscript${outbound ? ' out' : ''}` },
    h('div', { className: 'qqAvatar' }, outbound ? 'ME' : initials(data.senderName)),
    h('div', { className: 'qqTranscriptBody' }, h('div', { className: 'qqTranscriptMeta' }, outbound ? 'Owner' : `${data.senderName || 'QQ 用户'} · ${short(data.senderId)}`, ' · ', time(data.createdAt)), h('div', { className: 'qqBubble' }, data.quotedText && h('div', { className: 'qqQuote' }, data.quotedText), data.content)))
}

export function QQComposer({ matched, rpc }: ComposerProps & { rpc: Rpc }) {
  const [info, setInfo] = useState<ChatInfo | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void call<ChatInfo>(rpc, 'chat/info', { sessionId: matched.sessionId })
      .then(setInfo)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
  }, [matched.sessionId, rpc])
  const send = async () => {
    if (!info || !draft.trim()) return
    setBusy(true)
    try { await call(rpc, 'chat/send', { chatType: info.chatType, rowId: info.rowId, content: draft.trim() }); setDraft(''); setError('') } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  return h('div', { style: { width: '100%' } }, h('div', { className: 'qqComposer' }, h('textarea', { value: draft, placeholder: info ? `发送到 ${info.title}…` : '正在读取 QQ 会话…', onChange: (event: import('react').ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value), onKeyDown: (event: import('react').KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } } }), h('button', { type: 'button', className: 'qqBtn primary', disabled: busy || !draft.trim() || !info, onClick: () => void send() }, busy ? '发送中' : '发送')), h('div', { className: error ? 'qqError' : 'qqComposerHint' }, error || 'QQ Chat 会话：这里发送的内容直接发到 QQ，不会作为本地 DSH 用户提示词。'))
}

export function MemoryCard({ title, value }: { title: string; value: string }) {
  return h('section', { className: 'qqMemoryCard' }, h('h4', null, title), h('div', { className: 'qqMemoryDoc' }, value || '还没有形成这部分记忆。'))
}

export function QQSessionUtility({ sessionId, rpc }: SessionUtilityProps & { rpc: Rpc }) {
  const [info, setInfo] = useState<ChatInfo | null>(null)
  const [open, setOpen] = useState(false)
  const isQQSession = String(sessionId).startsWith('qqchat-')
  if (!isQQSession) return null

  const show = async () => {
    try {
      setInfo(await call<ChatInfo>(rpc, 'chat/info', { sessionId }))
      setOpen(true)
    } catch {
      // Host may still be reconciling a just-created Session.
    }
  }

  const memoryBody = info
    ? h(React.Fragment, null,
        h('div', { className: 'qqMemoryGrid' },
          h(MemoryCard, { title: '画像 · profile', value: info.memory.profile }),
          h(MemoryCard, { title: '摘要 · summary', value: info.memory.summary }),
          info.chatType === 'group'
            ? h(MemoryCard, { title: '长期记忆 · memory', value: info.memory.memory })
            : h(MemoryCard, { title: '行为模式 · pattern', value: info.memory.pattern }),
          info.chatType === 'group'
            ? h(MemoryCard, { title: '近期沉淀 · daily', value: info.memory.daily })
            : null,
        ),
        info.chatType === 'group'
          ? h('div', { className: 'qqMemberList' },
              h('div', { className: 'qqChatSection' }, `群友 · ${info.members.length}`),
              ...info.members.map(member => h('div', { key: member.id, className: 'qqMemberRow' },
                h('div', { className: 'qqAvatar' }, initials(member.displayName)),
                h('div', { className: 'qqGrow' },
                  h('div', null, member.displayName || '群友'),
                  h('div', { className: 'qqMemberId' }, member.platformUserId),
                ),
              )),
            )
          : null,
      )
    : null

  return h(React.Fragment, null,
    h('button', { type: 'button', className: 'qqHeaderButton', onClick: () => void show() }, 'QQ 记忆'),
    open && info
      ? h(Modal, {
          title: info.chatType === 'group' ? `${info.title} · 群记忆` : `${info.title} · 用户记忆`,
          onClose: () => setOpen(false),
        }, memoryBody)
      : null,
  )
}

export function QQSidebarAction({ wide, rpc, sessions }: SidebarActionProps) {
  const [open, setOpen] = useState(false)
  const [chats, setChats] = useState<ChatItem[]>([])
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  useSyncExternalStore(
    listener => sessions.list.subscribe(listener),
    () => sessions.list.getSnapshot(),
  )

  const load = useCallback(async () => {
    try {
      setChats((await call<{ chats: ChatItem[] }>(rpc, 'chats/list')).chats || [])
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [rpc])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? chats.filter(chat => `${chat.displayName} ${chat.platformId}`.toLowerCase().includes(q)) : chats
  }, [chats, query])
  const groups = visible.filter(chat => chat.chatType === 'group')
  const directs = visible.filter(chat => chat.chatType === 'c2c')

  const openChat = async (chat: ChatItem) => {
    const key = `${chat.chatType}:${chat.rowId}`
    setBusyId(key)
    try {
      const result = await call<{ sessionId: string }>(rpc, 'chat/ensure', {
        chatType: chat.chatType,
        rowId: chat.rowId,
      })
      await waitForSession(sessions, result.sessionId)
      sessions.open(result.sessionId)
      setOpen(false)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId('')
    }
  }

  const rows = (items: ChatItem[]) => items.map(chat => {
    const key = `${chat.chatType}:${chat.rowId}`
    return h('button', {
      type: 'button',
      key,
      className: 'qqChatRow',
      disabled: busyId === key,
      onClick: () => void openChat(chat),
    },
    h('div', { className: 'qqAvatar' }, chat.chatType === 'group' ? '群' : initials(chat.displayName)),
    h('div', { className: 'qqGrow' },
      h('div', { className: 'qqEllipsis' }, chat.displayName),
      h('div', { className: 'qqMuted qqEllipsis' }, `${short(chat.platformId)} · ${chat.messageCount} 条消息`),
    ),
    h('span', { className: 'qqBadge' }, chat.chatType === 'group' ? '群聊' : '私聊'))
  })

  const picker = open
    ? h(Modal, { title: 'QQ Chat', onClose: () => setOpen(false) },
        h('div', { className: 'qqChatToolbar' },
          h('input', {
            className: 'qqSearch',
            value: query,
            placeholder: '搜索群聊或私聊…',
            onChange: (event: import('react').ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
          }),
          h('button', { type: 'button', className: 'qqBtn', onClick: () => void load() }, '刷新'),
        ),
        error ? h('div', { className: 'qqError' }, error) : null,
        h('div', { className: 'qqChatSection' }, `群聊 · ${groups.length}`),
        groups.length ? rows(groups) : h('div', { className: 'qqMuted' }, '还没有群聊记录。'),
        h('div', { className: 'qqChatSection' }, `私聊 · ${directs.length}`),
        directs.length ? rows(directs) : h('div', { className: 'qqMuted' }, '还没有私聊记录。'),
      )
    : null

  return h(React.Fragment, null,
    h('button', {
      type: 'button',
      className: 'qqFootButton',
      title: 'QQ Chat',
      onClick: () => setOpen(true),
    },
    h('span', { className: 'qqFootIcon' }, 'QQ'),
    wide ? h('span', null, 'QQ Chat') : null),
    picker,
  )
}

export async function waitForSession(sessions: SessionsService, sessionId: string): Promise<void> {
  if (sessions.list.getSnapshot().byId[sessionId]) return
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + 3000
    const check = () => {
      if (sessions.list.getSnapshot().byId[sessionId]) { cleanup(); resolve(); return }
      if (Date.now() >= deadline) { cleanup(); reject(new Error('DSH 尚未把 QQ session 加入工作区列表，请稍后重试')); return }
    }
    const dispose = sessions.list.subscribe(check)
    const timer = setInterval(check, 80)
    const cleanup = () => { dispose(); clearInterval(timer) }
    check()
  })
}

export function createQQMessageDefinition(): Record<string, unknown> {
  return {
    kind: 'qqchat-message',
    target: 'chat',
    match: (event: { type?: string; data?: QQEventData }) => event.type === 'qqchat/message' && event.data ? { id: event.data.messageId, role: 'start' } : null,
    start: (_context: unknown, match: { event: { data: QQEventData } }) => match.event.data,
    update: (context: { state?: QQEventData }) => context.state,
    buildViewNode: (context: { key: string; id: string; state?: QQEventData; start?: { event: { seq: number }; location?: unknown }; matches?: Array<{ event: { seq: number }; location?: unknown }> }) => {
      if (!context.state) return null
      const first = context.start ?? context.matches?.[0]
      return { key: context.key, kind: 'qqchat-message', id: context.id, target: 'chat', anchorSeq: first?.event.seq ?? 0, location: first?.location ?? { kind: 'unresolved' }, visibility: 'visible', data: context.state }
    },
  }
}
