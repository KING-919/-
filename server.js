'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const configStore = require('./lib/config');
const { listModels } = require('./lib/lmstudio');
const { SessionStore, summary, publicSession, deriveTitle } = require('./lib/sessions');
const agent = require('./lib/agent');
const { getMobileStatus } = require('./lib/mobile-tools');

const app = express();
const store = new SessionStore(configStore.DATA_DIR);
const active = new Map(); // sessionId -> { controller }

app.disable('x-powered-by');
app.use(express.json({ limit: '16mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function publicConfig() {
  const c = configStore.get();
  return {
    provider: c.provider,
    baseUrl: c.baseUrl,
    workspace: c.workspace,
    mode: c.mode,
    temperature: c.temperature,
    maxSteps: c.maxSteps,
    shellTimeoutMs: c.shellTimeoutMs,
    allowOutsideWorkspace: c.allowOutsideWorkspace,
    autoShell: c.autoShell,
    hasKey: !!c.apiKey,
    mobileMode: c.mobileMode,
    mobileBridgeUrl: c.mobileBridgeUrl,
    hasMobileToken: !!c.mobileToken,
    adbSerial: c.adbSerial,
    autoPhone: !!c.autoPhone
  };
}

function openSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed) {
      try {
        res.write(': ping\n\n');
      } catch {
        // ignore
      }
    }
  }, 15000);

  res.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
  });

  return {
    send(event, data) {
      if (closed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
      }
    },
    end() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  };
}

// ------------------------------------------------------------------
// Config & models
// ------------------------------------------------------------------
app.get('/api/config', (req, res) => {
  res.json(publicConfig());
});

app.post('/api/config', (req, res) => {
  const allowed = [
    'provider', 'baseUrl', 'apiKey', 'workspace', 'mode', 'temperature',
    'maxSteps', 'shellTimeoutMs', 'allowOutsideWorkspace', 'autoShell',
    'mobileMode', 'mobileBridgeUrl', 'mobileToken', 'adbSerial', 'autoPhone'
  ];
  const patch = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      patch[key] = req.body[key];
    }
  }
  try {
    configStore.save(patch);
    res.json(publicConfig());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/models', async (req, res) => {
  const config = configStore.get();
  try {
    const models = await listModels(config.baseUrl, config.apiKey, config.provider);
    res.json({ connected: true, baseUrl: config.baseUrl, models });
  } catch (err) {
    res.json({
      connected: false,
      baseUrl: config.baseUrl,
      models: [],
      error: err.message
    });
  }
});

app.post('/api/test-connection', async (req, res) => {
  const body = req.body || {};
  const current = configStore.get();
  const provider = String(body.provider || current.provider || 'lmstudio');
  const baseUrl = String(body.baseUrl || current.baseUrl || '').trim().replace(/\/+$/, '');
  const normalizedBase = provider === 'gemini' ? baseUrl : baseUrl.replace(/\/v1$/i, '').replace(/\/api\/v0$/i, '');
  const hasKey = Object.prototype.hasOwnProperty.call(body, 'apiKey') && body.apiKey !== null;
  const apiKey = hasKey ? String(body.apiKey) : current.apiKey;

  if (!/^https?:\/\//i.test(normalizedBase)) {
    return res.json({ ok: false, error: 'عنوان الخادم غير صالح. يجب أن يبدأ بـ http:// أو https://' });
  }

  try {
    const models = await listModels(normalizedBase, apiKey, provider);
    res.json({
      ok: true,
      baseUrl: normalizedBase,
      count: models.length,
      models: models.slice(0, 8).map((model) => model.id)
    });
  } catch (err) {
    res.json({ ok: false, baseUrl: normalizedBase, error: err.message });
  }
});

app.get('/api/mobile/status', async (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : 'ar';
  const status = await getMobileStatus(configStore.get(), lang);
  res.json(status);
});

app.post('/api/mobile/test', async (req, res) => {
  const body = req.body || {};
  const current = configStore.get();
  const lang = body.lang === 'en' ? 'en' : 'ar';
  const hasToken = Object.prototype.hasOwnProperty.call(body, 'mobileToken') && body.mobileToken !== null;
  const status = await getMobileStatus({
    mobileMode: body.mobileMode || current.mobileMode,
    mobileBridgeUrl: body.mobileBridgeUrl || current.mobileBridgeUrl,
    mobileToken: hasToken ? body.mobileToken : current.mobileToken,
    adbSerial: body.adbSerial != null ? body.adbSerial : current.adbSerial
  }, lang);
  res.json(status);
});

// Read-only workspace browser used by the companion file panel.
function workspaceTarget(relativePath = '') {
  const root = path.resolve(configStore.get().workspace || process.cwd());
  const target = path.resolve(root, String(relativePath || '.'));
  if (target !== root && !target.startsWith(root + path.sep)) {
    const error = new Error('المسار خارج مساحة العمل.');
    error.status = 403;
    throw error;
  }
  return { root, target };
}

app.get('/api/workspace/files', async (req, res) => {
  try {
    const { root, target } = workspaceTarget(req.query.path);
    const realRoot = await fs.promises.realpath(root);
    const realTarget = await fs.promises.realpath(target);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
      return res.status(403).json({ error: 'المسار خارج مساحة العمل.' });
    }
    const entries = await fs.promises.readdir(realTarget, { withFileTypes: true });
    const files = entries
      .filter((entry) => !entry.name.startsWith('.') && !['node_modules', 'vendor', 'dist', 'build'].includes(entry.name))
      .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
    res.json({ path: path.relative(realRoot, realTarget).split(path.sep).join('/'), files });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.code === 'ENOENT' ? 'المجلد غير موجود.' : err.message });
  }
});

app.get('/api/workspace/file', async (req, res) => {
  try {
    const { root, target } = workspaceTarget(req.query.path);
    const realRoot = await fs.promises.realpath(root);
    const realTarget = await fs.promises.realpath(target);
    if (realTarget === realRoot || !realTarget.startsWith(realRoot + path.sep)) {
      return res.status(403).json({ error: 'المسار خارج مساحة العمل.' });
    }
    const stat = await fs.promises.stat(realTarget);
    if (!stat.isFile()) return res.status(400).json({ error: 'المسار ليس ملفًا.' });
    if (stat.size > 256 * 1024) return res.status(413).json({ error: 'الملف أكبر من الحد المسموح للمعاينة (256 كيلوبايت).' });
    const content = await fs.promises.readFile(realTarget, 'utf8');
    if (content.includes('\u0000')) return res.status(415).json({ error: 'لا يمكن معاينة الملفات الثنائية.' });
    res.json({ path: path.relative(realRoot, realTarget).split(path.sep).join('/'), content });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.code === 'ENOENT' ? 'الملف غير موجود.' : err.message });
  }
});

// ------------------------------------------------------------------
// Sessions
// ------------------------------------------------------------------
app.get('/api/sessions', (req, res) => {
  res.json({ sessions: store.list() });
});

app.post('/api/sessions', (req, res) => {
  const model = req.body && req.body.model ? String(req.body.model) : null;
  const mode = req.body && req.body.mode ? String(req.body.mode) : 'ask';
  const session = store.create({ model, mode });
  res.json({ session: publicSession(session) });
});

app.get('/api/sessions/:id', (req, res) => {
  const session = store.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة.' });

  const pending = agent.getPending(session.id);
  if (!pending) {
    if (agent.repairSession(session)) store.save(session);
  }

  res.json({
    session: publicSession(session),
    pending: pending || null
  });
});

app.patch('/api/sessions/:id', (req, res) => {
  const session = store.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة.' });

  const body = req.body || {};
  if (typeof body.title === 'string' && body.title.trim()) {
    session.title = body.title.trim().slice(0, 120);
  }
  if (typeof body.model === 'string' && body.model.trim()) {
    session.model = body.model.trim();
  }
  if (['ask', 'auto', 'plan'].includes(body.mode)) {
    session.mode = body.mode;
  }
  store.save(session);
  res.json({ session: publicSession(session) });
});

app.delete('/api/sessions/:id', (req, res) => {
  if (active.has(req.params.id)) {
    return res.status(409).json({ error: 'لا يمكن حذف جلسة يجري تنفيذها الآن.' });
  }
  agent.clearPending(req.params.id);
  store.delete(req.params.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------
// Agent turn (SSE)
// ------------------------------------------------------------------
app.post('/api/sessions/:id/chat', async (req, res) => {
  const session = store.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة.' });

  if (agent.getPending(session.id)) {
    return res.status(409).json({ error: 'هناك خطوة معلّقة تنتظر ردك أولًا.' });
  }
  if (active.has(session.id)) {
    return res.status(409).json({ error: 'يوجد تنفيذ جارٍ لهذه الجلسة.' });
  }

  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ error: 'الرسالة فارغة.' });
  if (!session.model) return res.status(400).json({ error: 'لم يتم اختيار نموذج لهذه الجلسة.' });

  if (agent.repairSession(session)) store.save(session);

  const controller = new AbortController();
  active.set(session.id, { controller });

  const stream = openSSE(res);
  res.on('close', () => {
    const current = active.get(session.id);
    if (current && current.controller === controller && !res.writableEnded) {
      controller.abort();
    }
  });

  const lang = req.body && req.body.lang === 'en' ? 'en' : 'ar';

  try {
    await agent.runTurn({
      session,
      store,
      config: configStore.get(),
      emit: stream.send,
      signal: controller.signal,
      userText: message,
      lang
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      stream.send('notice', { level: 'info', text: lang === 'en' ? 'Execution stopped.' : 'تم إيقاف التنفيذ.' });
      stream.send('done', {
        id: session.id,
        title: session.title,
        model: session.model,
        mode: session.mode,
        usage: session.usage
      });
    } else {
      const text = (err && err.message) || (lang === 'en' ? 'An unexpected error occurred.' : 'حدث خطأ غير متوقع.');
      session.transcript.push({ type: 'notice', level: 'error', text, ts: Date.now() });
      try {
        store.save(session);
      } catch {
        // ignore
      }
      stream.send('error', { message: text });
      stream.send('done', {
        id: session.id,
        title: session.title,
        model: session.model,
        mode: session.mode,
        usage: session.usage
      });
    }
  } finally {
    const current = active.get(session.id);
    if (current && current.controller === controller) active.delete(session.id);
    stream.end();
  }
});

app.post('/api/sessions/:id/resume', async (req, res) => {
  const session = store.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'الجلسة غير موجودة.' });

  const pending = agent.getPending(session.id);
  if (!pending) {
    return res.status(409).json({ error: 'لا توجد خطوة معلّقة لهذه الجلسة.' });
  }
  if (active.has(session.id)) {
    return res.status(409).json({ error: 'يوجد تنفيذ جارٍ لهذه الجلسة.' });
  }

  const body = req.body || {};
  if (body.toolCallId && String(body.toolCallId) !== pending.toolCallId) {
    return res.status(409).json({ error: 'معرّف الأداة المعلّقة غير مطابق.' });
  }

  const controller = new AbortController();
  active.set(session.id, { controller });

  const stream = openSSE(res);
  res.on('close', () => {
    const current = active.get(session.id);
    if (current && current.controller === controller && !res.writableEnded) {
      controller.abort();
    }
  });

  const lang = body.lang === 'en' ? 'en' : 'ar';

  try {
    await agent.runTurn({
      session,
      store,
      config: configStore.get(),
      emit: stream.send,
      signal: controller.signal,
      lang,
      resume: {
        toolCallId: pending.toolCallId,
        approve: !!body.approve,
        selected: Array.isArray(body.selected) ? body.selected : [],
        answer: body.answer ? String(body.answer) : '',
        dontAskAgain: !!body.dontAskAgain
      }
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      stream.send('notice', { level: 'info', text: lang === 'en' ? 'Execution stopped.' : 'تم إيقاف التنفيذ.' });
      stream.send('done', {
        id: session.id,
        title: session.title,
        model: session.model,
        mode: session.mode,
        usage: session.usage
      });
    } else {
      const text = (err && err.message) || (lang === 'en' ? 'An unexpected error occurred.' : 'حدث خطأ غير متوقع.');
      session.transcript.push({ type: 'notice', level: 'error', text, ts: Date.now() });
      try {
        store.save(session);
      } catch {
        // ignore
      }
      stream.send('error', { message: text });
      stream.send('done', {
        id: session.id,
        title: session.title,
        model: session.model,
        mode: session.mode,
        usage: session.usage
      });
    }
  } finally {
    const current = active.get(session.id);
    if (current && current.controller === controller) active.delete(session.id);
    stream.end();
  }
});

app.post('/api/sessions/:id/abort', (req, res) => {
  const current = active.get(req.params.id);
  if (current) current.controller.abort();
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
function start(port, attempt = 0) {
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(port, host);

  server.on('listening', () => {
    const activePort = server.address().port;
    console.log('');
    console.log('  ╭──────────────────────────────────────────────╮');
    console.log('  │              N O V A   A G E N T             │');
    console.log('  ╰──────────────────────────────────────────────╯');
    console.log(`  الواجهة:            http://localhost:${activePort}`);
    console.log(`  مزوّد API:          ${configStore.get().baseUrl}`);
    console.log(`  مساحة العمل:       ${configStore.get().workspace}`);
    console.log('');
    console.log('  افتح الإعدادات لاختيار LM Studio أو FreeLLMAPI أو API متوافق مخصص.');
    console.log('');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      console.log(`المنفذ ${port} مشغول، سأجرّب ${port + 1}…`);
      start(port + 1, attempt + 1);
    } else {
      console.error('تعذّر تشغيل الخادم:', err.message);
      process.exit(1);
    }
  });

  return server;
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
if (require.main === module) start(PORT);

module.exports = { app, start };
