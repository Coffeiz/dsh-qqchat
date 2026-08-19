import type {} from '@deepseek-ai/dsh-llm'

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
    }
  }
}

export {}
