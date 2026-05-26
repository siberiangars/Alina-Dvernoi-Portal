'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const LEADS_FILE = path.join(process.cwd(), 'data', 'leads_sent.json');

// Загрузка: { chatId: timestamp }
function load() {
  try { return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')); } catch { return {}; }
}

function save(data) {
  try { fs.writeFileSync(LEADS_FILE, JSON.stringify(data, null, 2)); } catch (e) {
    logger.warn(`leads_sent.json save failed: ${e.message}`);
  }
}

// Пометить чат как завершённый (заявка отправлена)
function markLeadSent(chatId) {
  const data = load();
  data[chatId] = Math.floor(Date.now() / 1000);
  save(data);
}

// Проверить — была ли отправлена заявка по этому чату
function isLeadSent(chatId) {
  const data = load();
  return !!data[chatId];
}

// Получить весь список chatId с заявками
function getAllLeadChatIds() {
  return Object.keys(load());
}

module.exports = { markLeadSent, isLeadSent, getAllLeadChatIds };
