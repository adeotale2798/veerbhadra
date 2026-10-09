const documentLabels = {
  quotation: 'Quotation/ Estimate',
  invoice: 'Invoice',
  challan: 'Delivery Challan',
  'service-report': 'Service Report',
};

const documentNames = {
  quotation: 'quotation',
  invoice: 'invoice',
  challan: 'delivery challan',
  'service-report': 'service report',
};

const documentFields = {
  quotation: [
    { name: 'validUntil', label: 'Quote valid until', type: 'date', required: true },
    { name: 'delivery', label: 'Delivery / completion', placeholder: 'e.g. 2–3 weeks from order' },
    { name: 'projectName', label: 'Project / site name', wide: true },
  ],
  invoice: [
    { name: 'dueDate', label: 'Payment due date', type: 'date' },
    { name: 'orderNumber', label: 'Purchase order no.' },
    { name: 'paymentTerms', label: 'Mode / terms of payment', placeholder: 'e.g. 30 days from invoice' },
    { name: 'shipName', label: 'Ship-to customer / company' },
    { name: 'shipAddress', label: 'Ship-to address', wide: true, multiline: true },
    { name: 'shipGst', label: 'Ship-to GST No.' },
    { name: 'bankName', label: 'Bank name' },
    { name: 'accountNumber', label: 'Account number' },
    { name: 'ifscCode', label: 'IFSC code' },
    { name: 'bankBranch', label: 'Branch' },
  ],
  challan: [
    { name: 'purchaseOrderNumber', label: 'Purchase order no.' },
    { name: 'purchaseOrderDate', label: 'Purchase order date', type: 'date' },
    { name: 'deliveryName', label: 'Delivery company' },
    { name: 'deliveryAt', label: 'Delivery address', wide: true },
    { name: 'dispatchThrough', label: 'Dispatch through' },
    { name: 'vehicleNumber', label: 'Vehicle no.' },
    { name: 'eWayBillNumber', label: 'E-way bill no.' },
    { name: 'purpose', label: 'Reason for transport', wide: true },
  ],
  'service-report': [
    { name: 'visitDate', label: 'Service visit date', type: 'date', required: true },
    { name: 'visitType', label: 'Visit type', placeholder: 'e.g. Breakdown / Preventive maintenance' },
    { name: 'engineerName', label: 'Service engineer', placeholder: 'Engineer attending the visit' },
    { name: 'nextService', label: 'Next service due', type: 'date' },
    { name: 'siteName', label: 'Project / site name', wide: true },
    { name: 'equipment', label: 'Machine / equipment' },
    { name: 'serviceNumber', label: 'Service no. / equipment ID' },
    { name: 'installationDate', label: 'Installation date', type: 'date' },
    { name: 'reportedIssue', label: 'Reported issue', wide: true, multiline: true },
    { name: 'serviceDetails', label: 'Work performed', wide: true, multiline: true },
    { name: 'recommendations', label: 'Engineer observations', wide: true, multiline: true },
    { name: 'serviceStatus', label: 'Service status', wide: true, options: ['Completed', 'Partially done', 'Pending - parts required', 'Under observation'] },
  ],
};

const dom = {
  loginScreen: document.getElementById('login-screen'),
  loginForm: document.getElementById('login-form'),
  loginMessage: document.getElementById('login-message'),
  app: document.getElementById('admin-app'),
  appMessage: document.getElementById('app-message'),
  dashboard: document.getElementById('dashboard-view'),
  finance: document.getElementById('finance-view'),
  editor: document.getElementById('editor-view'),
  preview: document.getElementById('preview-view'),
  title: document.getElementById('page-title'),
  documentForm: document.getElementById('document-form'),
  editorPaper: document.getElementById('document-editor-paper'),
  printDocument: document.getElementById('saved-print-document'),
  documentList: document.getElementById('document-list'),
  emptyDocuments: document.getElementById('empty-documents'),
};

let activeDocumentType = 'quotation';
let previewOrigin = 'editor';
let currentRecord = null;
let previewRecord = null;
let messageTimer;
const companySearchTimers = new WeakMap();
let productCatalog = [];
let financeSummary = null;
let editingExpenseId = null;
let paymentDialogInvoice = null;
let documentListReturnY = null;
const appMessageParent = dom.appMessage.parentNode;
const appMessageNextSibling = dom.appMessage.nextSibling;

function restoreAppMessage() {
  if (dom.appMessage.parentNode === appMessageParent) return;
  appMessageParent.insertBefore(
    dom.appMessage,
    appMessageNextSibling?.parentNode === appMessageParent ? appMessageNextSibling : null,
  );
}

function showDialog(dialog) {
  dialog.showModal();
  if (!dom.appMessage.hidden) dialog.append(dom.appMessage);
}

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('close', restoreAppMessage);
});

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && url !== '/api/login') showLogin();
    const message = url.endsWith('/payment') && /^choose paid or unpaid\.?$/i.test(payload.error || '')
      ? 'The local server is outdated and does not support partial payments. Restart it from this repository, then refresh the admin page.'
      : payload.error || (response.status === 404 && url.startsWith('/api/')
      ? `The server does not have ${url.split('?')[0]} yet. Restart the local app or deploy the latest server code.`
      : `Request failed (${response.status}).`);
    throw new Error(message);
  }
  return payload;
}

function normalizeDocumentApproval(record) {
  if (record?.type !== 'quotation') return record;
  const createdAt = new Date(record.createdAt).getTime();
  const updatedAt = new Date(record.updatedAt).getTime();
  const untouchedLegacyDefault = record.approvalStatus === 'rejected'
    && !record.approvalDecisionAt
    && Number.isFinite(createdAt)
    && createdAt === updatedAt;
  return {
    ...record,
    approvalStatus: untouchedLegacyDefault ? 'pending' : record.approvalStatus || 'pending',
  };
}

function showLogin() {
  dom.app.hidden = true;
  dom.loginScreen.hidden = false;
}

function showApp() {
  dom.loginScreen.hidden = true;
  dom.app.hidden = false;
}

function activateView(view, title) {
  dom.dashboard.hidden = view !== 'dashboard';
  dom.finance.hidden = view !== 'finance';
  dom.editor.hidden = view !== 'editor';
  dom.preview.hidden = view !== 'preview';
  dom.title.textContent = title;
  document.querySelectorAll('.nav-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view
      || (view === 'editor' && button.dataset.create === activeDocumentType));
  });
}

function rememberDocumentListPosition() {
  if (!dom.dashboard.hidden) documentListReturnY = window.scrollY;
}

function restoreDocumentListPosition() {
  if (documentListReturnY === null) return;
  window.scrollTo(0, documentListReturnY);
  documentListReturnY = null;
}

function announce(message, isError = false) {
  clearTimeout(messageTimer);
  dom.appMessage.querySelector('.toast-icon').textContent = isError ? '!' : '✓';
  dom.appMessage.querySelector('.toast-message').textContent = message;
  dom.appMessage.classList.toggle('is-error', isError);
  dom.appMessage.setAttribute('role', isError ? 'alert' : 'status');
  dom.appMessage.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  dom.appMessage.hidden = false;
  const openDialog = document.querySelector('dialog[open]');
  if (openDialog && !openDialog.contains(dom.appMessage)) openDialog.append(dom.appMessage);
  messageTimer = setTimeout(() => {
    dom.appMessage.hidden = true;
    dom.appMessage.querySelector('.toast-message').textContent = '';
  }, 5000);
}

async function refreshWithFeedback(button, label, load) {
  button.disabled = true;
  button.classList.add('is-refreshing');
  button.setAttribute('aria-busy', 'true');
  try {
    await load();
    announce(`${label} refreshed.`);
  } catch (error) {
    announce(`Could not refresh ${label.toLowerCase()}: ${error.message}`, true);
  } finally {
    button.classList.remove('is-refreshing');
    button.removeAttribute('aria-busy');
    button.disabled = false;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function localDate() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function toDisplayDate(value) {
  if (!value) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value;
}

function toDatabaseDate(value) {
  const formatted = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || '').trim());
  if (!formatted) return '';
  const [, day, month, year] = formatted;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === `${year}-${month}-${day}`
    ? `${year}-${month}-${day}`
    : '';
}

function isRealDisplayDate(value) {
  return Boolean(toDatabaseDate(value));
}

function displayDate(value) {
  if (!value) return '—';
  return escapeHtml(toDisplayDate(value));
}

function rupees(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(Number(value) || 0);
}

function numberToWords(value) {
  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const underThousand = (number) => {
    let result = '';
    if (number >= 100) result += `${units[Math.floor(number / 100)]} Hundred `;
    number %= 100;
    if (number >= 20) {
      result += `${tens[Math.floor(number / 10)]} `;
      if (number % 10) result += `${units[number % 10]} `;
    }
    else if (number > 0) result += `${units[number]} `;
    return result.trim();
  };
  const amount = Math.max(0, Math.round((Number(value) || 0) * 100));
  const rupeePart = Math.floor(amount / 100);
  const paisePart = amount % 100;
  let remaining = rupeePart;
  const parts = [];
  for (const [divisor, name] of [
    [1000000000000000, 'Padma'],
    [10000000000000, 'Neel'],
    [100000000000, 'Kharab'],
    [1000000000, 'Arab'],
    [10000000, 'Crore'],
    [100000, 'Lakh'],
    [1000, 'Thousand'],
  ]) {
    const chunk = Math.floor(remaining / divisor);
    if (chunk) parts.push(`${underThousand(chunk)} ${name}`);
    remaining %= divisor;
  }
  if (remaining) parts.push(underThousand(remaining));
  const words = parts.join(' ') || 'Zero';
  return `Rupees ${words}${paisePart ? ` and ${underThousand(paisePart)} Paise` : ''} Only`;
}

function inlineField(name, label, value = '', options = {}) {
  const date = options.type === 'date';
  const key = options.key ? `data-key="${escapeHtml(options.key)}"` : '';
  const inputType = options.inputType || 'text';
  const controlType = inputType === 'integer' ? 'text' : inputType;
  const ariaLabel = options.ariaLabel ?? label;
  const autocomplete = options.autocomplete ? `data-company-lookup="${escapeHtml(options.autocomplete)}"` : '';
  const numericAttributes = inputType === 'number'
    ? `inputmode="decimal" min="${escapeHtml(options.min ?? '0')}" ${options.max !== undefined ? `max="${escapeHtml(options.max)}"` : ''} step="${escapeHtml(options.step ?? '0.01')}"`
    : '';
  const integerAttributes = inputType === 'integer' ? 'inputmode="numeric" pattern="[0-9]*" maxlength="10"' : '';
  const phoneAttributes = inputType === 'tel'
    ? 'inputmode="tel" maxlength="40" pattern="[0-9+()\\-/. ,]+" data-phone="true" title="Use digits and phone punctuation only."'
    : '';
  const catalogList = options.key === 'description' ? 'list="product-catalog"' : '';
  const taxIdAttributes = name === 'customer.gst' || name === 'shipGst'
    ? 'maxlength="15" pattern="(-|[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z]Z[0-9A-Za-z])" title="Enter a valid 15-character GST number or -."'
    : name === 'customer.pan'
      ? 'maxlength="10" pattern="(-|[A-Za-z]{5}[0-9]{4}[A-Za-z])" title="Enter a valid 10-character PAN number or -."'
      : '';
  const control = options.multiline
    ? `<textarea class="paper-edit" name="${escapeHtml(name)}" ${key} ${autocomplete} aria-label="${escapeHtml(ariaLabel)}" rows="${options.rows || 2}" placeholder="${escapeHtml(options.placeholder || '')}" ${options.required ? 'required' : ''}>${escapeHtml(value)}</textarea>`
    : `<input class="paper-edit" name="${escapeHtml(name)}" ${key} ${autocomplete} ${catalogList} type="${controlType}" aria-label="${escapeHtml(ariaLabel)}" value="${escapeHtml(date ? toDisplayDate(value) : value)}" placeholder="${escapeHtml(date ? 'DD/MM/YYYY' : options.placeholder || '')}" ${date ? 'inputmode="numeric" maxlength="10" pattern="\\d{2}/\\d{2}/\\d{4}" data-date="true"' : `${numericAttributes} ${integerAttributes} ${phoneAttributes} ${taxIdAttributes}`} ${options.required ? 'required' : ''}>`;
  const autocompleteList = options.autocomplete
    ? `<div class="autocomplete-results" role="listbox" hidden></div>`
    : '';
  return `<label class="inline-field ${options.compact ? 'compact' : ''} ${options.className || ''} ${options.autocomplete ? 'has-autocomplete' : ''}"><span>${escapeHtml(label)}</span>${control}${autocompleteList}</label>`;
}

function inlineSelect(name, label, value, options) {
  return `<label class="inline-field"><span>${escapeHtml(label)}</span><select class="paper-edit" name="${escapeHtml(name)}"><option value="">Select status</option>${options.map((option) => `<option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
}

function editableRow(item = {}, index = 0) {
  const type = activeDocumentType;
  const itemField = (key, label, value = '', options = {}) => inlineField(
    `items.${index}.${key}`,
    label,
    value,
    { ...options, key, compact: true },
  );
  const descriptionLabel = type === 'invoice' ? 'Description of Service' : type === 'service-report' ? 'Part Name / Description' : type === 'challan' ? 'Item Description' : 'Description of Work / Material';
  const common = `<td class="description-cell" data-label="${descriptionLabel}">${itemField('description', descriptionLabel, item.description || '', { placeholder: 'Enter description', required: true })}</td>`;
  let cells;
  if (type === 'service-report') {
    cells = `<td data-label="Part No.">${itemField('partNo', 'Part No.', item.partNo || '')}</td><td data-label="Qty">${itemField('quantity', 'Qty', item.quantity ?? '', { placeholder: 'Qty', inputType: 'integer' })}</td><td data-label="Unit">${itemField('unit', 'Unit', item.unit || '')}</td><td data-label="Remarks">${itemField('remarks', 'Remarks', item.remarks || '')}</td>`;
  } else if (type === 'challan') {
    cells = `<td data-label="Quantity">${itemField('quantity', 'Quantity', item.quantity ?? '', { placeholder: 'Qty', inputType: 'integer', required: true })}</td><td data-label="Unit">${itemField('unit', 'Unit', item.unit || '')}</td>`;
  } else {
    cells = `<td data-label="HSN / SAC">${itemField('hsn', 'HSN / SAC', item.hsn || '', { placeholder: 'Code' })}</td><td data-label="Qty">${itemField('quantity', 'Qty', item.quantity ?? '', { placeholder: 'Qty', inputType: 'integer', required: true })}</td><td data-label="Unit">${itemField('unit', 'Unit', item.unit || '')}</td><td data-label="Unit rate">${itemField('rate', 'Unit rate (Rs.)', item.rate ?? '', { placeholder: '0.00', inputType: 'number', required: true })}</td><td data-label="Amount" class="numeric line-amount">${rupees(Number(item.quantity || 0) * Number(item.rate || 0))}</td>`;
  }
  return `<tr class="editable-item-row"><td class="row-number" data-label="Line">${index + 1}</td>${common}${cells}<td class="remove-cell" data-label="Actions"><button class="remove-row" type="button" aria-label="Remove line ${index + 1}">×</button></td></tr>`;
}

function editDocumentPaper(type, record = {}) {
  const client = record.customer || {};
  const pricing = type === 'quotation' || type === 'invoice';
  const title = documentLabels[type].toUpperCase();
  const metadata = {
    quotation: [
      ['number', 'Quotation No.', record.number || 'Assigned on save'],
      ['date', 'Quotation Date', record.date || localDate(), 'date'],
      ['validUntil', 'Valid Until', record.validUntil, 'date'],
      ['delivery', 'Delivery / Completion', record.delivery],
      ['projectName', 'Project / Site Name', record.projectName],
    ],
    invoice: [
      ['number', 'Invoice No.', record.number || 'Assigned on save'],
      ['date', 'Dated', record.date || localDate(), 'date'],
      ['dueDate', 'Due Date', record.dueDate, 'date'],
      ['orderNumber', 'P.O. Reference', record.orderNumber],
      ['paymentTerms', 'Payment Terms', record.paymentTerms],
    ],
    challan: [
      ['number', 'Challan No.', record.number || 'Assigned on save'],
      ['date', 'Challan Date', record.date || localDate(), 'date'],
      ['purchaseOrderNumber', 'P.O. No.', record.purchaseOrderNumber],
      ['purchaseOrderDate', 'P.O. Date', record.purchaseOrderDate, 'date'],
      ['dispatchThrough', 'Despatched Through', record.dispatchThrough],
      ['vehicleNumber', 'Vehicle No.', record.vehicleNumber],
      ['eWayBillNumber', 'E-way Bill No.', record.eWayBillNumber],
    ],
    'service-report': [
      ['number', 'Report No.', record.number || 'Assigned on save'],
      ['visitType', 'Visit Type', record.visitType],
      ['visitDate', 'Visit Date', record.visitDate || localDate(), 'date'],
      ['engineerName', 'Engineer Name', record.engineerName || record.preparedBy],
      ['nextService', 'Next Service', record.nextService, 'date'],
    ],
  }[type];
  if (type !== 'quotation' && record.sourceQuotationNumber) {
    metadata.push(['sourceQuotationNumber', 'Reference Quotation', record.sourceQuotationNumber]);
  }
  const metadataHtml = metadata.map(([name, label, value, fieldType]) => (
    `<div class="doc-field"><span class="doc-field-label">${escapeHtml(label)}:</span><span class="doc-field-value">${name === 'number' || name === 'sourceQuotationNumber' ? escapeHtml(value) : inlineField(name, '', value || '', { type: fieldType, ariaLabel: label, required: ['date', 'validUntil', 'visitDate'].includes(name) })}</span></div>`
  )).join('');

  const clientHtml = type === 'challan'
    ? `<h3 class="doc-section-title">BILLING, DELIVERY &amp; CONTACT DETAILS</h3><div class="challan-address-grid"><div><strong>Billing Address</strong>${inlineField('customer.name', 'Company', client.name || '', { required: true, autocomplete: 'company' })}${inlineField('customer.address', 'Address', client.address || '', { multiline: true, autocomplete: 'address' })}${inlineField('customer.pan', 'PAN No.', client.pan || '')}${inlineField('customer.gst', 'GST No.', client.gst || '')}</div><div><strong>Delivery Address</strong>${inlineField('deliveryName', 'Company', record.deliveryName || client.name || '')}${inlineField('deliveryAt', 'Address', record.deliveryAt || '', { multiline: true })}</div><div><strong>Contact Details</strong>${inlineField('customer.contactPerson', 'Contact', client.contactPerson || '')}${inlineField('customer.phone', 'Phone', client.phone || '', { className: 'phone-field', inputType: 'tel' })}${inlineField('customer.email', 'Email', client.email || '', { inputType: 'email' })}</div></div>`
    : type === 'invoice'
      ? `<div class="invoice-party-grid"><section><h3 class="doc-section-title">BILL TO</h3>${inlineField('customer.name', 'Customer Name', client.name || '', { required: true, autocomplete: 'company' })}${inlineField('customer.address', 'Address', client.address || '', { multiline: true, autocomplete: 'address' })}${inlineField('customer.city', 'City / State / PIN', client.city || '')}${inlineField('customer.contactPerson', 'Contact Person', client.contactPerson || '')}${inlineField('customer.phone', 'Phone', client.phone || '', { className: 'phone-field', inputType: 'tel' })}${inlineField('customer.email', 'Email', client.email || '', { inputType: 'email' })}${inlineField('customer.gst', 'GST No.', client.gst || '')}${inlineField('customer.pan', 'PAN No.', client.pan || '')}</section><section><h3 class="doc-section-title">SHIP TO</h3>${inlineField('shipName', 'Customer Name', record.shipName || client.name || '')}${inlineField('shipAddress', 'Address', record.shipAddress || client.address || '', { multiline: true })}${inlineField('shipGst', 'GST No.', record.shipGst || client.gst || '')}</section></div>`
      : type === 'service-report'
        ? ''
        : `<h3 class="doc-section-title">CLIENT DETAILS</h3><div class="doc-client-grid">${inlineField('customer.name', 'Client / Company Name', client.name || '', { required: true, autocomplete: 'company' })}${inlineField('customer.contactPerson', 'Contact Person', client.contactPerson || '')}${inlineField('customer.address', 'Address', client.address || '', { multiline: true, className: 'wide', autocomplete: 'address' })}${inlineField('customer.city', 'City / State / PIN', client.city || '')}${inlineField('customer.phone', 'Phone', client.phone || '', { className: 'phone-field', inputType: 'tel' })}${inlineField('customer.email', 'Email', client.email || '', { inputType: 'email' })}${inlineField('customer.gst', 'GST No. (Client)', client.gst || '')}${inlineField('customer.pan', 'PAN (Client)', client.pan || '')}</div>`;

  const itemColumnsHtml = type === 'service-report'
    ? '<th>Sr. No.</th><th>Part Name / Description</th><th>Part No.</th><th>Qty</th><th>Unit</th><th>Remarks</th><th></th>'
    : type === 'challan'
      ? '<th>Sr. No.</th><th>Item Description</th><th>Quantity</th><th>Unit</th><th></th>'
      : `<th>Sr. No.</th><th>${type === 'invoice' ? 'Description of Service' : 'Description of Work / Material'}</th><th>HSN / SAC</th><th>Qty</th><th>Unit</th><th>${type === 'invoice' ? 'Rate (Rs.)' : 'Unit Rate (Rs.)'}</th><th>Amount (Rs.)</th><th></th>`;
  const rows = (record.items || []).map((item, index) => editableRow(item, index)).join('');
  const scope = type === 'quotation'
    ? `<h3 class="doc-section-title">SCOPE OF WORK / PROJECT DESCRIPTION</h3>${inlineField('workDescription', 'Project scope', record.workDescription || '', { multiline: true, className: 'paper-scope', placeholder: 'Describe the overall project or work' })}`
    : type === 'service-report'
      ? `<h3 class="doc-section-title">PROBLEM REPORTED BY CUSTOMER</h3>${inlineField('reportedIssue', 'Reported problem', record.reportedIssue || '', { multiline: true, className: 'paper-scope' })}<h3 class="doc-section-title">WORK CARRIED OUT</h3>${inlineField('serviceDetails', 'Work carried out', record.serviceDetails || '', { multiline: true, className: 'paper-scope' })}`
      : '';
  const itemTitle = type === 'service-report' ? 'PARTS / MATERIALS USED' : type === 'challan' ? 'DELIVERY ITEMS' : 'WORK / MATERIAL DETAILS';
  const termsLabel = type === 'challan' ? 'Your Terms & Conditions of Sale' : type === 'service-report' ? 'ENGINEER OBSERVATIONS' : type === 'invoice' ? 'Terms & Conditions' : 'NOTES & TERMS';
  const terms = type === 'service-report'
    ? `<div class="service-bottom"><div class="doc-terms"><h3 class="doc-section-title">${termsLabel}</h3>${inlineField('recommendations', 'Engineer observations', record.recommendations || '', { multiline: true })}</div><div class="service-status"><h3 class="doc-section-title">SERVICE STATUS</h3>${inlineSelect('serviceStatus', 'Status', record.serviceStatus || '', ['Completed', 'Partially done', 'Pending - parts required', 'Under observation'])}</div></div>`
    : inlineField('terms', termsLabel, record.terms || '', { multiline: true, className: 'paper-terms', placeholder: type === 'challan' ? 'Enter the delivery terms shown on the challan' : 'Enter document terms and conditions' });
  const bank = type === 'invoice'
    ? `<h3 class="doc-section-title">BANK DETAILS</h3><div class="invoice-bank"><div>${inlineField('bankName', 'Bank Name', record.bankName || '')}${inlineField('accountNumber', 'Account No.', record.accountNumber || '')}</div><div>${inlineField('ifscCode', 'IFSC Code', record.ifscCode || '')}${inlineField('bankBranch', 'Branch', record.bankBranch || '')}</div></div>`
    : '';
  const serviceDetails = type === 'service-report'
    ? `<h3 class="doc-section-title">CUSTOMER &amp; EQUIPMENT DETAILS</h3><div class="doc-client-grid">${inlineField('customer.name', 'Customer Name', client.name || '', { required: true, autocomplete: 'company' })}${inlineField('siteName', 'Project / Site', record.siteName || '')}${inlineField('equipment', 'Machine / Equipment', record.equipment || '')}${inlineField('serviceNumber', 'Service No. / ID', record.serviceNumber || '')}${inlineField('customer.address', 'Address', client.address || '', { multiline: true, className: 'wide', autocomplete: 'address' })}${inlineField('customer.city', 'City / State / PIN', client.city || '')}${inlineField('customer.contactPerson', 'Contact Person', client.contactPerson || '')}${inlineField('customer.phone', 'Phone', client.phone || '', { className: 'phone-field', inputType: 'tel' })}${inlineField('customer.email', 'Email', client.email || '', { inputType: 'email' })}${inlineField('installationDate', 'Installation Date', record.installationDate || '', { type: 'date' })}</div>`
    : '';
  const challanReason = type === 'challan'
    ? inlineField('purpose', 'Reason for transport', record.purpose || '', { multiline: true, className: 'paper-scope' })
    : '';
  const taxControls = pricing
    ? `<div class="tax-controls"><label class="inline-field"><span>Tax treatment</span><select class="paper-edit" name="taxMode"><option value="intra"${(record.taxMode || 'intra') === 'intra' ? ' selected' : ''}>CGST + SGST (intra-state)</option><option value="inter"${record.taxMode === 'inter' ? ' selected' : ''}>IGST (inter-state)</option></select></label>${inlineField('taxRate', 'GST (%)', record.taxRate ?? 18, { inputType: 'number', max: 100 })}${inlineField('discount', 'Discount (Rs.)', record.discount ?? 0, { inputType: 'number' })}</div>`
    : '';
  const totals = pricing
    ? `<table class="doc-totals"><tbody><tr><td>Sub Total:</td><td id="paper-subtotal">${rupees(totalAmounts(record).subtotal)}</td></tr><tr class="paper-cgst"><td>CGST (${Number(record.taxRate ?? 18) / 2}%):</td><td id="paper-cgst">${rupees(totalAmounts(record).cgst)}</td></tr><tr class="paper-sgst"><td>SGST (${Number(record.taxRate ?? 18) / 2}%):</td><td id="paper-sgst">${rupees(totalAmounts(record).sgst)}</td></tr><tr class="paper-igst" hidden><td>IGST (${Number(record.taxRate ?? 18)}%):</td><td id="paper-igst">${rupees(totalAmounts(record).igst)}</td></tr><tr><td>Discount:</td><td id="paper-discount">${rupees(totalAmounts(record).discount)}</td></tr><tr class="grand"><td>GRAND TOTAL:</td><td id="paper-grand-total">${rupees(totalAmounts(record).grand)}</td></tr></tbody></table>`
    : '';
  const amountWords = pricing
    ? `<div class="doc-words"><span>Amount in Words:</span><span id="paper-amount-words">${escapeHtml(numberToWords(totalAmounts(record).grand))}</span></div>`
    : '';
  const invoiceTotals = type === 'invoice' ? `<div class="invoice-totals-layout">${totals}</div>${amountWords}` : '';
  const quotationSummary = type === 'quotation'
    ? `${taxControls}<div class="doc-totals-layout"><div class="doc-terms"><h3 class="doc-section-title">NOTES &amp; TERMS</h3>${terms}</div><div class="quotation-total-side">${totals}</div></div>${amountWords}`
    : '';
  const signature = type === 'service-report'
    ? `<div class="service-signatures"><div><span></span><small>Customer Signature</small></div><div><span></span><small>Engineer Signature · ${escapeHtml(record.engineerName || '')}</small></div><div><span></span><small>Supervisor / Approval</small></div></div>`
    : `<div class="${type === 'challan' ? 'challan-signatures' : 'doc-signature-row'}">${type === 'challan' ? `<div class="receiver-signature"><span>________________________</span>${inlineField('receivedBy', 'Received by', record.receivedBy || '')}<small>Receiver’s Signature</small></div>` : ''}<div class="doc-signature">For VEERBHADRA ENGINEERS${inlineField('preparedBy', 'Authorised Signatory', record.preparedBy || 'Saurabh Tekale')}</div></div>`;
  const footer = '<footer class="doc-footer"><span>Veerbhadra Engineers&nbsp; | &nbsp;GST: 27ASKPT6880H1ZZ&nbsp; | &nbsp;Engineering Services&nbsp; | &nbsp;Pune, Maharashtra</span><span>Page 01</span></footer>';
  const addItemLabel = type === 'service-report'
    ? '＋ Add part'
    : type === 'challan' ? '＋ Add delivered item' : '＋ Add work / material';
  return `<header class="doc-header"><img class="doc-logo" src="logo.jpg" alt="Veerbhadra Engineers logo"><div class="doc-brand"><h1>VEERBHADRA ENGINEERS</h1><p>Your Vision, Our Execution</p></div><div class="doc-company-meta"><p>Ph: +91 8007717684 / 9823921132</p><p>Email: veerbhadra24.engineers@gmail.com</p><p>GST: 27ASKPT6880H1ZZ</p><p>Address: Flat 505, Gulmohar Symphony, PH-1,<br>Tukaram Nagar, Kharadi, Pune - 411014</p></div></header>
    <h2 class="doc-title">${title}</h2><div class="doc-content">
    <div class="doc-fields">${metadataHtml}</div>${clientHtml}${serviceDetails}${scope}
    <h3 class="doc-section-title">${itemTitle}</h3>
    <table class="doc-items editable-items ${type === 'service-report' ? 'service-parts' : ''}"><thead><tr>${itemColumnsHtml}</tr></thead><tbody id="live-item-rows">${rows}</tbody></table><div class="inline-item-actions"><button class="button button-outline add-item-inline" type="button">${addItemLabel}</button><span>Add one line for each separate work or material item.</span></div>
    ${type === 'quotation' ? quotationSummary : type === 'invoice' ? '' : terms}${challanReason}${type === 'quotation' ? '' : taxControls}${type === 'quotation' ? '' : type === 'invoice' ? invoiceTotals : totals}${bank}${type === 'invoice' ? `<h3 class="invoice-terms-heading">Terms &amp; Conditions</h3>${inlineField('terms', 'Terms & Conditions', record.terms || '', { multiline: true })}` : ''}${signature}</div>${footer}`;
}

function openEditor(type, record = null, viewOnly = false) {
  activeDocumentType = type;
  currentRecord = record;
  previewOrigin = 'editor';
  activateView('editor', viewOnly && record
    ? `${documentLabels[type]} · ${record.number}`
    : record?._id ? `Edit ${documentLabels[type]} · ${record.number}` : `New ${documentLabels[type].toLowerCase()}`);
  dom.documentForm.reset();
  dom.documentForm.elements.type.value = type;
  dom.editorPaper.innerHTML = editDocumentPaper(type, record || { items: [] });
  const addButtonLabel = type === 'service-report'
    ? '＋ Add part'
    : type === 'challan' ? '＋ Add delivered item' : '＋ Add work / material';
  document.getElementById('add-row-button').textContent = addButtonLabel;
  document.getElementById('add-row-button').hidden = viewOnly;
  document.getElementById('save-button').textContent = record?._id ? 'Update document' : 'Save document';
  document.getElementById('save-button').hidden = viewOnly;
  document.getElementById('print-draft-button').hidden = viewOnly;
  document.getElementById('preview-document-button').hidden = viewOnly;
  dom.editorPaper.querySelector('.inline-item-actions').hidden = viewOnly;
  bindCustomerAutocomplete();
  dom.editorPaper.querySelectorAll('[data-date="true"]').forEach((control) => {
    control.addEventListener('input', formatDateInput);
    control.addEventListener('blur', formatDateInput);
  });
  dom.editorPaper.querySelectorAll('.paper-edit').forEach((control) => {
    control.addEventListener('input', updateTotals);
    control.addEventListener('change', updateTotals);
  });
  bindCatalogFields(dom.editorPaper);
  bindPhoneFields(dom.editorPaper);
  dom.editorPaper.querySelectorAll('.remove-row').forEach((button) => {
    button.addEventListener('click', () => {
      button.closest('tr').remove();
      renumberRows();
      updateTotals();
    });
  });
  document.querySelectorAll('.nav-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.create === type);
  });
  window.scrollTo(0, 0);
}

function bindCustomerAutocomplete() {
  dom.editorPaper.querySelectorAll('[data-company-lookup]').forEach((input) => {
    let requestSequence = 0;
    const results = input.closest('.inline-field').querySelector('.autocomplete-results');
    const closeResults = () => {
      results.replaceChildren();
      results.hidden = true;
    };
    input.addEventListener('input', () => {
      clearTimeout(companySearchTimers.get(input));
      const query = input.value.trim();
      if (query.length < 2) {
        closeResults();
        return;
      }
      const sequence = ++requestSequence;
      const timer = setTimeout(async () => {
        try {
          const matches = await api(`/api/companies?q=${encodeURIComponent(query)}`);
          if (sequence !== requestSequence || !input.isConnected) return;
          results.replaceChildren();
          for (const company of matches) {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'autocomplete-option';
            option.setAttribute('role', 'option');
            const companyName = document.createElement('strong');
            companyName.textContent = company.name;
            const companyDetails = document.createElement('span');
            companyDetails.textContent = [company.address, company.city, company.contactPerson, company.phone]
              .filter(Boolean).join(' · ');
            option.append(companyName, companyDetails);
            option.addEventListener('mousedown', (event) => event.preventDefault());
            option.addEventListener('click', () => {
              fillCustomerDetails(company);
              closeResults();
              input.focus();
            });
            results.append(option);
          }
          results.hidden = matches.length === 0;
        } catch (error) {
          if (sequence === requestSequence) {
            closeResults();
            announce(`Company lookup failed: ${error.message}`, true);
          }
        }
      }, 220);
      companySearchTimers.set(input, timer);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeResults();
      if (event.key === 'Enter' && !results.hidden) {
        event.preventDefault();
        results.querySelector('.autocomplete-option')?.click();
      }
    });
    input.addEventListener('blur', () => {
      setTimeout(closeResults, 150);
    });
  });
}

function fillCustomerDetails(company) {
  const oldCustomer = collectCustomerFields();
  const fields = {
    name: company.name,
    address: company.address,
    city: company.city,
    phone: company.phone,
    contactPerson: company.contactPerson,
    email: company.email,
    gst: company.gst,
    pan: company.pan,
  };
  for (const [key, value] of Object.entries(fields)) {
    const input = dom.editorPaper.querySelector(`[name="customer.${key}"]`);
    if (input) input.value = value || '';
  }
  const linkedShipFields = [
    ['shipName', 'name'],
    ['shipAddress', 'address'],
    ['shipGst', 'gst'],
  ];
  for (const [name, key] of linkedShipFields) {
    const input = dom.editorPaper.querySelector(`[name="${name}"]`);
    if (input && (!input.value || input.value === oldCustomer[key])) input.value = fields[key] || '';
  }
  dom.documentForm.dispatchEvent(new Event('input', { bubbles: true }));
}

function collectCustomerFields() {
  const customer = {};
  for (const input of dom.editorPaper.querySelectorAll('[name^="customer."]')) {
    customer[input.name.slice('customer.'.length)] = input.value.trim();
  }
  return customer;
}

function formatDateInput(event) {
  const control = event.currentTarget;
  const digits = control.value.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) control.value = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  else if (digits.length > 2) control.value = `${digits.slice(0, 2)}/${digits.slice(2)}`;
  else control.value = digits;
  const month = digits.length >= 4 ? Number(digits.slice(2, 4)) : 0;
  control.setCustomValidity(month > 12
    ? 'Month must be between 01 and 12.'
    : control.value.length === 10 && !isRealDisplayDate(control.value)
      ? 'Enter a real calendar date in DD/MM/YYYY format.'
      : '');
}

function bindPhoneFields(root = dom.editorPaper) {
  root.querySelectorAll('[data-phone="true"]').forEach((control) => {
    control.addEventListener('input', () => {
      control.value = control.value.replace(/[^0-9+()\/., -]/g, '');
      control.setCustomValidity('');
    });
  });
}

function bindCatalogFields(root = dom.editorPaper) {
  root.querySelectorAll('[data-key="description"]').forEach((input) => {
    input.addEventListener('change', () => {
      const description = input.value.trim().toLocaleLowerCase('en');
      const product = productCatalog.find((entry) => entry.description.trim().toLocaleLowerCase('en') === description);
      if (!product) return;
      const row = input.closest('tr');
      for (const [key, value] of Object.entries({
        hsn: product.hsn,
        partNo: product.partNo,
        unit: product.unit,
        rate: product.rate,
      })) {
        const control = row.querySelector(`[data-key="${key}"]`);
        if (control && value !== undefined && value !== ''
          && !(key === 'rate' && Number(value) <= 0)) control.value = value;
      }
      updateTotals();
    });
  });
}

async function loadProductCatalog() {
  productCatalog = await api('/api/products');
  const options = productCatalog.map((product) => {
    const option = document.createElement('option');
    option.value = product.description;
    return option;
  });
  document.getElementById('product-catalog').replaceChildren(...options);
}

function addItemRow(item = {}) {
  const rows = dom.editorPaper.querySelector('#live-item-rows');
  if (!rows) return;
  const rowDefaults = { ...item };
  rows.insertAdjacentHTML('beforeend', editableRow(rowDefaults, rows.children.length));
  const row = rows.lastElementChild;
  row.querySelectorAll('.paper-edit').forEach((control) => control.addEventListener('input', updateTotals));
  bindCatalogFields(row);
  bindPhoneFields(row);
  row.querySelector('.remove-row').addEventListener('click', () => {
    row.remove();
    renumberRows();
    updateTotals();
  });
  row.querySelector('[data-key="description"]')?.focus();
  updateTotals();
}

function renumberRows() {
  dom.editorPaper.querySelectorAll('#live-item-rows tr').forEach((row, index) => {
    row.querySelector('.row-number').textContent = String(index + 1);
    row.querySelector('.remove-row').setAttribute('aria-label', `Remove line ${index + 1}`);
    row.querySelectorAll('[data-key]').forEach((input) => {
      input.name = `items.${index}.${input.dataset.key}`;
    });
  });
}

function collectFormData() {
  const data = Object.fromEntries(new FormData(dom.documentForm).entries());
  const customer = collectCustomerFields();
  const fields = {};
  for (const field of documentFields[activeDocumentType]) {
    const value = data[field.name] || '';
    fields[field.name] = field.type === 'date' ? toDatabaseDate(value) : value;
  }
  const items = [...dom.editorPaper.querySelectorAll('#live-item-rows tr')].map((row) => {
    const value = (key) => row.querySelector(`[data-key="${key}"]`)?.value.trim() || '';
    return {
      description: value('description'),
      hsn: value('hsn'),
      partNo: value('partNo'),
      remarks: value('remarks'),
      quantity: Number(value('quantity')),
      unit: value('unit'),
      rate: activeDocumentType === 'challan' || activeDocumentType === 'service-report' ? 0 : Number(value('rate')),
    };
  }).filter((item) => item.description || item.partNo || item.remarks);
  return {
    type: activeDocumentType,
    date: toDatabaseDate(data.date || (activeDocumentType === 'service-report' ? data.visitDate : '')),
    ...fields,
    customer,
    workDescription: data.workDescription || '',
    items,
    taxMode: data.taxMode || 'intra',
    taxRate: Number(data.taxRate) || 0,
    discount: Number(data.discount) || 0,
    terms: data.terms || '',
    preparedBy: data.preparedBy || '',
    receivedBy: data.receivedBy || '',
    sourceQuotationId: currentRecord?.sourceQuotationId || '',
    sourceQuotationNumber: currentRecord?.sourceQuotationNumber || '',
  };
}

function totalAmounts(record) {
  const subtotal = (record.items || []).reduce(
    (total, item) => {
      const quantity = Number(item.quantity ?? item.qty ?? 0);
      const rate = Number(item.rate ?? item.unitRate ?? item.unitPrice);
      const rateTotal = Number.isFinite(rate) && rate > 0 ? quantity * rate : 0;
      const savedLineTotal = Number(item.lineTotal ?? item.totalAmount ?? item.amount);
      return total + (rateTotal > 0 ? rateTotal : Number.isFinite(savedLineTotal) && savedLineTotal > 0 ? savedLineTotal : 0);
    },
    0,
  );
  const discount = Math.min(Math.max(Number(record.discount) || 0, 0), subtotal);
  const money = (amount) => Math.round((amount + Number.EPSILON) * 100) / 100;
  const roundedSubtotal = money(subtotal);
  const roundedDiscount = money(discount);
  const taxable = money(roundedSubtotal - roundedDiscount);
  const taxRate = Math.max(0, Number(record.taxRate) || 0);
  const cgst = record.taxMode === 'inter' ? 0 : money(taxable * taxRate / 200);
  const sgst = record.taxMode === 'inter' ? 0 : money(taxable * taxRate / 200);
  const igst = record.taxMode === 'inter' ? money(taxable * taxRate / 100) : 0;
  const tax = cgst + sgst + igst;
  return { subtotal: roundedSubtotal, discount: roundedDiscount, taxable, tax, cgst, sgst, igst, grand: money(taxable + tax) };
}

function invoiceReceivedAmount(record, total = totalAmounts(record).grand) {
  if (Array.isArray(record.paymentEntries)) {
    const entryTotal = record.paymentEntries.reduce(
      (sum, payment) => sum + (payment.reversed ? 0 : Number(payment.amount) || 0),
      0,
    );
    if (entryTotal > 0) return entryTotal + (Number(record.legacyPaidAmount) || 0);
    if (record.paymentEntries.length) return Number(record.legacyPaidAmount) || 0;
  }
  const legacyPaidAmount = Number(record.legacyPaidAmount ?? record.paidAmount);
  if (Number.isFinite(legacyPaidAmount) && legacyPaidAmount > 0) {
    return legacyPaidAmount;
  }
  if (record.paidAmount !== undefined && Number.isFinite(Number(record.paidAmount))) {
    return Math.max(0, Number(record.paidAmount));
  }
  return record.paymentStatus === 'paid' ? total : 0;
}

function invoicePaymentState(record, total = totalAmounts(record).grand) {
  if (!Number.isFinite(total) || total <= 0) return 'unpaid';
  const received = invoiceReceivedAmount(record, total);
  if (received <= 0) return 'unpaid';
  return received >= total ? 'paid' : 'partial';
}

function invoiceIsOverdue(record, total = invoiceDocumentTotal(record), asOf = localDate()) {
  return invoicePaymentState(record, total) !== 'paid'
    && /^\d{4}-\d{2}-\d{2}$/.test(record.dueDate || '')
    && record.dueDate < asOf;
}

function invoiceDocumentTotal(record) {
  const calculated = totalAmounts(record).grand;
  if (calculated > 0) return calculated;
  for (const value of [record.invoiceAmount, record.grandTotal, record.totalAmount, record.total]) {
    const stored = Number(value);
    if (Number.isFinite(stored) && stored > 0) return stored;
  }
  return calculated;
}

function renderPaymentHistory(container, record) {
  container.replaceChildren();
  const entries = Array.isArray(record.paymentEntries) ? record.paymentEntries : [];
  const history = entries.map((payment) => ({
    amount: Number(payment.amount) || 0,
    date: payment.date || '',
    method: payment.method || 'Method not recorded',
    reversed: Boolean(payment.reversed),
  }));
  const legacyPaidAmount = Number(record.legacyPaidAmount ?? record.paidAmount) || 0;
  if (legacyPaidAmount > 0 && !history.some((payment) => !payment.reversed)) {
    history.unshift({
      amount: legacyPaidAmount,
      date: record.paidAt || '',
      method: record.paymentMethod || 'Legacy payment',
      reversed: false,
    });
  }
  if (!history.length) return;

  const details = document.createElement('details');
  details.className = 'invoice-payment-history';
  const summary = document.createElement('summary');
  const receivedCount = history.filter((payment) => !payment.reversed).length;
  const reversedCount = history.length - receivedCount;
  summary.textContent = `Payment history · ${receivedCount} received${reversedCount ? ` · ${reversedCount} reversed` : ''}`;
  const list = document.createElement('ol');
  for (const payment of history) {
    const item = document.createElement('li');
    const main = document.createElement('span');
    main.textContent = `${rupees(payment.amount)} · ${payment.date ? displayDate(payment.date) : 'Date not recorded'} · ${payment.method}`;
    const status = document.createElement('strong');
    status.className = `payment-entry-status${payment.reversed ? ' payment-reversed' : ' payment-received'}`;
    status.textContent = payment.reversed ? 'Reversed' : 'Received';
    item.append(main, status);
    list.append(item);
  }
  details.append(summary, list);
  container.append(details);
}

function updateTotals() {
  const pricing = activeDocumentType === 'quotation' || activeDocumentType === 'invoice';
  const rows = [...dom.editorPaper.querySelectorAll('#live-item-rows tr')];
  const items = rows.map((row) => ({
    quantity: Number(row.querySelector('[data-key="quantity"]')?.value) || 0,
    rate: Number(row.querySelector('[data-key="rate"]')?.value) || 0,
  }));
  rows.forEach((row, index) => {
    const cell = row.querySelector('.line-amount');
    if (cell) cell.textContent = rupees(items[index].quantity * items[index].rate);
  });
  if (!pricing) return;
  const data = Object.fromEntries(new FormData(dom.documentForm).entries());
  const record = {
    items,
    taxRate: Number(data.taxRate) || 0,
    discount: Number(data.discount) || 0,
    taxMode: data.taxMode || 'intra',
  };
  const total = totalAmounts(record);
  dom.editorPaper.querySelector('#paper-subtotal').textContent = rupees(total.subtotal);
  dom.editorPaper.querySelector('#paper-cgst').textContent = rupees(total.cgst);
  dom.editorPaper.querySelector('#paper-sgst').textContent = rupees(total.sgst);
  dom.editorPaper.querySelector('#paper-igst').textContent = rupees(total.igst);
  dom.editorPaper.querySelector('#paper-discount').textContent = rupees(total.discount);
  dom.editorPaper.querySelector('#paper-grand-total').textContent = rupees(total.grand);
  dom.editorPaper.querySelector('#paper-amount-words').textContent = numberToWords(total.grand);
  const interState = record.taxMode === 'inter';
  const rate = Number(record.taxRate) || 0;
  dom.editorPaper.querySelector('.paper-cgst td:first-child').textContent = `CGST (${rate / 2}%):`;
  dom.editorPaper.querySelector('.paper-sgst td:first-child').textContent = `SGST (${rate / 2}%):`;
  dom.editorPaper.querySelector('.paper-igst td:first-child').textContent = `IGST (${rate}%):`;
  dom.editorPaper.querySelector('.paper-cgst').hidden = interState;
  dom.editorPaper.querySelector('.paper-sgst').hidden = interState;
  dom.editorPaper.querySelector('.paper-igst').hidden = !interState;
}

function field(label, value, wide = false) {
  return `<div class="doc-client-field ${wide ? 'wide' : ''}"><span>${escapeHtml(label)}:</span><span>${escapeHtml(value || '')}</span></div>`;
}

function buildPrintDocument(record) {
  const type = record.type;
  dom.printDocument.dataset.documentType = type;
  const pricing = type === 'quotation' || type === 'invoice';
  const amount = pricing ? totalAmounts(record) : null;
  const topFields = {
    quotation: [
      ['Quotation No.', record.number], ['Quotation Date', displayDate(record.date)],
      ['Valid Until', displayDate(record.validUntil)], ['Delivery / Completion', record.delivery],
      ['Project / Site', record.projectName], ['Approval Status', record.approvalStatus === 'approved' ? 'Approved' : record.approvalStatus === 'rejected' ? 'Rejected' : 'Pending approval'],
    ],
    invoice: [
      ['Invoice No.', record.number], ['Due Date', displayDate(record.dueDate)],
      ['P.O. Reference', record.orderNumber], ['Payment Terms', record.paymentTerms],
    ],
    challan: [
      ['Challan No.', record.number], ['Challan Date', displayDate(record.date)],
      ['P.O. No.', record.purchaseOrderNumber], ['P.O. Date', displayDate(record.purchaseOrderDate)],
      ['Dispatch Through', record.dispatchThrough], ['Vehicle No.', record.vehicleNumber],
      ['E-way Bill No.', record.eWayBillNumber], ['Reference Quotation', record.sourceQuotationNumber],
    ],
    'service-report': [
      ['Report No.', record.number], ['Visit Type', record.visitType],
      ['Visit Date', displayDate(record.visitDate)], ['Engineer Name', record.engineerName || record.preparedBy],
      ['Next Service', displayDate(record.nextService)], ['Reference Quotation', record.sourceQuotationNumber],
    ],
  }[type];
  const client = record.customer || {};
  const itemColumnsForPrint = type === 'service-report'
    ? [['Part Name / Description', 'description'], ['Part No.', 'partNo'], ['Qty', 'quantity'], ['Unit', 'unit'], ['Remarks', 'remarks']]
    : type === 'challan'
      ? [['Item Description', 'description'], ['Quantity', 'quantity'], ['Unit', 'unit']]
      : type === 'invoice'
        ? [['Description of Service', 'description'], ['HSN / SAC', 'hsn'], ['Qty', 'quantity'], ['Unit', 'unit'], ['Rate (Rs.)', 'rate'], ['Amount (Rs.)', 'amount']]
        : [['Description of Work / Material', 'description'], ['HSN / SAC', 'hsn'], ['Qty', 'quantity'], ['Unit', 'unit'], ['Unit Rate (Rs.)', 'rate'], ['Amount (Rs.)', 'amount']];
  const itemRows = [...(record.items || [])];
  const columns = `<th>Sr. no.</th>${itemColumnsForPrint.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('')}`;
  const rows = itemRows.map((item, index) => {
      const cells = itemColumnsForPrint.map(([, key]) => {
        if (key === 'amount') return `<td class="numeric">${rupees(Number(item.quantity) * Number(item.rate))}</td>`;
        if (key === 'rate') return `<td class="numeric">${rupees(item.rate)}</td>`;
        return `<td>${escapeHtml(item[key])}</td>`;
      }).join('');
      return `<tr><td>${index + 1}</td>${cells}</tr>`;
  }).join('');
  const metadata = topFields.map(([label, value]) => field(label, value)).join('');
  const table = `<table class="doc-items ${type === 'service-report' ? 'service-parts' : ''}"><thead><tr>${columns}</tr></thead><tbody>${rows || `<tr><td class="empty-print-row" colspan="${itemColumnsForPrint.length + 1}">No parts or materials recorded.</td></tr>`}</tbody></table>`;
  const totalsRows = pricing
      ? `<tr><td>Sub Total:</td><td>${rupees(amount.subtotal)}</td></tr>
        ${record.taxMode === 'inter'
          ? `<tr><td>IGST (${escapeHtml(record.taxRate)}%):</td><td>${rupees(amount.igst)}</td></tr>`
          : `<tr><td>CGST (${escapeHtml(Number(record.taxRate) / 2)}%):</td><td>${rupees(amount.cgst)}</td></tr><tr><td>SGST (${escapeHtml(Number(record.taxRate) / 2)}%):</td><td>${rupees(amount.sgst)}</td></tr>`}
        <tr><td>Discount:</td><td>${rupees(amount.discount)}</td></tr>
        <tr class="grand"><td>GRAND TOTAL:</td><td>${rupees(amount.grand)}</td></tr>`
      : '';
  const customer = type === 'challan'
      ? `<h3 class="doc-section-title">BILLING, DELIVERY &amp; CONTACT DETAILS</h3><div class="challan-address-grid"><div><strong>Billing Address</strong><span>${escapeHtml(client.name)}${client.address ? `\n${escapeHtml(client.address)}` : ''}${client.city ? `\n${escapeHtml(client.city)}` : ''}${client.pan ? `\nPAN: ${escapeHtml(client.pan)}` : ''}${client.gst ? `\nGST No.: ${escapeHtml(client.gst)}` : ''}</span></div><div><strong>Delivery Address</strong><span>${escapeHtml(record.deliveryName || client.name)}${record.deliveryAt ? `\n${escapeHtml(record.deliveryAt)}` : ''}</span></div><div><strong>Contact Details</strong><span>${escapeHtml(client.contactPerson)}${client.phone ? `\n${escapeHtml(client.phone)}` : ''}${client.email ? `\n${escapeHtml(client.email)}` : ''}</span></div></div>`
      : type === 'invoice'
        ? `<div class="invoice-party-grid"><section><h3 class="doc-section-title">BILL TO</h3>${field('Customer Name', client.name)}${field('Address', client.address, true)}${client.city ? field('City / State / PIN', client.city) : ''}${client.contactPerson ? field('Contact Person', client.contactPerson) : ''}${client.phone ? field('Phone', client.phone) : ''}${client.email ? field('Email', client.email) : ''}${field('GST No.', client.gst)}${client.pan ? field('PAN', client.pan) : ''}</section><section><h3 class="doc-section-title">SHIP TO</h3>${field('Customer Name', record.shipName || client.name)}${field('Address', record.shipAddress || client.address, true)}${record.shipGst || client.gst ? field('GST No.', record.shipGst || client.gst) : ''}</section></div>`
        : type === 'service-report'
          ? `<h3 class="doc-section-title">CUSTOMER &amp; EQUIPMENT DETAILS</h3><div class="doc-client-grid">${field('Customer Name', client.name)}${field('Project / Site', record.siteName)}${field('Machine / Equipment', record.equipment)}${field('Service No. / ID', record.serviceNumber)}${field('Address', client.address, true)}${field('City / State / PIN', client.city)}${field('Contact Person', client.contactPerson)}${field('Phone', client.phone)}${field('Email', client.email)}${field('Installation Date', displayDate(record.installationDate))}</div>`
          : `<h3 class="doc-section-title">CLIENT DETAILS</h3><div class="doc-client-grid">${field('Client / Company Name', client.name)}${field('Contact Person', client.contactPerson)}${field('Address', client.address, true)}${field('City / State / PIN', client.city)}${field('Phone', client.phone)}${field('Email', client.email)}${field('GST No. (Client)', client.gst)}${field('PAN (Client)', client.pan)}</div>`;
  const termsBlock = `<h3 class="doc-section-title">${type === 'challan' ? 'TERMS &amp; CONDITIONS OF DELIVERY' : 'TERMS &amp; CONDITIONS'}</h3><div class="doc-scope">${escapeHtml(record.terms || '')}</div>`;
  const taxTotals = pricing
    ? `<table class="doc-totals"><tbody>${totalsRows}</tbody></table>`
    : '';
  const amountWords = pricing
    ? `<div class="doc-words"><span>Amount in Words:</span><span>${escapeHtml(numberToWords(amount.grand))}</span></div>`
    : '';
  const bankDetails = `<h3 class="doc-section-title">BANK DETAILS</h3><div class="invoice-bank">
    <div class="invoice-bank-row"><span>Bank Name:</span><span>${escapeHtml(record.bankName)}</span></div>
    <div class="invoice-bank-row"><span>Account No.:</span><span>${escapeHtml(record.accountNumber)}</span></div>
    <div class="invoice-bank-row"><span>IFSC Code:</span><span>${escapeHtml(record.ifscCode)}</span></div>
    <div class="invoice-bank-row"><span>Branch:</span><span>${escapeHtml(record.bankBranch)}</span></div>
  </div>`;
  const signature = `<div class="doc-signature-row"><div class="doc-signature">For VEERBHADRA ENGINEERS<small>Authorised Signatory${record.preparedBy ? ` · ${escapeHtml(record.preparedBy)}` : ''}</small></div></div>`;
  const serviceStatus = ['Completed', 'Partially done', 'Pending - parts required', 'Under observation']
      .map((status) => `<span><i class="${record.serviceStatus === status ? 'checked' : ''}"></i>${escapeHtml(status)}</span>`).join('');
  const content = type === 'quotation'
      ? `${customer}<h3 class="doc-section-title">SCOPE OF WORK / PROJECT DESCRIPTION</h3><div class="doc-scope">${escapeHtml(record.workDescription || '')}</div><h3 class="doc-section-title">WORK / MATERIAL DETAILS</h3>${table}<div class="doc-totals-layout"><div class="doc-terms"><h3 class="doc-section-title">NOTES &amp; TERMS</h3><div class="doc-terms-body">${escapeHtml(record.terms || '')}</div></div><div>${taxTotals}</div></div>${amountWords}${signature}`
      : type === 'invoice'
        ? `${customer}<h3 class="doc-section-title">INVOICE DETAILS</h3>${table}<div class="invoice-totals-layout">${taxTotals}</div>${amountWords}${bankDetails}${termsBlock}${signature}`
        : type === 'challan'
          ? `${customer}<h3 class="doc-section-title">DELIVERY ITEMS</h3>${table}<h3 class="doc-section-title">REASON FOR TRANSPORT / REMARKS</h3><div class="doc-scope">${escapeHtml(record.purpose || '')}</div>${termsBlock}<div class="challan-signatures"><div class="receiver-signature"><span>________________________</span><small>${escapeHtml(record.receivedBy || '')}</small><small>Receiver’s signature &amp; date</small></div>${signature}</div>`
          : `${customer}<h3 class="doc-section-title">PROBLEM REPORTED BY CUSTOMER</h3><div class="doc-scope">${escapeHtml(record.reportedIssue || '')}</div><h3 class="doc-section-title">WORK CARRIED OUT</h3><div class="doc-scope service-box">${escapeHtml(record.serviceDetails || '')}</div><h3 class="doc-section-title">PARTS / MATERIALS USED</h3>${table}<div class="service-bottom"><div class="doc-terms"><h3 class="doc-section-title">ENGINEER OBSERVATIONS</h3><div class="doc-terms-body">${escapeHtml(record.recommendations || '')}</div></div><div class="service-status"><h3 class="doc-section-title">SERVICE STATUS</h3><div class="service-status-options">${serviceStatus}</div></div></div><div class="service-signatures"><div><span></span><small>Customer Signature${record.receivedBy ? ` · ${escapeHtml(record.receivedBy)}` : ''}</small></div><div><span></span><small>Engineer Signature · ${escapeHtml(record.engineerName || record.preparedBy || '')}</small></div><div><span></span><small>Supervisor / Approval</small></div></div>`;
  const footer = '<footer class="doc-footer"><span>Veerbhadra Engineers&nbsp; | &nbsp;GST: 27ASKPT6880H1ZZ&nbsp; | &nbsp;Engineering Services&nbsp; | &nbsp;Pune, Maharashtra</span></footer>';
  const header = `<header class="doc-header">
        <img class="doc-logo" src="logo.jpg" alt="Veerbhadra Engineers logo">
        <div class="doc-brand"><h1>VEERBHADRA ENGINEERS</h1><p>Your Vision, Our Execution</p></div>
        <div class="doc-company-meta"><p>Ph: +91 8007717684 / 9823921132</p><p>Email: veerbhadra24.engineers@gmail.com</p><p>GST: 27ASKPT6880H1ZZ</p><p>Address: Flat 505, Gulmohar Symphony, PH-1,<br>Tukaram Nagar, Kharadi, Pune - 411014</p></div>
      </header><h2 class="doc-title">${escapeHtml(documentLabels[type].toUpperCase())}</h2>`;
  dom.printDocument.innerHTML = `<table class="print-page-frame">
      <thead><tr><td>${header}</td></tr></thead>
      <tbody><tr><td><div class="doc-content"><div class="doc-fields">${metadata}</div>${content}</div></td></tr></tbody>
      <tfoot><tr><td>${footer}</td></tr></tfoot>
    </table>`;
}

function showPreview(record, origin) {
  previewOrigin = origin;
  previewRecord = record;
  if (record._id) currentRecord = record;
  buildPrintDocument(record);
  activateView('preview', `${documentLabels[record.type]} · ${record.number || 'Draft'}`);
  document.getElementById('close-preview').textContent = origin === 'editor' ? '← Back to editing' : '← All documents';
  document.getElementById('edit-saved-button').hidden = !record._id;
  document.getElementById('delete-saved-button').hidden = !record._id;
  updateInvoicePaymentPanel(record);
  updateQuotationWorkflow(record);
  window.scrollTo(0, 0);
}

function updateInvoicePaymentPanel(record) {
  const panel = document.getElementById('invoice-finance-actions');
  const visible = Boolean(record?._id) && record.type === 'invoice';
  panel.hidden = !visible;
  if (!visible) return;
  const total = invoiceDocumentTotal(record);
  const paidAmount = invoiceReceivedAmount(record, total);
  const outstanding = Math.max(total - paidAmount, 0);
  const payments = (record.paymentEntries || []).filter((payment) => !payment.reversed);
  const latestPayment = payments.at(-1);
  const paymentStatus = invoicePaymentState(record, total);
  const expenseTotal = Number(record.linkedExpenseTotal) || Number(record.expenseAmount) || 0;
  const net = total - expenseTotal;
  const details = [
    `Invoice ${rupees(total)}`,
    `Received ${rupees(paidAmount)}`,
    `Balance ${rupees(outstanding)}`,
    `Expenses ${rupees(expenseTotal)}`,
    `Net ${rupees(net)}`,
  ];
  const paymentMethod = latestPayment?.method || record.paymentMethod;
  const paymentDate = latestPayment?.date || record.paidAt;
  if (paymentDate) details.push(`Last payment ${toDisplayDate(paymentDate)}${paymentMethod ? ` · ${paymentMethod}` : ''}`);
  document.getElementById('invoice-payment-status').textContent =
    total <= 0
      ? 'Total unavailable'
      : paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'partial' ? 'Partially paid' : 'Unpaid';
  document.getElementById('invoice-payment-summary').textContent = total > 0
    ? details.join(' · ')
    : 'Invoice total unavailable. Edit and save the invoice lines before recording a payment.';
  renderPaymentHistory(document.getElementById('invoice-payment-history'), record);
  const paymentAction = document.getElementById('invoice-payment-action');
  paymentAction.disabled = total <= 0 || outstanding <= 0;
  paymentAction.hidden = paymentStatus === 'paid';
  paymentAction.title = total > 0
    ? 'Choose fully paid or partial payment.'
    : 'Edit and save invoice lines before recording payment.';
  document.getElementById('reset-invoice-payments').hidden = paidAmount <= 0;
}

function updateQuotationWorkflow(record) {
  const workflow = document.getElementById('quotation-workflow');
  const followups = document.getElementById('quotation-followup-actions');
  const approvalStatus = document.getElementById('quotation-approval-status');
  const approveButton = document.getElementById('approve-quotation-button');
  const rejectButton = document.getElementById('reject-quotation-button');
  const isSavedQuotation = Boolean(record?._id) && record.type === 'quotation';
  workflow.hidden = !isSavedQuotation;
  if (!isSavedQuotation) return;
  const approved = record.approvalStatus === 'approved';
  const rejected = record.approvalStatus === 'rejected';
  approvalStatus.textContent = approved ? 'Approved' : rejected ? 'Rejected' : 'Pending approval';
  approvalStatus.classList.toggle('approved', approved);
  approvalStatus.classList.toggle('rejected', rejected);
  approveButton.classList.toggle('is-selected', approved);
  rejectButton.classList.toggle('is-selected', rejected);
  approveButton.setAttribute('aria-pressed', String(approved));
  rejectButton.setAttribute('aria-pressed', String(rejected));
  approveButton.disabled = approved;
  rejectButton.disabled = approved || rejected;
  approveButton.title = approved ? 'This quotation is already approved.' : 'Approve this quotation.';
  rejectButton.title = approved
    ? 'An approved quotation cannot be rejected.'
    : rejected ? 'This quotation is already rejected.' : 'Reject this quotation.';
  followups.hidden = !approved;
}

function createDocumentFromQuotation(type) {
  const quotation = currentRecord;
  if (!quotation?._id || quotation.type !== 'quotation' || quotation.approvalStatus !== 'approved') {
    announce('Approve and save this quotation before creating a follow-up document.', true);
    return;
  }
  const customer = { ...(quotation.customer || {}) };
  const shared = {
    date: localDate(),
    customer,
    items: (quotation.items || []).map((item) => ({ ...item })),
    sourceQuotationId: quotation._id,
    sourceQuotationNumber: quotation.number,
    terms: quotation.terms || '',
    preparedBy: quotation.preparedBy || '',
  };
  const record = type === 'invoice'
    ? {
      ...shared,
      dueDate: '',
      orderNumber: '',
      paymentTerms: '',
      shipName: customer.name || '',
      shipAddress: customer.address || '',
      shipGst: customer.gst || '',
      bankName: '',
      accountNumber: '',
      ifscCode: '',
      bankBranch: '',
      taxMode: quotation.taxMode || 'intra',
      taxRate: Number(quotation.taxRate) || 0,
      discount: Number(quotation.discount) || 0,
    }
    : type === 'challan'
      ? {
        ...shared,
        purchaseOrderNumber: '',
        purchaseOrderDate: '',
        deliveryName: customer.name || '',
        deliveryAt: customer.address || '',
        dispatchThrough: '',
        vehicleNumber: '',
        eWayBillNumber: '',
        purpose: quotation.workDescription || '',
        receivedBy: '',
      }
      : {
        ...shared,
        visitDate: localDate(),
        visitType: '',
        engineerName: '',
        nextService: '',
        siteName: quotation.projectName || '',
        equipment: '',
        serviceNumber: '',
        installationDate: '',
        reportedIssue: '',
        serviceDetails: quotation.workDescription || '',
        recommendations: '',
        serviceStatus: '',
        receivedBy: '',
        items: (quotation.items || []).map((item) => ({
          description: item.description || '',
          partNo: item.partNo || '',
          quantity: item.quantity,
          unit: item.unit || '',
          remarks: '',
        })),
      };
  openEditor(type, record);
}

function validateForm() {
  if (!dom.documentForm.reportValidity()) return false;
  const rows = [...dom.editorPaper.querySelectorAll('#live-item-rows tr')];
  const items = rows.map((row) => ({
    description: row.querySelector('[data-key="description"]').value.trim(),
    quantity: Number(row.querySelector('[data-key="quantity"]').value),
    rate: Number(row.querySelector('[data-key="rate"]')?.value),
  }));
  if (items.length === 0 && activeDocumentType !== 'service-report') {
    announce('Add at least one work or material row before saving.', true);
    document.getElementById('add-row-button').focus();
    return false;
  }
  const incomplete = items.findIndex((item) => !item.description || !Number.isFinite(item.quantity) || item.quantity <= 0
    || (activeDocumentType !== 'challan' && activeDocumentType !== 'service-report' && (!Number.isFinite(item.rate) || item.rate < 0)));
  if (incomplete !== -1) {
    rows[incomplete].querySelector('[data-key="description"]').focus();
    announce(`Complete the description, quantity, and unit rate for work row ${incomplete + 1}.`, true);
    return false;
  }
  if (activeDocumentType === 'quotation' || activeDocumentType === 'invoice') {
    const data = collectFormData();
    const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.rate, 0);
    if (subtotal * 100 > Number.MAX_SAFE_INTEGER) {
      announce('The document total is too large to calculate accurately. Reduce the quantity or unit rate.', true);
      return false;
    }
    if (data.discount > subtotal) {
      const discount = dom.editorPaper.querySelector('[name="discount"]');
      discount.focus();
      announce('Discount cannot be greater than the work and material subtotal.', true);
      return false;
    }
    const totalPaise = (subtotal - data.discount) * (1 + data.taxRate / 100) * 100;
    if (!Number.isFinite(totalPaise) || totalPaise > Number.MAX_SAFE_INTEGER) {
      announce('The document total is too large to calculate accurately. Reduce the quantity or unit rate.', true);
      return false;
    }
  }
  return true;
}

async function loadDocuments() {
  const typeFilter = document.getElementById('document-filter');
  const paymentFilter = document.getElementById('invoice-payment-filter');
  const type = typeFilter.value;
  paymentFilter.hidden = type !== 'invoice';
  if (type !== 'invoice') paymentFilter.value = '';
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  let records = (await api(`/api/documents${query}`)).map(normalizeDocumentApproval);
  if (type === 'invoice' && paymentFilter.value) {
    records = records.filter((record) => paymentFilter.value === 'overdue'
      ? invoiceIsOverdue(record)
      : invoicePaymentState(record, invoiceDocumentTotal(record)) === paymentFilter.value);
  }
  const listScrollY = dom.dashboard.hidden ? null : window.scrollY;
  dom.documentList.replaceChildren();
  dom.emptyDocuments.hidden = records.length > 0;
  dom.emptyDocuments.textContent = paymentFilter.value
    ? `No ${paymentFilter.options[paymentFilter.selectedIndex].text.toLowerCase()} invoices found.`
    : 'No saved documents yet. Create one to get started.';
  const groups = new Map();
  for (const record of records) {
    const referenceNumber = record.sourceQuotationNumber || record.number;
    if (!groups.has(referenceNumber)) groups.set(referenceNumber, []);
    groups.get(referenceNumber).push(record);
  }
  const orderedGroups = [...groups.entries()].map(([referenceNumber, documents]) => ({
    referenceNumber,
    documents: documents.sort((left, right) => {
      if (left.type === 'quotation' && right.type !== 'quotation') return -1;
      if (right.type === 'quotation' && left.type !== 'quotation') return 1;
      return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
    }),
  }));
  for (const group of orderedGroups) {
    const linkedGroup = group.documents.length > 1
      || group.documents.some((record) => Boolean(record.sourceQuotationNumber));
    if (linkedGroup) {
      const groupRow = document.createElement('tr');
      groupRow.className = 'document-group-heading';
      const groupCell = document.createElement('td');
      groupCell.colSpan = 6;
      const groupTitle = document.createElement('strong');
      groupTitle.textContent = `Quotation reference · ${group.referenceNumber}`;
      const groupCount = document.createElement('span');
      groupCount.textContent = `${group.documents.length} ${group.documents.length === 1 ? 'document' : 'documents'}`;
      groupCell.append(groupTitle, groupCount);
      groupRow.append(groupCell);
      dom.documentList.append(groupRow);
    }
    for (const record of group.documents) {
      const row = document.createElement('tr');
      const values = [
        ['Document no.', record.number],
        ['Type', documentLabels[record.type] || record.type],
        ['Client', record.customer?.name || '—'],
        ['Date', displayDate(record.date)],
        ['Status', record.type === 'quotation'
          ? (record.approvalStatus === 'approved'
            ? 'Approved'
            : record.approvalStatus === 'rejected' ? 'Rejected' : 'Pending approval')
          : record.type === 'invoice'
            ? (invoiceIsOverdue(record)
              ? 'Overdue'
              : invoicePaymentState(record, invoiceDocumentTotal(record)) === 'paid'
                ? 'Paid'
                : invoicePaymentState(record, invoiceDocumentTotal(record)) === 'partial' ? 'Partially paid' : 'Unpaid')
            : (record.sourceQuotationNumber ? `From ${record.sourceQuotationNumber}` : '—')],
      ];
      for (const [label, value] of values) {
        const cell = document.createElement('td');
        cell.dataset.label = label;
        if (label === 'Status' && record.type === 'invoice') {
          const total = invoiceDocumentTotal(record);
          const paidAmount = invoiceReceivedAmount(record, total);
          const expenseTotal = Number(record.linkedExpenseTotal) || Number(record.expenseAmount) || 0;
          const paymentState = invoicePaymentState(record, total);
          const overdue = invoiceIsOverdue(record, total);
          const status = overdue ? 'Overdue' : paymentState === 'paid' ? 'Paid' : paymentState === 'partial' ? 'Partially paid' : 'Unpaid';
          const statusLabel = document.createElement('strong');
          statusLabel.className = status === 'Paid' ? 'invoice-status-paid' : status === 'Partially paid' ? 'invoice-status-partial' : overdue ? 'invoice-status-overdue' : '';
          statusLabel.textContent = status;
          const summary = document.createElement('span');
          summary.className = 'invoice-row-summary';
          summary.textContent = total > 0
            ? `Total ${rupees(total)} · Received ${rupees(paidAmount)} · Balance ${rupees(Math.max(total - paidAmount, 0))}${record.dueDate ? ` · Due ${displayDate(record.dueDate)}` : ''} · Expense ${rupees(expenseTotal)} · Net ${rupees(total - expenseTotal)}`
            : `Invoice total unavailable · Received ${rupees(paidAmount)} · Balance unavailable · Edit invoice and add rated work lines to enable payment · Expense ${rupees(expenseTotal)}`;
          cell.append(statusLabel, summary);
          const history = document.createElement('div');
          renderPaymentHistory(history, record);
          cell.append(history);
        } else if (label === 'Status' && record.type === 'quotation') {
          const statusLabel = document.createElement('strong');
          statusLabel.textContent = value;
          cell.append(statusLabel);
        } else {
          cell.textContent = value;
        }
        if (label === 'Status' && record.type === 'quotation') {
          cell.className = record.approvalStatus === 'approved'
            ? 'document-status-approved'
            : record.approvalStatus === 'rejected' ? 'document-status-rejected' : 'document-status-pending';
        }
        row.append(cell);
      }
      const actionCell = document.createElement('td');
      actionCell.dataset.label = 'Actions';
      actionCell.className = `record-actions${record.type === 'invoice' ? ' invoice-record-actions' : ''}`;
      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'button button-outline';
      openButton.textContent = 'Open / PDF';
      openButton.addEventListener('click', () => openSavedDocument(record._id));
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'button button-primary';
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', () => editSavedDocument(record._id));
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'button button-danger';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => deleteSavedDocument(record._id, record.number, record.type, record));
      actionCell.append(openButton, editButton);
      if (record.type === 'quotation') {
        const approveButton = document.createElement('button');
        approveButton.type = 'button';
        approveButton.className = `button ${record.approvalStatus === 'approved' ? 'button-approve is-selected' : 'button-outline'}`;
        approveButton.classList.add('quotation-decision');
        approveButton.textContent = 'Approve';
        approveButton.setAttribute('aria-pressed', String(record.approvalStatus === 'approved'));
        const approved = record.approvalStatus === 'approved';
        const rejected = record.approvalStatus === 'rejected';
        approveButton.disabled = approved;
        approveButton.title = approved ? 'This quotation is already approved.' : 'Approve this quotation.';
        approveButton.addEventListener('click', () => updateQuotationStatus(record._id, 'approved', approveButton));
        const rejectButton = document.createElement('button');
        rejectButton.type = 'button';
        rejectButton.className = `button ${rejected ? 'button-reject is-selected' : 'button-outline'}`;
        rejectButton.classList.add('quotation-decision');
        rejectButton.textContent = 'Reject';
        rejectButton.setAttribute('aria-pressed', String(rejected));
        rejectButton.disabled = approved || rejected;
        rejectButton.title = approved
          ? 'An approved quotation cannot be rejected.'
          : rejected ? 'This quotation is already rejected.' : 'Reject this quotation.';
        rejectButton.addEventListener('click', () => updateQuotationStatus(record._id, 'rejected', rejectButton));
        actionCell.append(approveButton, rejectButton);
      }
      if (record.type === 'invoice') {
        const invoiceActions = document.createElement('div');
        invoiceActions.className = 'invoice-quick-actions';
        const addExpenseButton = document.createElement('button');
        addExpenseButton.type = 'button';
        addExpenseButton.className = 'button button-outline invoice-row-action';
        addExpenseButton.textContent = 'Add expense';
        addExpenseButton.addEventListener('click', () => openInvoiceExpense(record));
        const total = invoiceDocumentTotal(record);
        const paid = invoicePaymentState(record, total) === 'paid';
        const paymentActions = document.createElement('div');
        paymentActions.className = 'invoice-payment-actions';
        if (paid) {
          const unpaidButton = document.createElement('button');
          unpaidButton.type = 'button';
          unpaidButton.className = 'button button-warning invoice-row-action';
          unpaidButton.textContent = 'Mark unpaid';
          unpaidButton.addEventListener('click', () => markInvoiceUnpaid(record, unpaidButton));
          paymentActions.append(unpaidButton);
        } else {
          const paymentButton = document.createElement('button');
          paymentButton.type = 'button';
          paymentButton.className = 'button button-primary invoice-row-action';
          paymentButton.textContent = 'Record payment';
          paymentButton.title = total > 0
            ? 'Choose fully paid or partial payment and enter the payment details.'
            : 'Load the full invoice and check its total before recording payment.';
          paymentButton.addEventListener('click', () => openInvoicePaymentFromList(record, paymentButton));
          paymentActions.append(paymentButton);
        }
        invoiceActions.append(addExpenseButton, paymentActions);
        actionCell.append(invoiceActions);
      }
      actionCell.append(deleteButton);
      row.append(actionCell);
      dom.documentList.append(row);
    }
  }
  if (listScrollY !== null) window.scrollTo(0, listScrollY);
}

async function updateQuotationStatus(id, status, button) {
  const actionCell = button.closest('.record-actions');
  const currentStatus = actionCell?.closest('tr')?.querySelector('[data-label="Status"]')?.textContent;
  const approved = currentStatus === 'Approved';
  const rejected = currentStatus === 'Rejected';
  actionCell?.querySelectorAll('.quotation-decision').forEach((action) => { action.disabled = true; });
  try {
    const record = await api(`/api/documents/${encodeURIComponent(id)}/approval`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    if (currentRecord?._id === id) {
      currentRecord = record;
      previewRecord = record;
      updateQuotationWorkflow(record);
      buildPrintDocument(record);
    }
    await loadDocuments();
    announce(`Quotation ${record.number} ${status}.`);
  } catch (error) {
    actionCell?.querySelectorAll('.quotation-decision').forEach((action) => {
      action.disabled = action.textContent.trim() === 'Approve'
        ? approved
        : approved || rejected;
    });
    announce(error.message, true);
  }
}

function renderFinanceChart(monthly) {
  const chart = document.getElementById('finance-chart');
  chart.replaceChildren();
  const activeMonths = monthly
    .filter((item) => Number(item.income) > 0 || Number(item.expenses) > 0)
    .slice(-6);
  if (!activeMonths.length) {
    const empty = document.createElement('p');
    empty.className = 'finance-chart-empty';
    empty.innerHTML = '<strong>No cash flow recorded yet</strong><span>Mark an invoice paid or record a business expense to start your monthly trend.</span>';
    chart.append(empty);
    return;
  }
  chart.style.gridTemplateColumns = `repeat(${activeMonths.length}, minmax(0, 1fr))`;
  const maximum = Math.max(...activeMonths.flatMap((item) => [item.income, item.expenses]), 1);
  for (const item of activeMonths) {
    const month = document.createElement('div');
    month.className = 'finance-month';
    const monthLabel = new Intl.DateTimeFormat('en', { month: 'short', year: '2-digit' })
      .format(new Date(`${item.month}-01T00:00:00`));
    month.setAttribute('aria-label', `${monthLabel}: income ${rupees(item.income)}, expenses ${rupees(item.expenses)}, ${item.profit < 0 ? 'loss' : 'profit'} ${rupees(Math.abs(item.profit))}`);
    const bars = document.createElement('div');
    bars.className = 'finance-month-bars';
    for (const [kind, amount] of [['income', item.income], ['expenses', item.expenses], ['profit', item.profit]]) {
      const track = document.createElement('span');
      track.className = `finance-bar-track ${kind}${kind === 'profit' && amount < 0 ? ' loss' : ''}`;
      track.title = `${kind === 'income' ? 'Income' : kind === 'expenses' ? 'Expenses' : amount < 0 ? 'Loss' : 'Profit'}: ${rupees(Math.abs(amount))}`;
      track.setAttribute('aria-label', track.title);
      const fill = document.createElement('i');
      fill.style.height = amount
        ? `${Math.max(3, Math.min(Math.abs(amount) / maximum * 100, 100))}%`
        : '0%';
      track.append(fill);
      bars.append(track);
    }
    const label = document.createElement('small');
    label.textContent = monthLabel;
    month.append(bars, label);
    chart.append(month);
  }
}

function renderExpenseCategories(categories) {
  const chart = document.getElementById('expense-category-chart');
  chart.replaceChildren();
  if (!categories.length) {
    const empty = document.createElement('p');
    empty.className = 'finance-chart-empty';
    empty.innerHTML = '<strong>No expenses yet</strong><span>Expense totals will be grouped here after you record costs.</span>';
    chart.append(empty);
    return;
  }
  const maximum = Math.max(...categories.map((item) => item.amount), 1);
  for (const entry of categories) {
    const row = document.createElement('div');
    row.className = 'expense-category-row';
    const heading = document.createElement('div');
    heading.className = 'expense-category-heading';
    const label = document.createElement('strong');
    label.textContent = entry.category;
    const amount = document.createElement('span');
    amount.textContent = rupees(entry.amount);
    heading.append(label, amount);
    const track = document.createElement('div');
    track.className = 'expense-category-track';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(3, entry.amount / maximum * 100)}%`;
    track.append(fill);
    row.append(heading, track);
    chart.append(row);
  }
}

function renderExpenses(expenses) {
  const list = document.getElementById('expense-list');
  const empty = document.getElementById('empty-expenses');
  const count = document.getElementById('expense-count');
  list.replaceChildren();
  count.textContent = `${expenses.length} recent ${expenses.length === 1 ? 'entry' : 'entries'}`;
  empty.hidden = expenses.length > 0;
  for (const expense of expenses) {
    const row = document.createElement('tr');
    const fields = [
      ['Date', displayDate(expense.expenseDate)],
      ['Category', expense.category],
      ['Explanation', expense.description],
      ['Invoice', expense.invoiceNumber ? `${expense.invoiceNumber}${expense.customer ? ` · ${expense.customer}` : ''}` : 'Standalone'],
      ['Amount', rupees(expense.amount)],
    ];
    for (const [label, value] of fields) {
      const cell = document.createElement('td');
      cell.dataset.label = label;
      cell.textContent = value;
      row.append(cell);
    }
    const actions = document.createElement('td');
    actions.dataset.label = 'Actions';
    actions.className = 'record-actions expense-row-actions';
    if (expense.legacy) {
      const legacyLabel = document.createElement('span');
      legacyLabel.className = 'legacy-expense-label';
      legacyLabel.textContent = 'On invoice';
      actions.append(legacyLabel);
    } else {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'button button-outline';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => editExpense(expense));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button button-danger';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => deleteExpense(expense));
      actions.append(edit, remove);
    }
    row.append(actions);
    list.append(row);
  }
}

function populateExpenseInvoices(invoices) {
  const select = document.getElementById('expense-invoice');
  const selected = select.value;
  select.replaceChildren(new Option('Standalone expense — no invoice', ''));
  for (const invoice of invoices) {
    const option = new Option(
      `${invoice.number} · ${invoice.customer || 'No client'} · ${rupees(invoice.total)} · ${invoice.paymentStatus}`,
      String(invoice._id),
    );
    select.add(option);
  }
  if (selected && invoices.some((invoice) => String(invoice._id) === selected)) select.value = selected;
}

function renderFinanceReminders(reminders, reminderDays) {
  const list = document.getElementById('finance-reminders');
  list.replaceChildren();
  const banner = document.getElementById('payment-reminder-banner');
  banner.hidden = reminders.length === 0;
  if (reminders.length) {
    const text = document.createElement('span');
    text.textContent = `${reminders.length} unpaid invoice${reminders.length === 1 ? '' : 's'} need a follow-up (after ${reminderDays} days).`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-outline';
    button.textContent = 'Review reminders';
    button.addEventListener('click', () => {
      dom.dashboard.hidden = true;
      dom.editor.hidden = true;
      dom.preview.hidden = true;
      dom.finance.hidden = false;
      dom.title.textContent = 'Business finance';
      loadFinance().catch((error) => announce(error.message, true));
    });
    banner.replaceChildren(text, button);
  } else {
    banner.replaceChildren();
  }
  if (!reminders.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = `No invoices have been unpaid for ${reminderDays} days or more.`;
    list.append(empty);
    return;
  }
  for (const reminder of reminders) {
    const item = document.createElement('article');
    item.className = 'finance-reminder';
    const details = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = reminder.number;
    const description = document.createElement('span');
    const dueDate = reminder.dueDate ? ` · due ${toDisplayDate(reminder.dueDate)}` : '';
    const overdue = reminder.overdueDays ? ` · overdue ${reminder.overdueDays} days` : '';
    description.textContent = `${reminder.customer} · unpaid ${reminder.ageDays} days · ${rupees(reminder.total)}${dueDate}${overdue}`;
    details.append(title, description);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'button button-outline';
    open.textContent = 'Review';
    open.addEventListener('click', () => openSavedDocument(reminder._id, 'finance'));
    item.append(details, open);
    list.append(item);
  }
}

async function loadFinance() {
  const summary = await api('/api/finance');
  financeSummary = summary;
  document.getElementById('finance-income').textContent = rupees(summary.paidIncome);
  document.getElementById('finance-expenses').textContent = rupees(summary.expenseTotal);
  document.getElementById('finance-expense-count').textContent = `${summary.expenseCount} expense ${summary.expenseCount === 1 ? 'entry' : 'entries'}`;
  const profit = document.getElementById('finance-profit');
  profit.textContent = rupees(summary.profit);
  profit.classList.toggle('is-negative', summary.profit < 0);
  document.getElementById('finance-outstanding').textContent = rupees(summary.outstanding);
  document.getElementById('finance-paid-count').textContent = `${summary.paidCount} paid invoice${summary.paidCount === 1 ? '' : 's'}`;
  document.getElementById('finance-unpaid-count').textContent =
    `${summary.unpaidCount} unpaid · ${summary.partialCount || 0} partially paid · ${summary.overdueCount || 0} overdue`;
  document.getElementById('reminder-days').value = summary.reminderDays;
  renderFinanceChart(summary.monthly);
  renderExpenseCategories(summary.categories);
  renderExpenses(summary.expenseEntries);
  populateExpenseInvoices(summary.invoiceOptions);
  renderFinanceReminders(summary.reminders, summary.reminderDays);
}

async function exportFinanceCsv(button) {
  button.disabled = true;
  try {
    const response = await fetch('/api/finance/export', { credentials: 'same-origin' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Request failed (${response.status}).`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const filename = /filename="([^"]+)"/i.exec(disposition)?.[1] || 'veerbhadra-finance.csv';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Finance CSV exported successfully.');
  } catch (error) {
    announce(`Could not export finance CSV: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

function editExpense(expense) {
  if (expense.legacy) return;
  editingExpenseId = String(expense._id);
  const form = document.getElementById('expense-form');
  form.elements.description.value = expense.description;
  form.elements.category.value = expense.category;
  form.elements.expenseDate.value = expense.expenseDate;
  form.elements.amount.value = expense.amount;
  document.getElementById('expense-invoice').value = expense.invoiceId ? String(expense.invoiceId) : '';
  document.getElementById('expense-form-heading').textContent = 'Update expense';
  document.getElementById('save-expense-button').textContent = 'Update expense';
  document.getElementById('cancel-expense-edit').hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  form.elements.description.focus({ preventScroll: true });
}

function resetExpenseForm() {
  editingExpenseId = null;
  const form = document.getElementById('expense-form');
  form.reset();
  form.elements.expenseDate.value = localDate();
  document.getElementById('expense-form-heading').textContent = 'Record an expense';
  document.getElementById('save-expense-button').textContent = 'Save expense';
  document.getElementById('cancel-expense-edit').hidden = true;
  document.getElementById('expense-invoice').value = '';
}

function openInvoiceExpense(invoice) {
  const dialog = document.getElementById('invoice-expense-dialog');
  const form = document.getElementById('invoice-quick-expense-form');
  form.reset();
  form.elements.invoiceId.value = String(invoice._id);
  form.elements.expenseDate.value = localDate();
  form.elements.category.value = 'Miscellaneous';
  document.getElementById('quick-expense-invoice').textContent =
    `${invoice.number} · ${invoice.customer?.name || 'No client'}`;
  showDialog(dialog);
  form.elements.description.focus();
}

function setInvoicePaymentMode(mode, outstanding) {
  const full = mode === 'full';
  const form = document.getElementById('invoice-payment-form');
  form.dataset.paymentMode = mode;
  const amount = form.elements.amount;
  amount.readOnly = full;
  amount.required = !full;
  amount.value = full ? outstanding.toFixed(2) : '';
  amount.placeholder = full ? '' : 'Enter amount received';
  form.querySelector(`[name="paymentModeChoice"][value="${mode}"]`).checked = true;
  document.getElementById('save-invoice-payment').textContent = full ? 'Mark fully paid' : 'Record partial payment';
  updatePaymentBalancePreview();
}

function updatePaymentBalancePreview() {
  const form = document.getElementById('invoice-payment-form');
  const preview = document.getElementById('quick-payment-balance-preview');
  const invoice = paymentDialogInvoice;
  if (!invoice) {
    preview.textContent = '';
    return;
  }
  const total = invoiceDocumentTotal(invoice);
  const received = invoiceReceivedAmount(invoice, total);
  const outstanding = Math.max(total - received, 0);
  const amount = Number(form.elements.amount.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    preview.textContent = `Balance after payment: ${rupees(outstanding)}`;
    preview.classList.remove('is-invalid');
    return;
  }
  if (amount > outstanding) {
    preview.textContent = `Payment exceeds the balance by ${rupees(amount - outstanding)}.`;
    preview.classList.add('is-invalid');
    return;
  }
  if (form.dataset.paymentMode === 'partial' && amount >= outstanding) {
    preview.textContent = 'This pays the full balance. Choose Fully paid instead.';
    preview.classList.add('is-invalid');
    return;
  }
  preview.textContent = `Balance after payment: ${rupees(Math.max(outstanding - amount, 0))}`;
  preview.classList.remove('is-invalid');
}

function openInvoicePayment(invoice, mode = 'partial') {
  const dialog = document.getElementById('invoice-payment-dialog');
  const form = document.getElementById('invoice-payment-form');
  const total = invoiceDocumentTotal(invoice);
  if (total <= 0) {
    announce('This invoice has no calculable total. Edit and save its work lines before recording a payment.', true);
    return;
  }
  const received = invoiceReceivedAmount(invoice, total);
  const outstanding = Math.max(total - received, 0);
  if (outstanding <= 0) return;
  paymentDialogInvoice = invoice;
  const payments = (invoice.paymentEntries || []).filter((payment) => !payment.reversed);
  form.reset();
  form.elements.invoiceId.value = String(invoice._id);
  form.elements.amount.max = outstanding.toFixed(2);
  form.elements.paidAt.value = localDate();
  form.elements.method.value = payments.at(-1)?.method || invoice.paymentMethod || 'Bank transfer';
  document.getElementById('quick-payment-invoice').textContent =
    `${invoice.number} · ${invoice.customer?.name || 'No client'}`;
  document.getElementById('quick-payment-balance').textContent =
    `Invoice ${rupees(total)} · Received ${rupees(received)} · Balance ${rupees(outstanding)}`;
  setInvoicePaymentMode(mode, outstanding);
  showDialog(dialog);
  if (mode === 'partial') form.elements.amount.focus();
}

async function openInvoicePaymentFromList(invoice, button) {
  button.disabled = true;
  try {
    const latest = await api(`/api/documents/${encodeURIComponent(invoice._id)}`);
    openInvoicePayment(latest, 'partial');
  } catch (error) {
    announce(`Could not load invoice ${invoice.number} for payment: ${error.message}`, true);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function markInvoiceUnpaid(invoice, button = null) {
  if (!window.confirm(
    `Mark ${invoice.number} as unpaid? Recorded payment entries will be marked reversed, not deleted.`,
  )) return;
  if (button) button.disabled = true;
  let record;
  try {
    record = await api(`/api/documents/${encodeURIComponent(invoice._id)}/payment`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'unpaid' }),
    });
  } catch (error) {
    if (button?.isConnected) button.disabled = false;
    announce(`Could not mark invoice ${invoice.number} unpaid: ${error.message}`, true);
    return;
  }
  if (currentRecord?._id === invoice._id) {
    currentRecord = record;
    previewRecord = record;
    updateInvoicePaymentPanel(record);
  }
  announce(`Invoice ${invoice.number} marked unpaid successfully.`);
  try {
    await Promise.all([loadDocuments(), loadFinance()]);
  } catch (error) {
    announce(`Invoice ${invoice.number} was marked unpaid, but the document or finance list could not refresh: ${error.message}`, true);
  }
}

async function deleteExpense(expense) {
  if (!window.confirm(`Delete this ${rupees(expense.amount)} ${expense.category.toLowerCase()} expense?`)) return;
  try {
    await api(`/api/expenses/${encodeURIComponent(expense._id)}`, { method: 'DELETE' });
    await Promise.all([loadFinance(), loadDocuments()]);
    announce('Expense deleted successfully.');
  } catch (error) {
    announce(`Could not delete expense: ${error.message}`, true);
  }
}

async function deleteSavedDocument(id, number, type = currentRecord?.type, record = currentRecord) {
  if (type === 'invoice' && invoiceReceivedAmount(record || {}) > 0) {
    announce(`Reverse the recorded payments for invoice ${number} with Mark unpaid before deleting it.`, true);
    return;
  }
  const linkedExpenseWarning = type === 'invoice'
    ? ' Any payment history and linked expense entries will also be permanently deleted.'
    : '';
  if (!window.confirm(`Delete ${number}? This permanently removes the saved document data from the database.${linkedExpenseWarning}`)) return;
  try {
    const result = await api(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (currentRecord?._id === id) {
      currentRecord = null;
      previewRecord = null;
      dom.preview.hidden = true;
      activateView(previewOrigin === 'finance' ? 'finance' : 'dashboard',
        previewOrigin === 'finance' ? 'Business finance' : 'Document desk');
    }
    await Promise.all([loadDocuments(), loadFinance()]);
    const expenseMessage = result.deletedExpenses
      ? ` ${result.deletedExpenses} linked expense ${result.deletedExpenses === 1 ? 'entry was' : 'entries were'} deleted.`
      : '';
    announce(`${documentNames[type] || 'Document'} ${number} deleted successfully.${expenseMessage}`);
  } catch (error) {
    announce(`Could not delete ${documentNames[type] || 'document'} ${number}: ${error.message}`, true);
  }
}

async function openSavedDocument(id, origin = 'dashboard') {
  if (origin === 'dashboard') rememberDocumentListPosition();
  try {
    const record = normalizeDocumentApproval(await api(`/api/documents/${encodeURIComponent(id)}`));
    showPreview(record, origin);
  } catch (error) {
    announce(error.message, true);
  }
}

async function editSavedDocument(id) {
  rememberDocumentListPosition();
  try {
    const record = normalizeDocumentApproval(await api(`/api/documents/${encodeURIComponent(id)}`));
    openEditor(record.type, record);
  } catch (error) {
    announce(error.message, true);
  }
}

dom.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  dom.loginMessage.textContent = '';
  const form = new FormData(dom.loginForm);
  const button = dom.loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
    dom.loginForm.reset();
    showApp();
    try {
      await Promise.all([loadDocuments(), loadFinance(), loadProductCatalog()]);
    } catch (error) {
      announce(`Signed in, but the workspace could not load: ${error.message}`, true);
    }
  } catch (error) {
    dom.loginMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById('logout-button').addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
    showLogin();
  } catch (error) {
    announce(error.message, true);
  }
});

document.querySelectorAll('[data-create]').forEach((button) => {
  button.addEventListener('click', () => {
    rememberDocumentListPosition();
    openEditor(button.dataset.create);
    document.getElementById('page-title').textContent = `New ${documentLabels[button.dataset.create].toLowerCase()}`;
  });
});

document.querySelectorAll('[data-view="dashboard"]').forEach((button) => {
  button.addEventListener('click', () => {
    activateView('dashboard', 'Document desk');
    Promise.all([loadDocuments(), loadFinance()]).catch((error) => announce(error.message, true));
  });
});

document.querySelectorAll('[data-view="finance"]').forEach((button) => {
  button.addEventListener('click', () => {
    activateView('finance', 'Business finance');
    loadFinance().catch((error) => announce(error.message, true));
  });
});

document.getElementById('back-to-dashboard').addEventListener('click', () => {
  activateView('dashboard', 'Document desk');
  Promise.all([loadDocuments(), loadFinance()])
    .catch((error) => announce(error.message, true))
    .finally(restoreDocumentListPosition);
});

document.getElementById('add-row-button').addEventListener('click', () => addItemRow());
dom.editorPaper.addEventListener('click', (event) => {
  if (event.target.closest('.add-item-inline')) addItemRow();
});
dom.documentForm.addEventListener('input', updateTotals);
document.getElementById('document-filter').addEventListener('change', () => loadDocuments().catch((error) => announce(error.message, true)));
document.getElementById('invoice-payment-filter').addEventListener('change', () => loadDocuments().catch((error) => announce(error.message, true)));
document.getElementById('refresh-documents').addEventListener('click', (event) => {
  refreshWithFeedback(event.currentTarget, 'Documents', loadDocuments);
});
document.getElementById('refresh-finance').addEventListener('click', (event) => {
  refreshWithFeedback(event.currentTarget, 'Finance data', loadFinance);
});
document.getElementById('export-finance').addEventListener('click', (event) => {
  exportFinanceCsv(event.currentTarget);
});
document.getElementById('expense-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const formData = new FormData(form);
  const expense = {
    description: String(formData.get('description') || '').trim(),
    category: formData.get('category'),
    expenseDate: formData.get('expenseDate'),
    amount: Number(formData.get('amount')),
    invoiceId: formData.get('invoiceId') || '',
  };
  const button = document.getElementById('save-expense-button');
  button.disabled = true;
  const wasEditing = Boolean(editingExpenseId);
  try {
    await api(editingExpenseId ? `/api/expenses/${encodeURIComponent(editingExpenseId)}` : '/api/expenses', {
      method: editingExpenseId ? 'PUT' : 'POST',
      body: JSON.stringify(expense),
    });
    resetExpenseForm();
    await Promise.all([loadFinance(), loadDocuments()]);
    announce(wasEditing ? 'Expense updated successfully.' : 'Expense recorded successfully.');
  } catch (error) {
    announce(`Could not ${wasEditing ? 'update' : 'record'} expense: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});
document.getElementById('cancel-expense-edit').addEventListener('click', resetExpenseForm);
document.getElementById('close-invoice-expense').addEventListener('click', () => {
  document.getElementById('invoice-expense-dialog').close();
});
document.getElementById('cancel-invoice-expense').addEventListener('click', () => {
  document.getElementById('invoice-expense-dialog').close();
});
document.getElementById('close-invoice-payment').addEventListener('click', () => {
  document.getElementById('invoice-payment-dialog').close();
});
document.getElementById('cancel-invoice-payment').addEventListener('click', () => {
  document.getElementById('invoice-payment-dialog').close();
});
document.getElementById('invoice-quick-expense-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  button.disabled = true;
  try {
    const expense = {
      invoiceId: String(formData.get('invoiceId') || ''),
      description: String(formData.get('description') || '').trim(),
      amount: Number(formData.get('amount')),
      category: String(formData.get('category') || ''),
      expenseDate: String(formData.get('expenseDate') || ''),
    };
    await api('/api/expenses', { method: 'POST', body: JSON.stringify(expense) });
    document.getElementById('invoice-expense-dialog').close();
    form.reset();
    announce(`Expense added to invoice successfully.`);
    if (currentRecord?._id && String(currentRecord._id) === expense.invoiceId) {
      try {
        currentRecord = await api(`/api/documents/${encodeURIComponent(expense.invoiceId)}`);
        previewRecord = currentRecord;
        updateInvoicePaymentPanel(currentRecord);
      } catch (error) {
        announce(`Expense saved, but invoice details could not refresh: ${error.message}`, true);
      }
    }
    try {
      await Promise.all([loadFinance(), loadDocuments()]);
    } catch (error) {
      announce(`Expense saved, but finance data could not refresh: ${error.message}`, true);
    }
  } catch (error) {
    announce(`Could not add invoice expense: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});
document.getElementById('reminder-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/finance/settings', {
      method: 'PUT',
      body: JSON.stringify({ reminderDays: Number(form.elements.reminderDays.value) }),
    });
    await loadFinance();
    announce('Payment reminder interval saved successfully.');
  } catch (error) {
    announce(`Could not save the payment reminder interval: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});
document.getElementById('close-preview').addEventListener('click', () => {
  dom.preview.hidden = true;
  document.getElementById('invoice-finance-actions').hidden = true;
  if (previewOrigin === 'editor') {
    dom.editor.hidden = false;
    dom.preview.hidden = true;
    dom.dashboard.hidden = true;
    dom.finance.hidden = true;
    dom.title.textContent = currentRecord?._id
      ? `Edit ${documentLabels[currentRecord.type]} · ${currentRecord.number}`
      : `New ${documentLabels[activeDocumentType].toLowerCase()}`;
  } else if (previewOrigin === 'finance') {
    activateView('finance', 'Business finance');
    loadFinance().catch((error) => announce(error.message, true));
  } else {
    activateView('dashboard', 'Document desk');
    Promise.all([loadDocuments(), loadFinance()])
      .catch((error) => announce(error.message, true))
      .finally(restoreDocumentListPosition);
  }
});
document.getElementById('edit-saved-button').addEventListener('click', () => {
  if (currentRecord?._id) openEditor(currentRecord.type, currentRecord);
});
document.getElementById('delete-saved-button').addEventListener('click', () => {
  if (currentRecord?._id) deleteSavedDocument(currentRecord._id, currentRecord.number, currentRecord.type, currentRecord);
});
document.getElementById('invoice-payment-action').addEventListener('click', () => {
  if (currentRecord?._id && currentRecord.type === 'invoice') openInvoicePayment(currentRecord, 'partial');
});
document.querySelectorAll('[name="paymentModeChoice"]').forEach((choice) => {
  choice.addEventListener('change', () => {
    if (!choice.checked) return;
    const invoice = paymentDialogInvoice;
    const total = invoice ? invoiceDocumentTotal(invoice) : 0;
    const received = invoice ? invoiceReceivedAmount(invoice, total) : 0;
    setInvoicePaymentMode(choice.value, Math.max(total - received, 0));
  });
});
document.querySelector('#invoice-payment-form [name="amount"]').addEventListener('input', (event) => {
  const amount = event.currentTarget;
  const maximum = Number(amount.max);
  const entered = Number(amount.value);
  if (Number.isFinite(maximum) && Number.isFinite(entered) && entered > maximum) {
    amount.value = maximum.toFixed(2);
  }
  updatePaymentBalancePreview();
});
document.getElementById('reset-invoice-payments').addEventListener('click', () => {
  if (currentRecord?._id && currentRecord.type === 'invoice') markInvoiceUnpaid(currentRecord);
});
document.getElementById('invoice-payment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const formData = new FormData(form);
  const invoiceId = String(formData.get('invoiceId') || '');
  const amount = Number(formData.get('amount'));
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const record = await api(`/api/documents/${encodeURIComponent(invoiceId)}/payment`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: form.dataset.paymentMode === 'full' ? 'paid' : 'partial',
        amount,
        paidAt: String(formData.get('paidAt') || ''),
        method: String(formData.get('method') || ''),
      }),
    });
    document.getElementById('invoice-payment-dialog').close();
    if (currentRecord?._id === invoiceId) {
      currentRecord = record;
      previewRecord = record;
      updateInvoicePaymentPanel(record);
    }
    announce(record.paymentStatus === 'paid'
      ? `Full payment recorded for invoice ${record.number}.`
      : `Partial payment of ${rupees(amount)} recorded for invoice ${record.number}. Balance remaining: ${rupees(record.outstandingAmount)}.`);
    try {
      await Promise.all([loadFinance(), loadDocuments()]);
    } catch (error) {
      announce(`Payment saved, but invoice or finance data could not refresh: ${error.message}`, true);
    }
  } catch (error) {
    announce(`Could not record invoice payment: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});
document.getElementById('invoice-record-expense').addEventListener('click', () => {
  if (currentRecord?._id && currentRecord.type === 'invoice') openInvoiceExpense(currentRecord);
});
for (const [buttonId, status] of [
  ['approve-quotation-button', 'approved'],
  ['reject-quotation-button', 'rejected'],
]) {
  document.getElementById(buttonId).addEventListener('click', async (event) => {
    if (!currentRecord?._id || currentRecord.type !== 'quotation') return;
    const quotationId = currentRecord._id;
    const buttons = [...document.querySelectorAll('#quotation-workflow .quotation-decision-actions button')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const record = await api(`/api/documents/${encodeURIComponent(quotationId)}/approval`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      currentRecord = record;
      previewRecord = record;
      updateQuotationWorkflow(record);
      buildPrintDocument(record);
      await loadDocuments();
      announce(`Quotation ${record.number} ${status} successfully.`);
    } catch (error) {
      announce(`Could not ${status === 'approved' ? 'approve' : 'reject'} quotation: ${error.message}`, true);
    } finally {
      if (currentRecord?.type === 'quotation') updateQuotationWorkflow(currentRecord);
    }
  });
}
document.querySelectorAll('[data-from-quotation]').forEach((button) => {
  button.addEventListener('click', () => createDocumentFromQuotation(button.dataset.fromQuotation));
});
document.getElementById('preview-document-button').addEventListener('click', () => {
  if (validateForm()) showPreview(collectFormData(), 'editor');
});
async function printDocument() {
  if (!previewRecord) {
    announce('Open the document preview before printing.', true);
    return;
  }
  const printableNumber = (previewRecord.number || 'draft').replaceAll('/', '-');
  const originalTitle = document.title;
  const pageSettings = document.createElement('style');
  pageSettings.textContent = '@page { size: A4 portrait; margin: 0; }';
  const restoreTitle = () => {
    document.title = originalTitle;
    pageSettings.remove();
  };
  document.title = `Veerbhadra Engineers - ${printableNumber}`;
  window.addEventListener('afterprint', restoreTitle, { once: true });
  try {
    await document.fonts.ready;
    await Promise.all([...dom.printDocument.querySelectorAll('img')].map(async (image) => {
      if (!image.getAttribute('src')?.startsWith('data:')) {
        const response = await fetch(new URL(image.getAttribute('src'), document.baseURI));
        if (!response.ok) throw new Error(`Logo request failed (${response.status}).`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error('The document logo is not a valid image.');
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('The document logo could not be embedded.'));
          reader.readAsDataURL(blob);
        });
        image.src = dataUrl;
      }
      await image.decode();
      if (!image.naturalWidth) throw new Error('The document logo could not be decoded.');
    }));
    document.head.append(pageSettings);
    window.print();
    announce('Print dialog closed. If you chose Save as PDF, check your browser downloads for the document.');
  } catch (error) {
    window.removeEventListener('afterprint', restoreTitle);
    restoreTitle();
    announce(`The document logo or print content could not be prepared: ${error.message}`, true);
  }
}
document.getElementById('print-button').addEventListener('click', printDocument);
document.getElementById('print-draft-button').addEventListener('click', () => {
  if (!validateForm()) return;
  showPreview(collectFormData(), 'editor');
  printDocument();
});

dom.documentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validateForm()) return;
  const button = document.getElementById('save-button');
  const editing = Boolean(currentRecord?._id);
  const approvalWillReset = editing && currentRecord.type === 'quotation' && currentRecord.approvalStatus === 'approved';
  button.disabled = true;
  try {
    const record = await api(
      currentRecord?._id ? `/api/documents/${encodeURIComponent(currentRecord._id)}` : '/api/documents',
      {
        method: currentRecord?._id ? 'PUT' : 'POST',
        body: JSON.stringify(collectFormData()),
      },
    );
    currentRecord = record;
    const refreshResults = await Promise.allSettled([loadDocuments(), loadProductCatalog()]);
    const refreshErrors = refreshResults
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason.message);
    const successMessage = approvalWillReset
      ? `Quotation ${record.number} updated successfully. It must be approved again before creating linked documents.`
      : editing
        ? `${documentNames[record.type]} ${record.number} updated successfully.`
        : `New ${documentNames[record.type]} ${record.number} added successfully.`;
    showPreview(record, 'dashboard');
    announce(refreshErrors.length
      ? `${successMessage} Some workspace data could not refresh: ${refreshErrors.join('; ')}`
      : successMessage, refreshErrors.length > 0);
  } catch (error) {
    announce(`Could not ${editing ? 'update' : 'add'} ${documentNames[activeDocumentType]}: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

resetExpenseForm();
api('/api/session')
  .then(async (state) => {
    if (!state.authenticated) return showLogin();
    showApp();
    try {
      await Promise.all([loadDocuments(), loadFinance(), loadProductCatalog()]);
    } catch (error) {
      announce(`Signed in, but the workspace could not load: ${error.message}`, true);
    }
  })
  .catch((error) => {
    showLogin();
    dom.loginMessage.textContent = `Could not restore your admin session: ${error.message}`;
  });
