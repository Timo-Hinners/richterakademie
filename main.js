// Richterakademie – Hauptprozess
const { app, BrowserWindow, ipcMain, session, desktopCapturer, dialog, safeStorage, shell, Menu, utilityProcess, nativeTheme, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MAX_HE = 90;
const MAX_GELD = 100000;

/* ---------- Protokoll & Absturzschutz ---------- */
const logFile = () => path.join(app.getPath('userData'), 'richterakademie.log');
function log(...a) { try { fs.appendFileSync(logFile(), new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch { } }
process.on('uncaughtException', e => { log('FEHLER', e && e.stack || e); try { dialog.showErrorBox('Richterakademie – Fehler', String(e && e.message || e) + '\n\nDetails: ' + logFile()); } catch { } });
process.on('unhandledRejection', e => log('REJECT', e && e.stack || e));

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win;
const dataDir = () => path.join(app.getPath('userData'), 'akten');
const modelDir = () => path.join(app.getPath('userData'), 'modelle');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const vadModel = () => path.join(__dirname, 'assets', 'models', 'silero_vad.onnx').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
function ensureDirs() { fs.mkdirSync(dataDir(), { recursive: true }); fs.mkdirSync(modelDir(), { recursive: true }); }

/* ---------- Einstellungen ---------- */
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function writeSettings(s) { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); }
function enc(v) {
  if (!v) return '';
  try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(v).toString('base64'); } catch { }
  return 'raw:' + Buffer.from(v).toString('base64');
}
function dec(v) {
  if (!v) return '';
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString();
  } catch { }
  return '';
}
function publicSettings() {
  const s = readSettings();
  return {
    richterName: s.richterName || '', dienstnummer: s.dienstnummer || 'DOJ-XX', rang: s.rang || 'Richter a. P.',
    claudeModel: s.claudeModel || 'claude-sonnet-5-5', whisperModel: ['small', 'base'].includes(s.whisperModel) ? s.whisperModel : 'small',
    engine: s.engine || 'lokal', micId: s.micId || '', theme: s.theme || 'light',
    hasClaudeKey: !!dec(s.claudeKey), hasOpenAIKey: !!dec(s.openaiKey), version: app.getVersion()
  };
}
function effectiveDark(theme) { return theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors); }

/* ---------- Fenster ---------- */
function createWindow() {
  const dark = effectiveDark(publicSettings().theme);
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 440, minHeight: 600, show: false,
    title: 'Richterakademie', backgroundColor: dark ? '#0b0b0d' : '#f5f5f7',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.webContents.on('render-process-gone', (e, d) => log('RENDERER', JSON.stringify(d)));
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 2) log('KONSOLE', msg); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  log('Start', app.getVersion(), process.platform, os.release());
  ensureDirs();
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'display-capture', 'clipboard-sanitized-write'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => ['media', 'display-capture', 'clipboard-sanitized-write'].includes(perm));
  // Windows-Systemton (TeamSpeak / SaltyChat) per Loopback, ohne Auswahldialog
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then(src => cb(src.length ? { video: src[0], audio: 'loopback' } : {}))
      .catch(err => { log('Loopback', err); cb({}); });
  });
  autoBackup();
  createWindow();
  initUpdater();
});
app.on('window-all-closed', () => app.quit());

/* ---------- Einstellungen IPC ---------- */
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:set', (e, upd) => {
  const s = readSettings();
  for (const k of ['richterName', 'dienstnummer', 'rang', 'claudeModel', 'whisperModel', 'engine', 'micId', 'theme']) if (k in upd) s[k] = upd[k];
  if (typeof upd.claudeKey === 'string' && upd.claudeKey.trim()) s.claudeKey = enc(upd.claudeKey.trim());
  if (typeof upd.openaiKey === 'string' && upd.openaiKey.trim()) s.openaiKey = enc(upd.openaiKey.trim());
  writeSettings(s);
  if ('theme' in upd && win) {
    const dark = effectiveDark(s.theme);
    try { win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f5f5f7' : '#1d1d1f', height: 40 }); } catch { }
    win.setBackgroundColor(dark ? '#0b0b0d' : '#f5f5f7');
  }
  return publicSettings();
});
ipcMain.handle('theme:dark', (e, t) => effectiveDark(t));

/* ---------- Akten ---------- */
const safeId = id => String(id).replace(/[^\w-]/g, '');
const caseFile = id => path.join(dataDir(), safeId(id) + '.json');
function clamp(v, max) { v = Math.round(Number(v) || 0); return Math.max(0, Math.min(max, v)); }
ipcMain.handle('cases:list', () => {
  ensureDirs();
  return fs.readdirSync(dataDir()).filter(f => f.endsWith('.json')).map(f => {
    try { const c = JSON.parse(fs.readFileSync(path.join(dataDir(), f), 'utf8')); return { id: c.id, aktenzeichen: c.aktenzeichen, art: c.art, datum: c.datum, ts: c.ts || 0, titel: c.titel, status: c.status }; } catch { return null; }
  }).filter(Boolean).sort((a, b) => (b.ts || 0) - (a.ts || 0));
});
ipcMain.handle('cases:get', (e, id) => { try { return JSON.parse(fs.readFileSync(caseFile(id), 'utf8')); } catch { return null; } });
ipcMain.handle('cases:save', (e, c) => {
  ensureDirs();
  if (c.strafe) { c.strafe.he = clamp(c.strafe.he, MAX_HE); c.strafe.geld = clamp(c.strafe.geld, MAX_GELD); }
  fs.writeFileSync(caseFile(c.id), JSON.stringify(c, null, 2));
  return true;
});
ipcMain.handle('cases:delete', (e, id) => {
  const sid = safeId(id);
  for (const f of fs.readdirSync(dataDir())) if (f === sid + '.json' || f.startsWith(sid + '-')) fs.rmSync(path.join(dataDir(), f), { force: true });
  return true;
});
ipcMain.handle('cases:openFolder', () => shell.openPath(dataDir()));
ipcMain.handle('audio:save', (e, id, track, buf, ext) => {
  ensureDirs();
  const f = path.join(dataDir(), `${safeId(id)}-${track}.${ext || 'webm'}`);
  fs.writeFileSync(f, Buffer.from(buf));
  return path.basename(f);
});
ipcMain.handle('audio:read', (e, name) => {
  const f = path.join(dataDir(), path.basename(name));
  return fs.existsSync(f) ? fs.readFileSync(f) : null;
});
ipcMain.handle('audio:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Aufnahme importieren', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'ogg', 'webm', 'opus', 'flac', 'aac'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const f = r.filePaths[0];
  return { name: path.basename(f), ext: path.extname(f).slice(1).toLowerCase(), data: fs.readFileSync(f) };
});

/* ---------- Spracherkennung im eigenen Prozess ---------- */
let worker = null, reqId = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = utilityProcess.fork(path.join(__dirname, 'asr-worker.js'), [], { serviceName: 'Richterakademie Spracherkennung', stdio: 'pipe' });
  worker.stderr && worker.stderr.on('data', d => log('ASR', String(d).trim()));
  worker.on('message', m => {
    const p = pending.get(m.id); if (!p) return;
    if (m.progress !== undefined) return p.onProgress && p.onProgress(m.progress);
    pending.delete(m.id);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
  });
  worker.on('exit', code => {
    log('ASR beendet', code); worker = null;
    for (const [, p] of pending) p.reject(new Error('Spracherkennung abgestürzt (Code ' + code + '). Details im Protokoll.'));
    pending.clear();
  });
  return worker;
}
function ask(msg, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++reqId;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage(Object.assign({ id, modelDir: modelDir(), vadModel: vadModel() }, msg));
  });
}
ipcMain.handle('model:status', () => ask({ cmd: 'status' }));
ipcMain.handle('model:download', (e, model) => ask({ cmd: 'download', model }, p => e.sender.send('progress', { kind: 'download', pct: p })));
ipcMain.handle('transcribe:local', (e, pcm, track) => {
  const model = publicSettings().whisperModel;
  const buf = pcm instanceof Float32Array ? pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) : pcm;
  return ask({ cmd: 'transcribe', model, pcm: buf }, p => e.sender.send('progress', { kind: 'transcribe', track, pct: p }));
});

/* ---------- Erkennung über OpenAI (optional) ---------- */
const HALLU = /(untertitel|im auftrag des|vielen dank f(ü|u)r(s)? zus(c)?hauen|amara\.org|copyright|bis zum n(ä|a)chsten mal|abonnier)/i;
ipcMain.handle('transcribe:openai', async (e, fileName) => {
  const key = dec(readSettings().openaiKey);
  if (!key) throw new Error('Kein OpenAI-Schlüssel hinterlegt.');
  const f = path.join(dataDir(), path.basename(fileName));
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(f)]), path.basename(f));
  fd.append('model', 'whisper-1'); fd.append('language', 'de'); fd.append('response_format', 'verbose_json');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
  if (!r.ok) throw new Error('OpenAI: ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  return (j.segments || [{ start: 0, end: 0, text: j.text }]).map(s => ({ start: s.start, end: s.end, text: (s.text || '').trim() })).filter(s => s.text && !HALLU.test(s.text));
});

/* ---------- Akte über Claude ---------- */
const RULES = `Feste Regeln für jedes Strafmaß auf diesem Server:
- Höchstens ${MAX_HE} Hafteinheiten (HE), niemals mehr – auch nicht bei Gesamtstrafen.
- Höchstens ${MAX_GELD.toLocaleString('de-DE')} $ Geldstrafe, niemals mehr.
Wichtige Rechtsgrundlagen (Corleone City):
- StPO §6(4): Beschuldigter darf einmal einen Anwalt verlangen, Wartezeit max. 10 Min.; Rechte einmal verlesen, von zweitem Beamten bezeugt, spätestens vor Betreten des Haftortes. Ohne Ausnahmesituation nicht verlesen → sofort freilassen.
- StPO §6(2): Gewahrsam ohne Richter max. 30 Min. §6(6): 15 Min. Aktenzeit nicht angerechnet. §6(7): unkooperativ → keine Anrechnung.
- StPO §5: Verjährung nach 12 Wochen ohne Anklage. §10(5): freiwillig gestellt → bis 50 % Milderung. §3: befangener Exekutivbeamter zieht 10 % ab.
- StPO §13: Richter darf ±50 % vom Strafenkatalog abweichen; keine Doppelbestrafung.
- StPO §18: Kollektivstrafe ab 3 Tatbeteiligten. §19: Gesamtstrafe unter 90 HE addieren, sonst 2/3 – aber nie über ${MAX_HE} HE. Geldstrafen addieren, aber nie über ${MAX_GELD.toLocaleString('de-DE')} $.
- StGB §7 Beihilfe = Täter; §8 Versuch strafbar, Milderung möglich; §18/19: Schuss auf Person = mindestens (versuchter) Totschlag; §20 Mord nicht im Eilverfahren; §45 illegale Orte: 60 HE + 50.000 $.
- StGB §11: Bewährung nur durch Richter, Haft unter 30 HE (Leitfaden: 15–30 HE), max. 14 Tage, Geldstrafe bleibt voll.
- Leitfaden: Strafen verhältnismäßig; kooperative Tatverdächtige mit langer Wartezeit deutlich unter dem Maximum (z. B. 65 statt 90 HE); volle HE nur bei massiver Störung. Arbeit eines Anwalts berücksichtigen.
- Urteil: 3 Tage Zahlungsfrist, 10 Tage Revisionsfrist.`;
function fmtT(s) { s = Math.max(0, Math.round(s || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }

function buildPrompt(c, s) {
  const lines = (c.transcript || []).map(t => `[${fmtT(t.start)}] ${t.who}: ${t.text}`).join('\n');
  const marks = (c.marker || []).map(m => `[${fmtT(m.t)}] MARKIERUNG: ${m.text}`).join('\n');
  const bet = (c.beteiligte || []).map(b => `- ${b.name} (${b.rolle})`).join('\n');
  return `Du bist Protokollführer am Department of Justice in Corleone City (GTA-Roleplay-Server). Erstelle aus der Aufnahme einer Verhandlung eine saubere, sachliche Akte auf Deutsch.

Verfahren: ${c.art || '-'} · Aktenzeichen: ${c.aktenzeichen || '-'} · Datum: ${c.datum || '-'}
Vorsitzender Richter: ${s.richterName || '-'} (${s.dienstnummer})
Beteiligte laut Richter:
${bet || '- keine Angaben'}
Notizen des Richters:
${c.notizen || '-'}
${marks ? 'Markierungen während der Verhandlung:\n' + marks : ''}

Transkript (automatisch erkannt, kann Hörfehler enthalten – korrigiere offensichtliche Hörfehler bei Namen und Begriffen sinngemäß; "Richter (ich)" ist das Mikrofon des Richters, "Gegenüber" ist alles, was über TeamSpeak/SaltyChat zu hören war – ordne die Sprecher dort anhand des Inhalts zu: Angeklagter, Anwalt, Staatsanwalt, Beamter, Zeuge):
${lines || '(leer)'}

${RULES}

Schreibe die Akte in Markdown mit genau diesen Abschnitten (## Überschriften):
## Sachverhalt
## Verlauf der Verhandlung
## Aussagen der Beteiligten
## Beweise und Zeugen
## Verfahrensprüfung
## Rechtliche Würdigung
## Schlussfolgerung und Strafvorschlag
## Offene Punkte

In der Verfahrensprüfung: Rechte verlesen, Anwalt, Haftzeit, mögliche Verfahrensfehler – nur was aus dem Transkript hervorgeht, sonst „nicht feststellbar“.
In der Rechtlichen Würdigung: Paragraphen mit Begründung. In der Schlussfolgerung: mildernde und verschärfende Umstände, Bewährung ja/nein.
Erfinde nichts. Kennzeichne Unklares als unklar. Der Strafvorschlag ist ein Vorschlag, die Entscheidung trifft der Richter.
Die allerletzte Zeile muss exakt dieses Format haben und darf ${MAX_HE} HE und ${MAX_GELD} $ nicht überschreiten:
STRAFE: <Hafteinheiten als Zahl> HE | <Geldstrafe als Zahl ohne Punkte> $`;
}
function parseReport(text) {
  let md = String(text || '').trim(), he = null, geld = null;
  const m = md.match(/STRAFE:\s*([\d.,']+)\s*HE\s*\|\s*\$?\s*([\d.,']+)\s*\$?/i);
  if (m) {
    he = clamp(m[1].replace(/[.,']/g, ''), MAX_HE);
    geld = clamp(m[2].replace(/[.,']/g, ''), MAX_GELD);
    md = md.replace(m[0], '').trim();
  }
  return { md, he, geld };
}
ipcMain.handle('report:create', async (e, c) => {
  const key = dec(readSettings().claudeKey);
  if (!key) throw new Error('Kein Claude-API-Schlüssel hinterlegt (Einstellungen).');
  const s = publicSettings();
  const r = await fetch(process.env.RA_CLAUDE_URL || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: s.claudeModel, max_tokens: 4000, messages: [{ role: 'user', content: buildPrompt(c, s) }] })
  });
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 401) throw new Error('Claude-API-Schlüssel ungültig.');
    if (r.status === 404) throw new Error('Claude-Modell „' + s.claudeModel + '“ nicht gefunden. In den Einstellungen anpassen.');
    throw new Error('Claude-API ' + r.status + ': ' + t.slice(0, 200));
  }
  const j = await r.json();
  return parseReport((j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n'));
});

/* ---------- Schwärzen: Namen über Claude finden ---------- */
ipcMain.handle('redact:find', async (e, text) => {
  const key = dec(readSettings().claudeKey);
  if (!key) return null;
  const s = publicSettings();
  const prompt = `Finde in folgendem Text (GTA-Roleplay, Deutsch) ALLE Namen von Personen: Vornamen, Nachnamen, vollständige Namen, Spitznamen, Ingame-Namen, auch falsch geschriebene oder abgekürzte Varianten und Namen in Besitzform (z. B. "Saints'"). Keine Orte, Strassen, Firmen, Behörden, Dienstgrade oder Paragraphen.
Antworte NUR mit JSON, ohne Erklärung: {"namen":["...", "..."]} – jede Schreibweise genau so, wie sie im Text steht.

TEXT:
${String(text).slice(0, 30000)}`;
  const r = await fetch(process.env.RA_CLAUDE_URL || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: s.claudeModel, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) {
    if (r.status === 401) throw new Error('Claude-API-Schlüssel ungültig.');
    throw new Error('Claude-API ' + r.status);
  }
  const j = await r.json();
  const out = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  const m = out.match(/\{[\s\S]*\}/);
  try { const names = JSON.parse(m ? m[0] : out).namen; return Array.isArray(names) ? names.map(String) : []; } catch { return []; }
});
ipcMain.handle('image:save', async (e, buf, name) => {
  const target = process.env.RA_EXPORT_DIR ? path.join(process.env.RA_EXPORT_DIR, name + '.png') : (await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('pictures'), name + '.png'), filters: [{ name: 'Bild', extensions: ['png'] }] })).filePath;
  if (!target) return null;
  fs.writeFileSync(target, Buffer.from(buf));
  return target;
});
ipcMain.handle('image:copy', (e, buf) => { clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(buf))); return true; });

/* ---------- Lernfortschritt als Datei (überlebt Updates & Neuinstallation) ---------- */
const progressFile = () => path.join(app.getPath('userData'), 'lernfortschritt.json');
ipcMain.handle('progress:get', () => { try { return JSON.parse(fs.readFileSync(progressFile(), 'utf8')); } catch { return null; } });
ipcMain.handle('progress:set', (e, p) => { fs.writeFileSync(progressFile(), JSON.stringify(p)); return true; });

/* ---------- Datensicherung ---------- */
const backupRoot = () => process.env.RA_BACKUP_DIR || path.join(app.getPath('documents'), 'Richterakademie', 'Sicherungen');
const BACKUP_KEEP = 15;
function copyDir(src, dst, filter) {
  if (!fs.existsSync(src)) return 0; fs.mkdirSync(dst, { recursive: true }); let n = 0;
  for (const f of fs.readdirSync(src)) {
    const a = path.join(src, f), b = path.join(dst, f), st = fs.statSync(a);
    if (st.isDirectory()) n += copyDir(a, b, filter);
    else if (!filter || filter(f)) { fs.copyFileSync(a, b); n++; }
  }
  return n;
}
function backup(reason) {
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
  const dst = path.join(backupRoot(), `${stamp}_${reason}`);
  fs.mkdirSync(dst, { recursive: true });
  const n = copyDir(dataDir(), path.join(dst, 'akten'), f => f.endsWith('.json'));
  for (const f of ['settings.json', 'lernfortschritt.json']) { const a = path.join(app.getPath('userData'), f); if (fs.existsSync(a)) fs.copyFileSync(a, path.join(dst, f)); }
  fs.writeFileSync(path.join(dst, 'info.json'), JSON.stringify({ version: app.getVersion(), datum: new Date().toISOString(), grund: reason, akten: n }, null, 2));
  const all = fs.readdirSync(backupRoot()).filter(d => /^\d{4}-/.test(d)).sort();
  for (const d of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) fs.rmSync(path.join(backupRoot(), d), { recursive: true, force: true });
  log('Sicherung', dst, n);
  return { path: dst, akten: n };
}
function lastBackup() {
  try { const all = fs.readdirSync(backupRoot()).filter(d => /^\d{4}-/.test(d)).sort(); return all.length ? all[all.length - 1] : null; } catch { return null; }
}
function autoBackup() {
  try {
    const last = lastBackup(), d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const s = readSettings();
    if (s.lastVersion && s.lastVersion !== app.getVersion()) backup('nach-update-' + app.getVersion());
    else if (!last || !last.startsWith(today)) backup('taeglich');
    if (s.lastVersion !== app.getVersion()) { s.lastVersion = app.getVersion(); writeSettings(s); }
  } catch (e) { log('Sicherung fehlgeschlagen', e && e.stack || e); }
}
ipcMain.handle('backup:info', () => ({ folder: backupRoot(), last: lastBackup(), dataDir: app.getPath('userData') }));
ipcMain.handle('backup:now', () => backup('manuell'));
ipcMain.handle('backup:open', () => { fs.mkdirSync(backupRoot(), { recursive: true }); return shell.openPath(backupRoot()); });
ipcMain.handle('backup:restore', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Sicherung wählen', defaultPath: backupRoot(), properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  if (!fs.existsSync(path.join(src, 'akten')) && !fs.existsSync(path.join(src, 'lernfortschritt.json'))) throw new Error('Das ist kein Sicherungsordner der Richterakademie.');
  backup('vor-wiederherstellung');
  const n = copyDir(path.join(src, 'akten'), dataDir(), f => f.endsWith('.json'));
  const pf = path.join(src, 'lernfortschritt.json'); if (fs.existsSync(pf)) fs.copyFileSync(pf, progressFile());
  return { akten: n };
});

/* ---------- Automatische Updates (GitHub Releases) ---------- */
let updater = null, updState = { state: 'idle' };
function sendUpd(st) { updState = st; if (win && !win.isDestroyed()) win.webContents.send('update', st); }
function initUpdater() {
  if (!app.isPackaged && !process.env.RA_UPDATE_URL) return;
  try { updater = require('electron-updater').autoUpdater; } catch (e) { log('Updater fehlt', e); return; }
  updater.logger = { info: m => log('UPD', m), warn: m => log('UPD', m), error: m => log('UPD', m), debug: () => { } };
  if (process.env.RA_UPDATE_URL) updater.setFeedURL({ provider: 'generic', url: process.env.RA_UPDATE_URL });
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => sendUpd({ state: 'checking' }));
  updater.on('update-not-available', () => sendUpd({ state: 'none' }));
  updater.on('update-available', i => sendUpd({ state: 'downloading', version: i.version, pct: 0 }));
  updater.on('download-progress', p => sendUpd({ state: 'downloading', version: updState.version, pct: Math.round(p.percent) }));
  updater.on('update-downloaded', i => { try { backup('vor-update-' + i.version); } catch { } sendUpd({ state: 'ready', version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes.replace(/<[^>]+>/g, '').slice(0, 400) : '' }); });
  updater.on('error', e => { log('UPD Fehler', e && e.message); sendUpd({ state: 'error', error: offlineMsg(e) }); });
  setTimeout(() => updater.checkForUpdates().catch(() => { }), 4000);
  setInterval(() => updater.checkForUpdates().catch(() => { }), 3 * 60 * 60 * 1000);
}
const offlineMsg = e => /ENOTFOUND|ECONN|ETIMEDOUT|net::/.test(String(e && e.message)) ? 'Keine Internetverbindung' : (/404/.test(String(e && e.message)) ? 'Noch keine Updates veröffentlicht' : 'Update-Prüfung fehlgeschlagen');
ipcMain.handle('update:state', () => Object.assign({ current: app.getVersion(), enabled: !!updater }, updState));
ipcMain.handle('update:check', async () => { if (!updater) return { state: 'disabled' }; try { await updater.checkForUpdates(); } catch (e) { sendUpd({ state: 'error', error: offlineMsg(e) }); } return updState; });
ipcMain.handle('update:install', () => { if (updater && updState.state === 'ready') { setImmediate(() => updater.quitAndInstall(true, true)); return true; } return false; });

/* ---------- Export ---------- */
ipcMain.handle('export:pdf', async (e, html, name) => {
  const tmp = path.join(os.tmpdir(), 'richterakademie-druck.html');
  fs.writeFileSync(tmp, html);
  const pw = new BrowserWindow({ show: false });
  try {
    await pw.loadFile(tmp);
    const pdf = await pw.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } });
    const target = process.env.RA_EXPORT_DIR ? path.join(process.env.RA_EXPORT_DIR, name + '.pdf') : (await dialog.showSaveDialog(win, { defaultPath: name + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] })).filePath;
    if (!target) return null;
    fs.writeFileSync(target, pdf);
    if (!process.env.RA_EXPORT_DIR) shell.showItemInFolder(target);
    return target;
  } finally { pw.destroy(); }
});
ipcMain.handle('export:text', async (e, text, name, ext) => {
  const target = process.env.RA_EXPORT_DIR ? path.join(process.env.RA_EXPORT_DIR, name + '.' + ext) : (await dialog.showSaveDialog(win, { defaultPath: name + '.' + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })).filePath;
  if (!target) return null;
  fs.writeFileSync(target, text, 'utf8');
  return target;
});
ipcMain.handle('open:external', (e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });

module.exports = { parseReport, buildPrompt };
