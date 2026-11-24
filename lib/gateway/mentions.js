const GROUP_MENTION = /<qqbot-at-user\s+id="[A-Za-z0-9][A-Za-z0-9._:-]*"\s*\/>/u;
const QQ_MENTION_TAG = /<qqbot-at-user\s+id="([^"]*)"\s*\/>/gu;
const PROTECTED_MARKDOWN = /(```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<]+|www\.[^\s<]+)/gu;
const QQ_OPENID = '[A-Fa-f0-9]{32}';
export function formatQQGroupMentions(text) {
    return text.split(PROTECTED_MARKDOWN)
        .map((part, index) => index % 2 === 1 ? part : formatMentionText(part))
        .join('');
}
export function hasQQGroupMention(text) {
    return text.split(PROTECTED_MARKDOWN).some((part, index) => index % 2 === 0 && GROUP_MENTION.test(part));
}
function formatMentionText(text) {
    const normalizedTags = text.replace(QQ_MENTION_TAG, (token, id) => isSafeMentionId(id) ? `<qqbot-at-user id="${id}" />` : token);
    const normalized = normalizedTags.replace(/<@!?([^>\s]+)>/gu, (token, id) => isSafeMentionId(id) ? `<qqbot-at-user id="${id}" />` : token);
    return normalized.replace(new RegExp(`(?<![\\w@./])[@＠](${QQ_OPENID})(?![\\w.-])`, 'gu'), (token, id) => isSafeMentionId(id) ? `<qqbot-at-user id="${id}" />` : token);
}
function isSafeMentionId(value) {
    return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}
