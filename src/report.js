'use strict';

require('dotenv').config({ override: true });
const axios = require('axios');
const logger = require('./logger');
const stats = require('./stats');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function fmtTime(date) {
  return date.toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function sendDailyReport() {
  const s = stats.getAndReset();

  const period = `${fmtTime(s.periodStart)} — ${fmtTime(s.periodEnd)}`;

  const convRate = s.chatsReplied > 0
    ? Math.round((s.leadsTotal / s.chatsReplied) * 100)
    : 0;
  const avgIncomingPerChat = s.chatsReplied > 0 ? (s.messagesReceived / s.chatsReplied).toFixed(1) : '0.0';
  const avgOutgoingPerChat = s.chatsReplied > 0 ? (s.messagesSent / s.chatsReplied).toFixed(1) : '0.0';
  const chatsWithoutLead = Math.max(s.chatsReplied - s.leadsTotal, 0);
  const replyCoverage = s.messagesReceived > 0 ? Math.round((s.messagesSent / s.messagesReceived) * 100) : 0;
  const phonesText = s.phonesCollected.length > 0 ? s.phonesCollected.join(', ') : 'нет';
  const totalActivity = s.messagesReceived + s.messagesSent + s.leadsTotal;

  let statusLine = 'Диалоги идут в штатном режиме.';
  if (totalActivity === 0) {
    statusLine = 'За этот период активность не зафиксирована.';
  } else if (s.messagesReceived > 0 && s.leadsTotal === 0) {
    statusLine = 'Есть входящие, но заявок пока нет. Нужно проверить чаты без телефона.';
  }

  const text =
    `📊 <b>Отчет по работе Алины</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `🕐 <b>Период:</b> ${period}\n` +
    `💬 <b>Чатов с ответом:</b> ${s.chatsReplied}\n` +
    `📥 <b>Входящих сообщений:</b> ${s.messagesReceived}\n` +
    `📤 <b>Исходящих сообщений:</b> ${s.messagesSent}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📝 <b>Заявок отправлено:</b> ${s.leadsTotal}\n` +
    `📞 <b>Собрано телефонов:</b> ${s.phonesCollected.length}\n` +
    `📋 <b>Телефоны:</b> ${phonesText}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `📈 <b>Конверсия в заявки:</b> ${convRate}%\n` +
    `📎 <b>Чатов без заявки:</b> ${chatsWithoutLead}\n` +
    `⚙️ <b>Среднее входящих на чат:</b> ${avgIncomingPerChat}\n` +
    `⚙️ <b>Среднее исходящих на чат:</b> ${avgOutgoingPerChat}\n` +
    `🧭 <b>Покрытие ответами:</b> ${replyCoverage}%\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${statusLine}`;

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
    });
    logger.info('Daily report sent to Telegram');
  } catch (err) {
    logger.error(`Report send failed: ${err.message}`);
  }
}

// Планировщик: запускать в 10:00 и 22:00 по Красноярску (UTC+7)
function scheduleReports() {
  const KRASNOYARSK_OFFSET = 7 * 60; // минут

  function msUntilNext(targetHour) {
    const now = new Date();
    const nowKrsk = new Date(now.getTime() + KRASNOYARSK_OFFSET * 60 * 1000);

    const next = new Date(nowKrsk);
    next.setUTCHours(targetHour - 7, 0, 0, 0); // переводим обратно в UTC
    if (next <= nowKrsk) next.setUTCDate(next.getUTCDate() + 1);

    return next.getTime() - now.getTime();
  }

  function scheduleOne(hour, label) {
    const delay = msUntilNext(hour);
    const inMinutes = Math.round(delay / 60000);
    logger.info(`Report "${label}" scheduled in ${inMinutes} min`);

    setTimeout(async () => {
      await sendDailyReport();
      // Перепланировать на следующий день
      scheduleOne(hour, label);
    }, delay);
  }

  scheduleOne(10, 'утренний 10:00');
  scheduleOne(22, 'вечерний 22:00');
}

module.exports = { sendDailyReport, scheduleReports };
