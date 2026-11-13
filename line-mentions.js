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

// LINE's app and server disagree about the length of a mentioned name when it
// contains emoji parts: variation selectors (U+FE0F after a symbol), ZWJ and
// keycap joiners, and characters outside the BMP (surrogate pairs). Every mention
// after such a name lands in the wrong place, and the text right after it is
// swallowed. Thai vowel and tone marks are NOT counted: a Thai prefix with many
// marks before a mention rendered correctly in the real group.
export function mentionNameRisk(name) {
  let risk = 0;
  for (const char of String(name || '')) {
    const code = char.codePointAt(0);
    if (code > 0xffff || (code >= 0xfe00 && code <= 0xfe0f) || code === 0x200d || code === 0x20e3)
      risk++;
  }
  return risk;
}

// Group payers into mention messages that LINE renders as real mentions.
// Findings from the real group (see LINE-MENTION-AUDIT.md and docs/archive/): a name LINE
// miscounts (excess > 0) shifts the position of every mention after it, and one
// invalid position drops all mentions in that message. So names are ordered from
// plain to miscounted, a message only continues while the excess before the next
// name is at most 1 (the largest tolerated shift seen), and the name that pushes
// it over always ends the message. People with the biggest miscounts therefore
// land last, and each such name closes its message.
// 3 is the most that has been seen rendering in the real group; raise it only after
// checking more on a real bill.
export const MAX_MENTIONS_PER_MESSAGE = 3;
export function planMentionMessages(people, max = MAX_MENTIONS_PER_MESSAGE) {
  const sorted = [...people].sort((a, b) => a.risk - b.risk);
  const chunks = [];
  let current = [],
    excess = 0;
  for (const person of sorted) {
    current.push(person);
    excess += person.risk;
    if (excess > 1 || current.length >= max) {
      chunks.push(current);
      current = [];
      excess = 0;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}
// One message: Thai prefix, each name followed by invisible padding (enough to
// absorb the miscount so text after the name is not swallowed), then closing text.
// No emoji in the prefix or suffix: they would be miscounted too.
export function mentionGroupMessage(chunk, prefix, suffix) {
  const substitution = {};
  const tags = chunk.map((person, i) => {
    substitution['m' + i] = { type: 'mention', mentionee: { type: 'user', userId: person.userId } };
    return '{m' + i + '}' + '\u200b'.repeat(Math.min(64, Math.max(16, person.risk * 2)));
  });
  return { type: 'textV2', text: prefix + tags.join(' ') + '\n' + suffix, substitution };
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
