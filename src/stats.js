'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

function emptyStats(periodStart = new Date().toISOString()) {
  return {
    periodStart,
    chatsReplied: [],
    messagesReceived: 0,
    messagesSent: 0,
    leadsTotal: 0,
    phonesCollected: [],
    errors: 0,
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalize(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    periodStart: data.periodStart || new Date().toISOString(),
    chatsReplied: Array.isArray(data.chatsReplied) ? data.chatsReplied : [],
    messagesReceived: Number(data.messagesReceived || 0),
    messagesSent: Number(data.messagesSent || 0),
    leadsTotal: Number(data.leadsTotal || 0),
    phonesCollected: Array.isArray(data.phonesCollected) ? data.phonesCollected : [],
    errors: Number(data.errors || 0),
  };
}

function readStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) return emptyStats();
    return normalize(JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')));
  } catch {
    return emptyStats();
  }
}

function writeStats(data) {
  ensureDataDir();
  fs.writeFileSync(STATS_FILE, JSON.stringify(normalize(data), null, 2), 'utf8');
}

function updateStats(mutator) {
  const data = readStats();
  mutator(data);
  writeStats(data);
}

function addUnique(list, value) {
  if (!value) return;
  const str = String(value);
  if (!list.includes(str)) list.push(str);
}

function incReceived(chatId) {
  updateStats((data) => {
    data.messagesReceived += 1;
    addUnique(data.chatsReplied, chatId);
  });
}

function incSent() {
  updateStats((data) => {
    data.messagesSent += 1;
  });
}

function incLead(phone) {
  updateStats((data) => {
    data.leadsTotal += 1;
    addUnique(data.phonesCollected, phone);
  });
}

function incError() {
  updateStats((data) => {
    data.errors += 1;
  });
}

function addPhone(phone) {
  updateStats((data) => {
    addUnique(data.phonesCollected, phone);
  });
}

function getAndReset() {
  const data = readStats();
  const snapshot = {
    periodStart: new Date(data.periodStart),
    periodEnd: new Date(),
    chatsReplied: data.chatsReplied.length,
    messagesReceived: data.messagesReceived,
    messagesSent: data.messagesSent,
    leadsTotal: data.leadsTotal,
    phonesCollected: data.phonesCollected,
    errors: data.errors,
  };

  writeStats(emptyStats(new Date().toISOString()));
  return snapshot;
}

module.exports = { incReceived, incSent, incLead, incError, addPhone, getAndReset };
