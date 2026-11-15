'use strict';

/* ============================================================
   NOVA — base helpers, icons, markdown, small UI utilities
   ============================================================ */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const LOGO = `
<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
  <g stroke="currentColor" stroke-width="4.6" stroke-linecap="round">
    <path d="M24 3v11"/>
    <path d="M24 34v11"/>
    <path d="M3 24h11"/>
    <path d="M34 24h11"/>
    <path d="M9.2 9.2l7.4 7.4"/>
    <path d="M31.4 31.4l7.4 7.4"/>
    <path d="M38.8 9.2l-7.4 7.4"/>
    <path d="M16.6 31.4l-7.4 7.4"/>
  </g>
  <circle cx="24" cy="24" r="3.4" fill="currentColor" opacity=".9"/>
</svg>`;

function svg(paths, extra = '') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;
}

const ICONS = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  refresh: svg('<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>'),
  trash: svg('<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>'),
  message: svg('<path d="M21 12a8 8 0 01-8 8H5l-2 2V12a8 8 0 018-8h2a8 8 0 018 8z"/>'),
  folder: svg('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>'),
  file: svg('<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  terminal: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9l3 3-3 3M13 15h4"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>'),
  spark: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>'),
  tool: svg('<path d="M14.7 6.3a4 4 0 00-5 5L4 17l3 3 5.7-5.7a4 4 0 005-5l-2.4 2.4-2.6-.7-.7-2.6 2.7-2.1z"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 114 2c-.9.7-1.5 1.2-1.5 2.4"/><path d="M12 17h.01"/>'),
  check: svg('<path d="M4 12.5l5 5L20 6.5"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  alert: svg('<path d="M12 3l9.5 17H2.5L12 3z"/><path d="M12 9v5M12 17h.01"/>'),
  chevronDown: svg('<path d="M7 10l5 5 5-5"/>', 'class="tool-chev"'),
  arrowDown: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  arrowUp: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>'),
  send: svg('<path d="M4 12l16-8-6 8 6 8-16-8z"/>'),
  shield: svg('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  code: svg('<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/>'),
  brain: svg('<path d="M9 4a3 3 0 00-3 3 3 3 0 00-1 5.8A3 3 0 007 17a3 3 0 003 3V4z"/><path d="M15 4a3 3 0 013 3 3 3 0 011 5.8A3 3 0 0117 17a3 3 0 01-3 3V4z"/>'),
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>'),
  gear: svg('<circle cx="12" cy="12" r="3.5"/><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06A1.7 1.7 0 0015 19.4a1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09a1.7 1.7 0 00-1.11-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09A1.7 1.7 0 004.6 8.9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 009 4.6h.05A1.7 1.7 0 0010 3.05V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.55 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06A1.7 1.7 0 0019.4 9v.05a1.7 1.7 0 001.55 1H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.51 1z"/>')
};

/* ---------------- Text helpers ---------------- */
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

function modelsShort(count) {
  const n = Number(count) || 0;
  if (typeof currentLang === 'function' && currentLang() === 'en') {
    if (!n) return 'No models';
    return n === 1 ? '1 model' : `${n} models`;
  }
  if (!n) return 'لا نماذج';
  if (n === 1) return 'نموذج واحد';
  if (n === 2) return 'نموذجان';
  if (n <= 10) return `${n} نماذج`;
  return `${n} نموذجًا`;
}

// Language-aware count phrases ("3 models available" / "3 نماذج متاحة").
function modelsPhrase(count, kind = 'available') {
  const n = Number(count) || 0;
  if (typeof currentLang === 'function' && currentLang() === 'en') {
    if (!n) return 'No models available';
    const suffix = kind === 'ready' || kind === 'جاهز' ? 'ready' : 'available';
    return n === 1 ? `1 model ${suffix}` : `${n} models ${suffix}`;
  }
  const adjective = kind === 'ready' || kind === 'جاهز' ? 'جاهز' : 'متاح';
  if (!n) return 'لا توجد نماذج';
  if (n === 1) return `نموذج واحد ${adjective}`;
  if (n === 2) return `نموذجان ${adjective}ان`;
  if (n <= 10) return `${n} نماذج ${adjective}ة`;
  return `${n} نموذجًا ${adjective}ًا`;
}

function tryParse(value) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function relTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return t('now');
  if (diff < 3600) return t('minutesAgo', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('hoursAgo', { n: Math.floor(diff / 3600) });
  if (diff < 172800) return t('yesterday');
  return date.toLocaleDateString(currentLang(), { day: 'numeric', month: 'short' });
}

function sessionGroup(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t('older');
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const stamp = date.getTime();
  if (stamp >= start) return t('today');
  if (stamp >= start - 86400000) return t('yesterday');
  if (stamp >= start - 7 * 86400000) return t('thisWeek');
  return t('older');
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return t('greetNight');
  if (hour < 12) return t('greetMorning');
  if (hour < 17) return t('greetAfternoon');
  return t('greetEvening');
}

function basename(filePath) {
  return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || 'workspace';
}

/* ---------------- Markdown ---------------- */
function renderMarkdown(source) {
  let text = String(source || '').replace(/\r\n?/g, '\n');

  const codeBlocks = [];
  text = text.replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (match, lang, code) => {
    codeBlocks.push({
      lang: String(lang || '').trim(),
      code: String(code || '').replace(/\n$/, '')
    });
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });

  text = escapeHtml(text);

  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (match, code) => {
    inlineCodes.push(code);
    return `\u0000IC${inlineCodes.length - 1}\u0000`;
  });

  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (m, label, url) => (
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  ));

  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  const lines = text.split('\n');
  const out = [];
  let paragraph = [];
  let listType = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const codeMatch = line.trim().match(/^\u0000CODE(\d+)\u0000$/);
    if (codeMatch) {
      flushAll();
      out.push(`\u0000CODE${codeMatch[1]}\u0000`);
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${heading[2]}</h${level}>`);
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushAll();
      out.push('<hr>');
      continue;
    }

    if (/^\s*&gt;\s?/.test(line)) {
      flushAll();
      out.push(`<blockquote>${line.replace(/^\s*&gt;\s?/, '')}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flushAll();
      const splitRow = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
      const headers = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--;
      out.push(
        '<div class="table-wrap"><table><thead><tr>' +
        headers.map((h) => `<th>${h}</th>`).join('') +
        '</tr></thead><tbody>' +
        rows.map((row) => '<tr>' + headers.map((_, idx) => `<td>${row[idx] || ''}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>'
      );
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || ordered) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (listType !== type) {
        flushList();
        out.push(`<${type}>`);
        listType = type;
      }
      out.push(`<li>${bullet ? bullet[1] : ordered[1]}</li>`);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushAll();

  let html = out.join('\n');

  html = html.replace(/\u0000CODE(\d+)\u0000/g, (m, index) => {
    const block = codeBlocks[Number(index)];
    return `<div class="code-block"><div class="code-head"><span class="code-lang">${escapeHtml(block.lang || 'code')}</span><button type="button" class="copy-btn" data-copy>${ICONS.copy}<span>${escapeHtml(t('copy'))}</span></button></div><pre><code>${escapeHtml(block.code)}</code></pre></div>`;
  });

  html = html.replace(/\u0000IC(\d+)\u0000/g, (m, index) => `<code>${escapeHtml(inlineCodes[Number(index)])}</code>`);

  return html;
}

/* ---------------- API ---------------- */
async function api(method, url, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = (data && data.error) || t('requestFailed', { status: res.status });
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------------- Toasts ---------------- */
function toast(message, type = 'info', duration = 4200) {
  const wrap = $('#toasts');
  if (!wrap) return;

  const icon = type === 'success' ? ICONS.check : type === 'error' ? ICONS.alert : ICONS.spark;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
  wrap.appendChild(el);

  while (wrap.children.length > 4) wrap.firstElementChild.remove();

  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 220);
  }, duration);
}

/* ---------------- Confirm dialog ---------------- */
let confirmResolver = null;

function confirmAction({ title, message = '', okText, danger = true } = {}) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    $('#confirm-title').textContent = title || t('confirmTitle');
    $('#confirm-message').textContent = message;
    const ok = $('#confirm-ok');
    ok.textContent = okText || t('confirmTitle');
    ok.className = 'btn ' + (danger ? 'danger' : 'primary');
    $('#confirm-modal').hidden = false;
  });
}

function resolveConfirm(value) {
  $('#confirm-modal').hidden = true;
  const resolver = confirmResolver;
  confirmResolver = null;
  if (resolver) resolver(value);
}

/* ---------------- Theme ---------------- */
function applyTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('nova.theme', next);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#f2ede4' : '#0e0d0b');
}

/* ---------------- Boot-time bindings (elements exist: scripts load at end of body) ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  const brand = $('#brand-logo');
  if (brand) brand.innerHTML = LOGO;

  $('#confirm-cancel').addEventListener('click', () => resolveConfirm(false));
  $('#confirm-ok').addEventListener('click', () => resolveConfirm(true));

  $('#confirm-modal').addEventListener('click', (event) => {
    if (event.target === $('#confirm-modal')) resolveConfirm(false);
  });

  // Copy code blocks and messages (event delegation on chat)
  const chat = $('#chat');
  chat.addEventListener('click', async (event) => {
    const codeButton = event.target.closest('[data-copy]');
    if (codeButton) {
      const block = codeButton.closest('.code-block');
      const pre = block && block.querySelector('pre');
      if (pre) {
        try {
          await navigator.clipboard.writeText(pre.innerText);
          const label = codeButton.querySelector('span');
          if (label) {
            const old = label.textContent;
            label.textContent = t('copied');
            setTimeout(() => { label.textContent = old; }, 1600);
          }
        } catch {
          toast(t('copyFailed'), 'error');
        }
      }
      return;
    }

    const messageButton = event.target.closest('[data-copy-msg]');
    if (messageButton) {
      const row = messageButton.closest('.msg-row');
      const md = row && row.querySelector('.md');
      if (md) {
        try {
          await navigator.clipboard.writeText(md.innerText);
          toast(t('replyCopied'), 'success', 2200);
        } catch {
          toast(t('copyFailed'), 'error');
        }
      }
    }
  });
});
