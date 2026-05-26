'use strict';

require('dotenv').config({ override: true });
const fs = require('fs');
const leads = require('./leads');
const path = require('path');
const axios = require('axios');
const logger = require('./logger');

const FOLLOWUP_FILE = path.join(process.cwd(), 'data', 'followups.json');
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-5-20250929';
const USER_ID = process.env.AVITO_USER_ID;

// Через сколько часов молчания делать follow-up
const MIN_SILENCE_H = 2;
const MAX_SILENCE_H = 24; // больше — уже дело варм-апа

// Интервал проверки
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // каждые 30 минут

function loadFollowups() {
  try { return JSON.parse(fs.readFileSync(FOLLOWUP_FILE, 'utf8')); } catch { return {}; }
}

function saveFollowups(data) {
  try { fs.writeFileSync(FOLLOWUP_FILE, JSON.stringify(data, null, 2)); } catch (e) {
    logger.warn(`followups.json save failed: ${e.message}`);
  }
}

function talkedToday(history, messages) {
  // Проверяем есть ли сообщения клиента сегодня по Красноярску
  const tz = 'Asia/Krasnoyarsk';
  const today = new Date().toLocaleDateString('ru-RU', { timeZone: tz });
  return messages.some(m => {
    if (String(m.author_id) === String(USER_ID)) return false; // наши не считаем
    const msgDay = new Date(m.created * 1000).toLocaleDateString('ru-RU', { timeZone: tz });
    return msgDay === today;
  });
}

async function generateFollowupMessage(chatHistory, needGreeting) {
  const historyText = chatHistory.slice(-4).map(m =>
    `${m.role === 'assistant' ? 'Алина' : 'Клиент'}: ${m.content}`
  ).join('\n');

  const hour = Number(new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk', hour: 'numeric', hour12: false }));
  const greeting = hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  const greetingRule = needGreeting
    ? `- Начни с "${greeting}!" — сегодня ещё не общались`
    : `- НЕ здоровайся — сегодня уже общались с клиентом, просто продолжи разговор`;

  const response = await axios.post(API_URL, {
    model: MODEL,
    max_tokens: 100,
    temperature: 0.7,
    system: `Ты — Алина, менеджер «Дверной портал». Клиент замолчал после твоего ответа.
Напиши одно короткое сообщение — дружески уточни остались ли вопросы или нужна помощь с выбором.
Правила:
${greetingRule}
- 1-2 предложения, без давления, без эмодзи, без WhatsApp`,
    messages: [{ role: 'user', content: `Контекст диалога:\n${historyText}\n\nНапиши follow-up сообщение.` }],
  }, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
  });

  return response.data.content[0].text.trim();
}

async function runFollowups({ getAllChats, getChatMessages, sendMessage, getSession, addMessage }) {
  const followups = loadFollowups();
  const nowSec = Date.now() / 1000;
  const minSec = MIN_SILENCE_H * 3600;
  const maxSec = MAX_SILENCE_H * 3600;

  let chats;
  try {
    chats = await getAllChats(7); // смотрим за 7 дней
  } catch (err) {
    logger.warn(`followup getAllChats failed: ${err.message}`);
    return;
  }

  const candidates = chats.filter(chat => {
    const last = chat.last_message;
    if (!last) return false;
    // Последнее сообщение — ОТ НАС (мы ответили, клиент молчит)
    if (String(last.author_id) !== String(USER_ID)) return false;
    // Только текст
    if (last.type && last.type !== 'text') return false;
    // Молчание в нужном диапазоне
    const silence = nowSec - last.created;
    if (silence < minSec || silence > maxSec) return false;
    // Ещё не делали follow-up для этого нашего сообщения
    if (followups[last.id]) return false;
    // Не трогаем чаты где уже есть оформленная заявка
    if (leads.isLeadSent(chat.id)) return false;
    return true;
  });

  if (candidates.length === 0) return;
  logger.info(`Followup: ${candidates.length} candidate chats`);

  for (const chat of candidates.slice(0, 10)) {
    const chatId = chat.id;
    const lastMsgId = chat.last_message.id;

    try {
      const messages = await getChatMessages(chatId);
      messages.sort((a, b) => a.created - b.created);

      const history = messages
        .filter(m => m.type === 'text' && m.content?.text &&
          !m.content.text.startsWith('[Системное сообщение]'))
        .map(m => ({
          role: String(m.author_id) === String(USER_ID) ? 'assistant' : 'user',
          content: m.content.text,
        }));

      // Должен быть реальный диалог (минимум 2 сообщения)
      if (history.length < 2) continue;
      // Последнее в истории должно быть от нас
      if (history[history.length - 1].role !== 'assistant') continue;

      const needGreeting = !talkedToday(history, messages);
      const msg = await generateFollowupMessage(history, needGreeting);

      await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
      await sendMessage(chatId, msg);
      logger.info(`Followup OUT [${chatId}] ${msg.slice(0, 80)}`);

      // Добавляем в сессию
      const session = getSession(chatId);
      addMessage(chatId, 'assistant', msg);

      // Помечаем что follow-up для этого сообщения уже сделан
      followups[lastMsgId] = nowSec;

    } catch (err) {
      logger.error(`Followup failed for ${chatId}: ${err.message}`);
    }
  }

  saveFollowups(followups);
}

function scheduleFollowups(deps) {
  async function run() {
    await runFollowups(deps);
    setTimeout(run, CHECK_INTERVAL_MS);
  }
  // Первая проверка через 5 минут после старта
  setTimeout(run, 5 * 60 * 1000);
  logger.info('Followup scheduler started: check every 30min, first run in 5min');
}

module.exports = { scheduleFollowups };
