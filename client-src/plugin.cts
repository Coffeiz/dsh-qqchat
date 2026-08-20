import { installStyles } from './shared.cjs'
import type { Ctx } from './shared.cjs'
import { QQSettings } from './settings.cjs'
import { QQSessionUtility, QQTranscriptNode, createQQMessageDefinition } from './workspace.cjs'

exports.inject = ['slots', 'connection', 'conversationEvents'] as const
exports.apply = function apply(ctx: Ctx) {
  ctx.effect(installStyles, 'dsh-qqchat: client styles')
  ctx.conversationEvents.register(createQQMessageDefinition())

  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'qqchat', order: 35, label: () => 'QQ Chat', inject: () => ({ rpc: ctx.connection.rpc }) }, QQSettings))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'qqchat-message' }, QQTranscriptNode))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'qqchat-memory', order: 30, inject: () => ({ rpc: ctx.connection.rpc }) }, QQSessionUtility))
}
