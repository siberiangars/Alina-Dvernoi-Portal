'use strict';

require('dotenv').config({ override: true });
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const stats = require('./stats');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const KRSK_OFFSET_MS = 7 * 60 * 60 * 1000;
const REPORT_STATE_FILE = path.join(process.cwd(), 'data', 'report_state.json');
const DUPLICATE_REPORT_WINDOW_MS = 5 * 60 * 1000;
const DEEPSEEK_BALANCE_URL = process.env.DEEPSEEK_BALANCE_URL || 'https://api.deepseek.com/user/balance';

const T = {
  title: '\uD83D\uDCCA <b>\u041e\u0442\u0447\u0435\u0442 \u043f\u043e \u0440\u0430\u0431\u043e\u0442\u0435 \u0410\u043b\u0438\u043d\u044b</b>',
  line: '\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501',
  noPhones: '\u043d\u0435\u0442',
  ok: '\u0414\u0438\u0430\u043b\u043e\u0433\u0438 \u0438\u0434\u0443\u0442 \u0432 \u0448\u0442\u0430\u0442\u043d\u043e\u043c \u0440\u0435\u0436\u0438\u043c\u0435.',
  idle: '\u0417\u0430 \u044d\u0442\u043e\u0442 \u043f\u0435\u0440\u0438\u043e\u0434 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u044c \u043d\u0435 \u0437\u0430\u0444\u0438\u043a\u0441\u0438\u0440\u043e\u0432\u0430\u043d\u0430.',
  noLeads: '\u0415\u0441\u0442\u044c \u0432\u0445\u043e\u0434\u044f\u0449\u0438\u0435, \u043d\u043e \u0437\u0430\u044f\u0432\u043e\u043a \u043f\u043e\u043a\u0430 \u043d\u0435\u0442. \u041d\u0443\u0436\u043d\u043e \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0447\u0430\u0442\u044b \u0431\u0435\u0437 \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0430.',
};

function fmtTime(date) {
  return date.toLocaleString('ru-RU', {
    timeZone: 'Asia/Krasnoyarsk',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function msUntilNextKrskHour(targetHour) {
  const now = new Date();
  const krskNow = new Date(now.getTime() + KRSK_OFFSET_MS);
  const target = new Date(krskNow);
  target.setUTCHours(targetHour, 0, 0, 0);
  if (target <= krskNow) target.setUTCDate(target.getUTCDate() + 1);
  return target.getTime() - krskNow.getTime();
}

function krskSlotKey(hour) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Krasnoyarsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}-${String(hour).padStart(2, '0')}`;
}

function krskDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Krasnoyarsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function readReportState() {
  try {
    if (!fs.existsSync(REPORT_STATE_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(REPORT_STATE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeReportState(state) {
  fs.mkdirSync(path.dirname(REPORT_STATE_FILE), { recursive: true });
  fs.writeFileSync(REPORT_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function reserveReportSlot(hour) {
  if (hour === undefined || hour === null) return true;
  const key = krskSlotKey(hour);
  const state = readReportState();
  const last = state[key];
  if (last && Date.now() - Number(last) < DUPLICATE_REPORT_WINDOW_MS) {
    logger.warn(`Duplicate report skipped for slot ${key}`);
    return false;
  }
  state[key] = Date.now();
  writeReportState(state);
  return true;
}

function shouldIncludeDeepSeekBilling(hour) {
  return Number(hour) === 22;
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'нет данных';
  return n.toFixed(4).replace(/\.?0+$/, '') || '0';
}

function parseDeepSeekBalance(data) {
  const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
  const usd = infos.find((item) => item?.currency === 'USD') || infos[0];
  if (!usd) return null;
  const total = Number(usd.total_balance);
  if (!Number.isFinite(total)) return null;
  return {
    currency: usd.currency || 'USD',
    total,
  };
}

async function fetchDeepSeekBalance() {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { error: 'ключ DeepSeek не задан' };
  }

  try {
    const response = await axios.get(DEEPSEEK_BALANCE_URL, {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      timeout: 10000,
    });
    const balance = parseDeepSeekBalance(response.data);
    if (!balance) return { error: 'DeepSeek вернул баланс в неизвестном формате' };
    return { balance };
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    logger.warn(`DeepSeek balance fetch failed: ${detail}`);
    return { error: 'не удалось получить баланс DeepSeek' };
  }
}

function updateDeepSeekBillingState(balance) {
  const dayKey = krskDayKey();
  const state = readReportState();
  const billing = state.deepseekBilling || {};
  const current = Number(balance.total);
  let start = Number(billing.startBalance);
  let note = null;

  if (billing.dayKey !== dayKey || !Number.isFinite(start)) {
    start = current;
    note = 'расход считаем с первого замера баланса за сегодня';
  }

  let spentToday = start - current;
  if (spentToday < -0.000001) {
    note = 'баланс пополнялся сегодня, расход по разнице баланса не считаем';
    start = current;
    spentToday = 0;
  }

  state.deepseekBilling = {
    dayKey,
    currency: balance.currency,
    startBalance: start,
    lastBalance: current,
    updatedAt: Date.now(),
  };
  writeReportState(state);

  return {
    balance,
    spentToday: Math.max(spentToday, 0),
    note,
  };
}

async function getDeepSeekBillingSummary() {
  const result = await fetchDeepSeekBalance();
  if (result.error) return { error: result.error };
  return updateDeepSeekBillingStateClean(result.balance);
}

function formatDeepSeekBillingBlock(summary) {
  if (!summary || summary.error) {
    return `\n${T.line}\n💳 <b>Баланс DeepSeek:</b> не удалось получить\n📉 <b>Потрачено сегодня:</b> нет данных`;
  }

  const balanceText = `${formatMoney(summary.balance.total)} ${summary.balance.currency}`;
  const spentText = `${formatMoney(summary.spentToday)} ${summary.balance.currency}`;
  const noteText = summary.note ? `\nℹ️ <b>Примечание:</b> ${summary.note}` : '';

  return (
    `\n${T.line}\n` +
    `💳 <b>Баланс DeepSeek:</b> ${balanceText}\n` +
    `📉 <b>Потрачено сегодня:</b> ${spentText}` +
    noteText
  );
}

function formatBillingMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '\u043d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445';
  return n.toFixed(4).replace(/\.?0+$/, '') || '0';
}

function updateDeepSeekBillingStateClean(balance) {
  const dayKey = krskDayKey();
  const state = readReportState();
  const billing = state.deepseekBilling || {};
  const current = Number(balance.total);
  let start = Number(billing.startBalance);
  let note = null;

  if (billing.dayKey !== dayKey || !Number.isFinite(start)) {
    start = current;
    note = '\u0440\u0430\u0441\u0445\u043e\u0434 \u0441\u0447\u0438\u0442\u0430\u0435\u043c \u0441 \u043f\u0435\u0440\u0432\u043e\u0433\u043e \u0437\u0430\u043c\u0435\u0440\u0430 \u0431\u0430\u043b\u0430\u043d\u0441\u0430 \u0437\u0430 \u0441\u0435\u0433\u043e\u0434\u043d\u044f';
  }

  let spentToday = start - current;
  if (spentToday < -0.000001) {
    note = '\u0431\u0430\u043b\u0430\u043d\u0441 \u043f\u043e\u043f\u043e\u043b\u043d\u044f\u043b\u0441\u044f \u0441\u0435\u0433\u043e\u0434\u043d\u044f, \u0440\u0430\u0441\u0445\u043e\u0434 \u043f\u043e \u0440\u0430\u0437\u043d\u0438\u0446\u0435 \u0431\u0430\u043b\u0430\u043d\u0441\u0430 \u043d\u0435 \u0441\u0447\u0438\u0442\u0430\u0435\u043c';
    start = current;
    spentToday = 0;
  }

  state.deepseekBilling = {
    dayKey,
    currency: balance.currency,
    startBalance: start,
    lastBalance: current,
    updatedAt: Date.now(),
  };
  writeReportState(state);

  return {
    balance,
    spentToday: Math.max(spentToday, 0),
    note,
  };
}

function formatDeepSeekBillingBlockClean(summary) {
  if (!summary || summary.error) {
    return (
      `\n${T.line}\n` +
      `\uD83D\uDD11 <b>\u0411\u0430\u043b\u0430\u043d\u0441 \u043a\u043b\u044e\u0447\u0430 DeepSeek</b>\n` +
      `\uD83D\uDCB0 <b>\u041e\u0441\u0442\u0430\u043b\u043e\u0441\u044c \u043d\u0430 \u0431\u0430\u043b\u0430\u043d\u0441\u0435:</b> \u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c\n` +
      `\uD83D\uDCC9 <b>\u041f\u043e\u0442\u0440\u0430\u0447\u0435\u043d\u043e \u0441\u0435\u0433\u043e\u0434\u043d\u044f:</b> \u043d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445`
    );
  }

  const balanceText = `${formatBillingMoney(summary.balance.total)} ${summary.balance.currency}`;
  const spentText = `${formatBillingMoney(summary.spentToday)} ${summary.balance.currency}`;
  const noteText = summary.note
    ? `\n\u2139\uFE0F <b>\u041f\u0440\u0438\u043c\u0435\u0447\u0430\u043d\u0438\u0435:</b> ${summary.note}`
    : '';

  return (
    `\n${T.line}\n` +
    `\uD83D\uDD11 <b>\u0411\u0430\u043b\u0430\u043d\u0441 \u043a\u043b\u044e\u0447\u0430 DeepSeek</b>\n` +
    `\uD83D\uDCB0 <b>\u041e\u0441\u0442\u0430\u043b\u043e\u0441\u044c \u043d\u0430 \u0431\u0430\u043b\u0430\u043d\u0441\u0435:</b> ${balanceText}\n` +
    `\uD83D\uDCC9 <b>\u041f\u043e\u0442\u0440\u0430\u0447\u0435\u043d\u043e \u0441\u0435\u0433\u043e\u0434\u043d\u044f:</b> ${spentText}` +
    noteText
  );
}

async function sendDailyReport(hour = null) {
  if (!reserveReportSlot(hour)) return;

  const s = stats.getAndReset();
  const deepSeekBilling = await getDeepSeekBillingSummary();
  const deepSeekBillingBlock = shouldIncludeDeepSeekBilling(hour)
    ? formatDeepSeekBillingBlockClean(deepSeekBilling)
    : '';
  const period = `${fmtTime(s.periodStart)} - ${fmtTime(s.periodEnd)}`;
  const convRate = s.chatsReplied > 0 ? Math.round((s.leadsTotal / s.chatsReplied) * 100) : 0;
  const chatsWithoutLead = Math.max(s.chatsReplied - s.leadsTotal, 0);
  const replyCoverage = s.messagesReceived > 0 ? Math.round((s.messagesSent / s.messagesReceived) * 100) : 0;
  const phonesText = s.phonesCollected.length > 0 ? s.phonesCollected.join(', ') : T.noPhones;
  const totalActivity = s.messagesReceived + s.messagesSent + s.leadsTotal;

  let statusLine = T.ok;
  if (totalActivity === 0) statusLine = T.idle;
  else if (s.messagesReceived > 0 && s.leadsTotal === 0) statusLine = T.noLeads;

  const text =
    `${T.title}\n` +
    `${T.line}\n` +
    `\uD83D\uDD50 <b>\u041f\u0435\u0440\u0438\u043e\u0434:</b> ${period}\n` +
    `\uD83D\uDCAC <b>\u0427\u0430\u0442\u043e\u0432 \u0441 \u043e\u0442\u0432\u0435\u0442\u043e\u043c:</b> ${s.chatsReplied}\n` +
    `\uD83D\uDCE5 <b>\u0412\u0445\u043e\u0434\u044f\u0449\u0438\u0445 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439:</b> ${s.messagesReceived}\n` +
    `\uD83D\uDCE4 <b>\u0418\u0441\u0445\u043e\u0434\u044f\u0449\u0438\u0445 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439:</b> ${s.messagesSent}\n` +
    `${T.line}\n` +
    `\uD83D\uDCDD <b>\u0417\u0430\u044f\u0432\u043e\u043a \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e:</b> ${s.leadsTotal}\n` +
    `\uD83D\uDCDE <b>\u0421\u043e\u0431\u0440\u0430\u043d\u043e \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u043e\u0432:</b> ${s.phonesCollected.length}\n` +
    `\uD83D\uDCCB <b>\u0422\u0435\u043b\u0435\u0444\u043e\u043d\u044b:</b> ${phonesText}\n` +
    `${T.line}\n` +
    `\uD83D\uDCC8 <b>\u041a\u043e\u043d\u0432\u0435\u0440\u0441\u0438\u044f \u0432 \u0437\u0430\u044f\u0432\u043a\u0438:</b> ${convRate}%\n` +
    `\uD83D\uDCCE <b>\u0427\u0430\u0442\u043e\u0432 \u0431\u0435\u0437 \u0437\u0430\u044f\u0432\u043a\u0438:</b> ${chatsWithoutLead}\n` +
    `\uD83E\uDDED <b>\u041f\u043e\u043a\u0440\u044b\u0442\u0438\u0435 \u043e\u0442\u0432\u0435\u0442\u0430\u043c\u0438:</b> ${replyCoverage}%\n` +
    `${deepSeekBillingBlock}\n` +
    `${T.line}\n` +
    `${statusLine}`;

  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
    });
    logger.info('Daily report sent to Telegram');
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    logger.error(`Report send failed: ${detail}`);
  }
}

function scheduleReports() {
  function scheduleOne(hour, label) {
    const delay = msUntilNextKrskHour(hour);
    const inMinutes = Math.round(delay / 60000);
    logger.info(`Report "${label}" scheduled in ${inMinutes} min`);

    setTimeout(async () => {
      await sendDailyReport(hour);
      scheduleOne(hour, label);
    }, delay);
  }

  scheduleOne(10, '\u0443\u0442\u0440\u0435\u043d\u043d\u0438\u0439 10:00');
  scheduleOne(22, '\u0432\u0435\u0447\u0435\u0440\u043d\u0438\u0439 22:00');
}

module.exports = {
  sendDailyReport,
  scheduleReports,
  msUntilNextKrskHour,
  __test: {
    formatDeepSeekBillingBlock: formatDeepSeekBillingBlockClean,
    shouldIncludeDeepSeekBilling,
    parseDeepSeekBalance,
    updateDeepSeekBillingState: updateDeepSeekBillingStateClean,
  },
};
