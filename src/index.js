'use strict';

require('dotenv').config({ override: true });
const logger = require('./logger');
const avito = require('./avito');
const { generateReply, extractData, extractDataByRules } = require('./claude');
const { getSession, hasSession, addMessage, mergeData } = require('./dialog');
const { sendLead, sendAttention } = require('./telegram');
const { getSystemPrompt } = require('./prompt');
const statsModule = require('./stats');
const { scheduleReports } = require('./report');
const { scheduleWarming } = require('./warmer');
const { scheduleFollowups } = require('./followup');
const leads = require('./leads');
const { getSimilarExamples } = require('./rag');
const { sanitizeReply } = require('./guardrails');
const manualLocks = require('./manualLocks');
const botMessages = require('./botMessages');

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);
const ENABLE_WARMING = process.env.ENABLE_WARMING === 'true';
const ENABLE_FOLLOWUPS = process.env.ENABLE_FOLLOWUPS === 'true';

let polling = false;
let pollTimer = null;
const BOT_STARTED_AT = Math.floor(Date.now() / 1000);
const attentionSentMessageIds = new Set();
const AVITO_BLOCKED_CHAT_RETRY_MS = parseInt(process.env.AVITO_BLOCKED_CHAT_RETRY_MS || String(10 * 60 * 1000), 10);
const avitoBlockedUntilByChat = new Map();

function isManualLockBypassed(chatId) {
  return String(process.env.MANUAL_LOCK_BYPASS_CHAT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(chatId);
}

function isAvitoBlockedChat(chatId) {
  const until = avitoBlockedUntilByChat.get(chatId) || 0;
  if (until > Date.now()) return true;
  if (until) avitoBlockedUntilByChat.delete(chatId);
  return false;
}

function blockAvitoChat(chatId, reason) {
  const until = Date.now() + AVITO_BLOCKED_CHAT_RETRY_MS;
  avitoBlockedUntilByChat.set(chatId, until);
  const retryAt = new Date(until).toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk' });
  logger.warn(`[AVITO BLOCK] ${chatId} skipped until ${retryAt}: ${reason}`);
}

function randomDelay(text = '') {
  const baseMin = parseInt(process.env.REPLY_DELAY_MIN_MS || '3500', 10);
  const baseMax = parseInt(process.env.REPLY_DELAY_MAX_MS || '9000', 10);
  const typingMs = Math.min((text || '').length * 45, 4000);
  const jitter = Math.floor(Math.random() * (baseMax - baseMin + 1)) + baseMin;
  return new Promise((r) => setTimeout(r, jitter + typingMs));
}

async function sendBotMessage(chatId, text) {
  await avito.sendMessage(chatId, text);
  botMessages.remember(chatId, text);
}

function formatMessageForModel(text, unixSec) {
  const safeText = (text || '').trim();
  if (!safeText) return safeText;
  const dt = new Date((unixSec || Math.floor(Date.now() / 1000)) * 1000).toLocaleString('ru-RU', {
    timeZone: 'Asia/Krasnoyarsk',
  });
  return `[${dt} Красноярск] ${safeText}`;
}

// Проверяем что метка времени (Unix сек) — не сегодня по Красноярску
function isNotToday(unixSec) {
  const tz = 'Asia/Krasnoyarsk';
  const msgDate = new Date(unixSec * 1000).toLocaleDateString('ru-RU', { timeZone: tz });
  const today = new Date().toLocaleDateString('ru-RU', { timeZone: tz });
  return msgDate !== today;
}

// Находим дату последнего НАШЕГО сообщения в списке сообщений чата
function lastOurMessageDate(messages) {
  const USER_ID = process.env.AVITO_USER_ID;
  const ours = messages.filter(m => String(m.author_id) === String(USER_ID));
  if (ours.length === 0) return null;
  return ours[ours.length - 1].created; // unix sec
}

// Приветствие по времени суток (Красноярск)
function timeGreeting() {
  const hour = Number(new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk', hour: 'numeric', hour12: false }));
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function isSystemMessage(msg) {
  if (msg.type !== 'text') return true;
  const text = msg.content?.text || '';
  if (!text.trim()) return true;
  if (text.startsWith('[Системное сообщение]')) return true;
  return false;
}

function currentMessageLooksLikePhone(text) {
  const digits = String(text || '').replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11;
}

function normalizeIncomingText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isEmptyChatTrigger(text) {
  const t = normalizeIncomingText(text);
  return (
    /\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c/u.test(t) &&
    /\u0441\u043e\u0437\u0434\u0430\u043b\s+\u0447\u0430\u0442/u.test(t) &&
    /\u043f\u043e\u043a\u0430\s+\u043d\u0438\u0447\u0435\u0433\u043e\s+\u043d\u0435\s+\u043d\u0430\u043f\u0438\u0441\u0430\u043b/u.test(t)
  );
}

function isProactiveAvitoTrigger(text) {
  return isEmptyChatTrigger(text);
}

function proactiveGreeting() {
  return '\u0417\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435! \u041c\u0435\u043d\u044f \u0437\u043e\u0432\u0443\u0442 \u0410\u043b\u0438\u043d\u0430, \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u0430 \u0414\u0432\u0435\u0440\u043d\u043e\u0439 \u041f\u043e\u0440\u0442\u0430\u043b. \u041f\u043e\u0434\u0441\u043a\u0430\u0436\u0443 \u043f\u043e \u0434\u0432\u0435\u0440\u044f\u043c, \u043c\u043e\u043d\u0442\u0430\u0436\u0443 \u0438\u043b\u0438 \u0437\u0430\u043c\u0435\u0440\u0443. \u0412\u0430\u043c \u043d\u0443\u0436\u043d\u0430 \u0432\u0445\u043e\u0434\u043d\u0430\u044f \u0438\u043b\u0438 \u043c\u0435\u0436\u043a\u043e\u043c\u043d\u0430\u0442\u043d\u0430\u044f \u0434\u0432\u0435\u0440\u044c?';
}

function currentMessageLooksLikeLeadClose(text) {
  const t = String(text || '').toLowerCase();
  return (
    /\u0437\u0430\u044f\u0432\u043a/u.test(t) ||
    /\u0437\u0430\u043f\u0438\u0448/u.test(t) ||
    /\u043f\u0435\u0440\u0435\u0434\u0430/u.test(t) ||
    /\u0441\u0432\u044f\u0436/u.test(t) ||
    /\u0442\u0435\u043b\u0435\u0444\u043e\u043d/u.test(t) ||
    /\u043d\u043e\u043c\u0435\u0440/u.test(t)
  );
}

function shouldAskMessenger(collectedData, lastUserText) {
  return Boolean(
    collectedData.phone &&
    collectedData.address &&
    !collectedData.messenger &&
    !collectedData.messengerAsked &&
    (currentMessageLooksLikePhone(lastUserText) || currentMessageLooksLikeLeadClose(lastUserText))
  );
}

function needsManagerAttention(text) {
  const t = String(text || '').toLowerCase();
  return (
    /\u043c\u0430\u0441\u0442\u0435\u0440[^.!?\n]{0,40}\u043d\u0435\s+(\u0441\u0432\u044f\u0437\u0430\u043b|\u0437\u0432\u043e\u043d\u0438\u043b|\u043f\u0435\u0440\u0435\u0437\u0432\u043e\u043d)/u.test(t) ||
    /\u043d\u0438\u043a\u0442\u043e\s+\u043d\u0435\s+(\u0437\u0432\u043e\u043d\u0438\u043b|\u0441\u0432\u044f\u0437\u0430\u043b\u0441\u044f|\u043f\u0435\u0440\u0435\u0437\u0432\u043e\u043d\u0438\u043b)/u.test(t) ||
    /\u043d\u0435\s+(\u0437\u0432\u043e\u043d\u0438\u043b\u0438|\u043f\u0435\u0440\u0435\u0437\u0432\u043e\u043d\u0438\u043b\u0438|\u0441\u0432\u044f\u0437\u0430\u043b\u0438\u0441\u044c)/u.test(t)
  );
}

function isNotLeadContext(text) {
  const t = String(text || '').toLowerCase();
  return (
    /\u0441\u043b\u0443\u0447\u0430\u0439\u043d\u043e/u.test(t) ||
    /\u043d\u0435\s+\u0442\u0443\u0434\u0430/u.test(t) ||
    /\u043e\u0448\u0438\u0431/u.test(t) ||
    /\u043d\u0435\s+\u043d\u0430\u0434\u043e/u.test(t) ||
    /\u043e\u0442\u043c\u0435\u043d/u.test(t)
  );
}

function isCatalogRequest(text) {
  const t = String(text || '').toLowerCase();
  return (
    /\u043a\u0430\u0442\u0430\u043b\u043e\u0433/u.test(t) ||
    /\u0441\u0430\u0439\u0442/u.test(t) ||
    /\u0441\u0441\u044b\u043b\u043a/u.test(t) ||
    /\u0432\u0430\u0440\u0438\u0430\u043d\u0442/u.test(t) ||
    /\u043c\u043e\u0434\u0435\u043b/u.test(t) ||
    /\u0430\u0441\u0441\u043e\u0440\u0442\u0438\u043c\u0435\u043d\u0442/u.test(t)
  );
}

function catalogReply(needsGreeting = false) {
  const intro = needsGreeting
    ? '\u0417\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435! \u041c\u0435\u043d\u044f \u0437\u043e\u0432\u0443\u0442 \u0410\u043b\u0438\u043d\u0430, \u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u0430 \u0414\u0432\u0435\u0440\u043d\u043e\u0439 \u041f\u043e\u0440\u0442\u0430\u043b. '
    : '';
  return `${intro}\u041a\u0430\u0442\u0430\u043b\u043e\u0433 \u0438 \u0430\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u044b\u0435 \u0432\u0430\u0440\u0438\u0430\u043d\u0442\u044b \u043c\u043e\u0436\u043d\u043e \u043f\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c \u043d\u0430 \u0441\u0430\u0439\u0442\u0435: https://\u0434\u0432\u0435\u0440\u043d\u043e\u0439\u043f\u043e\u0440\u0442\u0430\u043b.\u0440\u0444. \u0415\u0441\u043b\u0438 \u043f\u043e\u0434\u0441\u043a\u0430\u0436\u0435\u0442\u0435, \u043a\u0430\u043a\u0430\u044f \u0434\u0432\u0435\u0440\u044c \u043d\u0443\u0436\u043d\u0430, \u0441\u0440\u0430\u0437\u0443 \u0441\u043e\u0440\u0438\u0435\u043d\u0442\u0438\u0440\u0443\u044e \u0437\u0434\u0435\u0441\u044c.`;
}

function getClientName(chat) {
  const ownId = String(process.env.AVITO_USER_ID || '');
  const client = (chat.users || []).find((user) => String(user.id) !== ownId);
  return client?.name || null;
}

function normalizeForCompare(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isKnownBotAssistantMessage(chatId, message) {
  const text = normalizeForCompare(message.content?.text || '');
  if (!text) return false;
  if (botMessages.isKnown(chatId, text)) return true;
  if (!hasSession(chatId)) return false;
  const session = getSession(chatId);
  return session.messages.some((m) => (
    m.role === 'assistant' &&
    normalizeForCompare(m.content) === text
  ));
}

function findManualOperatorMessage(chatId, ourMsgs) {
  const trackingStartedAtSec = Math.floor(botMessages.trackingStartedAtMs() / 1000);
  return ourMsgs.find((m) => (
    Number(m.created || 0) >= trackingStartedAtSec &&
    !avito.isProcessed(m.id) &&
    !isKnownBotAssistantMessage(chatId, m)
  ));
}

function isHistoryReadBlocked(err) {
  return err?.response?.status === 402;
}

async function processChat(chat) {
  const chatId = chat.id;
  const bypassManualLock = isManualLockBypassed(chatId);
  let messages;

  try {
    messages = await avito.getChatMessages(chatId);
  } catch (err) {
    if (isHistoryReadBlocked(err)) {
      const lastId = chat?.last_message?.id;
      if (lastId) {
        avito.markProcessed(lastId);
      }
      blockAvitoChat(chatId, 'Avito API returned 402 for chat history; send is usually blocked too');
      statsModule.incError();
      return;
    } else {
    logger.error(`getChatMessages failed for ${chatId}: ${err.stack}`);
    statsModule.incError();
    return;
    }
  }

  messages.sort((a, b) => a.created - b.created);

  const realMessages = messages.filter((m) => !isSystemMessage(m));
  const lastRawMsg = messages[messages.length - 1];
  const lastRawText = lastRawMsg?.content?.text || '';
  if (lastRawMsg && !avito.isOwnMessage(lastRawMsg) && isProactiveAvitoTrigger(lastRawText)) {
    if (!bypassManualLock && manualLocks.isLocked(chatId)) {
      logger.debug(`[LOCKED] ${chatId} - proactive Avito trigger ignored because operator took over`);
      avito.markProcessed(lastRawMsg.id);
      return;
    }
    if (avito.isProcessed(lastRawMsg.id)) return;

    const reply = proactiveGreeting();
    avito.markProcessed(lastRawMsg.id);
    logger.info(`AVITO SYSTEM TRIGGER [${chatId}] ${lastRawText.slice(0, 80)}`);
    statsModule.incReceived(chatId);

    try {
      await randomDelay(reply);
      await sendBotMessage(chatId, reply);
      logger.info(`OUT [${chatId}] ${reply.slice(0, 80)}`);
      statsModule.incSent();
      await avito.markChatRead(chatId);
    } catch (err) {
      logger.error(`proactive greeting failed for ${chatId}: ${err.stack}`);
      statsModule.incError();
    }
    return;
  }
  if (realMessages.length === 0) return;

  const lastMsg = realMessages[realMessages.length - 1];

  // Если чат заблокирован оператором — молчим
  if (!bypassManualLock && manualLocks.isLocked(chatId)) {
    logger.debug(`[LOCKED] ${chatId} — operator took over, bot silent`);
    return;
  }

  // Детектируем ручное сообщение оператора:
  // ищем новое исходящее сообщение от оператора после запуска бота
  const ourMsgs = realMessages.filter(m => avito.isOwnMessage(m));
  const botEchoMsgs = ourMsgs.filter((m) => (
    Number(m.created || 0) >= BOT_STARTED_AT &&
    !avito.isProcessed(m.id) &&
    isKnownBotAssistantMessage(chatId, m)
  ));
  botEchoMsgs.forEach((m) => avito.markProcessed(m.id));
  const manualMsg = findManualOperatorMessage(chatId, ourMsgs);
  if (!bypassManualLock && manualMsg) {
    manualLocks.lock(chatId);
    // Помечаем все наши сообщения как обработанные
    ourMsgs.forEach(m => avito.markProcessed(m.id));
    logger.info(`[MANUAL LOCK] ${chatId} locked — operator wrote manually`);
    return;
  }

  if (avito.isOwnMessage(lastMsg)) return;
  if (avito.isProcessed(lastMsg.id)) return;

  const isNewChat = !hasSession(chatId);
  const session = getSession(chatId);
  const profileName = getClientName(chat);
  if (!session.collectedData.name && profileName) {
    mergeData(chatId, { name: profileName, nameSource: 'profile' });
  }
  if (leads.isLeadSent(chatId)) {
    session.leadSent = true;
  }

  if (isNewChat) {
    logger.info(`New chat: ${chatId}`);
    for (const msg of realMessages.slice(0, -1)) {
      const role = avito.isOwnMessage(msg) ? 'assistant' : 'user';
      const text = msg.content?.text || '';
      if (text) addMessage(chatId, role, text);
      if (role === 'user' && text) {
        const historicalData = extractDataByRules(text);
        if (Object.keys(historicalData).length > 0) {
          mergeData(chatId, historicalData);
        }
      }
      avito.markProcessed(msg.id);
    }
  }

  avito.markProcessed(lastMsg.id);
  const text = lastMsg.content?.text || '';
  logger.info(`IN  [${chatId}] ${text.slice(0, 80)}`);
  statsModule.incReceived(chatId);

  addMessage(chatId, 'user', text);

  if (needsManagerAttention(text) && !attentionSentMessageIds.has(lastMsg.id)) {
    attentionSentMessageIds.add(lastMsg.id);
    try {
      await sendAttention(chatId, {
        name: getClientName(chat),
        reason: '\u041a\u043b\u0438\u0435\u043d\u0442 \u043f\u0438\u0448\u0435\u0442, \u0447\u0442\u043e \u043c\u0430\u0441\u0442\u0435\u0440/\u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440 \u043d\u0435 \u0441\u0432\u044f\u0437\u0430\u043b\u0441\u044f.',
        action: '\u041d\u0443\u0436\u043d\u043e \u0440\u0443\u0447\u043d\u043e \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0447\u0430\u0442 Avito \u0438 \u0441\u0440\u043e\u0447\u043d\u043e \u0441\u0432\u044f\u0437\u0430\u0442\u044c\u0441\u044f \u0441 \u043a\u043b\u0438\u0435\u043d\u0442\u043e\u043c.',
        lastMessage: text,
      });
    } catch (err) {
      logger.error(`sendAttention failed for ${chatId}: ${err.stack || err.message}`);
      statsModule.incError();
    }
  }

  // Извлекаем данные ДО генерации ответа — Алина сразу знает о невалидном телефоне
  const extracted = await extractData(text, session.collectedData);
  if (Object.keys(extracted).length > 0) {
    mergeData(chatId, extracted);
    if (session.collectedData.phone) {
      statsModule.addPhone(session.collectedData.phone);
    }
  }

  const isFirstMessage = session.messages.length === 1;

  // Нужно поздороваться если:
  // 1. Первое сообщение в диалоге вообще
  // 2. Наш последний ответ был НЕ сегодня (клиент возобновил вчерашний/старый диалог)
  const lastOurTs = lastOurMessageDate(realMessages);
  const needsGreeting = isFirstMessage || lastOurTs === null || isNotToday(lastOurTs);
  const examples = getSimilarExamples(text, 3);
  const systemPrompt = getSystemPrompt(session.collectedData, needsGreeting, {
    nowLocal: new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk' }),
    examples,
  });

  let reply;
  const currentMessageIsCatalogRequest = isCatalogRequest(text);
  if (currentMessageIsCatalogRequest) {
    reply = catalogReply(needsGreeting);
  } else if (shouldAskMessenger(session.collectedData, text)) {
    reply = 'Спасибо! Заявку передам мастеру. Подскажите, куда удобнее написать: Telegram или Max?';
    session.collectedData.messengerAsked = true;
  } else {
    try {
      reply = await generateReply(systemPrompt, session.messages);
    } catch (err) {
      logger.error(`generateReply failed for ${chatId}: ${err.stack}`);
      statsModule.incError();
      return;
    }
  }

  if (!currentMessageIsCatalogRequest) {
    reply = sanitizeReply(reply, { lastUserText: text, needsGreeting, currentData: session.collectedData });
  }
  addMessage(chatId, 'assistant', reply);

  await randomDelay(reply);

  try {
    await sendBotMessage(chatId, reply);
    logger.info(`OUT [${chatId}] ${reply.slice(0, 80)}`);
    statsModule.incSent();
  } catch (err) {
    logger.error(`sendMessage failed for ${chatId}: ${err.stack}`);
    statsModule.incError();
    return;
  }

  const { phone, address } = session.collectedData;
  if (phone && address && !session.leadSent && !leads.isLeadSent(chatId) && !isNotLeadContext(text)) {
    session.leadSent = true;
    await sendLead(chatId, session.collectedData);
    statsModule.incLead(phone);
    leads.markLeadSent(chatId); // сохраняем в файл — варм-ап не тронет этот чат
  }

  await avito.markChatRead(chatId);
}

async function poll() {
  if (!polling) return;

  logger.debug('Polling Avito...');

  try {
    const chats = await avito.getChatsNeedingReply();
    if (chats.length > 0) {
      logger.info(`Chats needing reply: ${chats.length}`);
    }
    for (const chat of chats) {
      if (isAvitoBlockedChat(chat.id)) {
        logger.debug(`[AVITO BLOCK] ${chat.id} still in cooldown, skipping`);
        continue;
      }
      await processChat(chat);
      if (chats.length > 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } catch (err) {
    logger.error(`Poll iteration failed: ${err.stack}`);
    statsModule.incError();
  }

  if (polling) {
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }
}

async function start() {
  polling = true;
  logger.info(`Bot started. Poll interval: ${POLL_INTERVAL_MS}ms`);
  scheduleReports();
  // Сначала помечаем все существующие сообщения как виденные — не отвечаем на старые
  await avito.initProcessed();

  // Прогрев замороженных (3+ дней тишины)
  if (ENABLE_WARMING) {
    logger.info('Warm-up scheduler enabled via ENABLE_WARMING=true');
    scheduleWarming({
      authHeaders: avito.authHeaders,
      getAllChats: avito.getAllChats,
      getChatMessages: avito.getChatMessages,
      sendMessage: sendBotMessage,
      getSession,
      addMessage,
      markProcessed: avito.markProcessed,
    });
  } else {
    logger.info('Warm-up scheduler disabled. Bot will not message old frozen chats.');
  }

  // Follow-up (2-24 часа тишины после нашего ответа)
  if (ENABLE_FOLLOWUPS) {
    logger.info('Follow-up scheduler enabled via ENABLE_FOLLOWUPS=true');
    scheduleFollowups({
      getAllChats: avito.getAllChats,
      getChatMessages: avito.getChatMessages,
      sendMessage: sendBotMessage,
      getSession,
      addMessage,
    });
  } else {
    logger.info('Follow-up scheduler disabled. Bot will only answer new incoming messages.');
  }

  poll();
}

function stop() {
  polling = false;
  if (pollTimer) clearTimeout(pollTimer);
  logger.info('Bot stopped');
}

process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
process.on('uncaughtException', (err) => { logger.error(`uncaughtException: ${err.stack}`); });
process.on('unhandledRejection', (reason) => {
  logger.error(`unhandledRejection: ${reason instanceof Error ? reason.stack : reason}`);
});

start();
