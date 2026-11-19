/**
 * מערכת חתימה דיגיטלית – צד שרת (Google Apps Script)
 * ---------------------------------------------------
 * אזור ניהול (admin.html): יצירת בקשות חתימה עם קישור ייחודי.
 * דף חתימה (index.html): החותם רואה את המסמך, חותם, והקובץ החתום
 * נשמר בדרייב ונשלח במייל.
 *
 * הגדרה: למלא FOLDER_ID ו-ADMIN_PASSWORD, לשמור, ולפרוס מחדש
 * (Deploy > Manage deployments > עריכה > Version: New version).
 */

const CONFIG = {
  // מזהה תיקיית הדרייב הראשית של המערכת
  FOLDER_ID: 'PASTE_DRIVE_FOLDER_ID_HERE',

  // סיסמה לאזור הניהול – לבחור סיסמה חזקה
  ADMIN_PASSWORD: 'CHANGE_ME',

  // כתובת דף החתימה ב-GitHub Pages
  FRONTEND_URL: 'https://shmulikc-arch.github.io/sign/',

  // לאן לשלוח עותק חתום. ריק = החשבון שפורס את הסקריפט
  NOTIFY_EMAIL: '',

  SHEET_NAME: 'בקשות חתימה',
  SOURCE_SUBFOLDER: 'מקור',
  SIGNED_SUBFOLDER: 'חתומים',
};

const COLS = ['id', 'created', 'title', 'recipient', 'phone', 'sourceFileId', 'fields', 'status', 'signedAt', 'signerName', 'signedFileId', 'device'];
const STATUS = { PENDING: 'ממתין', SIGNED: 'נחתם', CANCELLED: 'בוטל' };

/* ======================= ניתוב ======================= */

function doGet(e) {
  try {
    const p = e.parameter || {};
    if (p.action === 'get') return json_(getForSigner_(p.r));
    return json_({ ok: true, service: 'sign' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    switch (b.action) {
      case 'sign': return json_(sign_(b));
      case 'admin_login': return json_(admin_(b, () => ({ ok: true })));
      case 'admin_list': return json_(admin_(b, () => list_()));
      case 'admin_create': return json_(admin_(b, () => create_(b)));
      case 'admin_cancel': return json_(admin_(b, () => setStatus_(b.id, STATUS.CANCELLED)));
      case 'admin_reopen': return json_(admin_(b, () => setStatus_(b.id, STATUS.PENDING)));
      default: return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/* ======================= חותם ======================= */

function getForSigner_(id) {
  const rec = find_(id);
  if (!rec) return { ok: false, error: 'not_found' };
  if (rec.status === STATUS.CANCELLED) return { ok: false, error: 'cancelled' };
  if (rec.status === STATUS.SIGNED) return { ok: false, error: 'already_signed', title: rec.title };
  const blob = DriveApp.getFileById(rec.sourceFileId).getBlob();
  return {
    ok: true,
    title: rec.title,
    recipient: rec.recipient,
    fields: JSON.parse(rec.fields || '[]'),
    pdf: Utilities.base64Encode(blob.getBytes()),
  };
}

function sign_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rec = find_(b.r);
    if (!rec) return { ok: false, error: 'not_found' };
    if (rec.status !== STATUS.PENDING) return { ok: false, error: 'not_pending' };
    if (!b.pdf) return { ok: false, error: 'no_pdf' };

    const name = String(b.name || 'ללא שם').slice(0, 80);
    const stamp = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd HH-mm');
    const fileName = safeName_(rec.title) + ' - חתום - ' + safeName_(name) + ' - ' + stamp + '.pdf';
    const blob = Utilities.newBlob(Utilities.base64Decode(b.pdf), 'application/pdf', fileName);
    const file = sub_(CONFIG.SIGNED_SUBFOLDER).createFile(blob);

    update_(rec._row, {
      status: STATUS.SIGNED,
      signedAt: new Date(),
      signerName: name,
      signedFileId: file.getId(),
      device: String(b.ua || '').slice(0, 300),
    });

    const to = CONFIG.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
    MailApp.sendEmail({
      to: to,
      subject: '✅ נחתם: ' + rec.title + ' – ' + name,
      htmlBody:
        '<div dir="rtl" style="font-family:Arial">' +
        '<p><b>' + esc_(name) + '</b> חתם/ה על <b>' + esc_(rec.title) + '</b>.</p>' +
        '<p>הקובץ החתום מצורף, ונשמר גם בדרייב:<br><a href="' + file.getUrl() + '">' + esc_(fileName) + '</a></p>' +
        '<p style="color:#888;font-size:12px">זמן חתימה: ' + stamp + '</p></div>',
      attachments: [blob],
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/* ======================= ניהול ======================= */

function admin_(b, fn) {
  if (!CONFIG.ADMIN_PASSWORD || CONFIG.ADMIN_PASSWORD === 'CHANGE_ME') return { ok: false, error: 'no_password_set' };
  if (b.pw !== CONFIG.ADMIN_PASSWORD) { Utilities.sleep(1000); return { ok: false, error: 'bad_password' }; }
  return fn();
}

function list_() {
  const sh = sheet_();
  const rows = sh.getDataRange().getValues().slice(1);
  const items = rows.filter(r => r[0]).map(r => {
    const o = rowObj_(r);
    return {
      id: o.id,
      created: o.created ? new Date(o.created).toISOString() : '',
      title: o.title,
      recipient: o.recipient,
      phone: o.phone,
      status: o.status,
      signedAt: o.signedAt ? new Date(o.signedAt).toISOString() : '',
      signerName: o.signerName,
      signedUrl: o.signedFileId ? 'https://drive.google.com/file/d/' + o.signedFileId + '/view' : '',
      sourceUrl: o.sourceFileId ? 'https://drive.google.com/file/d/' + o.sourceFileId + '/view' : '',
      link: CONFIG.FRONTEND_URL + '?r=' + o.id,
    };
  }).reverse();
  return { ok: true, items: items, frontend: CONFIG.FRONTEND_URL };
}

function create_(b) {
  if (!b.pdf) return { ok: false, error: 'no_pdf' };
  const fields = Array.isArray(b.fields) ? b.fields : [];
  if (!fields.some(f => f.type === 'sig')) return { ok: false, error: 'no_signature_field' };

  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 22);
  const title = String(b.title || 'מסמך לחתימה').slice(0, 120);
  const blob = Utilities.newBlob(Utilities.base64Decode(b.pdf), 'application/pdf', safeName_(title) + ' - ' + id.slice(0, 6) + '.pdf');
  const file = sub_(CONFIG.SOURCE_SUBFOLDER).createFile(blob);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rec = {
      id: id, created: new Date(), title: title,
      recipient: String(b.recipient || '').slice(0, 80),
      phone: String(b.phone || '').replace(/[^\d+]/g, '').slice(0, 20),
      sourceFileId: file.getId(), fields: JSON.stringify(fields),
      status: STATUS.PENDING, signedAt: '', signerName: '', signedFileId: '', device: '',
    };
    sheet_().appendRow(COLS.map(c => rec[c]));
  } finally {
    lock.releaseLock();
  }
  return { ok: true, id: id, link: CONFIG.FRONTEND_URL + '?r=' + id };
}

function setStatus_(id, status) {
  const rec = find_(id);
  if (!rec) return { ok: false, error: 'not_found' };
  if (rec.status === STATUS.SIGNED) return { ok: false, error: 'already_signed' };
  update_(rec._row, { status: status });
  return { ok: true };
}

/* ======================= עזר ======================= */

function sheet_() {
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const it = folder.getFilesByName(CONFIG.SHEET_NAME);
  let ss;
  if (it.hasNext()) {
    ss = SpreadsheetApp.open(it.next());
  } else {
    ss = SpreadsheetApp.create(CONFIG.SHEET_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    const sh = ss.getSheets()[0];
    sh.appendRow(COLS);
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  return ss.getSheets()[0];
}

function find_(id) {
  if (!id) return null;
  const sh = sheet_();
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === id) { const o = rowObj_(vals[i]); o._row = i + 1; return o; }
  }
  return null;
}

function rowObj_(r) { const o = {}; COLS.forEach((c, i) => o[c] = r[i]); return o; }

function update_(row, patch) {
  const sh = sheet_();
  Object.keys(patch).forEach(k => {
    const col = COLS.indexOf(k);
    if (col >= 0) sh.getRange(row, col + 1).setValue(patch[k]);
  });
}

function sub_(name) {
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const it = folder.getFoldersByName(name);
  return it.hasNext() ? it.next() : folder.createFolder(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function safeName_(s) { return String(s).replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 80); }
function esc_(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* בדיקה ידנית: מריצים פעם אחת כדי לאשר הרשאות וליצור את הגיליון */
function setup() {
  sheet_(); sub_(CONFIG.SOURCE_SUBFOLDER); sub_(CONFIG.SIGNED_SUBFOLDER);
  Logger.log('מוכן. אזור הניהול: ' + CONFIG.FRONTEND_URL + 'admin.html');
}
