const GROUP_MENTION = /<qqbot-at-user\s+id="([^"\s<>]+)"\s*\/>/u;
export function formatQQGroupMentions(text, currentUserId, knownMemberIds) {
    const trusted = new Set(knownMemberIds.filter(isSafeMentionId));
    if (currentUserId && isSafeMentionId(currentUserId))
        trusted.add(currentUserId);
    const normalized = text.replace(/<@!?([^>\s]+)>/gu, (token, id) => isSafeMentionId(id) ? `<qqbot-at-user id="${id}" />` : token);
    if (!trusted.size)
        return normalized;
    const ids = [...trusted].sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`(?<![<@\\w])[@＠](${ids.map(escapeRegExp).join('|')})(?!\\w)`, 'gu');
    return normalized.replace(pattern, (_token, id) => `<qqbot-at-user id="${id}" />`);
}
export function hasQQGroupMention(text) {
    return GROUP_MENTION.test(text);
}
function isSafeMentionId(value) {
    return !!value && !/[\s<>"']/u.test(value);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
