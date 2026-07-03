'use strict';

const assert = require('assert');
const report = require('./src/report');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err.message);
    process.exitCode = 1;
  }
}

test('formats DeepSeek key balance and daily spend for evening report', () => {
  assert(report.__test, 'report.__test export is missing');
  const line = report.__test.formatDeepSeekBillingBlock({
    balance: { currency: 'USD', total: 9.75 },
    spentToday: 0.25,
    note: null,
  });

  assert(line.includes('\u0411\u0430\u043b\u0430\u043d\u0441 \u043a\u043b\u044e\u0447\u0430 DeepSeek'));
  assert(line.includes('\u041e\u0441\u0442\u0430\u043b\u043e\u0441\u044c \u043d\u0430 \u0431\u0430\u043b\u0430\u043d\u0441\u0435'));
  assert(line.includes('9.75 USD'));
  assert(line.includes('\u041f\u043e\u0442\u0440\u0430\u0447\u0435\u043d\u043e \u0441\u0435\u0433\u043e\u0434\u043d\u044f'));
  assert(line.includes('0.25 USD'));
});

test('does not add DeepSeek billing block to morning report', () => {
  assert(report.__test, 'report.__test export is missing');
  assert.strictEqual(report.__test.shouldIncludeDeepSeekBilling(10), false);
  assert.strictEqual(report.__test.shouldIncludeDeepSeekBilling(22), true);
});
