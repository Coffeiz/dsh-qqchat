export const React: typeof import('react') = require('react')
const dshPrimitives = require('@deepseek-ai/dsh-client-ui-primitives') as {
  Button: import('react').ComponentType<any>
  Input: import('react').ComponentType<any>
  Menu: import('react').ComponentType<any>
  Modal: import('react').ComponentType<any>
}
const { Button: DshButton, Input: DshInput, Menu: DshMenu, Modal: DshModal } = dshPrimitives
export const Button = DshButton as unknown as import('react').ComponentType<any>
export const Input = DshInput as unknown as import('react').ComponentType<any>
export const Menu = DshMenu as unknown as import('react').ComponentType<any>
export const { useCallback, useEffect, useMemo, useState, useSyncExternalStore } = React
export const h = React.createElement

let qqRpc: Rpc | undefined
export function setQQRpc(rpc: Rpc): void { qqRpc = rpc }
export function getQQRpc(): Rpc | undefined { return qqRpc }

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
export interface Settings { memoryEnabled: boolean; groupReceiveMode: GroupReceiveMode; groupReplyFormat: ReplyFormat; directReplyFormat: ReplyFormat; directStreamingEnabled: boolean; groupMembersCanUseTools: boolean; groupMembersCanReceiveMedia: boolean; groupMembersCanReadMedia: boolean; ownerUserId: string }
export interface KnownMember { id: number; platformUserId: string; displayName: string; lastSeenAt: number }
export interface ChatItem { chatType: ChatType; rowId: number; platformId: string; displayName: string; dshSessionId: string | null; lastMessageAt: number | null; messageCount: number }
export interface Memory { profile: string; summary: string; daily: string; memory: string; pattern: string }
export interface ChatMember { id: number; platformUserId: string; displayName: string; aliases: string[]; nicknames: string[]; messageCount: number; memory: Memory }
export interface ChatInfo { chatType: ChatType; rowId: number; title: string; platformId: string; memory: Memory; members: ChatMember[] }
export interface PluginLog { id: number; time: number; level: LogLevel; message: string }
export interface QQAttachmentData { id: string; kind: string; filename: string; contentType?: string; sizeBytes: number; quoted?: boolean; imageRef?: Record<string, unknown> }
export interface QQQuoteData { messageId?: string; senderId?: string; senderName?: string; text: string; attachments?: QQAttachmentData[] }
export interface QQEventData { messageId: string; chatType: ChatType; chatId: string; direction: 'inbound' | 'outbound'; senderId: string; senderName: string; isOwner?: boolean; content: string; quotedText: string; mentioned: boolean; createdAt: number; sessionId?: string; attachments?: QQAttachmentData[]; quote?: QQQuoteData | null }
export interface QQNode { data: QQEventData }
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
.qqTranscript{display:flex;gap:9px;align-items:flex-start;margin:14px 0}.qqTranscript.out{flex-direction:row-reverse}.qqTranscriptBody{max-width:min(78%,680px)}.qqTranscript.out .qqTranscriptBody{text-align:right}.qqTranscriptMeta{font-size:11px;color:var(--dsw-alias-label-secondary);margin:0 3px 5px}.qqBubble{display:inline-block;text-align:left;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.55;padding:9px 11px;border-radius:5px 13px 13px 13px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}.qqTranscript.out .qqBubble{border-radius:13px 5px 13px 13px;background:var(--dsw-static-deepseek-50,var(--dsw-alias-bg-layer-2))}.qqQuote{max-width:100%;margin:0 0 7px;padding:7px 10px 8px;border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-brand-primary);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 72%,transparent);color:var(--dsw-alias-label-secondary);text-align:left;white-space:normal;word-break:break-word;overflow:hidden}.qqQuoteLabel{margin-bottom:3px;font-size:10px;line-height:14px;font-weight:650;color:var(--dsw-alias-brand-primary);letter-spacing:.02em}.qqQuoteText{font-size:12px;line-height:1.5;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical;overflow:hidden}.qqTranscript.out .qqQuote{border-left:1px solid var(--dsw-alias-border-l1);border-right:3px solid var(--dsw-alias-brand-primary)}
.qqHeaderButton{font:inherit;font-size:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:7px;padding:5px 8px;cursor:pointer}
.qqMemoryGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.qqMemoryCard{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;overflow:hidden}.qqMemoryCard h4{font-size:11px;margin:0;padding:8px 9px;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqMemoryDoc{padding:9px;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto}.qqMemberList{margin-top:12px}.qqMemberRow{display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}.qqMemberId{font:10px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary)}
@media(max-width:720px){.qqSetting{flex-direction:column}.qqControl{width:100%;justify-content:flex-start}.qqMemoryGrid{grid-template-columns:1fr}.qqInput{width:100%}}

/* QQChat contributes layout only; controls, dialogs and selection surfaces are
   DSH primitives. Message colors use the host token system directly. */
.qqs{display:block;width:100%;min-width:0}.qqsHead{width:100%}.qqSettingsGroup{display:block;width:100%;min-width:0;margin-top:22px}.qqSettingsGroup h3{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}.qqSettingsGroup .qqSetting{display:flex;width:100%;min-width:0;flex:0 0 auto;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.qqSettingsGroup .qqSetting:last-child{border-bottom:0}.qqSetting>div:first-child{flex:1 1 auto;min-width:0}.qqControl{flex:0 0 auto}.qqChoiceButtons{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}.qqSettingsGroup select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 8px}.qqCheckRow{display:flex;align-items:flex-start;gap:10px;cursor:pointer}.qqCheckRow input{flex:none;width:16px;height:16px;margin:2px 0 0;accent-color:var(--dsw-alias-button-primary-fill);cursor:pointer}.qqConnect{display:flex;flex-direction:column;align-items:center;gap:14px;padding:24px 0;text-align:center}.qqTranscript{margin:16px 0}.qqTranscriptBody{max-width:min(78%,680px)}.qqBubble{border:0;border-radius:18px;padding:9px 13px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}.qqTranscript.out .qqBubble{border-radius:18px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}.qqTranscriptMeta{margin:0 4px 4px;font-size:12px;color:var(--dsw-alias-label-secondary)}.qqQuote{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.qqWideModal{width:min(760px,calc(100vw - 48px));max-height:calc(100vh - 48px);min-height:0;overflow:hidden}.qqModalContent{min-height:0;overflow:auto}.qqModalContent .qqMemoryGrid{min-width:0}.qqModalContent .qqLog{overflow-wrap:anywhere;word-break:break-word}
`.concat('.qqQuoteSender{margin-top:4px;font-size:10px;color:var(--dsw-alias-label-secondary)}.qqMediaList{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.qqMediaCard{display:flex;align-items:center;gap:6px;max-width:100%;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:11px}.qqMediaKind{color:var(--dsw-alias-brand-primary);font-weight:650}.qqMediaPreview{width:42px;height:42px;object-fit:cover;border-radius:6px}.qqMediaName{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.qqMediaSize,.qqMediaQuoted{color:var(--dsw-alias-label-secondary)}')

const qqThemeOverrides = '.qqTranscript.out .qqBubble{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}'

export function installStyles(): () => void {
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)) return () => {}
  const node = document.createElement('style')
  node.dataset.pluginCss = STYLE_ID
  node.textContent = css + qqThemeOverrides
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

export function Modal({ title, onClose, children }: { title: string; onClose(): void; children?: import('react').ReactNode }) {
  return h(DshModal, { open: true, title, onClose, closeLabel: '关闭', className: 'qqWideModal', contentClassName: 'qqModalContent' }, children)
}
