// AI-assisted slip checking. Everything here is advisory: it never changes a
// payment status, and billing.js treats it as removable (see the design spec).

const THAI_MONTHS = [
  ['มกราคม', 'มค'],
  ['กุมภาพันธ์', 'กพ'],
  ['มีนาคม', 'มีค'],
  ['เมษายน', 'เมย'],
  ['พฤษภาคม', 'พค'],
  ['มิถุนายน', 'มิย'],
  ['กรกฎาคม', 'กค'],
  ['สิงหาคม', 'สค'],
  ['กันยายน', 'กย'],
  ['ตุลาคม', 'ตค'],
  ['พฤศจิกายน', 'พย'],
  ['ธันวาคม', 'ธค'],
];
const thaiMonth = new Map(THAI_MONTHS.flatMap((names, i) => names.map(name => [name, i + 1])));
const ENGLISH_MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

function buildDate(day, month, year, now) {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const nowYear = now.getUTCFullYear();
  if (year < nowYear - 2 || year > nowYear + 1) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

// Returns 'YYYY-MM-DD' (Gregorian) or null. Thai month names mean a Buddhist-era
// year, English month names a Gregorian one; two-digit years follow that rule.
export function parseSlipDate(text, now = new Date()) {
  if (typeof text !== 'string') return null;
  const numeric = text.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/);
  if (numeric) {
    let year = Number(numeric[3]);
    if (year > 2400) year -= 543;
    else if (year < 100) year += 2000;
    return buildDate(Number(numeric[1]), Number(numeric[2]), year, now);
  }
  const named = text.match(/(\d{1,2})\s+([^\d\s,]+)\s+(\d{2,4})/);
  if (!named) return null;
  const word = named[2].replaceAll('.', '');
  let year = Number(named[3]);
  let month = thaiMonth.get(word);
  if (month) {
    if (year < 100) year += 2500;
    if (year > 2400) year -= 543;
  } else {
    month = ENGLISH_MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
    if (year < 100) year += 2000;
  }
  return buildDate(Number(named[1]), month, year, now);
}

// Bank references are read by a model, so look-alike characters get merged
// before comparing (SCB references contain I, l and 1 side by side).
export const normalizeRef = ref =>
  String(ref ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/[li]/g, '1')
    .replace(/o/g, '0');

export const isUsableRef = norm => norm.length >= 10 && new Set(norm).size > 1;
