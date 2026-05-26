'use strict';

/**
 * Хранит chat_id где оператор написал вручную.
 * Бот не отвечает в заблокированных чатах.
 * Блокировка снимается если клиент пишет снова через 24 часа
 * (чтобы не забывать про новые обращения).
 */

const LOCK_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

const locks = new Map(); // chatId -> timestamp блокировки

function lock(chatId) {
  locks.set(chatId, Date.now());
}

function isLocked(chatId) {
  const ts = locks.get(chatId);
  if (!ts) return false;
  // Блокировка истекла — снимаем
  if (Date.now() - ts > LOCK_TTL_MS) {
    locks.delete(chatId);
    return false;
  }
  return true;
}

function unlock(chatId) {
  locks.delete(chatId);
}

module.exports = { lock, isLocked, unlock };
