const ocrAssets = '/vendor/slip-ocr/';
const promptPayLabel = '(?:พร้อมเพย์|prompt\\s*pay)';
const receiverLabel = '(?:ผู้รับ(?:เงิน|โอน)?|ไปยัง|โอนไปยัง|recipient|to)';
const senderLabel = /^(?:ผู้โอน|ผู้ส่ง|จาก|sender|from)(?=[:\s]|$)/i;
const receiverLine = new RegExp('^' + receiverLabel + '(?=[:\\s]|$)', 'i');
const explicitReceiver = new RegExp('^(?:เลข)?' + promptPayLabel + '\\s*' + receiverLabel + '(?=[:\\s]|$)', 'i');
const promptPayLine = new RegExp('^(?:เลข)?' + promptPayLabel + '(?:\\s*' + receiverLabel + ')?\\s*[:：]?\\s*(.*)$', 'i');
const transferAmount = /^(?:จำนวนเงิน(?:ที่โอน)?|ยอดโอน|ยอดเงินที่โอน|(?:transfer )?amount)\s*[:：]?\s*(.*)$/i;
const bahtAmount = /^(?:฿\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)\s*(?:บาท|THB|฿)?$/i;

export function readSlipFields(text) {
 const lines = text.normalize('NFC').replaceAll('ํา', 'ำ').replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 0x0e50))
  .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
 const amounts = new Set(), recipients = new Set();
 let inReceiver = false;
 for (const [index, line] of lines.entries()) {
  const compact = line.replace(/พร้อม\s+เพย์/g, 'พร้อมเพย์');
  const amountLine = transferAmount.exec(compact);
  if (amountLine) {
   const amount = bahtAmount.exec(amountLine[1] || lines[index + 1] || '');
   if (amount) {
    const [baht, satang = '00'] = amount[1].replaceAll(',', '').split('.');
    const cents = Number(baht + satang);
    if (Number.isSafeInteger(cents) && cents > 0) amounts.add(cents);
   }
  }
  if (senderLabel.test(compact)) inReceiver = false;
  const receiver = receiverLine.exec(compact);
  if (receiver) inReceiver = true;
  const field = receiver ? compact.slice(receiver[0].length).replace(/^\s*[:：]?\s*/, '') : compact;
  const match = promptPayLine.exec(field);
  if (!match || (!inReceiver && !explicitReceiver.test(field))) continue;
  const number = (match[1] || lines[index + 1] || '').replace(/[\s-]/g, '');
  // The visible suffix must consist of four digits in a PromptPay field.
  if (/^(?:[0-9Xx*•]{6}|[0-9Xx*•]{9})\d{4}$/.test(number)) recipients.add(number.slice(-4));
 }
 return {
  amount: amounts.size === 1 ? amounts.values().next().value : null,
  recipient: recipients.size === 1 ? recipients.values().next().value : null
 };
}

export async function recognizeSlip(image) {
 let worker, timeout, expired = false;
 const read = async () => {
  const { default: { createWorker } } = await import(ocrAssets + 'tesseract.esm.min.js');
  if (expired) return {};
  const base = new URL(ocrAssets, location.origin).href;
  worker = await createWorker(['tha', 'eng'], 1, {
   workerPath: base + 'worker.min.js',
   corePath: base,
   langPath: base,
   workerBlobURL: false,
   errorHandler: () => {}
  });
  if (expired) {
   await worker.terminate();
   return {};
  }
  const { data } = await worker.recognize(image);
  return data.confidence >= 80 ? readSlipFields(data.text) : {};
 };
 try {
  return await Promise.race([
   read(),
   new Promise(resolve => { timeout = setTimeout(() => resolve({}), 25000); })
  ]);
 } catch {
  return {};
 } finally {
  clearTimeout(timeout);
  expired = true;
  if (worker) await worker.terminate().catch(() => {});
 }
}
