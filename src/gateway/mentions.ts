const GROUP_MENTION = /<qqbot-at-user\s+id="([^"\s<>]+)"\s*\/>/u

export function formatQQGroupMentions(
  text: string,
  currentUserId: string | undefined,
  knownMemberIds: readonly string[],
): string {
  const trusted = new Set(knownMemberIds.filter(isSafeMentionId))
  if (currentUserId && isSafeMentionId(currentUserId)) trusted.add(currentUserId)

  const normalized = text.replace(/<@!?([^>\s]+)>/gu, (token, id: string) =>
    isSafeMentionId(id) ? `<qqbot-at-user id="${id}" />` : token,
  )
  if (!trusted.size) return normalized

  const ids = [...trusted].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`(?<![<@\\w])[@＠](${ids.map(escapeRegExp).join('|')})(?!\\w)`, 'gu')
  return normalized.replace(pattern, (_token, id: string) => `<qqbot-at-user id="${id}" />`)
}

export function hasQQGroupMention(text: string): boolean {
  return GROUP_MENTION.test(text)
}

function isSafeMentionId(value: string): boolean {
  return !!value && !/[\s<>"']/u.test(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
