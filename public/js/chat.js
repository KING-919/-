'use strict';

/* ============================================================
   NOVA — chat, streaming, slash commands
   ============================================================ */

function getSlashCommands() {
  return [
    {
      cmd: '/new',
      label: t('newChat'),
      desc: t('slashNewDesc'),
      run: () => newChat()
    },
    {
      cmd: '/model',
      label: t('chooseModel'),
      desc: t('slashModelDesc'),
      run: () => openModelPopover()
    },
    {
      cmd: '/settings',
      label: t('settings'),
      desc: t('slashSettingsDesc'),
      run: () => openSettings()
    },
    {
      cmd: '/theme',
      label: t('toggleTheme'),
      desc: t('slashThemeDesc'),
      run: () => {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        state.theme = next;
        applyTheme(next);
      }
    },
    {
      cmd: '/lang',
      label: t('slashLangLabel'),
      desc: t('slashLangDesc'),
      run: () => {
        const next = currentLang() === 'en' ? 'ar' : 'en';
        applyLanguage(next, { notify: true });
      }
    },
    {
      cmd: '/stop',
      label: t('stop'),
      desc: t('slashStopDesc'),
      run: () => stopStreaming()
    },
    {
      cmd: '/help',
      label: t('slashHelpLabel'),
      desc: t('slashHelpDesc'),
      run: () => {
        addNotice(t('slashHelpNotice'), 'info');
      }
    }
  ];
}

/* ---------------- Message rendering ---------------- */

function clearWelcome() {
  const welcome = $('#chat') ? $('#chat').querySelector('.welcome') : null;
  if (welcome) welcome.remove();
}

function buildReasoningBlock(text, open = false) {
  const chev = svg('<path d="M7 10l5 5 5-5"/>', 'class="reason-chev"');
  const el = document.createElement('div');
  el.className = 'reasoning' + (open ? ' open' : '');
  el.innerHTML = `<button type="button" class="reasoning-head">${ICONS.brain}<span>${escapeHtml(t('reasoningLabel'))}</span>${chev}</button>
    <div class="reasoning-body"></div>`;
  el.querySelector('.reasoning-body').textContent = String(text || '');
  el.querySelector('.reasoning-head').addEventListener('click', () => el.classList.toggle('open'));
  return el;
}

function addMessageActions(row) {
  const content = row.querySelector('.msg-content');
  if (!content || content.querySelector('.msg-actions')) return;
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.innerHTML = `<button type="button" class="msg-action" data-copy-msg title="${escapeHtml(t('copyReply'))}" aria-label="${escapeHtml(t('copyReply'))}">${ICONS.copy}</button>`;
  content.appendChild(actions);
}

function createAssistantRow() {
  const row = document.createElement('div');
  row.className = 'msg-row assistant streaming';
  row.innerHTML = `<span class="avatar">${LOGO}</span>
    <div class="msg-content">
      <div class="msg-meta">
        <span class="msg-name">NOVA</span>
        <span class="thinking-pill"><span class="shimmer">${escapeHtml(t('thinking'))}</span><span class="thinking-dots"><i></i><i></i><i></i></span></span>
      </div>
      <div class="md"></div>
    </div>`;
  return row;
}

function startAssistantStream() {
  if (state.activeAssistant) return state.activeAssistant;
  clearWelcome();

  const row = createAssistantRow();
  $('#chat').appendChild(row);

  const assistant = {
    row,
    md: row.querySelector('.md'),
    content: '',
    reasoning: '',
    reasoningEl: null,
    reasoningBody: null
  };
  state.activeAssistant = assistant;
  scrollIfPinned();
  return assistant;
}

function ensureAssistantReasoning(assistant) {
  if (assistant.reasoningEl) return;
  const block = buildReasoningBlock('', true);
  assistant.md.parentNode.insertBefore(block, assistant.md);
  assistant.reasoningEl = block;
  assistant.reasoningBody = block.querySelector('.reasoning-body');
}

function updateAssistantPreview(assistant) {
  assistant.md.innerHTML = renderMarkdown(assistant.content);
  scrollIfPinned();
}

function finalizeAssistant(payload = {}) {
  const assistant = state.activeAssistant;
  if (!assistant) return;
  state.activeAssistant = null;

  if (typeof payload.content === 'string') assistant.content = payload.content;
  if (typeof payload.reasoning === 'string' && payload.reasoning && !assistant.reasoning) {
    assistant.reasoning = payload.reasoning;
  }

  assistant.row.classList.remove('streaming');

  const pill = assistant.row.querySelector('.thinking-pill');
  if (pill) pill.remove();

  if (assistant.reasoning) {
    if (!assistant.reasoningEl) {
      const block = buildReasoningBlock(assistant.reasoning, !assistant.content);
      assistant.md.parentNode.insertBefore(block, assistant.md);
    } else {
      assistant.reasoningBody.textContent = assistant.reasoning;
      if (assistant.content) assistant.reasoningEl.classList.remove('open');
    }
  }

  if (assistant.content) {
    assistant.md.innerHTML = renderMarkdown(assistant.content);
    addMessageActions(assistant.row);
  } else {
    assistant.md.remove();
    if (!assistant.reasoning) {
      assistant.row.remove();
      return;
    }
  }

  scrollIfPinned();
}

function addUserMessage(text) {
  clearWelcome();
  const row = document.createElement('div');
  row.className = 'msg-row user';
  const bubble = document.createElement('div');
  bubble.className = 'user-bubble';
  bubble.textContent = String(text || '');
  row.appendChild(bubble);
  $('#chat').appendChild(row);
  scrollIfPinned();
  return row;
}

function addAssistantStatic(text, reasoning) {
  clearWelcome();
  const row = createAssistantRow();
  row.classList.remove('streaming');

  const pill = row.querySelector('.thinking-pill');
  if (pill) pill.remove();

  const content = row.querySelector('.msg-content');
  const md = row.querySelector('.md');

  if (reasoning) {
    content.insertBefore(buildReasoningBlock(reasoning, false), md);
  }

  md.innerHTML = renderMarkdown(text || '');
  addMessageActions(row);
  $('#chat').appendChild(row);
  scrollIfPinned();
  return row;
}

function scrollIfPinned() {
  if (state.pinned) scrollToBottom(true);
}

/* ---------------- SSE stream ---------------- */

function parseFrame(frame) {
  const lines = String(frame || '').split(/\r?\n/);
  let event = 'message';
  const dataLines = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!dataLines.length) return null;

  let data = null;
  const raw = dataLines.join('\n');
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }

  return { event, data: data || {} };
}

async function streamRequest(url, body) {
  const controller = new AbortController();
  state.controller = controller;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal: controller.signal
  });

  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    throw new Error((data && data.error) || t('requestFailed', { status: res.status }));
  }

  if (!res.body) throw new Error(t('invalidStream'));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const parsed = parseFrame(frame);
      if (parsed) handleStreamEvent(parsed.event, parsed.data);
    }
  }

  const rest = parseFrame(buffer);
  if (rest) handleStreamEvent(rest.event, rest.data);
}

/* ---------------- Stream events ---------------- */

function setPending(kind, toolCallId) {
  state.pending = {
    kind: kind || (state.pending && state.pending.kind) || 'question',
    toolCallId: toolCallId || (state.pending && state.pending.toolCallId) || null
  };
}

function handleStreamEvent(event, data) {
  const payload = data && typeof data === 'object' ? data : {};

  switch (event) {
    case 'status':
      setStatus(payload.text === 'يفكر…' ? t('thinking') : (payload.text || t('working')), 'working');
      break;

    case 'assistant_start':
      startAssistantStream();
      break;

    case 'assistant_delta': {
      const assistant = startAssistantStream();
      const text = String(payload.text || '');
      if (!text) break;
      assistant.content += text;
      const pill = assistant.row.querySelector('.thinking-pill');
      if (pill) pill.remove();
      updateAssistantPreview(assistant);
      break;
    }

    case 'reasoning_delta': {
      const assistant = startAssistantStream();
      const text = String(payload.text || '');
      if (!text) break;
      assistant.reasoning += text;
      ensureAssistantReasoning(assistant);
      assistant.reasoningBody.textContent = assistant.reasoning;
      scrollIfPinned();
      break;
    }

    case 'assistant_end':
      finalizeAssistant(payload);
      break;

    case 'tool_start':
      finalizeAssistant();
      upsertToolCard({
        id: payload.id,
        name: payload.name,
        args: payload.args || state.toolArgs.get(payload.id) || {},
        status: 'running'
      }, { open: payload.name === 'run_shell' });
      break;

    case 'tool_result':
      finalizeAssistant();
      upsertToolCard({
        id: payload.id,
        name: payload.name,
        args: state.toolArgs.get(payload.id) || {},
        status: payload.status || 'success',
        result: payload.result,
        meta: payload.meta || {}
      });
      break;

    case 'approval':
      finalizeAssistant();
      buildApprovalCard(payload);
      setPending('approval', payload.id);
      setStatus(t('awaitingApproval'), 'waiting');
      break;

    case 'question':
      finalizeAssistant();
      buildQuestionCard(payload, true);
      setPending('question', payload.id);
      setStatus(t('awaitingReply'), 'waiting');
      break;

    case 'question_answered':
      markQuestionAnswered(payload, payload.answer);
      state.pending = null;
      setStatus(t('working'), 'working');
      break;

    case 'plan':
      applyPlan(payload.todos || []);
      break;

    case 'notice':
      addNotice(payload.text || '', payload.level || 'info');
      break;

    case 'usage':
      updateUsage(payload);
      break;

    case 'error':
      if (state.streamState) state.streamState.error = true;
      addNotice(payload.message || t('unexpectedError'), 'error');
      setStatus(t('errorStatus'), 'error');
      break;

    case 'awaiting': {
      const kind = payload.kind === 'approval' ? 'approval' : 'question';
      setPending(kind);
      if (state.streamState) state.streamState.awaiting = true;
      setStatus(kind === 'approval' ? t('awaitingApproval') : t('awaitingReply'), 'waiting');
      break;
    }

    case 'done':
      if (state.streamState) state.streamState.done = true;
      handleStreamDone(payload);
      break;

    default:
      break;
  }
}

function handleStreamDone(payload) {
  const session = state.session;
  if (session) {
    if (payload.id) session.id = payload.id;
    if (payload.title) session.title = payload.title;
    if (payload.model) session.model = payload.model;
    if (payload.mode) session.mode = payload.mode;
    if (payload.usage) session.usage = payload.usage;
  }

  state.pending = null;
  updateHeader();
  refreshSessionsSoon();
  setStatus(t('ready'), 'idle');
}

/* ---------------- Send / resume / stop ---------------- */

function beginStreaming() {
  state.streaming = true;
  state.streamState = { done: false, awaiting: false, error: false };
  updateSendButton();
  setStatus(t('working'), 'working');
}

function finishStreaming({ aborted, hadError }) {
  finalizeAssistant();

  state.streaming = false;
  state.controller = null;
  updateSendButton();

  const flags = state.streamState || {};

  if (hadError || flags.error) {
    setStatus(t('errorStatus'), 'error');
  } else if (state.pending) {
    setStatus(state.pending.kind === 'approval' ? t('awaitingApproval') : t('awaitingReply'), 'waiting');
  } else {
    setStatus(t('ready'), 'idle');
  }

  if (!aborted && !hadError && !flags.error && !flags.done && !flags.awaiting) {
    addNotice(t('streamInterrupted'), 'warn');
  }

  refreshSessionsSoon();
}

async function sendMessage(text) {
  if (state.streaming) {
    toast(t('stopCurrentFirst'), 'info');
    return;
  }
  if (state.pending) {
    toast(t('answerPendingFirst'), 'info');
    return;
  }

  const input = $('#input');
  const value = (typeof text === 'string' ? text : input ? input.value : '').trim();
  if (!value) return;

  let aborted = false;
  let hadError = false;
  let session = null;

  try {
    session = await ensureSession();

    if (input) input.value = '';
    autoResizeComposer();
    hideSlashMenu();
    updateSendButton();

    clearWelcome();
    addUserMessage(value);
    state.pinned = true;
    scrollToBottom(true);

    beginStreaming();
    await streamRequest(`/api/sessions/${session.id}/chat`, { message: value, lang: currentLang() });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      aborted = true;
    } else {
      hadError = true;
      addNotice((err && err.message) || t('sendFailed'), 'error');
      toast((err && err.message) || t('sendFailed'), 'error');
    }
  } finally {
    finishStreaming({ aborted, hadError });
    if (input) input.focus();
  }
}

async function resumeTurn(payload) {
  if (state.streaming) return;
  if (!state.session) {
    toast(t('noActiveSession'), 'info');
    return;
  }

  let aborted = false;
  let hadError = false;

  try {
    beginStreaming();
    await streamRequest(`/api/sessions/${state.session.id}/resume`, { ...(payload || {}), lang: currentLang() });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      aborted = true;
    } else {
      hadError = true;
      addNotice((err && err.message) || t('resumeFailed'), 'error');
      toast((err && err.message) || t('resumeFailed'), 'error');
    }
  } finally {
    finishStreaming({ aborted, hadError });
    const input = $('#input');
    if (input) input.focus();
  }
}

async function stopStreaming() {
  if (!state.streaming) return;

  const sessionId = state.session && state.session.id;
  const controller = state.controller;

  if (controller) {
    try {
      controller.abort();
    } catch {
      // ignore
    }
  }

  if (sessionId) {
    fetch(`/api/sessions/${sessionId}/abort`, { method: 'POST' }).catch(() => {});
  }

  state.streaming = false;
  state.controller = null;
  finalizeAssistant();
  updateSendButton();
  setStatus(t('stopped'), 'idle');
  toast(t('stoppedNotice'), 'info', 2200);
}

/* ---------------- Composer ---------------- */

function autoResizeComposer() {
  const input = $('#input');
  if (!input) return;
  input.style.height = 'auto';
  const height = Math.min(input.scrollHeight || 27, 210);
  input.style.height = `${height}px`;
}

function updateSendButton() {
  const button = $('#send-btn');
  if (!button) return;

  const streaming = !!state.streaming;
  button.classList.toggle('is-streaming', streaming);

  if (streaming) {
    button.disabled = false;
    button.title = t('stop');
    button.setAttribute('aria-label', t('stop'));
    return;
  }

  const input = $('#input');
  button.disabled = !input || !input.value.trim();
  button.title = t('send');
  button.setAttribute('aria-label', t('send'));
}

function hideSlashMenu() {
  const menu = $('#slash-menu');
  if (!menu) return;
  menu.hidden = true;
  state.slashItems = [];
  state.slashIndex = 0;
}

function updateSlashMenu() {
  const input = $('#input');
  const menu = $('#slash-menu');
  if (!input || !menu) return;

  const value = input.value;

  if (!value.startsWith('/') || /\s/.test(value)) {
    hideSlashMenu();
    return;
  }

  const query = value.toLowerCase();
  const items = getSlashCommands().filter((item) => item.cmd.toLowerCase().startsWith(query));

  if (!items.length) {
    hideSlashMenu();
    return;
  }

  state.slashItems = items;
  if (state.slashIndex >= items.length) state.slashIndex = 0;

  menu.innerHTML = items.map((item, index) => `<button type="button" class="slash-item${index === state.slashIndex ? ' active' : ''}" data-slash="${escapeHtml(item.cmd)}">
    <span class="slash-cmd">${escapeHtml(item.cmd)}</span>
    <span class="slash-desc">${escapeHtml(item.label)} — ${escapeHtml(item.desc)}</span>
  </button>`).join('');

  menu.hidden = false;

  $$('.slash-item', menu).forEach((button) => {
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      runSlashCommand(button.dataset.slash);
    });
  });
}

function runSlashCommand(command) {
  const item = getSlashCommands().find((entry) => entry.cmd === command);
  if (!item) return;

  const input = $('#input');
  if (input) input.value = '';
  autoResizeComposer();
  updateSendButton();
  hideSlashMenu();

  setTimeout(() => {
    try {
      item.run();
    } catch (err) {
      toast(err.message, 'error');
    }
  }, 0);
}

function onComposerKeydown(event) {
  const menu = $('#slash-menu');
  const menuOpen = menu && !menu.hidden;

  if (menuOpen) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.slashIndex = (state.slashIndex + 1) % state.slashItems.length;
      updateSlashMenu();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.slashIndex = (state.slashIndex - 1 + state.slashItems.length) % state.slashItems.length;
      updateSlashMenu();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const item = state.slashItems[state.slashIndex];
      if (item) runSlashCommand(item.cmd);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      hideSlashMenu();
      return;
    }
  }

  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage();
  }
}

function bindChatEvents() {
  const input = $('#input');
  if (!input) return;

  input.addEventListener('input', () => {
    autoResizeComposer();
    updateSendButton();
    updateSlashMenu();
  });

  input.addEventListener('keydown', onComposerKeydown);

  input.addEventListener('blur', () => {
    setTimeout(() => hideSlashMenu(), 140);
  });

  const send = $('#send-btn');
  if (send) {
    send.addEventListener('click', () => {
      if (state.streaming) stopStreaming();
      else sendMessage();
    });
  }

  const toolsChip = $('#tools-chip');
  if (toolsChip) {
    toolsChip.addEventListener('click', () => {
      addNotice(t('toolsNotice'), 'info');
    });
  }

  const planToggle = $('#plan-toggle');
  if (planToggle) {
    planToggle.addEventListener('click', () => {
      const panel = $('#plan-panel');
      if (!panel) return;
      const expanded = panel.classList.toggle('expanded');
      planToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }
}
