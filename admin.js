const documentLabels = {
  quotation: 'Quotation/ Estimate',
  invoice: 'Invoice',
  challan: 'Delivery Challan',
  'service-report': 'Service Report',
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

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && url !== '/api/login') showLogin();
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}

function showLogin() {
  dom.app.hidden = true;
  dom.loginScreen.hidden = false;
}

function showApp() {
  dom.loginScreen.hidden = true;
  dom.app.hidden = false;
}

function announce(message, isError = false) {
  clearTimeout(messageTimer);
  dom.appMessage.textContent = message;
  dom.appMessage.style.color = isError ? '#ac3434' : '#287852';
  messageTimer = setTimeout(() => { dom.appMessage.textContent = ''; }, 5000);
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
  const ariaLabel = options.ariaLabel ?? label;
  const autocomplete = options.autocomplete ? `data-company-lookup="${escapeHtml(options.autocomplete)}"` : '';
  const numericAttributes = inputType === 'number' ? 'inputmode="decimal" min="0" step="0.01"' : '';
  const control = options.multiline
    ? `<textarea class="paper-edit" name="${escapeHtml(name)}" ${key} ${autocomplete} aria-label="${escapeHtml(ariaLabel)}" rows="${options.rows || 2}" placeholder="${escapeHtml(options.placeholder || '')}" ${options.required ? 'required' : ''}>${escapeHtml(value)}</textarea>`
    : `<input class="paper-edit" name="${escapeHtml(name)}" ${key} ${autocomplete} type="${inputType}" aria-label="${escapeHtml(ariaLabel)}" value="${escapeHtml(date ? toDisplayDate(value) : value)}" placeholder="${escapeHtml(date ? 'DD/MM/YYYY' : options.placeholder || '')}" ${date ? 'inputmode="numeric" maxlength="10" pattern="\\d{2}/\\d{2}/\\d{4}" data-date="true"' : numericAttributes} ${options.required ? 'required' : ''}>`;
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
    cells = `<td data-label="Part No.">${itemField('partNo', 'Part No.', item.partNo || '')}</td><td data-label="Qty">${itemField('quantity', 'Qty', item.quantity || '', { placeholder: 'Qty', inputType: 'number' })}</td><td data-label="Unit">${itemField('unit', 'Unit', item.unit || '')}</td><td data-label="Remarks">${itemField('remarks', 'Remarks', item.remarks || '')}</td>`;
  } else if (type === 'challan') {
    cells = `<td data-label="Quantity">${itemField('quantity', 'Quantity', item.quantity || '', { placeholder: 'Qty', inputType: 'number', required: true })}</td><td data-label="Unit">${itemField('unit', 'Unit', item.unit || '')}</td>`;
  } else {
    cells = `<td data-label="HSN / SAC">${itemField('hsn', 'HSN / SAC', item.hsn || '', { placeholder: 'Code' })}</td><td data-label="Qty">${itemField('quantity', 'Qty', item.quantity || '', { placeholder: 'Qty', inputType: 'number', required: true })}</td><td data-label="Unit">${itemField('unit', 'Unit', item.unit || '')}</td><td data-label="Unit rate">${itemField('rate', 'Unit rate (Rs.)', item.rate ?? '', { placeholder: '0.00', inputType: 'number', required: true })}</td><td data-label="Amount" class="numeric line-amount">${rupees(Number(item.quantity || 0) * Number(item.rate || 0))}</td>`;
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
      ['orderNumber', 'Buyer’s Order No.', record.orderNumber],
      ['paymentTerms', 'Mode / Terms of Payment', record.paymentTerms],
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
    ? `<div class="tax-controls"><label class="inline-field"><span>Tax treatment</span><select class="paper-edit" name="taxMode"><option value="intra"${(record.taxMode || 'intra') === 'intra' ? ' selected' : ''}>CGST + SGST</option><option value="inter"${record.taxMode === 'inter' ? ' selected' : ''}>IGST</option></select></label>${inlineField('taxRate', 'GST (%)', record.taxRate ?? 18, { inputType: 'number' })}${inlineField('discount', 'Discount (Rs.)', record.discount ?? 0, { inputType: 'number' })}</div>`
    : '';
  const totals = pricing
    ? `<table class="doc-totals"><tbody><tr><td>Sub Total:</td><td id="paper-subtotal">${rupees(totalAmounts(record).subtotal)}</td></tr><tr class="paper-cgst"><td>CGST:</td><td id="paper-cgst">${rupees(totalAmounts(record).cgst)}</td></tr><tr class="paper-sgst"><td>SGST:</td><td id="paper-sgst">${rupees(totalAmounts(record).sgst)}</td></tr><tr class="paper-igst" hidden><td>IGST:</td><td id="paper-igst">${rupees(totalAmounts(record).igst)}</td></tr><tr><td>Discount:</td><td id="paper-discount">${rupees(totalAmounts(record).discount)}</td></tr><tr class="grand"><td>GRAND TOTAL:</td><td id="paper-grand-total">${rupees(totalAmounts(record).grand)}</td></tr></tbody></table><div class="doc-words"><span>Amount in Words:</span><span id="paper-amount-words">${escapeHtml(numberToWords(totalAmounts(record).grand))}</span></div>`
    : '';
  const quotationSummary = type === 'quotation'
    ? `<div class="doc-totals-layout"><div class="doc-terms"><h3 class="doc-section-title">NOTES &amp; TERMS</h3>${terms}</div><div class="quotation-total-side">${taxControls}${totals}</div></div>`
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
    ${type === 'quotation' ? quotationSummary : type === 'invoice' ? '' : terms}${challanReason}${type === 'quotation' ? '' : taxControls}${type === 'quotation' ? '' : totals}${bank}${type === 'invoice' ? `<h3 class="invoice-terms-heading">Terms &amp; Conditions</h3>${inlineField('terms', 'Terms & Conditions', record.terms || '', { multiline: true })}` : ''}${signature}</div>${footer}`;
}

function openEditor(type, record = null, viewOnly = false) {
  activeDocumentType = type;
  currentRecord = record;
  previewOrigin = 'editor';
  dom.dashboard.hidden = true;
  dom.preview.hidden = true;
  dom.editor.hidden = false;
  dom.title.textContent = viewOnly ? `${documentLabels[type]} · ${record.number}` : `New ${documentLabels[type].toLowerCase()}`;
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
  if (record?._id) dom.title.textContent = `Edit ${documentLabels[type]} · ${record.number}`;
  bindCustomerAutocomplete();
  dom.editorPaper.querySelectorAll('[data-date="true"]').forEach((control) => {
    control.addEventListener('input', formatDateInput);
  });
  dom.editorPaper.querySelectorAll('.paper-edit').forEach((control) => {
    control.addEventListener('input', updateTotals);
    control.addEventListener('change', updateTotals);
  });
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
  control.setCustomValidity(control.value.length === 10 && !toDatabaseDate(control.value)
    ? 'Enter a real calendar date in DD/MM/YYYY format.'
    : '');
}

function addItemRow(item = {}) {
  const rows = dom.editorPaper.querySelector('#live-item-rows');
  if (!rows) return;
  const rowDefaults = { quantity: 1, unit: 'Nos', ...item };
  rows.insertAdjacentHTML('beforeend', editableRow(rowDefaults, rows.children.length));
  const row = rows.lastElementChild;
  row.querySelectorAll('.paper-edit').forEach((control) => control.addEventListener('input', updateTotals));
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
  const subtotal = (record.items || []).reduce((total, item) => total + Number(item.quantity || 0) * Number(item.rate || 0), 0);
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
  dom.editorPaper.querySelector('.paper-cgst').hidden = interState;
  dom.editorPaper.querySelector('.paper-sgst').hidden = interState;
  dom.editorPaper.querySelector('.paper-igst').hidden = !interState;
}

function field(label, value, wide = false) {
  return `<div class="doc-client-field ${wide ? 'wide' : ''}"><span>${escapeHtml(label)}:</span><span>${escapeHtml(value || '')}</span></div>`;
}

function buildPrintDocument(record) {
  const type = record.type;
  const pricing = type === 'quotation' || type === 'invoice';
  const amount = pricing ? totalAmounts(record) : null;
  const topFields = {
    quotation: [
      ['Quotation No.', record.number], ['Quotation Date', displayDate(record.date)],
      ['Valid Until', displayDate(record.validUntil)], ['Delivery / Completion', record.delivery],
      ['Project / Site', record.projectName], ['Approval Status', record.approvalStatus === 'approved' ? 'Approved' : 'Pending'],
    ],
    invoice: [
      ['Invoice No.', record.number], ['Invoice Date', displayDate(record.date)],
      ['Due Date', displayDate(record.dueDate)], ['Buyer’s Order No.', record.orderNumber],
      ['Payment Terms', record.paymentTerms], ['Reference Quotation', record.sourceQuotationNumber],
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
        ? `<div class="invoice-party-grid"><section><h3 class="doc-section-title">BILL TO</h3>${field('Customer Name', client.name)}${field('Address', client.address, true)}${field('City / State / PIN', client.city)}${field('Contact Person', client.contactPerson)}${field('Phone', client.phone)}${field('Email', client.email)}${field('GST No.', client.gst)}${field('PAN', client.pan)}</section><section><h3 class="doc-section-title">SHIP TO</h3>${field('Customer Name', record.shipName || client.name)}${field('Address', record.shipAddress || client.address, true)}${field('GST No.', record.shipGst || client.gst)}</section></div>`
        : type === 'service-report'
          ? `<h3 class="doc-section-title">CUSTOMER &amp; EQUIPMENT DETAILS</h3><div class="doc-client-grid">${field('Customer Name', client.name)}${field('Project / Site', record.siteName)}${field('Machine / Equipment', record.equipment)}${field('Service No. / ID', record.serviceNumber)}${field('Address', client.address, true)}${field('City / State / PIN', client.city)}${field('Contact Person', client.contactPerson)}${field('Phone', client.phone)}${field('Email', client.email)}${field('Installation Date', displayDate(record.installationDate))}</div>`
          : `<h3 class="doc-section-title">CLIENT DETAILS</h3><div class="doc-client-grid">${field('Client / Company Name', client.name)}${field('Contact Person', client.contactPerson)}${field('Address', client.address, true)}${field('City / State / PIN', client.city)}${field('Phone', client.phone)}${field('Email', client.email)}${field('GST No. (Client)', client.gst)}${field('PAN (Client)', client.pan)}</div>`;
  const termsBlock = `<h3 class="doc-section-title">${type === 'challan' ? 'TERMS &amp; CONDITIONS OF DELIVERY' : 'TERMS &amp; CONDITIONS'}</h3><div class="doc-scope">${escapeHtml(record.terms || '')}</div>`;
  const taxTotals = pricing
    ? `<table class="doc-totals"><tbody>${totalsRows}</tbody></table><div class="doc-words"><span>Amount in Words:</span><span>${escapeHtml(numberToWords(amount.grand))}</span></div>`
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
      ? `${customer}<h3 class="doc-section-title">SCOPE OF WORK / PROJECT DESCRIPTION</h3><div class="doc-scope">${escapeHtml(record.workDescription || '')}</div><h3 class="doc-section-title">WORK / MATERIAL DETAILS</h3>${table}<div class="doc-totals-layout"><div class="doc-terms"><h3 class="doc-section-title">NOTES &amp; TERMS</h3><div class="doc-terms-body">${escapeHtml(record.terms || '')}</div></div><div>${taxTotals}</div></div>${signature}`
      : type === 'invoice'
        ? `${customer}<h3 class="doc-section-title">INVOICE DETAILS</h3>${table}<div class="invoice-totals-layout">${taxTotals}</div>${bankDetails}${termsBlock}${signature}`
        : type === 'challan'
          ? `${customer}<h3 class="doc-section-title">DELIVERY ITEMS</h3>${table}<h3 class="doc-section-title">REASON FOR TRANSPORT / REMARKS</h3><div class="doc-scope">${escapeHtml(record.purpose || '')}</div>${termsBlock}<div class="challan-signatures"><div class="receiver-signature"><span>________________________</span><small>${escapeHtml(record.receivedBy || '')}</small><small>Receiver’s signature &amp; date</small></div>${signature}</div>`
          : `${customer}<h3 class="doc-section-title">PROBLEM REPORTED BY CUSTOMER</h3><div class="doc-scope">${escapeHtml(record.reportedIssue || '')}</div><h3 class="doc-section-title">WORK CARRIED OUT</h3><div class="doc-scope service-box">${escapeHtml(record.serviceDetails || '')}</div><h3 class="doc-section-title">PARTS / MATERIALS USED</h3>${table}<div class="service-bottom"><div class="doc-terms"><h3 class="doc-section-title">ENGINEER OBSERVATIONS</h3><div class="doc-terms-body">${escapeHtml(record.recommendations || '')}</div></div><div class="service-status"><h3 class="doc-section-title">SERVICE STATUS</h3><div class="service-status-options">${serviceStatus}</div></div></div><div class="service-signatures"><div><span></span><small>Customer Signature${record.receivedBy ? ` · ${escapeHtml(record.receivedBy)}` : ''}</small></div><div><span></span><small>Engineer Signature · ${escapeHtml(record.engineerName || record.preparedBy || '')}</small></div><div><span></span><small>Supervisor / Approval</small></div></div>`;
  const footer = '<footer class="doc-footer"><span>Veerbhadra Engineers&nbsp; | &nbsp;GST: 27ASKPT6880H1ZZ&nbsp; | &nbsp;Engineering Services&nbsp; | &nbsp;Pune, Maharashtra</span></footer>';
  dom.printDocument.innerHTML = `<header class="doc-header">
        <img class="doc-logo" src="logo.jpg" alt="Veerbhadra Engineers logo">
        <div class="doc-brand"><h1>VEERBHADRA ENGINEERS</h1><p>Your Vision, Our Execution</p></div>
        <div class="doc-company-meta"><p>Ph: +91 8007717684 / 9823921132</p><p>Email: veerbhadra24.engineers@gmail.com</p><p>GST: 27ASKPT6880H1ZZ</p><p>Address: Flat 505, Gulmohar Symphony, PH-1,<br>Tukaram Nagar, Kharadi, Pune - 411014</p></div>
      </header><h2 class="doc-title">${escapeHtml(documentLabels[type].toUpperCase())}</h2>
      <div class="doc-content"><div class="doc-fields">${metadata}</div>${content}</div>${footer}`;
}

function showPreview(record, origin) {
  previewOrigin = origin;
  previewRecord = record;
  if (record._id) currentRecord = record;
  buildPrintDocument(record);
  dom.dashboard.hidden = true;
  dom.editor.hidden = true;
  dom.preview.hidden = false;
  dom.title.textContent = `${documentLabels[record.type]} · ${record.number || 'Draft'}`;
  document.getElementById('close-preview').textContent = origin === 'editor' ? '← Back to editing' : '← All documents';
  document.getElementById('edit-saved-button').hidden = !record._id;
  updateQuotationWorkflow(record);
  window.scrollTo(0, 0);
}

function updateQuotationWorkflow(record) {
  const workflow = document.getElementById('quotation-workflow');
  const followups = document.getElementById('quotation-followup-actions');
  const approvalStatus = document.getElementById('quotation-approval-status');
  const approvalButton = document.getElementById('toggle-quotation-approval');
  const isSavedQuotation = Boolean(record?._id) && record.type === 'quotation';
  workflow.hidden = !isSavedQuotation;
  if (!isSavedQuotation) return;
  const approved = record.approvalStatus === 'approved';
  approvalStatus.textContent = approved ? 'Approved' : 'Pending approval';
  approvalStatus.classList.toggle('approved', approved);
  approvalButton.textContent = approved ? 'Revoke approval' : 'Mark as approved';
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
  const type = document.getElementById('document-filter').value;
  const query = type ? `?type=${encodeURIComponent(type)}` : '';
  const records = await api(`/api/documents${query}`);
  dom.documentList.replaceChildren();
  dom.emptyDocuments.hidden = records.length > 0;
  for (const record of records) {
    const row = document.createElement('tr');
    const values = [
      ['Document no.', record.number],
      ['Type', documentLabels[record.type] || record.type],
      ['Client', record.customer?.name || '—'],
      ['Date', displayDate(record.date)],
      ['Status', record.type === 'quotation'
        ? (record.approvalStatus === 'approved' ? 'Approved' : 'Pending approval')
        : (record.sourceQuotationNumber ? `From ${record.sourceQuotationNumber}` : '—')],
    ];
    for (const [label, value] of values) {
      const cell = document.createElement('td');
      cell.dataset.label = label;
      cell.textContent = value;
      row.append(cell);
    }
    const actionCell = document.createElement('td');
    actionCell.dataset.label = 'Actions';
    actionCell.className = 'record-actions';
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
    actionCell.append(openButton, editButton);
    row.append(actionCell);
    dom.documentList.append(row);
  }
}

async function openSavedDocument(id) {
  try {
    const record = await api(`/api/documents/${encodeURIComponent(id)}`);
    showPreview(record, 'dashboard');
  } catch (error) {
    announce(error.message, true);
  }
}

async function editSavedDocument(id) {
  try {
    const record = await api(`/api/documents/${encodeURIComponent(id)}`);
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
    await loadDocuments();
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
    openEditor(button.dataset.create);
    document.getElementById('page-title').textContent = `New ${documentLabels[button.dataset.create].toLowerCase()}`;
  });
});

document.querySelectorAll('[data-view="dashboard"]').forEach((button) => {
  button.addEventListener('click', () => {
    dom.editor.hidden = true;
    dom.preview.hidden = true;
    dom.dashboard.hidden = false;
    dom.title.textContent = 'Document desk';
    loadDocuments().catch((error) => announce(error.message, true));
  });
});

document.getElementById('back-to-dashboard').addEventListener('click', () => {
  dom.editor.hidden = true;
  dom.dashboard.hidden = false;
  dom.title.textContent = 'Document desk';
  loadDocuments().catch((error) => announce(error.message, true));
});

document.getElementById('add-row-button').addEventListener('click', () => addItemRow());
dom.editorPaper.addEventListener('click', (event) => {
  if (event.target.closest('.add-item-inline')) addItemRow();
});
dom.documentForm.addEventListener('input', updateTotals);
document.getElementById('document-filter').addEventListener('change', () => loadDocuments().catch((error) => announce(error.message, true)));
document.getElementById('refresh-documents').addEventListener('click', () => loadDocuments().catch((error) => announce(error.message, true)));
document.getElementById('close-preview').addEventListener('click', () => {
  dom.preview.hidden = true;
  if (previewOrigin === 'editor') {
    dom.editor.hidden = false;
    dom.title.textContent = currentRecord?._id
      ? `Edit ${documentLabels[currentRecord.type]} · ${currentRecord.number}`
      : `New ${documentLabels[activeDocumentType].toLowerCase()}`;
  } else {
    dom.dashboard.hidden = false;
    dom.title.textContent = 'Document desk';
  }
});
document.getElementById('edit-saved-button').addEventListener('click', () => {
  if (currentRecord?._id) openEditor(currentRecord.type, currentRecord);
});
document.getElementById('toggle-quotation-approval').addEventListener('click', async () => {
  if (!currentRecord?._id || currentRecord.type !== 'quotation') return;
  const status = currentRecord.approvalStatus === 'approved' ? 'pending' : 'approved';
  const button = document.getElementById('toggle-quotation-approval');
  button.disabled = true;
  try {
    const record = await api(`/api/documents/${encodeURIComponent(currentRecord._id)}/approval`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    currentRecord = record;
    showPreview(record, previewOrigin);
    loadDocuments().catch((error) => announce(`Approval updated, but the document list could not refresh: ${error.message}`, true));
    announce(`Quotation ${record.number} marked ${status === 'approved' ? 'approved' : 'pending approval'}.`);
  } catch (error) {
    announce(error.message, true);
  } finally {
    button.disabled = false;
  }
});
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
  const restoreTitle = () => { document.title = originalTitle; };
  document.title = `Veerbhadra Engineers - ${printableNumber}`;
  window.addEventListener('afterprint', restoreTitle, { once: true });
  try {
    await document.fonts.ready;
    await Promise.all([...dom.printDocument.querySelectorAll('img')].map((image) => image.decode()));
    window.print();
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
    loadDocuments().catch((error) => announce(`Saved, but the document list could not refresh: ${error.message}`, true));
    announce(approvalWillReset
      ? `Quotation ${record.number} updated. It must be approved again before creating linked documents.`
      : `${documentLabels[record.type]} ${record.number} ${editing ? 'updated' : 'saved'}.`);
    showPreview(record, 'dashboard');
  } catch (error) {
    announce(error.message, true);
  } finally {
    button.disabled = false;
  }
});

api('/api/session')
  .then(async (state) => {
    if (!state.authenticated) return showLogin();
    showApp();
    await loadDocuments();
  })
  .catch(() => showLogin());
