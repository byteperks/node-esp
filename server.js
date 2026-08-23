const express = require('express');
const { queueReceiptPrint, queueBillPrint, defaultPortPath, defaultBaudRate } = require('./printer');
const { findMptII } = require('./ports');

const app = express();
const port = Number(process.env.PORT) || 3000;

async function resolvePortPath() {
  const detected = await findMptII({ silent: true }).catch(() => null);
  return detected || defaultPortPath;
}

app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.json({ ok: true });
});

app.post('/print', async (request, response) => {
  const payload = request.body ?? {};
  const orderDetails = payload.orderDetails ?? payload;
  const mergedOrders = payload.mergedOrders ?? orderDetails.orders;

  if (!Array.isArray(mergedOrders) || !orderDetails || typeof orderDetails !== 'object') {
    response.status(400).json({
      error: 'Send mergedOrders and orderDetails, or send orderDetails directly with its orders array.'
    });
    return;
  }

  const ms = payload.ms ?? orderDetails.ms;
  const portPath = await resolvePortPath();
  const baudRate = ms !== undefined ? Number(ms) : defaultBaudRate;

  try {
    await queueReceiptPrint(mergedOrders, orderDetails, { portPath, baudRate });
    response.json({ ok: true, message: `Receipt sent to ${portPath} at ${baudRate} baud.` });
  } catch (error) {
    console.error(`Print failed for ${portPath} at ${baudRate} baud:`, error.message);
    response.status(502).json({
      ok: false,
      error: `Computer ${portPath} is not responsive at ${baudRate}.`,
      details: error.message
    });
  }
});

app.post('/print-bill', async (request, response) => {
  const payload = request.body ?? {};
  const orderDetails = payload.orderDetails ?? payload;
  const mergedOrders = payload.mergedOrders ?? orderDetails.orders;

  if (!Array.isArray(mergedOrders) || !orderDetails || typeof orderDetails !== 'object') {
    response.status(400).json({
      error: 'Send mergedOrders and orderDetails, or send orderDetails directly with its orders array.'
    });
    return;
  }

  const ms = payload.ms ?? orderDetails.ms;
  const portPath = await resolvePortPath();
  const baudRate = ms !== undefined ? Number(ms) : defaultBaudRate;

  try {
    await queueBillPrint(mergedOrders, orderDetails, { portPath, baudRate });
    response.json({ ok: true, message: `Bill sent to ${portPath} at ${baudRate} baud.` });
  } catch (error) {
    console.error(`Bill print failed for ${portPath} at ${baudRate} baud:`, error.message);
    response.status(502).json({
      ok: false,
      error: `Computer ${portPath} is not responsive at ${baudRate}.`,
      details: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Receipt API listening at http://localhost:${port}`);
  console.log(`POST receipt data to /print to print on the auto-detected MPT-II port (falls back to ${defaultPortPath} at ${defaultBaudRate} baud, or per-request baud via ms).`);
  console.log('POST the same payload to /print-bill for a footer-less final bill before payment.');
});
