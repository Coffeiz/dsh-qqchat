export const React: typeof import('react') = require('react')
export const { useCallback, useEffect, useMemo, useState, useSyncExternalStore } = React
export const h = React.createElement

export type ChatType = 'c2c' | 'group'
export type GroupReceiveMode = 'auto' | 'mention' | 'silent'
export type ReplyFormat = 'smart' | 'markdown' | 'compat'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error?: { message?: string } }
export interface Rpc { call(channel: string, endpoint: string, payload: unknown): Promise<RpcResult<unknown>> }
export interface SessionListSnapshot { byId: Record<string, unknown>; current?: string }
export interface Observable<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
export interface SessionsService { list: Observable<SessionListSnapshot>; open(id: string): void }
export interface SlotRegistry {
  inject(name: string, fn: () => unknown): unknown
  register<P>(options: Record<string, unknown>, component: import('react').ComponentType<P>): unknown
}
export interface ConversationEvents { register(definition: Record<string, unknown>): unknown }
export interface Ctx {
  connection: { rpc: Rpc }
  sessions: SessionsService
  conversationEvents: ConversationEvents
  effect(fn: () => (() => void) | void, label: string): unknown
  slots: SlotRegistry
}
export interface Account { id: number; appId: string; enabled: boolean; gatewayStatus: string; gatewayLastError?: string | null }
export interface Settings { groupReceiveMode: GroupReceiveMode; replyFormat: ReplyFormat; groupMembersCanUseTools: boolean; ownerUserId: string }
export interface KnownMember { id: number; platformUserId: string; displayName: string; lastSeenAt: number }
export interface ChatItem { chatType: ChatType; rowId: number; platformId: string; displayName: string; dshSessionId: string | null; lastMessageAt: number | null; messageCount: number }
export interface Memory { profile: string; summary: string; daily: string; memory: string; pattern: string }
export interface ChatMember { id: number; platformUserId: string; displayName: string; memory: Memory }
export interface ChatInfo { chatType: ChatType; rowId: number; title: string; platformId: string; memory: Memory; members: ChatMember[] }
export interface PluginLog { id: number; time: number; level: LogLevel; message: string }
export interface QQEventData { messageId: string; chatType: ChatType; chatId: string; direction: 'inbound' | 'outbound'; senderId: string; senderName: string; content: string; quotedText: string; mentioned: boolean; createdAt: number }
export interface QQNode { data: QQEventData }
export interface ComposerProps { matched: { sessionId: string }; sessionId: string }
export interface SessionUtilityProps { sessionId: string }
export interface SidebarActionProps { wide: boolean; rpc: Rpc; sessions: SessionsService }

export const CHANNEL = '/qqchat'
const STYLE_ID = 'dsh-qqchat/client-ui-v2'

const css = `
.qqs{display:flex;flex-direction:column;gap:18px;color:var(--dsw-alias-label-primary);font:inherit}.qqs *{box-sizing:border-box}
.qqsHead{display:flex;align-items:center;justify-content:space-between;gap:12px}.qqsBrand{display:flex;align-items:center;gap:10px}.qqsLogo{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-weight:700}.qqsTitle{font-size:15px;font-weight:620}.qqMuted{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.55}.qqStatus{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary)}.qqDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}.qqDot.online{background:var(--dsw-alias-state-success-primary)}
.qqCard{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.qqCardHead{padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:13px;font-weight:600}.qqSetting{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:13px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqSetting:last-child{border-bottom:0}.qqSettingTitle{font-size:13px}.qqSettingHelp{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:4px;line-height:1.5;max-width:470px}.qqControl{min-width:190px;display:flex;justify-content:flex-end;align-items:center;gap:8px}.qqSelect,.qqInput{font:inherit;font-size:12px;color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 9px;outline:none}.qqInput{width:250px}.qqSelect{min-width:180px}.qqSwitch{position:relative;width:38px;height:22px;border:0;border-radius:999px;background:var(--dsw-alias-bg-overlay);cursor:pointer}.qqSwitch.on{background:var(--dsw-alias-brand-primary)}.qqSwitch:after{content:'';position:absolute;width:16px;height:16px;border-radius:50%;top:3px;left:3px;background:var(--dsw-alias-bg-base);transition:transform .15s}.qqSwitch.on:after{transform:translateX(16px)}
.qqSegment{display:flex;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}.qqSegment button{font:inherit;font-size:11px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:6px 9px;border-radius:6px;cursor:pointer;white-space:nowrap}.qqSegment button.active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.qqBtn{font:inherit;font-size:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;border-radius:8px;padding:7px 11px;cursor:pointer}.qqBtn:hover{background:var(--dsw-alias-bg-layer-2)}.qqBtn.primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-color:transparent}.qqBtn:disabled{opacity:.45;cursor:default}.qqError{font-size:12px;color:var(--dsw-alias-state-error-primary)}
.qqConnect{padding:24px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}.qqQr{padding:14px;background:#fff;border-radius:14px}.qqQr img{display:block;width:210px;height:210px}
.qqModalMask{position:fixed;inset:0;z-index:10000;background:#0007;display:grid;place-items:center;padding:24px}.qqModal{width:min(720px,calc(100vw - 40px));max-height:min(760px,calc(100vh - 40px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 16px 60px #0007;overflow:hidden}.qqModalHead{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqModalTitle{font-size:14px;font-weight:620}.qqModalBody{overflow:auto;padding:14px}.qqClose{border:0;background:transparent;color:inherit;font-size:18px;cursor:pointer}
.qqLog{font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:pre-wrap;word-break:break-word}.qqLogMeta{opacity:.65;margin-right:8px}.qqLog.warn{color:var(--dsw-alias-state-warn-primary)}.qqLog.error{color:var(--dsw-alias-state-error-primary)}
.qqFootButton{border:0;background:transparent;color:var(--dsw-alias-label-secondary);height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 10px;cursor:pointer;font:inherit;font-size:12px}.qqFootButton:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.qqFootIcon{width:20px;height:20px;border-radius:6px;display:grid;place-items:center;font-size:10px;font-weight:700;border:1px solid var(--dsw-alias-border-l2)}
.qqChatToolbar{display:flex;gap:8px;margin-bottom:12px}.qqSearch{flex:1;font:inherit;background:var(--dsw-alias-bg-base);color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:8px 10px}.qqChatSection{margin:14px 0 6px;font-size:11px;color:var(--dsw-alias-label-secondary)}.qqChatRow{width:100%;display:flex;align-items:center;gap:10px;padding:10px;border:0;background:transparent;color:inherit;border-radius:9px;text-align:left;cursor:pointer}.qqChatRow:hover{background:var(--dsw-alias-bg-layer-2)}.qqAvatar{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:11px;font-weight:650;flex:0 0 auto}.qqGrow{min-width:0;flex:1}.qqEllipsis{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qqBadge{font-size:10px;padding:2px 5px;border-radius:5px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary)}
.qqTranscript{display:flex;gap:9px;align-items:flex-start;margin:14px 0}.qqTranscript.out{flex-direction:row-reverse}.qqTranscriptBody{max-width:min(78%,680px)}.qqTranscript.out .qqTranscriptBody{text-align:right}.qqTranscriptMeta{font-size:11px;color:var(--dsw-alias-label-secondary);margin:0 3px 5px}.qqBubble{display:inline-block;text-align:left;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.55;padding:9px 11px;border-radius:5px 13px 13px 13px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}.qqTranscript.out .qqBubble{border-radius:13px 5px 13px 13px;background:var(--dsw-static-deepseek-50,var(--dsw-alias-bg-layer-2))}.qqQuote{font-size:11px;opacity:.7;border-left:2px solid var(--dsw-alias-border-l2);padding-left:7px;margin-bottom:6px}
.qqComposer{display:flex;gap:8px;width:100%;align-items:flex-end}.qqComposer textarea{flex:1;min-height:42px;max-height:140px;resize:none;font:inherit;background:var(--dsw-alias-bg-base);color:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px;outline:none}.qqComposerHint{font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:5px}.qqHeaderButton{font:inherit;font-size:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:7px;padding:5px 8px;cursor:pointer}
.qqMemoryGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.qqMemoryCard{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden}.qqMemoryCard h4{font-size:11px;margin:0;padding:8px 9px;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqMemoryDoc{padding:9px;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}.qqMemberList{margin-top:12px}.qqMemberRow{display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}.qqMemberId{font:10px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary)}
@media(max-width:720px){.qqSetting{flex-direction:column}.qqControl{width:100%;justify-content:flex-start}.qqMemoryGrid{grid-template-columns:1fr}.qqInput{width:100%}}
`

export function installStyles(): () => void {
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)) return () => {}
  const node = document.createElement('style')
  node.dataset.pluginCss = STYLE_ID
  node.textContent = css
  document.head.appendChild(node)
  return () => node.remove()
}

export async function call<T>(rpc: Rpc, endpoint: string, payload: unknown = {}): Promise<T> {
  const result = await rpc.call(CHANNEL, endpoint, payload) as RpcResult<T>
  if (!result.ok) throw new Error(result.error?.message || 'QQ Chat 请求失败')
  return result.value
}

export const short = (value: string) => value.length > 10 ? `…${value.slice(-10)}` : value
export const initials = (value: string) => String(value || '?').trim().slice(0, 2).toUpperCase()
export const time = (value: number) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
export const dateTime = (value: number) => value ? new Date(value).toLocaleString() : ''

export function Switch({ value, onChange, label }: { value: boolean; onChange(value: boolean): void; label: string }) {
  return h('button', { type: 'button', className: `qqSwitch${value ? ' on' : ''}`, 'aria-label': label, 'aria-pressed': value, onClick: () => onChange(!value) })
}

export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: import('react').ReactNode }) {
  return h('div', { className: 'qqModalMask', onMouseDown: (event: import('react').MouseEvent) => { if (event.target === event.currentTarget) onClose() } },
    h('div', { className: 'qqModal' }, h('div', { className: 'qqModalHead' }, h('div', { className: 'qqModalTitle' }, title), h('button', { type: 'button', className: 'qqClose', onClick: onClose }, '×')), h('div', { className: 'qqModalBody' }, children)))
}
