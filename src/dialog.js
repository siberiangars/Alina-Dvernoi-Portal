'use strict';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;  // 1 час

const sessions = new Map();

function createSession(chatId) {
  return {
    chatId,
    messages: [],
    collectedData: {
      name: null,
      nameSource: null,
      phone: null,           // валидный номер телефона
      phoneRaw: null,        // что написал клиент (если невалидный)
      phoneInvalid: false,   // true = попросить перепроверить
      messenger: null,       // 'telegram' | 'max' | null
      address: null,         // адрес или район
      doorStatus: null,      // 'куплены' | 'нужно подобрать' | null
      doorType: null,        // 'входная' | 'межкомнатная' | 'обе' | null
      quantity: null,        // количество дверей
      needsInstall: null,    // нужна установка: true/false/null
      readyProems: null,     // готовы ли проёмы: true/false/null
      additionalWork: null,  // доп. работы: строка или null
      notes: null,           // прочие детали
    },
    leadSent: false,
    lastActivity: Date.now(),
  };
}

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, createSession(chatId));
  }
  const session = sessions.get(chatId);
  session.lastActivity = Date.now();
  return session;
}

function hasSession(chatId) {
  return sessions.has(chatId);
}

function addMessage(chatId, role, content) {
  const session = getSession(chatId);
  session.messages.push({ role, content });
}

function mergeData(chatId, extracted) {
  const session = getSession(chatId);
  for (const [key, value] of Object.entries(extracted)) {
    if (value !== null && value !== undefined) {
      session.collectedData[key] = value;
    }
  }
}

function cleanupSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [chatId, session] of sessions.entries()) {
    if (session.lastActivity < cutoff) {
      sessions.delete(chatId);
    }
  }
}

setInterval(cleanupSessions, CLEANUP_INTERVAL_MS).unref();

module.exports = { getSession, hasSession, addMessage, mergeData };
