/* Richterakademie – Urteil erstellen (nutzt Hilfsfunktionen aus app.js) */
const ERG = ['Schuldig', 'Nicht nachgewiesen', 'Freispruch', 'Eingestellt'];
const RMB_DEFAULT = d => `Gegen dieses ${d} kann innerhalb von 10 Tagen nach Zustellung Revision beim Department of Justice eingelegt werden. Die Revision hat keine aufschiebende Wirkung.`;
let UCASE = null, U = null, urSaveT = null;

const today = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const deDate = iso => { const m = String(iso || '').match(/^(\d{4})-(\d\d)-(\d\d)$/); return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || ''); };
const money = n => fmt(n) + ' $';
const listJoin = a => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' und ' + a[a.length - 1];

function newDef(name = '', g = 'm') { return { name, g, counts: [{ v: '', p: '', he: '', geld: '', erg: 'Schuldig' }], he: '', geld: '', bew: false, bewTage: 14, fs: false, ws: false, stvo: '', susp: '', diszi: false, neben: '' }; }
function newUrteil(c) {
  const s = c && c.strafe || {};
  const angeklagte = (c && c.beteiligte || []).filter(b => /Angeklagt|Beklagt|Beschuldigt/i.test(b.rolle) && b.name);
  const defs = angeklagte.length ? angeklagte.map(b => newDef(b.name)) : [newDef()];
  if (s.he || s.geld) { defs[0].he = s.he || ''; defs[0].geld = s.geld || ''; defs[0].bew = !!s.bew; defs[0].fs = !!s.fs; defs[0].ws = !!s.ws; defs[0].stvo = s.stvo || ''; }
  const zeugen = (c && c.beteiligte || []).filter(b => b.name && !/Angeklagt|Beklagt|Beschuldigt|Staatsanw|Anwalt|Verteid|Richter/i.test(b.rolle)).map(b => `${b.name} (${b.rolle})`);
  return {
    az: c && c.aktenzeichen || '', art: /Eil/i.test(c && c.art || '') ? 'Eilverfahren' : /SG/i.test(c && c.art || '') ? 'SG-Urteil' : /Revision/i.test(c && c.art || '') ? 'Revisionsverfahren' : 'Hauptverhandlung',
    dok: 'Urteil', ort: 'Los Santos', datum: today(), sta: (c && c.beteiligte || []).find(b => /Staatsanw/i.test(b.rolle))?.name || '', vert: (c && c.beteiligte || []).find(b => /^(?:Rechts)?anw|Verteid/i.test(b.rolle))?.name || '',
    defs, beweise: zeugen.join(', '), bw: '', rw: '', mass: '', rmb: RMB_DEFAULT('Urteil'), zahl: true, siegel: true
  };
}

/* ---------- Strafberechnung (StPO §19, Deckel) ---------- */
function calcDef(d) {
  const guilty = d.counts.filter(c => c.erg === 'Schuldig' && c.v.trim());
  const heList = guilty.map(c => Math.max(0, +c.he || 0)).filter(Boolean), gList = guilty.map(c => Math.max(0, +c.geld || 0));
  const sumHe = heList.reduce((a, b) => a + b, 0), sumG = gList.reduce((a, b) => a + b, 0);
  let autoHe = heList.length > 1 && sumHe >= 90 ? Math.round(sumHe * 2 / 3) : sumHe;
  let calc = heList.length > 1 ? (sumHe >= 90 ? `(${heList.join(' + ')}) × 2/3 = ${autoHe} HE` : `${heList.join(' + ')} = ${sumHe} HE`) : '';
  const heRaw = d.he !== '' && d.he !== null ? +d.he : autoHe, gRaw = d.geld !== '' && d.geld !== null ? +d.geld : sumG;
  const he = capHE(heRaw), geld = capGeld(gRaw);
  const warn = [];
  if (heRaw > MAX_HE) warn.push(`auf ${MAX_HE} HE gedeckelt`);
  if (gRaw > MAX_GELD) warn.push(`auf ${fmt(MAX_GELD)} $ gedeckelt`);
  if (d.bew && he > 30) warn.push('Bewährung nur bis 30 HE');
  if (d.bew && (+d.bewTage || 0) > 14) warn.push('Bewährung max. 14 Tage');
  return { guilty, he, geld, calc, warn, auto: { he: autoHe, geld: sumG } };
}

/* ---------- Formular ---------- */
function urRenderDefs() {
  const box = $('urDefs'); box.innerHTML = '';
  U.defs.forEach((d, i) => {
    const el = document.createElement('div'); el.className = 'def glass';
    el.innerHTML = `
      <div class="defhead">
        <label class="field"><span>${i + 1}. Angeklagte Person</span><input data-k="name" value="${esc(d.name)}" placeholder="Vor- und Nachname"></label>
        <label class="field"><span>Anrede im Text</span><select data-k="g"><option value="m">Der Angeklagte</option><option value="w">Die Angeklagte</option></select></label>
        <button class="xbtn" data-act="delDef" title="Entfernen" aria-label="Angeklagte Person entfernen">✕</button>
      </div>
      <div class="counts">
        <div class="count counthead"><span>Tatvorwurf</span><span>§</span><span>HE</span><span>Geld $</span><span>Ergebnis</span><span></span></div>
        ${d.counts.map((c, j) => `<div class="count" data-j="${j}">
          <input data-c="v" value="${esc(c.v)}" placeholder="z. B. Sachbeschädigung (Rammen des Fahrzeugs)">
          <input data-c="p" value="${esc(c.p)}" placeholder="§ 42 StGB">
          <input data-c="he" type="number" min="0" max="90" value="${esc(c.he)}" placeholder="HE">
          <input data-c="geld" type="number" min="0" max="100000" step="500" value="${esc(c.geld)}" placeholder="$">
          <select data-c="erg">${ERG.map(e => `<option${e === c.erg ? ' selected' : ''}>${e}</option>`).join('')}</select>
          <button class="xbtn" data-act="delCount" title="Tatvorwurf entfernen" aria-label="Tatvorwurf entfernen">✕</button>
        </div>`).join('')}
      </div>
      <button class="btn plain small" data-act="addCount">+ Tatvorwurf</button>
      <div class="sum" data-sum></div>
      <div class="defopts">
        <label class="field"><span>Hafteinheiten gesamt</span><input data-k="he" type="number" min="0" max="90" value="${esc(d.he)}" placeholder="automatisch"></label>
        <label class="field"><span>Geldstrafe gesamt $</span><input data-k="geld" type="number" min="0" max="100000" step="500" value="${esc(d.geld)}" placeholder="automatisch"></label>
        <label class="field"><span>StVO-Punkte</span><input data-k="stvo" type="number" min="0" value="${esc(d.stvo)}"></label>
        <label class="field"><span>Suspendierung (Tage)</span><input data-k="susp" type="number" min="0" value="${esc(d.susp)}" placeholder="nur Beamte"></label>
      </div>
      <div class="row opts-row">
        <label class="toggle"><input type="checkbox" data-k="bew"${d.bew ? ' checked' : ''}><i></i>Bewährung</label>
        <label class="field" style="width:120px${d.bew ? '' : ';display:none'}" data-bewtage><input data-k="bewTage" type="number" min="1" max="14" value="${esc(d.bewTage)}" aria-label="Bewährungstage"></label>
        <label class="toggle"><input type="checkbox" data-k="fs"${d.fs ? ' checked' : ''}><i></i>Führerscheinentzug</label>
        <label class="toggle"><input type="checkbox" data-k="ws"${d.ws ? ' checked' : ''}><i></i>Waffenscheinentzug</label>
        <label class="toggle"><input type="checkbox" data-k="diszi"${d.diszi ? ' checked' : ''}><i></i>Disziplinarverfahren</label>
      </div>
      <label class="field" style="margin-top:8px"><span>Weitere Nebenfolgen (optional)</span><input data-k="neben" value="${esc(d.neben)}" placeholder="z. B. Einziehung der Tatwaffe"></label>`;
    el.querySelector('[data-k="g"]').value = d.g || 'm';
    el.addEventListener('input', e => urFieldChange(e, i, el));
    el.addEventListener('change', e => urFieldChange(e, i, el));
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'addCount') { d.counts.push({ v: '', p: '', he: '', geld: '', erg: 'Schuldig' }); urRenderDefs(); el.ownerDocument.querySelectorAll('.def')[i]?.querySelector('.count:last-of-type input')?.focus(); }
      if (a.dataset.act === 'delCount') { d.counts.splice(+a.closest('.count').dataset.j, 1); if (!d.counts.length) d.counts.push({ v: '', p: '', he: '', geld: '', erg: 'Schuldig' }); urRenderDefs(); }
      if (a.dataset.act === 'delDef') { if (U.defs.length > 1) { U.defs.splice(i, 1); urRenderDefs(); } else toast('Mindestens eine angeklagte Person'); }
      urChanged();
    });
    box.appendChild(el); urSum(d, el);
  });
}
function urFieldChange(e, i, el) {
  const d = U.defs[i], t = e.target;
  if (t.dataset.k) { d[t.dataset.k] = t.type === 'checkbox' ? t.checked : t.value; if (t.dataset.k === 'bew') el.querySelector('[data-bewtage]').style.display = t.checked ? '' : 'none'; }
  else if (t.dataset.c) { const j = +t.closest('.count').dataset.j; d.counts[j][t.dataset.c] = t.value; }
  else return;
  // Deckel direkt im Feld zeigen, sobald das Feld verlassen wird
  if (e.type === 'change' && t.type === 'number' && t.value !== '' && /^(he|geld)$/.test(t.dataset.k || t.dataset.c)) {
    const cap = /he/.test(t.dataset.k || t.dataset.c) ? capHE(t.value) : capGeld(t.value);
    if (+t.value !== cap) { t.value = cap; if (t.dataset.k) d[t.dataset.k] = cap; else d.counts[+t.closest('.count').dataset.j][t.dataset.c] = cap; toast(`Gedeckelt auf ${/he/.test(t.dataset.k || t.dataset.c) ? MAX_HE + ' HE' : fmt(MAX_GELD) + ' $'}`); }
  }
  urSum(d, el); urChanged();
}
function urSum(d, el) {
  const r = calcDef(d), box = el.querySelector('[data-sum]');
  box.innerHTML = `<span>Strafe: <b>${r.he} HE</b> · <b>${money(r.geld)}</b>${d.bew && r.he ? ` · Bewährung ${Math.min(14, +d.bewTage || 14)} Tage` : ''}</span>${r.calc && d.he === '' ? `<span class="calc">StPO §19: ${r.calc}</span>` : ''}${r.warn.map(w => `<span class="warn">${esc(w)}</span>`).join('')}`;
  el.querySelector('[data-k="he"]').placeholder = 'automatisch: ' + capHE(r.auto.he);
  el.querySelector('[data-k="geld"]').placeholder = 'automatisch: ' + fmt(capGeld(r.auto.geld));
}

/* ---------- Dokument ---------- */
function vorwurfText(c) {
  const v = c.v.trim(), p = c.p.trim().replace(/^(\d)/, '§ $1');
  if (!p) return v;
  return /\)$/.test(v) ? v.replace(/\)$/, `, ${p})`) : `${v} (${p})`;
}
function tenorFor(d, n) {
  const r = calcDef(d), der = d.g === 'w' ? 'Die Angeklagte' : 'Der Angeklagte', name = d.name.trim() || '[Name]';
  const out = [], counts = d.counts.filter(c => c.v.trim());
  if (r.guilty.length) {
    const strafe = [r.geld ? `einer Geldstrafe in Höhe von ${money(r.geld)}` : '', r.he ? `${r.he} Hafteinheiten` : ''].filter(Boolean).join(' sowie ');
    out.push(`${der} ${name} wird wegen ${listJoin(r.guilty.map(vorwurfText))} schuldig gesprochen${strafe ? ` und zu ${strafe} verurteilt` : ''}.`);
    if (d.bew && r.he) out.push(`Die Vollstreckung der Hafteinheiten wird für die Dauer von ${Math.min(14, +d.bewTage || 14)} Tagen zur Bewährung ausgesetzt.${r.geld ? ' Die Geldstrafe bleibt davon unberührt.' : ''}`);
  } else if (counts.length) out.push(`${der} ${name} wird freigesprochen.`);
  else out.push(`${der} ${name} wird [Tatvorwurf eintragen].`);
  const frei = counts.filter(c => c.erg === 'Freispruch'), nn = counts.filter(c => c.erg === 'Nicht nachgewiesen'), einst = counts.filter(c => c.erg === 'Eingestellt');
  if (r.guilty.length && frei.length) out.push(`Vom Vorwurf ${listJoin(frei.map(vorwurfText))} wird ${d.g === 'w' ? 'sie' : 'er'} freigesprochen.`);
  if (nn.length) out.push(`Hinsichtlich des Vorwurfs ${listJoin(nn.map(vorwurfText))} unterbleibt eine Verurteilung mangels hinreichend sicheren Tatnachweises.`);
  if (einst.length) out.push(`Das Verfahren wegen ${listJoin(einst.map(vorwurfText))} wird eingestellt.`);
  if (d.stvo) out.push(`Es werden ${d.stvo} StVO-Punkte eingetragen.`);
  if (d.fs) out.push('Der Führerschein wird entzogen; es gilt eine Führerscheinsperre von 3 Tagen.');
  if (d.ws) out.push('Der Waffenschein wird entzogen.');
  if (+d.susp) out.push(`${der} wird für ${+d.susp} Tag${+d.susp === 1 ? '' : 'e'} vom Dienst suspendiert.`);
  if (d.diszi) out.push('Gegen ' + (d.g === 'w' ? 'die Angeklagte' : 'den Angeklagten') + ' wird ein Disziplinarverfahren eingeleitet.');
  if (d.neben.trim()) out.push(d.neben.trim().replace(/([^.!?])$/, '$1.'));
  return out;
}
function urModel() {
  const s = SETTINGS, defs = U.defs.filter(d => d.name.trim() || d.counts.some(c => c.v.trim()));
  const anyMoney = defs.some(d => calcDef(d).geld > 0);
  return { s, defs, anyMoney };
}
function urHtml(forPdf, seal) {
  const { s, defs, anyMoney } = urModel(), dok = U.dok || 'Urteil';
  const P = t => t ? `<p>${esc(t).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>` : '';
  const ph = t => `<p class="ph">${t}</p>`;
  const verf = U.art === 'Zivilverfahren' ? 'Zivilverfahren' : 'Strafverfahren';
  let h = `<div class="uhead">${U.siegel && seal ? `<img src="${seal}" alt="">` : ''}<div><b>DEPARTMENT OF JUSTICE</b><span>Corleone City · State of San Andreas · Richterschaft</span></div></div>
  <div class="umeta"><span>Aktenzeichen: ${esc(U.az || '–')}</span><span>${esc(U.ort || 'Los Santos')}, ${esc(deDate(U.datum))}</span></div>
  <h1>${esc(dok.toUpperCase())}</h1><p class="volk">Im Namen des Volkes</p>
  <p>In dem ${verf} ${U.az ? 'mit dem Aktenzeichen ' + esc(U.az) + ' ' : ''}gegen ${defs.length ? esc(listJoin(defs.map(d => d.name.trim() || '[Name]'))) : '[Angeklagte]'} ergeht nach durchgeführter ${esc(U.art === 'SG-Urteil' ? 'Verhandlung im Staatsgefängnis' : U.art || 'Hauptverhandlung')} und Würdigung sämtlicher Beweismittel folgendes ${esc(dok)}:</p>`;
  const beteiligte = [s.richterName && `Vorsitz: ${s.richterName}, ${s.rang} (${s.dienstnummer})`, U.sta && `Staatsanwaltschaft: ${U.sta}`, U.vert && `Verteidigung: ${U.vert}`].filter(Boolean);
  if (beteiligte.length) h += `<p style="font-size:13.5px;color:#555">${beteiligte.map(esc).join('<br>')}</p>`;
  h += `<h2>Tenor</h2><ol class="tenor">${defs.map((d, i) => `<li>${tenorFor(d, i).map(esc).join(' ')}</li>`).join('')}${U.mass.trim() ? `<li>${esc(U.mass.trim())}</li>` : ''}${U.zahl && anyMoney ? '<li>Die Geldstrafe ist innerhalb von 3 Tagen nach Zustellung zu begleichen.</li>' : ''}</ol>`;
  h += `<h2>Beweiswürdigung</h2>${U.beweise.trim() ? `<p><i>Beweismittel:</i> ${esc(U.beweise.trim())}</p>` : ''}${U.bw.trim() ? P(U.bw.trim()) : forPdf ? '' : ph('Noch leer – selbst schreiben, „Gerüst einfügen“ oder mit KI schreiben lassen.')}`;
  h += `<h2>Rechtliche Würdigung</h2>${U.rw.trim() ? P(U.rw.trim()) : forPdf ? '' : ph('Noch leer.')}`;
  h += `<div class="endblock"><h2>Rechtsmittelbelehrung</h2>${P((U.rmb || RMB_DEFAULT(dok)).trim())}`;
  h += `<div class="sig"><p>${esc(U.ort || 'Los Santos')}, den ${esc(deDate(U.datum))}</p><p style="margin-top:22px">gez. ${esc(s.richterName || '[Name]')}<br>${esc(s.rang || 'Richter')} · Dienstnummer ${esc(s.dienstnummer || '')}<br>Department of Justice</p></div></div>`;
  return h;
}
function urPlain() {
  const { s, defs, anyMoney } = urModel(), dok = U.dok || 'Urteil';
  const lines = [`DEPARTMENT OF JUSTICE · ${dok.toUpperCase()}`, `Aktenzeichen ${U.az || '–'} · ${U.ort}, ${deDate(U.datum)}`, '', 'Im Namen des Volkes ergeht folgendes ' + dok + ':', ''];
  defs.forEach((d, i) => lines.push(`${i + 1}. ${tenorFor(d, i).join(' ')}`));
  let n = defs.length;
  if (U.mass.trim()) lines.push(`${++n}. ${U.mass.trim()}`);
  if (U.zahl && anyMoney) lines.push(`${++n}. Die Geldstrafe ist innerhalb von 3 Tagen nach Zustellung zu begleichen.`);
  lines.push('', (U.rmb || RMB_DEFAULT(dok)).trim(), '', `gez. ${s.richterName || ''}, ${s.rang} (${s.dienstnummer})`);
  return lines.join('\n');
}
function urPreview() { $('urPreview').innerHTML = urHtml(false, U.siegel ? 'seal.png' : null); }

/* ---------- Speichern ---------- */
function urCollectHead() {
  U.az = $('urAz').value.trim(); U.art = $('urArt').value; U.dok = $('urDok').value; U.ort = $('urOrt').value.trim(); U.datum = $('urDatum').value;
  U.sta = $('urSta').value.trim(); U.vert = $('urVert').value.trim(); U.beweise = $('urBeweise').value; U.bw = $('urBw').value; U.rw = $('urRw').value; U.mass = $('urMass').value;
  U.rmb = $('urRmb').value; U.zahl = $('urZahl').checked; U.siegel = $('urSiegel').checked;
}
function urChanged() {
  urPreview(); clearTimeout(urSaveT);
  urSaveT = setTimeout(async () => {
    if (!UCASE) return;
    UCASE.urteil = U;
    // Strafe des ersten Angeklagten in die Akte übernehmen (für Urteilsformel/Liste)
    const r = U.defs[0] && calcDef(U.defs[0]);
    if (r) UCASE.strafe = Object.assign(UCASE.strafe || {}, { he: r.he, geld: r.geld, bew: !!U.defs[0].bew, fs: !!U.defs[0].fs, ws: !!U.defs[0].ws, stvo: U.defs[0].stvo || '' });
    if (U.az && UCASE.aktenzeichen !== U.az) UCASE.aktenzeichen = U.az;
    await api.saveCase(UCASE); $('urMsg').textContent = 'Automatisch gespeichert';
  }, 600);
}
['urAz', 'urArt', 'urDok', 'urOrt', 'urDatum', 'urSta', 'urVert', 'urBeweise', 'urBw', 'urRw', 'urMass', 'urRmb', 'urZahl', 'urSiegel'].forEach(id => {
  $(id).addEventListener('input', () => { urCollectHead(); urChanged(); });
  $(id).addEventListener('change', () => { urCollectHead(); urChanged(); });
});
$('urDok').addEventListener('change', () => {
  const other = U.dok === 'Urteil' ? 'Beschluss' : 'Urteil';
  if ($('urRmb').value.trim() === RMB_DEFAULT(other)) { $('urRmb').value = RMB_DEFAULT(U.dok); U.rmb = $('urRmb').value; urChanged(); }
});
$('urAddDef').onclick = () => { U.defs.push(newDef()); urRenderDefs(); urChanged(); };

async function urFillCases(selectId) {
  const list = await api.listCases();
  $('urCase').innerHTML = '<option value="__new">+ Neue Akte für dieses Urteil</option>' + list.map(c => `<option value="${esc(c.id)}">${esc(c.aktenzeichen)}${c.titel ? ' · ' + esc(c.titel) : ''}</option>`).join('');
  if (selectId) $('urCase').value = selectId;
  else if (UCASE) $('urCase').value = UCASE.id;
  else if (list[0]) $('urCase').value = list[0].id;
}
async function urLoad(id) {
  if (id === '__new' || !id) {
    const nid = newId();
    UCASE = { id: nid, ts: Date.now(), aktenzeichen: nid, titel: 'Urteil', art: 'Hauptverhandlung', datum: new Date().toLocaleString('de-DE'), status: 'Urteil gesprochen', richter: SETTINGS.richterName, dienstnummer: SETTINGS.dienstnummer, beteiligte: [], notizen: '', marker: [], transcript: [], audio: {}, bericht: '', strafe: { he: 0, geld: 0 } };
    UCASE.urteil = newUrteil(null); UCASE.urteil.az = '';
    await api.saveCase(UCASE); await urFillCases(nid);
  } else {
    UCASE = await api.getCase(id); if (!UCASE) return;
    if (!UCASE.urteil) UCASE.urteil = newUrteil(UCASE);
  }
  U = UCASE.urteil;
  U.defs = (U.defs || []).map(d => Object.assign(newDef(), d));
  $('urAz').value = U.az || ''; $('urArt').value = U.art || 'Hauptverhandlung'; $('urDok').value = U.dok || 'Urteil'; $('urOrt').value = U.ort || 'Los Santos'; $('urDatum').value = U.datum || today();
  $('urSta').value = U.sta || ''; $('urVert').value = U.vert || ''; $('urBeweise').value = U.beweise || ''; $('urBw').value = U.bw || ''; $('urRw').value = U.rw || ''; $('urMass').value = U.mass || '';
  $('urRmb').value = U.rmb || RMB_DEFAULT(U.dok || 'Urteil'); $('urZahl').checked = U.zahl !== false; $('urSiegel').checked = U.siegel !== false;
  $('urAi').textContent = SETTINGS.hasClaudeKey ? 'Begründung mit KI schreiben' : 'Begründung mit KI schreiben (Schlüssel fehlt)';
  $('urMsg').textContent = ''; $('urAiMsg').textContent = '';
  urRenderDefs(); urPreview();
}
$('urCase').onchange = () => urLoad($('urCase').value);
let urOpening = false;
async function openUrteil(caseId) {
  urOpening = true; show('ur');
  try { await urFillCases(caseId); await urLoad(caseId || $('urCase').value); } finally { urOpening = false; }
}
function urEnsure() {
  if (urOpening) return;
  if (!UCASE) { urOpening = true; urFillCases().then(() => urLoad($('urCase').value)).finally(() => urOpening = false); }
  else urFillCases();
}

/* ---------- Gerüst & KI ---------- */
$('urTpl').onclick = () => {
  const { defs } = urModel();
  if (!$('urBw').value.trim()) $('urBw').value = (U.beweise.trim() ? `Das Gericht hat folgende Beweismittel gewürdigt: ${U.beweise.trim()}.\n\n` : '') + defs.map((d, i) => `${i + 1}. ${d.name || '[Name]'}\n` + d.counts.filter(c => c.v.trim()).map((c, j) => `${'abcdefgh'[j]}) ${c.v}: ${c.erg === 'Schuldig' ? 'Das Gericht ist davon überzeugt, dass … [Feststellung und Beweismittel].' : 'Ein hinreichend sicherer Tatnachweis konnte nicht geführt werden, weil … .'}`).join('\n')).join('\n\n');
  if (!$('urRw').value.trim()) $('urRw').value = defs.map((d, i) => { const r = calcDef(d); return `${i + 1}. ${d.name || '[Name]'}\n` + r.guilty.map((c, j) => `${'abcdefgh'[j]}) ${c.v}${c.p ? ' gemäss ' + c.p : ''}: Der Tatbestand ist erfüllt, da … .`).join('\n') + `\nStrafzumessung: Unter Berücksichtigung von … erachtet das Gericht ${r.he ? r.he + ' Hafteinheiten' : 'keine Haft'}${r.geld ? ' und eine Geldstrafe von ' + money(r.geld) : ''} als tat- und schuldangemessen.${d.bew ? ' Die Haft wird zur Bewährung ausgesetzt, weil … .' : ''}`; }).join('\n\n');
  urCollectHead(); urChanged();
};
$('urAi').onclick = async () => {
  if (!SETTINGS.hasClaudeKey) return toast('Bitte zuerst in den Einstellungen einen Claude-Schlüssel hinterlegen.');
  urCollectHead();
  const { defs } = urModel();
  const data = {
    dok: U.dok, art: U.art, az: U.az, beweise: U.beweise, notizen: [U.bw, U.rw].filter(Boolean).join('\n\n'),
    angeklagte: defs.map(d => { const r = calcDef(d); return { name: d.name, anrede: d.g === 'w' ? 'Die Angeklagte' : 'Der Angeklagte', vorwuerfe: d.counts.filter(c => c.v.trim()).map(c => ({ vorwurf: c.v, paragraph: c.p, ergebnis: c.erg })), hafteinheiten: r.he, geldstrafe: r.geld, bewaehrung: d.bew ? Math.min(14, +d.bewTage || 14) + ' Tage' : 'nein', tenor: tenorFor(d).join(' ') }; }),
    akte: UCASE ? { bericht: UCASE.bericht || '', transkript: (UCASE.transcript || []).slice(0, 400).map(t => `[${fmtT(t.start)}] ${t.who}: ${t.text}`).join('\n'), notizen: UCASE.notizen || '' } : null
  };
  $('urAi').disabled = true; $('urAiMsg').textContent = 'Begründung wird geschrieben …';
  try {
    const r = await api.urteilAi(data);
    if (r.bw) $('urBw').value = r.bw; if (r.rw) $('urRw').value = r.rw;
    urCollectHead(); urChanged(); $('urAiMsg').textContent = 'Fertig – bitte gegenlesen.';
  } catch (e) { $('urAiMsg').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  $('urAi').disabled = false;
};

/* ---------- Ausgabe ---------- */
const urFile = () => (U.dok || 'Urteil') + '-' + String(U.az || UCASE.id).replace(/[\\/:*?"<>|\s]+/g, '-');
$('urPdf').onclick = async () => {
  urCollectHead();
  const seal = await fetch('seal.png').then(r => r.blob()).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }));
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:18mm 18mm 20mm}*{box-sizing:border-box}body{margin:0}
    .urdoc{font:11pt/1.55 Georgia,"Times New Roman",serif;color:#1a1a1a}
    .uhead{display:flex;gap:14px;align-items:center;border-bottom:3px double #a8822b;padding-bottom:8px;margin-bottom:12px}
    .uhead img{width:62px;height:62px}.uhead b{display:block;font-size:15pt;letter-spacing:.08em;color:#1b2d57}.uhead span{font-size:9pt;color:#666}
    .umeta{display:flex;justify-content:space-between;font-size:9.5pt;color:#555;margin-bottom:14px}
    h1{font:700 18pt Georgia,serif;text-align:center;letter-spacing:.16em;margin:4px 0 0;color:#14203a}
    .volk{text-align:center;font-style:italic;margin:2px 0 14px;color:#444}
    h2{font:700 10.5pt Georgia,serif;letter-spacing:.12em;text-transform:uppercase;color:#1b2d57;border-bottom:1px solid #d5d9e4;padding-bottom:2px;margin:18px 0 6px;page-break-after:avoid}
    p{margin:0 0 7px;text-align:justify}ol{margin:0 0 7px;padding-left:20px}.tenor>li{margin-bottom:8px;text-align:justify}
    .sig{margin-top:26px}.endblock{page-break-inside:avoid;break-inside:avoid}
  </style></head><body><div class="urdoc">${urHtml(true, seal)}</div></body></html>`;
  const f = await api.exportPdf(html, urFile());
  if (f) { $('urMsg').textContent = 'PDF gespeichert: ' + f; toast('PDF gespeichert'); }
};
$('urCopy').onclick = () => copy(urPlain());
$('urSw').onclick = () => {
  urCollectHead();
  const tmp = document.createElement('div'); tmp.innerHTML = urHtml(true, null);
  tmp.querySelectorAll('h2').forEach(h => h.textContent = '\n## ' + h.textContent.charAt(0) + h.textContent.slice(1).toLowerCase() + '\n');
  tmp.querySelectorAll('li').forEach((li, i) => li.textContent = (i + 1) + '. ' + li.textContent + '\n');
  tmp.querySelectorAll('p,br').forEach(p => p.after('\n'));
  $('swTitel').value = U.dok || 'Urteil'; $('swAz').value = U.az || ''; $('swCase').value = '';
  $('swText').value = tmp.textContent.replace(/DEPARTMENT OF JUSTICE.*?Richterschaft/s, '').replace(/\n{3,}/g, '\n\n').trim();
  SW.caseNames = U.defs.map(d => d.name).filter(Boolean).concat([U.sta, U.vert].filter(Boolean));
  show('sw'); findNames(SW.caseNames);
};
$('toUrteil').onclick = () => { collect(); api.saveCase(CUR).then(() => openUrteil(CUR.id)); };
