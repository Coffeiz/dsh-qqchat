import { h, useCallback, useEffect, useState, call, Switch, Modal, dateTime, short } from './shared.cjs'
import type { Account, GroupReceiveMode, KnownMember, PluginLog, ReplyFormat, Rpc, Settings } from './shared.cjs'

export function QQSettings({ rpc }: { rpc: Rpc }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [members, setMembers] = useState<KnownMember[]>([])
  const [auth, setAuth] = useState<{ taskId: string; qrDataUrl: string } | null>(null)
  const [logs, setLogs] = useState<PluginLog[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [status, prefs] = await Promise.all([
        call<{ accounts: Account[] }>(rpc, 'status'),
        call<{ settings: Settings; members: KnownMember[] }>(rpc, 'settings/get'),
      ])
      setAccount(status.accounts.find(item => item.enabled) || status.accounts[0] || null)
      setSettings(prefs.settings)
      setMembers(prefs.members || [])
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [rpc])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!auth) return
    const timer = setInterval(async () => {
      try {
        const state = await call<{ status: string; reason?: string }>(rpc, 'auth/poll', { taskId: auth.taskId })
        if (state.status === 'success') { clearInterval(timer); setAuth(null); await refresh() }
        if (state.status === 'fail' || state.status === 'expired') { clearInterval(timer); setError(state.reason || '二维码已失效'); setAuth(null) }
      } catch (err) { clearInterval(timer); setError(err instanceof Error ? err.message : String(err)) }
    }, 1400)
    return () => clearInterval(timer)
  }, [auth, rpc, refresh])

  const patch = useCallback(async (value: Partial<Settings>) => {
    if (!settings) return
    const optimistic = { ...settings, ...value }
    setSettings(optimistic)
    try {
      const result = await call<{ settings: Settings }>(rpc, 'settings/update', { patch: value })
      setSettings(result.settings)
      setError('')
    } catch (err) { setSettings(settings); setError(err instanceof Error ? err.message : String(err)) }
  }, [rpc, settings])

  const startAuth = async () => {
    setBusy(true)
    try { setAuth(await call<{ taskId: string; qrDataUrl: string }>(rpc, 'auth/start')); setError('') } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  const openLogs = async () => {
    try { setLogs((await call<{ logs: PluginLog[] }>(rpc, 'logs/list', { limit: 300 })).logs) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const head = h('div', { className: 'qqsHead' },
    h('div', { className: 'qqsBrand' }, h('div', { className: 'qqsLogo' }, 'QQ'), h('div', null, h('div', { className: 'qqsTitle' }, 'QQ Chat'), h('div', { className: 'qqMuted' }, 'QQ Bot 接收、兼容与权限设置'))),
    h('div', { className: 'qqStatus' }, h('span', { className: `qqDot${account?.gatewayStatus === 'online' ? ' online' : ''}` }), account ? (account.gatewayStatus === 'online' ? '已连接' : '已授权') : '未连接'))

  if (!account) return h('div', { className: 'qqs' }, head, error && h('div', { className: 'qqError' }, error), h('div', { className: 'qqCard qqConnect' }, h('div', { className: 'qqsTitle' }, auth ? '使用 QQ 扫码授权' : '连接 QQ Bot'), h('div', { className: 'qqMuted' }, '扫码和凭据解密都在 DSH Host 侧完成。'), auth && h('div', { className: 'qqQr' }, h('img', { src: auth.qrDataUrl, alt: 'QQ 授权二维码' })), h('button', { type: 'button', className: 'qqBtn primary', disabled: busy, onClick: () => void startAuth() }, auth ? '重新生成二维码' : '扫码连接')))
  if (!settings) return h('div', { className: 'qqs' }, head, h('div', { className: 'qqMuted' }, '正在读取设置…'))

  return h('div', { className: 'qqs' }, head, error && h('div', { className: 'qqError' }, error),
    h('section', { className: 'qqCard' }, h('div', { className: 'qqCardHead' }, '消息接收'),
      h('div', { className: 'qqSetting' }, h('div', null, h('div', { className: 'qqSettingTitle' }, '群聊接收方式'), h('div', { className: 'qqSettingHelp' }, '自动回应：每条群消息都会触发 Agent；@回复：所有消息都记录，但只有 @Bot 才唤醒 Agent；静默记录：只记录群聊与记忆，不主动回应。')), h('div', { className: 'qqControl' }, h('div', { className: 'qqSegment' }, (['auto', 'mention', 'silent'] as const).map(mode => h('button', { type: 'button', key: mode, className: settings.groupReceiveMode === mode ? 'active' : '', onClick: () => void patch({ groupReceiveMode: mode }) }, mode === 'auto' ? '自动回应' : mode === 'mention' ? '@回复' : '静默记录'))))),
      h('div', { className: 'qqSetting' }, h('div', null, h('div', { className: 'qqSettingTitle' }, '消息兼容格式'), h('div', { className: 'qqSettingHelp' }, '控制发送到 QQ 时使用的消息格式。兼容模式优先保证不同 QQ 客户端都能正常显示。')), h('div', { className: 'qqControl' }, h('select', { className: 'qqSelect', value: settings.replyFormat, onChange: (event: import('react').ChangeEvent<HTMLSelectElement>) => void patch({ replyFormat: event.target.value as ReplyFormat }) }, h('option', { value: 'smart' }, '智能兼容'), h('option', { value: 'markdown' }, 'Markdown'), h('option', { value: 'compat' }, '纯文本兼容'))))),
    h('section', { className: 'qqCard' }, h('div', { className: 'qqCardHead' }, '工具权限'),
      h('div', { className: 'qqSetting' }, h('div', null, h('div', { className: 'qqSettingTitle' }, '群成员可用工具'), h('div', { className: 'qqSettingHelp' }, settings.groupMembersCanUseTools ? '群友触发的 Agent 回合可以使用当前 preset 的全部工具。' : '关闭后只有 Owner 触发的群聊回合可以执行工具；其他群友仍可正常聊天，但工具调用会被拒绝。')), h('div', { className: 'qqControl' }, h(Switch, { value: settings.groupMembersCanUseTools, label: '群成员可用工具', onChange: (value: boolean) => void patch({ groupMembersCanUseTools: value }) }))),
      !settings.groupMembersCanUseTools && h('div', { className: 'qqSetting' }, h('div', null, h('div', { className: 'qqSettingTitle' }, 'Owner stable ID'), h('div', { className: 'qqSettingHelp' }, 'QQ 官方 Bot 无法从扫码结果安全推断 Owner 身份，因此这里明确指定。使用 stable sender ID，不根据昵称判断。')), h('div', { className: 'qqControl', style: { flexDirection: 'column', alignItems: 'stretch' } }, h('input', { className: 'qqInput', list: 'qq-owner-candidates', value: settings.ownerUserId, placeholder: '选择群友或粘贴 stable ID', onChange: (event: import('react').ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, ownerUserId: event.target.value }), onBlur: (event: import('react').FocusEvent<HTMLInputElement>) => void patch({ ownerUserId: event.currentTarget.value }) }), h('datalist', { id: 'qq-owner-candidates' }, members.map(member => h('option', { key: member.id, value: member.platformUserId }, member.displayName || short(member.platformUserId))))))),
    h('section', { className: 'qqCard' }, h('div', { className: 'qqCardHead' }, '诊断'), h('div', { className: 'qqSetting' }, h('div', null, h('div', { className: 'qqSettingTitle' }, '插件日志'), h('div', { className: 'qqSettingHelp' }, account.gatewayLastError ? `最近网关错误：${account.gatewayLastError}` : '查看 QQ Gateway、授权、Agent bridge 与消息发送的最近日志。')), h('div', { className: 'qqControl' }, h('button', { type: 'button', className: 'qqBtn', onClick: () => void openLogs() }, '查看日志')))),
    logs && h(Modal, { title: 'QQ Chat 日志', onClose: () => setLogs(null) }, logs.length ? logs.map(log => h('div', { key: log.id, className: `qqLog ${log.level}` }, h('span', { className: 'qqLogMeta' }, `${dateTime(log.time)} [${log.level}]`), log.message)) : h('div', { className: 'qqMuted' }, '暂无日志。')))
}
