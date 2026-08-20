import { h, useCallback, useEffect, useState, call, Button, Input, Menu, Modal, dateTime } from './shared.cjs'
import type { Account, GroupReceiveMode, KnownMember, PluginLog, ReplyFormat, Rpc, Settings } from './shared.cjs'

export function QQSettings({ rpc }: { rpc: Rpc }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [members, setMembers] = useState<KnownMember[]>([])
  const [auth, setAuth] = useState<{ taskId: string; qrDataUrl: string } | null>(null)
  const [logs, setLogs] = useState<PluginLog[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [groupReplyMenuOpen, setGroupReplyMenuOpen] = useState(false)
  const [directReplyMenuOpen, setDirectReplyMenuOpen] = useState(false)
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [status, prefs] = await Promise.all([
        call<{ accounts: Account[] }>(rpc, 'status'),
        call<{ settings: Settings; members: KnownMember[] }>(rpc, 'settings/get'),
      ])
      setAccount(status.accounts.find(item => item.enabled) || null)
      setSettings(prefs.settings)
      setMembers(prefs.members || [])
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [rpc])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (!auth) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (stopped) return
      try {
        const state = await call<{ status: string; reason?: string }>(rpc, 'auth/poll', { taskId: auth.taskId })
        if (state.status === 'success') { setAuth(null); await refresh(); return }
        if (state.status === 'fail' || state.status === 'expired') { setError(state.reason || '二维码已失效'); setAuth(null); return }
      } catch (err) {
        if (!stopped) { setError(err instanceof Error ? err.message : String(err)); setAuth(null) }
        return
      }
      if (!stopped) timer = setTimeout(() => void poll(), 3000)
    }
    timer = setTimeout(() => void poll(), 3000)
    return () => { stopped = true; if (timer) clearTimeout(timer) }
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
  const disconnect = async () => {
    if (!account) return
    setBusy(true)
    try {
      await call(rpc, 'account/disconnect', { accountId: account.id })
      setAccount(null)
      setAuth(null)
      setError('已取消连接，可以重新扫码绑定 Bot。')
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  const openLogs = async () => {
    try { setLogs((await call<{ logs: PluginLog[] }>(rpc, 'logs/list', { limit: 300 })).logs) } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const ownerPicker = h(Menu, {
    open: ownerMenuOpen,
    onClose: () => setOwnerMenuOpen(false),
    selectedId: settings?.ownerUserId,
    onSelect: (id: string) => { setOwnerMenuOpen(false); void patch({ ownerUserId: id }) },
    anchor: h(Button, { size: 'sm', variant: 'outline', onClick: () => setOwnerMenuOpen(!ownerMenuOpen) }, '选择群友'),
    align: 'end',
    items: [{ id: '', label: '不设置 Owner' }, ...members.map(member => ({ id: member.platformUserId, label: member.displayName || 'QQ 群友' }))],
  })
  const formatLabel = (value: ReplyFormat | undefined) => value === 'markdown' ? 'Markdown' : value === 'compat' ? '纯文本兼容' : '智能兼容'
  const formatItems = [{ id: 'smart', label: '智能兼容' }, { id: 'markdown', label: 'Markdown' }, { id: 'compat', label: '纯文本兼容' }]
  const groupReplyPicker = h(Menu, {
    open: groupReplyMenuOpen,
    onClose: () => setGroupReplyMenuOpen(false),
    selectedId: settings?.groupReplyFormat,
    onSelect: (id: string) => { setGroupReplyMenuOpen(false); void patch({ groupReplyFormat: id as ReplyFormat }) },
    anchor: h(Button, { size: 'sm', variant: 'outline', onClick: () => setGroupReplyMenuOpen(!groupReplyMenuOpen) }, formatLabel(settings?.groupReplyFormat)),
    items: formatItems,
    align: 'end',
  })
  const directReplyPicker = h(Menu, {
    open: directReplyMenuOpen,
    onClose: () => setDirectReplyMenuOpen(false),
    selectedId: settings?.directReplyFormat,
    onSelect: (id: string) => { setDirectReplyMenuOpen(false); void patch({ directReplyFormat: id as ReplyFormat }) },
    anchor: h(Button, { size: 'sm', variant: 'outline', onClick: () => setDirectReplyMenuOpen(!directReplyMenuOpen) }, formatLabel(settings?.directReplyFormat)),
    items: formatItems,
    align: 'end',
  })

  const head = h('div', { className: 'qqsHead' },
    h('div', null, h('div', { className: 'qqsTitle' }, 'QQ Chat'), h('div', { className: 'qqMuted' }, 'QQ Bot 接收、兼容与权限设置')),
    h('div', { className: 'qqStatus' }, account ? (account.gatewayStatus === 'online' ? '已连接' : '已授权') : '未连接', account && h(Button, { size: 'sm', variant: 'outline', disabled: busy, onClick: () => void disconnect() }, '取消连接')))

  if (!account) return h('div', { className: 'qqs' }, head, error && h('div', { className: 'qqError' }, error), h('div', { className: 'qqConnect' }, h('div', { className: 'qqsTitle' }, auth ? '使用 QQ 扫码授权' : '连接 QQ Bot'), h('div', { className: 'qqMuted' }, '扫码和凭据解密都在 DSH Host 侧完成。'), auth && h('div', { className: 'qqQr' }, h('img', { src: auth.qrDataUrl, alt: 'QQ 授权二维码' })), h(Button, { variant: 'primary', disabled: busy, onClick: () => void startAuth() }, auth ? '重新生成二维码' : '扫码连接')))
  if (!settings) return h('div', { className: 'qqs' }, head, h('div', { className: 'qqMuted' }, '正在读取设置…'))

  const receiveButtons = h('div', { className: 'qqChoiceButtons' },
    ...(['auto', 'mention', 'silent'] as const).map(mode => h(Button, {
      key: mode,
      size: 'sm',
      variant: settings.groupReceiveMode === mode ? 'primary' : 'outline',
      onClick: () => void patch({ groupReceiveMode: mode }),
    }, mode === 'auto' ? '自动回应' : mode === 'mention' ? '@回复' : '静默记录')))

  const receiveGroup = h('div', { className: 'qqSettingsGroup' },
    h('h3', null, '消息接收'),
    h('div', { className: 'qqSetting' },
      h('div', null, h('div', { className: 'qqSettingTitle' }, '群聊接收方式'), h('div', { className: 'qqSettingHelp' }, '自动回应：每条群消息都会触发 Agent；@回复：所有消息都记录，但只有 @Bot 才唤醒 Agent；静默记录：只记录群聊与记忆，不主动回应。')),
      h('div', { className: 'qqControl' }, receiveButtons)),
    h('div', { className: 'qqSetting' },
      h('div', null, h('div', { className: 'qqSettingTitle' }, '群聊消息兼容格式'), h('div', { className: 'qqSettingHelp' }, '仅控制发送到 QQ 群聊时使用的消息格式。')),
      h('div', { className: 'qqControl' }, groupReplyPicker)),
    h('div', { className: 'qqSetting' },
      h('div', null, h('div', { className: 'qqSettingTitle' }, '私聊消息兼容格式'), h('div', { className: 'qqSettingHelp' }, '仅控制发送到 QQ 私聊时使用的消息格式。')),
      h('div', { className: 'qqControl' }, directReplyPicker)))
  const memoryGroup = h('div', { className: 'qqSettingsGroup' },
    h('h3', null, '记忆系统'),
    h('div', { className: 'qqSetting' },
      h('div', null,
        h('div', { className: 'qqSettingTitle' }, '启用记忆系统'),
        h('div', { className: 'qqSettingHelp' }, '记忆会注入每轮 Agent 上下文，并在空闲时整理近期消息；这可能降低上下文缓存命中率并增加输入 token。关闭后停止记忆注入和后台整理，但不会删除已有记忆。')),
      h('div', { className: 'qqControl' }, h(Button, { size: 'sm', variant: settings.memoryEnabled ? 'primary' : 'outline', onClick: () => void patch({ memoryEnabled: !settings.memoryEnabled }) }, settings.memoryEnabled ? '已启用' : '已关闭'))))
  const ownerSetting = !settings.groupMembersCanUseTools
    ? h('div', { className: 'qqSetting' },
      h('div', null,
        h('div', { className: 'qqSettingTitle' }, 'Owner stable ID'),
        h('div', { className: 'qqSettingHelp' }, '使用 stable sender ID，不根据昵称判断。')),
      h('div', { className: 'qqControl' },
        h(Input, {
          value: settings.ownerUserId,
          placeholder: '粘贴 stable ID',
          onChange: (event: import('react').ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, ownerUserId: event.target.value }),
          onBlur: (event: import('react').FocusEvent<HTMLInputElement>) => void patch({ ownerUserId: event.currentTarget.value }),
        }),
        ownerPicker))
    : null
  const toolsGroup = h('div', { className: 'qqSettingsGroup' },
    h('h3', null, '工具权限'),
    h('div', { className: 'qqSetting' },
      h('label', { className: 'qqCheckRow' },
        h('input', { type: 'checkbox', checked: settings.groupMembersCanUseTools, onChange: (event: import('react').ChangeEvent<HTMLInputElement>) => void patch({ groupMembersCanUseTools: event.target.checked }) }),
        h('span', null,
          h('div', { className: 'qqSettingTitle' }, '群成员可用工具'),
          h('div', { className: 'qqSettingHelp' }, settings.groupMembersCanUseTools ? '群友触发的 Agent 回合可以使用当前 preset 的全部工具。' : '关闭后只有 Owner 触发的群聊回合可以执行工具；其他群友仍可正常聊天，但工具调用会被拒绝。')))),
    ownerSetting)
  const diagnosticsGroup = h('div', { className: 'qqSettingsGroup' }, h('h3', null, '诊断'), h('div', { className: 'qqSetting' }, h('div', null, h('div', { className: 'qqSettingTitle' }, '插件日志'), h('div', { className: 'qqSettingHelp' }, account.gatewayLastError ? `最近网关错误：${account.gatewayLastError}` : '查看 QQ Gateway、授权、Agent bridge 与消息发送的最近日志。')), h(Button, { size: 'sm', variant: 'outline', onClick: () => void openLogs() }, '查看日志')))
  return h('div', { className: 'qqs' }, head, error && h('div', { className: 'qqError' }, error), receiveGroup, memoryGroup, toolsGroup, diagnosticsGroup,
    logs && h(Modal, { title: 'QQ Chat 日志', onClose: () => setLogs(null) }, logs.length ? logs.map(log => h('div', { key: log.id, className: `qqLog ${log.level}` }, h('span', { className: 'qqLogMeta' }, `${dateTime(log.time)} [${log.level}]`), log.message)) : h('div', { className: 'qqMuted' }, '暂无日志。')))
}
