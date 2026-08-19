const React: typeof import('react') = require('react')
const { useCallback, useEffect, useMemo, useState } = React
const h = React.createElement

type Tab = 'memory' | 'members' | 'settings'
type RpcResult<T> = { ok: true; value: T } | { ok: false; error?: { message?: string } }
interface Rpc { call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<unknown>> }
interface Ctx {
  connection: { rpc: Rpc }
  effect(fn: () => (() => void) | void, label: string): unknown
  slots: {
    inject(name: string, fn: () => unknown): unknown
    register<P>(options: Record<string, unknown>, component: import('react').ComponentType<P>): unknown
  }
}
interface Account { id: number; appId: string; enabled: boolean; gatewayStatus: string }
interface Group { id: number; name: string; platformGroupId: string; enabled: boolean; requiresAt: boolean; readEnabled: boolean; memberCount: number; messageCount: number }
interface Memory { profile: string; summary: string; daily: string; memory: string; pattern: string }
interface Member { id: number; platformUserId: string; displayName: string; memory: Memory }
interface Msg { id: number; direction: 'inbound' | 'outbound'; content: string; createdAt: number; senderId: string; senderName: string }
interface Detail { group: Group; groupMemory: Memory; members: Member[] }

const CHANNEL = '/qqchat'
const css = `
.qqc{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit}.qqc *{box-sizing:border-box}
.qqcHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0 16px;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqcBrand{display:flex;gap:10px;align-items:center}.qqcLogo,.qqcAvatar{display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}.qqcLogo{width:32px;height:32px;border-radius:9px;font-weight:650}.qqcAvatar{width:32px;height:32px;border-radius:50%;font-size:11px;flex:0 0 auto}.qqcTitle{font-size:16px;font-weight:600}.qqcMuted,.qqcMeta{font-size:11px;color:var(--dsw-alias-label-secondary)}.qqcStatus{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}.qqcDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}.qqcDot.online{background:var(--dsw-alias-state-success-primary)}
.qqcBtn{font:inherit;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;border-radius:9px;padding:8px 12px;cursor:pointer}.qqcBtn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base)}.qqcBtn:disabled{opacity:.5;cursor:default}
.qqcConnect{flex:1;min-height:380px;display:grid;place-items:center}.qqcConnectBody{max-width:460px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:14px}.qqcQr{padding:14px;border-radius:16px;background:#fff;box-shadow:0 5px 24px #0001}.qqcQr img{width:220px;height:220px;display:block}
.qqcShell{flex:1;min-height:0;margin-top:16px;display:grid;grid-template-columns:220px minmax(360px,1fr) 310px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden}.qqcSide,.qqcInspector{background:var(--dsw-alias-bg-layer-1);min-width:0;overflow:auto}.qqcSide{border-right:1px solid var(--dsw-alias-border-l1);padding:10px 7px}.qqcInspector{border-left:1px solid var(--dsw-alias-border-l1)}.qqcGroup{width:100%;display:flex;gap:9px;align-items:center;border:0;background:transparent;color:inherit;text-align:left;padding:9px;border-radius:9px;cursor:pointer}.qqcGroup:hover,.qqcGroup.active{background:var(--dsw-alias-bg-layer-2)}.qqcGrow{min-width:0;flex:1}.qqcEllipsis{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.qqcConversation{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--dsw-alias-bg-base)}.qqcConvHead{height:54px;padding:0 16px;display:flex;align-items:center;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:600}.qqcMsgs{flex:1;min-height:0;overflow:auto;padding:18px 16px}.qqcMsg{display:flex;gap:9px;align-items:flex-start;margin-bottom:16px}.qqcMsg.out{flex-direction:row-reverse}.qqcMsgBody{max-width:75%}.qqcMsg.out .qqcMsgBody{text-align:right}.qqcBubble{display:inline-block;text-align:left;white-space:pre-wrap;word-break:break-word;padding:9px 11px;border-radius:5px 13px 13px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:13px;line-height:1.5}.qqcMsg.out .qqcBubble{border-radius:13px 5px 13px 13px}.qqcCompose{display:flex;gap:8px;padding:10px;border-top:1px solid var(--dsw-alias-border-l1)}.qqcInput{flex:1;min-height:38px;resize:none;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-base);color:inherit;padding:9px;font:inherit}
.qqcTabs{display:flex;padding:8px 8px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqcTab{border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:8px;font:inherit;font-size:12px;cursor:pointer}.qqcTab.active{color:inherit;border-bottom-color:var(--dsw-alias-brand-primary)}.qqcPane{padding:12px;display:flex;flex-direction:column;gap:10px}.qqcCard{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base)}.qqcCard h4{font-size:12px;margin:0;padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqcDoc{padding:10px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;max-height:220px;overflow:auto}.qqcMember{display:flex;gap:8px;align-items:center;padding:8px;border:0;background:transparent;color:inherit;width:100%;text-align:left;cursor:pointer}.qqcMember.active{background:var(--dsw-alias-bg-layer-2)}.qqcSetting{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}.qqcCheck{width:18px;height:18px}.qqcError{margin-top:10px;color:var(--dsw-alias-state-error-primary);font-size:12px}
@media(max-width:1050px){.qqcShell{grid-template-columns:200px 1fr}.qqcInspector{display:none}}@media(max-width:720px){.qqcShell{grid-template-columns:1fr}.qqcSide{display:none}}
`

function installStyles() {
  if (document.querySelector('style[data-dsh-qqchat]')) return () => {}
  const node = document.createElement('style'); node.dataset.dshQqchat = '1'; node.textContent = css; document.head.appendChild(node)
  return () => node.remove()
}
async function call<T>(rpc: Rpc, endpoint: string, payload: unknown = {}): Promise<T> {
  const result = await rpc.call(CHANNEL, endpoint, payload) as RpcResult<T>
  if (!result.ok) throw new Error(result.error?.message || 'QQ Chat 请求失败')
  return result.value
}
const initials = (text?: string) => String(text || '?').trim().slice(0, 2).toUpperCase()
const time = (ms: number) => ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
function Doc({ title, value }: { title: string; value?: string }) { return h('section', { className: 'qqcCard' }, h('h4', null, title), h('div', { className: 'qqcDoc' }, value || '还没有形成这部分记忆。')) }
function Check({ value, onChange }: { value: boolean; onChange(value: boolean): void }) { return h('input', { className: 'qqcCheck', type: 'checkbox', checked: value, onChange: (e: import('react').ChangeEvent<HTMLInputElement>) => onChange(e.target.checked) }) }

function QQChat({ rpc }: { rpc: Rpc }) {
  const [accounts, setAccounts] = useState<Account[]>([]), [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState<number | null>(null), [detail, setDetail] = useState<Detail | null>(null), [messages, setMessages] = useState<Msg[]>([])
  const [tab, setTab] = useState<Tab>('memory'), [memberId, setMemberId] = useState<number | null>(null), [draft, setDraft] = useState(''), [error, setError] = useState('')
  const [auth, setAuth] = useState<{ taskId: string; qrDataUrl: string } | null>(null), [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const status = await call<{ accounts: Account[] }>(rpc, 'status'); const list = await call<{ groups: Group[] }>(rpc, 'groups/list')
      setAccounts(status.accounts || []); setGroups(list.groups || []); setGroupId(current => current ?? list.groups?.[0]?.id ?? null); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [rpc])
  const refreshGroup = useCallback(async (id: number | null) => {
    if (!id) { setDetail(null); setMessages([]); return }
    try {
      const [d, m] = await Promise.all([call<Detail>(rpc, 'group/get', { groupId: id }), call<{ messages: Msg[] }>(rpc, 'group/messages', { groupId: id, limit: 160 })])
      setDetail(d); setMessages(m.messages || []); setMemberId(current => current ?? d.members?.[0]?.id ?? null); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [rpc])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void refreshGroup(groupId) }, [groupId, refreshGroup])
  useEffect(() => { const t = setInterval(() => { void refresh(); void refreshGroup(groupId) }, 4000); return () => clearInterval(t) }, [refresh, refreshGroup, groupId])

  const account = accounts.find(a => a.enabled) || accounts[0]
  const selectedMember = useMemo(() => detail?.members.find(m => m.id === memberId), [detail, memberId])
  const startAuth = async () => { setBusy(true); try { setAuth(await call(rpc, 'auth/start')); setError('') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  useEffect(() => {
    if (!auth) return
    const t = setInterval(async () => {
      try {
        const state = await call<{ status: string; reason?: string }>(rpc, 'auth/poll', { taskId: auth.taskId })
        if (state.status === 'success') { clearInterval(t); setAuth(null); await refresh() }
        else if (state.status === 'fail' || state.status === 'expired') { clearInterval(t); setError(state.reason || '二维码已失效'); setAuth(null) }
      } catch (e) { clearInterval(t); setError(e instanceof Error ? e.message : String(e)) }
    }, 1400)
    return () => clearInterval(t)
  }, [auth, rpc, refresh])

  const patch = async (data: Partial<Pick<Group, 'enabled' | 'requiresAt' | 'readEnabled'>>) => { if (!groupId) return; await call(rpc, 'group/update', { groupId, patch: data }); await refreshGroup(groupId); await refresh() }
  const send = async () => { if (!groupId || !draft.trim()) return; setBusy(true); try { await call(rpc, 'group/send', { groupId, content: draft.trim() }); setDraft(''); await refreshGroup(groupId) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  const reflect = async () => { if (!groupId) return; setBusy(true); try { await call(rpc, 'group/reflect', { groupId }); await refreshGroup(groupId) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }

  const header = h('div', { className: 'qqcHead' }, h('div', { className: 'qqcBrand' }, h('div', { className: 'qqcLogo' }, 'QQ'), h('div', null, h('div', { className: 'qqcTitle' }, 'QQ Chat'), h('div', { className: 'qqcMuted' }, '官方 QQ Bot · 群聊记忆'))), h('div', { className: 'qqcStatus' }, h('span', { className: `qqcDot ${account?.gatewayStatus === 'online' ? 'online' : ''}` }), account ? (account.gatewayStatus === 'online' ? '已连接' : '已授权') : '未连接'))
  if (!account) return h('div', { className: 'qqc' }, header, error && h('div', { className: 'qqcError' }, error), h('div', { className: 'qqcConnect' }, h('div', { className: 'qqcConnectBody' }, h('h2', null, auth ? '使用 QQ 扫码授权' : '连接 QQ 机器人'), h('div', { className: 'qqcMuted' }, 'AppSecret 只在 DSH Host 端解密并保存。'), auth && h('div', { className: 'qqcQr' }, h('img', { src: auth.qrDataUrl, alt: 'QQ 授权二维码' })), h('button', { className: 'qqcBtn primary', disabled: busy, onClick: startAuth }, auth ? '重新生成二维码' : '扫码连接'))))

  const sidebar = h('aside', { className: 'qqcSide' }, groups.map(g => h('button', { key: g.id, className: `qqcGroup${g.id === groupId ? ' active' : ''}`, onClick: () => setGroupId(g.id) }, h('div', { className: 'qqcAvatar' }, initials(g.name)), h('div', { className: 'qqcGrow' }, h('div', { className: 'qqcEllipsis' }, g.name || `群 ${g.platformGroupId.slice(-6)}`), h('div', { className: 'qqcMeta qqcEllipsis' }, `${g.memberCount || 0} 位群友 · ${g.messageCount || 0} 条记录`)))))
  const conversation = h('main', { className: 'qqcConversation' }, h('div', { className: 'qqcConvHead' }, detail?.group.name || '选择群聊'), h('div', { className: 'qqcMsgs' }, messages.map(m => h('div', { key: m.id, className: `qqcMsg${m.direction === 'outbound' ? ' out' : ''}` }, h('div', { className: 'qqcAvatar' }, m.direction === 'outbound' ? 'DS' : initials(m.senderName)), h('div', { className: 'qqcMsgBody' }, h('div', { className: 'qqcMeta' }, `${m.direction === 'outbound' ? 'DSH Agent' : (m.senderName || '群友')} ${m.direction === 'inbound' && m.senderId ? `…${m.senderId.slice(-8)}` : ''} ${time(m.createdAt)}`), h('div', { className: 'qqcBubble' }, m.content))))), h('form', { className: 'qqcCompose', onSubmit: (e: Event) => { e.preventDefault(); void send() } }, h('textarea', { className: 'qqcInput', value: draft, placeholder: '主动发送到这个 QQ 群…', onChange: (e: import('react').ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value) }), h('button', { className: 'qqcBtn primary', disabled: busy || !draft.trim() }, '发送')))

  let pane: unknown
  if (tab === 'memory') pane = h(React.Fragment, null, h('button', { className: 'qqcBtn', disabled: busy, onClick: () => void reflect() }, '整理记忆'), h(Doc, { title: '群画像 · profile', value: detail?.groupMemory.profile }), h(Doc, { title: '当前摘要 · summary', value: detail?.groupMemory.summary }), h(Doc, { title: '长期群记忆 · memory', value: detail?.groupMemory.memory }), h(Doc, { title: '近期沉淀 · daily', value: detail?.groupMemory.daily }))
  else if (tab === 'members') pane = h(React.Fragment, null, h('div', { className: 'qqcMuted' }, '身份使用 QQ stable sender ID；昵称只用于展示。'), h('section', { className: 'qqcCard' }, detail?.members.map(m => h('button', { key: m.id, className: `qqcMember${m.id === memberId ? ' active' : ''}`, onClick: () => setMemberId(m.id) }, h('div', { className: 'qqcAvatar' }, initials(m.displayName)), h('div', { className: 'qqcGrow' }, h('div', null, m.displayName || '群友'), h('div', { className: 'qqcMeta qqcEllipsis' }, m.platformUserId))))), selectedMember && h(React.Fragment, null, h(Doc, { title: '成员画像 · profile', value: selectedMember.memory.profile }), h(Doc, { title: '行为模式 · pattern', value: selectedMember.memory.pattern }), h(Doc, { title: '成员摘要 · summary', value: selectedMember.memory.summary })))
  else pane = detail && h(React.Fragment, null, h('label', { className: 'qqcSetting' }, h('span', null, '启用这个群'), h(Check, { value: detail.group.enabled, onChange: value => void patch({ enabled: value }) })), h('label', { className: 'qqcSetting' }, h('span', null, '仅 @ 时回应'), h(Check, { value: detail.group.requiresAt, onChange: value => void patch({ requiresAt: value }) })), h('label', { className: 'qqcSetting' }, h('span', null, '读取普通群消息'), h(Check, { value: detail.group.readEnabled, onChange: value => void patch({ readEnabled: value }) })))
  const inspector = h('aside', { className: 'qqcInspector' }, h('div', { className: 'qqcTabs' }, (['memory', 'members', 'settings'] as const).map(t => h('button', { key: t, className: `qqcTab${tab === t ? ' active' : ''}`, onClick: () => setTab(t) }, t === 'memory' ? '群记忆' : t === 'members' ? '群友' : '设置'))), h('div', { className: 'qqcPane' }, pane))
  return h('div', { className: 'qqc' }, header, error && h('div', { className: 'qqcError' }, error), h('div', { className: 'qqcShell' }, sidebar, conversation, inspector))
}

exports.inject = ['slots', 'connection'] as const
exports.apply = function apply(ctx: Ctx) {
  ctx.effect(installStyles, 'dsh-qqchat: client styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'qqchat', order: 35, label: () => 'QQ Chat', inject: () => ({ rpc: ctx.connection.rpc }) }, QQChat))
}
