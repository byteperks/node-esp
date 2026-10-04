const { SerialPort } = require('serialport');

const defaultPortPath = process.env.PRINTER_PORT || 'COM7';
const defaultBaudRate = Number(process.env.PRINTER_BAUD_RATE || '9600');
const lineWidth = 32;
let printQueue = Promise.resolve();

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function textFromReactNode(value) {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textFromReactNode).filter(Boolean).join(' ');
  if (typeof value === 'object') return textFromReactNode(value.props?.children);
  return '';
}

function paymentMethod(customer) {
  const method = customer?.payment_method_name;
  return textFromReactNode(method) || (typeof method === 'string' ? method : 'Payment');
}

function center(text) {
  const value = String(text ?? '').slice(0, lineWidth);
  const padding = Math.max(0, Math.floor((lineWidth - value.length) / 2));
  return `${' '.repeat(padding)}${value}`;
}

function wrap(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= lineWidth) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function itemLine(quantity, price, total) {
  const left = `${quantity} x ${money(price)}`.slice(0, lineWidth - money(total).length - 1);
  const right = money(total);
  return `${left}${' '.repeat(Math.max(1, lineWidth - left.length - right.length))}${right}`;
}

function totalLine(label, value) {
  const right = `${value}/-`;
  const left = String(label).slice(0, lineWidth - right.length - 1);
  return `${left}${' '.repeat(Math.max(1, lineWidth - left.length - right.length))}${right}`;
}

function companyHeader(company = {}) {
  const lines = [];
  if (company.name) lines.push(center(String(company.name).toUpperCase()));
  if (company.branch) lines.push(center(company.branch));
  if (company.phone) lines.push(center(company.phone));
  if (company.pan_no) lines.push(center(`Pan No: ${company.pan_no}`));
  if (company.vat_no) lines.push(center(`VAT No: ${company.vat_no}`));
  return lines;
}

function buildReceipt(mergedOrders, orderDetails) {
  const items = Array.isArray(mergedOrders) ? mergedOrders : [];
  const customers = Array.isArray(orderDetails.customer) ? orderDetails.customer : [];
  const total = Number(orderDetails.finalTotal) || 0;
  const tendered = Number(orderDetails.tenderAmount) || 0;
  const lines = [
    ...companyHeader(orderDetails.company),
    '-'.repeat(lineWidth),
    `Bill no: ${orderDetails.order_id ?? ''}`,
    `Date: ${orderDetails.nepaliDate ?? orderDetails.created_at ?? ''}`,
    ...(orderDetails.customer_name ? [`Customer: ${orderDetails.customer_name}`] : []),
    ...(orderDetails.customer_pan ? [`Customer PAN: ${orderDetails.customer_pan}`] : []),
    '-'.repeat(lineWidth),
    center('ORDER DETAILS'),
  ];

  for (const item of items) {
    lines.push(...wrap(item.name));
    lines.push(itemLine(Number(item.quantity) || 0, item.price, (Number(item.quantity) || 0) * (Number(item.price) || 0)));
  }

  lines.push('-'.repeat(lineWidth), center('PAYMENT DETAILS'));
  for (const customer of customers) {
    lines.push(`${paymentMethod(customer).slice(0, 14)} ${customer.paid ? 'Paid' : 'Unpaid'}`);
    lines.push(totalLine('Amount', money(orderDetails.addCredit ? total : customer.tenderAmount)));
  }

  if (orderDetails.addCredit) {
    lines.push(totalLine('Credit', money(tendered - total)));
  }

  lines.push('-'.repeat(lineWidth));
  lines.push(totalLine('Sub Total', money(orderDetails.totalAmount)));
  if (Number(orderDetails.discount?.percent) > 0) {
    lines.push(totalLine(`Discount ${money(orderDetails.discount.percent)}%`, `-${money(orderDetails.discount.amount)}`));
  }
  lines.push(totalLine('Total', money(total)));
  lines.push(totalLine('Tender Amount', money(tendered)));
  lines.push(totalLine(total - tendered > 0 ? 'Amount Due' : 'Changed Amount', money(orderDetails.addCredit ? 0 : total - tendered)));
  lines.push('', center('Thank you for visiting'));

  return lines.join('\n');
}

function buildBill(mergedOrders, orderDetails) {
  const items = Array.isArray(mergedOrders) ? mergedOrders : [];
  const total = Number(orderDetails.finalTotal) || 0;
  const lines = [
    ...companyHeader(orderDetails.company),
    '-'.repeat(lineWidth),
    `Bill no: ${orderDetails.order_id ?? ''}`,
    `Date: ${orderDetails.nepaliDate ?? orderDetails.created_at ?? ''}`,
    ...(orderDetails.customer_name ? [`Customer: ${orderDetails.customer_name}`] : []),
    ...(orderDetails.customer_pan ? [`Customer PAN: ${orderDetails.customer_pan}`] : []),
    '-'.repeat(lineWidth),
    center('BILL'),
  ];

  for (const item of items) {
    lines.push(...wrap(item.name));
    lines.push(itemLine(Number(item.quantity) || 0, item.price, (Number(item.quantity) || 0) * (Number(item.price) || 0)));
  }

  lines.push('-'.repeat(lineWidth));
  lines.push(totalLine('Sub Total', money(orderDetails.totalAmount)));
  if (Number(orderDetails.discount?.percent) > 0) {
    lines.push(totalLine(`Discount ${money(orderDetails.discount.percent)}%`, `-${money(orderDetails.discount.amount)}`));
  }
  lines.push(totalLine('Total', money(total)));

  return lines.join('\n');
}

// ---- Kitchen Order Ticket (KOT) ----------------------------------------------
// ESC/POS control sequences (all bytes < 0x80, safe through Buffer.from(x,'ascii'))
const ESC = '\x1b';
const GS = '\x1d';
const EMPH_ON = `${ESC}E\x01`;
const EMPH_OFF = `${ESC}E\x00`;
const DOUBLE_ON = `${GS}!\x11`;   // double width + double height
const DOUBLE_OFF = `${GS}!\x00`;
const ALIGN_CENTER = `${ESC}a\x01`;
const ALIGN_LEFT = `${ESC}a\x00`;

function ticketTime(value) {
  const date = value ? new Date(String(value).replace(' ', 'T')) : new Date();
  if (Number.isNaN(date.getTime())) return String(value ?? '');
  return date.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true
  });
}

function tableLabel(kot) {
  return textFromReactNode(kot.table_name) || (kot.table_id != null ? String(kot.table_id) : '-');
}

// Kitchen copy: big and bold, NO prices.
function buildKot(kot = {}) {
  const items = Array.isArray(kot.items) ? kot.items : [];
  const lines = [
    ALIGN_CENTER,
    `${DOUBLE_ON}KOT #${kot.kot_id ?? kot.kot_number ?? '-'}${DOUBLE_OFF}`
  ];
  if (kot.reprint) lines.push(`${EMPH_ON}* REPRINT *${EMPH_OFF}`);
  lines.push(
    ALIGN_LEFT,
    `${EMPH_ON}Table: ${tableLabel(kot)}${EMPH_OFF}`,
    '-'.repeat(lineWidth),
    `Time : ${ticketTime(kot.created_at)}`
  );
  if (kot.created_by) lines.push(`By   : ${kot.created_by}`);
  lines.push('-'.repeat(lineWidth));

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const nameLines = wrap(String(item.name ?? '').toUpperCase());
    // [line id] lets staff tell two identical items from different KOTs apart
    const tag = item.id != null ? `[${item.id}] ` : '';
    lines.push(`${EMPH_ON}${tag}${qty} x ${nameLines[0]}${EMPH_OFF}`);
    for (const extra of nameLines.slice(1)) lines.push(`    ${extra}`);
  }

  lines.push('-'.repeat(lineWidth));
  if (kot.note) {
    lines.push(...wrap(`Note: ${kot.note}`));
    lines.push('-'.repeat(lineWidth));
  }
  lines.push(center(`Order #${kot.order_id ?? ''}`));
  return lines.join('\n');
}

// Cancellation chit for a quantity taken back off an already-fired KOT line.
function buildKotCancel(cancellation = {}) {
  const cancelled = Number(cancellation.cancelled_quantity) || 0;
  const remaining = Number(cancellation.remaining_quantity) || 0;
  const lines = [
    ALIGN_CENTER,
    `${DOUBLE_ON}* CANCEL *${DOUBLE_OFF}`,
    ALIGN_LEFT,
    `${EMPH_ON}KOT #${cancellation.kot_id ?? cancellation.kot_number ?? '-'}  Table: ${tableLabel(cancellation)}${EMPH_OFF}`,
    '-'.repeat(lineWidth),
    `${EMPH_ON}${cancellation.order_breakdown_id != null ? `[${cancellation.order_breakdown_id}] ` : ''}${cancelled} x ${String(cancellation.name ?? '').toUpperCase()}${EMPH_OFF}`,
    `Remaining on ticket: ${remaining}`
  ];
  if (cancellation.reason) lines.push(...wrap(`Reason: ${cancellation.reason}`));
  lines.push('-'.repeat(lineWidth), `Time : ${ticketTime(cancellation.created_at)}`);
  if (cancellation.created_by) lines.push(`By   : ${cancellation.created_by}`);
  lines.push(center(`Order #${cancellation.order_id ?? ''}`));
  return lines.join('\n');
}

function closePort(port) {
  return new Promise((resolve, reject) => {
    if (!port.isOpen) return resolve();
    port.close((error) => (error ? reject(error) : resolve()));
  });
}

async function sendText(text, connection = {}) {
  const portPath = connection.portPath || defaultPortPath;
  const baudRate = Number(connection.baudRate || defaultBaudRate);

  if (!Number.isInteger(baudRate) || baudRate <= 0) {
    throw new Error('Baud rate must be a positive whole number.');
  }

  const port = new SerialPort({ path: portPath, baudRate, autoOpen: false });
  port.on('error', () => undefined);
  try {
    await new Promise((resolve, reject) => port.open((error) => (error ? reject(error) : resolve())));
    const data = Buffer.concat([
      Buffer.from([0x1b, 0x40]), // ESC @: initialize
      Buffer.from(text, 'ascii'),
      Buffer.from('\n\n\n\n', 'ascii')
    ]);
    await new Promise((resolve, reject) => port.write(data, (error) => (error ? reject(error) : resolve())));
    await new Promise((resolve, reject) => port.drain((error) => (error ? reject(error) : resolve())));
  } finally {
    await closePort(port);
  }
}

function sendReceipt(mergedOrders, orderDetails, connection) {
  return sendText(buildReceipt(mergedOrders, orderDetails), connection);
}

function sendBill(mergedOrders, orderDetails, connection) {
  return sendText(buildBill(mergedOrders, orderDetails), connection);
}

function queueReceiptPrint(mergedOrders, orderDetails, connection) {
  const job = printQueue.then(() => sendReceipt(mergedOrders, orderDetails, connection));
  printQueue = job.catch(() => undefined);
  return job;
}

function queueBillPrint(mergedOrders, orderDetails, connection) {
  const job = printQueue.then(() => sendBill(mergedOrders, orderDetails, connection));
  printQueue = job.catch(() => undefined);
  return job;
}

function sendKot(kot, connection) {
  return sendText(buildKot(kot), connection);
}

function sendKotCancel(cancellation, connection) {
  return sendText(buildKotCancel(cancellation), connection);
}

function queueKotPrint(kot, connection) {
  const job = printQueue.then(() => sendKot(kot, connection));
  printQueue = job.catch(() => undefined);
  return job;
}

function queueKotCancelPrint(cancellation, connection) {
  const job = printQueue.then(() => sendKotCancel(cancellation, connection));
  printQueue = job.catch(() => undefined);
  return job;
}

function queueTestPrint(connection) {
  const text = [center('POS PRINTER TEST'), '-'.repeat(lineWidth), `Time: ${ticketTime()}`, 'Printer is working.'].join('\n');
  const job = printQueue.then(() => sendText(text, connection));
  printQueue = job.catch(() => undefined);
  return job;
}

module.exports = {
  queueReceiptPrint,
  queueBillPrint,
  queueKotPrint,
  queueKotCancelPrint,
  queueTestPrint,
  buildKot,
  buildKotCancel,
  defaultPortPath,
  defaultBaudRate
};
