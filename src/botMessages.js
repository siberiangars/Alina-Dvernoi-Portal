'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'bot_messages.json');
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PER_CHAT = 80;

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readData() {
  try {
    if (!fs.existsSync(FILE)) return { trackingStartedAt: Date.now(), chats: {} };
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { trackingStartedAt: Date.now(), chats: {} };
    if (!parsed.chats) {
      return { trackingStartedAt: parsed.trackingStartedAt || Date.now(), chats: parsed };
    }
    return {
      trackingStartedAt: parsed.trackingStartedAt || Date.now(),
      chats: parsed.chats && typeof parsed.chats === 'object' ? parsed.chats : {},
    };
  } catch {
    return { trackingStartedAt: Date.now(), chats: {} };
  }
}

function writeData(data) {
  ensureDataDir();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

function cleanup(data) {
  const cutoff = Date.now() - TTL_MS;
  data.chats = data.chats || {};
  data.trackingStartedAt = data.trackingStartedAt || Date.now();
  for (const chatId of Object.keys(data.chats)) {
    data.chats[chatId] = (Array.isArray(data.chats[chatId]) ? data.chats[chatId] : [])
      .filter((item) => item && item.text && Number(item.createdAt || 0) >= cutoff)
      .slice(-MAX_PER_CHAT);
    if (data.chats[chatId].length === 0) delete data.chats[chatId];
  }
}

function remember(chatId, text) {
  const safeText = normalize(text);
  if (!chatId || !safeText) return;
  const data = readData();
  cleanup(data);
  const list = Array.isArray(data.chats[chatId]) ? data.chats[chatId] : [];
  if (!list.some((item) => normalize(item.text) === safeText)) {
    list.push({ text: safeText, createdAt: Date.now() });
  }
  data.chats[chatId] = list.slice(-MAX_PER_CHAT);
  writeData(data);
}

function isKnown(chatId, text) {
  const safeText = normalize(text);
  if (!chatId || !safeText) return false;
  const data = readData();
  cleanup(data);
  const result = (Array.isArray(data.chats[chatId]) ? data.chats[chatId] : [])
    .some((item) => normalize(item.text) === safeText);
  writeData(data);
  return result;
}

function trackingStartedAtMs() {
  const data = readData();
  cleanup(data);
  writeData(data);
  return Number(data.trackingStartedAt || 0);
}

module.exports = { remember, isKnown, trackingStartedAtMs };
