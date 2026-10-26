const express = require('express');
const {
  queueReceiptPrint,
  queueBillPrint,
  queueKotPrint,
  queueKotCancelPrint,
  queueTestPrint,
  defaultPortPath,
  defaultBaudRate
} = require('./printer');
const { findMptII, listDevices } = require('./ports');

const app = express();
const port = Number(process.env.PORT) || 17865;
const host = process.env.HOST || '127.0.0.1';

async function resolvePortPath() {
  const detected = await findMptII({ silent: true }).catch(() => null);
  return detected || defaultPortPath;
}

// Where to print: an explicit `portPath` (picked in the dashboard from /list-devices) wins;
// otherwise fall back to the auto-detected MPT-II / env default, exactly as before.
// Returns null after answering 400 when the requested device is not connected.
async function resolveTarget(payload, response) {
  const ms = Number(payload.ms);
  const baudRate = Number.isFinite(ms) && ms > 0 ? ms : defaultBaudRate;
  const requested = typeof payload.portPath === 'string' ? payload.portPath.trim() : '';

  if (!requested) return { portPath: await resolvePortPath(), baudRate };

  const devices = await listDevices().catch(() => []);
  if (!devices.some((device) => device.path === requested)) {
    response.status(400).json({
      ok: false,
      error: `Device ${requested} is not connected to this computer.`,
      devices: devices.map((device) => device.path)
    });
    return null;
  }
  return { portPath: requested, baudRate };
}

app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Lets the https PWA call this 127.0.0.1 server (Chromium Private Network Access preflight).
  response.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json({ limit: '1mb' }));

// Company header (name, PAN, phone...) is sent by the dashboard per request, since the app is multi-tenant.
function withCompany(payload) {
  const orderDetails = payload.orderDetails ?? payload;
  if (!orderDetails || typeof orderDetails !== 'object') return orderDetails;
  return { ...orderDetails, company: payload.company ?? orderDetails.company ?? {} };
}

app.get('/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/status', async (_request, response) => {
  const detected = await findMptII({ silent: true }).catch(() => null);
  response.json({
    ok: true,
    detected: Boolean(detected),
    portPath: detected || defaultPortPath,
    baudRate: defaultBaudRate
  });
});

// Connected serial devices, so the dashboard can let the user pick which printer
// (receipt / kitchen) requests go to. `default` is what is used when none is picked.
app.get('/list-devices', async (_request, response) => {
  const [devices, detected] = await Promise.all([
    listDevices().catch(() => []),
    findMptII({ silent: true }).catch(() => null)
  ]);
  const defaultPath = detected || defaultPortPath;
  response.json({
    ok: true,
    default: { portPath: defaultPath, baudRate: defaultBaudRate, detected: Boolean(detected) },
    devices: devices.map((device) => ({ ...device, isDefault: device.path === defaultPath }))
  });
});

// Optional body { portPath, ms } prints the test page on the chosen device.
app.post('/test-print', async (request, response) => {
  const target = await resolveTarget(request.body ?? {}, response);
  if (!target) return;
  const { portPath, baudRate } = target;

  try {
    await queueTestPrint({ portPath, baudRate });
    response.json({ ok: true, message: `Test page sent to ${portPath} at ${baudRate} baud.` });
  } catch (error) {
    console.error(`Test print failed for ${portPath} at ${baudRate} baud:`, error.message);
    response.status(502).json({
      ok: false,
      error: `Computer ${portPath} is not responsive at ${baudRate}.`,
      details: error.message
    });
  }
});

app.post('/print', async (request, response) => {
  const payload = request.body ?? {};
  const orderDetails = withCompany(payload);
  const mergedOrders = payload.mergedOrders ?? orderDetails.orders;

  if (!Array.isArray(mergedOrders) || !orderDetails || typeof orderDetails !== 'object') {
    response.status(400).json({
      error: 'Send mergedOrders and orderDetails, or send orderDetails directly with its orders array.'
    });
    return;
  }

  const target = await resolveTarget({ ...payload, ms: payload.ms ?? orderDetails.ms }, response);
  if (!target) return;
  const { portPath, baudRate } = target;

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
  const orderDetails = withCompany(payload);
  const mergedOrders = payload.mergedOrders ?? orderDetails.orders;

  if (!Array.isArray(mergedOrders) || !orderDetails || typeof orderDetails !== 'object') {
    response.status(400).json({
      error: 'Send mergedOrders and orderDetails, or send orderDetails directly with its orders array.'
    });
    return;
  }

  const target = await resolveTarget({ ...payload, ms: payload.ms ?? orderDetails.ms }, response);
  if (!target) return;
  const { portPath, baudRate } = target;

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

  const target = await resolveTarget({ ...payload, ms: payload.ms ?? kot.ms }, response);
  if (!target) return;
  const { portPath, baudRate } = target;

  try {
    await queueKotPrint(kot, { portPath, baudRate });
    response.json({ ok: true, message: `KOT #${kot.kot_id ?? kot.kot_number ?? ''} sent to ${portPath} at ${baudRate} baud.` });
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

  const target = await resolveTarget({ ...payload, ms: payload.ms ?? cancellation.ms }, response);
  if (!target) return;
  const { portPath, baudRate } = target;

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

app.listen(port, host, () => {
  console.log(`Receipt API listening at http://${host}:${port}`);
  console.log(`POST receipt data to /print to print on the auto-detected MPT-II port (falls back to ${defaultPortPath} at ${defaultBaudRate} baud, or per-request baud via ms).`);
  console.log('POST the same payload to /print-bill for a footer-less final bill before payment.');
  console.log('GET /list-devices lists connected printers; send { portPath } in any print body to choose one.');
  console.log('POST { kot } to /print-kot for the kitchen ticket, { cancellation } to /print-kot-cancel for a cancel chit.');
});
