import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type { QQChatDisplayEvent } from './types.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
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
    'qq-chat-bootstrap': {
      kind: 'qq-chat-bootstrap'
      plugin: 'dsh-qqchat'
    }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** QQ transcript row for the DSH Web conversation surface. Log-only; never enters model history. */
    'qqchat/message': QQChatDisplayEvent
  }
}

export {}
