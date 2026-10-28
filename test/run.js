const assert = require('assert');
const { makeEnv } = require('./harness');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓ ' + msg); }

console.log('1. setup');
const E = makeEnv({ now: '2026-10-29T08:50:00+01:00' }); // Thursday
const r = E.ctx.setup();
ok(/Setup complete/.test(r), 'setup returns success');
ok(['Leads', 'Messages', 'Inbox', 'Suppression', 'Settings', 'Log'].every(n => E.sheets[n]), 'all tabs created');
ok(!E.sheets['Sheet1'], 'blank Sheet1 removed');
const S = E.ctx.settings_();
ok(S.INBOX_FOLDER_ID && S.BRIEF_DOC_ID, 'folders + brief doc created');
ok(S.FROM_ALIAS === 'michael@ferrnagency.com', 'sends from michael@ferrnagency.com by default');
E.ctx.setup();
ok(E.rows('Settings').length === E.ctx.DEFAULT_SETTINGS.length, 'setup is safe to run twice');

console.log('2. ingest a batch from the AI routine');
E.dropFile('batch-1.json', {
  leads: [
    { key: 'acme', company: 'Acme Freight Ltd', niche: 'logistics', website: 'https://www.acmefreight.ng/about', email: 'Info@AcmeFreight.ng', city: 'Lagos', tier: 'A', est_value: 2500000, gaps: 'no quote form' },
    { key: 'kola', company: 'Kola Haulage', niche: 'logistics', phone: '0803 111 2222', city: 'Lagos', tier: 'C' },
    { key: 'acme2', company: 'ACME FREIGHT', website: 'acmefreight.ng' },
  ],
  messages: [
    { lead_key: 'acme', step: 0, channel: 'email', subject: 'Acme Freight: quick idea', body: 'Hi Tunde,\n\nI noticed your site has no quote form.' },
    { lead_key: 'acme', step: 1, channel: 'email', delay_days: 3, body: 'Just bringing this back up.' },
    { lead_key: 'acme', step: 2, channel: 'email', delay_days: 7, body: '=HYPERLINK("x") one quick thought.' },
    { lead_key: 'acme', step: 3, channel: 'email', delay_days: 14, body: 'Last note from me.' },
    { lead_key: 'kola', step: 0, channel: 'whatsapp', body: 'Hi, I found Kola Haulage but no website.' },
    { lead_key: 'kola', step: 1, channel: 'whatsapp', delay_days: 3, body: 'Following up.' },
    { lead_key: 'acme2', step: 0, channel: 'email', to: 'x@acmefreight.ng', body: 'dup' },
  ],
  log: 'Run 1: 3 leads',
});
E.ctx.tick();
const leads = E.rows('Leads');
ok(leads.length === 2, 'duplicate lead (same domain) skipped');
const acme = leads.find(l => l.company === 'Acme Freight Ltd');
ok(acme.email === 'info@acmefreight.ng', 'email normalised to lowercase');
ok(acme.status === 'Queued', 'acme status Queued');
ok(E.rows('Messages').length === 6, '6 messages queued (dup lead message dropped)');
ok(E.rows('Messages').find(m => String(m.step) === '2').body.startsWith('=HYPERLINK'), 'formula-looking text stored as plain text');
ok(E.sent.length === 0, 'outside window (08:50) nothing sent');

console.log('3. hold window + first send');
E.setNow('2026-10-29T09:05:00+01:00');
E.ctx.tick();
ok(E.sent.length === 0, 'first email held for 30 minutes');
E.setNow('2026-10-29T09:25:00+01:00');
E.ctx.tick();
ok(E.sent.length === 1, 'first email sent after hold');
const raw = E.sent[0].raw;
ok(/From: Michael \| Ferrn Digital Agency <michael@ferrnagency.com>/.test(raw), 'From header uses alias + name');
ok(/To: info@acmefreight.ng/.test(raw), 'sent to the lead');
const body0 = Buffer.from(raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString();
ok(/no thanks/.test(body0) && /ferrnagency.com/.test(body0), 'signature + opt-out line added');
let acmeL = E.rows('Leads').find(l => l.id === acme.id);
ok(acmeL.status === 'Contacted' && acmeL.thread_id, 'lead Contacted with thread id');
const f1 = E.rows('Messages').find(m => String(m.step) === '1' && m.lead_id === acme.id);
ok(Math.round((new Date(f1.send_after) - new Date('2026-10-29T09:25:00+01:00')) / 86400000) === 3, 'follow-up 1 scheduled +3 days from actual send');

console.log('4. follow-up on the weekend waits for Monday, threads correctly');
E.setNow('2026-11-01T10:00:00+01:00'); // Sunday
E.ctx.tick();
ok(E.sent.length === 1, 'nothing sent on Sunday');
E.setNow('2026-11-02T08:10:00+01:00'); // Monday
E.ctx.tick();
ok(E.sent.length === 2, 'follow-up 1 sent Monday morning');
ok(E.sent[1].threadId === E.sent[0].threadId, 'follow-up sent in the same Gmail thread');
ok(/Subject: Re: Acme Freight: quick idea/.test(E.sent[1].raw), 'follow-up subject is Re: original');
ok(/In-Reply-To: <g1@mail.gmail.com>/.test(E.sent[1].raw), 'In-Reply-To header set');
ok(E.rows('Leads').find(l => l.id === acme.id).status === 'Following up', 'lead Following up');

console.log('5. reply detection');
E.inboundThreads.push({ id: E.sent[0].threadId, messages: [
  { id: 'in1', from: 'Tunde <info@acmefreight.ng>', date: new Date('2026-11-02T11:00:00+01:00'), subject: 'Re: Acme Freight: quick idea',
    body: 'Thanks Michael. How much would this cost? Can we do a call Thursday?\n\nOn Mon, Nov 2, 2026 Michael wrote:\n> Just bringing this back up.' },
] });
E.setNow('2026-11-02T11:05:00+01:00');
E.ctx.tick();
const inbox = E.rows('Inbox');
ok(inbox.length === 1 && inbox[0].status === 'new', 'reply captured in Inbox as new');
ok(!/wrote:/.test(inbox[0].body), 'quoted history stripped from reply');
acmeL = E.rows('Leads').find(l => l.id === acme.id);
ok(acmeL.status === 'Replied', 'lead status Replied');
ok(acmeL.needs_you === 'Y', 'call/price mention flagged for you');
ok(E.rows('Messages').filter(m => m.lead_id === acme.id && ['2', '3'].includes(String(m.step))).every(m => m.status === 'cancelled'), 'remaining follow-ups cancelled');
const brief = Object.values(E.docs)[0];
ok(/NEW REPLIES TO HANDLE[\s\S]*How much would this cost/.test(brief), 'brief shows the reply for the AI routine');
ok(/INBOX_FOLDER_ID: F\d/.test(brief), 'brief carries the inbox folder id');
E.ctx.tick();
ok(E.rows('Inbox').length === 1, 'same reply not captured twice');

console.log('6. AI reply goes out in-thread, inbox marked handled');
E.dropFile('batch-2.json', {
  messages: [{ lead_id: acme.id, step: 'R', channel: 'email', to: 'info@acmefreight.ng', body: 'Great question Tunde. Sites like this usually run ₦1.5M–₦3M.' }],
  inbox_updates: [{ id: inbox[0].id, status: 'handled', classification: 'pricing + call request' }],
  lead_updates: [{ id: acme.id, status: 'Interested', append_note: 'Asked for price + call' }],
});
E.setNow('2026-11-02T13:00:00+01:00');
E.ctx.tick();
ok(E.sent.length === 3 && E.sent[2].threadId === E.sent[0].threadId, 'reply sent in same thread');
ok(!/no thanks/.test(Buffer.from(E.sent[2].raw.split('base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString()), 'no opt-out line on direct replies');
ok(/Subject: =\?UTF-8\?B\?|Subject: Re:/.test(E.sent[2].raw), 'subject encoded/threaded');
ok(E.rows('Inbox')[0].status === 'handled', 'inbox item handled');
ok(E.rows('Leads').find(l => l.id === acme.id).status === 'Interested', 'lead moved to Interested');

console.log('7. opt-out + bounce');
E.dropFile('batch-3.json', {
  leads: [
    { key: 'b', company: 'Beta Clinic', niche: 'clinic', email: 'hello@betaclinic.ng', website: 'betaclinic.ng' },
    { key: 'c', company: 'Gamma Homes', niche: 'realestate', email: 'sales@gammahomes.ng', website: 'gammahomes.ng' },
  ],
  messages: [
    { lead_key: 'b', step: 0, subject: 'Beta Clinic', body: 'Hi' }, { lead_key: 'b', step: 1, delay_days: 3, body: 'fu' },
    { lead_key: 'c', step: 0, subject: 'Gamma Homes', body: 'Hi' }, { lead_key: 'c', step: 1, delay_days: 3, body: 'fu' },
  ],
});
E.setNow('2026-11-03T09:00:00+01:00');
E.ctx.tick();
E.setNow('2026-11-03T09:40:00+01:00');
E.ctx.tick();
const beta = E.rows('Leads').find(l => l.company === 'Beta Clinic');
const gamma = E.rows('Leads').find(l => l.company === 'Gamma Homes');
ok(beta.thread_id && gamma.thread_id, 'both first emails sent');
E.inboundThreads.push({ id: beta.thread_id, messages: [{ id: 'in2', from: 'hello@betaclinic.ng', date: new Date('2026-11-03T10:00:00+01:00'), subject: 'Re', body: 'No thanks, please remove me.' }] });
E.inboundThreads.push({ id: gamma.thread_id, messages: [{ id: 'in3', from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', date: new Date('2026-11-03T09:41:00+01:00'), subject: 'Delivery Status Notification', body: 'Address not found sales@gammahomes.ng' }] });
E.setNow('2026-11-03T10:05:00+01:00');
E.ctx.tick();
ok(E.rows('Leads').find(l => l.id === beta.id).status === 'Opted out', 'opt-out detected');
ok(E.rows('Suppression').some(s => s.email === 'hello@betaclinic.ng'), 'opted-out email suppressed');
ok(E.rows('Leads').find(l => l.id === gamma.id).status === 'Bounced', 'bounce detected');
ok(E.rows('Messages').filter(m => [beta.id, gamma.id].includes(m.lead_id) && String(m.step) === '1').every(m => m.status === 'cancelled'), 'their follow-ups cancelled');
E.dropFile('batch-4.json', { leads: [{ key: 'b2', company: 'Beta Clinic Two', email: 'hello@betaclinic.ng' }], messages: [{ lead_key: 'b2', step: 0, body: 'x' }] });
E.ctx.tick();
ok(E.rows('Leads').filter(l => l.email === 'hello@betaclinic.ng').length === 1, 'opted-out address never re-added');

console.log('8. daily caps');
const many = [], mm = [];
for (let i = 0; i < 30; i++) { many.push({ key: 'k' + i, company: 'Co ' + i + 'x', email: `a${i}@co${i}.ng`, website: `co${i}.ng` }); mm.push({ lead_key: 'k' + i, step: 0, subject: 'Hi', body: 'b' }); }
E.dropFile('batch-5.json', { leads: many, messages: mm });
E.set('HOLD_MINUTES', '0');
E.setNow('2026-11-04T09:00:00+01:00');
for (let t = 0; t < 6; t++) { E.ctx.tick(); }
const firstsToday = E.sent.filter(s => s.at.toISOString().startsWith('2026-11-04') && !/In-Reply-To/.test(s.raw)).length;
ok(firstsToday === 25, 'first-touch cap of 25/day respected (sent ' + firstsToday + ')');

console.log('9. dashboard + WhatsApp flow');
const kola = E.rows('Leads').find(l => l.company === 'Kola Haulage');
let d = E.ctx.getDashboardData();
JSON.parse(JSON.stringify(d));
ok(true, 'dashboard data is serialisable');
const wa = d.whatsapp.find(w => w.lead_id === kola.id);
ok(wa && wa.wa_link.startsWith('https://wa.me/2348031112222?text='), 'WhatsApp one-tap link with +234 number');
ok(!d.whatsapp.some(w => w.lead_id === kola.id && w.step === '1'), 'WA follow-up hidden until first is sent');
d = E.ctx.dashAction('waSent', { id: wa.id });
ok(E.rows('Leads').find(l => l.id === kola.id).status === 'Contacted', 'marking WA sent moves lead to Contacted');
const waf = E.rows('Messages').find(m => m.lead_id === kola.id && String(m.step) === '1');
ok(waf.send_after, 'WA follow-up scheduled after you send the first one');
ok(d.needsYou.some(n => n.id === acme.id), 'needs-you list includes the call/price lead');
d = E.ctx.dashAction('resolve', { lead_id: acme.id });
ok(!d.needsYou.some(n => n.id === acme.id), 'resolve clears the flag');
d = E.ctx.dashAction('setStatus', { lead_id: acme.id, status: 'Won', est_value: 3000000 });
ok(d.kpis.wonMonth === 3000000, 'won value counts toward the monthly target');
E.set('AUTO_SEND', 'FALSE');
E.dropFile('batch-6.json', { leads: [{ key: 'z', company: 'Zeta', email: 'z@zeta.ng' }], messages: [{ lead_key: 'z', step: 0, body: 'hi' }] });
const before = E.sent.length;
E.setNow('2026-11-05T09:00:00+01:00');
E.ctx.tick();
ok(E.sent.length === before, 'AUTO_SEND=FALSE: nothing sends on its own');
const zm = E.rows('Messages').find(m => m.to === 'z@zeta.ng');
E.ctx.dashAction('sendNow', { id: zm.id });
ok(E.sent.length === before + 1, 'Send now works from the dashboard');

console.log('10. stale leads');
E.setNow('2026-12-10T09:00:00+01:00');
E.ctx.tick();
ok(E.rows('Leads').some(l => l.status === 'No reply'), 'finished sequences marked No reply');
ok(!E.rows('Log').some(l => l.level === 'error'), 'no errors in the log');

console.log('11. AI batch exactly as the routine writes it');
const E2 = makeEnv({ now: '2026-10-29T10:00:00+01:00' });
E2.ctx.setup();
E2.set('HOLD_MINUTES', '0');
E2.dropFile('batch-2026-10-29-0700.json', {
  leads: [{ key: 'lyon', company: 'Lyon Grand Cargo', niche: 'logistics', website: 'https://lyon-grand-cargo-logistics.onrender.com', email: 'lyongrandcargo24@gmail.com', phone: '+234 707 091 9004', contact_name: 'Edmond Lyon', role: 'CEO', city: 'Lagos', tier: 'A', score: 88, gaps: 'free subdomain; broken link', pitch: 'site + quote form', est_value: 2500000, preview_url: 'https://previews.ferrnagency.com/lyon-grand-cargo/', source: 'https://lyon-grand-cargo-logistics.onrender.com', notes: '' }],
  messages: [
    { lead_key: 'lyon', step: 0, channel: 'email', subject: 'Lyon Grand Cargo: your contact page', body: 'Hi Mr Lyon, ...', delay_days: 0, hold: false },
    { lead_key: 'lyon', step: 1, channel: 'email', body: 'bump', delay_days: 3, hold: false },
  ],
  lead_updates: [], inbox_updates: [], log: 'Morning run: 1 lead',
});
E2.ctx.tick();
ok(E2.sent.length === 1, 'routine batch ingested and first email sent');
ok(E2.rows('Leads')[0].preview_url.endsWith('/lyon-grand-cargo/'), 'preview link stored on the lead');
const lyonId = E2.rows('Leads')[0].id;
E2.inboundThreads.push({ id: E2.sent[0].threadId, messages: [{ id: 'x1', from: 'Edmond <lyongrandcargo24@gmail.com>', date: new Date('2026-10-29T10:30:00+01:00'), subject: 'Re', body: 'Not right now, maybe next year.' }] });
E2.setNow('2026-10-29T10:35:00+01:00');
E2.ctx.tick();
const ib = E2.rows('Inbox')[0];
E2.dropFile('batch-2026-10-29-1142.json', {
  messages: [{ lead_id: lyonId, step: 'R', channel: 'email', to: 'lyongrandcargo24@gmail.com', body: 'Understood, thank you.', hold: false },
             { lead_id: lyonId, step: 'R', channel: 'email', to: 'lyongrandcargo24@gmail.com', body: 'Draft needing OK', hold: true }],
  lead_updates: [{ id: lyonId, status: 'Lost', append_note: 'Revisit in 90 days', needs_you: '' }],
  inbox_updates: [{ id: ib.id, status: 'handled', classification: 'not now' }],
  log: 'Reply check',
});
E2.setNow('2026-10-29T11:50:00+01:00');
E2.ctx.tick();
ok(E2.sent.length === 2, 'reply to a "not now" lead still goes out even though lead is Lost');
ok(E2.rows('Messages').some(m => m.status === 'held'), 'held reply waits for your OK');
ok(/Revisit in 90 days/.test(E2.rows('Leads')[0].notes), 'note appended with timestamp');
ok(E2.ctx.getDashboardData().held.length === 1, 'held reply shows in Needs you');
ok(/leads_by_niche: \{"logistics":1\}/.test(Object.values(E2.docs)[0]), 'brief reports leads by niche for rotation');

console.log('12. hosted dashboard API');
const key = E2.ctx.settings_().API_KEY;
ok(/^fk_[0-9a-f]{48}$/.test(key), 'setup generated a long random access key');
const post = (body) => JSON.parse(E2.ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
let res = post({ key: 'wrong', fn: 'getDashboardData' });
ok(!res.ok && /Wrong access key/.test(res.error), 'wrong key rejected');
res = post({ fn: 'getDashboardData' });
ok(!res.ok, 'missing key rejected');
res = post({ key, fn: 'setup' });
ok(!res.ok && /Unknown function/.test(res.error), 'only dashboard functions are callable');
res = post({ key, fn: 'getDashboardData' });
ok(res.ok && res.data.kpis.leads === 1, 'right key returns the dashboard data');
res = post({ key, fn: 'dashAction', args: ['setSetting', { key: 'AUTO_SEND', value: 'FALSE' }] });
ok(res.ok && res.data.settings.AUTO_SEND === false, 'dashboard actions work through the API');
ok(/running/.test(E2.ctx.doGet().getContent()), 'GET shows a plain status page (no dashboard served from Google)');
ok(!/API_KEY/.test(Object.values(E2.docs)[0]), 'access key never written into the brief');
module.exports.E2 = E2;

console.log(`\nALL ${passed} CHECKS PASSED`);
