const express = require('express');
const {
  queueReceiptPrint,
  queueBillPrint,
  queueKotPrint,
  queueKotCancelPrint,
  defaultPortPath,
  defaultBaudRate
} = require('./printer');
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

app.post('/print-kot', async (request, response) => {
  const payload = request.body ?? {};
  const kot = payload.kot ?? payload;

  if (!kot || typeof kot !== 'object' || !Array.isArray(kot.items)) {
    response.status(400).json({
      error: 'Send { kot: { kot_number, table_name, created_at, created_by, note, items: [{ name, quantity }] } }.'
    });
    return;
  }

  const ms = payload.ms ?? kot.ms;
  const portPath = await resolvePortPath();
  const baudRate = ms !== undefined ? Number(ms) : defaultBaudRate;

  try {
    await queueKotPrint(kot, { portPath, baudRate });
    response.json({ ok: true, message: `KOT #${kot.kot_number ?? ''} sent to ${portPath} at ${baudRate} baud.` });
  } catch (error) {
    console.error(`KOT print failed for ${portPath} at ${baudRate} baud:`, error.message);
    response.status(502).json({
      ok: false,
      error: `Computer ${portPath} is not responsive at ${baudRate}.`,
      details: error.message
    });
  }
});

app.post('/print-kot-cancel', async (request, response) => {
  const payload = request.body ?? {};
  const cancellation = payload.cancellation ?? payload;

  if (!cancellation || typeof cancellation !== 'object' || cancellation.cancelled_quantity === undefined) {
    response.status(400).json({
      error: 'Send { cancellation: { kot_number, name, cancelled_quantity, remaining_quantity, reason, created_by, created_at } }.'
    });
    return;
  }

  const ms = payload.ms ?? cancellation.ms;
  const portPath = await resolvePortPath();
  const baudRate = ms !== undefined ? Number(ms) : defaultBaudRate;

  try {
    await queueKotCancelPrint(cancellation, { portPath, baudRate });
    response.json({ ok: true, message: `KOT cancel chit sent to ${portPath} at ${baudRate} baud.` });
  } catch (error) {
    console.error(`KOT cancel print failed for ${portPath} at ${baudRate} baud:`, error.message);
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
  console.log('POST { kot } to /print-kot for the kitchen ticket, { cancellation } to /print-kot-cancel for a cancel chit.');
});
