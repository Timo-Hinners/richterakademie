/* Richterakademie – Oberfläche */
const MAX_HE = 90, MAX_GELD = 100000;
const $ = x => document.getElementById(x);
const fmt = n => Number(n || 0).toLocaleString('de-DE');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const capHE = v => Math.max(0, Math.min(MAX_HE, Math.round(+v || 0)));
const capGeld = v => Math.max(0, Math.min(MAX_GELD, Math.round(+v || 0)));
const fmtT = s => { s = Math.max(0, Math.round(s || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
let SETTINGS = {};

/* ================= Hinweis (Toast) ================= */
let toastT = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600);
}

/* ================= Erscheinungsbild ================= */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.th === theme));
}
mq.addEventListener('change', () => { if (SETTINGS.theme === 'system') applyTheme('system'); });
document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = async () => {
  applyTheme(b.dataset.th);
  SETTINGS = await api.setSettings({ theme: b.dataset.th });
});

/* ================= Navigation ================= */
const SECTIONS = ['pfad', 'quiz', 'ref', 'tools', 'rec', 'akten', 'ur', 'sw', 'set'];
const tabs = [...document.querySelectorAll('nav button')];
function show(t) {
  tabs.forEach(b => { b.setAttribute('aria-selected', b.dataset.t === t); if (b.dataset.t === t) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
  SECTIONS.forEach(s => $(s).hidden = s !== t);
  document.querySelector('main').scrollTop = 0;
  if (t === 'akten' && !CUR) loadCaseList();
  if (t === 'set') { refreshModel(); loadBackup(); }
  if (t === 'sw') fillSwCases();
  if (t === 'ur' && typeof urEnsure === 'function') urEnsure();
}
tabs.forEach(b => b.onclick = () => show(b.dataset.t));

/* ================= Lernpfad & Quiz ================= */
const KEY = 'richterakademie-v1';
let S = { best: {}, wrong: [], right: 0 };
try { const r = localStorage.getItem(KEY); if (r) S = Object.assign(S, JSON.parse(r)); } catch (e) { }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } api.setProgress(S).catch(() => { }); };
// Lernfortschritt liegt als Datei im App-Datenordner – übersteht Updates und Neuinstallation
api.getProgress().then(p => {
  if (p && typeof p === 'object') { S = Object.assign({ best: {}, wrong: [], right: 0 }, p); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } renderPath(); }
  else if (S.right || S.wrong.length || Object.keys(S.best).length) api.setProgress(S);
}).catch(() => { });
const unlocked = l => l === 0 || (S.best[l - 1] || 0) >= 80;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };

function renderPath() {
  const box = $('levels'); box.innerHTML = ''; let done = 0;
  LEVELS.forEach((L, l) => {
    const b = S.best[l] || 0, ok = b >= 80, open = unlocked(l); if (ok) done++;
    const el = document.createElement('div'); el.className = 'level glass' + (ok ? ' done' : '') + (open ? '' : ' locked');
    el.innerHTML = `<div class="no">${ok ? '✓' : l + 1}</div><div style="min-width:0"><h3>${L.t}</h3><p>${L.d} · ${L.q.length} Fragen · Bestwert ${b} %</p><div class="bar"><i style="width:${b}%"></i></div></div>`;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (open && !b ? 'filled' : 'tinted');
    btn.textContent = open ? (b ? 'Wiederholen' : 'Starten') : 'Gesperrt'; btn.disabled = !open;
    btn.onclick = () => start(L.q.map((q, i) => ({ q, l, i })), L.t, l);
    el.appendChild(btn); box.appendChild(el);
  });
  $('sDone').textContent = done + '/' + LEVELS.length; $('sRight').textContent = S.right; $('sWrong').textContent = S.wrong.length;
  $('repeatBtn').disabled = !S.wrong.length;
}
$('repeatBtn').onclick = () => start(S.wrong.map(k => { const [l, i] = k.split('-').map(Number); return { q: LEVELS[l] && LEVELS[l].q[i], l, i }; }).filter(x => x.q), 'Fehler wiederholen', null);
$('examBtn').onclick = () => { const all = []; LEVELS.forEach((L, l) => { if (unlocked(l)) L.q.forEach((q, i) => all.push({ q, l, i })); }); start(shuffle(all).slice(0, 20), 'Prüfungsmodus', null); };
$('resetBtn').onclick = () => $('resetConfirm').hidden = false;
$('resetNo').onclick = () => $('resetConfirm').hidden = true;
$('resetYes').onclick = () => { S = { best: {}, wrong: [], right: 0 }; save(); $('resetConfirm').hidden = true; renderPath(); toast('Lernfortschritt zurückgesetzt'); };

let Q = null;
function start(items, title, level) { Q = { items: shuffle(items), n: 0, score: 0, title, level }; $('quizTitle').textContent = title; show('quiz'); ask(); }
function ask() {
  const box = $('quizBox');
  if (Q.n >= Q.items.length) return finish();
  const it = Q.items[Q.n], [text, opts, c, exp, src] = it.q, order = shuffle(opts.map((o, k) => k));
  box.innerHTML = `<div class="qhead"><span>Frage ${Q.n + 1} von ${Q.items.length}</span><span>${Q.score} richtig</span></div><div class="bar"><i style="width:${Q.n / Q.items.length * 100}%"></i></div><p class="qtext">${text}</p><div class="opts"></div><div id="after"></div>`;
  const ob = box.querySelector('.opts');
  order.forEach(k => { const b = document.createElement('button'); b.className = 'opt'; b.textContent = opts[k]; b.onclick = () => answer(k, c, order, ob, exp, src, it); ob.appendChild(b); });
}
function answer(k, c, order, ob, exp, src, it) {
  [...ob.children].forEach((b, x) => { b.disabled = true; if (order[x] === c) b.classList.add('right'); else if (order[x] === k) b.classList.add('wrong'); });
  const key = it.l + '-' + it.i, ok = k === c;
  if (ok) { Q.score++; S.right++; S.wrong = S.wrong.filter(w => w !== key); } else if (!S.wrong.includes(key)) S.wrong.push(key);
  save();
  $('after').innerHTML = `<div class="explain"><b>${ok ? 'Richtig.' : 'Leider falsch.'}</b> ${exp || ''}<small>${src || ''}</small></div><div class="row" style="margin-top:14px"><button class="btn filled" id="nextQ">${Q.n + 1 < Q.items.length ? 'Weiter' : 'Auswertung'}</button></div>`;
  $('nextQ').onclick = () => { Q.n++; ask(); };
}
function finish() {
  const p = Math.round(Q.score / Q.items.length * 100);
  if (Q.level !== null && p > (S.best[Q.level] || 0)) { S.best[Q.level] = p; save(); }
  $('quizBox').innerHTML = `<div class="result"><b>${p} %</b><p>${Q.score} von ${Q.items.length} richtig. ${Q.level !== null ? (p >= 80 ? 'Stufe bestanden, die nächste ist frei.' : 'Für die nächste Stufe brauchst du 80 %.') : ''}</p><div class="row" style="justify-content:center"><button class="btn filled" id="again">Nochmal</button><button class="btn tinted" id="toPath">Zum Lernpfad</button></div></div>`;
  const { items, title, level } = Q;
  $('again').onclick = () => start(items, title, level);
  $('toPath').onclick = () => { renderPath(); show('pfad'); };
  renderPath();
}

/* ================= Nachschlagen ================= */
$('refList').innerHTML = REF.map(([h, b], i) => `<details class="glass"${i === 0 ? ' open' : ''}><summary>${h}</summary><div class="dbody">${b}</div></details>`).join('') + '<div class="empty" id="refEmpty" hidden>Keine Treffer.</div>';
$('refSearch').oninput = () => {
  const q = $('refSearch').value.trim().toLowerCase(); let n = 0;
  document.querySelectorAll('#refList details').forEach(d => {
    const hit = !q || d.textContent.toLowerCase().includes(q);
    d.hidden = !hit; if (hit) n++;
    if (q) d.open = hit;
  });
  $('refEmpty').hidden = n > 0;
};
document.addEventListener('click', e => { const a = e.target.closest('a[href^="http"]'); if (a) { e.preventDefault(); api.openExternal(a.href); } });

/* ================= Rechner ================= */
function calcG() {
  const a = capHE($('g1').value), b = capHE($('g2').value), m = (+$('m1').value || 0) + (+$('m2').value || 0), s = a + b;
  let he = s < 90 ? s : Math.round(s * 2 / 3), txt = s < 90 ? `${a} + ${b} = ${he} HE (unter 90, addiert)` : `(${a} + ${b}) × 2/3 = ${he} HE`;
  if (he > MAX_HE) { txt += ` → gedeckelt auf ${MAX_HE} HE`; he = MAX_HE; }
  txt += ` · Geldstrafe ${fmt(capGeld(m))} $` + (m > MAX_GELD ? ` (gedeckelt, rechnerisch ${fmt(m)} $)` : '');
  $('gOut').textContent = txt;
}
['g1', 'g2', 'm1', 'm2'].forEach(x => $(x).oninput = calcG); calcG();
function calcT() { const d = $('td').value.replace(/\D/g, ''); const s = `${$('tc').value} ${$('tt').value}-${$('tm').value.trim()}-${$('tr').value.trim()}` + ($('tc').value === '🔵' && d ? '-' + d.padStart(4, '0').slice(0, 4) : ''); $('tOut').textContent = s; return s; }
['tc', 'tt', 'tm', 'tr', 'td'].forEach(x => $(x).oninput = calcT); calcT();
function urteilText({ geld, he, stvo, fs, ws, dn }) {
  let t = `Im Namen des Volkes ergeht folgendes Urteil:\n$${fmt(capGeld(geld))} Geldstrafe\n${capHE(he)} HE\n`;
  if (stvo) t += `${stvo} StVO-Punkte\n`;
  if (fs) t += `Entzug des Führerscheins, 3 Tage Führerscheinsperre\n`;
  if (ws) t += `Entzug des Waffenscheins\n`;
  return t + `Sie haben 3 Tage Zeit, die Geldstrafe zu bezahlen.\nSie haben 10 Tage Zeit, gegen dieses Urteil Revision einzulegen.\nMeine Dienstnummer ist die ${dn || 'DOJ-XX'}.`;
}
function calcU() {
  const he = +$('uH').value || 0, g = +$('uG').value || 0;
  let t = urteilText({ geld: g, he, stvo: $('uP').value, fs: $('uF').checked, ws: $('uW').checked, dn: $('uD').value });
  if (he > MAX_HE || g > MAX_GELD) t += `\n\n[Gedeckelt: höchstens ${MAX_HE} HE und ${fmt(MAX_GELD)} $]`;
  else if (he >= 15 && he <= 30) t += `\n\n[Hinweis: ${he} HE – Bewährung möglich, im Leitblatt eintragen]`;
  $('uOut').textContent = t; return t.split('\n\n[')[0];
}
['uG', 'uH', 'uP', 'uD', 'uF', 'uW'].forEach(x => { $(x).oninput = calcU; $(x).onchange = calcU; }); calcU();
function copy(txt, msgEl) {
  navigator.clipboard.writeText(txt)
    .then(() => { toast('In die Zwischenablage kopiert'); if (msgEl) { $(msgEl).textContent = 'Kopiert'; setTimeout(() => $(msgEl).textContent = '', 2000); } })
    .catch(() => toast('Kopieren nicht möglich'));
}
$('tCopy').onclick = () => copy(calcT(), 'tMsg');
$('uCopy').onclick = () => copy(calcU(), 'uMsg');

/* ================= Einstellungen ================= */
async function loadSettings() {
  SETTINGS = await api.getSettings();
  applyTheme(SETTINGS.theme);
  $('stName').value = SETTINGS.richterName; $('stDn').value = SETTINGS.dienstnummer; $('stRang').value = SETTINGS.rang;
  $('stEngine').value = SETTINGS.engine; $('stWhisper').value = SETTINGS.whisperModel; $('stModel').value = SETTINGS.claudeModel;
  $('keyState').textContent = SETTINGS.hasClaudeKey ? 'hinterlegt' : 'fehlt'; $('keyState').className = 'pill ' + (SETTINGS.hasClaudeKey ? 'ok' : 'warn');
  $('okeyState').textContent = SETTINGS.hasOpenAIKey ? 'hinterlegt' : 'optional'; $('okeyState').className = 'pill' + (SETTINGS.hasOpenAIKey ? ' ok' : '');
  $('uD').value = SETTINGS.dienstnummer; calcU();
  $('verInfo').textContent = `Richterakademie ${SETTINGS.version} · Department of Justice · Daten bleiben auf diesem PC.`;
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    $('stMic').innerHTML = '<option value="">Windows-Standard</option>' + devs.map(d => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Mikrofon')}</option>`).join('');
    $('stMic').value = SETTINGS.micId || '';
  } catch (e) { }
}
$('stSave').onclick = async () => {
  const upd = { richterName: $('stName').value.trim(), dienstnummer: $('stDn').value.trim() || 'DOJ-XX', rang: $('stRang').value.trim(), engine: $('stEngine').value, whisperModel: $('stWhisper').value, claudeModel: $('stModel').value.trim() || 'claude-sonnet-5-5', micId: $('stMic').value };
  if ($('stKey').value) upd.claudeKey = $('stKey').value;
  if ($('stOKey').value) upd.openaiKey = $('stOKey').value;
  await api.setSettings(upd); $('stKey').value = ''; $('stOKey').value = '';
  await loadSettings(); refreshModel(); toast('Einstellungen gespeichert');
};
$('stWhisper').onchange = refreshModel;

let MODEL_OK = {}, DL = false;
async function refreshModel() {
  try { MODEL_OK = await api.modelStatus(); } catch (e) { MODEL_OK = {}; }
  if (DL) return;
  const m = $('stWhisper').value, ok = !!MODEL_OK[m];
  $('modelState').textContent = ok ? 'Bereit · offline' : 'Noch nicht geladen';
  $('modelDl').hidden = ok; $('modelDl').disabled = false;
}
async function ensureModel(m, onPct) {
  if (MODEL_OK[m]) return;
  MODEL_OK = await api.modelStatus();
  if (MODEL_OK[m]) return;
  DL = true;
  try { await api.modelDownload(m); MODEL_OK[m] = true; }
  finally { DL = false; refreshModel(); }
}
$('modelDl').onclick = async () => {
  const m = $('stWhisper').value; $('modelDl').disabled = true; $('modelState').textContent = 'Wird geladen… 0 %';
  try { await ensureModel(m); toast('Sprachmodell bereit'); }
  catch (e) { $('modelState').textContent = 'Fehler: ' + e.message; $('modelDl').disabled = false; }
};

/* ---------- Fortschritt aus dem Hauptprozess ---------- */
let progressCtx = null;
api.onProgress(d => {
  if (d.kind === 'download') {
    if (DL && !$('set').hidden) $('modelState').textContent = `Wird geladen… ${d.pct} %`;
    if (progressCtx) progressCtx(`Sprachmodell wird einmalig geladen: ${d.pct} %`, d.pct);
  } else if (d.kind === 'transcribe' && progressCtx) {
    progressCtx(`Erkennung ${d.track === 'mic' ? 'deiner Spur' : 'der TeamSpeak-Spur'}: ${d.pct} %`, d.pct);
  }
});

/* ================= Beteiligte ================= */
const ROLLEN = ['Angeklagter', 'Anwalt', 'Staatsanwalt', 'Beamter', 'Zeuge', 'Kläger', 'Beklagter', 'Sonstige'];
function addBet(name = '', rolle = 'Angeklagter') {
  const r = document.createElement('div'); r.className = 'r';
  r.innerHTML = `<input placeholder="Name" value="${esc(name)}"><select>${ROLLEN.map(x => `<option${x === rolle ? ' selected' : ''}>${x}</option>`).join('')}</select><button class="btn plain small" title="Entfernen" aria-label="Entfernen">✕</button>`;
  r.querySelector('button').onclick = () => r.remove();
  $('betList').appendChild(r);
}
$('betAdd').onclick = () => addBet();
addBet('', 'Angeklagter'); addBet('', 'Beamter');
const readBet = () => [...$('betList').children].map(r => ({ name: r.querySelector('input').value.trim(), rolle: r.querySelector('select').value })).filter(b => b.name);

/* ================= Aufnahme ================= */
let R = null, BUSY = false;
const newId = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

function meter(stream, el, ctx) {
  const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  return () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); el.style.width = Math.min(100, m / 128 * 180) + '%'; };
}
function recorder(stream) {
  const chunks = [], mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 48000 });
  mr.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(res => mr.onstop = () => res(new Blob(chunks, { type: 'audio/webm' })));
  mr.start(1000); return { mr, done };
}
async function startRec() {
  if (BUSY) return toast('Bitte warten, die letzte Verhandlung wird noch ausgewertet.');
  const state = $('recState');
  try {
    state.textContent = 'Starte…';
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: SETTINGS.micId ? { exact: SETTINGS.micId } : undefined, echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    let sys = null;
    try {
      const disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      disp.getVideoTracks().forEach(t => t.stop());
      if (disp.getAudioTracks().length) sys = new MediaStream(disp.getAudioTracks());
    } catch (e) { console.warn('Systemton', e); }
    const ctx = new AudioContext();
    R = { id: newId(), t0: Date.now(), mic, sys, ctx, marker: [], recs: { mic: recorder(mic) }, meters: [meter(mic, $('mMic'), ctx)] };
    if (sys) { R.recs.sys = recorder(sys); R.meters.push(meter(sys, $('mSys'), ctx)); }
    R.tick = setInterval(() => { $('recTime').textContent = fmtT((Date.now() - R.t0) / 1000); R.meters.forEach(f => f()); }, 100);
    $('recBtn').classList.add('on'); $('recBtn').setAttribute('aria-label', 'Aufnahme beenden'); $('liveDot').hidden = false;
    state.textContent = sys ? 'Aufnahme läuft · Mikrofon und TeamSpeak' : 'Aufnahme läuft · nur Mikrofon (Systemton nicht verfügbar)';
    $('markText').disabled = $('markBtn').disabled = false; $('markList').innerHTML = '';
    $('procBox').hidden = true;
  } catch (e) {
    state.textContent = 'Mikrofon nicht verfügbar: ' + e.message;
  }
}
function addMark() {
  if (!R) return;
  const text = $('markText').value.trim() || 'Markierung', t = (Date.now() - R.t0) / 1000;
  R.marker.push({ t, text }); $('markText').value = '';
  $('markList').insertAdjacentHTML('beforeend', `<li><b>${fmtT(t)}</b>${esc(text)}</li>`);
}
$('markBtn').onclick = addMark;
$('markText').onkeydown = e => { if (e.key === 'Enter') addMark(); };

function newCaseObj(id, t0) {
  return {
    id, ts: t0 || Date.now(), aktenzeichen: $('cAz').value.trim() || id, titel: $('cTitel').value.trim(), art: $('cArt').value,
    datum: new Date(t0 || Date.now()).toLocaleString('de-DE'), status: 'Offen',
    richter: SETTINGS.richterName, dienstnummer: SETTINGS.dienstnummer, beteiligte: readBet(), notizen: $('cNotiz').value.trim(),
    marker: [], transcript: [], audio: {}, bericht: '', strafe: { he: 0, geld: 0, stvo: '', fs: false, ws: false, bew: false }
  };
}
async function stopRec() {
  const r = R; R = null;
  clearInterval(r.tick); $('recBtn').classList.remove('on'); $('recBtn').setAttribute('aria-label', 'Aufnahme starten'); $('liveDot').hidden = true;
  $('markText').disabled = $('markBtn').disabled = true; $('mMic').style.width = $('mSys').style.width = '0';
  Object.values(r.recs).forEach(x => x.mr.stop());
  r.mic.getTracks().forEach(t => t.stop()); r.sys && r.sys.getTracks().forEach(t => t.stop());
  r.ctx.close();
  $('recState').textContent = 'Aufnahme beendet · wird ausgewertet';
  const c = newCaseObj(r.id, r.t0);
  c.dauer = (Date.now() - r.t0) / 1000; c.marker = r.marker;
  const blobs = {};
  for (const [k, v] of Object.entries(r.recs)) blobs[k] = { blob: await v.done, ext: 'webm' };
  await processCase(c, blobs);
  $('recState').textContent = 'Bereit zur Aufnahme'; $('recTime').textContent = '00:00';
}
$('recBtn').onclick = () => R ? stopRec() : startRec();

/* ---------- Auswertung ---------- */
const LABEL = { mic: 'Richter (ich)', sys: 'Gegenüber', aufnahme: 'Aufnahme' };
function step(s, cls, msg) {
  const li = document.querySelector(`#steps [data-s="${s}"]`); if (li) li.className = cls;
  if (msg !== undefined) $('procMsg').textContent = msg;
}
function bar(pct) { const b = $('procBar'); if (pct === null) { b.hidden = true; return; } b.hidden = false; b.firstElementChild.style.width = pct + '%'; }
async function toPcm(blob) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const ab = await ctx.decodeAudioData(await blob.arrayBuffer());
    const n = ab.length, out = new Float32Array(n);
    for (let ch = 0; ch < ab.numberOfChannels; ch++) { const d = ab.getChannelData(ch); for (let i = 0; i < n; i++) out[i] += d[i] / ab.numberOfChannels; }
    return out;
  } finally { ctx.close(); }
}
async function transcribeTracks(c, blobs, ui) {
  c.transcript = [];
  const local = SETTINGS.engine !== 'openai';
  if (local) {
    ui.step('model', 'run', 'Sprachmodell wird geprüft…');
    try { await ensureModel(SETTINGS.whisperModel); ui.step('model', 'ok'); }
    catch (e) { ui.step('model', 'err', 'Sprachmodell konnte nicht geladen werden: ' + e.message); return false; }
  } else ui.step('model', 'skip');
  let any = false;
  for (const k of Object.keys(blobs)) {
    const st = k === 'mic' ? 'mic' : 'sys';
    ui.step(st, 'run', 'Spracherkennung läuft…'); ui.bar(0);
    try {
      const segs = local ? await api.transcribeLocal(await toPcm(blobs[k].blob), k) : await api.transcribeOpenAI(c.audio[k]);
      c.transcript.push(...segs.map(s => ({ start: s.start, end: s.end, who: LABEL[k] || k, text: s.text })));
      ui.step(st, 'ok'); any = true;
    } catch (e) { ui.step(st, 'err', 'Erkennung fehlgeschlagen: ' + e.message); }
    ui.bar(null);
  }
  c.transcript.sort((a, b) => a.start - b.start);
  return any;
}
async function processCase(c, blobs) {
  BUSY = true;
  show('rec');
  $('procBox').hidden = false; bar(null);
  document.querySelectorAll('#steps li').forEach(li => li.className = '');
  if (!blobs.mic) step('mic', 'skip');
  if (!blobs.sys && !blobs.aufnahme) step('sys', 'skip');
  const ui = { step, bar };
  progressCtx = (msg, pct) => { $('procMsg').textContent = msg; bar(pct); };
  try {
    step('save', 'run', 'Aufnahme wird gesichert…');
    try {
      for (const [k, v] of Object.entries(blobs)) c.audio[k] = await api.saveAudio(c.id, k, await v.blob.arrayBuffer(), v.ext);
      await api.saveCase(c); step('save', 'ok');
    } catch (e) { step('save', 'err', 'Speichern fehlgeschlagen: ' + e.message); return; }
    await transcribeTracks(c, blobs, ui);
    await api.saveCase(c);
    await writeReport(c, msg => step('report', 'run', msg));
    step('report', c.berichtKI ? 'ok' : 'skip');
    await api.saveCase(c);
    $('procMsg').textContent = c.berichtKI ? 'Fertig. Die Akte ist gespeichert.' : 'Fertig. Vorlage mit Transkript gespeichert – mit Claude-Schlüssel schreibt die App die Akte selbst.';
    toast('Akte gespeichert');
    show('akten'); openCase(c.id);
  } finally { BUSY = false; progressCtx = null; bar(null); }
}
async function writeReport(c, onMsg) {
  if (!SETTINGS.hasClaudeKey) { c.bericht = templateReport(c); c.berichtKI = false; onMsg && onMsg('Kein Claude-Schlüssel: Vorlage mit Transkript angelegt.'); return; }
  onMsg && onMsg('Akte wird geschrieben…');
  try {
    const r = await api.createReport(c);
    c.bericht = r.md; c.berichtKI = true;
    c.strafe = c.strafe || {};
    if (r.he !== null) { c.strafe.he = capHE(r.he); c.strafe.geld = capGeld(r.geld); c.strafe.bew = c.strafe.he >= 15 && c.strafe.he <= 30 && /bewährung[^.\n]{0,40}(ja|möglich|empfohlen)/i.test(r.md); }
  } catch (e) { if (!c.bericht) c.bericht = templateReport(c); c.berichtKI = false; c.fehler = e.message; onMsg && onMsg('KI-Akte fehlgeschlagen (' + e.message + ').'); }
}
function templateReport(c) {
  const bet = (c.beteiligte || []).map(b => `- ${b.name} (${b.rolle})`).join('\n') || '- ';
  return `## Sachverhalt\n\n\n## Beteiligte\n${bet}\n\n## Verlauf der Verhandlung\n\n\n## Aussagen der Beteiligten\n\n\n## Beweise und Zeugen\n\n\n## Verfahrensprüfung\n- Rechte verlesen: \n- Anwalt: \n- Haftzeit: \n\n## Rechtliche Würdigung\n\n\n## Schlussfolgerung und Strafvorschlag\n\n\n## Offene Punkte\n\n${c.notizen ? '\n## Notizen\n' + c.notizen + '\n' : ''}`;
}

/* ================= Akten ================= */
let CASES = [], CUR = null;
async function loadCaseList() { CASES = await api.listCases(); renderCaseList(); }
function renderCaseList() {
  const q = $('caseSearch').value.toLowerCase();
  const list = CASES.filter(c => !q || [c.aktenzeichen, c.titel, c.art, c.datum].join(' ').toLowerCase().includes(q));
  $('caseList').innerHTML = list.length ? '' : `<div class="empty">${CASES.length ? 'Keine Treffer.' : 'Noch keine Akten. Starte unter „Verhandlung“ eine Aufnahme, importiere eine Audiodatei oder lege eine leere Akte an.'}</div>`;
  list.forEach(c => {
    const b = document.createElement('button'); b.className = 'case';
    const st = c.status || 'Offen';
    b.innerHTML = `<div style="min-width:0"><b>${esc(c.aktenzeichen)}${c.titel ? ' · ' + esc(c.titel) : ''}</b><small>${esc(c.art)} · ${esc(c.datum)}</small></div><span class="pill ${st === 'Offen' ? 'warn' : 'ok'}">${esc(st)}</span>`;
    b.onclick = () => openCase(c.id); $('caseList').appendChild(b);
  });
}
$('caseSearch').oninput = renderCaseList;
$('openFolder').onclick = () => api.openFolder();
$('newCase').onclick = async () => {
  const id = newId();
  const c = { id, ts: Date.now(), aktenzeichen: id, titel: '', art: 'Sonstiges', datum: new Date().toLocaleString('de-DE'), status: 'Offen', richter: SETTINGS.richterName, dienstnummer: SETTINGS.dienstnummer, beteiligte: [], notizen: '', marker: [], transcript: [], audio: {}, strafe: { he: 0, geld: 0 } };
  c.bericht = templateReport(c); await api.saveCase(c); openCase(id);
};
$('importAudio').onclick = async () => {
  if (BUSY) return toast('Bitte warten, es läuft bereits eine Auswertung.');
  const f = await api.pickAudio(); if (!f) return;
  const id = newId(), c = newCaseObj(id);
  c.titel = c.titel || f.name.replace(/\.[^.]+$/, '');
  const mime = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac', aac: 'audio/aac' }[f.ext] || 'audio/*';
  await processCase(c, { aufnahme: { blob: new Blob([f.data], { type: mime }), ext: f.ext || 'wav' } });
};
$('backList').onclick = () => { CUR = null; $('caseView').hidden = true; $('caseListView').hidden = false; loadCaseList(); };

async function openCase(id) {
  CUR = await api.getCase(id); if (!CUR) return;
  CUR.strafe = CUR.strafe || { he: 0, geld: 0 };
  $('caseListView').hidden = true; $('caseView').hidden = false; $('delConfirm').hidden = true; $('caseMsg').textContent = CUR.fehler ? 'Letzter KI-Fehler: ' + CUR.fehler : '';
  $('caseEyebrow').textContent = [CUR.art, CUR.datum].filter(Boolean).join(' · ');
  $('caseTitle').textContent = CUR.titel || CUR.aktenzeichen || 'Akte';
  $('eAz').value = CUR.aktenzeichen || ''; $('eTitel').value = CUR.titel || ''; $('eArt').value = CUR.art || ''; $('eStatus').value = CUR.status || 'Offen';
  const s = CUR.strafe;
  $('sHE').value = s.he || 0; $('sGeld').value = s.geld || 0; $('sStvo').value = s.stvo || ''; $('sFS').checked = !!s.fs; $('sWS').checked = !!s.ws; $('sBew').checked = !!s.bew;
  $('mdEdit').value = CUR.bericht || '';
  $('reTrans').disabled = !audioMap(CUR).length;
  $('genReport').textContent = SETTINGS.hasClaudeKey ? 'Akte mit KI schreiben' : 'Akte mit KI schreiben (Schlüssel fehlt)';
  renderMd(); renderTrans(); checkCaps(); view('bericht');
}
function audioMap(c) {
  const a = c.audio || {};
  if (Array.isArray(a)) return a.map(k => [k, `${c.id}-${k}.webm`]);
  return Object.entries(a);
}
function view(v) { document.querySelectorAll('.t2').forEach(b => b.classList.toggle('on', b.dataset.v === v)); $('vBericht').hidden = v !== 'bericht'; $('vEdit').hidden = v !== 'edit'; $('vTrans').hidden = v !== 'trans'; if (v === 'bericht') renderMd(); }
document.querySelectorAll('.t2').forEach(b => b.onclick = () => view(b.dataset.v));

function md2html(md) {
  const lines = md.split('\n'); let html = '', list = null;
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, '$1<i>$2</i>');
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const l of lines) {
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { close(); const n = Math.min(3, m[1].length + 1); html += `<h${n}>${inline(m[2])}</h${n}>`; }
    else if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) close();
    else { close(); html += `<p>${inline(l)}</p>`; }
  }
  close(); return html;
}
function renderMd() { if (!CUR) return; CUR.bericht = $('mdEdit').value; $('mdOut').innerHTML = md2html(CUR.bericht || '') || '<p class="note">Noch kein Bericht.</p>'; }
function renderTrans() {
  const t = CUR.transcript || [], m = (CUR.marker || []).map(x => ({ start: x.t, who: '★ Markierung', text: x.text, mark: true }));
  const all = [...t, ...m].sort((a, b) => a.start - b.start);
  $('transOut').innerHTML = all.length ? all.map(x => `<p><b>${fmtT(x.start)}</b><span class="${x.mark ? 'ts' : x.who.startsWith('Richter') ? 'me' : 'them'}">${esc(x.who)}</span> ${esc(x.text)}</p>`).join('') : '<p class="note">Kein Transkript vorhanden.</p>';
}
function checkCaps() {
  const he = +$('sHE').value || 0, g = +$('sGeld').value || 0, n = $('capNote');
  if (he > MAX_HE || g > MAX_GELD) { n.className = 'sub note warn'; n.textContent = `Über dem Deckel. Gespeichert wird höchstens ${MAX_HE} HE und ${fmt(MAX_GELD)} $.`; }
  else { n.className = 'sub note'; n.textContent = he >= 15 && he <= 30 ? 'Bewährung möglich (15–30 HE). Geldstrafe bleibt voll.' : ''; }
}
function collect() {
  CUR.aktenzeichen = $('eAz').value.trim(); CUR.titel = $('eTitel').value.trim(); CUR.art = $('eArt').value.trim(); CUR.status = $('eStatus').value;
  CUR.bericht = $('mdEdit').value;
  CUR.strafe = { he: capHE($('sHE').value), geld: capGeld($('sGeld').value), stvo: $('sStvo').value, fs: $('sFS').checked, ws: $('sWS').checked, bew: $('sBew').checked };
}
let saveT = null;
function autosave() {
  checkCaps(); clearTimeout(saveT);
  saveT = setTimeout(async () => { if (!CUR) return; collect(); $('caseTitle').textContent = CUR.titel || CUR.aktenzeichen || 'Akte'; await api.saveCase(CUR); $('caseMsg').textContent = 'Automatisch gespeichert'; }, 600);
}
['eAz', 'eTitel', 'eArt', 'eStatus', 'sHE', 'sGeld', 'sStvo', 'sFS', 'sWS', 'sBew', 'mdEdit'].forEach(x => { $(x).addEventListener('input', autosave); $(x).addEventListener('change', autosave); });
['sHE', 'sGeld'].forEach(x => $(x).addEventListener('change', () => { $('sHE').value = capHE($('sHE').value); $('sGeld').value = capGeld($('sGeld').value); checkCaps(); }));

$('genReport').onclick = async () => {
  if (!SETTINGS.hasClaudeKey) { toast('Bitte zuerst in den Einstellungen einen Claude-Schlüssel hinterlegen.'); return; }
  collect(); $('genReport').disabled = true;
  await writeReport(CUR, m => $('caseMsg').textContent = m);
  if (CUR.berichtKI) delete CUR.fehler;
  $('genReport').disabled = false; await api.saveCase(CUR); await openCase(CUR.id);
  if (CUR.berichtKI) toast('Akte neu geschrieben');
};
$('reTrans').onclick = async () => {
  if (BUSY) return toast('Es läuft bereits eine Auswertung.');
  collect(); const c = CUR, blobs = {};
  $('reTrans').disabled = true; BUSY = true;
  const ui = {
    step: (s, cls, msg) => { if (msg) $('caseMsg').textContent = msg; if (cls === 'err' && msg) toast(msg); },
    bar: () => { }
  };
  progressCtx = msg => $('caseMsg').textContent = msg;
  try {
    for (const [k, name] of audioMap(c)) { const d = await api.readAudio(name); if (d) blobs[k] = { blob: new Blob([d]) }; }
    if (!Object.keys(blobs).length) { toast('Keine Aufnahme zu dieser Akte gefunden.'); return; }
    const old = c.transcript;
    const ok = await transcribeTracks(c, blobs, ui);
    if (!ok) c.transcript = old;
    await api.saveCase(c); renderTrans(); view('trans');
    $('caseMsg').textContent = ok ? `Neu transkribiert: ${c.transcript.length} Abschnitte.` : 'Transkription fehlgeschlagen.';
  } finally { BUSY = false; progressCtx = null; $('reTrans').disabled = false; }
};
const urteilFor = c => urteilText({ geld: c.strafe.geld, he: c.strafe.he, stvo: c.strafe.stvo, fs: c.strafe.fs, ws: c.strafe.ws, dn: SETTINGS.dienstnummer }) + (c.strafe.bew ? '\n(Haftstrafe zur Bewährung ausgesetzt, max. 14 Tage)' : '');
$('copyUrteil').onclick = () => { collect(); copy(urteilFor(CUR)); };
$('delCase').onclick = () => $('delConfirm').hidden = false;
$('delNo').onclick = () => $('delConfirm').hidden = true;
$('delYes').onclick = async () => { await api.deleteCase(CUR.id); toast('Akte gelöscht'); $('backList').onclick(); };

function plainDoc(c) {
  return `DEPARTMENT OF JUSTICE · CORLEONE CITY\nAkte ${c.aktenzeichen}${c.titel ? ' – ' + c.titel : ''}\nVerfahren: ${c.art} · Datum: ${c.datum} · Richter: ${SETTINGS.richterName} (${SETTINGS.dienstnummer})\n\n${c.bericht}\n\n## Urteil\n${urteilFor(c)}\n\n## Transkript\n` +
    (c.transcript || []).map(t => `[${fmtT(t.start)}] ${t.who}: ${t.text}`).join('\n');
}
const fileName = c => 'Akte-' + String(c.aktenzeichen || c.id).replace(/[\\/:*?"<>|]/g, '-');
$('expMd').onclick = async () => { collect(); await api.saveCase(CUR); const f = await api.exportText(plainDoc(CUR), fileName(CUR), 'md'); if (f) { $('caseMsg').textContent = 'Gespeichert: ' + f; toast('Text gespeichert'); } };
$('expPdf').onclick = async () => {
  collect(); await api.saveCase(CUR);
  const seal = await fetch('seal.png').then(r => r.blob()).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }));
  const c = CUR, bet = (c.beteiligte || []).map(b => `${esc(b.name)} (${esc(b.rolle)})`).join(', ');
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{font:11pt/1.5 Georgia,"Times New Roman",serif;color:#14203a;margin:0}
  .head{display:flex;gap:16px;align-items:center;border-bottom:3px double #a8822b;padding-bottom:10px;margin-bottom:14px}
  .head img{width:70px;height:70px}.head h1{font:700 16pt Georgia,serif;letter-spacing:.08em;margin:0;color:#1b2d57}
  .head p{margin:2px 0 0;color:#555;font-size:9.5pt}
  .meta{display:grid;grid-template-columns:auto 1fr;gap:3px 14px;font-size:10pt;margin-bottom:14px}
  .meta b{color:#555;font-weight:normal}
  h2,h3{font:700 12pt Georgia,serif;color:#1b2d57;border-bottom:1px solid #d5d9e4;padding-bottom:2px;margin:16px 0 6px}
  p{margin:0 0 8px}ul,ol{margin:0 0 8px;padding-left:20px}
  .urteil{border:1.5px solid #a8822b;padding:10px 14px;margin-top:18px;white-space:pre-wrap;font:10.5pt/1.5 Georgia,serif;page-break-inside:avoid}
  .sig{margin-top:30px;font-size:10pt}
  </style></head><body>
  <div class="head"><img src="${seal}"><div><h1>DEPARTMENT OF JUSTICE</h1><p>Corleone City · State of San Andreas · Richterschaft</p></div></div>
  <div class="meta"><b>Aktenzeichen</b><span>${esc(c.aktenzeichen)}</span><b>Titel</b><span>${esc(c.titel || '–')}</span><b>Verfahren</b><span>${esc(c.art)}</span><b>Datum</b><span>${esc(c.datum)}</span><b>Vorsitz</b><span>${esc(SETTINGS.richterName || '–')}, ${esc(SETTINGS.rang)} (${esc(SETTINGS.dienstnummer)})</span>${bet ? `<b>Beteiligte</b><span>${bet}</span>` : ''}</div>
  ${md2html(c.bericht || '')}
  <h2>Urteil</h2><div class="urteil">${esc(urteilFor(c))}</div>
  <div class="sig">Los Santos, den ${new Date().toLocaleDateString('de-DE')}<br><br>${esc(SETTINGS.richterName || '')}<br>${esc(SETTINGS.rang)}</div>
  </body></html>`;
  const f = await api.exportPdf(html, fileName(c));
  if (f) { $('caseMsg').textContent = 'PDF gespeichert: ' + f; toast('PDF gespeichert'); }
};


/* ================= Schwärzen ================= */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
const PARTIKEL = new Set(['von', 'van', 'de', 'der', 'den', 'la', 'le', 'da', 'di', 'del', 'du', 'y', 'und', 'mc', 'el', 'al', 'bin', 'ten', 'zu']);
const STOP = new Set('der die das dem den des ein eine einen einem einer und oder aber er sie es ich wir ihr man wurde wurden hat haben ist sind war waren nicht kein keine mit von zu im in am an auf aus bei nach vor für über unter um als wie dass so dann danach daraufhin anschliessend anschließend zudem außerdem ausserdem bitte heute gestern morgen'.split(' '));
const TITEL = /(?:^|[\s(„"'])(?:Herrn?|Frau|Hr\.|Fr\.|Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.|Prof\.|Officer|Ofc\.|Sgt\.|Det\.|Lt\.|Cpt\.|Agent(?:in)?|Richter(?:in)?|Staatsanw(?:alt|ältin)|(?:Rechts)?[Aa]nw(?:alt|ältin)|Beamte[rn]?|Beamtin|Kolleg(?:e|in|en)|Zeug(?:e|in|en)|Angeklagte[rn]?|Beschuldigte[rn]?|Tatverdächtige[rn]?|Verdächtige[rn]?|Mandant(?:in|en)?|Kläger(?:in)?|Beklagte[rn]?|Opfer|Sanitäter(?:in)?|Medic|namens|genannt|alias|Name:?|Bürger(?:in)?|Person)\s+((?:[A-ZÄÖÜ][\p{L}'’\-]+)(?:\s+(?:(?:von|van|de|del|da|di|du|la|le|zu)\s+)?[A-ZÄÖÜ][\p{L}'’\-]+)?)/gu;
const NUMMER = /^(?:\+?\d[\d\-\/]{2,}\d|[A-ZÄÖÜ]{2,6}-\d{1,6}|#\d{2,})$/;
const SW = { names: new Set(), off: new Set(), manual: new Set(), tokens: [] };
const keyOf = w => w.toLowerCase().replace(/['’]s?$/, '');
function isRedacted(word) {
  const k = keyOf(word);
  if (SW.off.has(k)) return false;
  if (SW.names.has(k) || SW.manual.has(k)) return true;
  if (k.endsWith('s') && (SW.names.has(k.slice(0, -1)) || SW.manual.has(k.slice(0, -1)))) return true;
  if ($('swNum').checked && NUMMER.test(word) && /\d/.test(word)) return true;
  return false;
}
const TWORD = /^(?:Herrn?|Frau|Officer|Agent(?:in)?|Richter(?:in)?|Staatsanw(?:alt|ältin)|(?:Rechts)?[Aa]nw(?:alt|ältin)|Beamte[rn]?|Beamtin|Kolleg(?:e|in|en)|Zeug(?:e|in|en)|Angeklagte[rn]?|Beschuldigte[rn]?|Tatverdächtige[rn]?|Mandant(?:in|en)?|Kläger(?:in)?|Beklagte[rn]?|Opfer|Person|Polizei|Juwelier|Bank|Fahrzeug|Waffe)$/;
function addName(n) {
  const parts = String(n).match(WORD) || [];
  for (const t of parts) {
    const k = keyOf(t);
    if ((k.length < 2 && !(parts.length > 1 && /^[A-ZÄÖÜ]$/.test(t))) || PARTIKEL.has(k) || STOP.has(k) || /^\d+$/.test(k)) continue;
    SW.names.add(k); SW.off.delete(k);
  }
}
async function knownNames() {
  const out = [];
  if (SETTINGS.richterName) out.push(SETTINGS.richterName);
  try {
    const list = await api.listCases();
    for (const c of list.slice(0, 60)) { const f = await api.getCase(c.id); (f && f.beteiligte || []).forEach(b => b.name && out.push(b.name)); }
  } catch (e) { }
  return out;
}
const ROLLE = '(?:Name|Vor-?name|Nach-?name|Vollständiger Name|Ingame-?Name|Spitzname|Alias|Angeklagte[rn]?|Beschuldigte[rn]?|Tatverdächtige[rn]?|Verdächtige[rn]?|Täter(?:in)?|Mittäter(?:in)?|Kläger(?:in)?|Beklagte[rn]?|Zeug(?:e|in|en)|Opfer|Geschädigte[rn]?|Beamte[rn]?|Beamtin|Officer|Einsatzleiter(?:in)?|Festnehmende[rn]?|Sachbearbeiter(?:in)?|Aktenführer(?:in)?|Ersteller(?:in)?|Verfasser(?:in)?|Unterzeichner(?:in)?|Richter(?:in)?|Vorsitz(?:ender)?|Staatsanw(?:alt|ältin)|(?:Rechts)?[Aa]nw(?:alt|ältin)|Verteidiger(?:in)?|Mandant(?:in)?|Protokollführer(?:in)?|Sanitäter(?:in)?|Arzt|Ärztin|Fahrer(?:in)?|Halter(?:in)?|Besitzer(?:in)?|Eigentümer(?:in)?|Person(?:alien)?|Beteiligte[rn]?|gez\\.|Unterschrift)';
const ROLLENZEILE = new RegExp('(?:^|\\n)[ \\t>*•\\-–\\d.)]*' + ROLLE + '[^:\\n]{0,24}:[ \\t]*([^\\n]+)', 'giu');
const LISTE = /(?:^|\n)[ \t]*[-•*–]\s*([A-ZÄÖÜ][\p{L}'’\-]+(?:\s+[A-ZÄÖÜ][\p{L}'’\-]+){1,3})\s*[(\[,–-]\s*(?:Angeklagte|Beschuldigte|Tatverdächtig|Kläger|Beklagte|Zeug|Opfer|Geschädigt|Beamt|Officer|Anwalt|Anwält|Staatsanw|Richter|Täter|Mittäter)/gu;
function namesFromValue(v) {
  // "Officer Lisa Kowalski (DN 204), Marco Saints" → Namen ohne Dienstgrad, Klammern und Nummern
  return v.replace(/\(.*?\)|\[.*?\]/g, ' ').split(/\s*(?:,|;|\/|\bund\b|&|\s[-–]\s)\s*/).map(part => {
    const ws = (part.match(/[\p{L}'’\-]+/gu) || []).filter(w => /^[A-ZÄÖÜ]/.test(w) && !TWORD.test(w) && !/^(?:Officer|Ofc|Sgt|Det|Lt|Cpt|Dr|Herr|Herrn|Frau|Mr|Mrs|Ms|Agent|Deputy|Trooper|Ranger|Chief|Captain|Sergeant|Lieutenant|Detective|Corporal|Commander|Major|Junior|Senior|DN|Nr|Dienstnummer|Unbekannt|Keine|Kein|Siehe|Nicht|Offen|Ja|Nein)$/.test(w) && !STOP.has(w.toLowerCase()));
    return ws.slice(0, 4).join(' ');
  }).filter(Boolean);
}
function localFind(text) {
  const found = [];
  for (const m of text.matchAll(ROLLENZEILE)) found.push(...namesFromValue(m[1]));
  for (const m of text.matchAll(LISTE)) found.push(m[1]);
  for (const m of text.matchAll(/(?:^|\n)[ \t]*(?:gez\.|gezeichnet)[ \t]*:?[ \t]*([A-ZÄÖÜ][\p{L}'’\-]+(?:[ \t]+[A-ZÄÖÜ][\p{L}'’\-]+){0,3})/giu)) found.push(...namesFromValue(m[1]));
  for (const m of text.matchAll(TITEL)) {
    const parts = m[1].split(/\s+/).filter(w => !STOP.has(w.toLowerCase()));
    if (parts.length) found.push(parts.join(' '));
  }
  // Nachname direkt nach einem gefundenen Vornamen (nur durch ein Leerzeichen getrennt)
  for (const m of text.matchAll(/([\p{L}'’\-]+) ([A-ZÄÖÜ][a-zäöüß'’\-]{2,})/gu)) {
    if (SW.names.has(keyOf(m[1])) && /^[A-ZÄÖÜ]/.test(m[1]) && !/['’]$/.test(m[1]) && !STOP.has(m[2].toLowerCase()) && !TWORD.test(m[2])) found.push(m[2]);
  }
  return found;
}
function tokenize(text) {
  const out = []; let last = 0;
  for (const m of text.matchAll(WORD)) {
    if (m.index > last) out.push({ t: text.slice(last, m.index) });
    out.push({ t: m[0], w: true }); last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}
function renderSw() {
  const text = $('swText').value;
  SW.tokens = tokenize(text);
  const box = $('swPreview'); box.innerHTML = '';
  for (const tk of SW.tokens) {
    if (!tk.w) { box.appendChild(document.createTextNode(tk.t)); continue; }
    const sp = document.createElement('span'); sp.className = 'w' + (isRedacted(tk.t) ? ' x' : ''); sp.textContent = tk.t;
    sp.onclick = () => toggleWord(tk.t); box.appendChild(sp);
  }
  const shown = [...new Set(SW.tokens.filter(t => t.w && isRedacted(t.t) && !NUMMER.test(t.t)).map(t => t.t.replace(/['’]s?$/, '')))];
  $('swChips').innerHTML = shown.length ? '' : '<span class="hint">Noch nichts geschwärzt. Tippe im Text auf einen Namen.</span>';
  shown.forEach(n => {
    const c = document.createElement('span'); c.className = 'chip'; c.textContent = n;
    const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Nicht schwärzen'; x.onclick = () => toggleWord(n);
    c.appendChild(x); $('swChips').appendChild(c);
  });
  const n = SW.tokens.filter(t => t.w && isRedacted(t.t)).length;
  $('swMsg').textContent = n ? `${n} Stellen geschwärzt` : '';
}
function toggleWord(w) {
  const k = keyOf(w);
  if (isRedacted(w)) { SW.names.delete(k); SW.manual.delete(k); if (k.endsWith('s')) { SW.names.delete(k.slice(0, -1)); } SW.off.add(k); }
  else { SW.off.delete(k); SW.manual.add(k); }
  renderSw();
}
async function findNames(extra = []) {
  const text = $('swText').value.trim();
  if (!text) { toast('Bitte zuerst einen Text einfügen.'); return; }
  $('swFind').disabled = true; $('swMsg').textContent = 'Namen werden gesucht…';
  SW.names = new Set(); SW.off = new Set(); SW.manual = new Set();
  extra.forEach(addName);
  (await knownNames()).forEach(n => { if (new RegExp('\\b' + n.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) addName(n); });
  let ki = false;
  try { const r = await api.redactFind(text); if (r) { r.forEach(addName); ki = true; } }
  catch (e) { toast('KI-Suche nicht möglich: ' + e.message); }
  localFind(text).forEach(addName); localFind(text).forEach(addName);
  $('swResult').hidden = false; $('swFind').disabled = false;
  renderSw();
  if (!ki && !SETTINGS.hasClaudeKey) $('swMsg').textContent += ' · Ohne Claude-Schlüssel nur Grundsuche – fehlende Namen antippen.';
}
$('swFind').onclick = () => findNames(SW.caseNames || []);
let SW_CASES = [];
async function fillSwCases() {
  try {
    SW_CASES = await api.listCases(); const cur = $('swCase').value;
    $('swCase').innerHTML = '<option value="">– Text selbst einfügen –</option>' + SW_CASES.map(c => `<option value="${esc(c.id)}">${esc(c.aktenzeichen)}${c.titel ? ' · ' + esc(c.titel) : ''}</option>`).join('');
    $('swCase').value = cur;
  } catch (e) { }
}
function caseText(c) {
  const bet = (c.beteiligte || []).filter(b => b.name).map(b => `- ${b.name} (${b.rolle})`).join('\n');
  const trans = (c.transcript || []).map(t => `[${fmtT(t.start)}] ${t.who}: ${t.text}`).join('\n');
  return [(c.bericht || '').replace(/\*\*(.+?)\*\*/g, '$1').trim(), bet && '## Beteiligte\n' + bet, trans && '## Transkript\n' + trans].filter(Boolean).join('\n\n');
}
$('swCase').onchange = async () => {
  SW.caseNames = [];
  const id = $('swCase').value; if (!id) return;
  const c = await api.getCase(id); if (!c) return;
  $('swTitel').value = c.titel || 'Akte'; $('swAz').value = c.aktenzeichen || '';
  $('swText').value = caseText(c);
  SW.caseNames = (c.beteiligte || []).map(b => b.name).filter(Boolean);
  findNames(SW.caseNames);
};
$('swFile').onclick = () => $('swFileIn').click();
$('swFileIn').onchange = async () => {
  const f = $('swFileIn').files[0]; if (!f) return;
  $('swText').value = await f.text(); $('swCase').value = ''; SW.caseNames = [];
  if ($('swTitel').value === 'Akte') $('swTitel').value = f.name.replace(/\.[^.]+$/, '');
  $('swFileIn').value = ''; findNames();
};
$('swText').addEventListener('input', () => { if (!$('swResult').hidden) renderSw(); });
$('swNum').onchange = () => { if (!$('swResult').hidden) renderSw(); };
const swAdd = () => { const v = $('swAdd').value.trim(); if (!v) return; addName(v); $('swAdd').value = ''; renderSw(); };
$('swAddBtn').onclick = swAdd;
$('swAdd').onkeydown = e => { if (e.key === 'Enter') swAdd(); };
$('toSw').onclick = () => {
  collect();
  $('swTitel').value = CUR.titel || 'Akte'; $('swAz').value = CUR.aktenzeichen || ''; $('swCase').value = CUR.id;
  $('swText').value = (CUR.bericht || '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
  SW.caseNames = (CUR.beteiligte || []).map(b => b.name).filter(Boolean);
  show('sw'); findNames(SW.caseNames);
};

/* ---------- Bild erzeugen ---------- */
let sealImg = null;
const loadSeal = () => sealImg ? Promise.resolve(sealImg) : new Promise(res => { const i = new Image(); i.onload = () => res(sealImg = i); i.onerror = () => res(null); i.src = 'seal.png'; });
async function swCanvas() {
  const W = 1240, M = 104, TW = W - 2 * M, FS = 25, LH = 41, SERIF = 'Georgia, "Times New Roman", serif';
  const seal = await loadSeal();
  const meas = document.createElement('canvas').getContext('2d');
  // Zeilen aufbauen
  const lines = [];
  for (const raw of $('swText').value.replace(/\r/g, '').split('\n')) {
    let para = raw, head = false;
    const hm = para.match(/^\s*#{1,4}\s+(.*)/); if (hm) { para = hm[1]; head = true; }
    para = para.replace(/\*\*(.+?)\*\*/g, '$1');
    const font = (head ? '700 ' + (FS + 3) : '400 ' + FS) + 'px ' + SERIF;
    meas.font = font;
    if (!para.trim()) { lines.push({ gap: true }); continue; }
    if (head && lines.length && !lines[lines.length - 1].gap) lines.push({ gap: true, small: true });
    const toks = tokenize(para); let cur = [], x = 0;
    const push = () => { while (cur.length && !cur[cur.length - 1].w && !cur[cur.length - 1].t.trim()) cur.pop(); lines.push({ font, head, toks: cur }); cur = []; x = 0; };
    for (const tk of toks) {
      const w = meas.measureText(tk.t).width;
      if (tk.w && x + w > TW && cur.length) push();
      if (!tk.w && !cur.length && !tk.t.trim()) continue;
      cur.push({ t: tk.t, w: tk.w, x, width: w, r: tk.w && isRedacted(tk.t) }); x += w;
    }
    if (cur.length) push();
  }
  const top = 330, body = lines.reduce((h, l) => h + (l.gap ? (l.small ? LH * .35 : LH * .6) : (l.head ? LH * 1.15 : LH)), 0);
  const H = Math.max(1754, Math.ceil(top + body + 230));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#fdfcf8'; g.fillRect(0, 0, W, H);
  // Kopf
  if (seal) g.drawImage(seal, M, 62, 112, 112);
  g.fillStyle = '#1b2d57'; g.font = '700 38px ' + SERIF; g.textBaseline = 'alphabetic';
  if (g.letterSpacing !== undefined) g.letterSpacing = '3px';
  g.fillText('DEPARTMENT OF JUSTICE', M + 136, 112);
  if (g.letterSpacing !== undefined) g.letterSpacing = '0px';
  g.fillStyle = '#6b6b6b'; g.font = '400 20px ' + SERIF; g.fillText('Corleone City · State of San Andreas · Richterschaft', M + 138, 146);
  g.strokeStyle = '#a8822b'; g.lineWidth = 3; g.beginPath(); g.moveTo(M, 200); g.lineTo(W - M, 200); g.stroke();
  g.lineWidth = 1; g.beginPath(); g.moveTo(M, 207); g.lineTo(W - M, 207); g.stroke();
  g.fillStyle = '#14203a'; g.font = '700 36px ' + SERIF; g.fillText($('swTitel').value.trim() || 'Akte', M, 266);
  g.fillStyle = '#6b6b6b'; g.font = '400 19px ' + SERIF;
  g.fillText([$('swAz').value.trim() && 'Aktenzeichen ' + $('swAz').value.trim(), 'Stand ' + new Date().toLocaleDateString('de-DE'), 'Freigabefassung'].filter(Boolean).join('   ·   '), M, 300);
  // Text
  let y = top + 20;
  for (const l of lines) {
    if (l.gap) { y += l.small ? LH * .35 : LH * .6; continue; }
    y += l.head ? LH * 1.15 : LH;
    g.font = l.font; g.fillStyle = l.head ? '#1b2d57' : '#1a1a1a';
    const fs = l.head ? FS + 3 : FS;
    for (let i = 0; i < l.toks.length; i++) {
      const t = l.toks[i];
      if (!t.r) { g.fillStyle = l.head ? '#1b2d57' : '#1a1a1a'; g.fillText(t.t, M + t.x, y - 10); continue; }
      // Balken – zusammenhängende Namen ergeben einen durchgehenden Balken
      let end = t.x + t.width; const nx = l.toks[i + 1], nn = l.toks[i + 2];
      if (nx && !nx.w && /^ +$/.test(nx.t) && nn && nn.r) end = nx.x + nx.width;
      const j = Math.sin(y * 0.37) * 1.2;
      g.fillStyle = '#0d0d0d';
      g.fillRect(M + t.x - 2, y - 10 - fs * 0.8 + j, end - t.x + 4, fs * 1.04);
    }
  }
  // Stempel
  if ($('swStamp').checked) {
    g.save(); g.translate(W - M - 150, 262); g.rotate(-0.12); g.globalAlpha = .78;
    g.strokeStyle = '#b3261e'; g.fillStyle = '#b3261e'; g.lineWidth = 4;
    g.beginPath(); g.roundRect ? g.roundRect(-150, -42, 300, 84, 10) : g.rect(-150, -42, 300, 84); g.stroke();
    g.lineWidth = 1.5; g.beginPath(); g.roundRect ? g.roundRect(-142, -34, 284, 68, 6) : g.rect(-142, -34, 284, 68); g.stroke();
    g.textAlign = 'center'; g.font = '700 34px ' + SERIF; g.fillText('GESCHWÄRZT', 0, 6);
    g.font = '600 15px ' + SERIF; g.fillText('DOJ · ' + new Date().toLocaleDateString('de-DE'), 0, 27);
    g.restore(); g.textAlign = 'left';
  }
  // Fuss
  g.strokeStyle = '#d5d9e4'; g.lineWidth = 1; g.beginPath(); g.moveTo(M, H - 110); g.lineTo(W - M, H - 110); g.stroke();
  g.fillStyle = '#8a8a8a'; g.font = '400 17px ' + SERIF;
  g.fillText('Personenbezogene Daten wurden zum Schutz der Beteiligten geschwärzt.', M, H - 76);
  g.textAlign = 'right'; g.fillText((SETTINGS.dienstnummer || '') + ' · Department of Justice', W - M, H - 76); g.textAlign = 'left';
  return cv;
}
const cvBuf = cv => new Promise(res => cv.toBlob(b => b.arrayBuffer().then(res), 'image/png'));
const swName = () => 'Geschwaerzt-' + ($('swAz').value.trim() || $('swTitel').value.trim() || 'Akte').replace(/[\\/:*?"<>|\s]+/g, '-') + '-' + new Date().toISOString().slice(0, 10);
$('swSave').onclick = async () => { renderSw(); const f = await api.saveImage(await cvBuf(await swCanvas()), swName()); if (f) toast('Bild gespeichert'); };
$('swCopy').onclick = async () => { renderSw(); await api.copyImage(await cvBuf(await swCanvas())); toast('Bild kopiert – in Discord mit Strg+V einfügen'); };


/* ================= Updates & Sicherung ================= */
function updText(u) {
  switch (u.state) {
    case 'checking': return 'Suche nach Updates …';
    case 'none': return `${u.current || SETTINGS.version} · aktuell`;
    case 'downloading': return `Version ${u.version} wird geladen … ${u.pct || 0} %`;
    case 'ready': return `Version ${u.version} bereit`;
    case 'error': return `${u.current || SETTINGS.version} · ${u.error}`;
    case 'disabled': return `${u.current || SETTINGS.version} · Updates nur in der installierten App`;
    default: return (u.current || SETTINGS.version || '–') + '';
  }
}
let UPD = {};
function showUpd(u) {
  UPD = Object.assign(UPD, u);
  $('updState').textContent = updText(UPD);
  $('updBtn').textContent = UPD.state === 'ready' ? 'Jetzt neu starten' : 'Nach Updates suchen';
  $('updBtn').className = 'btn small ' + (UPD.state === 'ready' ? 'filled' : 'tinted');
  $('updBtn').disabled = UPD.state === 'checking' || UPD.state === 'downloading';
  if (UPD.state === 'ready' && !UPD.dismissed) { $('updText').textContent = `Update ${UPD.version} ist bereit – deine Daten bleiben erhalten.`; $('updBar').hidden = false; }
}
api.onUpdate(showUpd);
api.updateState().then(u => { if (!u.enabled) u.state = 'disabled'; showUpd(u); });
async function installUpd() {
  if (R) return toast('Bitte zuerst die laufende Aufnahme beenden.');
  if (BUSY) return toast('Bitte warten, bis die Auswertung fertig ist.');
  toast('Update wird installiert, die App startet gleich neu …');
  await api.updateInstall();
}
$('updBtn').onclick = async () => { if (UPD.state === 'ready') return installUpd(); showUpd({ state: 'checking' }); showUpd(await api.updateCheck()); };
$('updNow').onclick = installUpd;
$('updLater').onclick = () => { UPD.dismissed = true; $('updBar').hidden = true; toast('Wird beim nächsten Schliessen installiert'); };

const fmtBk = name => { const m = name && name.match(/^(\d{4})-(\d\d)-(\d\d)-(\d\d)-(\d\d)/); return m ? `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}` : 'noch keine'; };
async function loadBackup() { try { const b = await api.backupInfo(); $('bkLast').textContent = fmtBk(b.last); } catch (e) { } }
$('bkNow').onclick = async () => { $('bkNow').disabled = true; try { const r = await api.backupNow(); toast(`Gesichert: ${r.akten} Akten`); loadBackup(); } catch (e) { toast('Sicherung fehlgeschlagen: ' + e.message); } $('bkNow').disabled = false; };
$('bkOpen').onclick = () => api.backupOpen();
$('bkRestore').onclick = async () => {
  try { const r = await api.backupRestore(); if (!r) return; toast(`${r.akten} Akten wiederhergestellt`); const p = await api.getProgress(); if (p) { S = Object.assign({ best: {}, wrong: [], right: 0 }, p); save(); renderPath(); } loadBackup(); }
  catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
};
loadBackup();

/* ================= Start ================= */
renderPath();
loadSettings().then(refreshModel);
window.__ra = { show, openCase, processCase, loadCaseList, get CUR() { return CUR; } }; // für Tests
