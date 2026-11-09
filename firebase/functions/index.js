/* Lembretes da Minha Rotina.
   A cada minuto, olha as atividades de hoje de cada pessoa e envia notificação push:
   - "9h"  → às 9:00 do dia (agrupa todas as atividades num só aviso)
   - "1h"  → 1 hora antes do horário da atividade
   - "0"   → no horário da atividade
   Atividades já concluídas não geram lembrete. Cada lembrete é enviado uma única vez. */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const REGION = 'southamerica-east1';
const DEFAULT_TZ = 'America/Bahia';
const WINDOW_MIN = 10; // se o agendador atrasar, ainda envia até 10 min depois

function localNow(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute), wd };
}
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

async function sendTo(userRef, user, title, body) {
  const entries = Object.entries(user.tokens || {});
  if (!entries.length) return 0;
  const link = user.appUrl || '/';
  const res = await admin.messaging().sendEachForMulticast({
    tokens: entries.map(([, v]) => v.token),
    notification: { title, body },
    webpush: { notification: { title, body, icon: link + 'icons/icon-192.png', badge: link + 'icons/icon-192.png' }, fcmOptions: { link } }
  });
  // Remove aparelhos que não recebem mais
  const dead = {};
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead[`tokens.${entries[i][0]}`] = admin.firestore.FieldValue.delete();
  });
  if (Object.keys(dead).length) await userRef.update(dead);
  return res.successCount;
}

async function processUser(userDoc) {
  const user = userDoc.data();
  if (!user.tokens || !Object.keys(user.tokens).length) return;
  const now = localNow(user.tz || DEFAULT_TZ);
  const ref = userDoc.ref;

  const [tasksSnap, routinesSnap, daySnap] = await Promise.all([
    ref.collection('tasks').where('date', '==', now.date).get(),
    ref.collection('routines').get(),
    ref.collection('days').doc(now.date).get()
  ]);
  const day = daySnap.exists ? daySnap.data() : {};
  const items = [];
  tasksSnap.forEach(d => { const t = d.data(); if (!t.done) items.push({ id: d.id, title: t.title, time: t.time || '', rem: t.reminders || [] }); });
  routinesSnap.forEach(d => {
    const r = d.data();
    const active = r.start <= now.date && (!r.end || now.date < r.end) && (r.days || []).includes(now.wd);
    if (active && !(day.rskip || {})[d.id] && !(day.rdone || {})[d.id]) items.push({ id: d.id, title: r.title, time: r.time || '', rem: r.reminders || [] });
  });

  const due = []; // { key, kind, item }
  for (const it of items) {
    const ev = it.time ? toMin(it.time) : null;
    for (const r of it.rem) {
      let fire;
      if (r === '9h') { fire = 9 * 60; if (ev !== null && ev <= fire) continue; }
      else if (r === '1h' && ev !== null) fire = ev - 60;
      else if (r === '0' && ev !== null) fire = ev;
      else continue;
      if (fire < 0) continue;
      if (now.min >= fire && now.min - fire <= WINDOW_MIN) due.push({ key: `${now.date}_${it.id}_${r}`, kind: r, item: it });
    }
  }
  if (!due.length) return;

  // Evita enviar duas vezes
  const sentRefs = due.map(d => ref.collection('sent').doc(d.key));
  const sentSnaps = await db.getAll(...sentRefs);
  const fresh = due.filter((d, i) => !sentSnaps[i].exists);
  if (!fresh.length) return;

  const morning = fresh.filter(d => d.kind === '9h');
  if (morning.length) {
    const list = morning.map(d => d.item.time ? `${d.item.title} às ${d.item.time}` : d.item.title);
    const title = morning.length === 1 ? `Hoje: ${morning[0].item.title}` : `Hoje você tem ${morning.length} atividades`;
    const body = morning.length === 1 ? (morning[0].item.time ? `Às ${morning[0].item.time}. Bom dia!` : 'Bom dia! Não esqueça.') : list.join(' · ');
    await sendTo(ref, user, title, body);
  }
  for (const d of fresh.filter(d => d.kind === '1h')) await sendTo(ref, user, `${d.item.title} em 1 hora`, `Começa às ${d.item.time}.`);
  for (const d of fresh.filter(d => d.kind === '0')) await sendTo(ref, user, `Agora: ${d.item.title}`, `Marcado para ${d.item.time}.`);

  const batch = db.batch();
  fresh.forEach(d => batch.set(ref.collection('sent').doc(d.key), { at: admin.firestore.FieldValue.serverTimestamp() }));
  await batch.commit();
}

exports.lembretes = onSchedule({ schedule: 'every 1 minutes', region: REGION, timeoutSeconds: 120, memory: '256MiB' }, async () => {
  const users = await db.collection('users').get();
  await Promise.all(users.docs.map(u => processUser(u).catch(err => console.error('usuario', u.id, err))));
});

// Botão "Testar" do app: envia um lembrete de teste depois de 10 segundos.
exports.testeLembrete = onDocumentCreated({ document: 'users/{uid}/tests/{id}', region: REGION }, async event => {
  await new Promise(r => setTimeout(r, 10000));
  const userRef = db.collection('users').doc(event.params.uid);
  const user = (await userRef.get()).data() || {};
  await sendTo(userRef, user, 'Lembrete de teste', 'Funcionando! Assim vão chegar seus lembretes.');
  await event.data.ref.delete();
});
