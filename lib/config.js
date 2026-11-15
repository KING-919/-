'use strict';

const fs = require('fs');
const path = require('path');

const { normalizeMobileConfig } = require('./mobile-tools');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.NOVA_DATA_DIR
  ? path.resolve(process.env.NOVA_DATA_DIR)
  : path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  provider: process.env.NOVA_PROVIDER || 'lmstudio',
  baseUrl: process.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234',
  apiKey: process.env.LMSTUDIO_API_KEY || '',
  workspace: process.env.AGENT_WORKSPACE || path.join(ROOT, 'workspace'),
  mode: 'ask',
  temperature: 0.7,
  maxSteps: 30,
  shellTimeoutMs: 90000,
  allowOutsideWorkspace: false,
  autoShell: false,
  mobileMode: process.env.NOVA_MOBILE_MODE || 'auto',
  mobileBridgeUrl: process.env.NOVA_MOBILE_BRIDGE || 'http://127.0.0.1:8765',
  mobileToken: process.env.NOVA_MOBILE_TOKEN || '',
  adbSerial: process.env.NOVA_ADB_SERIAL || '',
  autoPhone: false
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function normalize(input) {
  const c = { ...DEFAULTS, ...(input || {}) };

  c.baseUrl = String(c.baseUrl || DEFAULTS.baseUrl).trim().replace(/\/+$/, '');
  // Accept an OpenAI-style base URL that already ends in /v1 (or /api/v0).
  c.baseUrl = c.baseUrl.replace(/\/v1$/i, '').replace(/\/api\/v0$/i, '');
  if (!/^https?:\/\//i.test(c.baseUrl)) c.baseUrl = 'http://' + c.baseUrl;

  c.apiKey = String(c.apiKey || '');
  c.provider = ['lmstudio', 'freellmapi', 'openai', 'openrouter', 'groq', 'gemini', 'ollama', 'openai-compatible'].includes(c.provider) ? c.provider : 'lmstudio';
  c.workspace = path.resolve(String(c.workspace || DEFAULTS.workspace));
  c.mode = ['ask', 'auto', 'plan'].includes(c.mode) ? c.mode : 'ask';
  c.temperature = clamp(Number(c.temperature) || 0.7, 0, 2);
  c.maxSteps = clamp(parseInt(c.maxSteps, 10) || 30, 1, 60);
  c.shellTimeoutMs = clamp(parseInt(c.shellTimeoutMs, 10) || 90000, 5000, 600000);
  c.allowOutsideWorkspace = !!c.allowOutsideWorkspace;
  c.autoShell = !!c.autoShell;

  Object.assign(c, normalizeMobileConfig(c));

  return c;
}

let config = loadConfig();

function loadConfig() {
  ensureDir(DATA_DIR);
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return normalize(raw);
  } catch {
    return normalize(DEFAULTS);
  }
}

function get() {
  return config;
}

function save(patch) {
  config = normalize({ ...config, ...(patch || {}) });
  ensureDir(DATA_DIR);
  ensureDir(config.workspace);

  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);

  return config;
}

// Make sure the workspace folder exists on boot.
ensureDir(config.workspace);

module.exports = { get, save, normalize, DATA_DIR, ROOT, DEFAULTS };
