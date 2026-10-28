/**
 * FERRN COMMAND CENTRE — the engine
 * ------------------------------------------------------------------
 * Runs on Google's servers, free, every 10 minutes:
 *   1. Ingests new leads + messages written by the Claude daily routine
 *      (JSON files dropped into Drive › Ferrn Engine › inbox)
 *   2. Detects replies, bounces and "no thanks" in Gmail
 *   3. Sends queued emails (first touch, follow-ups, replies) inside your
 *      sending window and daily caps, threaded properly
 *   4. Writes the "Ferrn Brief" Google Doc the Claude routine reads
 * It also serves the dashboard web app (Dashboard.html).
 *
 * First run: select `setup` in the toolbar and press Run.
 */

// ───────────────────────────── constants ─────────────────────────────
var TZ = 'Africa/Lagos';

var HEADERS = {
  Leads: ['id', 'created', 'niche', 'company', 'website', 'email', 'phone', 'contact_name', 'role', 'city',
    'tier', 'score', 'gaps', 'pitch', 'est_value', 'status', 'preview_url', 'last_contact', 'last_reply',
    'next_action', 'needs_you', 'needs_you_reason', 'notes', 'source', 'thread_id'],
  Messages: ['id', 'lead_id', 'step', 'channel', 'to', 'subject', 'body', 'delay_days', 'send_after',
    'created', 'status', 'approved', 'sent_at', 'thread_id', 'gmail_id', 'error'],
  Inbox: ['id', 'lead_id', 'thread_id', 'gmail_id', 'from', 'received_at', 'subject', 'body', 'status',
    'classification', 'handled_at'],
  Suppression: ['email', 'reason', 'added'],
  Settings: ['key', 'value', 'help'],
  Log: ['time', 'level', 'event', 'detail']
};

var DEFAULT_SETTINGS = [
  ['AUTO_SEND', 'TRUE', 'TRUE = queued emails send on their own. FALSE = nothing sends until you press Send in the dashboard.'],
  ['HOLD_MINUTES', '30', 'A brand-new first email waits this long in "Sending soon" so you can stop it. 0 = no wait.'],
  ['FROM_ALIAS', 'michael@ferrnagency.com', 'Send-from address. Must be this Google account or a verified Gmail "Send mail as" address. Blank = this account.'],
  ['SENDER_NAME', 'Michael | Ferrn Digital Agency', 'Name people see.'],
  ['DAILY_CAP_FIRST', '25', 'Max first-touch emails per day. Keeps your domain out of spam.'],
  ['DAILY_CAP_TOTAL', '60', 'Max emails of any kind per day.'],
  ['SEND_DAYS', '1,2,3,4,5', 'Days to send: 1=Mon ... 7=Sun.'],
  ['SEND_START_HOUR', '8', 'Earliest send hour, Lagos time.'],
  ['SEND_END_HOUR', '17', 'Last send hour, Lagos time.'],
  ['SIGNATURE', 'Michael\nFerrn Digital Agency\nferrnagency.com', 'Added under every email.'],
  ['OPT_OUT_LINE', 'P.S. If this isn\'t relevant, just reply "no thanks" and I won\'t email again.', 'Added to first emails and follow-ups.'],
  ['OWNER_NAME', 'Michael', 'Your first name (used in messages).'],
  ['OWNER_WHATSAPP', '', 'Your WhatsApp number, e.g. 2348012345678. Used in replies when a lead wants to chat.'],
  ['MONTHLY_TARGET', '30000000', 'Monthly revenue target (naira).'],
  ['LEADS_PER_RUN', '15', 'New leads the morning routine should find each run.'],
  ['PREVIEWS_PER_RUN', '3', 'Concept websites the morning routine builds each run.'],
  ['NICHES', 'logistics,realestate,school,clinic', 'Niches the routine prospects, in rotation.'],
  ['CITIES', 'Lagos,Abuja,Port Harcourt', 'Cities the routine prospects.'],
  ['PREVIEWS_REPO', 'Boymyke/leadshunter', 'GitHub repo holding templates + preview sites (hosted on Cloudflare Pages).'],
  ['PREVIEW_BASE_URL', '', 'Where previews are live, e.g. https://leadshunter.pages.dev (your Cloudflare Pages address).'],
  ['ENGINE_FOLDER_ID', '', 'Set by setup().'],
  ['INBOX_FOLDER_ID', '', 'Set by setup().'],
  ['PROCESSED_FOLDER_ID', '', 'Set by setup().'],
  ['BRIEF_DOC_ID', '', 'Set by setup().'],
  ['API_KEY', '', 'Your dashboard access key (set by setup). Paste it into the dashboard Connect screen. Keep it secret.']
];

var STOP_STATUSES = ['Replied', 'Interested', 'Call booked', 'Proposal sent', 'Won', 'Lost', 'Opted out', 'Bounced'];
var CLOSED_STATUSES = ['Won', 'Lost', 'Opted out', 'Bounced'];
var LEAD_EDITABLE = ['niche', 'company', 'website', 'email', 'phone', 'contact_name', 'role', 'city', 'tier', 'score',
  'gaps', 'pitch', 'est_value', 'status', 'preview_url', 'next_action', 'needs_you', 'needs_you_reason', 'notes'];
var OPT_OUT_RE = /\b(unsubscribe|remove me|take me off|stop (emailing|messaging|contacting)|not interested|no thanks|no, thanks|do not (contact|email))\b/i;
var ATTENTION_RE = /\b(call|meet|meeting|zoom|google meet|price|pricing|cost|quote|quotation|how much|budget|proposal|invoice|contract|available|schedule|office|visit)\b/i;

// ───────────────────────────── setup ─────────────────────────────
function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(HEADERS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var h = HEADERS[name];
    var current = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
    if (current.join('|') !== h.join('|')) {
      // add any missing headers at the end, keep existing data intact
      var missing = h.filter(function (x) { return current.indexOf(x) === -1; });
      if (!current.filter(String).length) sh.getRange(1, 1, 1, h.length).setValues([h]);
      else if (missing.length) sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    }
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#0b1b2b').setFontColor('#ffffff');
  });
  var first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);

  // settings
  var st = table_('Settings');
  var have = {};
  st.rows.forEach(function (r) { have[r.key] = true; });
  var add = DEFAULT_SETTINGS.filter(function (d) { return !have[d[0]]; })
    .map(function (d) { return { key: d[0], value: d[1], help: d[2] }; });
  if (add.length) appendObjects_('Settings', add);
  ss.getSheetByName('Settings').setColumnWidth(2, 320).setColumnWidth(3, 520);

  // Drive folders + brief doc
  var s = settings_();
  var root = s.ENGINE_FOLDER_ID ? DriveApp.getFolderById(s.ENGINE_FOLDER_ID) : DriveApp.createFolder('Ferrn Engine');
  var inbox = s.INBOX_FOLDER_ID ? DriveApp.getFolderById(s.INBOX_FOLDER_ID) : root.createFolder('inbox');
  var processed = s.PROCESSED_FOLDER_ID ? DriveApp.getFolderById(s.PROCESSED_FOLDER_ID) : root.createFolder('processed');
  var briefId = s.BRIEF_DOC_ID;
  if (!briefId) {
    var doc = DocumentApp.create('Ferrn Brief');
    briefId = doc.getId();
    DriveApp.getFileById(briefId).moveTo(root);
  }
  DriveApp.getFileById(ss.getId()).moveTo(root);
  setSetting_('ENGINE_FOLDER_ID', root.getId());
  setSetting_('INBOX_FOLDER_ID', inbox.getId());
  setSetting_('PROCESSED_FOLDER_ID', processed.getId());
  setSetting_('BRIEF_DOC_ID', briefId);
  if (!settings_().API_KEY) setSetting_('API_KEY', 'fk_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 16));

  // one trigger, every 10 minutes
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(10).create();

  writeBrief_();
  log_('info', 'setup', 'Setup complete. Inbox folder ' + inbox.getId());
  return 'Setup complete. Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone). Your access key is in the Settings tab (API_KEY).';
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ferrn')
    .addItem('1. Run setup', 'setup')
    .addItem('Run engine now', 'tick')
    .addToUi();
}

// ───────────────────────────── main loop ─────────────────────────────
function tick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    safe_('ingest', ingest_);
    safe_('replies', checkReplies_);
    safe_('stale', markStale_);
    safe_('send', function () { sendDue_(false); });
    safe_('brief', writeBrief_);
  } finally {
    lock.releaseLock();
  }
}

function safe_(name, fn) {
  try { fn(); } catch (e) { log_('error', name, String(e && e.stack || e)); }
}

// ───────────────────────────── ingest ─────────────────────────────
function ingest_() {
  var s = settings_();
  if (!s.INBOX_FOLDER_ID) return;
  var inbox = DriveApp.getFolderById(s.INBOX_FOLDER_ID);
  var processed = DriveApp.getFolderById(s.PROCESSED_FOLDER_ID);
  var files = inbox.getFiles();
  var list = [];
  while (files.hasNext()) list.push(files.next());
  list.sort(function (a, b) { return a.getDateCreated() - b.getDateCreated(); });
  list.forEach(function (f) {
    try {
      var text = f.getBlob().getDataAsString('UTF-8');
      var data = JSON.parse(text);
      var summary = processBatch_(data);
      log_('info', 'ingest', f.getName() + ': ' + summary);
      f.moveTo(processed);
    } catch (e) {
      log_('error', 'ingest', f.getName() + ': ' + e);
      f.setName('ERROR - ' + f.getName());
      f.moveTo(processed);
    }
  });
}

function processBatch_(data) {
  var leadsT = table_('Leads');
  var now = new Date();
  var keyToId = {};
  var added = 0, dups = 0, msgs = 0, upd = 0;
  var suppressed = suppressionSet_();

  (data.leads || []).forEach(function (L) {
    var key = L.key || L.company;
    var dup = findDuplicate_(leadsT.rows, L);
    if (dup || (L.email && suppressed[String(L.email).trim().toLowerCase()])) { dups++; keyToId[key] = null; return; }
    var row = {};
    HEADERS.Leads.forEach(function (h) { row[h] = L[h] !== undefined ? L[h] : ''; });
    row.id = 'L-' + shortId_();
    row.created = now;
    row.email = String(row.email || '').trim().toLowerCase();
    row.status = L.status || (L.preview_url ? 'Preview ready' : 'New');
    appendObjects_('Leads', [row]);
    leadsT.rows.push(row);
    keyToId[key] = row.id;
    added++;
  });

  leadsT = table_('Leads');
  var byId = indexBy_(leadsT.rows, 'id');

  (data.lead_updates || []).forEach(function (u) {
    var r = byId[u.id];
    if (!r) return;
    var ch = {};
    LEAD_EDITABLE.forEach(function (k) { if (u[k] !== undefined) ch[k] = u[k]; });
    if (u.append_note) ch.notes = (r.notes ? r.notes + '\n' : '') + stamp_() + ' ' + u.append_note;
    updateRow_(leadsT, r, ch);
    upd++;
  });

  var newMsgs = [];
  (data.messages || []).forEach(function (m) {
    var leadId = m.lead_id || keyToId[m.lead_key];
    if (!leadId) return;
    var lead = byId[leadId];
    if (!lead) return;
    var channel = (m.channel || 'email').toLowerCase();
    var to = String(m.to || (channel === 'email' ? lead.email : lead.phone) || '').trim();
    if (!to) return;
    if (channel === 'email' && suppressed[to.toLowerCase()]) return;
    if (CLOSED_STATUSES.indexOf(lead.status) > -1 && String(m.step) !== 'R') return;
    var status = m.status || (channel === 'whatsapp' ? 'wa_pending' : (m.hold ? 'held' : 'queued'));
    var sendAfter = m.send_after ? new Date(m.send_after) : '';
    var delay = Number(m.delay_days || 0);
    var stepStr = String(m.step === undefined ? 0 : m.step);
    if (!sendAfter) {
      if (stepStr === '0' || stepStr === 'R' || !delay) sendAfter = now;
      else if (lead.last_contact) sendAfter = new Date(new Date(lead.last_contact).getTime() + delay * 86400000);
      // otherwise left blank: scheduled the moment the first message goes out
    }
    newMsgs.push({
      id: 'M-' + shortId_(), lead_id: leadId, step: String(m.step === undefined ? 0 : m.step), channel: channel,
      to: to, subject: m.subject || '', body: m.body || '', delay_days: delay || '', send_after: sendAfter,
      created: now, status: status, approved: '', sent_at: '', thread_id: '', gmail_id: '', error: ''
    });
    msgs++;
    if (String(m.step) === '0' && ['New', 'Preview ready'].indexOf(lead.status) > -1) {
      updateRow_(leadsT, lead, { status: channel === 'whatsapp' ? 'WhatsApp ready' : 'Queued' });
    }
  });
  if (newMsgs.length) appendObjects_('Messages', newMsgs);

  if (data.inbox_updates && data.inbox_updates.length) {
    var inT = table_('Inbox');
    var inById = indexBy_(inT.rows, 'id');
    data.inbox_updates.forEach(function (u) {
      var r = inById[u.id];
      if (!r) return;
      var ch = {};
      ['status', 'classification'].forEach(function (k) { if (u[k] !== undefined) ch[k] = u[k]; });
      if (ch.status === 'handled') ch.handled_at = new Date();
      updateRow_(inT, r, ch);
    });
  }
  if (data.log) log_('info', 'ai-run', String(data.log).slice(0, 4000));
  return 'leads +' + added + ' (dups ' + dups + '), updates ' + upd + ', messages +' + msgs;
}

function findDuplicate_(rows, L) {
  var email = String(L.email || '').trim().toLowerCase();
  var dom = domainOf_(L.website);
  var phone = digits_(L.phone);
  var comp = norm_(L.company);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (email && String(r.email).toLowerCase() === email) return r;
    if (dom && domainOf_(r.website) === dom) return r;
    if (phone && phone.length > 7 && digits_(r.phone).slice(-10) === phone.slice(-10)) return r;
    if (comp && norm_(r.company) === comp) return r;
  }
  return null;
}

// ───────────────────────────── sending ─────────────────────────────
function sendDue_(ignoreWindow) {
  var s = settings_();
  if (!isTrue_(s.AUTO_SEND) && !ignoreWindow) return;
  if (!ignoreWindow && !inWindow_(s)) return;
  var mT = table_('Messages');
  var lT = table_('Leads');
  var leads = indexBy_(lT.rows, 'id');
  var now = new Date();
  var today = dayKey_(now);
  var sentToday = 0, firstToday = 0;
  mT.rows.forEach(function (m) {
    if (m.status === 'sent' && m.channel === 'email' && m.sent_at && dayKey_(new Date(m.sent_at)) === today) {
      sentToday++;
      if (String(m.step) === '0') firstToday++;
    }
  });
  var capTotal = Number(s.DAILY_CAP_TOTAL || 60), capFirst = Number(s.DAILY_CAP_FIRST || 25);
  var holdMs = Number(s.HOLD_MINUTES || 0) * 60000;
  var order = { R: 0, '3': 1, '2': 2, '1': 3, '0': 4 };
  var due = mT.rows.filter(function (m) {
    return m.status === 'queued' && m.channel === 'email' && m.send_after && new Date(m.send_after) <= now;
  }).sort(function (a, b) {
    return (order[String(a.step)] || 9) - (order[String(b.step)] || 9) || new Date(a.send_after) - new Date(b.send_after);
  });
  var sentThisTick = 0;
  for (var i = 0; i < due.length && sentThisTick < 12; i++) {
    var m = due[i];
    var isFirst = String(m.step) === '0';
    if (isFirst && holdMs && m.approved !== 'Y' && (now - new Date(m.created)) < holdMs) continue;
    if (sentToday >= capTotal) break;
    if (isFirst && firstToday >= capFirst) continue;
    var ok = deliver_(m, leads[m.lead_id], mT, lT, s);
    if (ok) { sentToday++; sentThisTick++; if (isFirst) firstToday++; Utilities.sleep(1500); }
  }
}

/** Sends one message row. Returns true when an email actually went out. */
function deliver_(m, lead, mT, lT, s) {
  var step = String(m.step);
  var isReply = step === 'R';
  if (!lead) { updateRow_(mT, m, { status: 'cancelled', error: 'lead missing' }); return false; }
  if (suppressionSet_()[String(m.to).toLowerCase()]) { updateRow_(mT, m, { status: 'cancelled', error: 'suppressed' }); return false; }
  if (!isReply && step !== '0' && STOP_STATUSES.indexOf(lead.status) > -1) {
    updateRow_(mT, m, { status: 'cancelled', error: 'lead is ' + lead.status }); return false;
  }
  if (!isReply && CLOSED_STATUSES.indexOf(lead.status) > -1) {
    updateRow_(mT, m, { status: 'cancelled', error: 'lead is ' + lead.status }); return false;
  }
  if (step === '0' && lead.thread_id) {
    updateRow_(mT, m, { status: 'cancelled', error: 'first email already sent' }); return false;
  }
  try {
    var threadId = (step === '0') ? '' : (lead.thread_id || '');
    var meta = threadId ? threadMeta_(threadId) : null;
    var subject = m.subject || (meta ? meta.subject : 'Quick idea for ' + lead.company);
    if (meta && !/^re:/i.test(subject)) subject = 'Re: ' + meta.subject.replace(/^re:\s*/i, '');
    var body = m.body + '\n\n' + (s.SIGNATURE || '');
    if (!isReply && s.OPT_OUT_LINE) body += '\n\n' + s.OPT_OUT_LINE;
    var res = sendRaw_(m.to, subject, body, threadId, meta ? meta.lastMessageId : '', s);
    var now = new Date();
    updateRow_(mT, m, { status: 'sent', sent_at: now, thread_id: res.threadId, gmail_id: res.id, error: '' });
    var ch = { last_contact: now };
    if (!lead.thread_id) ch.thread_id = res.threadId;
    if (step === '0') ch.status = 'Contacted';
    else if (!isReply && ['Contacted', 'Following up', 'Queued'].indexOf(lead.status) > -1) ch.status = 'Following up';
    if (isReply) ch.next_action = 'Replied to them ' + stamp_();
    updateRow_(lT, lead, ch);
    if (step === '0') scheduleFollowUps_(lead.id, now, mT);
    return true;
  } catch (e) {
    updateRow_(mT, m, { status: 'failed', error: String(e).slice(0, 300) });
    log_('error', 'send', m.id + ' ' + e);
    return false;
  }
}

function scheduleFollowUps_(leadId, from, mT) {
  mT = mT || table_('Messages');
  mT.rows.forEach(function (x) {
    if (x.lead_id !== leadId) return;
    if (['queued', 'held', 'wa_pending'].indexOf(x.status) === -1) return;
    var st = String(x.step);
    if (st === '0' || st === 'R') return;
    var d = Number(x.delay_days || 0);
    if (!d) return;
    var when = new Date(from.getTime() + d * 86400000);
    updateRow_(mT, x, { send_after: when });
  });
}

function sendRaw_(to, subject, text, threadId, inReplyTo, s) {
  var me = Session.getEffectiveUser().getEmail();
  var fromAddr = s.FROM_ALIAS || me;
  var from = (s.SENDER_NAME ? encodeWord_(s.SENDER_NAME) + ' ' : '') + '<' + fromAddr + '>';
  var html = toHtml_(text);
  var boundary = 'ferrn_' + Utilities.getUuid().replace(/-/g, '');
  var head = [
    'From: ' + from,
    'To: ' + to,
    'Subject: ' + encodeWord_(subject),
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"'
  ];
  if (inReplyTo) { head.push('In-Reply-To: ' + inReplyTo); head.push('References: ' + inReplyTo); }
  var raw = head.join('\r\n') + '\r\n\r\n' +
    '--' + boundary + '\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    wrap76_(Utilities.base64Encode(text, Utilities.Charset.UTF_8)) + '\r\n' +
    '--' + boundary + '\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    wrap76_(Utilities.base64Encode(html, Utilities.Charset.UTF_8)) + '\r\n' +
    '--' + boundary + '--';
  var resource = { raw: Utilities.base64EncodeWebSafe(raw, Utilities.Charset.UTF_8) };
  if (threadId) resource.threadId = threadId;
  return Gmail.Users.Messages.send(resource, 'me');
}

function threadMeta_(threadId) {
  var t = Gmail.Users.Threads.get('me', threadId, { format: 'metadata', metadataHeaders: ['Message-ID', 'Message-Id', 'Subject'] });
  var msgs = t.messages || [];
  var hdr = function (msg, name) {
    var h = (msg.payload && msg.payload.headers) || [];
    for (var i = 0; i < h.length; i++) if (h[i].name.toLowerCase() === name.toLowerCase()) return h[i].value;
    return '';
  };
  return {
    subject: msgs.length ? hdr(msgs[0], 'Subject') : '',
    lastMessageId: msgs.length ? hdr(msgs[msgs.length - 1], 'Message-ID') : ''
  };
}

// ───────────────────────────── replies ─────────────────────────────
function checkReplies_() {
  var s = settings_();
  var lT = table_('Leads');
  var byThread = {}, byEmail = {};
  lT.rows.forEach(function (r) {
    if (r.thread_id) byThread[r.thread_id] = r;
    if (r.email) byEmail[String(r.email).toLowerCase()] = r;
  });
  if (!lT.rows.length) return;
  var inT = table_('Inbox');
  var seen = {};
  inT.rows.forEach(function (r) { seen[r.gmail_id] = true; });
  var mine = {};
  mine[Session.getEffectiveUser().getEmail().toLowerCase()] = true;
  if (s.FROM_ALIAS) mine[String(s.FROM_ALIAS).toLowerCase()] = true;

  // inbound mail from the last 2 days only (runs every 10 minutes, so nothing is missed)
  var threads = GmailApp.search('newer_than:2d -from:me -in:drafts -in:trash -in:spam', 0, 250);
  var newRows = [];
  threads.forEach(function (th) {
    var threadLead = byThread[th.getId()];
    th.getMessages().forEach(function (msg) {
      var gid = msg.getId();
      if (seen[gid]) return;
      var fromEmail = extractEmail_(msg.getFrom());
      if (mine[fromEmail]) return;
      var isBounce = /mailer-daemon|postmaster|mail delivery/i.test(msg.getFrom());
      var lead = threadLead || byEmail[fromEmail];
      if (!lead && isBounce) {
        var plain = msg.getPlainBody().toLowerCase();
        lead = lT.rows.filter(function (r) { return r.email && r.thread_id && plain.indexOf(String(r.email).toLowerCase()) > -1; })[0];
      }
      if (!lead) return;
      if (lead.created && msg.getDate() < new Date(lead.created)) return;
      seen[gid] = true;
      var body = isBounce ? 'Delivery failed.' : cleanReply_(msg.getPlainBody());
      var optOut = !isBounce && OPT_OUT_RE.test(body.slice(0, 600));
      newRows.push({
        id: 'I-' + shortId_(), lead_id: lead.id, thread_id: th.getId(), gmail_id: gid, from: msg.getFrom(),
        received_at: msg.getDate(), subject: msg.getSubject(), body: body.slice(0, 5000),
        status: (isBounce || optOut) ? 'handled' : 'new',
        classification: isBounce ? 'bounce' : (optOut ? 'opt-out' : ''),
        handled_at: (isBounce || optOut) ? new Date() : ''
      });
      if (isBounce) {
        updateRow_(lT, lead, { status: 'Bounced', next_action: 'Email bounced. Try WhatsApp/phone.' });
        cancelPending_(lead.id, 'bounced', true);
      } else if (optOut) {
        addSuppression_(fromEmail, 'replied: opt-out');
        if (lead.email && lead.email !== fromEmail) addSuppression_(lead.email, 'replied: opt-out');
        updateRow_(lT, lead, { status: 'Opted out', last_reply: msg.getDate(), next_action: 'Do not contact' });
        cancelPending_(lead.id, 'opted out', true);
      } else {
        var ch = { last_reply: msg.getDate(), next_action: 'AI will answer at the next reply check' };
        if (['Interested', 'Call booked', 'Proposal sent', 'Won'].indexOf(lead.status) === -1) ch.status = 'Replied';
        if (ATTENTION_RE.test(body.slice(0, 1500))) {
          ch.needs_you = 'Y';
          ch.needs_you_reason = 'They mentioned a call, meeting or price. Read their reply.';
        }
        updateRow_(lT, lead, ch);
        cancelPending_(lead.id, 'they replied', false);
      }
    });
  });
  if (newRows.length) {
    appendObjects_('Inbox', newRows);
    log_('info', 'replies', newRows.length + ' new inbound message(s)');
  }
}

/** cancels pending follow-ups (and first messages too when `all`). Replies (step R) are kept unless `all`. */
function cancelPending_(leadId, why, all) {
  var mT = table_('Messages');
  mT.rows.forEach(function (m) {
    if (m.lead_id !== leadId) return;
    if (['queued', 'held', 'wa_pending'].indexOf(m.status) === -1) return;
    var st = String(m.step);
    if (!all && (st === 'R')) return;
    if (!all && st === '0') return;
    updateRow_(mT, m, { status: 'cancelled', error: why });
  });
}

function markStale_() {
  var lT = table_('Leads');
  var mT = table_('Messages');
  var pending = {};
  mT.rows.forEach(function (m) {
    if (['queued', 'held', 'wa_pending'].indexOf(m.status) > -1) pending[m.lead_id] = true;
  });
  var cutoff = new Date(Date.now() - 7 * 86400000);
  lT.rows.forEach(function (r) {
    if (['Contacted', 'Following up'].indexOf(r.status) === -1) return;
    if (pending[r.id]) return;
    if (r.last_contact && new Date(r.last_contact) < cutoff) {
      updateRow_(lT, r, { status: 'No reply', next_action: 'Sequence finished. Revisit in 60 days.' });
    }
  });
}

// ───────────────────────────── brief for the AI routine ─────────────────────────────
function writeBrief_() {
  var s = settings_();
  if (!s.BRIEF_DOC_ID) return;
  var lT = table_('Leads'), mT = table_('Messages'), inT = table_('Inbox');
  var leads = indexBy_(lT.rows, 'id');
  var out = [];
  out.push('FERRN BRIEF (machine-readable, regenerated every 10 minutes)');
  out.push('generated_at: ' + iso_(new Date()));
  out.push('');
  out.push('== CONFIG ==');
  ['INBOX_FOLDER_ID', 'PREVIEWS_REPO', 'PREVIEW_BASE_URL', 'LEADS_PER_RUN', 'PREVIEWS_PER_RUN', 'NICHES', 'CITIES',
    'OWNER_NAME', 'OWNER_WHATSAPP', 'AUTO_SEND', 'DAILY_CAP_FIRST', 'FROM_ALIAS'].forEach(function (k) {
    out.push(k + ': ' + (s[k] || ''));
  });
  out.push('');
  var counts = {};
  lT.rows.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
  out.push('== PIPELINE COUNTS ==');
  out.push(JSON.stringify(counts));
  var nicheCount = {};
  lT.rows.forEach(function (r) { nicheCount[r.niche] = (nicheCount[r.niche] || 0) + 1; });
  out.push('leads_by_niche: ' + JSON.stringify(nicheCount));
  out.push('');

  out.push('== NEW REPLIES TO HANDLE ==');
  var newIn = inT.rows.filter(function (r) { return r.status === 'new'; });
  if (!newIn.length) out.push('(none)');
  newIn.forEach(function (r) {
    var L = leads[r.lead_id] || {};
    var lastOurs = mT.rows.filter(function (m) { return m.lead_id === r.lead_id && m.status === 'sent'; })
      .sort(function (a, b) { return new Date(b.sent_at) - new Date(a.sent_at); })[0];
    out.push('--- inbox_id: ' + r.id + ' | lead_id: ' + r.lead_id + ' | company: ' + (L.company || '') +
      ' | niche: ' + (L.niche || '') + ' | lead_status: ' + (L.status || '') + ' | preview_url: ' + (L.preview_url || ''));
    out.push('from: ' + r.from + ' | received: ' + iso_(r.received_at) + ' | subject: ' + r.subject);
    out.push('THEIR MESSAGE:\n' + String(r.body).slice(0, 2000));
    if (lastOurs) out.push('OUR LAST MESSAGE (' + iso_(lastOurs.sent_at) + '):\n' + String(lastOurs.body).slice(0, 1200));
    out.push('');
  });

  out.push('== INTERESTED / ACTIVE LEADS ==');
  lT.rows.filter(function (r) { return ['Interested', 'Call booked', 'Proposal sent'].indexOf(r.status) > -1; })
    .forEach(function (r) {
      out.push(r.id + ' | ' + r.company + ' | ' + r.niche + ' | ' + r.status + ' | preview: ' + (r.preview_url || '-') +
        ' | notes: ' + String(r.notes || '').replace(/\n/g, ' / ').slice(0, 300));
    });
  out.push('');

  out.push('== ALL LEADS (for de-duplication) ==');
  out.push('id | company | domain | email | phone | niche | city | status | tier');
  lT.rows.forEach(function (r) {
    out.push([r.id, r.company, domainOf_(r.website), r.email, digits_(r.phone), r.niche, r.city, r.status, r.tier].join(' | '));
  });
  DocumentApp.openById(s.BRIEF_DOC_ID).getBody().setText(out.join('\n'));
}

// ───────────────────────────── dashboard (web app) ─────────────────────────────
function doGet() {
  return ContentService.createTextOutput('Ferrn engine is running. Open your dashboard and connect it with your access key.');
}

/**
 * JSON API for the hosted dashboard (Cloudflare).
 * Body: {"key": "<API_KEY>", "fn": "getDashboardData" | "getLeadDetail" | "dashAction", "args": [...]}
 */
var API_FNS = ['getDashboardData', 'getLeadDetail', 'dashAction'];
function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var key = settings_().API_KEY;
    if (!key || typeof req.key !== 'string' || req.key !== key) {
      Utilities.sleep(1500);
      throw new Error('Wrong access key');
    }
    if (API_FNS.indexOf(req.fn) === -1) throw new Error('Unknown function');
    var fns = { getDashboardData: getDashboardData, getLeadDetail: getLeadDetail, dashAction: dashAction };
    out = { ok: true, data: fns[req.fn].apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function getDashboardData() {
  var s = settings_();
  var lT = table_('Leads'), mT = table_('Messages'), inT = table_('Inbox');
  var leads = indexBy_(lT.rows, 'id');
  var now = new Date();
  var today = dayKey_(now);
  var monthKey = Utilities.formatDate(now, TZ, 'yyyy-MM');
  var holdMs = Number(s.HOLD_MINUTES || 0) * 60000;

  var sentToday = 0, sentWeek = 0, contacted = 0, replied = 0, calls = 0, wonMonth = 0, pipelineValue = 0;
  mT.rows.forEach(function (m) {
    if (m.status === 'sent' || m.status === 'wa_sent') {
      if (m.sent_at && dayKey_(new Date(m.sent_at)) === today) sentToday++;
      if (m.sent_at && now - new Date(m.sent_at) < 7 * 86400000) sentWeek++;
    }
  });
  lT.rows.forEach(function (r) {
    if (['New', 'Preview ready', 'Queued', 'WhatsApp ready'].indexOf(r.status) === -1) contacted++;
    if (['Replied', 'Interested', 'Call booked', 'Proposal sent', 'Won'].indexOf(r.status) > -1) replied++;
    if (['Call booked', 'Proposal sent', 'Won'].indexOf(r.status) > -1) calls++;
    if (r.status === 'Won' && r.last_contact && Utilities.formatDate(new Date(r.last_contact), TZ, 'yyyy-MM') === monthKey) wonMonth += Number(r.est_value || 0);
    if (['Replied', 'Interested', 'Call booked', 'Proposal sent'].indexOf(r.status) > -1) pipelineValue += Number(r.est_value || 0);
  });

  var lite = function (r) {
    return {
      id: r.id, company: r.company, niche: r.niche, city: r.city, email: r.email, phone: r.phone, website: r.website,
      contact_name: r.contact_name, tier: r.tier, status: r.status, est_value: Number(r.est_value || 0),
      preview_url: r.preview_url, gaps: r.gaps, pitch: r.pitch, next_action: r.next_action,
      needs_you: r.needs_you, needs_you_reason: r.needs_you_reason, notes: r.notes,
      last_contact: iso_(r.last_contact), last_reply: iso_(r.last_reply), created: iso_(r.created)
    };
  };
  var msgLite = function (m) {
    var L = leads[m.lead_id] || {};
    var sendAt = m.send_after ? new Date(m.send_after) : null;
    if (String(m.step) === '0' && holdMs && m.approved !== 'Y') {
      var h = new Date(new Date(m.created).getTime() + holdMs);
      if (!sendAt || h > sendAt) sendAt = h;
    }
    return {
      id: m.id, lead_id: m.lead_id, company: L.company || '', step: String(m.step), channel: m.channel, to: m.to,
      subject: m.subject, body: m.body, status: m.status, send_at: iso_(sendAt), sent_at: iso_(m.sent_at),
      error: m.error, wa_link: m.channel === 'whatsapp' ? waLink_(m.to, m.body) : ''
    };
  };

  var needsYou = lT.rows.filter(function (r) { return r.needs_you === 'Y'; }).map(lite);
  var held = mT.rows.filter(function (m) { return m.status === 'held'; }).map(msgLite);
  var soonCut = new Date(now.getTime() + 24 * 3600000);
  var sendingSoon = mT.rows.filter(function (m) {
    if (m.status !== 'queued' || m.channel !== 'email') return false;
    var x = msgLite(m);
    return !x.send_at || new Date(x.send_at) <= soonCut;
  }).map(msgLite).sort(function (a, b) { return String(a.send_at).localeCompare(String(b.send_at)); }).slice(0, 60);
  var whatsapp = mT.rows.filter(function (m) {
    return m.status === 'wa_pending' && m.send_after && new Date(m.send_after) <= soonCut;
  }).map(msgLite).slice(0, 60);
  var recentSent = mT.rows.filter(function (m) { return m.status === 'sent' || m.status === 'wa_sent' || m.status === 'failed'; })
    .sort(function (a, b) { return new Date(b.sent_at || b.created) - new Date(a.sent_at || a.created); })
    .slice(0, 40).map(msgLite);
  var inbox = inT.rows.slice(-80).reverse().map(function (r) {
    var L = leads[r.lead_id] || {};
    return { id: r.id, lead_id: r.lead_id, company: L.company || '', from: r.from, received_at: iso_(r.received_at),
      subject: r.subject, body: r.body, status: r.status, classification: r.classification };
  });
  var statusCounts = {};
  lT.rows.forEach(function (r) { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
  var logs = table_('Log').rows.slice(-25).reverse().map(function (r) {
    return { time: iso_(r.time), level: r.level, event: r.event, detail: String(r.detail).slice(0, 400) };
  });

  return {
    generated_at: iso_(now),
    settings: {
      AUTO_SEND: isTrue_(s.AUTO_SEND), HOLD_MINUTES: Number(s.HOLD_MINUTES || 0), DAILY_CAP_FIRST: Number(s.DAILY_CAP_FIRST || 0),
      DAILY_CAP_TOTAL: Number(s.DAILY_CAP_TOTAL || 0), FROM_ALIAS: s.FROM_ALIAS, MONTHLY_TARGET: Number(s.MONTHLY_TARGET || 30000000),
      PREVIEW_BASE_URL: s.PREVIEW_BASE_URL, SEND_START_HOUR: s.SEND_START_HOUR, SEND_END_HOUR: s.SEND_END_HOUR,
      sheet_url: SpreadsheetApp.getActive().getUrl()
    },
    kpis: { leads: lT.rows.length, contacted: contacted, replied: replied, calls: calls, sentToday: sentToday,
      sentWeek: sentWeek, wonMonth: wonMonth, pipelineValue: pipelineValue },
    statusCounts: statusCounts,
    needsYou: needsYou, held: held, sendingSoon: sendingSoon, whatsapp: whatsapp, recentSent: recentSent,
    inbox: inbox, leads: lT.rows.slice().reverse().map(lite), logs: logs
  };
}

/** Full history for one lead (dashboard drawer). */
function getLeadDetail(id) {
  var L = indexBy_(table_('Leads').rows, 'id')[id];
  if (!L) return null;
  var msgs = table_('Messages').rows.filter(function (m) { return m.lead_id === id; }).map(function (m) {
    return { id: m.id, step: String(m.step), channel: m.channel, subject: m.subject, body: m.body, status: m.status,
      send_after: iso_(m.send_after), sent_at: iso_(m.sent_at), error: m.error,
      wa_link: m.channel === 'whatsapp' ? waLink_(m.to, m.body) : '' };
  });
  var inbox = table_('Inbox').rows.filter(function (r) { return r.lead_id === id; }).map(function (r) {
    return { id: r.id, from: r.from, received_at: iso_(r.received_at), body: r.body, status: r.status, classification: r.classification };
  });
  var lead = {};
  Object.keys(L).forEach(function (k) { if (k !== '_row') lead[k] = L[k] instanceof Date ? iso_(L[k]) : L[k]; });
  return { lead: lead, messages: msgs, inbox: inbox };
}

/** Every button in the dashboard calls this. */
function dashAction(action, p) {
  p = p || {};
  var mT = table_('Messages'), lT = table_('Leads');
  var msg = p.id ? indexBy_(mT.rows, 'id')[p.id] : null;
  var lead = p.lead_id ? indexBy_(lT.rows, 'id')[p.lead_id] : null;
  var s = settings_();
  switch (action) {
    case 'approve':
      if (msg) updateRow_(mT, msg, { status: msg.channel === 'whatsapp' ? 'wa_pending' : 'queued', approved: 'Y',
        send_after: msg.send_after && new Date(msg.send_after) > new Date() ? msg.send_after : new Date() });
      break;
    case 'hold':
      if (msg) updateRow_(mT, msg, { status: 'held' });
      break;
    case 'cancel':
      if (msg) updateRow_(mT, msg, { status: 'cancelled', error: 'cancelled by you' });
      break;
    case 'edit':
      if (msg) updateRow_(mT, msg, { subject: p.subject !== undefined ? p.subject : msg.subject, body: p.body !== undefined ? p.body : msg.body });
      break;
    case 'sendNow':
      if (msg && msg.channel === 'email') {
        updateRow_(mT, msg, { approved: 'Y' });
        var L = indexBy_(lT.rows, 'id')[msg.lead_id];
        var ok = deliver_(msg, L, mT, lT, s);
        if (!ok) throw new Error('Not sent: ' + (msg.error || 'see Log'));
      }
      break;
    case 'waSent':
      if (msg) {
        var t = new Date();
        updateRow_(mT, msg, { status: 'wa_sent', sent_at: t });
        var L2 = indexBy_(lT.rows, 'id')[msg.lead_id];
        if (L2) {
          var ch = { last_contact: t };
          if (String(msg.step) === '0') ch.status = 'Contacted';
          else if (['Contacted', 'Following up', 'WhatsApp ready'].indexOf(L2.status) > -1) ch.status = 'Following up';
          updateRow_(lT, L2, ch);
          if (String(msg.step) === '0') scheduleFollowUps_(L2.id, t, mT);
        }
      }
      break;
    case 'resolve':
      if (lead) updateRow_(lT, lead, { needs_you: '', needs_you_reason: '', next_action: p.note || lead.next_action });
      break;
    case 'setStatus':
      if (lead) {
        var c = { status: p.status };
        if (p.status === 'Won' || p.status === 'Lost') { c.needs_you = ''; c.last_contact = new Date(); }
        if (p.est_value !== undefined && p.est_value !== '') c.est_value = Number(p.est_value);
        updateRow_(lT, lead, c);
        if (STOP_STATUSES.indexOf(p.status) > -1) cancelPending_(lead.id, 'status set to ' + p.status, CLOSED_STATUSES.indexOf(p.status) > -1);
      }
      break;
    case 'note':
      if (lead) updateRow_(lT, lead, { notes: (lead.notes ? lead.notes + '\n' : '') + stamp_() + ' ' + p.note });
      break;
    case 'markInbox':
      var inT = table_('Inbox');
      var r = indexBy_(inT.rows, 'id')[p.id];
      if (r) updateRow_(inT, r, { status: 'handled', classification: r.classification || 'handled by you', handled_at: new Date() });
      break;
    case 'setSetting':
      if (['AUTO_SEND', 'HOLD_MINUTES', 'DAILY_CAP_FIRST', 'DAILY_CAP_TOTAL', 'PREVIEW_BASE_URL', 'MONTHLY_TARGET'].indexOf(p.key) > -1) setSetting_(p.key, String(p.value));
      break;
    case 'runNow':
      tick();
      break;
    default:
      throw new Error('Unknown action ' + action);
  }
  return getDashboardData();
}

// ───────────────────────────── table helpers ─────────────────────────────
function table_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  var values = sh.getDataRange().getValues();
  var headers = values.shift() || [];
  var rows = values.map(function (v, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = v[j]; });
    return o;
  });
  return { sheet: sh, headers: headers, rows: rows };
}

function appendObjects_(name, objs) {
  if (!objs.length) return;
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var data = objs.map(function (o) {
    return headers.map(function (h) { var v = o[h]; return v === undefined || v === null ? '' : cellSafe_(v); });
  });
  sh.getRange(sh.getLastRow() + 1, 1, data.length, headers.length).setValues(data);
}

function updateRow_(t, rowObj, changes) {
  Object.keys(changes).forEach(function (k) {
    var col = t.headers.indexOf(k);
    if (col === -1) return;
    var v = changes[k];
    t.sheet.getRange(rowObj._row, col + 1).setValue(v === undefined || v === null ? '' : cellSafe_(v));
    rowObj[k] = v;
  });
}

function cellSafe_(v) {
  // stop text that starts with = + - @ being treated as a formula
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function indexBy_(rows, key) {
  var o = {};
  rows.forEach(function (r) { o[r[key]] = r; });
  return o;
}

function settings_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Settings');
  var o = {};
  if (!sh) return o;
  sh.getDataRange().getValues().slice(1).forEach(function (r) { if (r[0]) o[r[0]] = String(r[1]); });
  return o;
}

function setSetting_(key, value) {
  var t = table_('Settings');
  var r = t.rows.filter(function (x) { return x.key === key; })[0];
  if (r) updateRow_(t, r, { value: value });
  else appendObjects_('Settings', [{ key: key, value: value, help: '' }]);
}

function suppressionSet_() {
  var o = {};
  table_('Suppression').rows.forEach(function (r) { if (r.email) o[String(r.email).toLowerCase()] = true; });
  return o;
}

function addSuppression_(email, reason) {
  email = String(email || '').toLowerCase();
  if (!email || suppressionSet_()[email]) return;
  appendObjects_('Suppression', [{ email: email, reason: reason, added: new Date() }]);
}

function log_(level, event, detail) {
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName('Log');
    if (!sh) return;
    sh.appendRow([new Date(), level, event, String(detail).slice(0, 4500)]);
    if (sh.getLastRow() > 3000) sh.deleteRows(2, 500);
  } catch (e) { /* ignore */ }
}

// ───────────────────────────── small utils ─────────────────────────────
function shortId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 8); }
function isTrue_(v) { return String(v).toUpperCase() === 'TRUE' || v === true; }
function stamp_() { return Utilities.formatDate(new Date(), TZ, 'dd MMM HH:mm'); }
function dayKey_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }
function iso_(d) {
  if (!d) return '';
  var x = d instanceof Date ? d : new Date(d);
  return isNaN(x.getTime()) ? '' : x.toISOString();
}
function norm_(s) { return String(s || '').toLowerCase().replace(/\b(ltd|limited|plc|nigeria|nig|company|co|inc)\b/g, '').replace(/[^a-z0-9]/g, ''); }
function digits_(s) { return String(s || '').replace(/\D/g, ''); }
function domainOf_(url) {
  var u = String(url || '').trim().toLowerCase();
  if (!u) return '';
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return u.split('/')[0].split('?')[0];
}
function extractEmail_(from) {
  var m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(from || '')).trim().toLowerCase();
}
function inWindow_(s) {
  var now = new Date();
  var day = Number(Utilities.formatDate(now, TZ, 'u'));
  var hour = Number(Utilities.formatDate(now, TZ, 'H'));
  var days = String(s.SEND_DAYS || '1,2,3,4,5').split(',').map(Number);
  return days.indexOf(day) > -1 && hour >= Number(s.SEND_START_HOUR || 8) && hour <= Number(s.SEND_END_HOUR || 17);
}
function cleanReply_(text) {
  var lines = String(text || '').split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (/^On .+wrote:\s*$/.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^From:\s/.test(l) && i > 0 ||
      /^Sent from my (iPhone|Android|phone)/i.test(l)) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}
function toHtml_(text) {
  var esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  esc = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a">' +
    esc.split(/\n\n+/).map(function (p) { return '<p style="margin:0 0 12px">' + p.replace(/\n/g, '<br>') + '</p>'; }).join('') + '</div>';
}
function encodeWord_(s) {
  return /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + '?=';
}
function wrap76_(b64) { return b64.replace(/(.{76})/g, '$1\r\n'); }
function waLink_(phone, text) {
  var d = digits_(phone);
  if (d.indexOf('0') === 0 && d.length === 11) d = '234' + d.slice(1);
  return 'https://wa.me/' + d + '?text=' + encodeURIComponent(text || '');
}
