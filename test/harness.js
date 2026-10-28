// Minimal fakes of Google Apps Script services, enough to run Code.gs end to end.
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

function makeEnv(opts = {}) {
  const sheets = {};
  let clock = opts.now ? new Date(opts.now) : new Date('2026-10-29T09:00:00+01:00');
  const sent = [];        // messages sent through Gmail advanced service
  const inboundThreads = []; // threads GmailApp.search returns
  const driveFiles = {};  // id -> {name, content, parent}
  const folders = {};
  const docs = {};
  const logs = [];

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) row.push((sh(this.sh)[this.r - 1 + i] || [])[this.c - 1 + j] ?? '');
        out.push(row);
      }
      return out;
    }
    setValues(vals) {
      vals.forEach((row, i) => row.forEach((v, j) => setCell(this.sh, this.r + i, this.c + j, v)));
      return this;
    }
    setValue(v) { setCell(this.sh, this.r, this.c, v); return this; }
    setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
  }
  const sh = (name) => sheets[name].data;
  function setCell(name, r, c, v) {
    const d = sh(name);
    while (d.length < r) d.push([]);
    const row = d[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v;
  }
  class Sheet {
    constructor(name) { this.name = name; sheets[name] = { data: [], obj: this }; }
    getLastRow() { return sh(this.name).length; }
    getLastColumn() { return Math.max(0, ...sh(this.name).map(r => r.length)); }
    getRange(r, c, nr, nc) { return new Range(this.name, r, c, nr, nc); }
    getDataRange() { return new Range(this.name, 1, 1, this.getLastRow(), this.getLastColumn()); }
    appendRow(row) { sh(this.name).push(row.slice()); }
    deleteRows(start, n) { sh(this.name).splice(start - 1, n); }
    setFrozenRows() { return this; } setColumnWidth() { return this; }
  }
  new Sheet('Sheet1');
  const ss = {
    getSheetByName: (n) => sheets[n] ? sheets[n].obj : null,
    insertSheet: (n) => new Sheet(n),
    getSheets: () => Object.values(sheets).map(s => s.obj),
    deleteSheet: (s) => { delete sheets[s.name]; },
    getId: () => 'SS1', getUrl: () => 'https://docs.google.com/spreadsheets/d/SS1',
  };

  const uuid = () => crypto.randomUUID();
  const Utilities = {
    getUuid: uuid,
    formatDate(d, tz, fmt) {
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d);
      const g = (t) => p.find(x => x.type === t).value;
      const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[g('weekday')];
      const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(g('month')) - 1];
      return fmt.replace('yyyy', g('year')).replace('MMM', mon).replace('MM', g('month')).replace('dd', g('day'))
        .replace('HH', g('hour')).replace('mm', g('minute')).replace(/^u$/, String(wd)).replace(/^H$/, String(Number(g('hour'))));
    },
    base64Encode: (s) => Buffer.from(s, 'utf8').toString('base64'),
    base64EncodeWebSafe: (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    Charset: { UTF_8: 'utf8' },
    sleep: () => {},
  };

  const me = opts.me || 'osondumichealcharles@gmail.com';
  let threadSeq = 0;
  const Gmail = {
    Users: {
      Messages: {
        send(resource) {
          const raw = Buffer.from(resource.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
          const id = 'g' + (sent.length + 1);
          const threadId = resource.threadId || ('t' + (++threadSeq));
          sent.push({ id, threadId, raw, at: new Date(clock) });
          return { id, threadId };
        },
      },
      Threads: {
        get(user, tid) {
          const msgs = sent.filter(s => s.threadId === tid).map(s => ({
            payload: { headers: [
              { name: 'Subject', value: (s.raw.match(/^Subject: (.*)$/m) || [])[1] },
              { name: 'Message-ID', value: '<' + s.id + '@mail.gmail.com>' },
            ] },
          }));
          return { messages: msgs };
        },
      },
    },
  };
  const GmailApp = {
    search: () => inboundThreads.map(t => ({
      getId: () => t.id,
      getMessages: () => t.messages.map(m => ({
        getId: () => m.id, getFrom: () => m.from, getDate: () => m.date, getSubject: () => m.subject,
        getPlainBody: () => m.body,
      })),
    })),
  };
  let folderSeq = 0;
  function makeFolder(name) {
    const id = 'F' + (++folderSeq);
    folders[id] = { id, name };
    return folderObj(id);
  }
  function folderObj(id) {
    return {
      getId: () => id,
      createFolder: (n) => makeFolder(n),
      getFiles: () => {
        const list = Object.entries(driveFiles).filter(([, f]) => f.parent === id).map(([fid]) => fileObj(fid));
        let i = 0;
        return { hasNext: () => i < list.length, next: () => list[i++] };
      },
    };
  }
  function fileObj(fid) {
    const f = driveFiles[fid];
    return {
      getName: () => f.name, setName: (n) => { f.name = n; },
      getDateCreated: () => f.created || new Date(),
      getBlob: () => ({ getDataAsString: () => f.content }),
      moveTo: (folder) => { f.parent = folder.getId(); },
    };
  }
  const DriveApp = {
    createFolder: makeFolder,
    getFolderById: (id) => folderObj(id),
    getFileById: (id) => ({ moveTo: () => {} }),
  };
  const DocumentApp = {
    create: (name) => { const id = 'D' + uuid().slice(0, 4); docs[id] = ''; return { getId: () => id }; },
    openById: (id) => ({ getBody: () => ({ setText: (t) => { docs[id] = t; } }) }),
  };
  const triggers = [];
  const ScriptApp = {
    getProjectTriggers: () => triggers,
    deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); },
    newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }),
  };
  const ctx = {
    SpreadsheetApp: { getActive: () => ss, getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }) },
    Utilities, Gmail, GmailApp, DriveApp, DocumentApp, ScriptApp,
    Session: { getEffectiveUser: () => ({ getEmail: () => me }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    HtmlService: {}, console,
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; }, getContent() { return t; } }) },
  };
  // controllable clock
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.getTime()); else super(...a); }
    static now() { return clock.getTime(); }
  }
  ctx.Date = FakeDate;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/Code.gs', 'utf8'), ctx);
  return {
    ctx, sheets, sent, inboundThreads, driveFiles, docs,
    setNow: (d) => { clock = new RealDate(d); },
    dropFile: (name, obj) => {
      const inboxId = ctx.settings_().INBOX_FOLDER_ID;
      driveFiles['X' + uuid().slice(0, 6)] = { name, content: JSON.stringify(obj), parent: inboxId, created: new RealDate(clock) };
    },
    rows: (name) => ctx.table_(name).rows,
    set: (k, v) => ctx.setSetting_(k, v),
  };
}
module.exports = { makeEnv };
