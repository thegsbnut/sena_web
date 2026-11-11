export const validLineUserId = id => /^U[a-f0-9]{32}$/.test(id || '');

// A successful validate/reply checks syntax, not destination membership.
export async function groupMentionTarget(env, groupId, userId) {
  if (!validLineUserId(userId)) return { reason: 'invalid_line_user_id' };
  try {
    const response = await fetch(
      'https://api.line.me/v2/bot/group/' + encodeURIComponent(groupId) + '/member/' + userId,
      {
        headers: { Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN },
        signal: AbortSignal.timeout(2000),
      },
    );
    const httpStatus = response.status;
    if (!response.ok)
      return {
        httpStatus,
        reason:
          httpStatus === 404
            ? 'not_in_group_or_provider_mismatch'
            : httpStatus === 401 || httpStatus === 403
              ? 'line_credentials_rejected'
              : 'line_profile_error',
      };
    const profile = await response.json();
    if (profile.userId !== userId) return { httpStatus, reason: 'line_profile_identity_mismatch' };
    return {
      userId,
      displayName: typeof profile.displayName === 'string' ? profile.displayName : '',
      httpStatus,
      reason: 'mention_ready',
    };
  } catch {
    return { reason: 'line_profile_timeout_or_network' };
  }
}

// LINE miscounts the length of a mentioned name when what is drawn as one
// character takes several UTF-16 units (emoji, variation selectors U+FE0F,
// ZWJ sequences, and possibly Thai vowel/tone marks). Mentions after such a
// name in the same message then land in the wrong place and stop rendering,
// and the characters right after it are swallowed. Treat any name whose
// grapheme count differs from its UTF-16 length as risky.
const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });
export function mentionNameRisk(name) {
  const text = String(name || '');
  return text.length - [...graphemes.segment(text)].length;
}

// Keep the exact message shape for diagnosis, with synthetic IDs instead of
// real accounts. No access token or reply token is persisted.
export function redactedMentionPayload(messages) {
  const aliases = new Map();
  return JSON.parse(
    JSON.stringify({ messages, notificationDisabled: false }, (key, value) => {
      if (key !== 'userId') return value;
      if (!aliases.has(value))
        aliases.set(value, 'U' + (aliases.size + 1).toString(16).padStart(32, '0'));
      return aliases.get(value);
    }),
  );
}
export async function lineReplyEvidence(response, messages) {
  const clean = value =>
    String(value ?? '')
      .replace(/U[a-f0-9]{32}/g, '[LINE_USER_ID]')
      .slice(0, 500);
  let data = {};
  try {
    const body = await response.json();
    if (body && typeof body === 'object') data = body;
  } catch {}
  return {
    replyStatus: response.status,
    outcome: response.ok ? 'accepted' : 'rejected',
    requestId: response.headers.get('x-line-request-id'),
    error: response.ok
      ? null
      : {
          message: clean(data.message || 'LINE rejected the reply'),
          details: (Array.isArray(data.details) ? data.details : [])
            .slice(0, 20)
            .map(d => ({ property: clean(d?.property), message: clean(d?.message) })),
        },
    sentMessageIds: response.ok
      ? (Array.isArray(data.sentMessages) ? data.sentMessages : [])
          .map(m => m?.id)
          .filter(id => typeof id === 'string')
      : [],
    payload: redactedMentionPayload(messages),
    payloadRedacted: true,
    renderingConfirmed: false,
  };
}
