'use strict';

require('dotenv').config({ override: true });
const axios = require('axios');
const logger = require('./logger');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const T = {
  unknown: '\u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0432\u044b\u044f\u0441\u043d\u0438\u0442\u044c',
  noData: '\u043d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445',
  defaultComment: '\u041f\u0435\u0440\u0435\u0434\u0430\u0442\u044c \u043c\u0430\u0441\u0442\u0435\u0440\u0443/\u043c\u0435\u043d\u0435\u0434\u0436\u0435\u0440\u0443 \u0434\u043b\u044f \u0443\u0442\u043e\u0447\u043d\u0435\u043d\u0438\u044f \u0434\u0435\u0442\u0430\u043b\u0435\u0439',
  yes: '\u0434\u0430',
  no: '\u043d\u0435\u0442',
  ready: '\u0433\u043e\u0442\u043e\u0432\u044b',
  notReady: '\u043d\u0435 \u0433\u043e\u0442\u043e\u0432\u044b',
};

function cleanText(value, fallback = T.unknown) {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value).trim();
  if (!text) return fallback;
  if (/\?{2,}/.test(text)) return fallback;
  return text;
}

function formatMessenger(value) {
  if (value === 'telegram') return 'Telegram';
  if (value === 'max') return 'Max';
  return T.unknown;
}

function formatInstall(value) {
  if (value === true) return T.yes;
  if (value === false) return T.no;
  return T.unknown;
}

function formatProems(value) {
  if (value === true) return T.ready;
  if (value === false) return T.notReady;
  return T.unknown;
}

async function sendTelegramMessage(text) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML',
  });
}

async function sendLead(chatId, collectedData) {
  const {
    name,
    phone,
    messenger,
    address,
    doorStatus,
    doorType,
    quantity,
    needsInstall,
    readyProems,
    additionalWork,
    notes,
  } = collectedData;

  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk' });
  const qtyText = quantity ? `${quantity} \u0448\u0442.` : T.unknown;

  const text =
    `\uD83D\uDEA6 <b>\u041d\u043e\u0432\u0430\u044f \u0437\u0430\u044f\u0432\u043a\u0430 \u0441 \u0410\u0432\u0438\u0442\u043e</b>\n` +
    `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
    `\uD83D\uDC64 <b>\u041a\u043b\u0438\u0435\u043d\u0442:</b> ${cleanText(name)}\n` +
    `\uD83D\uDCDE <b>\u0422\u0435\u043b\u0435\u0444\u043e\u043d:</b> ${cleanText(phone)}\n` +
    `\uD83D\uDCAC <b>\u041c\u0435\u0441\u0441\u0435\u043d\u0434\u0436\u0435\u0440:</b> ${formatMessenger(messenger)}\n` +
    `\uD83D\uDCCD <b>\u0410\u0434\u0440\u0435\u0441:</b> ${cleanText(address)}\n` +
    `\uD83D\uDEAA <b>\u0422\u0438\u043f \u0434\u0432\u0435\u0440\u0435\u0439:</b> ${cleanText(doorType)}\n` +
    `\uD83D\uDCE6 <b>\u0421\u0442\u0430\u0442\u0443\u0441:</b> ${cleanText(doorStatus)}\n` +
    `\uD83D\uDD22 <b>\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e:</b> ${qtyText}\n` +
    `\uD83D\uDD27 <b>\u0423\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0430:</b> ${formatInstall(needsInstall)}\n` +
    `\uD83D\uDCD0 <b>\u041f\u0440\u043e\u0435\u043c\u044b:</b> ${formatProems(readyProems)}\n` +
    `\uD83D\uDEE0 <b>\u0414\u043e\u043f. \u0440\u0430\u0431\u043e\u0442\u044b:</b> ${cleanText(additionalWork, T.noData)}\n` +
    `\uD83D\uDCDD <b>\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439:</b> ${cleanText(notes, T.defaultComment)}\n` +
    `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
    `\uD83D\uDD50 <b>\u0412\u0440\u0435\u043c\u044f:</b> ${now}\n` +
    `\uD83D\uDD16 <b>ID \u0447\u0430\u0442\u0430:</b> <code>${chatId}</code>`;

  try {
    await sendTelegramMessage(text);
    logger.info(`Telegram lead sent: chatId=${chatId} phone=${phone}`);
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    logger.error(`Telegram sendLead failed: ${detail}`);
  }
}

async function sendAttention(chatId, data = {}) {
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk' });
  const text =
    `\u26A0\uFE0F <b>\u041d\u0443\u0436\u043d\u043e \u0432\u043d\u0438\u043c\u0430\u043d\u0438\u0435</b>\n` +
    `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n` +
    `\uD83D\uDC64 <b>\u041a\u043b\u0438\u0435\u043d\u0442:</b> ${cleanText(data.name)}\n` +
    `\uD83D\uDCDD <b>\u0421\u0438\u0442\u0443\u0430\u0446\u0438\u044f:</b> ${cleanText(data.reason)}\n` +
    `\uD83D\uDCA1 <b>\u0427\u0442\u043e \u0441\u0434\u0435\u043b\u0430\u0442\u044c:</b> ${cleanText(data.action)}\n` +
    `\uD83D\uDCAC <b>\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435:</b> ${cleanText(data.lastMessage, T.noData)}\n` +
    `\uD83D\uDD50 <b>\u0412\u0440\u0435\u043c\u044f:</b> ${now}\n` +
    `\uD83D\uDD16 <b>ID \u0447\u0430\u0442\u0430:</b> <code>${chatId}</code>`;

  await sendTelegramMessage(text);
  logger.info(`Telegram attention sent: chatId=${chatId}`);
}

module.exports = { sendLead, sendAttention };
