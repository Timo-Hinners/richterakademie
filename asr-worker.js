// Läuft als eigener Prozess, damit die Oberfläche während der Erkennung flüssig bleibt
const asr = require('./asr');

process.parentPort.on('message', async e => {
  const m = e.data;
  const reply = d => process.parentPort.postMessage(Object.assign({ id: m.id }, d));
  try {
    if (m.cmd === 'status') {
      reply({ ok: true, result: { small: asr.isInstalled(m.modelDir, 'small'), base: asr.isInstalled(m.modelDir, 'base') } });
    } else if (m.cmd === 'download') {
      await asr.download(m.modelDir, m.model, p => reply({ progress: p }));
      reply({ ok: true, result: true });
    } else if (m.cmd === 'transcribe') {
      const samples = new Float32Array(m.pcm);
      const out = await asr.transcribe(samples, { modelDir: m.modelDir, model: m.model, vadModel: m.vadModel, onProgress: p => reply({ progress: p }) });
      reply({ ok: true, result: out });
    }
  } catch (err) {
    reply({ ok: false, error: String(err && err.message || err) });
  }
});
