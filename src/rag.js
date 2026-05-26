'use strict';

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(process.cwd(), 'logs', 'bot.log');
const MAX_EXAMPLES = 1500;
const REFRESH_MS = 5 * 60 * 1000;

let cache = { at: 0, examples: [] };

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-zа-я0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text) {
  return new Set(normalize(text).split(' ').filter((t) => t.length > 2));
}

function score(a, b) {
  if (!a || !b) return 0;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) {
    if (tb.has(t)) common += 1;
  }
  return common / Math.sqrt(ta.size * tb.size);
}

function parseExamples() {
  let raw;
  try {
    raw = fs.readFileSync(LOG_FILE, 'utf8');
  } catch {
    return [];
  }

  const byChat = new Map();
  const examples = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = obj.message || '';
    if (!msg.includes('IN  [') && !msg.includes('OUT [')) continue;
    const m = msg.match(/\[(.*?)\]\s*(.*)$/);
    if (!m) continue;
    const chatId = m[1];
    const text = (m[2] || '').trim();
    if (!text) continue;

    if (msg.includes('IN  [')) {
      byChat.set(chatId, text);
      continue;
    }
    if (msg.includes('OUT [')) {
      const question = byChat.get(chatId);
      if (!question) continue;
      byChat.delete(chatId);
      examples.push({ question, answer: text });
      if (examples.length >= MAX_EXAMPLES) break;
    }
  }
  return examples.reverse();
}

function getExamples() {
  const now = Date.now();
  if (now - cache.at < REFRESH_MS && cache.examples.length > 0) {
    return cache.examples;
  }
  cache = { at: now, examples: parseExamples() };
  return cache.examples;
}

function getSimilarExamples(userText, limit = 3) {
  const ex = getExamples();
  if (ex.length === 0) return [];
  return ex
    .map((e) => ({ ...e, s: score(userText, e.question) }))
    .filter((e) => e.s >= 0.22)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ question, answer }) => ({ question, answer }));
}

module.exports = { getSimilarExamples };

