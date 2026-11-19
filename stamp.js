/* מוטבע בדף החתימה ובאזור הניהול: ציור שדות על PDF עם pdf-lib.
   שדה: { type: 'sig'|'date'|'name'|'text', page, x, y, w, h, value }
   (נקודות PDF, ראשית בפינה השמאלית התחתונה של העמוד) */
(function (global) {
  const INK = [0.1, 0.16, 0.55];
  const HEB = /[\u0590-\u05FF]/;
  const FONT_URL = new URL('fonts/LiberationSans-Regular.ttf', document.currentScript ? document.currentScript.src : location.href).href;
  let fontBytes = null;

  function todayStr() {
    const d = new Date();
    return [d.getDate(), d.getMonth() + 1, d.getFullYear()].map(n => String(n).padStart(2, '0')).join('/');
  }

  // סידור חזותי פשוט לטקסט עברי מעורב (pdf-lib מצייר משמאל לימין)
  function splitRuns(str) {
    const runs = [];
    const re = /([֐-׿\s"'׳״:;!?()]+)|([^֐-׿\s"'׳״:;!?()]+)/g;
    let m;
    while ((m = re.exec(str))) runs.push(m[1] !== undefined ? { rtl: true, t: m[1] } : { rtl: false, t: m[2] });
    return runs;
  }
  function visualOrder(str) {
    if (!HEB.test(str)) return str;
    return splitRuns(str).reverse().map(r => r.rtl ? [...r.t].reverse().map(mirror).join('') : r.t).join('');
  }
  // fontkit מבצע בעצמו היפוך: כשהתו החזק הראשון עברי – הופך את כל השורה,
  // וכשהוא לטיני – הופך רק את קטעי העברית. מפצים על כך כדי לקבל סדר נכון.
  function forFont(text, custom) {
    const vis = visualOrder(text);
    if (!custom || !HEB.test(text)) return vis;
    const first = (text.match(/[A-Za-z\u0590-\u05FF]/) || [''])[0];
    if (HEB.test(first)) return [...vis].reverse().join('');
    return splitRuns(text).reverse().map(r => r.t).join('');
  }
  function mirror(c) { return c === '(' ? ')' : c === ')' ? '(' : c; }

  async function stamp(pdfBytes, fields, opts) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const doc = await PDFDocument.load(pdfBytes);
    const color = rgb(...INK);
    const pages = doc.getPages();
    const vals = { date: todayStr(), name: (opts && opts.name) || '' };
    const needHeb = fields.some(f => (f.type === 'text' && HEB.test(f.value || '')) || (f.type === 'name' && HEB.test(vals.name)));
    let font;
    if (needHeb) {
      doc.registerFontkit(global.fontkit);
      if (!fontBytes) fontBytes = await (await fetch(FONT_URL)).arrayBuffer();
      font = await doc.embedFont(fontBytes, { subset: true });
    } else {
      font = await doc.embedFont(StandardFonts.Helvetica);
    }
    const sig = opts && opts.sigPng ? await doc.embedPng(opts.sigPng) : null;

    for (const f of fields) {
      const p = pages[f.page];
      if (!p) continue;
      if (f.type === 'sig') {
        if (!sig) continue;
        const r = Math.min(f.w / sig.width, f.h / sig.height);
        const w = sig.width * r, h = sig.height * r;
        p.drawImage(sig, { x: f.x + (f.w - w) / 2, y: f.y + (f.h - h) / 2, width: w, height: h });
        continue;
      }
      let text = f.type === 'date' ? vals.date : f.type === 'name' ? vals.name : (f.value || '');
      if (f.type === 'check') text = 'X';
      if (!text) continue;
      const shown = forFont(text, needHeb);
      let size = Math.min(f.h * 0.8, 14);
      while (size > 6 && font.widthOfTextAtSize(shown, size) > f.w) size -= 0.5;
      const tw = font.widthOfTextAtSize(shown, size);
      const x = f.type === 'check' ? f.x + (f.w - tw) / 2 : f.x + f.w - tw;   // יישור לימין, כמו בעורך
      const y = f.y + (f.h - size) / 2 + size * 0.18;
      p.drawText(shown, { x, y, size, font, color });
    }
    return await doc.save();
  }

  global.Stamp = { stamp, todayStr, visualOrder, forFont };
})(window);
