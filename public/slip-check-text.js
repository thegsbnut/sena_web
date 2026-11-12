// Organizer-only wording for the AI slip check. Plain text out: the caller
// must escape() it before putting it in innerHTML (names come from users).
(function (root) {
  const MONTHS = [
    'ม.ค.',
    'ก.พ.',
    'มี.ค.',
    'เม.ย.',
    'พ.ค.',
    'มิ.ย.',
    'ก.ค.',
    'ส.ค.',
    'ก.ย.',
    'ต.ค.',
    'พ.ย.',
    'ธ.ค.',
  ];
  const STALE_PENDING_MS = 120000;
  const WARNINGS = ['amount_mismatch', 'old_date', 'duplicate_ref', 'unreadable'];

  // '2026-11-12' -> '12 พ.ย. 69' (Buddhist-era year, two digits)
  function fmtDate(iso) {
    const [year, month, day] = String(iso).split('-').map(Number);
    return `${day} ${MONTHS[month - 1]} ${String(year + 543).slice(-2)}`;
  }
  function fmtBaht(satang) {
    const baht = satang / 100;
    return baht.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(baht) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }

  function describe(reason, check) {
    switch (reason.code) {
      case 'ok':
        return {
          icon: '✅',
          level: 'ok',
          text:
            `ตรวจผ่าน — ยอด ${fmtBaht(check.readAmount)} บาท` +
            (check.readDate ? ` · ${fmtDate(check.readDate)}` : ''),
        };
      case 'amount_mismatch':
        return {
          icon: '⚠️',
          level: 'warn',
          text: `ยอดเงินไม่ตรง — สลิป ${fmtBaht(reason.slipSatang)} บาท แต่บิล ${fmtBaht(reason.billSatang)} บาท`,
        };
      case 'old_date':
        return {
          icon: '⚠️',
          level: 'warn',
          text: `วันที่ไม่ตรง — สลิปลงวันที่ ${fmtDate(reason.slipDate)} ซึ่งก่อนวันตีแบด ${fmtDate(reason.billDate)}`,
        };
      case 'duplicate_ref':
        return {
          icon: '🚫',
          level: 'warn',
          text: `สลิปซ้ำ — ใช้แล้วในบิล${reason.billDate ? ' ' + fmtDate(reason.billDate) + ' ' : ''}ของ ${reason.payerName}`,
        };
      case 'unreadable':
        return {
          icon: '❓',
          level: 'warn',
          text:
            'สลิปไม่ชัดเจน — ' +
            ({
              not_slip: 'รูปนี้ไม่ใช่สลิปโอนเงิน',
              unparsed: 'AI อ่านสลิปไม่ได้ ลองตรวจอีกครั้งหรือเปิดดูเอง',
            }[reason.why] || 'อ่านยอดเงินไม่ได้'),
        };
      default:
        return { icon: 'ℹ️', level: 'info', text: 'อ่านวันที่ไม่ได้ (ไม่ได้ตัดสินเรื่องวันที่)' };
    }
  }

  // Payers whose finished check has a warning, for the summary card. Slips the
  // organizer already dealt with (sent back, or settled in cash) do not count.
  const flaggedCount = payers =>
    payers.filter(
      p =>
        p.status !== 'rejected' &&
        p.method !== 'cash' &&
        p.aiCheck?.state === 'done' &&
        p.aiCheck.reasons.some(r => WARNINGS.includes(r.code)),
    ).length;

  // The organizer may re-run a check that failed or has hung for 2+ minutes.
  const stale = (check, now = Date.now()) =>
    check.state === 'error' ||
    (check.state === 'pending' && now - check.checkedAt > STALE_PENDING_MS);

  root.SlipCheckText = { describe, flaggedCount, stale, fmtDate, fmtBaht };
  if (typeof module !== 'undefined') module.exports = root.SlipCheckText;
})(typeof window === 'undefined' ? globalThis : window);
