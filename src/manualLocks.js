'use strict';

const fs = require('fs');
const path = require('path');

const LOCK_TTL_MS = 24 * 60 * 60 * 1000;
const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'manual_locks.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readData() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeData(data) {
  ensureDataDir();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

function cleanup(data) {
  const now = Date.now();
  for (const [chatId, value] of Object.entries(data)) {
    const ts = typeof value === 'number' ? value : Number(value?.lockedAt || 0);
    if (!ts || now - ts > LOCK_TTL_MS) delete data[chatId];
  }
}

function lock(chatId, reason = 'operator') {
  if (!chatId) return;
  const data = readData();
  cleanup(data);
  data[chatId] = { lockedAt: Date.now(), reason };
  writeData(data);
}

function isLocked(chatId) {
  const data = readData();
  cleanup(data);
  const locked = Boolean(data[chatId]);
  writeData(data);
  return locked;
}

function unlock(chatId) {
  const data = readData();
  delete data[chatId];
  writeData(data);
}

module.exports = { lock, isLocked, unlock };
