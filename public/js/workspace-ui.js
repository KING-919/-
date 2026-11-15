'use strict';

/* Workspace explorer and the keyboard command surface. */
let workspacePath = '';
let selectedWorkspaceFile = '';
let commandIndex = 0;

function fillComposerPrompt(prompt) {
  const input = $('#input');
  input.value = prompt;
  autoResizeComposer();
  input.focus();
}

function getQuickActions() {
  return [
    { title: t('newChat'), detail: t('qaNewDesc'), icon: ICONS.plus, keys: 'Ctrl K', run: () => newChat() },
    { title: t('qaSearchTitle'), detail: t('qaSearchDesc'), icon: ICONS.search, keys: '/', run: () => $('#session-search').focus() },
    { title: t('qaModelTitle'), detail: t('qaModelDesc'), icon: ICONS.brain, keys: 'Ctrl ⇧ K', run: () => openModelPopover() },
    { title: t('filesExplorer'), detail: t('qaFilesDesc'), icon: ICONS.folder, keys: '', run: () => toggleWorkspace(true) },
    { title: t('qaReviewTitle'), detail: t('qaReviewDesc'), icon: ICONS.code, keys: '', run: () => fillComposerPrompt(t('qaReviewPrompt')) },
    { title: t('qaPlanTitle'), detail: t('qaPlanDesc'), icon: ICONS.list, keys: '', run: () => fillComposerPrompt(t('qaPlanPrompt')) },
    { title: t('qaDebugTitle'), detail: t('qaDebugDesc'), icon: ICONS.tool, keys: '', run: () => fillComposerPrompt(t('qaDebugPrompt')) },
    { title: t('toggleTheme'), detail: t('slashThemeDesc'), icon: ICONS.spark, keys: '', run: () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      state.theme = next; applyTheme(next);
    } },
    { title: t('qaLangTitle'), detail: t('qaLangDesc'), icon: ICONS.globe, keys: '/lang', run: () => {
      const next = currentLang() === 'en' ? 'ar' : 'en';
      applyLanguage(next, { notify: true });
    } },
    { title: t('settings'), detail: t('qaSettingsDesc'), icon: ICONS.gear, keys: '', run: () => openSettings() }
  ];
}

function toggleWorkspace(force) {
  const panel = $('#workspace-panel');
  if (!panel) return;
  const open = force === undefined ? panel.hidden : force;
  panel.hidden = !open;
  $('#workspace-toggle').setAttribute('aria-pressed', String(open));
  document.body.classList.toggle('workspace-open', open);
  if (open) loadWorkspaceFiles(workspacePath);
}

async function loadWorkspaceFiles(relativePath = '') {
  const list = $('#workspace-filelist');
  const preview = $('#file-preview');
  if (!list) return;
  list.innerHTML = `<div class="file-loading"><span class="loading-ring"></span> ${escapeHtml(t('loadingFiles'))}</div>`;
  try {
    const data = await api('GET', `/api/workspace/files?path=${encodeURIComponent(relativePath)}`);
    workspacePath = data.path || '';
    const rootLabel = state.config && state.config.workspace ? state.config.workspace : t('workFolder');
    $('#workspace-root-label').textContent = basename(rootLabel);
    renderWorkspaceBreadcrumb();
    if (!data.files.length) {
      list.innerHTML = `<div class="file-empty">${escapeHtml(t('folderEmpty'))}</div>`;
      return;
    }
    list.innerHTML = data.files.map((entry) => {
      const full = workspacePath ? `${workspacePath}/${entry.name}` : entry.name;
      const folder = entry.type === 'directory';
      return `<button class="workspace-file${full === selectedWorkspaceFile ? ' selected' : ''}" data-file-path="${escapeHtml(full)}" data-file-type="${entry.type}">
        <span class="file-icon ${folder ? 'folder' : fileKind(entry.name)}">${folder ? ICONS.folder : ICONS.file}</span><span class="file-name" dir="auto">${escapeHtml(entry.name)}</span>${folder ? '<span class="file-arrow">›</span>' : ''}
      </button>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="file-error">${escapeHtml(err.message)}<button class="link-btn" id="retry-files">${escapeHtml(t('retry'))}</button></div>`;
    const retry = $('#retry-files');
    if (retry) retry.addEventListener('click', () => loadWorkspaceFiles(workspacePath));
    if (preview) preview.innerHTML = `<div class="preview-empty"><span class="preview-glyph">⌁</span><b>${escapeHtml(t('workspaceOpenError'))}</b><span>${escapeHtml(t('workspaceOpenErrorHint'))}</span></div>`;
  }
}

function fileKind(name) {
  const ext = name.split('.').pop().toLowerCase();
  return ['js', 'ts', 'jsx', 'tsx', 'json', 'css', 'html', 'md', 'py', 'go', 'rs', 'sh'].includes(ext) ? 'code' : 'plain';
}

function renderWorkspaceBreadcrumb() {
  const crumb = $('#workspace-breadcrumb');
  if (!crumb) return;
  const parts = workspacePath ? workspacePath.split('/').filter(Boolean) : [];
  crumb.innerHTML = `<button data-crumb="">${escapeHtml(t('projectRoot'))}</button>${parts.map((part, index) => `<span>/</span><button data-crumb="${escapeHtml(parts.slice(0, index + 1).join('/'))}">${escapeHtml(part)}</button>`).join('')}`;
}

async function openWorkspaceFile(relativePath) {
  const preview = $('#file-preview');
  selectedWorkspaceFile = relativePath;
  $$('.workspace-file').forEach((button) => button.classList.toggle('selected', button.dataset.filePath === relativePath));
  preview.innerHTML = `<div class="file-loading"><span class="loading-ring"></span> ${escapeHtml(t('openingFile'))}</div>`;
  try {
    const data = await api('GET', `/api/workspace/file?path=${encodeURIComponent(relativePath)}`);
    const name = basename(data.path);
    const lines = data.content.split('\n');
    preview.innerHTML = `<div class="preview-head"><span title="${escapeHtml(data.path)}">${escapeHtml(name)}</span><button class="mini-btn" id="copy-preview" title="${escapeHtml(t('copyContent'))}" aria-label="${escapeHtml(t('copyContent'))}">${ICONS.copy}</button></div><pre class="preview-code" dir="ltr"><code>${lines.map((line, index) => `<span class="source-line"><i>${index + 1}</i>${escapeHtml(line) || ' '}</span>`).join('')}</code></pre>`;
    $('#copy-preview').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(data.content); toast(t('fileCopied'), 'success', 1800); }
      catch { toast(t('browserCopyFailed'), 'error'); }
    });
  } catch (err) {
    preview.innerHTML = `<div class="preview-empty"><span class="preview-glyph">⌁</span><b>${escapeHtml(t('noPreviewAvailable'))}</b><span>${escapeHtml(err.message)}</span></div>`;
  }
}

function openCommandPalette() {
  const backdrop = $('#command-backdrop');
  backdrop.hidden = false;
  $('#command-search').value = '';
  renderCommands();
  $('#command-search').focus();
}

function closeCommandPalette() { $('#command-backdrop').hidden = true; }

function renderCommands() {
  const query = ($('#command-search').value || '').trim().toLowerCase();
  const actions = getQuickActions().filter((action) => `${action.title} ${action.detail}`.toLowerCase().includes(query));
  commandIndex = Math.min(commandIndex, Math.max(0, actions.length - 1));
  $('#command-list').innerHTML = actions.length ? actions.map((action, index) => `<button class="command-item${index === commandIndex ? ' active' : ''}" data-command-index="${index}"><span class="command-icon">${action.icon}</span><span class="command-copy"><b>${escapeHtml(action.title)}</b><small>${escapeHtml(action.detail)}</small></span>${action.keys ? `<kbd>${escapeHtml(action.keys)}</kbd>` : ''}</button>`).join('') : `<div class="command-empty">${escapeHtml(t('noMatchingActions'))}</div>`;
  $('#command-list').querySelectorAll('.command-item').forEach((button) => button.addEventListener('click', () => runCommand(actions[Number(button.dataset.commandIndex)])));
}

function runCommand(action) {
  if (!action) return;
  closeCommandPalette();
  action.run();
}

function bindWorkspaceEvents() {
  $('#command-open').addEventListener('click', openCommandPalette);
  $('#workspace-toggle').addEventListener('click', () => toggleWorkspace());
  $('#close-workspace').addEventListener('click', () => toggleWorkspace(false));
  $('#refresh-files').addEventListener('click', () => loadWorkspaceFiles(workspacePath));
  $('#workspace-settings').addEventListener('click', () => openSettings());
  $('#workspace-breadcrumb').addEventListener('click', (event) => {
    const button = event.target.closest('[data-crumb]');
    if (button) loadWorkspaceFiles(button.dataset.crumb);
  });
  $('#workspace-filelist').addEventListener('click', (event) => {
    const button = event.target.closest('.workspace-file');
    if (!button) return;
    if (button.dataset.fileType === 'directory') loadWorkspaceFiles(button.dataset.filePath);
    else openWorkspaceFile(button.dataset.filePath);
  });
  $('#command-search').addEventListener('input', () => { commandIndex = 0; renderCommands(); });
  $('#command-search').addEventListener('keydown', (event) => {
    const items = $$('.command-item', $('#command-list'));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      commandIndex = (commandIndex + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
      renderCommands();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const query = ($('#command-search').value || '').trim().toLowerCase();
      const actions = getQuickActions().filter((action) => `${action.title} ${action.detail}`.toLowerCase().includes(query));
      runCommand(actions[commandIndex]);
    }
  });
  $('#command-backdrop').addEventListener('click', (event) => { if (event.target.id === 'command-backdrop') closeCommandPalette(); });

  const sessionSearch = $('#session-search');
  sessionSearch.addEventListener('input', renderSessions);
  sessionSearch.addEventListener('keydown', (event) => { if (event.key === 'Escape') { sessionSearch.value = ''; renderSessions(); sessionSearch.blur(); } });
  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); openCommandPalette(); }
    else if (mod && event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); openModelPopover(); }
    else if (event.key === 'Escape' && !$('#command-backdrop').hidden) closeCommandPalette();
    else if (event.key === '/' && !isTypingTarget(event.target) && !mod) { event.preventDefault(); sessionSearch.focus(); }
  });
}

bindWorkspaceEvents();
