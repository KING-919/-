'use strict';

/* ============================================================
   NOVA — app state, sessions, models, welcome, shell events
   ============================================================ */

function getSuggestions() {
  return [
    {
      icon: 'code',
      title: t('sug1Title'),
      desc: t('sug1Desc'),
      prompt: t('sug1Prompt')
    },
    {
      icon: 'search',
      title: t('sug2Title'),
      desc: t('sug2Desc'),
      prompt: t('sug2Prompt')
    },
    {
      icon: 'list',
      title: t('sug3Title'),
      desc: t('sug3Desc'),
      prompt: t('sug3Prompt')
    },
    {
      icon: 'terminal',
      title: t('sug4Title'),
      desc: t('sug4Desc'),
      prompt: t('sug4Prompt')
    }
  ];
}

const state = {
  config: null,
  models: [],
  connected: false,
  baseUrl: '',
  model: localStorage.getItem('nova.model') || '',
  mode: localStorage.getItem('nova.mode') || 'ask',
  theme: localStorage.getItem('nova.theme') || 'dark',
  lang: localStorage.getItem('nova.lang') === 'en' ? 'en' : 'ar',
  sessions: [],
  session: null,
  pending: null,
  streaming: false,
  controller: null,
  todos: [],
  activeAssistant: null,
  toolArgs: new Map(),
  lastUsage: null,
  pinned: true,
  slashIndex: 0,
  slashItems: [],
  keyCleared: false
};

let sessionsTimer = null;

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

// Chrome can autofill a saved URL into the session search box, hiding every
// conversation behind a query that was never typed. Treat URL-like values as
// autofill noise and clear them.
function sessionQuery() {
  const input = $('#session-search');
  if (!input) return '';
  const raw = String(input.value || '').trim();
  if (looksLikeUrl(raw)) {
    input.value = '';
    return '';
  }
  return raw.toLowerCase();
}

function clearAutofilledSearch() {
  const input = $('#session-search');
  if (!input || !looksLikeUrl(input.value)) return;
  input.value = '';
  renderSessions();
}

async function init() {
  applyTheme(state.theme);
  applyLanguage(state.lang);
  bindShellEvents();
  bindChatEvents();
  bindSettingsEvents();
  autoResizeComposer();
  updateModeUI();
  updateHeader();
  updateSendButton();

  const searchInput = $('#session-search');
  if (searchInput) {
    const unlockSearch = () => searchInput.removeAttribute('readonly');
    searchInput.addEventListener('focus', unlockSearch);
    searchInput.addEventListener('pointerdown', unlockSearch);
    searchInput.addEventListener('keydown', unlockSearch);
    searchInput.value = '';
    searchInput.addEventListener('focus', clearAutofilledSearch);
    searchInput.addEventListener('pointerdown', clearAutofilledSearch);
  }
  [400, 1200, 2600, 5000].forEach((delay) => setTimeout(clearAutofilledSearch, delay));

  await Promise.allSettled([loadConfig(), loadModels(), loadSessions()]);

  if (!state.session) renderWelcome();
  updateConnectionUI();
  updateModelUI();
  updateWorkspaceUI();
  updateHeader();
  setStatus(t('ready'), 'idle');
  if (state.session) {
    scrollToBottom(true);
  } else {
    const scroller = $('#chat-scroll');
    if (scroller) scroller.scrollTop = 0;
  }
}

/* ---------------- Data loading ---------------- */
async function loadConfig() {
  try {
    const config = await api('GET', '/api/config');
    state.config = config;
    if (!localStorage.getItem('nova.mode')) state.mode = config.mode || 'ask';
    updateWorkspaceUI();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadModels() {
  try {
    const data = await api('GET', '/api/models');
    state.connected = !!data.connected;
    state.models = Array.isArray(data.models) ? data.models : [];
    state.baseUrl = data.baseUrl || (state.config && state.config.baseUrl) || '';

    const hasModel = state.models.some((m) => m.id === state.model);
    if (!hasModel && state.models.length) {
      const loaded = state.models.find((m) => m.state === 'loaded');
      state.model = (loaded || state.models[0]).id;
      localStorage.setItem('nova.model', state.model);
    }

    updateConnectionUI();
    updateModelUI();
    if ($('#welcome-connect')) updateWelcomeState();
  } catch (err) {
    state.connected = false;
    state.models = [];
    updateConnectionUI();
    updateModelUI();
  }
}

async function loadSessions() {
  try {
    const data = await api('GET', '/api/sessions');
    state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    renderSessions();
  } catch {
    // non-fatal
  }
}

function refreshSessionsSoon() {
  clearTimeout(sessionsTimer);
  sessionsTimer = setTimeout(() => loadSessions(), 650);
}

function displaySessionTitle(title) {
  if (!title || title === 'جلسة جديدة') return t('newSession');
  return title;
}

/* ---------------- Sidebar sessions ---------------- */
function renderSessions() {
  const wrap = $('#sessions');
  if (!wrap) return;

  const query = sessionQuery();
  const sessions = state.sessions.filter((session) => !query || String(session.title || '').toLowerCase().includes(query));

  const count = $('#sessions-count');
  if (count) count.textContent = String(state.sessions.length);

  if (!sessions.length) {
    wrap.innerHTML = query
      ? `<div class="sessions-empty">${escapeHtml(t('noSearchMatches'))}</div>`
      : `<div class="sessions-empty"><span class="sessions-empty-glyph">◌</span>${escapeHtml(t('noSessionsYet'))}<br>${escapeHtml(t('startQuestionOrTask'))}</div>`;
    return;
  }

  const groups = new Map();
  sessions.forEach((session) => {
    const key = sessionGroup(session.updatedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  });

  wrap.innerHTML = Array.from(groups.entries()).map(([label, items]) => `
    <div class="session-group">
      <div class="session-group-label"><span>${escapeHtml(label)}</span><span class="session-group-count">${items.length}</span></div>
      ${items.map((session) => {
        const active = state.session && state.session.id === session.id ? ' active' : '';
        const shownTitle = displaySessionTitle(session.title);
        return `<div class="session-item${active}" data-id="${escapeHtml(session.id)}" tabindex="0" role="button" title="${escapeHtml(shownTitle)}">
          <span class="session-ico">${ICONS.message}</span>
          <span class="session-main">
            <span class="session-title">${escapeHtml(shownTitle)}</span>
            <span class="session-time">${escapeHtml(relTime(session.updatedAt))}</span>
          </span>
          <button class="session-del" data-del="${escapeHtml(session.id)}" title="${escapeHtml(t('deleteChat'))}" aria-label="${escapeHtml(t('deleteChat'))}: ${escapeHtml(shownTitle)}">${ICONS.trash}</button>
        </div>`;
      }).join('')}
    </div>`).join('');
}

/* ---------------- Welcome ---------------- */
function renderWelcome() {
  const chat = $('#chat');
  if (!chat) return;

  clearPlan();
  const suggestions = getSuggestions();

  chat.innerHTML = `<div class="welcome">
    <div class="welcome-hero">
      <div class="welcome-orb-wrap"><div class="welcome-orb">${LOGO}</div></div>
      <div class="welcome-kicker"><span class="kicker-dot"></span>${escapeHtml(greeting())} · NOVA</div>
      <h1>${escapeHtml(t('welcomeHeadingA'))} <em>${escapeHtml(t('welcomeHeadingEm'))}</em></h1>
      <p>${escapeHtml(t('welcomeDesc'))}</p>
      <div class="welcome-badges">
        <span class="welcome-badge">${ICONS.spark}<span>${escapeHtml(t('welcomeBadge1'))}</span></span>
        <span class="welcome-badge">${ICONS.tool}<span>${escapeHtml(t('welcomeBadge2'))}</span></span>
        <span class="welcome-badge">${ICONS.shield}<span>${escapeHtml(t('welcomeBadge3'))}</span></span>
      </div>
    </div>
    <div id="welcome-alert"></div>
    <div class="suggestions-head"><span>${escapeHtml(t('quickStart'))}</span></div>
    <div class="suggestions">
      ${suggestions.map((item, index) => `<button type="button" class="suggestion" data-suggestion="${index}">
        <span class="suggestion-ico">${ICONS[item.icon] || ICONS.spark}</span>
        <span class="suggestion-body">
          <span class="suggestion-title">${escapeHtml(item.title)}</span>
          <span class="suggestion-desc">${escapeHtml(item.desc)}</span>
        </span>
        <svg class="suggestion-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>
      </button>`).join('')}
    </div>
    <div class="welcome-connect" id="welcome-connect"></div>
    <div class="welcome-foot">
      <span>${ICONS.shield}${escapeHtml(t('welcomeFootPrivacy'))}</span>
      <span class="welcome-foot-mono">${escapeHtml(t('welcomeFootTag'))}</span>
    </div>
  </div>`;

  const jump = $('#jump-bottom');
  if (jump) jump.hidden = true;
  updateWelcomeState();
}

function updateWelcomeState() {
  const connect = $('#welcome-connect');
  if (!connect) return;

  connect.hidden = !state.connected;

  const dotClass = state.connected ? 'online' : 'offline';
  const modelText = state.connected
    ? (state.models.length ? modelsPhrase(state.models.length, 'ready') : t('connectedNoModels'))
    : t('disconnected');

  connect.innerHTML = `<span class="wc-pill"><span class="status-dot ${dotClass}"></span>${escapeHtml(modelText)}</span>
    <span class="wc-pill">${escapeHtml(providerLabel())}</span>
    <button type="button" data-welcome="settings">${escapeHtml(t('connectionSettings'))}</button>`;

  const alert = $('#welcome-alert');
  if (!alert) return;

  if (!state.connected) {
    alert.innerHTML = `<div class="setup-card">
      <span class="setup-icon">${ICONS.spark}</span>
      <div class="setup-body">
        <b>${escapeHtml(t('setupTitle'))}</b>
        <p>${escapeHtml(t('setupDesc'))}</p>
        <ol class="setup-steps">
          <li><span>1</span>${escapeHtml(t('setupStep1'))}</li>
          <li><span>2</span>${escapeHtml(t('setupStep2'))}</li>
          <li><span>3</span>${escapeHtml(t('setupStep3'))}</li>
        </ol>
        <div class="setup-actions">
          <button type="button" class="btn primary small" data-welcome="settings">${escapeHtml(t('openSettings'))}</button>
          <button type="button" class="btn ghost small" data-welcome="retry">${escapeHtml(t('quickTest'))}</button>
        </div>
      </div>
    </div>`;
  } else if (!state.models.length) {
    alert.innerHTML = `<div class="setup-card compact">
      <span class="setup-icon">${ICONS.alert}</span>
      <div class="setup-body">
        <b>${escapeHtml(t('connectedNoModelsTitle'))}</b>
        <p>${escapeHtml(t('connectedNoModelsDesc'))}</p>
        <div class="setup-actions">
          <button type="button" class="btn ghost small" data-welcome="retry">${escapeHtml(t('retry'))}</button>
          <button type="button" class="btn ghost small" data-welcome="settings">${escapeHtml(t('openSettings'))}</button>
        </div>
      </div>
    </div>`;
  } else {
    alert.innerHTML = '';
  }
}

async function retryConnection() {
  await loadModels();
  updateWelcomeState();
  if (state.connected) {
    toast(t('connectedToast', { models: modelsPhrase(state.models.length, 'available') }), 'success');
  } else {
    toast(t('noProviderFound'), 'error');
  }
}

/* ---------------- Header / status ---------------- */
function updateHeader() {
  const title = displaySessionTitle(state.session && state.session.title);
  const el = $('#session-title');
  if (el) el.textContent = title;
  const exportButton = $('#export-chat');
  if (exportButton) exportButton.disabled = !state.session;
  document.title = `${title} — NOVA`;
}

function exportCurrentChat() {
  if (!state.session) return;
  const turns = $$('.msg-row', $('#chat')).map((row) => {
    if (row.classList.contains('user')) {
      const text = row.querySelector('.user-bubble')?.innerText.trim();
      return text ? `## ${t('exportYou')}\n\n${text}` : '';
    }
    if (row.classList.contains('assistant')) {
      const text = row.querySelector('.md')?.innerText.trim();
      return text ? `## NOVA\n\n${text}` : '';
    }
    return '';
  }).filter(Boolean);
  if (!turns.length) {
    toast(t('noMessagesToExport'), 'info');
    return;
  }
  const title = displaySessionTitle(state.session.title);
  const content = `# ${title}\n\n${t('exportDatePrefix')} ${new Date().toLocaleString(currentLang())}\n\n${turns.join('\n\n---\n\n')}\n`;
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${String(state.session.title || 'nova-chat').replace(/[\\/:*?"<>|]/g, '-').slice(0, 70)}.md`;
  link.click();
  URL.revokeObjectURL(url);
  toast(t('exportedSuccess'), 'success');
}

function setStatus(text, kind = 'idle') {
  const label = $('#agent-status');
  if (label) label.textContent = text;

  const dot = $('#agent-dot');
  if (!dot) return;
  dot.className = 'agent-dot';
  if (kind === 'working') dot.classList.add('working');
  if (kind === 'waiting') dot.classList.add('waiting');
  if (kind === 'error') dot.classList.add('error');
}

/* ---------------- Models UI ---------------- */
function updateModelUI() {
  const name = $('#model-name');
  if (name) name.textContent = state.model || t('chooseModel');

  const hint = $('#model-hint');
  if (hint) hint.textContent = state.connected ? providerLabel() : t('apiDisconnected');

  const popBase = $('#pop-base');
  if (popBase) popBase.textContent = state.baseUrl ? state.baseUrl.replace(/^https?:\/\//, '') : providerLabel();

  const count = $('#model-count');
  if (count) count.textContent = state.models.length ? modelsShort(state.models.length) : '';

  if ($('#model-popover') && !$('#model-popover').hidden) renderModelList();
}

function providerLabel() {
  const labels = {
    lmstudio: 'LM Studio', freellmapi: 'FreeLLMAPI', openai: 'OpenAI', openrouter: 'OpenRouter',
    groq: 'Groq', gemini: 'Google Gemini', ollama: 'Ollama', 'openai-compatible': 'OpenAI-compatible API'
  };
  return labels[(state.config && state.config.provider) || 'lmstudio'] || 'OpenAI-compatible API';
}

function renderModelList() {
  const list = $('#model-list');
  if (!list) return;

  const query = ($('#model-search').value || '').trim().toLowerCase();
  const models = state.models.filter((m) => !query || m.id.toLowerCase().includes(query));

  if (!models.length) {
    list.innerHTML = `<div class="model-empty">${escapeHtml(state.connected
      ? t('noMatchingModels')
      : t('checkApiAccess'))}</div>`;
    return;
  }

  list.innerHTML = models.map((model) => {
    const active = model.id === state.model ? ' active' : '';
    const loaded = model.state === 'loaded';
    const stateBadge = model.state
      ? `<span class="model-badge ${loaded ? '' : 'off'}">${escapeHtml(loaded ? t('loaded') : t('unloaded'))}</span>`
      : '';
    const meta = [model.publisher, model.arch, model.context ? `${model.context} ctx` : '']
      .filter(Boolean)
      .join(' · ');

    return `<button type="button" class="model-item${active}" data-model="${escapeHtml(model.id)}">
      <span class="m-orb"></span>
      <span class="m-main">
        <span class="m-id">${escapeHtml(model.id)}</span>
        ${meta ? `<span class="m-meta">${escapeHtml(meta)}</span>` : ''}
      </span>
      ${stateBadge}
    </button>`;
  }).join('');

  $$('.model-item', list).forEach((item) => {
    item.addEventListener('click', () => {
      setModel(item.dataset.model);
      closeModelPopover();
    });
  });
}

function updateConnectionUI() {
  const dot = $('#conn-dot');
  const text = $('#conn-text');
  if (dot) dot.className = 'status-dot ' + (state.connected ? 'online' : 'offline');
  if (text) {
    text.textContent = state.connected
      ? `${providerLabel()} · ${modelsShort(state.models.length)}`
      : t('notConnectedProvider');
  }
  document.body.classList.toggle('is-connected', !!state.connected);
  const popBase = $('#pop-base');
  if (popBase) popBase.textContent = state.baseUrl ? state.baseUrl.replace(/^https?:\/\//, '') : providerLabel();
}

function updateWorkspaceUI() {
  const workspace = (state.config && state.config.workspace) || '';
  const name = basename(workspace);
  const pathEl = $('#workspace-path');
  if (pathEl) pathEl.textContent = workspace || '—';
  const topWs = $('#top-workspace');
  if (topWs) topWs.textContent = name;
  const wsLabel = $('#ws-label');
  if (wsLabel) wsLabel.textContent = name;
  const wsChip = $('#ws-chip');
  if (wsChip) wsChip.title = workspace ? `${t('workspace')}: ${workspace}` : t('changeWorkspace');
}

async function setModel(id) {
  if (!id) return;
  state.model = id;
  localStorage.setItem('nova.model', id);
  updateModelUI();

  if (state.session) {
    try {
      const data = await api('PATCH', `/api/sessions/${state.session.id}`, { model: id });
      state.session.model = data.session.model;
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

function openModelPopover() {
  const pop = $('#model-popover');
  if (!pop) return;
  pop.hidden = false;
  $('#model-search').value = '';
  renderModelList();
  updateModelUI();
  setTimeout(() => $('#model-search').focus(), 40);
}

function closeModelPopover() {
  const pop = $('#model-popover');
  if (pop) pop.hidden = true;
}

/* ---------------- Session lifecycle ---------------- */
async function ensureSession() {
  if (state.session) return state.session;

  const model = state.model;
  if (!model) {
    openModelPopover();
    throw new Error(t('chooseModelFirst'));
  }

  const data = await api('POST', '/api/sessions', { model, mode: state.mode });
  state.session = data.session;
  state.todos = [];
  clearPlan();
  updateHeader();
  refreshSessionsSoon();
  return state.session;
}

async function newChat() {
  if (state.streaming) await stopStreaming();

  state.session = null;
  state.pending = null;
  state.todos = [];
  state.activeAssistant = null;
  state.toolArgs.clear();
  clearPlan();
  updateHeader();
  setStatus(t('ready'), 'idle');
  $('#chat').innerHTML = '';
  renderWelcome();
  renderSessions();
  updateSendButton();
  closeSidebar();
}

async function openSession(id) {
  if (state.streaming) {
    toast(t('stopCurrentFirst'), 'info');
    return;
  }

  try {
    const data = await api('GET', `/api/sessions/${id}`);
    state.session = data.session;
    state.pending = data.pending || null;
    state.model = data.session.model || state.model;
    state.mode = data.session.mode || 'ask';
    state.todos = [];
    state.activeAssistant = null;
    state.toolArgs.clear();

    localStorage.setItem('nova.model', state.model);
    localStorage.setItem('nova.mode', state.mode);

    updateModeUI();
    updateModelUI();
    updateHeader();
    updateSendButton();
    clearPlan();

    renderTranscript(data.session.transcript || [], data.pending);
    setStatus(
      state.pending ? (state.pending.kind === 'approval' ? t('awaitingApproval') : t('awaitingReply')) : t('ready'),
      state.pending ? 'waiting' : 'idle'
    );

    renderSessions();
    closeSidebar();
    scrollToBottom(true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteSession(id) {
  if (!id) return;
  const session = state.sessions.find((item) => item.id === id);
  const title = displaySessionTitle(session && session.title);
  const ok = await confirmAction({
    title: t('deleteChat'),
    message: t('deleteChatConfirm', { title }),
    okText: t('delete'),
    danger: true
  });
  if (!ok) return;

  try {
    await api('DELETE', `/api/sessions/${id}`);
    if (state.session && state.session.id === id) {
      await newChat();
    }
    await loadSessions();
    toast(t('chatDeleted'), 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteCurrentSession() {
  if (!state.session) {
    toast(t('noSavedChatYet'), 'info');
    return;
  }
  await deleteSession(state.session.id);
}

/* ---------------- Scrolling ---------------- */
function scrollToBottom(force = false) {
  const scroller = $('#chat-scroll');
  if (!scroller) return;
  if (force || state.pinned) scroller.scrollTop = scroller.scrollHeight;
}

function updateJumpButton() {
  const scroller = $('#chat-scroll');
  const jump = $('#jump-bottom');
  if (!scroller || !jump) return;
  const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  const atBottom = distance < 90;
  state.pinned = atBottom;
  jump.hidden = atBottom;
}

/* ---------------- Sidebar ---------------- */
function openSidebar() {
  $('#sidebar').classList.add('open');
  document.body.classList.add('sidebar-open');
}

function closeSidebar() {
  $('#sidebar').classList.remove('open');
  document.body.classList.remove('sidebar-open');
}

/* ---------------- Shell events ---------------- */
function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function bindShellEvents() {
  $('#export-chat').addEventListener('click', exportCurrentChat);
  $('#new-chat').addEventListener('click', newChat);
  $('#refresh-sessions').addEventListener('click', async () => {
    await loadSessions();
    toast(t('chatsUpdated'), 'info', 1800);
  });

  $('#workspace-card').addEventListener('click', () => openSettings('workspace'));
  const wsChip = $('#ws-chip');
  if (wsChip) wsChip.addEventListener('click', () => openSettings('workspace'));
  $('#settings-btn').addEventListener('click', () => openSettings('connection'));
  const settingsBtn2 = $('#settings-btn-2');
  if (settingsBtn2) settingsBtn2.addEventListener('click', () => openSettings('connection'));
  const connSettings = $('#conn-settings');
  if (connSettings) connSettings.addEventListener('click', () => openSettings('connection'));

  const langBtn = $('#lang-btn');
  if (langBtn) {
    langBtn.addEventListener('click', () => {
      const next = currentLang() === 'en' ? 'ar' : 'en';
      applyLanguage(next, { notify: true });
    });
  }

  $('#theme-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    state.theme = next;
    applyTheme(next);
  });

  $('#model-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    if ($('#model-popover').hidden) openModelPopover();
    else closeModelPopover();
  });

  $('#refresh-models').addEventListener('click', async (event) => {
    event.stopPropagation();
    await loadModels();
    renderModelList();
    toast(state.connected ? t('modelsUpdated') : t('noProviderFound'), state.connected ? 'success' : 'error');
  });

  $('#model-search').addEventListener('input', renderModelList);
  $('#model-search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = $('#model-list .model-item');
      if (first) {
        setModel(first.dataset.model);
        closeModelPopover();
      }
    }
  });

  $('#model-settings').addEventListener('click', () => {
    closeModelPopover();
    openSettings();
  });

  $('#menu-btn').addEventListener('click', openSidebar);
  $('#close-sidebar').addEventListener('click', closeSidebar);

  $('#sessions').addEventListener('click', (event) => {
    const deleteBtn = event.target.closest('[data-del]');
    if (deleteBtn) {
      event.stopPropagation();
      deleteSession(deleteBtn.dataset.del);
      return;
    }
    const item = event.target.closest('.session-item');
    if (item) openSession(item.dataset.id);
  });

  $('#sessions').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const item = event.target.closest('.session-item');
    if (item) openSession(item.dataset.id);
  });

  $('#chat').addEventListener('click', (event) => {
    const suggestion = event.target.closest('[data-suggestion]');
    if (suggestion) {
      const item = getSuggestions()[Number(suggestion.dataset.suggestion)];
      if (item) sendMessage(item.prompt);
      return;
    }

    const welcomeAction = event.target.closest('[data-welcome]');
    if (welcomeAction) {
      const action = welcomeAction.dataset.welcome;
      if (action === 'settings') openSettings();
      if (action === 'retry') retryConnection();
    }
  });

  $('#chat-scroll').addEventListener('scroll', updateJumpButton);
  $('#jump-bottom').addEventListener('click', () => {
    state.pinned = true;
    scrollToBottom(true);
    updateJumpButton();
  });

  document.addEventListener('click', (event) => {
    const modelPop = $('#model-popover');
    if (!modelPop.hidden && !modelPop.contains(event.target) && !$('#model-btn').contains(event.target)) {
      closeModelPopover();
    }

    const modePop = $('#mode-popover');
    if (!modePop.hidden && !modePop.contains(event.target) && !$('#mode-chip').contains(event.target)) {
      hideModeMenu();
    }

    if (document.body.classList.contains('sidebar-open') &&
        !$('#sidebar').contains(event.target) &&
        !$('#menu-btn').contains(event.target)) {
      closeSidebar();
    }
  });

  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;

    if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (event.shiftKey) openModelPopover();
      else newChat();
      return;
    }

    if (event.key === 'Escape') {
      if (!$('#settings-modal').hidden) { closeSettings(); return; }
      if (!$('#confirm-modal').hidden) { resolveConfirm(false); return; }
      if (!$('#model-popover').hidden) { closeModelPopover(); return; }
      if (!$('#mode-popover').hidden) { hideModeMenu(); return; }
      if (!$('#slash-menu').hidden) { hideSlashMenu(); return; }
      if (state.streaming) { stopStreaming(); return; }
    }

    if (state.pending && state.pending.kind === 'question' && !state.streaming && !isTypingTarget(event.target)) {
      const number = parseInt(event.key, 10);
      if (number >= 1 && number <= 9) {
        const card = findQuestionCard(state.pending.toolCallId);
        const options = card ? card.querySelectorAll('.q-option') : [];
        if (options[number - 1]) {
          event.preventDefault();
          options[number - 1].click();
        }
      }
    }
  });
}
