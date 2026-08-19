import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type { QQChatDisplayEvent } from './types.js'

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
    'qq-chat-bootstrap': {
      kind: 'qq-chat-bootstrap'
      plugin: 'dsh-qqchat'
    }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** QQ transcript row used only for messages that do not enter the Agent/model surface. */
    'qqchat/message': QQChatDisplayEvent
  }
}

export {}
