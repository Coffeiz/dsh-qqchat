const React = require('react')
const { useCallback, useEffect, useMemo, useRef, useState } = React
const h = React.createElement

const CHANNEL = '/qqchat'
const STYLE_ID = 'dsh-qqchat/client-ui'

const styles = `
.qqchatRoot{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit}
.qqchatToolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.qqchatTitle{display:flex;align-items:center;gap:10px;min-width:0}.qqchatTitleMark{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-weight:650}.qqchatTitleText{font-size:16px;font-weight:600}.qqchatSubtle{font-size:12px;color:var(--dsw-alias-label-secondary)}
.qqchatStatus{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}.qqchatDot{width:7px;height:7px;border-radius:999px;background:var(--dsw-alias-state-warn-primary)}.qqchatDot.online{background:var(--dsw-alias-state-success-primary)}.qqchatDot.error{background:var(--dsw-alias-state-error-primary)}
.qqchatButton{font:inherit;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:9px;min-height:34px;padding:0 12px;cursor:pointer;transition:background .15s ease,border-color .15s ease}.qqchatButton:hover{background:var(--dsw-alias-bg-layer-2)}.qqchatButton.primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-color:transparent}.qqchatButton.ghost{border-color:transparent;background:transparent}.qqchatButton.danger{color:var(--dsw-alias-state-error-primary)}.qqchatButton:disabled{opacity:.48;cursor:default}
.qqchatEmpty{flex:1;min-height:360px;display:grid;place-items:center;padding:36px}.qqchatConnect{width:min(460px,100%);display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px}.qqchatConnectIcon{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;font-size:26px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}.qqchatConnect h2{font-size:18px;margin:2px 0 0}.qqchatConnect p{max-width:380px;margin:0;color:var(--dsw-alias-label-secondary);line-height:1.65;font-size:13px}.qqchatQrCard{padding:16px;border-radius:16px;background:#fff;box-shadow:0 5px 24px rgba(0,0,0,.08)}.qqchatQrCard img{display:block;width:220px;height:220px}.qqchatQrHint{font-size:12px;color:var(--dsw-alias-label-secondary)}
.qqchatShell{flex:1;min-height:0;display:grid;grid-template-columns:220px minmax(360px,1fr) 310px;gap:0;margin-top:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.qqchatSidebar{min-width:0;border-right:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-2));display:flex;flex-direction:column}.qqchatSideHead{padding:14px 14px 10px;display:flex;justify-content:space-between;align-items:center}.qqchatGroupList{overflow:auto;padding:0 7px 10px}.qqchatGroup{width:100%;display:flex;align-items:center;gap:9px;padding:9px;border:0;border-radius:9px;background:transparent;color:inherit;text-align:left;cursor:pointer}.qqchatGroup:hover,.qqchatGroup.active{background:var(--dsw-alias-bg-layer-1)}.qqchatAvatar{width:32px;height:32px;flex:0 0 auto;border-radius:50%;display:grid;place-items:center;background:var(--dsw-alias-bg-overlay);font-size:12px;font-weight:600;overflow:hidden}.qqchatGroupMeta{min-width:0;flex:1}.qqchatGroupName{white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:13px;font-weight:540}.qqchatGroupInfo{white-space:nowrap;text-overflow:ellipsis;overflow:hidden;color:var(--dsw-alias-label-secondary);font-size:11px;margin-top:2px}
.qqchatConversation{min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}.qqchatConvHead{height:54px;box-sizing:border-box;padding:0 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}.qqchatConvName{font-size:14px;font-weight:600}.qqchatMessages{flex:1;min-height:0;overflow:auto;padding:18px 16px}.qqchatMessage{display:flex;gap:9px;margin:0 0 16px;align-items:flex-start}.qqchatMessage.outbound{flex-direction:row-reverse}.qqchatMsgBody{max-width:min(74%,620px);min-width:0}.qqchatMessage.outbound .qqchatMsgBody{text-align:right}.qqchatMsgMeta{display:flex;gap:7px;align-items:center;margin:0 2px 5px;font-size:11px;color:var(--dsw-alias-label-secondary)}.qqchatMessage.outbound .qqchatMsgMeta{justify-content:flex-end}.qqchatSenderId{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.72}.qqchatBubble{display:inline-block;max-width:100%;box-sizing:border-box;padding:9px 11px;border-radius:5px 13px 13px 13px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);text-align:left;white-space:pre-wrap;word-break:break-word;line-height:1.52;font-size:13px}.qqchatMessage.outbound .qqchatBubble{border-radius:13px 5px 13px 13px;background:var(--dsw-static-deepseek-50,var(--dsw-alias-bg-layer-2));border-color:var(--dsw-static-deepseek-200,var(--dsw-alias-border-l1))}.qqchatComposer{border-top:1px solid var(--dsw-alias-border-l1);padding:10px;display:flex;gap:8px;background:var(--dsw-alias-bg-layer-1)}.qqchatInput{flex:1;resize:none;min-height:38px;max-height:110px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:10px;padding:9px 10px;font:inherit;outline:none}.qqchatInput:focus{border-color:var(--dsw-static-deepseek-400,var(--dsw-alias-border-l2))}
.qqchatInspector{min-width:0;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column}.qqchatTabs{display:flex;gap:2px;padding:9px 9px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqchatTab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;padding:8px 9px 9px;cursor:pointer;border-bottom:2px solid transparent}.qqchatTab.active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}.qqchatInspectBody{overflow:auto;padding:13px;display:flex;flex-direction:column;gap:12px}.qqchatSection{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);overflow:hidden}.qqchatSectionHead{padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600}.qqchatDoc{padding:10px;white-space:pre-wrap;word-break:break-word;line-height:1.55;font-size:12px;color:var(--dsw-alias-label-secondary);max-height:210px;overflow:auto}.qqchatDoc.empty{font-style:italic;opacity:.7}.qqchatMember{display:flex;align-items:center;gap:8px;padding:8px 9px;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqchatMember:last-child{border-bottom:0}.qqchatMemberText{min-width:0}.qqchatMemberName{font-size:12px}.qqchatMemberId{font:10px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary);white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.qqchatSetting{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqchatSetting:last-child{border-bottom:0}.qqchatSetting strong{font-size:12px}.qqchatSetting p{font-size:11px;color:var(--dsw-alias-label-secondary);margin:3px 0 0;line-height:1.4}.qqchatSwitch{position:relative;width:34px;height:20px;flex:0 0 auto;border-radius:999px;border:0;background:var(--dsw-alias-bg-overlay);cursor:pointer}.qqchatSwitch.on{background:var(--dsw-alias-brand-primary)}.qqchatSwitch:after{content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .15s}.qqchatSwitch.on:after{transform:translateX(14px)}
.qqchatNotice{padding:9px 10px;border-radius:9px;font-size:12px;line-height:1.45;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}.qqchatError{color:var(--dsw-alias-state-error-primary)}.qqchatLoading{padding:24px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}
@media(max-width:1050px){.qqchatShell{grid-template-columns:190px minmax(360px,1fr)}.qqchatInspector{display:none}}@media(max-width:720px){.qqchatShell{grid-template-columns:1fr}.qqchatSidebar{display:none}.qqchatMessage .qqchatMsgBody{max-width:86%}}
`

function installStyles() {
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)) return () => {}
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-qqchat'
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = styles
  document.head.appendChild(tag)
  return () => tag.remove()
}

function formatTime(ms) {
  if (!ms) return ''
  try { return new Date(Number(ms)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

function initials(name, fallback = 'Q') {
  const text = String(name || fallback).trim()
  return text.slice(0, 2).toUpperCase()
}

async function callRpc(rpc, endpoint, payload = {}) {
  const result = await rpc.call(CHANNEL, endpoint, payload)
  if (!result || result.ok !== true) throw new Error(result?.error?.message || 'QQ Chat 请求失败')
  return result.value
}

function Toggle({ value, onChange, label }) {
  return h('button', { type: 'button', className: `qqchatSwitch${value ? ' on' : ''}`, 'aria-label': label, 'aria-pressed': !!value, onClick: () => onChange(!value) })
}

function MemoryDoc({ title, content }) {
  return h('section', { className: 'qqchatSection' },
    h('div', { className: 'qqchatSectionHead' }, h('span', null, title)),
    h('div', { className: `qqchatDoc${content ? '' : ' empty'}` }, content || '还没有形成这部分记忆。'))
}

function ConnectPanel({ rpc, onConnected }) {
  const [task, setTask] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef(null)

  const stopPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }, [])

  useEffect(() => stopPoll, [stopPoll])

  const begin = useCallback(async () => {
    setBusy(true); setError(''); stopPoll()
    try {
      const next = await callRpc(rpc, 'auth/start')
      setTask(next)
      pollRef.current = setInterval(async () => {
        try {
          const state = await callRpc(rpc, 'auth/poll', { taskId: next.taskId })
          if (state.status === 'success') {
            stopPoll(); setTask(null); onConnected()
          } else if (state.status === 'expired' || state.status === 'fail') {
            stopPoll(); setError(state.reason || '二维码已过期，请重新生成')
          }
        } catch (err) {
          stopPoll(); setError(err instanceof Error ? err.message : String(err))
        }
      }, 1400)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }, [rpc, onConnected, stopPoll])

  return h('div', { className: 'qqchatEmpty' },
    h('div', { className: 'qqchatConnect' },
      h('div', { className: 'qqchatConnectIcon' }, 'QQ'),
      h('h2', null, task ? '使用 QQ 扫码授权' : '连接 QQ 机器人'),
      h('p', null, task
        ? '在手机 QQ 中扫码并选择要授权的机器人。AppSecret 只在本机 Host 端解密和保存，不会进入浏览器。'
        : 'dsh-qqchat 使用 QQ 官方机器人授权。连接后可以接收私聊与群消息，并把需要回应的消息交给当前 DSH Agent。'),
      task?.qrDataUrl ? h('div', { className: 'qqchatQrCard' }, h('img', { src: task.qrDataUrl, alt: 'QQ 授权二维码' })) : null,
      task ? h('div', { className: 'qqchatQrHint' }, '二维码约 10 分钟有效') : null,
      error ? h('div', { className: 'qqchatNotice qqchatError' }, error) : null,
      h('button', { className: 'qqchatButton primary', disabled: busy, onClick: begin }, task ? '重新生成二维码' : (busy ? '正在创建…' : '扫码连接'))))
}

function GroupSidebar({ groups, selectedId, onSelect }) {
  const rows = groups.length === 0
    ? h('div', { className: 'qqchatLoading' }, '收到群消息后会出现在这里')
    : groups.map(group => h('button', {
        key: group.id,
        className: `qqchatGroup${Number(group.id) === Number(selectedId) ? ' active' : ''}`,
        onClick: () => onSelect(Number(group.id)),
      },
      h('div', { className: 'qqchatAvatar' }, initials(group.name, '群')),
      h('div', { className: 'qqchatGroupMeta' },
        h('div', { className: 'qqchatGroupName' }, group.name || `QQ群 ${group.platformGroupId?.slice(-6) || group.id}`),
        h('div', { className: 'qqchatGroupInfo' }, `${group.memberCount || 0} 人 · ${group.messageCount || 0} 条消息`),
      ),
    ))
  return h('aside', { className: 'qqchatSidebar' },
    h('div', { className: 'qqchatSideHead' },
      h('strong', { style: { fontSize: 12 } }, '群聊'),
      h('span', { className: 'qqchatSubtle' }, String(groups.length)),
    ),
    h('div', { className: 'qqchatGroupList' }, rows),
  )
}

function Conversation({ group, messages, draft, setDraft, onSend, sending }) {
  const viewport = useRef(null)
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
  }, [group?.id, messages.length])
  if (!group) return h('main', { className: 'qqchatConversation' }, h('div', { className: 'qqchatEmpty' }, h('div', { className: 'qqchatSubtle' }, '选择一个群聊查看消息')))
  return h('main', { className: 'qqchatConversation' },
    h('div', { className: 'qqchatConvHead' },
      h('div', null, h('div', { className: 'qqchatConvName' }, group.name || 'QQ群聊'), h('div', { className: 'qqchatSubtle' }, group.platformGroupId)),
      h('div', { className: 'qqchatSubtle' }, group.requiresAt ? '仅 @ 时回应' : '自动回应')),
    h('div', { ref: viewport, className: 'qqchatMessages' }, messages.map(message => {
      const outbound = message.direction === 'outbound'
      const name = outbound ? 'DSH Agent' : (message.senderName || '群友')
      return h('div', { key: message.id, className: `qqchatMessage${outbound ? ' outbound' : ''}` },
        h('div', { className: 'qqchatAvatar' }, outbound ? 'DS' : initials(name)),
        h('div', { className: 'qqchatMsgBody' },
          h('div', { className: 'qqchatMsgMeta' },
            h('span', null, name),
            !outbound && message.senderId ? h('span', { className: 'qqchatSenderId', title: message.senderId }, message.senderId.slice(-10)) : null,
            h('span', null, formatTime(message.createdAt))),
          message.quotedText ? h('div', { className: 'qqchatNotice', style: { marginBottom: 5 } }, `引用：${message.quotedText}`) : null,
          h('div', { className: 'qqchatBubble' }, message.content || '（空消息）')))
    })),
    h('form', { className: 'qqchatComposer', onSubmit: e => { e.preventDefault(); if (draft.trim()) onSend() } },
      h('textarea', { className: 'qqchatInput', value: draft, placeholder: '主动发送到这个群…', onChange: e => setDraft(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (draft.trim()) onSend() } } }),
      h('button', { className: 'qqchatButton primary', disabled: sending || !draft.trim(), type: 'submit' }, sending ? '发送中' : '发送')))
}

function Inspector({ group, members, memory, tab, setTab, onPatch, onReflect, reflecting }) {
  const [memberId, setMemberId] = useState(null)
  useEffect(() => {
    if (!members.some(member => Number(member.id) === Number(memberId))) {
      setMemberId(members[0] ? Number(members[0].id) : null)
    }
  }, [members, memberId])
  if (!group) return h('aside', { className: 'qqchatInspector' })
  const docs = memory || {}
  const selectedMember = members.find(member => Number(member.id) === Number(memberId)) || null

  let body = null
  if (tab === 'memory') {
    body = h(React.Fragment, null,
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        h('span', { className: 'qqchatSubtle' }, '按群范围隔离'),
        h('button', { className: 'qqchatButton ghost', onClick: onReflect, disabled: reflecting }, reflecting ? '整理中…' : '整理记忆'),
      ),
      h(MemoryDoc, { title: '群画像 · profile', content: docs.profile }),
      h(MemoryDoc, { title: '当前摘要 · summary', content: docs.summary }),
      h(MemoryDoc, { title: '长期群记忆 · memory', content: docs.memory }),
      h(MemoryDoc, { title: '近期沉淀 · daily', content: docs.daily }),
    )
  } else if (tab === 'members') {
    body = h(React.Fragment, null,
      h('div', { className: 'qqchatNotice' }, '身份始终使用 QQ stable sender ID。昵称只用于展示，不会拿昵称猜身份。成员记忆可跨同一 Bot 下的群复用。'),
      h('section', { className: 'qqchatSection' },
        h('div', { className: 'qqchatSectionHead' }, h('span', null, `群友 · ${members.length}`)),
        members.length === 0 ? h('div', { className: 'qqchatDoc empty' }, '还没有识别到群成员。') : members.map(member =>
          h('button', {
            key: member.id,
            className: 'qqchatMember',
            style: { width: '100%', border: 0, background: Number(member.id) === Number(memberId) ? 'var(--dsw-alias-bg-layer-2)' : 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' },
            onClick: () => setMemberId(Number(member.id)),
          },
            h('div', { className: 'qqchatAvatar' }, initials(member.displayName || '群友')),
            h('div', { className: 'qqchatMemberText' },
              h('div', { className: 'qqchatMemberName' }, member.displayName || '未命名群友'),
              h('div', { className: 'qqchatMemberId' }, member.platformUserId),
            ),
          )),
      ),
      selectedMember ? h(React.Fragment, null,
        h(MemoryDoc, { title: `${selectedMember.displayName || '群友'} · profile`, content: selectedMember.memory?.profile }),
        h(MemoryDoc, { title: '行为模式 · pattern', content: selectedMember.memory?.pattern }),
        h(MemoryDoc, { title: '成员摘要 · summary', content: selectedMember.memory?.summary }),
      ) : null,
    )
  } else {
    body = h('div', null,
      h('div', { className: 'qqchatSetting' },
        h('div', null, h('strong', null, '启用这个群'), h('p', null, '关闭后忽略这个群的所有消息。')),
        h(Toggle, { value: !!group.enabled, label: '启用群聊', onChange: value => onPatch({ enabled: value }) }),
      ),
      h('div', { className: 'qqchatSetting' },
        h('div', null, h('strong', null, '仅 @ 时回应'), h('p', null, '不开启时，只要收到群消息就允许 Agent 回应。')),
        h(Toggle, { value: !!group.requiresAt, label: '仅@回应', onChange: value => onPatch({ requiresAt: value }) }),
      ),
      h('div', { className: 'qqchatSetting' },
        h('div', null, h('strong', null, '阅读群消息'), h('p', null, '非 @ 消息也写入历史，用于之后的群上下文和记忆。')),
        h(Toggle, { value: !!group.readEnabled, label: '阅读群消息', onChange: value => onPatch({ readEnabled: value }) }),
      ),
    )
  }

  return h('aside', { className: 'qqchatInspector' },
    h('div', { className: 'qqchatTabs' },
      h('button', { className: `qqchatTab${tab === 'memory' ? ' active' : ''}`, onClick: () => setTab('memory') }, '群记忆'),
      h('button', { className: `qqchatTab${tab === 'members' ? ' active' : ''}`, onClick: () => setTab('members') }, '群友'),
      h('button', { className: `qqchatTab${tab === 'settings' ? ' active' : ''}`, onClick: () => setTab('settings') }, '设置'),
    ),
    h('div', { className: 'qqchatInspectBody' }, body),
  )
}

function QQChatSection({ rpc }) {
  const [status, setStatus] = useState(null)
  const [groups, setGroups] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [messages, setMessages] = useState([])
  const [memory, setMemory] = useState(null)
  const [tab, setTab] = useState('memory')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [reflecting, setReflecting] = useState(false)
  const [error, setError] = useState('')

  const refreshStatus = useCallback(async () => {
    try { setStatus(await callRpc(rpc, 'status')); setError('') } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [rpc])
  const refreshGroups = useCallback(async () => {
    try {
      const value = await callRpc(rpc, 'groups/list')
      const next = value.groups || []
      setGroups(next)
      setSelectedId(current => current ?? (next[0] ? Number(next[0].id) : null))
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [rpc])
  const refreshDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); setMessages([]); setMemory(null); return }
    try {
      const [groupValue, messageValue] = await Promise.all([
        callRpc(rpc, 'group/get', { groupId: id }),
        callRpc(rpc, 'group/messages', { groupId: id, limit: 140 }),
      ])
      setDetail(groupValue)
      setMemory(groupValue.groupMemory || null)
      setMessages(messageValue.messages || [])
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [rpc])

  useEffect(() => { void refreshStatus(); void refreshGroups() }, [refreshStatus, refreshGroups])
  useEffect(() => { void refreshDetail(selectedId) }, [selectedId, refreshDetail])
  useEffect(() => {
    const timer = setInterval(() => { void refreshStatus(); void refreshGroups(); if (selectedId) void refreshDetail(selectedId) }, 4500)
    return () => clearInterval(timer)
  }, [refreshStatus, refreshGroups, refreshDetail, selectedId])

  const account = status?.accounts?.find(item => item.enabled) || status?.accounts?.[0]
  const connected = !!account
  const gatewayStatus = account?.gatewayStatus || 'offline'
  const statusClass = gatewayStatus === 'online' ? 'online' : (gatewayStatus === 'error' ? 'error' : '')

  const patchGroup = useCallback(async patch => {
    if (!selectedId) return
    try { await callRpc(rpc, 'group/update', { groupId: selectedId, patch }); await refreshDetail(selectedId); await refreshGroups() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [rpc, selectedId, refreshDetail, refreshGroups])

  const send = useCallback(async () => {
    if (!selectedId || !draft.trim()) return
    setSending(true)
    try { await callRpc(rpc, 'group/send', { groupId: selectedId, content: draft.trim() }); setDraft(''); await refreshDetail(selectedId); await refreshGroups() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setSending(false) }
  }, [rpc, selectedId, draft, refreshDetail, refreshGroups])

  const reflect = useCallback(async () => {
    if (!selectedId) return
    setReflecting(true)
    try { await callRpc(rpc, 'group/reflect', { groupId: selectedId }); await refreshDetail(selectedId) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setReflecting(false) }
  }, [rpc, selectedId, refreshDetail])

  return h('div', { className: 'qqchatRoot' },
    h('div', { className: 'qqchatToolbar' },
      h('div', { className: 'qqchatTitle' }, h('div', { className: 'qqchatTitleMark' }, 'QQ'), h('div', null, h('div', { className: 'qqchatTitleText' }, 'QQ Chat'), h('div', { className: 'qqchatSubtle' }, '官方 QQ Bot · 群聊记忆'))),
      connected ? h('div', { className: 'qqchatStatus' }, h('span', { className: `qqchatDot ${statusClass}` }), h('span', null, gatewayStatus === 'online' ? '已连接' : gatewayStatus === 'connecting' ? '连接中' : '已授权，网关离线'), account?.appId ? h('span', { className: 'qqchatSenderId' }, account.appId) : null) : h('div', { className: 'qqchatStatus' }, h('span', { className: 'qqchatDot' }), '未连接')),
    error ? h('div', { className: 'qqchatNotice qqchatError', style: { marginTop: 12 } }, error) : null,
    !connected ? h(ConnectPanel, { rpc, onConnected: async () => { await refreshStatus(); await refreshGroups() } }) :
      h('div', { className: 'qqchatShell' },
        h(GroupSidebar, { groups, selectedId, onSelect: setSelectedId }),
        h(Conversation, { group: detail?.group, messages, draft, setDraft, onSend: send, sending }),
        h(Inspector, { group: detail?.group, members: detail?.members || [], memory, tab, setTab, onPatch: patchGroup, onReflect: reflect, reflecting })))
}

exports.inject = ['slots', 'connection']
exports.apply = function apply(ctx) {
  ctx.effect(() => installStyles(), 'dsh-qqchat: client styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'qqchat',
    order: 35,
    label: () => 'QQ Chat',
    inject: () => ({ rpc: ctx.connection.rpc }),
  }, QQChatSection))
}
