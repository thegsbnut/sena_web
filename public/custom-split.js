// Splits a custom (non-badminton) bill. Pure: shared by the browser form and the Worker.
// All money is integer satang; each payer row is rounded up to a whole baht.
(function (root) {
  const MAX_PEOPLE = 40,
    MAX_ITEMS = 30,
    MIN_TOTAL = 100,
    MAX_TOTAL = 10000000;
  const cents = n => Number.isSafeInteger(n);
  // floor(price / n) each, one extra satang to the first (price % n) people in order.
  function divide(price, indexes) {
    const sorted = [...indexes].sort((a, b) => a - b);
    const each = Math.floor(price / sorted.length),
      rest = price % sorted.length;
    return new Map(sorted.map((index, i) => [index, each + Number(i < rest)]));
  }
  function split(draft) {
    const { mode, people, receiver } = draft ?? {};
    if (!Array.isArray(people) || people.length < 2 || people.length > MAX_PEOPLE)
      return { error: 'ต้องมีผู้ร่วมจ่าย 2–' + MAX_PEOPLE + ' คน' };
    if (!people.some(p => !p.guest && p.payerKey === receiver))
      return { error: 'คนออกเงินต้องเป็นสมาชิกที่ร่วมจ่ายในบิล' };
    const owed = people.map(() => 0);
    let total;
    if (mode === 'even') {
      total = draft.total;
      if (!cents(total)) return { error: 'กรุณาใส่ยอดรวม' };
      for (const [i, amount] of divide(
        total,
        people.map((_, i) => i),
      ))
        owed[i] = amount;
    } else if (mode === 'manual') {
      const { amounts } = draft;
      if (
        !Array.isArray(amounts) ||
        amounts.length !== people.length ||
        !amounts.every(n => cents(n) && n >= 0)
      )
        return { error: 'กรุณาใส่ยอดของทุกคน' };
      amounts.forEach((n, i) => (owed[i] = n));
      total = amounts.reduce((sum, n) => sum + n, 0);
    } else if (mode === 'items') {
      const { items } = draft;
      if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS)
        return { error: 'ต้องมีรายการ 1–' + MAX_ITEMS + ' รายการ' };
      total = 0;
      const covered = new Set();
      for (const item of items) {
        const name = typeof item?.name === 'string' ? item.name.trim() : '';
        if (!name || name.length > 40) return { error: 'ชื่อรายการต้องยาว 1–40 ตัวอักษร' };
        if (!cents(item.price) || item.price < 1)
          return { error: 'ราคารายการ "' + name + '" ไม่ถูกต้อง' };
        const who = item.people;
        if (
          !Array.isArray(who) ||
          !who.length ||
          new Set(who).size !== who.length ||
          !who.every(i => Number.isInteger(i) && i >= 0 && i < people.length)
        )
          return { error: 'กรุณาเลือกคนร่วมจ่ายรายการ "' + name + '"' };
        for (const [i, amount] of divide(item.price, who)) {
          owed[i] += amount;
          covered.add(i);
        }
        total += item.price;
      }
      const missing = people.find((_, i) => !covered.has(i));
      if (missing) return { error: missing.name + ' ยังไม่ได้อยู่ในรายการไหนเลย' };
    } else return { error: 'วิธีหารไม่ถูกต้อง' };
    if (total < MIN_TOTAL || total > MAX_TOTAL)
      return { error: 'ยอดรวมต้องอยู่ระหว่าง 1 ถึง 100,000 บาท' };
    const byKey = new Map();
    people.forEach((person, i) => {
      let row = byKey.get(person.payerKey);
      if (!row) {
        row = { payerKey: person.payerKey, name: '', shares: [], amount: 0, owner: false };
        byKey.set(person.payerKey, row);
      }
      if (!person.guest) row.name = person.name;
      row.shares.push({ name: person.name, amount: owed[i] });
    });
    const payers = [];
    for (const row of byKey.values()) {
      const sum = row.shares.reduce((s, x) => s + x.amount, 0);
      row.owner = row.payerKey === receiver;
      row.amount = Math.ceil(sum / 100) * 100;
      if (sum > 0 || row.owner) payers.push(row);
    }
    if (!payers.some(p => !p.owner))
      return { error: 'ต้องมีคนจ่ายอย่างน้อยหนึ่งคนที่ไม่ใช่คนออกเงิน' };
    return { total, payers };
  }
  root.SenaCustomSplit = { split };
  if (typeof module !== 'undefined') module.exports = root.SenaCustomSplit;
})(typeof window === 'undefined' ? globalThis : window);
