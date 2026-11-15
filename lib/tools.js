'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');

const { PHONE_TOOL_DEFS, PHONE_TOOL_NAMES, executePhoneTool } = require('./mobile-tools');

const MAX_READ_BYTES = 500 * 1024;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_MATCHES = 80;
const MAX_FILE_SCAN = 300 * 1024;
const MAX_OUTPUT = 16000;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  '.venv', 'venv', '__pycache__', '.cache', '.idea', '.vscode',
  '.agent-backups', 'coverage', '.turbo', 'target', 'vendor'
]);

const WORKSPACE_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        'Ask the user a clarification question with clickable options. Use this when the request is ambiguous, has multiple distinct directions, or you need a decision. Do NOT use it to ask permission for tools; approvals are shown automatically. Provide 2-4 short options with helpful descriptions. The user can always type a custom answer.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to ask, in the user language.' },
          header: { type: 'string', description: 'Very short label (max 30 chars), e.g. "نوع المشروع".' },
          options: {
            type: 'array',
            description: '2-4 options.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Short option label.' },
                description: { type: 'string', description: 'One sentence explaining the option.' }
              },
              required: ['label']
            }
          },
          multiple: { type: 'boolean', description: 'Allow selecting more than one option.' }
        },
        required: ['question', 'options']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_todos',
      description:
        'Create or update the task plan shown to the user. Call at the start of a multi-step task, then update statuses as you progress. Keep 2-8 concise steps.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Short task description.' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: 'Current status.'
                }
              },
              required: ['content', 'status']
            }
          }
        },
        required: ['todos']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories inside the workspace, recursively up to a given depth.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory relative to workspace (default ".").' },
          depth: { type: 'integer', description: 'Recursion depth, 1-3 (default 2).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from the workspace. Always read a file before editing it.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace.' },
          start_line: { type: 'integer', description: 'Optional 1-based first line.' },
          end_line: { type: 'integer', description: 'Optional 1-based last line.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create or overwrite a file with full content. Provide the complete final file content, not a patch. Creates parent folders automatically and keeps a backup of overwritten files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace.' },
          content: { type: 'string', description: 'Complete file content.' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_text',
      description: 'Search for a literal text string across text files in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for.' },
          path: { type: 'string', description: 'Directory to search in (default ".").' },
          include: { type: 'string', description: 'Optional filename glob, e.g. "*.js" or "*.tsx".' },
          ignore_case: { type: 'boolean', description: 'Case-insensitive search (default true).' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description:
        'Run a shell command in the workspace (cmd.exe on Windows). Commands are non-interactive and time out. The user must approve shell commands first.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run.' },
          cwd: { type: 'string', description: 'Working directory relative to workspace (optional).' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch a public web page and return its readable text content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute http(s) URL.' }
        },
      required: ['url']
      }
    }
  }
];

const TOOL_DEFS = [...WORKSPACE_TOOL_DEFS, ...PHONE_TOOL_DEFS];

function truncate(text, max = MAX_OUTPUT) {
  const s = String(text == null ? '' : text);
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… (تم اقتصاص ${s.length - max} حرفًا)`;
}

function resolveSafe(inputPath, ctx) {
  const workspace = path.resolve(ctx.workspace);
  const target = path.resolve(workspace, String(inputPath || '.'));

  if (!ctx.allowOutside) {
    const inside = target === workspace || target.startsWith(workspace + path.sep);
    if (!inside) {
      throw new Error('المسار خارج مساحة العمل المسموحة. غيّر مساحة العمل من الإعدادات إن كنت تحتاج ذلك.');
    }
  }
  return target;
}

function toRelative(target, ctx) {
  const rel = path.relative(path.resolve(ctx.workspace), target);
  return rel || '.';
}

function isProbablyBinary(buffer) {
  const len = Math.min(buffer.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function globToRegExp(glob) {
  const escaped = String(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

async function walk(dir, options, state) {
  if (state.count >= options.maxEntries) return;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (state.count >= options.maxEntries) {
      state.truncated = true;
      return;
    }
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    const depth = options.depth;
    const rel = path.relative(options.root, full).replace(/\\/g, '/');

    let stat;
    try {
      stat = await fsp.stat(full);
    } catch {
      continue;
    }

    if (entry.isDirectory()) {
      state.entries.push({ path: rel + '/', type: 'dir' });
      state.count++;
      if (depth > 1) {
        await walk(full, { ...options, depth: depth - 1 }, state);
      }
    } else if (entry.isFile()) {
      state.entries.push({ path: rel, type: 'file', size: stat.size });
      state.count++;
    }
  }
}

async function listFiles(args, ctx) {
  const target = resolveSafe(args.path || '.', ctx);
  const depth = Math.min(3, Math.max(1, parseInt(args.depth, 10) || 2));

  const stat = await fsp.stat(target).catch(() => null);
  if (!stat) throw new Error('المجلد غير موجود.');
  if (!stat.isDirectory()) throw new Error('المسار ليس مجلدًا.');

  const state = { count: 0, entries: [], truncated: false };
  await walk(target, { root: target, depth, maxEntries: MAX_LIST_ENTRIES }, state);

  return {
    ok: true,
    root: toRelative(target, ctx),
    entries: state.entries,
    truncated: state.truncated
  };
}

async function readFile(args, ctx) {
  const target = resolveSafe(args.path, ctx);
  const stat = await fsp.stat(target).catch(() => null);
  if (!stat) throw new Error('الملف غير موجود: ' + args.path);
  if (stat.isDirectory()) throw new Error('المسار مجلد وليس ملفًا.');
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`الملف كبير (${Math.round(stat.size / 1024)}KB). استخدم run_shell مثل "Get-Content ... -TotalCount 200" أو اقرأ جزئًا آخر.`);
  }

  const buffer = await fsp.readFile(target);
  if (isProbablyBinary(buffer)) throw new Error('الملف يبدو ثنائيًا (binary) ولا يمكن قراءته كنص.');

  let content = buffer.toString('utf8');
  let startLine = parseInt(args.start_line, 10);
  let endLine = parseInt(args.end_line, 10);
  const allLines = content.split(/\r?\n/);

  if (Number.isFinite(startLine) || Number.isFinite(endLine)) {
    if (!Number.isFinite(startLine) || startLine < 1) startLine = 1;
    if (!Number.isFinite(endLine) || endLine > allLines.length) endLine = allLines.length;
    content = allLines.slice(startLine - 1, endLine).join('\n');
  }

  return {
    ok: true,
    path: toRelative(target, ctx),
    bytes: stat.size,
    lines: allLines.length,
    content: truncate(content, MAX_OUTPUT)
  };
}

function lineDiff(oldText, newText) {
  const a = String(oldText || '').split(/\r?\n/);
  const b = String(newText || '').split(/\r?\n/);

  if (a.length * b.length > 900000) {
    let additions = 0;
    let deletions = 0;
    for (const line of b) if (!a.includes(line)) additions++;
    for (const line of a) if (!b.includes(line)) deletions++;
    return {
      additions,
      deletions,
      lines: b.slice(0, 80).map((text) => ({ type: 'add', text }))
    };
  }

  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines = [];
  let additions = 0;
  let deletions = 0;
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ type: 'ctx', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'del', text: a[i] });
      deletions++;
      i++;
    } else {
      lines.push({ type: 'add', text: b[j] });
      additions++;
      j++;
    }
  }
  while (i < n) {
    lines.push({ type: 'del', text: a[i++] });
    deletions++;
  }
  while (j < m) {
    lines.push({ type: 'add', text: b[j++] });
    additions++;
  }

  let visible = lines;
  if (lines.length > 140) {
    const firstChange = Math.max(0, lines.findIndex((l) => l.type !== 'ctx') - 8);
    visible = lines.slice(firstChange, firstChange + 140);
    if (firstChange > 0) visible.unshift({ type: 'ctx', text: '…' });
    if (firstChange + 140 < lines.length) visible.push({ type: 'ctx', text: '…' });
  }

  return { additions, deletions, lines: visible };
}

async function previewWrite(args, ctx) {
  const target = resolveSafe(args.path, ctx);
  const content = String(args.content == null ? '' : args.content);
  const existing = await fsp.readFile(target, 'utf8').catch(() => null);

  if (existing == null) {
    return {
      ok: true,
      path: toRelative(target, ctx),
      created: true,
      bytes: Buffer.byteLength(content, 'utf8'),
      additions: content.split(/\r?\n/).length,
      deletions: 0,
      lines: content.split(/\r?\n/).slice(0, 100).map((text) => ({ type: 'add', text }))
    };
  }

  const diff = lineDiff(existing, content);
  return {
    ok: true,
    path: toRelative(target, ctx),
    created: false,
    bytes: Buffer.byteLength(content, 'utf8'),
    ...diff
  };
}

async function writeFile(args, ctx) {
  const target = resolveSafe(args.path, ctx);
  const content = String(args.content == null ? '' : args.content);

  await fsp.mkdir(path.dirname(target), { recursive: true });

  let backup = null;
  const existing = await fsp.readFile(target).catch(() => null);
  if (existing) {
    const backupDir = path.join(ctx.backupDir, ctx.sessionId || 'default');
    await fsp.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = toRelative(target, ctx).replace(/[\\/]/g, '__');
    backup = path.join(backupDir, `${stamp}__${safeName}`);
    await fsp.writeFile(backup, existing);
  }

  await fsp.writeFile(target, content, 'utf8');

  return {
    ok: true,
    path: toRelative(target, ctx),
    created: !existing,
    bytes: Buffer.byteLength(content, 'utf8'),
    backup: backup ? path.relative(ctx.root, backup) : null
  };
}

async function searchText(args, ctx) {
  const query = String(args.query || '');
  if (!query) throw new Error('نص البحث مطلوب.');

  const root = resolveSafe(args.path || '.', ctx);
  const include = args.include ? globToRegExp(args.include) : null;
  const ignoreCase = args.ignore_case !== false;
  const needle = ignoreCase ? query.toLowerCase() : query;
  const matches = [];
  let truncated = false;

  async function scan(dir, depth) {
    if (matches.length >= MAX_SEARCH_MATCHES) {
      truncated = true;
      return;
    }
    if (depth > 8) return;

    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= MAX_SEARCH_MATCHES) {
        truncated = true;
        return;
      }
      if (SKIP_DIRS.has(entry.name)) continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await scan(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (include && !include.test(entry.name)) continue;

      let stat;
      try {
        stat = await fsp.stat(full);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_SCAN) continue;

      let buffer;
      try {
        buffer = await fsp.readFile(full);
      } catch {
        continue;
      }
      if (isProbablyBinary(buffer)) continue;

      const lines = buffer.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const haystack = ignoreCase ? lines[i].toLowerCase() : lines[i];
        if (haystack.includes(needle)) {
          matches.push({
            file: path.relative(path.resolve(ctx.workspace), full).replace(/\\/g, '/'),
            line: i + 1,
            text: truncate(lines[i].trim(), 240)
          });
          if (matches.length >= MAX_SEARCH_MATCHES) {
            truncated = true;
            return;
          }
        }
      }
    }
  }

  await scan(root, 0);

  return {
    ok: true,
    query,
    count: matches.length,
    matches,
    truncated
  };
}

function runShell(args, ctx) {
  const command = String(args.command || '').trim();
  if (!command) throw new Error('الأمر مطلوب.');

  const cwd = resolveSafe(args.cwd || '.', ctx);
  const isWindows = process.platform === 'win32';
  const finalCommand = isWindows ? `chcp 65001>nul & ${command}` : command;

  return new Promise((resolve) => {
    exec(
      finalCommand,
      {
        cwd,
        timeout: ctx.shellTimeoutMs || 90000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        shell: isWindows ? 'cmd.exe' : '/bin/sh'
      },
      (error, stdout, stderr) => {
        const timedOut = !!(error && (error.killed || error.signal));
        resolve({
          ok: !error,
          command,
          cwd: toRelative(cwd, ctx),
          exitCode: error && typeof error.code === 'number' ? error.code : error ? null : 0,
          timedOut,
          stdout: truncate(String(stdout || '').trim() || '(لا يوجد ناتج)'),
          stderr: truncate(String(stderr || '').trim())
        });
      }
    );
  });
}

function decodeEntities(text) {
  const map = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…'
  };
  return String(text).replace(/&[a-zA-Z#0-9]+;/g, (m) => map[m] || m);
}

function htmlToText(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');

  text = decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

  return { title, text };
}

async function fetchUrl(args, ctx) {
  let url;
  try {
    url = new URL(String(args.url || ''));
  } catch {
    throw new Error('الرابط غير صالح.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('يُسمح فقط بروابط http و https.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NOVA-Agent/2.0)',
        Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5'
      }
    });

    if (!res.ok) throw new Error(`أعاد الموقع حالة ${res.status}.`);

    const type = res.headers.get('content-type') || '';
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > 1.5 * 1024 * 1024) {
      throw new Error('الصفحة أكبر من الحد المسموح (1.5MB).');
    }

    const raw = buffer.toString('utf8');

    if (type.includes('html')) {
      const { title, text } = htmlToText(raw);
      return {
        ok: true,
        url: res.url,
        title,
        content: truncate(text, MAX_OUTPUT),
        truncated: text.length > MAX_OUTPUT
      };
    }

    return {
      ok: true,
      url: res.url,
      title: '',
      content: truncate(raw, MAX_OUTPUT),
      truncated: raw.length > MAX_OUTPUT
    };
  } finally {
    clearTimeout(timer);
  }
}

async function executeTool(name, args, ctx) {
  if (PHONE_TOOL_NAMES.has(name)) {
    return executePhoneTool(name, args || {}, ctx);
  }
  switch (name) {
    case 'list_files':
      return listFiles(args || {}, ctx);
    case 'read_file':
      return readFile(args || {}, ctx);
    case 'write_file':
      return writeFile(args || {}, ctx);
    case 'search_text':
      return searchText(args || {}, ctx);
    case 'run_shell':
      return runShell(args || {}, ctx);
    case 'fetch_url':
      return fetchUrl(args || {}, ctx);
    default:
      throw new Error(`أداة غير معروفة: ${name}`);
  }
}

module.exports = {
  TOOL_DEFS,
  executeTool,
  previewWrite,
  resolveSafe,
  lineDiff,
  truncate
};
