'use strict';

// Накопленная статистика с момента последнего сброса
const stats = {
  periodStart: new Date(),
  chatsReplied: new Set(),    // уникальные chat_id которым ответили
  messagesReceived: 0,        // входящих от клиентов
  messagesSent: 0,            // исходящих от Алины
  leadsTotal: 0,              // заявок отправлено в Telegram
  phonesCollected: new Set(), // уникальные телефоны
  errors: 0,                  // ошибок
};

function incReceived(chatId) {
  stats.messagesReceived++;
  stats.chatsReplied.add(chatId);
}

function incSent() {
  stats.messagesSent++;
}

function incLead(phone) {
  stats.leadsTotal++;
  if (phone) stats.phonesCollected.add(phone);
}

function incError() {
  stats.errors++;
}

function addPhone(phone) {
  if (phone) stats.phonesCollected.add(phone);
}

function getAndReset() {
  const snapshot = {
    periodStart: stats.periodStart,
    periodEnd: new Date(),
    chatsReplied: stats.chatsReplied.size,
    messagesReceived: stats.messagesReceived,
    messagesSent: stats.messagesSent,
    leadsTotal: stats.leadsTotal,
    phonesCollected: [...stats.phonesCollected],
    errors: stats.errors,
  };

  // Сброс
  stats.periodStart = new Date();
  stats.chatsReplied.clear();
  stats.messagesReceived = 0;
  stats.messagesSent = 0;
  stats.leadsTotal = 0;
  stats.phonesCollected.clear();
  stats.errors = 0;

  return snapshot;
}

module.exports = { incReceived, incSent, incLead, incError, addPhone, getAndReset };
