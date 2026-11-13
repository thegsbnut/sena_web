// Pure helpers for the bills home page (who owes, reminder text, progress).
// No DOM and no API calls, so node tests and the browser share the same code.
// Amounts are cents. Callers must escape() any name before putting it in innerHTML.
(function (root) {
  function owing(bills) {
    const byName = new Map();
    let totalCents = 0,
      reviewCount = 0;
    for (const bill of bills) {
      if (bill.cancelled) continue;
      for (const p of bill.payers || []) {
        if (p.status === 'paid') continue;
        totalCents += p.amount;
        const group = byName.get(p.name) || {
          name: p.name,
          totalCents: 0,
          bills: 0,
          review: false,
        };
        group.totalCents += p.amount;
        group.bills += 1;
        if (p.status === 'review') group.review = true;
        byName.set(p.name, group);
      }
    }
    const groups = [...byName.values()].sort(
      (a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, 'th'),
    );
    for (const g of groups) if (g.review) reviewCount += 1;
    return { totalCents, people: groups.length, reviewCount, groups };
  }

  function reminderText(groups, clubName, money) {
    if (!groups.length) return '';
    return [
      'ค้างค่าใช้จ่าย · ' + clubName,
      ...groups.map(g => g.name + ' ' + money(g.totalCents) + ' บาท'),
    ].join('\n');
  }

  const progress = bill => (bill.count > 0 ? bill.paid / bill.count : 0);

  root.BillingOverview = { owing, reminderText, progress };
  if (typeof module !== 'undefined') module.exports = root.BillingOverview;
})(typeof window === 'undefined' ? globalThis : window);
