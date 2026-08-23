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

function buildReceipt(mergedOrders, orderDetails) {
  const items = Array.isArray(mergedOrders) ? mergedOrders : [];
  const customers = Array.isArray(orderDetails.customer) ? orderDetails.customer : [];
  const total = Number(orderDetails.finalTotal) || 0;
  const tendered = Number(orderDetails.tenderAmount) || 0;
  const lines = [
    center("TUISHI'S CAFE"),
    center('Sunakothi, Lalitpur'),
    center('+977 974-4375508'),
    center('Pan No: 620538266'),
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
    center("TUISHI'S CAFE"),
    center('Sunakothi, Lalitpur'),
    center('+977 974-4375508'),
    center('Pan No: 620538266'),
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

module.exports = { queueReceiptPrint, queueBillPrint, defaultPortPath, defaultBaudRate };
