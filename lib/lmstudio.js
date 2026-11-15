'use strict';

function authHeaders(apiKey) {
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

async function request(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * List models. Prefer LM Studio's richer /api/v0/models endpoint (gives loaded state),
 * fall back to the OpenAI-compatible /v1/models endpoint.
 */
async function listModels(baseUrl, apiKey, provider = 'lmstudio') {
  const headers = authHeaders(apiKey);

  if (provider === 'lmstudio') {
    try {
      const res = await request(`${baseUrl}/api/v0/models`, { headers }, 4000);
      if (res.ok) {
        const data = await res.json();
        const rows = Array.isArray(data.data) ? data.data : [];
        const models = rows
          .filter((m) => !m.type || m.type !== 'embeddings')
          .map((m) => ({
            id: m.id,
            state: m.state || null,
            arch: m.arch || null,
            type: m.type || null,
            publisher: m.publisher || null,
            context: m.max_context_length || null
          }));
        if (models.length) return models;
      }
    } catch {
      // Use the standard model catalog below.
    }
  }

  const modelsPath = provider === 'gemini' ? '/models' : '/v1/models';
  const res = await request(`${baseUrl}${modelsPath}`, { headers }, 12000);
  if (!res.ok) {
    const body = await safeText(res);
    throw new Error(
      `تعذّر الاتصال بمزوّد API (${res.status}). ${truncate(body, 180)}`
    );
  }

  const data = await res.json();
  const rows = Array.isArray(data.data) ? data.data : [];
  return rows
    .filter((m) => !/embedding/i.test(String(m.id || '')))
    .map((m) => ({
      id: m.id,
      state: null,
      arch: null,
      type: null,
      publisher: null,
      context: null
    }));
}

function friendlyHttpError(status, body) {
  const text = String(body || '');
  const lower = text.toLowerCase();

  if (status === 401 || status === 403) {
    return 'رفض مزوّد API الاتصال. تحقّق من عنوان الخدمة ومفتاح API.';
  }
  if (
    lower.includes('tool') &&
    (lower.includes('support') || lower.includes('does not') || lower.includes('not supported'))
  ) {
    return 'النموذج المحدد لا يدعم استدعاء الأدوات (Tool Calling). جرّب نموذجًا مثل Qwen2.5-Coder أو Llama 3.3 أو GLM.';
  }
  if (lower.includes('not loaded') || lower.includes('no model loaded')) {
    return 'النموذج غير محمّل لدى مزوّد API. تحقّق من معرّف النموذج أو حمّله لدى المزوّد.';
  }
  if (status === 404) {
    return 'مسار API غير موجود. تأكد من عنوان /v1 للخدمة ومن دعمها للمحادثات المتوافقة مع OpenAI.';
  }
  return `فشل استدعاء النموذج (${status}): ${truncate(text, 300)}`;
}

/**
 * Stream a chat completion and normalize deltas into callbacks.
 * Returns { content, reasoning, toolCalls, usage }.
 */
async function streamChat({
  baseUrl,
  apiKey,
  provider = 'lmstudio',
  model,
  messages,
  tools,
  temperature = 0.7,
  signal,
  onDelta,
  onReasoning
}) {
  const body = {
    model,
    messages,
    temperature,
    stream: true
  };

  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const chatPath = provider === 'gemini' ? '/chat/completions' : '/v1/chat/completions';
  const res = await fetch(`${baseUrl}${chatPath}`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(apiKey)
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(friendlyHttpError(res.status, text));
  }
  if (!res.body) throw new Error('الخادم لم يُرجع بثًا صالحًا.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let content = '';
  let reasoning = '';
  let usage = null;
  const calls = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);

      if (!line || line.startsWith(':')) continue;
      if (!line.startsWith('data:')) continue;

      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;

      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }

      if (json.usage) usage = json.usage;

      const choice = json.choices && json.choices[0];
      if (!choice) continue;

      const delta = choice.delta || {};

      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        if (onDelta) onDelta(delta.content);
      }

      const thought = delta.reasoning_content || delta.reasoning;
      if (typeof thought === 'string' && thought) {
        reasoning += thought;
        if (onReasoning) onReasoning(thought);
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const index = typeof tc.index === 'number' ? tc.index : calls.length;
          if (!calls[index]) {
            calls[index] = {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' }
            };
          }
          if (tc.id) calls[index].id = tc.id;
          if (tc.function) {
            if (tc.function.name) calls[index].function.name += tc.function.name;
            if (tc.function.arguments) {
              calls[index].function.arguments += tc.function.arguments;
            }
          }
        }
      }
    }
  }

  const toolCalls = calls.filter(Boolean).map((call, index) => ({
    ...call,
    id: call.id || `call_${Date.now()}_${index}`
  }));

  return { content, reasoning, toolCalls, usage };
}

module.exports = { listModels, streamChat, friendlyHttpError };
