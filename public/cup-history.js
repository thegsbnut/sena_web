// Online state and historical totals are separate records. Reuse a stable Cup id
// so saving the same completed Cup again updates one event instead of counting twice.
globalThis.SenaCupHistory = {
  complete(cup) {
    return (
      !!cup &&
      Array.isArray(cup.teams) &&
      cup.teams.length >= 2 &&
      Array.isArray(cup.matches) &&
      cup.matches.length === (cup.teams.length * (cup.teams.length - 1)) / 2 &&
      cup.matches.every(
        m =>
          Number.isInteger(m.sa) &&
          Number.isInteger(m.sb) &&
          m.sa >= 0 &&
          m.sb >= 0 &&
          m.sa <= 999 &&
          m.sb <= 999 &&
          m.sa !== m.sb,
      )
    );
  },
  async ensureId(cup) {
    if (cup.id) return cup.id;
    // Same legacy id as the original manual archive button, including across devices.
    const bytes = new TextEncoder().encode(JSON.stringify(cup.teams));
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    cup.id = 'legacy-' + Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
    return cup.id;
  },
  async sync(cup, { request, title, date }) {
    if (!this.complete(cup)) return { saved: false };
    const id = await this.ensureId(cup),
      data = await request('/api/leaderboard');
    if (!data.canEdit) throw Error('กรุณาเข้าสู่ระบบผู้จัดเพื่ออัปเดต Leaderboard');
    const previous = data.history.find(c => c.id === id);
    const payload = {
      title: previous?.title || title,
      date: previous?.date || date,
      inBaseline: previous?.inBaseline || false,
      teams: cup.teams,
      matches: cup.matches.map(({ a, b, sa, sb }) => ({ a, b, sa, sb })),
    };
    // Avoid unnecessary revisions and backups on an unchanged repeated save.
    if (
      previous &&
      JSON.stringify({ teams: previous.teams, matches: previous.matches }) ===
        JSON.stringify({ teams: payload.teams, matches: payload.matches })
    )
      return { saved: true, unchanged: true };
    await request('/api/leaderboard', { id, revision: previous?.revision || 0, cup: payload });
    return { saved: true };
  },
};
