'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SessionStore {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'sessions');
    fs.mkdirSync(this.dir, { recursive: true });
    this.cache = new Map();
  }

  filePath(id) {
    if (!/^[a-zA-Z0-9-]{6,80}$/.test(String(id || ''))) {
      throw new Error('معرّف جلسة غير صالح.');
    }
    return path.join(this.dir, `${id}.json`);
  }

  list() {
    const out = [];
    let files = [];
    try {
      files = fs.readdirSync(this.dir);
    } catch {
      return out;
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(this.dir, file), 'utf8');
        const s = JSON.parse(raw);
        out.push(summary(s));
      } catch {
        // ignore broken session files
      }
    }

    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return out;
  }

  get(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    try {
      const raw = fs.readFileSync(this.filePath(id), 'utf8');
      const session = JSON.parse(raw);
      session.messages = Array.isArray(session.messages) ? session.messages : [];
      session.transcript = Array.isArray(session.transcript) ? session.transcript : [];
      this.cache.set(id, session);
      return session;
    } catch {
      return null;
    }
  }

  create({ model = null, mode = 'ask' } = {}) {
    const now = new Date().toISOString();
    const session = {
      id: crypto.randomUUID(),
      title: 'جلسة جديدة',
      model,
      mode: ['ask', 'auto', 'plan'].includes(mode) ? mode : 'ask',
      createdAt: now,
      updatedAt: now,
      allowShell: false,
      allowWrites: false,
      messages: [],
      transcript: [],
      usage: { prompt_tokens: 0, completion_tokens: 0 }
    };
    this.save(session);
    return session;
  }

  save(session) {
    session.updatedAt = new Date().toISOString();
    const target = this.filePath(session.id);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(session), 'utf8');
    fs.renameSync(tmp, target);
    this.cache.set(session.id, session);
    return session;
  }

  delete(id) {
    this.cache.delete(id);
    try {
      fs.unlinkSync(this.filePath(id));
    } catch {
      // already gone
    }
  }
}

function summary(session) {
  let preview = '';
  for (let i = session.transcript.length - 1; i >= 0; i--) {
    const ev = session.transcript[i];
    if (ev.type === 'assistant' && ev.text) {
      preview = String(ev.text).replace(/\s+/g, ' ').slice(0, 110);
      break;
    }
    if (ev.type === 'user' && !preview) {
      preview = String(ev.text).replace(/\s+/g, ' ').slice(0, 110);
    }
  }

  return {
    id: session.id,
    title: session.title,
    model: session.model,
    mode: session.mode,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    preview
  };
}

function deriveTitle(text) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return 'جلسة جديدة';
  return clean.length > 46 ? clean.slice(0, 46) + '…' : clean;
}

function publicSession(session) {
  return {
    id: session.id,
    title: session.title,
    model: session.model,
    mode: session.mode,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    allowShell: !!session.allowShell,
    allowWrites: !!session.allowWrites,
    usage: session.usage || { prompt_tokens: 0, completion_tokens: 0 },
    transcript: session.transcript
  };
}

module.exports = { SessionStore, summary, deriveTitle, publicSession };
