'use strict';

require('dotenv').config({ override: true });
const fs = require('fs');
const path = require('path');
const leads = require('./leads');
const axios = require('axios');
const logger = require('./logger');

const WARMED_FILE = path.join(process.cwd(), 'data', 'warmed.json');
const BASE_URL = 'https://api.avito.ru';
const USER_ID = process.env.AVITO_USER_ID;

// Настройки прогрева
const FREEZE_DAYS = 3;        // молчание клиента сколько дней считать заморозкой
const REWARM_DAYS = 14;       // через сколько дней можно написать повторно
const BATCH_SIZE = 5;         // максимум прогревов за одну волну
const WARM_INTERVAL_MS = 6 * 60 * 60 * 1000; // раз в 6 часов

// Загрузка/сохранение warmed чатов из файла (key: chatId, value: timestamp)
function loadWarmed() {
  try {
    return JSON.parse(fs.readFileSync(WARMED_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveWarmed(data) {
  try {
    fs.writeFileSync(WARMED_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.warn(`warmed.json save failed: ${err.message}`);
  }
}

// Генерируем тёплое сообщение через Claude
async function generateWarmMessage(chatHistory) {
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL = 'claude-sonnet-4-5-20250929';

  const historyText = chatHistory.slice(-6).map(m =>
    `${m.role === 'assistant' ? 'Алина' : 'Клиент'}: ${m.content}`
  ).join('\n');

  const hour = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk', hour: 'numeric', hour12: false });
  const greeting = Number(hour) < 12 ? 'Доброе утро' : Number(hour) < 18 ? 'Добрый день' : 'Добрый вечер';

  const system = `Ты — Алина, менеджер компании «Дверной портал» (Красноярск).
Тебе нужно написать короткое тёплое сообщение клиенту, с которым ранее общались по поводу дверей, но который замолчал.
Цель: ненавязчиво узнать — уже приобрели/установили двери или всё ещё в поиске? Если ещё в поиске — предложить помочь.
Правила:
- ОБЯЗАТЕЛЬНО начни с приветствия "${greeting}!" — это первое слово сообщения
- 2-3 предложения максимум
- Не упоминай сколько прошло времени
- Без давления, без эмодзи
- Только Telegram или Max — не WhatsApp
- Если клиент ещё в поиске — плавно предложи номер телефона чтобы связаться в мессенджере`;

  const userPrompt = `История переписки с клиентом:\n${historyText}\n\nНапиши приветственное сообщение для возобновления диалога. Начни с "${greeting}!".`;

  const response = await axios.post(API_URL, {
    model: MODEL,
    max_tokens: 150,
    temperature: 0.8,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  }, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
  });

  return response.data.content[0].text.trim();
}

// Получаем замороженные чаты
async function findFrozenChats(authHeaders, getAllChats) {
  const chats = await getAllChats(60); // смотрим за 60 дней
  const warmed = loadWarmed();
  const nowSec = Date.now() / 1000;
  const freezeSec = FREEZE_DAYS * 86400;
  const rewarmSec = REWARM_DAYS * 86400;
  const frozen = [];

  for (const chat of chats) {
    const last = chat.last_message;
    if (!last) continue;

    // Последнее сообщение должно быть ОТ НАС (мы ответили, клиент замолчал)
    if (String(last.author_id) !== String(USER_ID)) continue;

    // Тишина минимум FREEZE_DAYS
    const silenceSec = nowSec - last.created;
    if (silenceSec < freezeSec) continue;

    // Не старше 60 дней (совсем старые не трогаем)
    if (silenceSec > 60 * 86400) continue;

    // Проверяем: когда последний раз прогревали
    const lastWarmed = warmed[chat.id] || 0;
    if (nowSec - lastWarmed < rewarmSec) continue;

    // Не трогаем чаты где уже есть оформленная заявка
    if (leads.isLeadSent(chat.id)) continue;

    frozen.push(chat);
  }

  return frozen;
}

// Основная функция прогрева
async function warmupBatch({ authHeaders, getAllChats, getChatMessages, sendMessage, getSession, addMessage, markProcessed }) {
  let frozen;
  try {
    frozen = await findFrozenChats(authHeaders, getAllChats);
  } catch (err) {
    logger.error(`warmup findFrozenChats failed: ${err.message}`);
    return;
  }

  if (frozen.length === 0) {
    logger.debug('Warmer: no frozen chats found');
    return;
  }

  logger.info(`Warmer: found ${frozen.length} frozen chats, warming up to ${BATCH_SIZE}`);
  const warmed = loadWarmed();
  const batch = frozen.slice(0, BATCH_SIZE);

  for (const chat of batch) {
    const chatId = chat.id;
    try {
      // Получаем историю для контекста
      const messages = await getChatMessages(chatId);
      messages.sort((a, b) => a.created - b.created);

      const history = messages
        .filter(m => m.type === 'text' && m.content?.text)
        .map(m => ({
          role: String(m.author_id) === String(USER_ID) ? 'assistant' : 'user',
          content: m.content.text,
        }));

      if (history.length < 2) continue; // совсем пустой — пропускаем

      // Генерируем тёплое сообщение
      const warmMsg = await generateWarmMessage(history);

      // Небольшая задержка — имитация живого человека
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));

      // Отправляем
      await sendMessage(chatId, warmMsg);
      logger.info(`Warmer OUT [${chatId}] ${warmMsg.slice(0, 80)}`);

      // Добавляем в сессию если она есть
      const session = getSession(chatId);
      addMessage(chatId, 'assistant', warmMsg);

      // Помечаем как прогретый
      warmed[chatId] = Date.now() / 1000;

      // Помечаем последнее наше сообщение чтобы не путать бота
      // (ответ клиента на это сообщение будет новым — его обработает основной поток)

    } catch (err) {
      logger.error(`Warmer failed for ${chatId}: ${err.message}`);
    }
  }

  saveWarmed(warmed);
}

// Планировщик
function scheduleWarming(deps) {
  async function run() {
    logger.debug('Warmer: running batch...');
    await warmupBatch(deps);
    setTimeout(run, WARM_INTERVAL_MS);
  }

  // Первый прогрев через 30 минут после старта (не сразу)
  setTimeout(run, 30 * 60 * 1000);
  logger.info(`Warmer scheduled: every ${WARM_INTERVAL_MS / 3600000}h, first run in 30min`);
}

module.exports = { scheduleWarming };
