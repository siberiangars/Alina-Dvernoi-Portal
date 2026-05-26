'use strict';

function looksLikeTimeCommitment(text) {
  const t = (text || '').toLowerCase();
  return /(завтра|сегодня|вчера|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)/.test(t);
}

function userAskedTime(userText) {
  const t = (userText || '').toLowerCase();
  return /(когда|завтра|сегодня|вчера|дата|во сколько|время)/.test(t);
}

function stripUrls(text) {
  const allowed = 'https://двернойпортал.рф';
  return (text || '').replace(/https?:\/\/\S+/gi, (url) => {
    const suffix = (url.match(/[,.!?;:]+$/) || [''])[0];
    const bare = suffix ? url.slice(0, -suffix.length) : url;
    return bare === allowed ? `${bare}${suffix}` : '';
  }).replace(/\s{2,}/g, ' ').trim();
}

function stripMarkdown(text) {
  return (text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .trim();
}

function looksMaskedPhone(text) {
  const t = (text || '').toLowerCase();
  return /\+7\s*\(?x{2,}\)?/i.test(t) || /\+7\s*\(?х{2,}\)?/i.test(t) || /xxx-xx-xx/i.test(t);
}

function normalizeCompanyPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    const d = '7' + digits.slice(1);
    return `+7-${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
  }
  if (digits.length === 10 && digits.startsWith('9')) {
    return `+7-${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
  }
  return raw || '';
}

function trimSentences(text, maxSentences = 3) {
  const parts = (text || '').split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, maxSentences).join(' ').trim();
}

function sanitizeReply(reply, { lastUserText = '' } = {}) {
  let out = (reply || '').trim();
  if (!out) return 'Подскажите, пожалуйста, подробнее по вашему вопросу.';

  out = stripUrls(out);
  out = stripMarkdown(out);
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(/whatsapp|viber|вайбер/gi, 'Telegram или Max');
  out = out.replace(/as an ai|language model|i am a bot/gi, '');

  if (/\?{4,}/.test(out) || (out.match(/\?/g) || []).length >= 10) {
    return 'Поняла вас. Подскажите, пожалуйста, подробнее по вашему вопросу.';
  }

  if (looksLikeTimeCommitment(out) && !userAskedTime(lastUserText)) {
    out = out
      .replace(/\b(завтра|сегодня|вчера)\b/gi, 'в ближайшее время')
      .replace(/\b(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\b/gi, 'ближайший удобный день');
  }

  const companyPhone = normalizeCompanyPhone(process.env.COMPANY_PHONE || '');
  if (looksMaskedPhone(out)) {
    if (companyPhone) {
      out = out.replace(/\+7[\s\S]*?X{2,}[\s\S]*?X{2,}[\s\S]*?X{2,}/gi, companyPhone);
      out = out.replace(/\+7[\s\S]*?Х{2,}[\s\S]*?Х{2,}[\s\S]*?Х{2,}/gi, companyPhone);
      out = out.replace(/\+7\s*\(XXX\)\s*XXX-XX-XX/gi, companyPhone);
    } else {
      out = out.replace(/\+7\s*\(XXX\)\s*XXX-XX-XX/gi, '').replace(/\s{2,}/g, ' ').trim();
    }
  }

  out = trimSentences(out, 3);
  if (!out || /^(1\.|\d+\)|:)$/.test(out)) {
    return 'Подскажите, пожалуйста, подробнее по вашему вопросу.';
  }
  return out;
}

module.exports = { sanitizeReply };
