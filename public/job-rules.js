// Job badge rules shared by the Worker and the browser (same pattern as engine.js).
(function (root) {
  const LINES = ['red', 'green', 'yellow', 'pink', 'blue'];
  // Stable pseudo-random line for players who have not chosen one yet (FNV-1a).
  function defaultLine(playerId) {
    let h = 0x811c9dc5;
    for (const ch of String(playerId)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return LINES[h % LINES.length];
  }
  // Novice 0–4, Job 1 5–14, Job 2 15–29, Job 3 30+; one star per 30 plays after 30, max 5.
  function jobLevel(plays) {
    const n = Number(plays) || 0;
    const lvl = n >= 30 ? 3 : n >= 15 ? 2 : n >= 5 ? 1 : 0;
    return { lvl, stars: lvl === 3 ? Math.min(5, Math.floor((n - 30) / 30)) : 0 };
  }
  // Next play count that changes the badge (job or star), or null at the top.
  function nextGoal(plays) {
    const n = Number(plays) || 0;
    if (n < 5) return 5;
    if (n < 15) return 15;
    if (n < 30) return 30;
    return n >= 180 ? null : 30 + 30 * (Math.floor((n - 30) / 30) + 1);
  }
  // Lowest play count with the same badge: lets the server hide exact counts.
  function levelFloor(plays) {
    const { lvl, stars } = jobLevel(plays);
    return [0, 5, 15, 30][lvl] + stars * 30;
  }
  root.SenaJobRules = { LINES, defaultLine, jobLevel, nextGoal, levelFloor };
  if (typeof module !== 'undefined') module.exports = root.SenaJobRules;
})(typeof window === 'undefined' ? globalThis : window);
