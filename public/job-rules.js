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
  root.SenaJobRules = { LINES, defaultLine, jobLevel };
  if (typeof module !== 'undefined') module.exports = root.SenaJobRules;
})(typeof window === 'undefined' ? globalThis : window);
