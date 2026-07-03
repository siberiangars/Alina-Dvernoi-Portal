'use strict';

require('dotenv').config({ override: true });
const axios = require('axios');
const logger = require('./logger');

// --- Провайдер выбирается через AI_PROVIDER ---
const PROVIDER = process.env.AI_PROVIDER || 'deepseek';

// --- Claude (Anthropic) ---
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

function getClaudeHeaders() {
  return {
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
}

// --- DeepSeek (OpenAI-compatible) ---
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';

function getDeepSeekHeaders() {
  return {
    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

function getHeaders() {
  if (PROVIDER === 'claude') return getClaudeHeaders();
  return getDeepSeekHeaders();
}

function getApiUrl() {
  if (PROVIDER === 'claude') return CLAUDE_API_URL;
  return DEEPSEEK_API_URL;
}

function getModel() {
  if (PROVIDER === 'claude') return CLAUDE_MODEL;
  return DEEPSEEK_MODEL;
}

// ============================================================
// GENERATE REPLY — единственный AI-вызов (generateReply)
// ============================================================

async function generateReply(systemPrompt, messages) {
  const attempt = async () => {
    let requestBody;
    let response;

    if (PROVIDER === 'claude') {
      requestBody = {
        model: CLAUDE_MODEL,
        max_tokens: 600,
        temperature: 0.75,
        system: systemPrompt,
        messages,
      };
      response = await axios.post(CLAUDE_API_URL, requestBody, {
        headers: getClaudeHeaders(),
        timeout: 20000,
      });
      return response.data.content[0].text;
    } else {
      const dsMessages = [{ role: 'system', content: systemPrompt }, ...messages];
      requestBody = {
        model: DEEPSEEK_MODEL,
        max_tokens: 600,
        temperature: 0.75,
        messages: dsMessages,
      };
      response = await axios.post(DEEPSEEK_API_URL, requestBody, {
        headers: getDeepSeekHeaders(),
        timeout: 15000,
      });
      return response.data.choices[0].message.content;
    }
  };

  try {
    return await attempt();
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    logger.warn(`${PROVIDER} generateReply error, retrying in 3s: ${detail}`);
    await new Promise((r) => setTimeout(r, 3000));
    return await attempt();
  }
}

// ============================================================
// RULE-BASED DATA EXTRACTION — NO AI CALLS
// ============================================================

function validatePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return '+7' + digits.slice(1);
  }
  if (digits.length === 10 && digits[0] === '9') {
    return '+7' + digits;
  }
  return 'INVALID:' + raw;
}

function cleanClientName(raw) {
  const name = String(raw || '')
    .replace(/[^\p{L}\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || name.length < 2 || name.length > 40) return null;
  if (/алина/i.test(name)) return null;
  const bad = ['здравствуйте', 'привет', 'дверь', 'монтаж', 'замер'];
  if (bad.includes(name.toLowerCase())) return null;
  return name;
}

function extractNameByRules(text) {
  const original = String(text || '').trim();
  const patterns = [
    /(?:меня\s+зовут|мое\s+имя)\s+([\p{L} .-]{2,40})/iu,
    /(?:^|[.!?\n]\s*)я\s+([\p{L} .-]{2,30})(?:[.!?\n]|$)/iu,
    /^([\p{L} .-]{2,30})\s+я(?:[.!?\n]|$)/iu,
  ];
  for (const pattern of patterns) {
    const match = original.match(pattern);
    const name = cleanClientName(match?.[1]);
    if (name) return name;
  }
  return null;
}

function hasExplicitQuantityInText(text, qty) {
  const t = String(text || '').toLowerCase();
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return false;

  const hasStandalone = new RegExp(`(?:^|[^\\p{L}\\p{N}])${q}(?:[^\\p{L}\\p{N}]|$)`, 'u').test(t);
  if (!hasStandalone) return false;

  const withDoorWord = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${q}\\s*(шт|шт\\.|штуки?|двери?|полотна?)`,
    'u'
  ).test(t);
  const withIntent = new RegExp(
    `(нужно|надо|требуется|хочу|планирую|установить|заменить)\\s*[^\\n]{0,30}(?:^|[^\\p{L}\\p{N}])${q}(?:[^\\p{L}\\p{N}]|$)`,
    'u'
  ).test(t);

  return withDoorWord || withIntent;
}

function extractQuantityByRules(text) {
  const original = String(text || '');
  const t = original.toLowerCase();
  const wordNumbers = [
    ['одну', 1], ['одна', 1], ['один', 1], ['две', 2], ['два', 2], ['двух', 2], ['три', 3], ['трех', 3], ['трёх', 3],
    ['четыре', 4], ['четырех', 4], ['четырёх', 4], ['пять', 5], ['пяти', 5], ['шесть', 6], ['шести', 6], ['семь', 7], ['восемь', 8], ['девять', 9], ['десять', 10],
  ];

  const digitMatches = [...t.matchAll(/(?:^|[^\p{L}\p{N}])(\d{1,2})\s*(?:шт|шт\.|штук|штуки?|двери?|полотна?|проема?|проёма?)(?:[^\p{L}\p{N}]|$)/giu)];
  if (digitMatches.length > 0) {
    const nums = digitMatches.map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0 && n <= 50);
    if (nums.length > 0) return nums.reduce((a, b) => a + b, 0);
  }

  let total = 0;
  for (const [word, value] of wordNumbers) {
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${word}\\s+(?:шт|штук|штуки?|(?:[\\p{L}-]+\\s+){0,3}двер(?:ь|и|ей|ью)?|полотн[оа]|проем|проём)(?:[^\\p{L}\\p{N}]|$)`, 'giu');
    const count = [...t.matchAll(re)].length;
    total += count * value;
  }
  // Клиенты часто пишут: "одна дверь одинарная и одна распашная".
  // Вторая часть без слова "дверь", но для заявки это отдельная позиция.
  for (const [word, value] of wordNumbers) {
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${word}\\s+(?:одинарн\\p{L}*|распашн\\p{L}*|двустворчат\\p{L}*|двойная|двойную)(?:[^\\p{L}\\p{N}]|$)`, 'giu');
    const count = [...t.matchAll(re)].length;
    total += count * value;
  }

  if (total > 0) return total;

  const range = t.match(/(?:^|[^\p{L}\p{N}])(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:шт|штук|штуки?|двери?|полотна?)(?:[^\p{L}\p{N}]|$)/iu);
  if (range) return Number(range[2]);

  return null;
}

function extractDataByRules(text) {
  const t = String(text || '').toLowerCase();
  const original = String(text || '').trim();
  const result = {};
  const hasAny = (items) => items.some((item) => t.includes(item));

  // --- Имя ---
  const clientName = extractNameByRules(original);
  if (clientName) {
    result.name = clientName;
    result.nameSource = 'dialog';
  }

  // --- Маркеры ---
  const boughtMarkers = ['купил', 'купила', 'купили', 'куплен', 'куплено',
    'все куплено', 'всё куплено', 'уже есть двер', 'дверь есть', 'двери есть'];
  const selectionMarkers = ['подобр', 'выбр', 'каталог', 'в наличии', 'хочу купить'];
  const installMarkers = ['установ', 'монтаж', 'смонтир', 'поставить'];
  const entranceMarkers = ['входн', 'металл', 'терморазрыв', 'термо разрыв', 'уличн'];
  const interiorMarkers = ['межкомнат', 'в спальн', 'в сануз', 'добор', 'полотн'];
  const serviceOnlyMarkers = ['только установ', 'только монтаж', 'без подбора',
    'двери уже есть', 'дверь уже есть', 'двери куплены', 'установить двер',
    'вставить двер', 'поставить двер'];

  // --- Доп. работы ---
  const workItems = [];
  const addWork = (label) => {
    if (!workItems.includes(label)) workItems.push(label);
  };
  if (hasAny(['демонтаж', 'снять стар', 'убрать стар'])) addWork('демонтаж старой двери');
  if (hasAny(['откос'])) addWork('откосы');
  if (hasAny(['добор'])) addWork('доборы');
  if (hasAny(['наличник'])) addWork('наличники');
  if (hasAny(['фурнитур', 'ручк', 'замок', 'защел', 'петл'])) addWork('фурнитура/замки/петли');
  if (hasAny(['доставк', 'привез'])) addWork('доставка');
  if (workItems.length > 0) result.additionalWork = workItems.join(', ');

  // --- Проёмы ---
  if (hasAny(['проемы готовы', 'проем готов', 'проёмы готовы', 'проём готов'])) {
    result.readyProems = true;
  } else if (hasAny(['проемы не готовы', 'проем не готов', 'проёмы не готовы',
    'проём не готов', 'доработать проем', 'доработать проём'])) {
    result.readyProems = false;
  }

  // --- Телефон (ищем по префиксу +7/8, а не по общему количеству цифр) ---
  const phonePatterns = [
    /(\+7[\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})/,
    /(8[\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})/,
    /(7[\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})/,
    /(^|[^\d])(9\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})(?=$|[^\d])/,
  ];
  for (const pat of phonePatterns) {
    const match = original.match(pat);
    if (match) {
      const rawPhone = match[2] || match[1];
      const phoneDigits = rawPhone.replace(/\D/g, '');
      if (phoneDigits.length >= 10) {
        const phone = validatePhone(rawPhone);
        if (phone && !phone.startsWith('INVALID:')) {
          result.phone = phone;
          break;
        }
      }
    }
  }

  // --- Мессенджер ---
  if (/\btelegram\b|\bтелеграм\b|\bтг\b/i.test(t)) result.messenger = 'telegram';
  if (/\bmax\b|\bмакс\b/i.test(t)) result.messenger = 'max';

  // --- Адрес (улучшено) ---
  // Паттерны с явными указателями (ул., пр., пер., р-н, г., мкр)
  const addressPatterns = [
    /(?:ул(?:ица)?\.?\s*[\p{L}\d\s.-]+?\d+[\p{L}\d/\-]*)/iu,
    /(?:пр(?:оспект)?\.?\s*[\p{L}\d\s.-]+?\d+[\p{L}\d/\-]*)/iu,
    /(?:пер(?:еулок)?\.?\s*[\p{L}\d\s.-]+?\d+[\p{L}\d/\-]*)/iu,
    /(?:^|[\s,.;])(?:р-н|район)\s*[\p{L}\s.-]+/iu,
    /(?:^|[\s,.;])(?:г\.|город)\s*[\p{L}\s.-]+/iu,
    /(?:^|[\s,.;])(?:мкр(?:н)?\.?\s*[\p{L}\d\s.-]+)/iu,
  ];
  for (const pat of addressPatterns) {
    const match = original.match(pat);
    if (match) {
      result.address = match[0].replace(/^[\s,.;]+/, '').trim();
      break;
    }
  }
  // Фоллбэк: улица без префикса — "НазваниеУлицы номер" (буквы + пробел + цифры)
  // Примеры: "копылова 12", "карамзина 10", "ленина 5 к1"
  if (!result.address) {
    const bareStreet = original.match(
      /(?:^|[\s\n])([\p{L}]{3,}(?:[\s.-][\p{L}]{2,})?)\s+(\d+[\p{L}\d/\-]*)/iu
    );
    if (bareStreet) {
      result.address = (bareStreet[1] + ' ' + bareStreet[2]).trim();
    }
  }

  // --- Количество ---
  const quantity = extractQuantityByRules(original);
  if (quantity) result.quantity = quantity;

  // --- Статус двери ---
  if (hasAny(boughtMarkers)) result.doorStatus = 'куплены';
  else if (hasAny(selectionMarkers)) result.doorStatus = 'нужно подобрать';

  // --- Установка ---
  if (hasAny(installMarkers)) result.needsInstall = true;

  // --- Сервис-only (только установка/работы, без подбора дверей) ---
  const priceIntent = /сколько|стоим|стоить|цен|рассчит|расч[её]т|прайс/iu.test(t);
  const selectionIntent = hasAny(selectionMarkers);
  const buyingDoorIntent = /нужн[аыо]?\s+двер|хочу\s+двер|интересует\s+двер/iu.test(t) && !hasAny(boughtMarkers);
  const installOnlyIntent = hasAny(installMarkers) && !selectionIntent && !buyingDoorIntent;
  if (hasAny(serviceOnlyMarkers) || installOnlyIntent || (priceIntent && installOnlyIntent)) {
    result.serviceOnly = true;
  }

  // --- Тип двери ---
  const entrance = hasAny(entranceMarkers);
  const interior = hasAny(interiorMarkers);
  if (entrance && interior) result.doorType = 'обе';
  else if (entrance) result.doorType = 'входная';
  else if (interior) result.doorType = 'межкомнатная';

  return result;
}

// ============================================================
// EXTRACT DATA — теперь ТОЛЬКО rule-based, без AI
// ============================================================

// currentData — оставлен для обратной совместимости, не используется (AI-парсинг удалён)
function extractData(lastUserMessage, _currentData) {
  const data = extractDataByRules(lastUserMessage);

  // Валидация телефона
  if (data.phone) {
    const validated = validatePhone(data.phone);
    if (validated && validated.startsWith('INVALID:')) {
      data.phoneRaw = data.phone;
      data.phoneInvalid = true;
      delete data.phone;
    } else if (validated) {
      data.phone = validated;
      data.phoneInvalid = false;
    }
  }

  return data;
}

module.exports = { generateReply, extractData, extractDataByRules };
