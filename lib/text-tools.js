'use strict';

/**
 * Fallback parser for models whose chat template does not support native
 * OpenAI tool calling. Some local models (e.g. Qwen2.5-Coder fine-tunes in
 * LM Studio) ignore the `tools` parameter and instead write the call as text:
 *
 *   <tool_call>{"name":"write_file","arguments":{...}}</tool_call>
 *   {"name":"write_file","arguments":{...}}
 *   <function=write_file><parameter=path>a.txt</parameter></function>
 *   <write_file path="a.txt" content="hello"/>
 *
 * This module turns those shapes into real tool-call objects.
 */

let sequence = 0;

function safeCodePoint(code) {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function decodeEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseLooseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // Common local-model mistakes: trailing commas and smart quotes.
  }

  const repaired = String(raw)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');

  try {
    return JSON.parse(repaired);
  } catch {
    return null;
  }
}

function makeCall(name, args) {  sequence += 1;
  return {
    id: `call_txt_${Date.now()}_${sequence}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args || {}) }
  };
}

function normalizeArguments(args, allowsContent) {
  if (args == null) return {};
  if (typeof args === 'object' && !Array.isArray(args)) return args;
  if (typeof args === 'string') {
    const trimmed = args.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith('{')) {
      try {
        const parsed = parseLooseJson(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {
        // fall through
      }
    }
    return allowsContent ? { content: args } : {};
  }
  return {};
}

function callsFromItem(item, validNames, contentNames) {
  if (!item || typeof item !== 'object') return [];

  const fn = item.function && typeof item.function === 'object' ? item.function : null;
  const name = String(item.name || item.tool || (fn && fn.name) || '').trim();
  if (!validNames.has(name)) return [];

  let args = item.arguments;
  if (args === undefined) args = item.parameters;
  if (args === undefined) args = item.args;
  if (args === undefined && fn) args = fn.arguments;

  return [makeCall(name, normalizeArguments(args, contentNames.has(name)))];
}

function callsFromObject(obj, validNames, contentNames) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  if (Array.isArray(obj.tool_calls)) {
    return obj.tool_calls.flatMap((item) => callsFromItem(item, validNames, contentNames));
  }
  if (Array.isArray(obj.calls)) {
    return obj.calls.flatMap((item) => callsFromItem(item, validNames, contentNames));
  }
  return callsFromItem(obj, validNames, contentNames);
}

function parseAttrs(source) {
  const attrs = {};
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(source))) {
    attrs[match[1]] = decodeEntities(match[2] !== undefined ? match[2] : match[3]);
  }
  return attrs;
}

function matchBrace(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Run a regex over the text, removing only the spans that produced real calls.
 */
function takeMatches(text, regex, handler) {
  const matches = [...text.matchAll(regex)];
  if (!matches.length) return { text, calls: [] };

  const calls = [];
  let out = '';
  let last = 0;

  for (const match of matches) {
    const produced = handler(match) || [];
    if (!produced.length) continue;

    out += text.slice(last, match.index);
    out += '';
    last = match.index + match[0].length;
    calls.push(...produced);
  }

  if (!calls.length) return { text, calls: [] };
  out += text.slice(last);
  return { text: out, calls };
}

function parseToolCallBlocks(text, validNames, contentNames) {
  return takeMatches(text, /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi, (match) => {
    let obj;
    try {
      obj = parseLooseJson(match[1]);
    } catch {
      return null;
    }
    return callsFromObject(obj, validNames, contentNames);
  });
}

function parseFunctionTags(text, validNames) {
  return takeMatches(
    text,
    /<function\s*=\s*([A-Za-z_][\w.-]*)\s*>([\s\S]*?)<\/function\s*>/gi,
    (match) => {
      const name = match[1];
      if (!validNames.has(name)) return null;

      const args = {};
      for (const param of match[2].matchAll(
        /<parameter\s*=\s*([A-Za-z_][\w.-]*)\s*>([\s\S]*?)<\/parameter\s*>/gi
      )) {
        args[param[1]] = decodeEntities(param[2]).trim();
      }

      if (!Object.keys(args).length) return null;
      return [makeCall(name, args)];
    }
  );
}

function parseJsonObjects(text, validNames, contentNames) {
  const calls = [];
  let out = '';
  let last = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '{') {
      i += 1;
      continue;
    }

    const end = matchBrace(text, i);
    if (end < 0) {
      i += 1;
      continue;
    }

    let obj = null;
    try {
      obj = parseLooseJson(text.slice(i, end + 1));
    } catch {
      obj = null;
    }

    if (obj) {
      const produced = callsFromObject(obj, validNames, contentNames);
      if (produced.length) {
        out += text.slice(last, i);
        calls.push(...produced);
        last = end + 1;
        i = end + 1;
        continue;
      }
    }

    i = end + 1;
  }

  if (!calls.length) return { text, calls: [] };
  out += text.slice(last);
  return { text: out, calls };
}

function parseXmlTags(text, validNames, contentNames) {
  const selfClosing = takeMatches(
    text,
    /<([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/>/g,
    (match) => {
      const name = match[1];
      if (!validNames.has(name)) return null;
      const args = parseAttrs(match[2]);
      if (!Object.keys(args).length) return null;
      return [makeCall(name, args)];
    }
  );

  const paired = takeMatches(
    selfClosing.text,
    /<([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*>([\s\S]*?)<\/\1\s*>/g,
    (match) => {
      const name = match[1];
      if (!validNames.has(name)) return null;

      const args = parseAttrs(match[2]);
      const body = decodeEntities(match[3]).replace(/^\r?\n/, '').replace(/\s+$/, '');

      if (body) {
        if (contentNames.has(name)) {
          args.content = body;
        } else if (body.trim().startsWith('{')) {
          try {
            const parsed = parseLooseJson(body);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              Object.assign(args, parsed);
            }
          } catch {
            // keep attributes only
          }
        }
      }

      if (!Object.keys(args).length) return null;
      return [makeCall(name, args)];
    }
  );

  return { text: paired.text, calls: [...selfClosing.calls, ...paired.calls] };
}

/**
 * Extract tool calls written as text.
 * @param {string} text - raw assistant text
 * @param {{ validNames: Set<string>, contentNames: Set<string> }} options
 * @returns {{ calls: object[], cleaned: string }}
 */
function extractTextToolCalls(text, options) {
  const source = String(text == null ? '' : text);
  if (!source) return { calls: [], cleaned: '' };

  const validNames = (options && options.validNames) || new Set();
  const contentNames = (options && options.contentNames) || new Set();

  let rest = source;
  const calls = [];

  const steps = [
    () => parseToolCallBlocks(rest, validNames, contentNames),
    () => parseFunctionTags(rest, validNames),
    () => parseJsonObjects(rest, validNames, contentNames),
    () => parseXmlTags(rest, validNames, contentNames)
  ];

  for (const step of steps) {
    const result = step();
    if (!result || !result.calls.length) continue;
    calls.push(...result.calls);
    rest = result.text;
  }

  return { calls, cleaned: rest.trim() };
}

module.exports = { extractTextToolCalls };
