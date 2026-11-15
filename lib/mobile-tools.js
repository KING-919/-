'use strict';

const { execFile } = require('child_process');

const PHONE_TOOL_NAMES = new Set([
  'phone_screen',
  'phone_tap',
  'phone_swipe',
  'phone_type',
  'phone_key',
  'phone_app'
]);

const VALID_KEYS = new Set([
  'home',
  'back',
  'recents',
  'notifications',
  'quick_settings',
  'lock',
  'power',
  'enter',
  'volume_up',
  'volume_down'
]);

const KEYCODE_MAP = {
  home: 3,
  back: 4,
  recents: 187,
  notifications: 83,
  quick_settings: 83,
  lock: 26,
  power: 26,
  enter: 66,
  volume_up: 24,
  volume_down: 25
};

const PHONE_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'phone_screen',
      description:
        'Inspect the Android phone screen: returns foreground package/activity, screen dimensions, and indexed visible/clickable/editable UI nodes with text, id, and [x, y] center coordinates.',
      parameters: {
        type: 'object',
        properties: {
          include_non_clickable: {
            type: 'boolean',
            description: 'Include non-clickable text nodes as well (default false, keeps output compact).'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'phone_tap',
      description:
        'Tap on the Android phone screen by exact [x, y] coordinates OR by matching visible text/resource id from phone_screen.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate in screen pixels.' },
          y: { type: 'number', description: 'Y coordinate in screen pixels.' },
          text: { type: 'string', description: 'Visible label or content-description of the element to tap.' },
          id: { type: 'string', description: 'Android resource ID substring (e.g. "send_btn").' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'phone_swipe',
      description:
        'Swipe or scroll on the Android phone screen using a direction ("up", "down", "left", "right") or explicit coordinates.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down', 'left', 'right'],
            description: 'Swipe direction (e.g. "up" scrolls down the list).'
          },
          x1: { type: 'number' },
          y1: { type: 'number' },
          x2: { type: 'number' },
          y2: { type: 'number' },
          duration_ms: { type: 'integer', description: 'Gesture duration in milliseconds (default 350).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'phone_type',
      description:
        'Type text into the currently focused phone input (or optionally find & focus an input by target text/id first).',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type into the phone.' },
          target_text: { type: 'string', description: 'Optional label/hint of input field to focus before typing.' },
          target_id: { type: 'string', description: 'Optional resource ID of input field to focus before typing.' },
          press_enter: { type: 'boolean', description: 'Press Enter/Send after typing (default false).' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'phone_key',
      description: 'Press an Android system or navigation key.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            enum: [
              'home', 'back', 'recents', 'notifications',
              'quick_settings', 'lock', 'power', 'enter',
              'volume_up', 'volume_down'
            ],
            description: 'System key to press.'
          }
        },
        required: ['key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'phone_app',
      description:
        'Manage Android phone apps and info: list installed apps, open an app by package name or search query, or read device status (battery, model, screen size).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'open', 'device_info'],
            description: '"list" shows launchable apps, "open" launches an app, "device_info" returns device status.'
          },
          app: {
            type: 'string',
            description: 'Package name (e.g. "com.whatsapp") or app name query (e.g. "WhatsApp" / "Settings") when action is "open".'
          }
        },
        required: ['action']
      }
    }
  }
];

function normalizeMobileConfig(input = {}) {
  const modeRaw = String(input.mobileMode || 'auto').trim().toLowerCase();
  const mobileMode = ['auto', 'bridge', 'adb', 'off'].includes(modeRaw) ? modeRaw : 'auto';

  let mobileBridgeUrl = String(input.mobileBridgeUrl || 'http://127.0.0.1:8765').trim().replace(/\/+$/, '');
  if (!mobileBridgeUrl) mobileBridgeUrl = 'http://127.0.0.1:8765';
  if (!/^https?:\/\//i.test(mobileBridgeUrl)) mobileBridgeUrl = 'http://' + mobileBridgeUrl;

  const mobileToken = String(input.mobileToken || '').trim();
  const adbSerial = String(input.adbSerial || '').trim();
  const autoPhone = !!input.autoPhone;

  return {
    mobileMode,
    mobileBridgeUrl,
    mobileToken,
    adbSerial,
    autoPhone
  };
}

function isPhoneMutatingTool(name, args = {}) {
  if (!PHONE_TOOL_NAMES.has(name)) return false;
  if (name === 'phone_screen') return false;
  if (name === 'phone_app') {
    const action = String((args && args.action) || 'list').toLowerCase();
    return action === 'open';
  }
  return true;
}

function decodeXmlAttr(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function parseBounds(boundsStr) {
  const match = String(boundsStr || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  return {
    left,
    top,
    right,
    bottom,
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2),
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function parseAndroidUiXml(xml, options = {}) {
  const includeNonClickable = !!options.includeNonClickable;
  const maxNodes = Number(options.maxNodes) || 100;
  const nodes = [];
  const tagRegex = /<node\b([^>]*?)\/?\s*>/g;
  let match;

  while ((match = tagRegex.exec(String(xml || ''))) !== null) {
    const attrBlob = match[1];
    const attrs = {};
    const attrRegex = /([\w:-]+)="([^"]*)"/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrBlob)) !== null) {
      attrs[attrMatch[1]] = decodeXmlAttr(attrMatch[2]);
    }

    const bounds = parseBounds(attrs.bounds);
    if (!bounds || bounds.width === 0 || bounds.height === 0) continue;

    const text = (attrs.text || '').trim();
    const desc = (attrs['content-desc'] || '').trim();
    const id = (attrs['resource-id'] || '').replace(/^[^/]+\//, '').trim();
    const clickable = attrs.clickable === 'true';
    const editable = attrs.class && /EditText|AutoCompleteTextView/i.test(attrs.class);
    const scrollable = attrs.scrollable === 'true';
    const focused = attrs.focused === 'true';
    const enabled = attrs.enabled !== 'false';

    if (!includeNonClickable && !clickable && !editable && !text && !desc) continue;
    if (!includeNonClickable && !clickable && !editable && !scrollable && !text && !desc) continue;

    nodes.push({
      index: nodes.length,
      text,
      desc,
      id,
      className: (attrs.class || '').split('.').pop() || '',
      packageName: attrs.package || '',
      clickable,
      editable: !!editable,
      scrollable,
      focused,
      enabled,
      bounds: [bounds.left, bounds.top, bounds.right, bounds.bottom],
      x: bounds.centerX,
      y: bounds.centerY
    });

    if (nodes.length >= maxNodes) break;
  }

  return nodes;
}

function parseAdbDevices(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).slice(1);
  const devices = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1] || 'unknown';
    const modelMatch = line.match(/\bmodel:([^\s]+)/);
    devices.push({
      serial,
      state,
      ready: state === 'device',
      model: modelMatch ? modelMatch[1].replace(/_/g, ' ') : ''
    });
  }
  return devices;
}

function resolveSwipeCoordinates(args = {}, screen = { width: 1080, height: 2400 }) {
  const w = Math.max(200, Number(screen.width) || 1080);
  const h = Math.max(300, Number(screen.height) || 2400);
  const duration = Math.min(3000, Math.max(80, parseInt(args.duration_ms, 10) || 350));

  if ([args.x1, args.y1, args.x2, args.y2].every((n) => Number.isFinite(Number(n)))) {
    return {
      x1: Math.round(Number(args.x1)),
      y1: Math.round(Number(args.y1)),
      x2: Math.round(Number(args.x2)),
      y2: Math.round(Number(args.y2)),
      durationMs: duration
    };
  }

  const dir = String(args.direction || 'up').toLowerCase();
  const cx = Math.round(w * 0.5);
  const cy = Math.round(h * 0.5);
  switch (dir) {
    case 'down':
      return { x1: cx, y1: Math.round(h * 0.28), x2: cx, y2: Math.round(h * 0.78), durationMs: duration };
    case 'left':
      return { x1: Math.round(w * 0.82), y1: cy, x2: Math.round(w * 0.18), y2: cy, durationMs: duration };
    case 'right':
      return { x1: Math.round(w * 0.18), y1: cy, x2: Math.round(w * 0.82), y2: cy, durationMs: duration };
    case 'up':
    default:
      return { x1: cx, y1: Math.round(h * 0.78), x2: cx, y2: Math.round(h * 0.28), durationMs: duration };
  }
}

function findNodeMatch(nodes, { text, id }) {
  const needleText = String(text || '').trim().toLowerCase();
  const needleId = String(id || '').trim().toLowerCase();
  if (!needleText && !needleId) return null;

  return (nodes || []).find((node) => {
    const nText = String(node.text || '').toLowerCase();
    const nDesc = String(node.desc || '').toLowerCase();
    const nId = String(node.id || '').toLowerCase();
    if (needleId && nId.includes(needleId)) return true;
    if (needleText && (nText.includes(needleText) || nDesc.includes(needleText))) return true;
    return false;
  }) || null;
}

function buildPhoneApprovalSummary(name, args = {}, lang = 'ar') {
  const isEn = lang === 'en';
  switch (name) {
    case 'phone_tap':
      return {
        action: isEn ? 'Tap phone screen' : 'الضغط على شاشة الجوال',
        detail: args.text
          ? `"${args.text}"`
          : args.id
            ? `#${args.id}`
            : `(${args.x}, ${args.y})`
      };
    case 'phone_swipe':
      return {
        action: isEn ? 'Swipe phone screen' : 'التمرير على شاشة الجوال',
        detail: args.direction
          ? String(args.direction)
          : `(${args.x1}, ${args.y1}) -> (${args.x2}, ${args.y2})`
      };
    case 'phone_type':
      return {
        action: isEn ? 'Type text on phone' : 'كتابة نص على الجوال',
        detail: `"${String(args.text || '').slice(0, 120)}"`
      };
    case 'phone_key':
      return {
        action: isEn ? 'Press phone key' : 'ضغط زر في الجوال',
        detail: String(args.key || '')
      };
    case 'phone_app':
      return {
        action: isEn ? 'Open phone app' : 'فتح تطبيق على الجوال',
        detail: String(args.app || '')
      };
    default:
      return {
        action: isEn ? 'Control mobile device' : 'التحكم بالجوال',
        detail: name
      };
  }
}

async function bridgeFetch(cfg, endpoint, method = 'GET', body = null, timeoutMs = 6000, lang = 'ar') {
  const url = `${cfg.mobileBridgeUrl}${endpoint}`;
  const isEn = lang === 'en';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: 'application/json' };
  if (cfg.mobileToken) {
    headers.Authorization = `Bearer ${cfg.mobileToken}`;
    headers['X-NOVA-Token'] = cfg.mobileToken;
  }
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw new Error(isEn
        ? `Mobile bridge timed out (${cfg.mobileBridgeUrl})`
        : `انتهت مهلة الاتصال بجسر الجوال (${cfg.mobileBridgeUrl})`);
    }
    const causeCode = (err && err.cause && err.cause.code) || (err && err.code) || '';
    if (causeCode === 'ECONNREFUSED') {
      throw new Error(isEn
        ? `Phone bridge not listening at ${cfg.mobileBridgeUrl}`
        : `جسر الجوال غير مشغّل على ${cfg.mobileBridgeUrl}`);
    }
    throw new Error(isEn
      ? `Bridge unreachable (${causeCode || err.message || cfg.mobileBridgeUrl})`
      : `تعذّر الاتصال بجسر الجوال (${causeCode || cfg.mobileBridgeUrl})`);
  }

  try {
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      throw new Error(data.error || `Mobile bridge returned HTTP ${res.status}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function runAdb(args, serial = '', timeoutMs = 12000, lang = 'ar') {
  const fullArgs = serial ? ['-s', serial, ...args] : args;
  const isEn = lang === 'en';
  return new Promise((resolve, reject) => {
    execFile('adb', fullArgs, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const msg = String(stderr || error.message || '').trim();
        if (error.code === 'ENOENT') {
          reject(new Error(isEn
            ? 'ADB is not installed or missing from PATH'
            : 'أداة ADB غير مثبتة على هذا الجهاز'));
        } else {
          reject(new Error(msg || (isEn ? 'ADB command failed' : 'تعذّر تنفيذ أمر ADB')));
        }
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function getMobileStatus(rawConfig = {}, lang = 'ar') {
  const cfg = normalizeMobileConfig(rawConfig);
  const isEn = lang === 'en';
  if (cfg.mobileMode === 'off') {
    return {
      ok: false,
      mode: 'off',
      transport: 'none',
      message: isEn ? 'Mobile control is disabled in settings.' : 'التحكم بالجوال معطّل في الإعدادات.'
    };
  }

  let bridgeError = null;
  if (cfg.mobileMode === 'auto' || cfg.mobileMode === 'bridge') {
    try {
      const status = await bridgeFetch(cfg, '/status', 'GET', null, 3500, lang);
      return {
        ok: true,
        transport: 'bridge',
        bridgeUrl: cfg.mobileBridgeUrl,
        accessibilityEnabled: !!status.accessibilityEnabled,
        device: status.device || status.model || 'Android Device',
        androidVersion: status.androidVersion || '',
        screen: status.screen || null,
        battery: status.battery ?? null
      };
    } catch (err) {
      bridgeError = err.message;
      if (cfg.mobileMode === 'bridge') {
        return { ok: false, transport: 'bridge', bridgeUrl: cfg.mobileBridgeUrl, error: bridgeError };
      }
    }
  }

  if (cfg.mobileMode === 'auto' || cfg.mobileMode === 'adb') {
    try {
      const { stdout } = await runAdb(['devices', '-l'], '', 5000, lang);
      const devices = parseAdbDevices(stdout);
      const chosen = cfg.adbSerial
        ? devices.find((d) => d.serial === cfg.adbSerial && d.ready)
        : devices.find((d) => d.ready);
      if (!chosen) {
        return {
          ok: false,
          transport: 'adb',
          devices,
          error: devices.length
            ? (isEn ? 'Device found but unauthorized — accept USB Debugging prompt on phone.' : 'يوجد جهاز غير جاهز أو يحتاج قبول USB Debugging على شاشة الجوال.')
            : (bridgeError
              ? (isEn ? `${bridgeError} · No ADB device attached` : `${bridgeError} · ولا يوجد جهاز متصل عبر ADB`)
              : (isEn ? 'No Android device detected via ADB.' : 'لم يُعثر على جهاز Android متصل عبر ADB.'))
        };
      }
      return {
        ok: true,
        transport: 'adb',
        serial: chosen.serial,
        device: chosen.model || chosen.serial,
        devices
      };
    } catch (err) {
      return {
        ok: false,
        transport: 'none',
        error: bridgeError ? `${bridgeError} · ${err.message}` : err.message
      };
    }
  }

  return {
    ok: false,
    transport: 'none',
    error: bridgeError || (isEn ? 'No mobile connection available.' : 'لا يوجد اتصال متاح بالجوال.')
  };
}

async function resolveTransport(ctx) {
  const cfg = normalizeMobileConfig(ctx);
  if (cfg.mobileMode === 'off') {
    throw new Error('أدوات التحكم بالجوال معطّلة في الإعدادات (Mobile Agent = Off).');
  }

  if (cfg.mobileMode === 'bridge') {
    return { kind: 'bridge', cfg };
  }
  if (cfg.mobileMode === 'adb') {
    return { kind: 'adb', cfg };
  }

  // auto mode: prefer local/LAN Android Accessibility bridge, fall back to ADB
  try {
    await bridgeFetch(cfg, '/status', 'GET', null, 2500);
    return { kind: 'bridge', cfg };
  } catch (bridgeErr) {
    try {
      const { stdout } = await runAdb(['devices', '-l'], '', 4000);
      const ready = parseAdbDevices(stdout).find((d) => !cfg.adbSerial ? d.ready : (d.serial === cfg.adbSerial && d.ready));
      if (ready) {
        return { kind: 'adb', cfg: { ...cfg, adbSerial: ready.serial } };
      }
      throw new Error(`جسر تطبيق الجوال غير متاح (${bridgeErr.message}) ولا يوجد جهاز Android جاهز عبر ADB.`);
    } catch (adbErr) {
      throw new Error(`الجوال غير متصل: ثبّت تطبيق NOVA على الجوال وفعّل الجسر (${cfg.mobileBridgeUrl}) أو وصّل الجوال عبر USB ADB. (${adbErr.message})`);
    }
  }
}

async function adbScreenSize(serial) {
  try {
    const { stdout } = await runAdb(['shell', 'wm', 'size'], serial, 4000);
    const match = stdout.match(/(\d+)x(\d+)/);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
  } catch {
    // fallback
  }
  return { width: 1080, height: 2400 };
}

async function adbDumpScreen(serial, includeNonClickable) {
  await runAdb(['shell', 'uiautomator', 'dump', '/sdcard/nova_ui.xml'], serial, 10000);
  const { stdout: xml } = await runAdb(['shell', 'cat', '/sdcard/nova_ui.xml'], serial, 8000);
  const { stdout: focusOut } = await runAdb(['shell', 'dumpsys', 'window', 'windows'], serial, 5000).catch(() => ({ stdout: '' }));
  const focusMatch = focusOut.match(/mCurrentFocus=.*?\s([^\s/}]+)\/([^\s}]+)/);
  const screen = await adbScreenSize(serial);
  const nodes = parseAndroidUiXml(xml, { includeNonClickable });
  return {
    ok: true,
    transport: 'adb',
    packageName: focusMatch ? focusMatch[1] : '',
    activity: focusMatch ? focusMatch[2] : '',
    screen,
    count: nodes.length,
    nodes
  };
}

async function executePhoneTool(name, args = {}, ctx = {}) {
  const { kind, cfg } = await resolveTransport(ctx);

  if (kind === 'bridge') {
    switch (name) {
      case 'phone_screen':
        return bridgeFetch(cfg, `/screen?all=${args.include_non_clickable ? '1' : '0'}`, 'GET');
      case 'phone_tap':
        return bridgeFetch(cfg, '/tap', 'POST', {
          x: args.x,
          y: args.y,
          text: args.text || '',
          id: args.id || ''
        });
      case 'phone_swipe':
        return bridgeFetch(cfg, '/swipe', 'POST', resolveSwipeCoordinates(args));
      case 'phone_type':
        return bridgeFetch(cfg, '/type', 'POST', {
          text: String(args.text || ''),
          targetText: args.target_text || '',
          targetId: args.target_id || '',
          pressEnter: !!args.press_enter
        });
      case 'phone_key': {
        const key = String(args.key || '').toLowerCase();
        if (!VALID_KEYS.has(key)) throw new Error(`مفتاح غير مدعوم: ${key}`);
        return bridgeFetch(cfg, '/key', 'POST', { key });
      }
      case 'phone_app': {
        const action = String(args.action || 'list').toLowerCase();
        if (action === 'list') return bridgeFetch(cfg, '/apps', 'GET');
        if (action === 'device_info') return bridgeFetch(cfg, '/device', 'GET');
        if (action === 'open') {
          if (!args.app) throw new Error('اسم التطبيق أو الحزمة مطلوب.');
          return bridgeFetch(cfg, '/open', 'POST', { app: String(args.app) });
        }
        throw new Error(`إجراء غير مدعوم: ${action}`);
      }
      default:
        throw new Error(`أداة جوال غير معروفة: ${name}`);
    }
  }

  // ADB transport fallback
  const serial = cfg.adbSerial;
  switch (name) {
    case 'phone_screen':
      return adbDumpScreen(serial, !!args.include_non_clickable);

    case 'phone_tap': {
      let x = Number(args.x);
      let y = Number(args.y);
      let matched = null;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const screen = await adbDumpScreen(serial, true);
        matched = findNodeMatch(screen.nodes, { text: args.text, id: args.id });
        if (!matched) {
          throw new Error(`لم يُعثر على عنصر يطابق "${args.text || args.id || ''}" على الشاشة.`);
        }
        x = matched.x;
        y = matched.y;
      }
      await runAdb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))], serial);
      return { ok: true, transport: 'adb', tapped: { x: Math.round(x), y: Math.round(y), matched: matched ? (matched.text || matched.desc || matched.id) : null } };
    }

    case 'phone_swipe': {
      const size = await adbScreenSize(serial);
      const s = resolveSwipeCoordinates(args, size);
      await runAdb(['shell', 'input', 'swipe', String(s.x1), String(s.y1), String(s.x2), String(s.y2), String(s.durationMs)], serial);
      return { ok: true, transport: 'adb', swipe: s };
    }

    case 'phone_type': {
      const text = String(args.text || '');
      if (!text) throw new Error('النص مطلوب.');
      if (args.target_text || args.target_id) {
        const screen = await adbDumpScreen(serial, true);
        const target = findNodeMatch(screen.nodes, { text: args.target_text, id: args.target_id });
        if (target) {
          await runAdb(['shell', 'input', 'tap', String(target.x), String(target.y)], serial);
        }
      }
      // Escape shell characters for ADB input text
      const escaped = text.replace(/([\\"`$&|;<>()'*?!~])/g, '\\$1').replace(/ /g, '%s');
      await runAdb(['shell', 'input', 'text', escaped], serial);
      if (args.press_enter) {
        await runAdb(['shell', 'input', 'keyevent', '66'], serial);
      }
      return { ok: true, transport: 'adb', typedLength: text.length, pressEnter: !!args.press_enter };
    }

    case 'phone_key': {
      const key = String(args.key || '').toLowerCase();
      if (!VALID_KEYS.has(key)) throw new Error(`مفتاح غير مدعوم: ${key}`);
      if (key === 'notifications') {
        await runAdb(['shell', 'cmd', 'statusbar', 'expand-notifications'], serial);
      } else if (key === 'quick_settings') {
        await runAdb(['shell', 'cmd', 'statusbar', 'expand-settings'], serial);
      } else {
        await runAdb(['shell', 'input', 'keyevent', String(KEYCODE_MAP[key])], serial);
      }
      return { ok: true, transport: 'adb', key };
    }

    case 'phone_app': {
      const action = String(args.action || 'list').toLowerCase();
      if (action === 'list') {
        const { stdout } = await runAdb(['shell', 'pm', 'list', 'packages', '-3'], serial, 10000);
        const packages = stdout.split(/\r?\n/)
          .map((l) => l.replace(/^package:/, '').trim())
          .filter(Boolean)
          .slice(0, 120)
          .map((pkg) => ({ packageName: pkg, name: pkg.split('.').pop() }));
        return { ok: true, transport: 'adb', count: packages.length, apps: packages };
      }
      if (action === 'device_info') {
        const [{ stdout: model }, { stdout: release }, { stdout: battery }, screen] = await Promise.all([
          runAdb(['shell', 'getprop', 'ro.product.model'], serial).catch(() => ({ stdout: '' })),
          runAdb(['shell', 'getprop', 'ro.build.version.release'], serial).catch(() => ({ stdout: '' })),
          runAdb(['shell', 'dumpsys', 'battery'], serial).catch(() => ({ stdout: '' })),
          adbScreenSize(serial)
        ]);
        const levelMatch = battery.match(/level:\s*(\d+)/);
        return {
          ok: true,
          transport: 'adb',
          model: model.trim(),
          androidVersion: release.trim(),
          battery: levelMatch ? Number(levelMatch[1]) : null,
          screen
        };
      }
      if (action === 'open') {
        const query = String(args.app || '').trim();
        if (!query) throw new Error('اسم التطبيق أو الحزمة مطلوب.');
        let pkg = query;
        if (!query.includes('.')) {
          const { stdout } = await runAdb(['shell', 'pm', 'list', 'packages'], serial, 8000);
          const all = stdout.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean);
          const found = all.find((p) => p.toLowerCase().includes(query.toLowerCase()));
          if (!found) throw new Error(`لم يُعثر على تطبيق يطابق "${query}".`);
          pkg = found;
        }
        await runAdb(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], serial);
        return { ok: true, transport: 'adb', opened: pkg };
      }
      throw new Error(`إجراء غير مدعوم: ${action}`);
    }

    default:
      throw new Error(`أداة جوال غير معروفة: ${name}`);
  }
}

module.exports = {
  PHONE_TOOL_DEFS,
  PHONE_TOOL_NAMES,
  VALID_KEYS,
  normalizeMobileConfig,
  isPhoneMutatingTool,
  parseBounds,
  parseAndroidUiXml,
  parseAdbDevices,
  resolveSwipeCoordinates,
  findNodeMatch,
  buildPhoneApprovalSummary,
  getMobileStatus,
  executePhoneTool
};
