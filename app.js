/* Minha Rotina — lógica do app.
   Modo nuvem: Firebase (Auth + Firestore + Cloud Messaging) quando firebase-config.js está preenchido.
   Modo local: tudo fica no aparelho (localStorage), usado na prévia. */

const FB_VERSION = '10.12.2';
const FB = n => `https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-${n}.js`;
const CFG = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) ? window.FIREBASE_CONFIG : null;

/* ---------- Datas ---------- */
const DOW = ['dom','seg','ter','qua','qui','sex','sáb'];
const DOW_FULL = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const MON = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const pad = n => String(n).padStart(2,'0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parse = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y,m-1,d); };
const addDays = (k,n) => { const d = parse(k); d.setDate(d.getDate()+n); return keyOf(d); };
const todayKey = () => keyOf(new Date());
const uid = () => Math.random().toString(36).slice(2,10) + Date.now().toString(36);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);

/* ---------- Estado ---------- */
let S = { tasks:[], routines:[], rdone:{}, rskip:{} };
const DKEY = 'minha-rotina.device';   // só deste aparelho: credencial do Face ID, id do aparelho
const LKEY = 'minha-rotina.v1';       // dados no modo local
let DEV;
try { DEV = JSON.parse(localStorage.getItem(DKEY)) || {}; } catch { DEV = {}; }
if (!DEV.id) DEV.id = uid();
const saveDev = () => { try { localStorage.setItem(DKEY, JSON.stringify(DEV)); } catch {} };
if (!CFG){
  try { const L = JSON.parse(localStorage.getItem(LKEY)); if (L){ S = { tasks:L.tasks||[], routines:L.routines||[], rdone:L.rdone||{}, rskip:L.rskip||{} }; if (L.auth && !DEV.faceId) DEV.faceId = L.auth.id; } } catch {}
}
saveDev();
const saveLocal = () => { if (!CFG) try { localStorage.setItem(LKEY, JSON.stringify(S)); } catch {} };

/* ---------- Firebase ---------- */
let fb = null;        // { app, db, auth, fs, user }
let unsubs = [];
let dataReady = !CFG;

async function initFirebase(){
  const [appM, authM, fs] = await Promise.all([import(FB('app')), import(FB('auth')), import(FB('firestore'))]);
  const app = appM.initializeApp(CFG);
  let db;
  try { db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
  catch { db = fs.getFirestore(app); }
  const auth = authM.getAuth(app);
  fb = { app, db, auth, fs, authM, user:null };
  authM.onAuthStateChanged(auth, user => {
    fb.user = user;
    unsubs.forEach(u => u()); unsubs = [];
    if (user){ subscribe(); registerUser(); }
    else { S = { tasks:[], routines:[], rdone:{}, rskip:{} }; dataReady = false; }
    paintLock();
  });
}

const col = n => fb.fs.collection(fb.db, 'users', fb.user.uid, n);
const ref = (n, id) => fb.fs.doc(fb.db, 'users', fb.user.uid, n, id);
const clean = o => Object.fromEntries(Object.entries(o).filter(([k,v]) => k !== 'id' && v !== undefined));

function subscribe(){
  const { onSnapshot } = fb.fs;
  let got = 0; const mark = () => { if (++got === 3){ dataReady = true; migrateLocal(); } schedule(); };
  unsubs.push(onSnapshot(col('tasks'), s => { S.tasks = s.docs.map(d => ({ id:d.id, ...d.data() })); mark(); }));
  unsubs.push(onSnapshot(col('routines'), s => { S.routines = s.docs.map(d => ({ id:d.id, ...d.data() })); mark(); }));
  unsubs.push(onSnapshot(col('days'), s => {
    S.rdone = {}; S.rskip = {};
    s.docs.forEach(d => { const v = d.data();
      for (const [rid,ts] of Object.entries(v.rdone||{})) S.rdone[d.id+'|'+rid] = ts;
      for (const rid of Object.keys(v.rskip||{})) S.rskip[d.id+'|'+rid] = 1; });
    mark();
  }));
}

/* Sobe para a nuvem, uma única vez, o que já estava salvo só neste aparelho. */
async function migrateLocal(){
  const key = 'migrated_' + fb.user.uid;
  if (DEV[key]) return;
  let L = null; try { L = JSON.parse(localStorage.getItem(LKEY)); } catch {}
  const tasks = (L && L.tasks || []).filter(t => !t.demo), routines = (L && L.routines || []).filter(r => !r.demo);
  if (!tasks.length && !routines.length){ DEV[key] = true; saveDev(); return; }
  try {
    const { writeBatch } = fb.fs; let b = writeBatch(fb.db), n = 0;
    const add = async (r, data, opt) => { opt ? b.set(r, data, opt) : b.set(r, data); if (++n >= 400){ await b.commit(); b = writeBatch(fb.db); n = 0; } };
    const rids = new Set(routines.map(r => r.id));
    for (const t of tasks) await add(ref('tasks', t.id), clean({ ...t, reminders: t.reminders || [] }));
    for (const r of routines) await add(ref('routines', r.id), clean({ ...r, reminders: r.reminders || [] }));
    const days = {};
    for (const [k, v] of Object.entries(L.rdone || {})){ const [d, rid] = k.split('|'); if (rids.has(rid)) ((days[d] ||= {}).rdone ||= {})[rid] = v; }
    for (const k of Object.keys(L.rskip || {})){ const [d, rid] = k.split('|'); if (rids.has(rid)) ((days[d] ||= {}).rskip ||= {})[rid] = 1; }
    for (const [d, v] of Object.entries(days)) await add(ref('days', d), v, { merge: true });
    await b.commit();
    DEV[key] = true; saveDev();
    toast(`${tasks.length + routines.length} atividades deste aparelho foram para a nuvem`);
  } catch (err){ console.error('migração', err); }
}

function registerUser(){
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bahia';
  const appUrl = location.origin + location.pathname.replace(/index\.html$/,'');
  fb.fs.setDoc(fb.fs.doc(fb.db,'users',fb.user.uid), { tz, appUrl, email:fb.user.email||'' }, { merge:true }).catch(()=>{});
  if ('Notification' in window && Notification.permission === 'granted') enablePush(true);
}

/* ---------- Operações (nuvem ou local) ---------- */
const api = {
  addTask(t){ if (fb) fb.fs.setDoc(ref('tasks', t.id), clean(t)); else { S.tasks.push(t); saveLocal(); render(); } },
  updateTask(id, p){ if (fb) fb.fs.updateDoc(ref('tasks', id), p); else { Object.assign(S.tasks.find(x => x.id === id), p); saveLocal(); render(); } },
  deleteTask(id){ if (fb) fb.fs.deleteDoc(ref('tasks', id)); else { S.tasks = S.tasks.filter(x => x.id !== id); saveLocal(); render(); } },
  addRoutine(r){ if (fb) fb.fs.setDoc(ref('routines', r.id), clean(r)); else { S.routines.push(r); saveLocal(); render(); } },
  updateRoutine(id, p){ if (fb) fb.fs.updateDoc(ref('routines', id), p); else { Object.assign(S.routines.find(x => x.id === id), p); saveLocal(); render(); } },
  deleteRoutine(id){ if (fb) fb.fs.deleteDoc(ref('routines', id)); else { S.routines = S.routines.filter(x => x.id !== id); saveLocal(); render(); } },
  setMark(date, field, rid, val){
    if (fb){ fb.fs.setDoc(ref('days', date), { [field]: { [rid]: val == null ? fb.fs.deleteField() : val } }, { merge:true }); return; }
    const m = field === 'rdone' ? S.rdone : S.rskip, k = date+'|'+rid;
    if (val == null) delete m[k]; else m[k] = val; saveLocal(); render();
  }
};

/* ---------- Regras do dia ---------- */
let today = todayKey();
let sel = today;
const modeOf = k => k < today ? 'past' : k === today ? 'today' : 'future';

function itemsFor(k){
  const wd = parse(k).getDay();
  const t = S.tasks.filter(x => x.date === k)
    .map(x => ({ kind:'task', id:x.id, title:x.title, time:x.time||'', done:!!x.done, rem:x.reminders||[], demo:x.demo }));
  const r = S.routines.filter(x => x.start <= k && (!x.end || k < x.end) && (x.days||[]).includes(wd) && !S.rskip[k+'|'+x.id])
    .map(x => ({ kind:'routine', id:x.id, title:x.title, time:x.time||'', done:!!S.rdone[k+'|'+x.id], days:x.days, rem:x.reminders||[], demo:x.demo }));
  const tk = x => x.time || '99';
  return [...t, ...r].sort((a,b) => tk(a) < tk(b) ? -1 : tk(a) > tk(b) ? 1 : a.title.localeCompare(b.title));
}

function toggle(item){
  // Regra principal: só o dia de hoje pode ser marcado.
  const m = modeOf(sel);
  if (m === 'past') return toast('Dia encerrado. Não é possível alterar.');
  if (m === 'future') return toast('Você poderá concluir quando o dia chegar.');
  if (item.kind === 'task') api.updateTask(item.id, { done: !item.done, doneAt: !item.done ? Date.now() : null });
  else api.setMark(sel, 'rdone', item.id, item.done ? null : Date.now());
}

/* ---------- Render ---------- */
const ICON = {
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8.5a6 6 0 0 0-12 0c0 7-3 8.5-3 8.5h18s-3-1.5-3-8.5"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/></svg>',
  repeat:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  dots:'<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>',
  lock:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  trash:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  skip:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
  stop:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  copy:'<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h12M13 6l6 6-6 6"/></svg>'
};
const repLabel = days => days.length === 7 ? 'Todo dia' : (days.join() === '1,2,3,4,5' ? 'Seg a sex' : days.map(d => DOW[d]).join(' · '));
const remLabel = (rem, time) => rem.filter(r => r !== '9h' || !time || time > '09:00').filter(r => r === '9h' || time)
  .map(r => r === '9h' ? '9h' : r === '1h' ? '1h antes' : 'na hora').join(', ');

let rq = 0;
function schedule(){ if (!rq) rq = requestAnimationFrame(() => { rq = 0; render(); }); }

function render(){
  const d = parse(sel), m = modeOf(sel);
  $('h-eyebrow').textContent = (m === 'today' ? 'Hoje · ' : sel === addDays(today,-1) ? 'Ontem · ' : sel === addDays(today,1) ? 'Amanhã · ' : '') + DOW_FULL[d.getDay()];
  $('h-date').innerHTML = `${d.getDate()} de <em>${MON[d.getMonth()]}</em>`;

  // Semana (domingo a sábado)
  const start = addDays(sel, -d.getDay());
  const s0 = parse(start), s6 = parse(addDays(start,6));
  $('w-label').textContent = s0.getMonth() === s6.getMonth()
    ? `${s0.getDate()} – ${s6.getDate()} de ${MON[s6.getMonth()]}`
    : `${s0.getDate()} ${MON[s0.getMonth()].slice(0,3)} – ${s6.getDate()} ${MON[s6.getMonth()].slice(0,3)}`;
  $('btn-today').hidden = sel === today;
  let html = '';
  for (let i = 0; i < 7; i++){
    const k = addDays(start,i), it = itemsFor(k), done = it.filter(x => x.done).length, dk = parse(k);
    let mark = '';
    if (it.length){
      if (k > today) mark = 'plan';
      else if (k === today) mark = done === it.length ? 'all' : 'plan';
      else mark = done === it.length ? 'all' : done === 0 ? 'none' : 'part';
    }
    html += `<button class="day${k===today?' is-today':''}${k===sel?' is-sel':''}" data-k="${k}" aria-label="${dk.getDate()} de ${MON[dk.getMonth()]}">
      <span class="dw">${DOW[i]}</span><span class="dn">${dk.getDate()}</span><span class="mark ${mark}"></span></button>`;
  }
  $('days').innerHTML = html;

  // Resumo
  const items = itemsFor(sel), done = items.filter(x => x.done), open = items.filter(x => !x.done);
  const pct = items.length ? Math.round(done.length / items.length * 100) : 0;
  $('ring-val').style.strokeDashoffset = 169.6 * (1 - pct/100);
  $('ring-pct').textContent = pct + '%';
  $('sum-big').textContent = items.length ? `${done.length} de ${items.length} concluídas` : (dataReady ? 'Nada planejado' : 'Carregando…');
  $('sum-sub').textContent = !items.length ? (m === 'past' ? 'Nenhuma atividade neste dia.' : 'Adicione sua primeira atividade.')
    : m === 'past' ? (open.length ? `${open.length} ${open.length > 1 ? 'ficaram' : 'ficou'} sem concluir` : 'Dia completo.')
    : m === 'future' ? 'Planejamento do dia'
    : open.length ? `Faltam ${open.length}` : 'Tudo feito por hoje.';

  const st = $('status');
  if (m === 'past'){ st.hidden = false; st.className = 'status'; st.innerHTML = ICON.lock + '<span>Dia encerrado · somente leitura</span>'; }
  else if (m === 'future'){ st.hidden = false; st.className = 'status future'; st.innerHTML = ICON.cal + '<span>Dia futuro · você pode planejar, concluir só no dia</span>'; }
  else st.hidden = true;

  const row = x => {
    const missed = m === 'past' && !x.done;
    const cls = ['item', x.done?'done':'', missed?'missed':'', m!=='today'?'locked':''].join(' ');
    const rl = m !== 'past' && !x.done ? remLabel(x.rem, x.time) : '';
    const meta = [
      x.time ? `<span class="tag">${ICON.clock}${x.time}</span>` : '',
      CFG && rl ? `<span class="tag">${ICON.bell}${rl}</span>` : '',
      x.kind === 'routine' ? `<span class="tag">${ICON.repeat}${repLabel(x.days)}</span>` : '',
      missed ? `<span class="tag miss">Não concluída</span>` : ''
    ].join('');
    return `<div class="${cls}" data-id="${x.id}" data-kind="${x.kind}">
      <button class="check" data-act="toggle" aria-label="${x.done?'Desmarcar':'Concluir'} ${esc(x.title)}"${m!=='today'?' aria-disabled="true"':''}>${ICON.check}</button>
      <div class="i-body"><span class="i-title">${esc(x.title)}</span>${meta?`<span class="i-meta">${meta}</span>`:''}</div>
      <button class="more" data-act="more" aria-label="Opções">${ICON.dots}</button></div>`;
  };
  let L = '';
  if (!CFG && (S.tasks.some(t => t.demo) || S.routines.some(r => r.demo)))
    L += `<div class="demo-bar"><span>Você está vendo dados de exemplo.</span><button class="link" id="demo-clear">Limpar</button></div><div style="height:14px"></div>`;
  if (!items.length){
    L += `<div class="empty"><div class="e-title">${m==='past'?'Dia sem registros':'Um dia em branco'}</div>
      <div>${m==='past'?'Nada foi planejado aqui.':'Toque em “Nova atividade” para começar.'}</div>
      ${!CFG && !S.tasks.length && !S.routines.length ? '<button class="link" id="demo-load">Ver com dados de exemplo</button>' : ''}</div>`;
  } else {
    const g = (title, arr) => arr.length ? `<div class="group"><h3><span>${title}</span><span>${arr.length}</span></h3><div class="list">${arr.map(row).join('')}</div></div><div style="height:18px"></div>` : '';
    L += g(m === 'past' ? 'Não concluídas' : 'A fazer', open) + g('Concluídas', done);
  }
  $('lists').innerHTML = L;
  $('fab').hidden = m === 'past';
}

/* ---------- Eventos da tela principal ---------- */
$('days').addEventListener('click', e => { const b = e.target.closest('.day'); if (b){ sel = b.dataset.k; render(); } });
$('w-prev').onclick = () => { sel = addDays(sel,-7); render(); };
$('w-next').onclick = () => { sel = addDays(sel,7); render(); };
$('btn-today').onclick = () => { sel = today; render(); };
$('lists').addEventListener('click', e => {
  if (e.target.id === 'demo-load') return loadDemo();
  if (e.target.id === 'demo-clear') return clearDemo();
  const b = e.target.closest('[data-act]'); if (!b) return;
  const row = b.closest('.item');
  const item = itemsFor(sel).find(x => x.id === row.dataset.id && x.kind === row.dataset.kind);
  if (!item) return;
  if (b.dataset.act === 'toggle') toggle(item); else openActions(item);
});

/* ---------- Folhas ---------- */
let openSheet = null;
const show = el => { if (openSheet) openSheet.classList.remove('open'); openSheet = el; $('scrim').classList.add('open'); el.classList.add('open'); };
const hide = () => { if (openSheet) openSheet.classList.remove('open'); $('scrim').classList.remove('open'); openSheet = null; document.activeElement?.blur(); };
$('scrim').onclick = hide;

/* ---------- Nova atividade ---------- */
let rep = 'once', customDays = new Set(), rem = new Set(['9h']), remTouched = false;
$('wd-opts').innerHTML = DOW.map((d,i) => `<button type="button" class="opt wd" data-wd="${i}">${d[0].toUpperCase()}</button>`).join('');
const paintForm = () => {
  $('rep-opts').querySelectorAll('.opt').forEach(b => b.classList.toggle('on', b.dataset.rep === rep));
  $('wd-opts').hidden = rep !== 'custom';
  $('wd-opts').querySelectorAll('.wd').forEach(b => b.classList.toggle('on', customDays.has(+b.dataset.wd)));
  const hasTime = !!$('f-time').value;
  $('rem-opts').querySelectorAll('.opt').forEach(b => {
    const needTime = b.dataset.rem !== '9h';
    b.disabled = needTime && !hasTime; b.style.opacity = b.disabled ? .4 : 1;
    b.classList.toggle('on', rem.has(b.dataset.rem) && !b.disabled);
  });
};
$('rep-opts').onclick = e => { const b = e.target.closest('.opt'); if (b){ rep = b.dataset.rep; paintForm(); } };
$('wd-opts').onclick = e => { const b = e.target.closest('.wd'); if (!b) return; const n = +b.dataset.wd; customDays.has(n) ? customDays.delete(n) : customDays.add(n); paintForm(); };
$('rem-opts').onclick = e => { const b = e.target.closest('.opt'); if (!b || b.disabled) return; remTouched = true; const r = b.dataset.rem; rem.has(r) ? rem.delete(r) : rem.add(r); paintForm(); };
$('f-time').oninput = () => { if (!remTouched){ rem = new Set($('f-time').value ? ['9h','1h'] : ['9h']); } paintForm(); };
$('f-title').oninput = () => { $('f-save').disabled = !$('f-title').value.trim(); };
$('fab').onclick = () => {
  $('f-title').value = ''; $('f-time').value = ''; rep = 'once'; customDays = new Set([parse(sel).getDay()]);
  rem = new Set(['9h']); remTouched = false; paintForm(); $('f-save').disabled = true;
  const d = parse(sel); $('add-sub').textContent = `Para ${sel===today?'hoje':DOW_FULL[d.getDay()].toLowerCase()}, ${d.getDate()} de ${MON[d.getMonth()]}`;
  show($('sheet-add')); setTimeout(() => $('f-title').focus(), 250);
};
$('sheet-add').onsubmit = e => {
  e.preventDefault();
  const title = $('f-title').value.trim(); if (!title || modeOf(sel) === 'past') return;
  const time = $('f-time').value;
  const reminders = [...rem].filter(r => r === '9h' || time);
  if (rep === 'once') api.addTask({ id:uid(), title, time, date:sel, done:false, reminders, createdAt:Date.now() });
  else {
    const days = rep === 'daily' ? [0,1,2,3,4,5,6] : rep === 'week' ? [1,2,3,4,5] : [...customDays].sort();
    if (!days.length) return toast('Escolha pelo menos um dia.');
    api.addRoutine({ id:uid(), title, time, days, start:sel, end:null, reminders, createdAt:Date.now() });
  }
  hide(); toast(rep === 'once' ? 'Atividade adicionada' : 'Rotina criada');
};

/* ---------- Ações do item ---------- */
let actItem = null;
function openActions(item){
  actItem = item; const m = modeOf(sel);
  $('act-title').textContent = item.title;
  $('act-sub').textContent = item.kind === 'routine' ? 'Rotina · ' + repLabel(item.days) : 'Atividade do dia';
  const A = [];
  if (m === 'past'){
    if (!item.done) A.push(['copy', ICON.copy, 'Fazer hoje', 'Cria uma nova atividade para hoje. Esta continua como não concluída.']);
    else A.push(['none', ICON.lock, 'Concluída neste dia', 'Dias encerrados são somente leitura.']);
  } else if (item.kind === 'task'){
    A.push(['del', ICON.trash, 'Excluir atividade', '', 'danger']);
  } else {
    A.push(['skip', ICON.skip, 'Remover só deste dia', 'A rotina continua nos outros dias.']);
    A.push(['end', ICON.stop, 'Encerrar rotina', 'Sai deste dia em diante. O histórico fica guardado.', 'danger']);
  }
  $('act-list').innerHTML = A.map(([a,ic,t,s,c]) => `<button class="action ${c||''}" data-a="${a}">${ic}<span>${t}${s?`<small>${s}</small>`:''}</span></button>`).join('');
  show($('sheet-act'));
}
$('act-list').onclick = e => {
  const b = e.target.closest('.action'); if (!b || !actItem) return;
  const a = b.dataset.a, it = actItem;
  if (a === 'copy'){ api.addTask({ id:uid(), title:it.title, time:it.time, date:today, done:false, reminders:it.rem, createdAt:Date.now() }); toast('Adicionada para hoje'); }
  if (a === 'del'){ api.deleteTask(it.id); toast('Atividade excluída'); }
  if (a === 'skip'){ api.setMark(sel, 'rskip', it.id, 1); toast('Removida deste dia'); }
  if (a === 'end'){
    const r = S.routines.find(x => x.id === it.id);
    if (r.start >= sel) api.deleteRoutine(it.id); else api.updateRoutine(it.id, { end: sel });
    toast('Rotina encerrada');
  }
  hide();
};

/* ---------- Toast ---------- */
let tt;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2600); }

/* ---------- Exemplo (só no modo local) ---------- */
function loadDemo(){
  const y = addDays(today,-1), yy = addDays(today,-2);
  const mk = (date,title,time,done) => ({ id:uid(), title, time, date, done, demo:true, reminders:time?['9h','1h']:['9h'] });
  const rid = uid();
  S.routines.push({ id:rid, title:'Beber 2 L de água', time:'', days:[0,1,2,3,4,5,6], start:addDays(today,-3), end:null, demo:true, reminders:['9h'] });
  [['Ler 20 páginas','07:00',1],['Treino','06:30',1],['Responder e-mails','09:00',1],['Reunião de equipe','10:00',1],['Pagar conta de luz','',1],
   ['Ligar para o contador','14:00',0],['Organizar a mesa','',0],['Estudar inglês','20:00',0],['Revisar orçamento','',0]].forEach(([t,h,d]) => S.tasks.push(mk(y,t,h,!!d)));
  S.rdone[y+'|'+rid] = 1;
  [['Caminhada','06:30',1],['Planejar a semana','08:00',1],['Mercado','18:00',0]].forEach(([t,h,d]) => S.tasks.push(mk(yy,t,h,!!d)));
  [['Treino','06:30',1],['Academia','13:00',0],['Estudar inglês','20:00',0],['Comprar presente','',0]].forEach(([t,h,d]) => S.tasks.push(mk(today,t,h,!!d)));
  saveLocal(); render(); toast('Exemplo carregado · veja o dia de ontem');
}
function clearDemo(){
  const ids = new Set(S.routines.filter(r => r.demo).map(r => r.id));
  S.tasks = S.tasks.filter(t => !t.demo); S.routines = S.routines.filter(r => !r.demo);
  for (const o of [S.rdone, S.rskip]) for (const k of Object.keys(o)) if (ids.has(k.split('|')[1])) delete o[k];
  saveLocal(); render(); toast('Exemplo removido');
}

/* ---------- Bloqueio: login (nuvem) + Face ID ---------- */
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();
const hasWA = !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
let unlocked = false, hiddenAt = 0, creating = false;

function paintLock(){
  if (unlocked && (!CFG || (fb && fb.user))) return;
  const needLogin = CFG && !(fb && fb.user);
  $('lock').hidden = false;
  $('login').hidden = !needLogin;
  $('lock-actions').hidden = needLogin;
  $('lock-face').hidden = needLogin;
  if (needLogin){
    $('pinform').hidden = true;
    unlocked = false;
    $('lock-msg').textContent = fb ? (creating ? 'Crie sua conta. Ela guarda sua rotina na nuvem.' : 'Entre na sua conta. Isso só é pedido uma vez neste aparelho.') : 'Conectando…';
    $('l-go').textContent = creating ? 'Criar conta' : 'Entrar';
    $('l-switch').textContent = creating ? 'Já tenho conta' : 'Primeira vez? Criar conta';
    $('l-reset').hidden = creating;
    $('l-pass').autocomplete = creating ? 'new-password' : 'current-password';
    return;
  }
  // iPhone/iPad: Face ID. Computador e outros aparelhos: PIN.
  const usePin = !(hasWA && isIOS) && !inFrame;
  $('pinform').hidden = !usePin;
  $('lock-btn').hidden = usePin;
  $('lock-face').hidden = usePin;
  $('lock-skip').hidden = !inFrame;
  $('lock-skip').textContent = 'Continuar sem Face ID (prévia)';
  if (usePin){
    const has = !!DEV.pinHash;
    $('lock-msg').textContent = has ? 'Digite seu PIN para entrar.' : 'Neste aparelho não há Face ID. Crie um PIN de 4 a 8 números para proteger sua rotina.';
    $('pin2').hidden = has;
    $('pin-go').textContent = has ? 'Entrar' : 'Criar PIN e entrar';
    $('pin').value = ''; $('pin2').value = '';
    setTimeout(() => $('pin').focus(), 50);
    return;
  }
  const enrolled = !!DEV.faceId;
  $('lock-msg').textContent = enrolled ? 'Sua rotina está protegida. Use o Face ID para entrar.' : 'Proteja sua rotina. Ative o Face ID para que só você consiga abrir o app.';
  $('lock-btn').textContent = enrolled ? 'Entrar com Face ID' : 'Ativar Face ID';
}
function lock(){ unlocked = false; hide(); paintLock(); }
function unlock(){ unlocked = true; $('lock').hidden = true; $('lock-err').textContent = ''; render(); }

$('lock-btn').onclick = async () => {
  $('lock-err').textContent = '';
  if (!hasWA) return;
  try {
    if (!DEV.faceId){
      const cred = await navigator.credentials.create({ publicKey:{
        challenge:rnd(32), rp:{ name:'Minha Rotina' },
        user:{ id:rnd(16), name:(fb && fb.user && fb.user.email) || 'rotina', displayName:'Minha Rotina' },
        pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],
        authenticatorSelection:{ authenticatorAttachment:'platform', userVerification:'required', residentKey:'preferred' },
        timeout:60000 }});
      DEV.faceId = b64(cred.rawId); saveDev(); toast('Face ID ativado');
    } else {
      await navigator.credentials.get({ publicKey:{
        challenge:rnd(32), allowCredentials:[{ type:'public-key', id:unb64(DEV.faceId) }],
        userVerification:'required', timeout:60000 }});
    }
    unlock();
  } catch {
    $('lock-err').textContent = inFrame ? 'Face ID não funciona dentro da prévia. Use “Continuar”.' : 'Não foi possível confirmar. Tente de novo.';
  }
};
$('lock-skip').onclick = unlock;

async function hashPin(pin){
  const txt = 'minha-rotina|' + DEV.id + '|' + pin;
  if (window.crypto && crypto.subtle){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return b64(buf);
  }
  let h = 5381; for (const c of txt) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return 'x' + h;
}
let pinTries = 0;
$('pinform').onsubmit = async e => {
  e.preventDefault();
  const pin = $('pin').value.trim(), err = $('lock-err'); err.textContent = '';
  if (!/^\d{4,8}$/.test(pin)) { err.textContent = 'O PIN precisa ter de 4 a 8 números.'; return; }
  if (!DEV.pinHash){
    if (pin !== $('pin2').value.trim()) { err.textContent = 'Os dois PINs não são iguais.'; return; }
    DEV.pinHash = await hashPin(pin); saveDev(); toast('PIN criado'); unlock(); return;
  }
  if (await hashPin(pin) === DEV.pinHash){ pinTries = 0; unlock(); }
  else { pinTries++; $('pin').value = ''; err.textContent = pinTries >= 5 ? 'PIN incorreto. Espere 30 segundos.' : 'PIN incorreto.';
    if (pinTries >= 5){ $('pin-go').disabled = true; setTimeout(() => { $('pin-go').disabled = false; pinTries = 0; err.textContent = ''; }, 30000); } }
};
$('btn-lock').onclick = lock;

$('l-reset').onclick = async () => {
  const email = $('l-email').value.trim(), err = $('lock-err');
  $('lock-actions').hidden = false; $('lock-btn').hidden = true;
  if (!email){ err.textContent = 'Digite seu e-mail acima e toque de novo.'; return; }
  try { await fb.authM.sendPasswordResetEmail(fb.auth, email); err.textContent = 'Enviamos um link para criar nova senha no seu e-mail.'; }
  catch { err.textContent = 'Não foi possível enviar. Confira o e-mail.'; }
};
$('l-switch').onclick = () => { creating = !creating; $('lock-err').textContent = ''; paintLock(); };
$('login').onsubmit = async e => {
  e.preventDefault(); if (!fb) return;
  const email = $('l-email').value.trim(), pass = $('l-pass').value;
  const errEl = $('lock-err'); $('lock-actions').hidden = false; $('lock-btn').hidden = true; errEl.textContent = '';
  try {
    if (creating) await fb.authM.createUserWithEmailAndPassword(fb.auth, email, pass);
    else await fb.authM.signInWithEmailAndPassword(fb.auth, email, pass);
    paintLock();
  } catch (err){
    const c = err.code || '';
    errEl.textContent = c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') ? 'E-mail ou senha incorretos.'
      : c.includes('email-already-in-use') ? 'Esse e-mail já tem conta. Toque em “Já tenho conta”.'
      : c.includes('weak-password') ? 'A senha precisa de pelo menos 6 caracteres.'
      : c.includes('invalid-email') ? 'E-mail inválido.' : 'Não foi possível entrar. Verifique a internet.';
    $('lock-btn').hidden = true;
  }
};

/* ---------- Notificações ---------- */
const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
let swReg = null;

async function enablePush(silent){
  if (!fb || !fb.user) return silent || toast('Entre na sua conta primeiro.');
  if (isIOS && !standalone) return silent || paintSettings();
  if (!('Notification' in window) || !swReg) return silent || toast('Este navegador não recebe notificações.');
  try {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted'){ if (!silent) toast('Permissão negada. Libere em Ajustes do iPhone › Notificações › Rotina.'); return paintSettings(); }
    const msgM = await import(FB('messaging'));
    if (!(await msgM.isSupported())){ if (!silent) toast('Notificações não suportadas aqui.'); return; }
    const messaging = msgM.getMessaging(fb.app);
    const opts = { serviceWorkerRegistration: swReg }; if (window.VAPID_KEY) opts.vapidKey = window.VAPID_KEY;
    const token = await msgM.getToken(messaging, opts);
    await fb.fs.setDoc(fb.fs.doc(fb.db,'users',fb.user.uid), { tokens: { [DEV.id]: { token, ua: navigator.userAgent.slice(0,160), at: Date.now() } } }, { merge:true });
    DEV.push = true; saveDev();
    if (!fb.onMsg){ fb.onMsg = true; msgM.onMessage(messaging, p => { const n = p.notification || {}; toast((n.title || 'Lembrete') + (n.body ? ' · ' + n.body : '')); }); }
    if (!silent) toast('Notificações ativadas');
  } catch (err){
    console.error(err); if (!silent) toast('Não foi possível ativar as notificações.');
  }
  paintSettings();
}

function paintSettings(){
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const hint = $('n-hint'); hint.hidden = true;
  let desc, action;
  if (!CFG){ desc = 'Disponível quando o app estiver conectado à nuvem.'; action = '<span class="pill">Indisponível</span>'; }
  else if (isIOS && !standalone){
    desc = 'Instale o app na Tela de Início para receber lembretes.'; action = '<span class="pill">Instalar</span>';
    hint.hidden = false;
    hint.innerHTML = 'No Safari, toque em <b>Compartilhar</b> (o quadrado com a seta), depois em <b>Adicionar à Tela de Início</b>. Abra o app pelo ícone novo e volte aqui para ativar.';
  }
  else if (perm === 'granted' && DEV.push){ desc = 'Ativas neste aparelho, inclusive com a tela bloqueada.'; action = '<span class="pill ok">Ativas</span>'; }
  else if (perm === 'denied'){ desc = 'Bloqueadas. Libere em Ajustes do iPhone › Notificações › Rotina.'; action = '<span class="pill">Bloqueadas</span>'; }
  else { desc = 'Lembretes às 9h e 1 hora antes de cada atividade.'; action = '<button class="btn-sm" id="n-enable">Ativar</button>'; }
  $('n-desc').textContent = desc; $('n-action').innerHTML = action;
  $('acc-desc').textContent = fb && fb.user ? fb.user.email : (CFG ? 'Não conectado' : 'Dados salvos só neste aparelho');
  $('acc-out').hidden = !(fb && fb.user);
  $('n-test').disabled = !(fb && fb.user && DEV.push); $('n-test').style.opacity = $('n-test').disabled ? .4 : 1;
}
$('btn-settings').onclick = () => { paintSettings(); show($('sheet-set')); };
$('n-action').onclick = e => { if (e.target.id === 'n-enable') enablePush(false); };
$('n-test').onclick = async () => {
  if (!fb || !fb.user) return;
  await fb.fs.addDoc(col('tests'), { at: Date.now(), device: DEV.id });
  hide(); toast('Teste enviado. Bloqueie a tela agora.');
};
$('acc-out').onclick = async () => { if (!fb) return; hide(); unlocked = false; await fb.authM.signOut(fb.auth); };

/* ---------- Virada do dia e retorno ao app ---------- */
function tick(){
  const t = todayKey();
  if (t !== today){ const wasToday = sel === today; today = t; if (wasToday) sel = t; render(); }
}
setInterval(tick, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else { tick(); if (unlocked && (DEV.faceId || DEV.pinHash) && Date.now() - hiddenAt > 60000) lock(); }
});

/* ---------- Início ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:'){
  navigator.serviceWorker.register('sw.js').then(r => { swReg = r; }).catch(() => {});
}
render(); paintLock();
if (CFG) initFirebase().catch(err => { console.error(err); $('lock-msg').textContent = 'Sem conexão com a nuvem. Verifique a internet.'; });
