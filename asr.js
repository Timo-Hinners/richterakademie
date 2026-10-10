// Spracherkennung offline: Whisper (sherpa-onnx) + Silero-VAD für Zeitstempel
const fs = require('fs');
const path = require('path');
const https = require('https');

const MODELS = {
  small: { label: 'Whisper Small', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2', prefix: 'small', sizeMB: 640 },
  base: { label: 'Whisper Base', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2', prefix: 'base', sizeMB: 210 }
};
const HALLU = /(untertitel|im auftrag des|vielen dank f(ü|u)r(s)? zus(c)?hauen|amara\.org|copyright|bis zum n(ä|a)chsten mal|abonnier|\[musik\]|\*musik\*)/i;

let sherpa = null;
function lib() { if (!sherpa) sherpa = require('sherpa-onnx-node'); return sherpa; }

function modelFiles(dir, key) {
  const p = MODELS[key].prefix;
  return { encoder: path.join(dir, key, `${p}-encoder.int8.onnx`), decoder: path.join(dir, key, `${p}-decoder.int8.onnx`), tokens: path.join(dir, key, `${p}-tokens.txt`) };
}
function isInstalled(dir, key) {
  const f = modelFiles(dir, key);
  return Object.values(f).every(x => fs.existsSync(x) && fs.statSync(x).size > 1000);
}

/* ---------- Download (GitHub-Release, folgt Weiterleitungen) ---------- */
function get(url, redirects = 0) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Richterakademie' } }, r => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && redirects < 8) { r.resume(); return res(get(new URL(r.headers.location, url).toString(), redirects + 1)); }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('Download fehlgeschlagen: HTTP ' + r.statusCode)); }
      res(r);
    }).on('error', rej);
  });
}

async function download(dir, key, onProgress) {
  const m = MODELS[key];
  const target = path.join(dir, key), tmp = target + '.part';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const bz2 = require('unbzip2-stream');
  const tar = require('tar-stream');
  const res = await get(m.url);
  const total = +res.headers['content-length'] || m.sizeMB * 1024 * 1024;
  let got = 0, last = 0;
  res.on('data', c => { got += c.length; const p = Math.floor(got / total * 100); if (p !== last) { last = p; onProgress && onProgress(p); } });
  const wanted = new Set([`${m.prefix}-encoder.int8.onnx`, `${m.prefix}-decoder.int8.onnx`, `${m.prefix}-tokens.txt`]);
  const ex = tar.extract();
  await new Promise((resolve, reject) => {
    ex.on('entry', (h, stream, next) => {
      const name = path.basename(h.name);
      if (h.type === 'file' && wanted.has(name)) {
        const ws = fs.createWriteStream(path.join(tmp, name));
        stream.pipe(ws); ws.on('finish', next); ws.on('error', reject);
      } else { stream.on('end', next); stream.resume(); }
    });
    ex.on('finish', resolve); ex.on('error', reject);
    const unz = bz2(); unz.on('error', reject); res.on('error', reject);
    res.pipe(unz).pipe(ex);
  });
  for (const w of wanted) if (!fs.existsSync(path.join(tmp, w))) throw new Error('Modell unvollständig: ' + w);
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmp, target);
}

/* ---------- Erkennung ---------- */
let rec = null, recKey = '';
async function recognizer(dir, key) {
  if (rec && recKey === key) return rec;
  const f = modelFiles(dir, key);
  const cfg = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { whisper: { encoder: f.encoder, decoder: f.decoder, language: 'de', task: 'transcribe', tailPaddings: -1 }, tokens: f.tokens, numThreads: Math.max(1, Math.min(4, require('os').cpus().length - 1)), provider: 'cpu', debug: 0 }
  };
  const L = lib();
  rec = L.OfflineRecognizer.createAsync ? await L.OfflineRecognizer.createAsync(cfg) : new L.OfflineRecognizer(cfg);
  recKey = key;
  return rec;
}

function segments(samples, vadModel) {
  const L = lib();
  const win = 512;
  const vad = new L.Vad({ sileroVad: { model: vadModel, threshold: 0.45, minSilenceDuration: 0.6, minSpeechDuration: 0.25, maxSpeechDuration: 25, windowSize: win }, sampleRate: 16000, debug: false, numThreads: 1 }, 120);
  const out = [];
  const drain = () => { while (!vad.isEmpty()) { const s = vad.front(false); out.push({ start: s.start / 16000, samples: Float32Array.from(s.samples) }); vad.pop(); } };
  for (let i = 0; i + win <= samples.length; i += win) { vad.acceptWaveform(samples.subarray(i, i + win)); drain(); }
  vad.flush(); drain();
  return out;
}

async function transcribe(samples, { modelDir, model, vadModel, onProgress }) {
  const r = await recognizer(modelDir, model);
  const segs = segments(samples, vadModel);
  const res = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const st = r.createStream();
    st.acceptWaveform({ sampleRate: 16000, samples: s.samples });
    if (r.decodeAsync) await r.decodeAsync(st); else r.decode(st);
    const text = (r.getResult(st).text || '').trim();
    if (text.length > 1 && !HALLU.test(text) && (!res.length || res[res.length - 1].text !== text)) res.push({ start: s.start, end: s.start + s.samples.length / 16000, text });
    onProgress && onProgress(Math.round((i + 1) / segs.length * 100));
  }
  return res;
}

module.exports = { MODELS, isInstalled, download, transcribe, modelFiles };
