'use strict';

require('dotenv').config({ override: true });
const axios = require('axios');
const logger = require('./logger');

const MODEL = 'claude-sonnet-4-5-20250929';
const API_URL = 'https://api.anthropic.com/v1/messages';

function getHeaders() {
  return {
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
}

async function generateReply(systemPrompt, messages) {
  const attempt = async () => {
    const response = await axios.post(API_URL, {
      model: MODEL,
      max_tokens: 300,
      temperature: 0.75,
      system: systemPrompt,
      messages,
    }, { headers: getHeaders() });
    return response.data.content[0].text;
  };

  try {
    return await attempt();
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    logger.warn(`Claude generateReply error, retrying in 3s: ${detail}`);
    await new Promise((r) => setTimeout(r, 3000));
    return await attempt();
  }
}

// Валидация российского номера телефона
// Допустимые форматы: +7XXXXXXXXXX, 8XXXXXXXXXX, 7XXXXXXXXXX, 9XXXXXXXXXX (10 цифр без кода)
function validatePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  // 11 цифр начиная с 7 или 8
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return '+7' + digits.slice(1);
  }
  // 10 цифр — добавляем +7
  if (digits.length === 10 && digits[0] === '9') {
    return '+7' + digits;
  }
  // Любое другое количество цифр — невалидный номер
  return 'INVALID:' + raw;
}

function hasExplicitQuantityInText(text, qty) {
  const t = String(text || '').toLowerCase();
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return false;

  const hasStandalone = new RegExp(`(?:^|[^\\p{L}\\p{N}])${q}(?:[^\\p{L}\\p{N}]|$)`, 'u').test(t);
  if (!hasStandalone) return false;

  const withDoorWord = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${q}\\s*(\\u0448\\u0442|\\u0448\\u0442\\.|\\u0448\\u0442\\u0443\\u043a\\u0438?|\\u0434\\u0432\\u0435\\u0440\\u0438?|\\u043f\\u043e\\u043b\\u043e\\u0442\\u043d\\u0430?)`,
    'u'
  ).test(t);
  const withIntent = new RegExp(
    `(\\u043d\\u0443\\u0436\\u043d\\u043e|\\u043d\\u0430\\u0434\\u043e|\\u0442\\u0440\\u0435\\u0431\\u0443\\u0435\\u0442\\u0441\\u044f|\\u0445\\u043e\\u0447\\u0443|\\u043f\\u043b\\u0430\\u043d\\u0438\\u0440\\u0443\\u044e|\\u0443\\u0441\\u0442\\u0430\\u043d\\u043e\\u0432\\u0438\\u0442\\u044c|\\u0437\\u0430\\u043c\\u0435\\u043d\\u0438\\u0442\\u044c)\\s*[^\\n]{0,30}(?:^|[^\\p{L}\\p{N}])${q}(?:[^\\p{L}\\p{N}]|$)`,
    'u'
  ).test(t);

  return withDoorWord || withIntent;
}

function extractDataByRules(text) {
  const t = String(text || '').toLowerCase();
  const original = String(text || '').trim();
  const result = {};
  const hasAny = (items) => items.some((item) => t.includes(item));

  const boughtMarkers = [
    '\u043a\u0443\u043f\u0438\u043b',
    '\u043a\u0443\u043f\u0438\u043b\u0430',
    '\u043a\u0443\u043f\u0438\u043b\u0438',
    '\u043a\u0443\u043f\u043b\u0435\u043d',
    '\u0443\u0436\u0435 \u0435\u0441\u0442\u044c \u0434\u0432\u0435\u0440',
    '\u0434\u0432\u0435\u0440\u044c \u0435\u0441\u0442\u044c',
    '\u0434\u0432\u0435\u0440\u0438 \u0435\u0441\u0442\u044c',
  ];
  const selectionMarkers = [
    '\u043f\u043e\u0434\u043e\u0431\u0440',
    '\u0432\u044b\u0431\u0440',
    '\u043a\u0430\u0442\u0430\u043b\u043e\u0433',
    '\u0432 \u043d\u0430\u043b\u0438\u0447\u0438\u0438',
    '\u0445\u043e\u0447\u0443 \u043a\u0443\u043f\u0438\u0442\u044c',
  ];
  const installMarkers = [
    '\u0443\u0441\u0442\u0430\u043d\u043e\u0432',
    '\u043c\u043e\u043d\u0442\u0430\u0436',
    '\u0441\u043c\u043e\u043d\u0442\u0438\u0440',
    '\u043f\u043e\u0441\u0442\u0430\u0432\u0438\u0442\u044c',
  ];
  const entranceMarkers = [
    '\u0432\u0445\u043e\u0434\u043d',
    '\u043c\u0435\u0442\u0430\u043b\u043b',
    '\u0442\u0435\u0440\u043c\u043e\u0440\u0430\u0437\u0440\u044b\u0432',
    '\u0442\u0435\u0440\u043c\u043e \u0440\u0430\u0437\u0440\u044b\u0432',
    '\u0443\u043b\u0438\u0447\u043d',
  ];
  const interiorMarkers = [
    '\u043c\u0435\u0436\u043a\u043e\u043c\u043d\u0430\u0442',
    '\u0432 \u0441\u043f\u0430\u043b\u044c\u043d',
    '\u0432 \u0441\u0430\u043d\u0443\u0437',
    '\u0434\u043e\u0431\u043e\u0440',
    '\u043f\u043e\u043b\u043e\u0442\u043d',
  ];
  const workItems = [];
  const addWork = (label) => {
    if (!workItems.includes(label)) workItems.push(label);
  };

  if (hasAny(['\u0434\u0435\u043c\u043e\u043d\u0442\u0430\u0436', '\u0441\u043d\u044f\u0442\u044c \u0441\u0442\u0430\u0440', '\u0443\u0431\u0440\u0430\u0442\u044c \u0441\u0442\u0430\u0440'])) {
    addWork('\u0434\u0435\u043c\u043e\u043d\u0442\u0430\u0436 \u0441\u0442\u0430\u0440\u043e\u0439 \u0434\u0432\u0435\u0440\u0438');
  }
  if (hasAny(['\u043e\u0442\u043a\u043e\u0441'])) addWork('\u043e\u0442\u043a\u043e\u0441\u044b');
  if (hasAny(['\u0434\u043e\u0431\u043e\u0440'])) addWork('\u0434\u043e\u0431\u043e\u0440\u044b');
  if (hasAny(['\u043d\u0430\u043b\u0438\u0447\u043d\u0438\u043a'])) addWork('\u043d\u0430\u043b\u0438\u0447\u043d\u0438\u043a\u0438');
  if (hasAny(['\u0444\u0443\u0440\u043d\u0438\u0442\u0443\u0440', '\u0440\u0443\u0447\u043a', '\u0437\u0430\u043c\u043e\u043a', '\u0437\u0430\u0449\u0435\u043b', '\u043f\u0435\u0442\u043b'])) {
    addWork('\u0444\u0443\u0440\u043d\u0438\u0442\u0443\u0440\u0430/\u0437\u0430\u043c\u043a\u0438/\u043f\u0435\u0442\u043b\u0438');
  }
  if (hasAny(['\u0434\u043e\u0441\u0442\u0430\u0432\u043a', '\u043f\u0440\u0438\u0432\u0435\u0437'])) addWork('\u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0430');

  if (hasAny(['\u043f\u0440\u043e\u0435\u043c\u044b \u0433\u043e\u0442\u043e\u0432\u044b', '\u043f\u0440\u043e\u0435\u043c \u0433\u043e\u0442\u043e\u0432', '\u043f\u0440\u043e\u0451\u043c\u044b \u0433\u043e\u0442\u043e\u0432\u044b', '\u043f\u0440\u043e\u0451\u043c \u0433\u043e\u0442\u043e\u0432'])) {
    result.readyProems = true;
  } else if (hasAny(['\u043f\u0440\u043e\u0435\u043c\u044b \u043d\u0435 \u0433\u043e\u0442\u043e\u0432\u044b', '\u043f\u0440\u043e\u0435\u043c \u043d\u0435 \u0433\u043e\u0442\u043e\u0432', '\u043f\u0440\u043e\u0451\u043c\u044b \u043d\u0435 \u0433\u043e\u0442\u043e\u0432\u044b', '\u043f\u0440\u043e\u0451\u043c \u043d\u0435 \u0433\u043e\u0442\u043e\u0432', '\u0434\u043e\u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c \u043f\u0440\u043e\u0435\u043c', '\u0434\u043e\u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c \u043f\u0440\u043e\u0451\u043c'])) {
    result.readyProems = false;
  }

  if (workItems.length > 0) result.additionalWork = workItems.join(', ');

  const digits = original.replace(/\D/g, '');
  if (digits.length >= 10) {
    const phone = validatePhone(original);
    if (phone && !phone.startsWith('INVALID:')) result.phone = phone;
  }

  if (/\btelegram\b|\bтелеграм\b|\bтг\b/i.test(t)) result.messenger = 'telegram';
  if (/\bmax\b|\bмакс\b/i.test(t)) result.messenger = 'max';

  if (/^[а-яё .,-]{3,}\s+\d+[а-яё0-9/-]*$/i.test(original) && digits.length < 7) {
    result.address = original;
  }

  if (hasAny(boughtMarkers)) result.doorStatus = '\u043a\u0443\u043f\u043b\u0435\u043d\u044b';
  else if (hasAny(selectionMarkers)) result.doorStatus = '\u043d\u0443\u0436\u043d\u043e \u043f\u043e\u0434\u043e\u0431\u0440\u0430\u0442\u044c';

  if (hasAny(installMarkers)) result.needsInstall = true;

  const entrance = hasAny(entranceMarkers);
  const interior = hasAny(interiorMarkers);
  if (entrance && interior) result.doorType = '\u043e\u0431\u0435';
  else if (entrance) result.doorType = '\u0432\u0445\u043e\u0434\u043d\u0430\u044f';
  else if (interior) result.doorType = '\u043c\u0435\u0436\u043a\u043e\u043c\u043d\u0430\u0442\u043d\u0430\u044f';

  return result;
}

async function extractData(lastUserMessage, currentData) {
  const ruleBased = extractDataByRules(lastUserMessage);
  const userPrompt = `Извлеки данные из сообщения клиента. Верни ТОЛЬКО валидный JSON без markdown:
{
  "phone": "номер телефона как написал клиент или null",
  "messenger": "telegram | max | null",
  "address": "адрес или район или null",
  "doorStatus": "куплены | нужно подобрать | null",
  "doorType": "входная | межкомнатная | обе | null",
  "quantity": число или null,
  "needsInstall": true/false/null,
  "readyProems": true/false/null,
  "additionalWork": "описание доп. работ или null",
  "notes": "прочие важные детали или null"
}
Сообщение: "${lastUserMessage}"
Уже известно: ${JSON.stringify(currentData)}`;

  try {
    const response = await axios.post(API_URL, {
      model: MODEL,
      max_tokens: 300,
      temperature: 0,
      system: 'Ты — парсер данных. Возвращай ТОЛЬКО валидный JSON без пояснений и без markdown-обёртки.',
      messages: [{ role: 'user', content: userPrompt }],
    }, { headers: getHeaders() });

    let raw = response.data.content[0].text.trim();
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(raw);

    const result = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== null && value !== undefined) {
        result[key] = value;
      }
    }
    Object.assign(result, ruleBased);

    if (result.quantity !== undefined && result.quantity !== null) {
      const q = Number(result.quantity);
      if (!Number.isFinite(q) || q <= 0 || !hasExplicitQuantityInText(lastUserMessage, q)) {
        delete result.quantity;
      } else {
        result.quantity = q;
      }
    }

    // Валидируем телефон
    if (result.phone) {
      const validated = validatePhone(result.phone);
      if (validated && validated.startsWith('INVALID:')) {
        // Сохраняем сырой номер для отображения в промпте, но не как валидный phone
        result.phoneRaw = result.phone;   // что написал клиент
        result.phoneInvalid = true;       // флаг — попросить перепроверить
        delete result.phone;              // не сохраняем как валидный
      } else if (validated) {
        result.phone = validated;
        result.phoneInvalid = false;
      }
    }

    return result;
  } catch (err) {
    logger.warn(`extractData failed: ${err.message}`);
    return ruleBased;
  }
}

module.exports = { generateReply, extractData, extractDataByRules };
