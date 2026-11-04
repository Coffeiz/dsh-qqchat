import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type { QQChatDisplayEvent } from '../types.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** QQ message that should behave as an ordinary DSH user prompt while retaining reliable QQ identity metadata. */
    'qq-user': {
      kind: 'user'
      channel: 'qq'
      botId: string
      chatType: 'c2c' | 'group'
      chatId: string
      senderId: string
      senderName?: string
      messageId: string
      mentioned: boolean
    }
    'qq-chat': {
      kind: 'qq-chat'
      botId: string
      chatType: 'c2c' | 'group'
      chatId: string
      senderId: string
      senderName?: string
      messageId: string
      mentioned: boolean
      form: 'notice'
      summary: string
    }
    'qq-chat-memory': {
      kind: 'qq-chat-memory'
      form: 'snapshot'
      sections: readonly { name: string; text: string }[]
    }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    /** Passive QQ transcript row; safe for readers that do not load this plugin. */
    'plugin:qqchat/message': QQChatDisplayEvent
  }
}

export {}
