function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

function nepaliDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-NP', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
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
  const label = textFromReactNode(method);
  return label || (typeof method === 'string' ? method : 'Payment');
}

function renderReceipt(mergedOrders = [], orderDetails = {}) {
  const items = Array.isArray(mergedOrders) ? mergedOrders : [];
  const customers = Array.isArray(orderDetails.customer) ? orderDetails.customer : [];
  const total = Number(orderDetails.finalTotal) || 0;
  const tendered = Number(orderDetails.tenderAmount) || 0;
  const changeOrDue = total - tendered;

  const orderRows = items.map((order) => {
    const quantity = Number(order.quantity) || 0;
    const price = Number(order.price) || 0;
    return `<tr>
      <td>${escapeHtml(order.name)}</td>
      <td>${quantity}</td>
      <td class="amount">${money(price)}/-</td>
      <td class="amount">${money(price * quantity)}/-</td>
    </tr>`;
  }).join('');

  const paymentRows = customers.map((customer) => `<tr>
    <td>${escapeHtml(paymentMethod(customer))}</td>
    <td>${money(orderDetails.addCredit ? total : customer.tenderAmount)}/-</td>
    <td class="amount">${customer.paid ? 'Paid' : 'Unpaid'}</td>
  </tr>`).join('');

  const creditRow = orderDetails.addCredit ? `<tr>
    <td>Credit</td>
    <td>${money(tendered - total)}/-</td>
    <td class="amount">Paid</td>
  </tr>` : '';

  const discount = Number(orderDetails.discount?.percent) > 0 ? `<div class="total-row">
    <strong>Discount</strong>
    <strong>-${money(orderDetails.discount.percent)}% [${money(orderDetails.discount.amount)}/-]</strong>
  </div>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Receipt ${escapeHtml(orderDetails.order_id)}</title>
  <style>
    @page { size: 48mm auto; margin: 1.5mm; }
    * { box-sizing: border-box; }
    body { width: 45mm; margin: 0; font: 10px/1.3 monospace; color: #000; }
    .header { display: flex; justify-content: space-between; align-items: start; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 13px; } h2 { font-size: 11px; text-align: center; margin: 8px 0 4px; }
    .logo { width: 16mm; height: 16mm; object-fit: contain; }
    .meta { border-top: 1px solid #000; border-bottom: 1px solid #000; margin-top: 5px; padding: 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
    th, td { padding: 2px 0; text-align: left; vertical-align: top; }
    th { border-bottom: 1px solid #000; } .amount { text-align: right; }
    .total-row { display: flex; justify-content: space-between; padding-top: 2px; }
    .totals { border-top: 1px solid #000; padding-top: 3px; }
    .thanks { text-align: center; margin: 7px 0; font-weight: bold; }
  </style>
</head>
<body>
  <div class="header">
    <div><h1>Tuishi's Cafe</h1><p>Sunakothi, Lalitpur</p><p>+977 974-4375508</p></div>
    <img class="logo" src="https://cdn.byteperks.com/tuishi/face-logo-svg.png" alt="Tuishi's Cafe logo">
  </div>
  <h2>Pan No: 620538266</h2>
  <div class="meta"><div><strong>Bill no:</strong> ${escapeHtml(orderDetails.order_id)}</div><div><strong>Date:</strong> ${escapeHtml(orderDetails.nepaliDate ?? nepaliDate(orderDetails.created_at))}</div></div>
  <h2>Order Details</h2>
  <table><thead><tr><th>Item</th><th>Qty</th><th class="amount">Rate</th><th class="amount">Total</th></tr></thead><tbody>${orderRows}</tbody></table>
  <h2>Payment Details</h2>
  <table><thead><tr><th>Mode</th><th>Amt</th><th class="amount">Status</th></tr></thead><tbody>${paymentRows}${creditRow}</tbody></table>
  <div class="totals">
    <div class="total-row"><strong>Sub Total</strong><strong>${money(orderDetails.totalAmount)}/-</strong></div>
    ${discount}
    <div class="total-row"><strong>Total</strong><strong>${money(total)}/-</strong></div>
    <div class="total-row"><strong>Tender Amount</strong><strong>${money(tendered)}/-</strong></div>
    <div class="total-row"><strong>${changeOrDue > 0 ? 'Amount Due' : 'Changed Amount'}</strong><strong>${money(orderDetails.addCredit ? 0 : changeOrDue)}/-</strong></div>
  </div>
  <p class="thanks">Thank you for visiting</p>
</body>
</html>`;
}

module.exports = { renderReceipt };
