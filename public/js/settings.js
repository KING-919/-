'use strict';

/* ============================================================
   NOVA — settings, connection, run mode
   ============================================================ */

function getModeInfo(mode) {
  const map = {
    ask: {
      label: t('modeAskTitle'),
      hint: t('modeAskDesc'),
      toast: t('modeAskToast')
    },
    auto: {
      label: t('modeAutoTitle'),
      hint: t('modeAutoDesc'),
      toast: t('modeAutoToast')
    },
    plan: {
      label: t('modePlanTitle'),
      hint: t('modePlanDesc'),
      toast: t('modePlanToast')
    }
  };
  return map[mode] || map.ask;
}

function updateModeUI() {
  const info = getModeInfo(state.mode);

  const label = $('#mode-label');
  if (label) label.textContent = info.label;

  const chip = $('#mode-chip');
  if (chip) chip.title = `${t('runModeTitle')}: ${info.label} — ${info.hint}`;

  $$('#mode-popover .mode-option').forEach((option) => {
    option.classList.toggle('active', option.dataset.mode === state.mode);
  });
}

function hideModeMenu() {
  const pop = $('#mode-popover');
  if (pop) pop.hidden = true;
}

function openModeMenu() {
  const pop = $('#mode-popover');
  if (!pop) return;
  pop.hidden = false;
  updateModeUI();
}

async function setMode(mode) {
  if (!['ask', 'auto', 'plan'].includes(mode)) return;

  state.mode = mode;
  localStorage.setItem('nova.mode', mode);
  updateModeUI();
  hideModeMenu();

  if (state.session) {
    try {
      const data = await api('PATCH', `/api/sessions/${state.session.id}`, { mode });
      state.session.mode = data.session.mode;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  toast(getModeInfo(mode).toast, 'info', 3000);
}

/* ---------------- Settings modal ---------------- */

const PROVIDER_LABELS = {
  lmstudio: 'LM Studio',
  freellmapi: 'FreeLLMAPI',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  gemini: 'Google Gemini',
  ollama: 'Ollama',
  'openai-compatible': 'OpenAI-compatible'
};

function setSettingsTab(name = 'connection') {
  const tab = typeof name === 'string' ? name : 'connection';
  $$('.settings-tab').forEach((button) => {
    const active = button.dataset.settingsTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('[data-settings-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== tab;
  });
}

function updateSettingsSummary() {
  const provider = $('#set-provider');
  const providerName = PROVIDER_LABELS[(provider && provider.value) || (state.config && state.config.provider)] || t('providerCustom');
  const label = $('#settings-provider-name');
  if (label) label.textContent = providerName;

  const dot = $('#settings-status-dot');
  if (dot) dot.className = 'status-dot ' + (state.connected ? 'online' : 'offline');

  const title = $('#settings-status-text');
  const meta = $('#settings-status-meta');
  if (title) {
    title.textContent = state.connected
      ? (state.models.length ? t('connectedReady') : t('connectedNoModels'))
      : t('disconnected');
  }
  if (meta) {
    meta.textContent = state.connected
      ? `${modelsPhrase(state.models.length, 'available')} · ${providerName}`
      : t('settingsMetaDisconnected');
  }
}

function fillSettingsForm() {
  const config = state.config || {};

  const provider = $('#set-provider');
  if (provider) provider.value = config.provider || 'lmstudio';

  const base = $('#set-base');
  if (base) base.value = config.baseUrl || '';
  updateProviderHint();

  const key = $('#set-key');
  if (key) {
    key.value = '';
    key.type = 'password';
    key.placeholder = config.hasKey
      ? t('apiKeyPlaceholderSaved')
      : t('apiKeyPlaceholderEmpty');
  }
  const keyToggle = $('#toggle-key');
  if (keyToggle) {
    keyToggle.classList.remove('active');
    keyToggle.title = t('showKey');
    keyToggle.setAttribute('aria-label', t('showKeyAria'));
  }

  const workspace = $('#set-workspace');
  if (workspace) workspace.value = config.workspace || '';

  const outside = $('#set-outside');
  if (outside) outside.checked = !!config.allowOutsideWorkspace;

  const langSelect = $('#set-lang');
  if (langSelect) langSelect.value = currentLang();

  const temp = $('#set-temp');
  if (temp) temp.value = config.temperature != null ? config.temperature : 0.7;

  const tempVal = $('#temp-val');
  if (tempVal) tempVal.textContent = Number(temp ? temp.value : 0.7).toFixed(1);

  const steps = $('#set-steps');
  if (steps) steps.value = config.maxSteps || 30;

  const timeout = $('#set-timeout');
  if (timeout) timeout.value = Math.round((config.shellTimeoutMs || 90000) / 1000);

  const autoshell = $('#set-autoshell');
  if (autoshell) autoshell.checked = !!config.autoShell;

  const mobileMode = $('#set-mobile-mode');
  if (mobileMode) mobileMode.value = config.mobileMode || 'auto';

  const mobileBridge = $('#set-mobile-bridge');
  if (mobileBridge) mobileBridge.value = config.mobileBridgeUrl || 'http://127.0.0.1:8765';

  const mobileToken = $('#set-mobile-token');
  if (mobileToken) {
    mobileToken.value = '';
    mobileToken.placeholder = config.hasMobileToken
      ? t('mobileTokenPlaceholderSaved')
      : t('mobileTokenPlaceholderEmpty');
  }

  const adbSerial = $('#set-adb-serial');
  if (adbSerial) adbSerial.value = config.adbSerial || '';

  const autoPhone = $('#set-autophone');
  if (autoPhone) autoPhone.checked = !!config.autoPhone;

  const mobileResult = $('#mobile-test-result');
  if (mobileResult) {
    mobileResult.textContent = '';
    mobileResult.className = 'test-result';
  }

  const result = $('#test-result');
  if (result) {
    result.textContent = '';
    result.className = 'test-result';
  }

  state.keyCleared = false;
  updateSettingsSummary();
  updateModeUI();
  refreshMobileStatus();
}

async function openSettings(tab = 'connection') {
  try {
    state.config = await api('GET', '/api/config');
  } catch {
    // use the cached config
  }

  fillSettingsForm();

  const modal = $('#settings-modal');
  if (!modal) return;
  setSettingsTab(tab);
  modal.hidden = false;

  setTimeout(() => {
    const target = tab === 'connection' ? $('#set-base') : null;
    if (target) target.focus();
  }, 60);
}

function closeSettings() {
  const modal = $('#settings-modal');
  if (modal) modal.hidden = true;
  state.keyCleared = false;
}

async function saveSettings() {
  const button = $('#save-settings');
  if (!button) return;

  button.disabled = true;
  button.textContent = t('saving');

  try {
    const patch = {
      provider: $('#set-provider').value,
      baseUrl: ($('#set-base').value || '').trim(),
      workspace: ($('#set-workspace').value || '').trim(),
      temperature: Number($('#set-temp').value),
      maxSteps: Number($('#set-steps').value),
      shellTimeoutMs: Math.round(Number($('#set-timeout').value) * 1000),
      allowOutsideWorkspace: $('#set-outside').checked,
      autoShell: $('#set-autoshell').checked,
      mobileMode: $('#set-mobile-mode') ? $('#set-mobile-mode').value : 'auto',
      mobileBridgeUrl: $('#set-mobile-bridge') ? ($('#set-mobile-bridge').value || '').trim() : 'http://127.0.0.1:8765',
      adbSerial: $('#set-adb-serial') ? ($('#set-adb-serial').value || '').trim() : '',
      autoPhone: $('#set-autophone') ? $('#set-autophone').checked : false
    };

    const typedMobileToken = $('#set-mobile-token') ? ($('#set-mobile-token').value || '').trim() : '';
    if (typedMobileToken) patch.mobileToken = typedMobileToken;

    if (state.keyCleared) {
      patch.apiKey = '';
    } else {
      const typedKey = ($('#set-key').value || '').trim();
      if (typedKey) patch.apiKey = typedKey;
    }

    const langSelect = $('#set-lang');
    const chosenLang = langSelect ? langSelect.value : currentLang();

    state.config = await api('POST', '/api/config', patch);
    if (chosenLang && chosenLang !== currentLang()) {
      applyLanguage(chosenLang);
    }
    updateWorkspaceUI();
    updateModeUI();
    closeSettings();
    toast(t('settingsSaved'), 'success');

    await loadModels();
    if ($('#welcome-connect')) updateWelcomeState();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = t('saveChanges');
  }
}

async function testConnection() {
  const button = $('#test-conn');
  const result = $('#test-result');
  if (!button || !result) return;

  const btnLabel = button.querySelector('span');
  button.disabled = true;
  if (btnLabel) btnLabel.textContent = t('testing');
  result.className = 'test-result';
  result.textContent = t('testing');

  try {
    const payload = {
      baseUrl: ($('#set-base').value || '').trim(),
      provider: $('#set-provider').value
    };

    if (state.keyCleared) {
      payload.apiKey = '';
    } else {
      const typedKey = ($('#set-key').value || '').trim();
      if (typedKey) payload.apiKey = typedKey;
    }

    const data = await api('POST', '/api/test-connection', payload);

    if (data.ok) {
      const count = Number(data.count) || 0;
      result.classList.add('ok');
      result.textContent = count
        ? t('connectedToast', { models: modelsPhrase(count, 'available') })
        : t('connectedNoModels');
      const dot = $('#settings-status-dot');
      if (dot) dot.className = 'status-dot online';
      const title = $('#settings-status-text');
      if (title) title.textContent = count ? t('connectedReady') : t('connectedNoModels');
      const meta = $('#settings-status-meta');
      if (meta) meta.textContent = count ? `${modelsPhrase(count, 'available')} · ${PROVIDER_LABELS[payload.provider] || t('providerCustom')}` : t('loadModelRetry');
    } else {
      result.classList.add('bad');
      result.textContent = data.error || t('connectionFailedServer');
      const dot = $('#settings-status-dot');
      if (dot) dot.className = 'status-dot offline';
      const title = $('#settings-status-text');
      if (title) title.textContent = t('connectionFailed');
    }
  } catch (err) {
    result.classList.add('bad');
    result.textContent = err.message;
  } finally {
    button.disabled = false;
    if (btnLabel) btnLabel.textContent = t('testConnection');
  }
}

function updateMobileSummaryUI(status, modeOverride) {
  if (status) state.mobileStatus = status;
  const effectiveStatus = status || state.mobileStatus || null;
  const dot = $('#mobile-status-dot');
  const title = $('#mobile-status-text');
  const meta = $('#mobile-status-meta');
  const badge = $('#mobile-transport-badge');
  const mode = modeOverride || ($('#set-mobile-mode') && $('#set-mobile-mode').value) || 'auto';

  if (badge) {
    badge.textContent = effectiveStatus && effectiveStatus.ok
      ? String(effectiveStatus.transport || mode).toUpperCase()
      : String(mode).toUpperCase();
  }

  if (!dot || !title || !meta) return;

  if (mode === 'off') {
    dot.className = 'status-dot offline';
    title.textContent = t('mobileOffTitle');
    meta.textContent = t('mobileCheckingMeta');
    return;
  }

  if (effectiveStatus && effectiveStatus.ok) {
    dot.className = 'status-dot online';
    title.textContent = effectiveStatus.device || 'Android';
    meta.textContent = t('mobileConnectedMeta', {
      transport: String(effectiveStatus.transport || '').toUpperCase(),
      device: effectiveStatus.androidVersion ? `Android ${effectiveStatus.androidVersion}` : (effectiveStatus.bridgeUrl || effectiveStatus.serial || 'ready')
    });
  } else if (effectiveStatus) {
    dot.className = 'status-dot offline';
    title.textContent = t('mobileDisconnectedTitle');
    meta.textContent = (effectiveStatus.error || effectiveStatus.message) || t('mobileCheckingMeta');
  }
}

async function refreshMobileStatus() {
  try {
    const status = await api('GET', `/api/mobile/status?lang=${encodeURIComponent(currentLang())}`);
    updateMobileSummaryUI(status);
  } catch {
    // non-fatal
  }
}

async function testMobileConnection() {
  const button = $('#test-mobile');
  const result = $('#mobile-test-result');
  if (!button || !result) return;

  const btnLabel = button.querySelector('span');
  button.disabled = true;
  if (btnLabel) btnLabel.textContent = t('testing');
  result.className = 'test-result';
  result.textContent = t('testing');

  try {
    const payload = {
      lang: currentLang(),
      mobileMode: $('#set-mobile-mode').value,
      mobileBridgeUrl: ($('#set-mobile-bridge').value || '').trim(),
      adbSerial: ($('#set-adb-serial').value || '').trim()
    };
    const typedToken = ($('#set-mobile-token').value || '').trim();
    if (typedToken) payload.mobileToken = typedToken;

    const status = await api('POST', '/api/mobile/test', payload);
    updateMobileSummaryUI(status, payload.mobileMode);

    if (status.ok) {
      result.classList.add('ok');
      result.textContent = t('mobileConnectedOk', {
        transport: String(status.transport || '').toUpperCase(),
        device: status.device || 'Android'
      });
    } else {
      result.classList.add('bad');
      result.textContent = status.error || status.message || t('mobileDisconnectedTitle');
    }
  } catch (err) {
    result.classList.add('bad');
    result.textContent = err.message;
  } finally {
    button.disabled = false;
    if (btnLabel) btnLabel.textContent = t('testMobileConn');
  }
}

function bindSettingsEvents() {
  const provider = $('#set-provider');
  if (provider) provider.addEventListener('change', () => {
    const base = $('#set-base');
    const defaults = {
      lmstudio: 'http://127.0.0.1:1234/v1',
      freellmapi: 'http://localhost:3001/v1',
      openai: 'https://api.openai.com/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      groq: 'https://api.groq.com/openai/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
      ollama: 'http://127.0.0.1:11434/v1',
      'openai-compatible': ''
    };
    if (provider.value !== 'openai-compatible') base.value = defaults[provider.value] || '';
    updateProviderHint();
    updateSettingsSummary();
  });

  $$('.settings-tab').forEach((button) => {
    button.addEventListener('click', () => setSettingsTab(button.dataset.settingsTab));
  });

  const keyToggle = $('#toggle-key');
  if (keyToggle) {
    keyToggle.addEventListener('click', () => {
      const key = $('#set-key');
      if (!key) return;
      const show = key.type === 'password';
      key.type = show ? 'text' : 'password';
      key.classList.toggle('localized-ph', show);
      keyToggle.classList.toggle('active', show);
      keyToggle.title = show ? t('hideKey') : t('showKey');
      keyToggle.setAttribute('aria-label', show ? t('hideKeyAria') : t('showKeyAria'));
    });
  }

  const openWorkspace = $('#open-workspace-from-settings');
  if (openWorkspace) {
    openWorkspace.addEventListener('click', () => {
      closeSettings();
      toggleWorkspace(true);
    });
  }

  const modeChip = $('#mode-chip');
  if (modeChip) {
    modeChip.addEventListener('click', (event) => {
      event.stopPropagation();
      const pop = $('#mode-popover');
      if (!pop) return;
      if (pop.hidden) openModeMenu();
      else hideModeMenu();
    });
  }

  $$('#mode-popover .mode-option').forEach((option) => {
    option.addEventListener('click', () => setMode(option.dataset.mode));
  });

  const save = $('#save-settings');
  if (save) save.addEventListener('click', saveSettings);

  const cancel = $('#cancel-settings');
  if (cancel) cancel.addEventListener('click', closeSettings);

  const close = $('#close-settings');
  if (close) close.addEventListener('click', closeSettings);

  const modal = $('#settings-modal');
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeSettings();
    });
  }

  const test = $('#test-conn');
  if (test) test.addEventListener('click', testConnection);

  const testMobile = $('#test-mobile');
  if (testMobile) testMobile.addEventListener('click', testMobileConnection);

  const mobileModeSelect = $('#set-mobile-mode');
  if (mobileModeSelect) {
    mobileModeSelect.addEventListener('change', () => updateMobileSummaryUI(null, mobileModeSelect.value));
  }

  const temp = $('#set-temp');
  if (temp) {
    temp.addEventListener('input', () => {
      const label = $('#temp-val');
      if (label) label.textContent = Number(temp.value).toFixed(1);
    });
  }

  const clearKey = $('#clear-key');
  if (clearKey) {
    clearKey.addEventListener('click', () => {
      const key = $('#set-key');
      if (key) {
        key.value = '';
        key.placeholder = t('apiKeyPlaceholderCleared');
      }
      state.keyCleared = true;
    });
  }
}

function updateProviderHint() {
  const provider = $('#set-provider');
  const hint = $('#provider-hint');
  if (!provider || !hint) return;
  const hints = {
    lmstudio: t('providerHintLmstudio'),
    freellmapi: t('providerHintFreellmapi'),
    openai: t('providerHintOpenai'),
    openrouter: t('providerHintOpenrouter'),
    groq: t('providerHintGroq'),
    gemini: t('providerHintGemini'),
    ollama: t('providerHintOllama'),
    'openai-compatible': t('providerHintCustom')
  };
  hint.textContent = hints[provider.value] || hints['openai-compatible'];

  const baseHint = $('#base-hint');
  if (baseHint) {
    const examples = {
      lmstudio: 'http://127.0.0.1:1234/v1',
      ollama: 'http://127.0.0.1:11434/v1',
      openai: 'https://api.openai.com/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      groq: 'https://api.groq.com/openai/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
      freellmapi: 'http://localhost:3001/v1',
      'openai-compatible': 'https://api.example.com/v1'
    };
    baseHint.textContent = t('baseUrlExample', { url: examples[provider.value] || examples['openai-compatible'] });
  }
}
