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

function trimSentences(text, maxSentences = 5) {
  const parts = (text || '').split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, maxSentences).join(' ').trim();
}

function getTimeGreeting() {
  const hour = Number(new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Krasnoyarsk', hour: 'numeric', hour12: false }));
  if (hour < 12) return 'Доброе утро';
  if (hour < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function hasGreeting(text) {
  const t = (text || '').toLowerCase();
  return /^(здравствуйте|доброе утро|добрый день|добрый вечер|приветствую|здравствуй|привет|доброго времени)/i.test(t.trim());
}

function looksLikePriceQuote(text) {
  const t = String(text || '').toLowerCase();
  return (
    /(?:\d[\d\s]{1,8})(?:₽|р\.?|руб(?:\.|лей|ля|ль)?)/iu.test(t) ||
    /(?:от|до|примерно|около|в районе)\s+\d[\d\s]{1,8}/iu.test(t)
  );
}

function userAskedPrice(userText) {
  const t = String(userText || '').toLowerCase();
  return (
    /сколько/iu.test(t) ||
    /цен/iu.test(t) ||
    /стои/iu.test(t) ||
    /рассч/iu.test(t) ||
    /прайс/iu.test(t) ||
    /дорог/iu.test(t)
  );
}

function userAskedMeasurement(userText) {
  const t = String(userText || '').toLowerCase();
  return /замер|измер|обмер|приехать|приезд|выезд/iu.test(t);
}

function userAskedInstall(userText) {
  const t = String(userText || '').toLowerCase();
  return /установ|монтаж|смонтир|вставить|поставить/iu.test(t);
}

function userAskedAddress(userText) {
  const t = String(userText || '').toLowerCase();
  return /(где находитесь|где вы|адрес|куда ехать|куда подъехать|как доехать)/iu.test(t);
}

function hasQuestion(text) {
  return /[?？]/.test(String(text || ''));
}

function removeContradictoryKnownDataQuestions(text, currentData = {}) {
  let out = String(text || '').trim();
  if (currentData.doorStatus || currentData.serviceOnly) {
    out = out
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => !/(уже\s+куплен[аыо]?|купили|куплено)[^.!?]{0,80}(нужно\s+подобр|подобрать|выбрать)/iu.test(sentence))
      .join(' ')
      .trim();
    out = out.replace(/\s*Двер[ьи]\s+уже\s+куплен[аыо]?\s+или\s+нужно\s+подобр[а-яё]+\??/giu, '').trim();
  }
  return out;
}

function nextStepQuestion(lastUserText, currentData = {}) {
  if (currentData.serviceOnly) {
    if (!currentData.address) return 'Скиньте, пожалуйста, фото проёмов и напишите адрес объекта.';
    if (!currentData.phone) return 'Оставьте, пожалуйста, номер телефона — мастер свяжется и сориентирует по работам.';
    if (!currentData.messenger) return 'Куда удобнее написать: Telegram или Max?';
    return 'Передам информацию мастеру, он свяжется и уточнит детали.';
  }
  if (currentData.doorStatus && !currentData.address) {
    return 'Подскажите адрес или район объекта?';
  }
  if (currentData.doorStatus && !currentData.phone) {
    return 'Оставьте, пожалуйста, номер телефона — мастер свяжется и сориентирует по установке.';
  }
  if (currentData.doorStatus && !currentData.messenger) {
    return 'Куда удобнее написать: Telegram или Max?';
  }
  const t = String(lastUserText || '').toLowerCase();
  if (/замер|мониторинг|установ/iu.test(t)) {
    return 'Дверь уже куплена или нужно подобрать?';
  }
  if (/входн|терморазрыв|метал/iu.test(t)) {
    return 'Дверь нужна с монтажом?';
  }
  if (/межкомнат|добор|наличник|замок/iu.test(t)) {
    return 'Сколько дверей нужно и монтаж потребуется?';
  }
  return 'Дверь уже куплена или нужно подобрать?';
}

function safePriceReply(lastUserText, { needsGreeting = false, currentData = {} } = {}) {
  const intro = needsGreeting
    ? getTimeGreeting() + '! Меня зовут Алина, менеджер магазина Дверной Портал. '
    : '';
  const base = `${intro}Точную стоимость рассчитывает мастер: все зависит от двери, проема и дополнительных работ.`;
  if (userAskedPrice(lastUserText)) {
    return `${base} ${nextStepQuestion(lastUserText, currentData)}`;
  }
  return `${base} Я передам запрос мастеру для расчета.`;
}

function smartFallback(lastUserText, currentData = {}, needsGreeting = false) {
  // Генерируем осмысленный фоллбэк вместо тупого «Подскажите подробнее»
  const t = String(lastUserText || '').toLowerCase();

  if (userAskedAddress(t)) {
    return 'Мы находимся в Красноярске, улица Карамзина 10. Работаем пн-пт 11:30-19:00, сб 11:30-17:00. Какая дверь вас интересует?';
  }

  if (userAskedMeasurement(t)) {
    if (currentData.doorStatus || currentData.serviceOnly) {
      return 'Поняла насчёт замера. Оставьте адрес и номер телефона — мастер свяжется и договорится о выезде.';
    }
    return 'Поняла насчёт замера. Дверь уже куплена или нужно подобрать?';
  }

  if (userAskedInstall(t)) {
    if (currentData.serviceOnly) {
      return 'Поняла, нужны работы по установке. Скиньте фото проёмов и напишите адрес объекта — мастер сориентирует по расчёту.';
    }
    if (currentData.doorStatus === 'нужно подобрать') {
      return 'Поняла, нужна установка. Для начала — какую дверь рассматриваете: входную или межкомнатную?';
    }
    if (currentData.doorStatus === 'куплены') {
      return 'Поняла, нужна установка готовой двери. Оставьте адрес и телефон — мастер сориентирует по стоимости и времени.';
    }
    return 'Дверь уже куплена или нужно подобрать? И нужна ли установка?';
  }

  if (userAskedPrice(t)) {
    return safePriceReply(lastUserText, { needsGreeting, currentData });
  }

  // Общий фоллбэк с учётом состояния
  const question = nextStepQuestion(lastUserText, currentData);
  const greeting = needsGreeting ? getTimeGreeting() + '! ' : '';
  return `${greeting}${question}`;
}

function sanitizeReply(reply, { lastUserText = '', needsGreeting = false, currentData = {} } = {}) {
  let out = (reply || '').trim();
  if (!out) return smartFallback(lastUserText, currentData, needsGreeting);

  out = stripUrls(out);
  out = stripMarkdown(out);
  out = out.replace(/Меня зовут Алина,\s*менедж\.(?=\s|$)/iu, 'Меня зовут Алина, менеджер магазина Дверной Портал.');
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(/whatsapp|viber|вайбер/gi, 'Telegram или Max');
  out = out.replace(/as an ai|language model|i am a bot/gi, '');

  // Enforce greeting on first message — DeepSeek sometimes skips it
  if (needsGreeting && !hasGreeting(out)) {
    const hasFullIntro = /меня зовут алина/i.test(out.toLowerCase());
    const prefix = hasFullIntro ? getTimeGreeting() + '! ' : getTimeGreeting() + '! Меня зовут Алина, менеджер магазина Дверной Портал. ';
    out = prefix + out;
  }

  if (looksLikePriceQuote(out)) {
    return safePriceReply(lastUserText, { needsGreeting, currentData });
  }

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

  out = trimSentences(out, 5);
  out = removeContradictoryKnownDataQuestions(out, currentData);
  if (userAskedPrice(lastUserText) && !hasQuestion(out)) {
    out = `${out.replace(/[.!]*$/, '')}. ${nextStepQuestion(lastUserText, currentData)}`;
  }
  out = removeContradictoryKnownDataQuestions(out, currentData);
  if (!out || /^(1\.|\d+\)|:)$/.test(out)) {
    return smartFallback(lastUserText, currentData, needsGreeting);
  }
  return out;
}

module.exports = { sanitizeReply };