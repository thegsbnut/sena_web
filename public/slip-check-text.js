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
          text: reason.uploadDate
            ? `วันที่ไม่ตรง — สลิปลงวันที่ ${fmtDate(reason.slipDate)} ซึ่งเก่ากว่าวันที่ส่งสลิป ${fmtDate(reason.uploadDate)} เกิน ${reason.days} วัน`
            : // stored before the upload-date rule: no upload date to show
              `วันที่ไม่ตรง — สลิปลงวันที่ ${fmtDate(reason.slipDate)} เก่าเกินไป (กด "ตรวจอีกครั้ง" เพื่อตรวจด้วยกฎใหม่)`,
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

  // The organizer may re-run a check that failed, has hung for 2+ minutes, or was
  // stored under the earlier date rule (an old_date with no upload date).
  const stale = (check, now = Date.now()) =>
    check.state === 'error' ||
    (check.state === 'pending' && now - check.checkedAt > STALE_PENDING_MS) ||
    check.reasons?.some(r => r.code === 'old_date' && !r.uploadDate) === true;

  // Reason for "ให้ส่งใหม่", prefilled for the organizer. The player reads it, so it
  // never names another player or bill. Capped at the server's 240-character limit.
  const NOTE_MAX = 240;
  const playerWording = reason => {
    switch (reason.code) {
      case 'amount_mismatch':
        return `ยอดในสลิปไม่ตรงกับยอดที่ต้องจ่าย (สลิป ${fmtBaht(reason.slipSatang)} บาท ต้องจ่าย ${fmtBaht(reason.billSatang)} บาท)`;
      case 'old_date':
        return 'วันที่โอนในสลิปเก่าเกินไป กรุณาแนบสลิปที่โอนล่าสุด';
      case 'duplicate_ref':
        return 'สลิปนี้ถูกใช้ไปแล้ว กรุณาแนบสลิปที่ถูกต้อง';
      case 'unreadable':
        return 'สลิปไม่ชัดเจน กรุณาแนบภาพใหม่ให้เห็นยอดเงิน วันที่ และเลขอ้างอิง';
      default:
        return '';
    }
  };
  function rejectNote(check) {
    if (check?.state !== 'done') return '';
    const note = check.reasons.map(playerWording).filter(Boolean).join(' · ');
    return note.length > NOTE_MAX ? note.slice(0, NOTE_MAX - 1) + '…' : note;
  }

  root.SlipCheckText = { describe, flaggedCount, stale, fmtDate, fmtBaht, rejectNote };
  if (typeof module !== 'undefined') module.exports = root.SlipCheckText;
})(typeof window === 'undefined' ? globalThis : window);
