'use strict';

require('dotenv').config({ override: true });
const axios = require('axios');
const logger = require('./logger');

const BASE_URL = 'https://api.avito.ru';
const CLIENT_ID = process.env.AVITO_CLIENT_ID;
const CLIENT_SECRET = process.env.AVITO_CLIENT_SECRET;
const USER_ID = process.env.AVITO_USER_ID;

let tokenCache = { accessToken: null, expiresAt: 0 };
const PROACTIVE_STARTUP_WINDOW_HOURS = Number(process.env.PROACTIVE_STARTUP_WINDOW_HOURS || 24);

// Множество ID уже обработанных/виденных сообщений
const processedMessageIds = new Set();

function normalizeIncomingText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isProactiveAvitoTriggerText(text) {
  const t = normalizeIncomingText(text);
  const user = /\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c/u.test(t);
  const emptyChat = (
    /\u0441\u043e\u0437\u0434\u0430\u043b\s+\u0447\u0430\u0442/u.test(t) &&
    /\u043f\u043e\u043a\u0430\s+\u043d\u0438\u0447\u0435\u0433\u043e\s+\u043d\u0435\s+\u043d\u0430\u043f\u0438\u0441\u0430\u043b/u.test(t)
  );
  return user && emptyChat;
}

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const response = await axios.post(`${BASE_URL}/token`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  tokenCache.accessToken = response.data.access_token;
  tokenCache.expiresAt = Date.now() + response.data.expires_in * 1000;
  logger.debug('Avito token refreshed');
  return tokenCache.accessToken;
}

async function authHeaders() {
  const token = await getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

async function getAllChats(maxAgeDays = 30) {
  const headers = await authHeaders();
  const allChats = [];
  const PAGE = 100;
  let offset = 0;

  while (true) {
    const response = await axios.get(
      `${BASE_URL}/messenger/v2/accounts/${USER_ID}/chats`,
      { headers, params: { limit: PAGE, offset } }
    );
    const chats = response.data.chats || [];
    allChats.push(...chats);

    if (!response.data.meta?.has_more || chats.length < PAGE) break;

    const lastChat = chats[chats.length - 1];
    const lastCreated = lastChat?.last_message?.created || 0;
    const ageDays = (Date.now() / 1000 - lastCreated) / 86400;
    if (ageDays > maxAgeDays) break;

    offset += PAGE;
  }

  return allChats;
}

// При старте: помечаем последнее сообщение каждого чата как "уже видели"
// Это предотвращает ответы на старые сообщения
async function initProcessed() {
  logger.info('Initializing: scanning existing chats...');
  const chats = await getAllChats(30);
  let skippedProactive = 0;

  for (const chat of chats) {
    const last = chat.last_message;
    const lastId = last?.id;
    const text = last?.content?.text || '';
    const ageHours = last?.created ? (Date.now() / 1000 - Number(last.created)) / 3600 : Infinity;
    if (
      lastId &&
      String(last.author_id) !== String(USER_ID) &&
      isProactiveAvitoTriggerText(text) &&
      ageHours <= PROACTIVE_STARTUP_WINDOW_HOURS
    ) {
      skippedProactive++;
      continue;
    }
    if (lastId) processedMessageIds.add(lastId);
  }

  logger.info(`Initialized: ${processedMessageIds.size} existing messages marked as seen. Proactive system prompts left for reply: ${skippedProactive}. Bot will only respond to NEW messages plus fresh proactive system prompts.`);
}

// Возвращает чаты где последнее сообщение — НОВОЕ (не помеченное) от клиента
async function getChatsNeedingReply() {
  const chats = await getAllChats(30);

  return chats.filter((chat) => {
    const last = chat.last_message;
    if (!last) return false;
    // Только от клиента (не от нас)
    if (String(last.author_id) === String(USER_ID)) return false;
    const text = last.content?.text || '';
    if (isProactiveAvitoTriggerText(text)) {
      if (processedMessageIds.has(last.id)) return false;
      return true;
    }
    // Только текст
    if (last.type && last.type !== 'text') return false;
    if (text.startsWith('[Системное сообщение]')) return false;
    if (!text.trim()) return false;
    // Только НОВЫЕ — не виденные при старте и не уже обработанные
    if (processedMessageIds.has(last.id)) return false;
    return true;
  });
}

async function getChatMessages(chatId) {
  const headers = await authHeaders();
  const response = await axios.get(
    `${BASE_URL}/messenger/v3/accounts/${USER_ID}/chats/${chatId}/messages/`,
    { headers, params: { limit: 20 } }
  );
  return response.data.messages || [];
}

async function sendMessage(chatId, text) {
  const headers = await authHeaders();
  await axios.post(
    `${BASE_URL}/messenger/v1/accounts/${USER_ID}/chats/${chatId}/messages`,
    { message: { text }, type: 'text' },
    { headers }
  );
}

async function markChatRead(chatId) {
  try {
    const headers = await authHeaders();
    await axios.post(
      `${BASE_URL}/messenger/v1/accounts/${USER_ID}/chats/${chatId}/read`,
      {},
      { headers }
    );
  } catch (err) {
    logger.warn(`markChatRead failed for ${chatId}: ${err.message}`);
  }
}

function isProcessed(messageId) {
  return processedMessageIds.has(messageId);
}

function markProcessed(messageId) {
  processedMessageIds.add(messageId);
}

function isOwnMessage(message) {
  return String(message.author_id) === String(USER_ID);
}

module.exports = {
  initProcessed,
  getAllChats,
  getChatsNeedingReply,
  getChatMessages,
  sendMessage,
  markChatRead,
  isProcessed,
  markProcessed,
  isOwnMessage,
  authHeaders,
};
