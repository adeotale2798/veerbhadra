require('dotenv').config();

const crypto = require('node:crypto');
const dns = require('node:dns');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { MongoClient, ObjectId } = require('mongodb');
const { rateLimit } = require('express-rate-limit');

const mongoDnsServers = (process.env.MONGODB_DNS_SERVERS || '')
  .split(',')
  .map((server) => server.trim())
  .filter(Boolean);

if (mongoDnsServers.length > 0) {
  try {
    dns.setServers(mongoDnsServers);
  } catch (error) {
    throw new Error('MONGODB_DNS_SERVERS must be a comma-separated list of valid DNS server IP addresses.', {
      cause: error,
    });
  }
}

const requiredEnvironment = ['MONGODB_URI', 'SESSION_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);

if (missingEnvironment.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(', ')}`);
}

if (process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters long.');
}

const app = express();
const port = Number(process.env.PORT || 3000);
const mongoClient = new MongoClient(process.env.MONGODB_URI);
const databaseName = 'veerbhadra';
app.locals.mongoClient = mongoClient;
let databaseInitialization;
const documentTypes = new Set(['quotation', 'invoice', 'challan', 'service-report']);
const expenseCategories = new Set([
  'Materials',
  'Travel',
  'Labour',
  'Utilities',
  'Repairs',
  'Office',
  'Miscellaneous',
]);
const paymentMethods = new Set(['Cash', 'Bank transfer', 'UPI', 'Cheque', 'Card', 'Other']);
const typeCodes = {
  quotation: 'QUO',
  invoice: 'INV',
  challan: 'DC',
  'service-report': 'SR',
};

app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(express.json({ limit: '100kb' }));
app.use(express.static(__dirname));

async function initializeDatabase() {
  if (!databaseInitialization) {
    databaseInitialization = (async () => {
      await mongoClient.connect();
      const database = mongoClient.db(databaseName);
      app.locals.databaseName = database.databaseName;
      app.locals.documents = database.collection('documents');
      app.locals.companies = database.collection('companies');
      app.locals.counters = database.collection('documentCounters');
      app.locals.products = database.collection('products');
      app.locals.settings = database.collection('adminSettings');
      app.locals.expenses = database.collection('businessExpenses');
      await Promise.all([
        app.locals.documents.createIndex({ type: 1, number: 1 }, { unique: true }),
        app.locals.documents.createIndex({ createdAt: -1 }),
        app.locals.companies.createIndex({ normalizedName: 1 }, { unique: true }),
        app.locals.products.createIndex({ normalizedDescription: 1 }, { unique: true }),
        app.locals.expenses.createIndex({ expenseDate: -1, createdAt: -1 }),
        app.locals.expenses.createIndex({ invoiceId: 1 }),
      ]);
    })().catch((error) => {
      databaseInitialization = undefined;
      throw error;
    });
  }
  return databaseInitialization;
}

app.use(async (req, res, next) => {
  try {
    await initializeDatabase();
    return next();
  } catch (error) {
    return next(error);
  }
});

app.use(session({
  name: 've-admin-session',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    client: mongoClient,
    collectionName: 'adminSessions',
    ttl: 60 * 60 * 8,
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 8 * 1000,
  },
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeQuotationApproval(document) {
  if (document?.type !== 'quotation') return document;
  const createdAt = new Date(document.createdAt).getTime();
  const updatedAt = new Date(document.updatedAt).getTime();
  const untouchedLegacyDefault = document.approvalStatus === 'rejected'
    && !document.approvalDecisionAt
    && Number.isFinite(createdAt)
    && createdAt === updatedAt;
  const approvalStatus = untouchedLegacyDefault
    ? 'pending'
    : document.approvalStatus || 'pending';
  return { ...document, approvalStatus };
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function businessDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeCompanyName(name) {
  return name.normalize('NFKC').trim().toLocaleLowerCase('en');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function saveCompanyProfile(collection, customer) {
  const name = customer?.name?.trim();
  if (!name) return;
  const normalizedName = normalizeCompanyName(name);
  const update = { $set: { ...customer, name, normalizedName, updatedAt: new Date() } };
  try {
    await collection.updateOne({ normalizedName }, update, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    await collection.updateOne({ normalizedName }, update);
  }
}

async function saveProductCatalog(collection, items) {
  const uniqueItems = new Map();
  for (const item of items) {
    const description = item.description.trim();
    if (!description) continue;
    const normalizedDescription = normalizeCompanyName(description);
    const product = {
      description,
      normalizedDescription,
      hsn: item.hsn || '',
      partNo: item.partNo || '',
      unit: item.unit || '',
      updatedAt: new Date(),
    };
    if (Number(item.rate) > 0) product.rate = Number(item.rate);
    uniqueItems.set(normalizedDescription, product);
  }
  await Promise.all([...uniqueItems.values()].map((product) => {
    const { rate, ...profile } = product;
    const update = { $set: profile, $setOnInsert: { createdAt: new Date() } };
    if (rate === undefined) update.$setOnInsert.rate = 0;
    else update.$set.rate = rate;
    return collection.updateOne(
      { normalizedDescription: product.normalizedDescription },
      update,
      { upsert: true },
    ).catch((error) => {
      if (error.code !== 11000) throw error;
      return collection.updateOne(
        { normalizedDescription: product.normalizedDescription },
        update,
      );
    });
  }));
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function csvCell(value) {
  const text = String(value ?? '');
  const safeText = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function invoiceTotal(invoice) {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const subtotal = roundMoney(items.reduce(
    (sum, item) => {
      const quantity = Number(item.quantity ?? item.qty ?? 0);
      const rate = Number(item.rate ?? item.unitRate ?? item.unitPrice);
      const rateTotal = Number.isFinite(rate) && rate > 0 ? quantity * rate : 0;
      const savedLineTotal = Number(item.lineTotal ?? item.totalAmount ?? item.amount);
      return sum + (rateTotal > 0 ? rateTotal : Number.isFinite(savedLineTotal) && savedLineTotal > 0 ? savedLineTotal : 0);
    },
    0,
  ));
  if (!items.length || subtotal <= 0) {
    for (const value of [invoice.invoiceAmount, invoice.grandTotal, invoice.totalAmount, invoice.total]) {
      const storedTotal = Number(value);
      if (Number.isFinite(storedTotal) && storedTotal > 0) return roundMoney(storedTotal);
    }
  }
  const discount = roundMoney(Math.min(Math.max(Number(invoice.discount) || 0, 0), subtotal));
  const taxable = roundMoney(subtotal - discount);
  const rate = Math.max(0, Number(invoice.taxRate) || 0);
  const tax = invoice.taxMode === 'inter'
    ? roundMoney(taxable * rate / 100)
    : roundMoney(taxable * rate / 200) * 2;
  return roundMoney(taxable + tax);
}

function invoicePaidAmount(invoice) {
  if (Array.isArray(invoice.paymentEntries)) {
    const entryTotal = roundMoney(invoice.paymentEntries.reduce(
      (sum, payment) => sum + (payment.reversed ? 0 : Number(payment.amount) || 0),
      0,
    ));
    if (entryTotal > 0) return roundMoney(entryTotal + (Number(invoice.legacyPaidAmount) || 0));
    if (invoice.paymentEntries.length) return roundMoney(Number(invoice.legacyPaidAmount) || 0);
  }
  const legacyPaidAmount = Number(invoice.legacyPaidAmount ?? invoice.paidAmount);
  if (Number.isFinite(legacyPaidAmount) && legacyPaidAmount >= 0) {
    if (legacyPaidAmount > 0) return roundMoney(legacyPaidAmount);
  }
  return invoice.paymentStatus === 'paid' ? invoiceTotal(invoice) : 0;
}

function invoicePaymentStatus(invoice) {
  const total = invoiceTotal(invoice);
  if (total <= 0) return 'unpaid';
  const paid = invoicePaidAmount(invoice);
  if (paid <= 0) return 'unpaid';
  return paid >= total ? 'paid' : 'partial';
}

function validateDocument(body) {
  if (!body || !documentTypes.has(body.type)) return 'Choose a valid document type.';
  if (!isValidDate(body.date)) return 'Enter a valid document date.';
  if (!body.customer || typeof body.customer !== 'object' || Array.isArray(body.customer)) return 'Enter the client details.';
  if (typeof body.customer.name !== 'string' || !body.customer.name.trim()) return 'Client / Company Name is required.';
  const minimumItems = body.type === 'service-report' ? 0 : 1;
  if (!Array.isArray(body.items) || body.items.length < minimumItems || body.items.length > 100) return 'Add valid work rows.';
  if (body.items.some((item) => (
    !item || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 2000
    || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0 || Number(item.quantity) > 1000000000
    || (body.type !== 'challan' && body.type !== 'service-report'
      && (!Number.isFinite(Number(item.rate)) || Number(item.rate) < 0 || Number(item.rate) > 1000000000))
  ))) return 'Each work row must include a description and valid quantity and rate.';

  for (const key of [
    'workDescription', 'terms', 'serviceDetails', 'deliveryDetails', 'reportedIssue',
    'recommendations', 'visitType', 'engineerName', 'nextService', 'siteName',
    'equipment', 'serviceNumber', 'installationDate', 'serviceStatus', 'deliveryName', 'deliveryAt',
    'dispatchThrough', 'vehicleNumber', 'eWayBillNumber', 'purpose', 'dueDate',
    'orderNumber', 'placeSupply', 'delivery', 'validUntil', 'preparedBy', 'receivedBy',
    'purchaseOrderNumber', 'purchaseOrderDate',
    'projectName', 'orderDate', 'deliveryNoteNumber', 'deliveryNoteDate', 'paymentTerms',
    'supplierReference', 'otherReference', 'dispatchNumber', 'destination',
    'shipName', 'shipAddress', 'shipGst', 'bankName', 'accountNumber', 'ifscCode', 'bankBranch',
    'sourceQuotationId', 'sourceQuotationNumber',
  ]) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 12000)) {
      return `The ${key} field is invalid or too long.`;
    }
  }
  for (const key of [
    'validUntil', 'dueDate', 'visitDate', 'nextService', 'installationDate',
    'purchaseOrderDate', 'orderDate', 'deliveryNoteDate',
  ]) {
    if (body[key] && !isValidDate(body[key])) return `Enter a valid ${key} date.`;
  }
  if (body.customer && Object.values(body.customer).some((value) => typeof value !== 'string' || value.length > 1000)) {
    return 'One or more client details are invalid or too long.';
  }
  if (body.customer.phone && !/^[0-9+()\/. ,\-]+$/.test(body.customer.phone)) {
    return 'Phone numbers may contain digits, spaces, +, -, /, commas, and parentheses only.';
  }
  if (body.customer.gst && body.customer.gst !== '-' && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(body.customer.gst)) {
    return 'Enter a valid 15-character GST number.';
  }
  if (body.customer.pan && body.customer.pan !== '-' && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(body.customer.pan)) {
    return 'Enter a valid 10-character PAN number.';
  }
  if (body.items.some((item) => ['hsn', 'partNo', 'unit', 'remarks'].some((key) => (
    item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length > 500)
  )))) return 'A line-item detail is invalid or too long.';
  if (body.type === 'quotation' || body.type === 'invoice') {
    if (!Number.isFinite(Number(body.taxRate)) || Number(body.taxRate) < 0 || Number(body.taxRate) > 100) return 'Enter a valid GST rate.';
    if (!Number.isFinite(Number(body.discount)) || Number(body.discount) < 0) return 'Enter a valid discount.';
    if (!['intra', 'inter'].includes(body.taxMode)) return 'Choose a valid tax treatment.';
    const subtotal = body.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.rate), 0);
    const totalPaise = (subtotal - Number(body.discount)) * (1 + Number(body.taxRate) / 100) * 100;
    if (!Number.isFinite(subtotal) || !Number.isFinite(totalPaise) || totalPaise > Number.MAX_SAFE_INTEGER) {
      return 'The document total is too large to calculate accurately.';
    }
    if (Number(body.discount) > subtotal) return 'Discount cannot be greater than the work and material subtotal.';
  }
  if (body.type === 'quotation' && !isValidDate(body.validUntil)) return 'A valid quotation expiry date is required.';
  if (body.type === 'service-report' && !isValidDate(body.visitDate)) return 'A valid service visit date is required.';

  return null;
}

async function validateQuotationSource(documents, body, requireApproved = true) {
  if (!body.sourceQuotationId && !body.sourceQuotationNumber) return null;
  if (body.type === 'quotation' || !ObjectId.isValid(body.sourceQuotationId)
    || typeof body.sourceQuotationNumber !== 'string' || !body.sourceQuotationNumber.trim()) {
    return 'The source quotation reference is invalid.';
  }
  const filter = {
    _id: new ObjectId(body.sourceQuotationId),
    type: 'quotation',
  };
  if (requireApproved) filter.approvalStatus = 'approved';
  const quotation = await documents.findOne(filter, { projection: { number: 1 } });
  if (!quotation || quotation.number !== body.sourceQuotationNumber) {
    return requireApproved
      ? 'The source quotation must exist and be approved before a linked document can be saved.'
      : 'The referenced source quotation could not be found.';
  }
  return null;
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  return res.status(401).json({ error: 'Please log in to continue.' });
}

app.post('/api/login', loginLimiter, (req, res, next) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const usernameMatches = safeEqual(username, process.env.ADMIN_USERNAME);
  const passwordMatches = safeEqual(password, process.env.ADMIN_PASSWORD);

  if (!usernameMatches || !passwordMatches) {
    return res.status(401).json({ error: 'Admin ID or password is incorrect.' });
  }

  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.admin = true;
    req.session.save((saveError) => {
      if (saveError) return next(saveError);
      return res.json({ authenticated: true });
    });
  });
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: req.session?.admin === true });
});

app.post('/api/logout', requireAdmin, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('ve-admin-session', {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
    });
    return res.json({ authenticated: false });
  });
});

app.get('/api/companies', requireAdmin, async (req, res, next) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (query.length < 2) return res.json([]);
    const prefix = new RegExp(`^${escapeRegex(query)}`, 'i');
    const profiles = await req.app.locals.companies
      .find({ $or: [{ name: prefix }, { address: prefix }, { city: prefix }] })
      .sort({ name: 1 })
      .limit(12)
      .toArray();
    const documents = await req.app.locals.documents
      .find({ $or: [{ 'customer.name': prefix }, { 'customer.address': prefix }, { 'customer.city': prefix }] }, {
        projection: { customer: 1, updatedAt: 1, createdAt: 1 },
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(50)
      .toArray();
    const results = new Map();
    for (const profile of profiles) {
      results.set(profile.normalizedName || normalizeCompanyName(profile.name), profile);
    }
    for (const document of documents) {
      const customer = document.customer;
      if (customer?.name) {
        const key = normalizeCompanyName(customer.name);
        if (!results.has(key)) results.set(key, customer);
      }
    }
    return res.json([...results.values()].slice(0, 12).map((company) => ({
      name: company.name || '',
      address: company.address || '',
      city: company.city || '',
      contactPerson: company.contactPerson || '',
      phone: company.phone || '',
      email: company.email || '',
      gst: company.gst || '',
      pan: company.pan || '',
    })));
  } catch (error) {
    return next(error);
  }
});

app.get('/api/products', requireAdmin, async (req, res, next) => {
  try {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const filter = query ? { description: new RegExp(escapeRegex(query), 'i') } : {};
    const products = await req.app.locals.products.find(filter)
      .sort({ updatedAt: -1 })
      .limit(250)
      .toArray();
    return res.json(products.map(({ _id, description, hsn, partNo, unit, rate }) => ({
      _id, description, hsn, partNo, unit, rate,
    })));
  } catch (error) {
    return next(error);
  }
});

app.get('/api/documents', requireAdmin, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.type) {
      if (!documentTypes.has(req.query.type)) return res.status(400).json({ error: 'Choose a valid document type.' });
      filter.type = req.query.type;
    }
    const documents = await req.app.locals.documents
      .find(filter, { projection: { type: 1, number: 1, date: 1, dueDate: 1, customer: 1, createdAt: 1, updatedAt: 1, approvalStatus: 1, approvalDecisionAt: 1, sourceQuotationNumber: 1, paymentStatus: 1, paidAt: 1, paymentMethod: 1, paymentEntries: 1, paidAmount: 1, legacyPaidAmount: 1, invoiceAmount: 1, grandTotal: 1, totalAmount: 1, total: 1, expenseAmount: 1, items: 1, discount: 1, taxRate: 1, taxMode: 1 } })
      .sort({ createdAt: -1 })
      .limit(250)
      .toArray();
    const invoiceIds = documents.filter((document) => document.type === 'invoice').map(({ _id }) => _id);
    const expenseTotals = new Map();
    if (invoiceIds.length) {
      const expenses = await req.app.locals.expenses.find({ invoiceId: { $in: invoiceIds } }, {
        projection: { invoiceId: 1, amount: 1 },
      }).toArray();
      for (const expense of expenses) {
        const key = String(expense.invoiceId);
        expenseTotals.set(key, (expenseTotals.get(key) || 0) + (Number(expense.amount) || 0));
      }
    }
    return res.json(documents.map((document) => {
      const normalized = normalizeQuotationApproval(document);
      if (document.type !== 'invoice') return normalized;
      const invoiceAmount = invoiceTotal(document);
      const paidAmount = invoicePaidAmount(document);
      const expenseTotal = roundMoney((Number(document.expenseAmount) || 0)
        + (expenseTotals.get(String(document._id)) || 0));
      return {
        ...normalized,
        paymentStatus: invoicePaymentStatus(document),
        invoiceAmount,
        paidAmount,
        outstandingAmount: roundMoney(Math.max(invoiceAmount - paidAmount, 0)),
        linkedExpenseTotal: expenseTotal,
        invoiceProfit: roundMoney(invoiceAmount - expenseTotal),
        paymentEntries: document.paymentEntries || [],
      };
    }));
  } catch (error) {
    return next(error);
  }
});

app.get('/api/finance/settings', requireAdmin, async (req, res, next) => {
  try {
    const settings = await req.app.locals.settings.findOne({ _id: 'finance' });
    return res.json({ reminderDays: settings?.reminderDays || 7 });
  } catch (error) {
    return next(error);
  }
});

app.put('/api/finance/settings', requireAdmin, async (req, res, next) => {
  try {
    const reminderDays = Number(req.body?.reminderDays);
    if (!Number.isInteger(reminderDays) || reminderDays < 1 || reminderDays > 90) {
      return res.status(400).json({ error: 'Reminder interval must be a whole number from 1 to 90 days.' });
    }
    await req.app.locals.settings.updateOne(
      { _id: 'finance' },
      { $set: { reminderDays, updatedAt: new Date() } },
      { upsert: true },
    );
    return res.json({ reminderDays });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/finance', requireAdmin, async (req, res, next) => {
  try {
    const [invoices, expenseRecords] = await Promise.all([
      req.app.locals.documents.find({ type: 'invoice' }).sort({ createdAt: -1 }).toArray(),
      req.app.locals.expenses.find({}).sort({ expenseDate: -1, createdAt: -1 }).toArray(),
    ]);
    const settings = await req.app.locals.settings.findOne({ _id: 'finance' });
    const reminderDays = settings?.reminderDays || 7;
    const now = Date.now();
    const today = businessDate();
    const reminders = [];
    let paidIncome = 0;
    let outstanding = 0;
    let overdueCount = 0;
    let expenses = 0;
    const monthly = new Map();
    const monthFor = (date) => {
      const value = typeof date === 'string' ? date : date?.toISOString?.();
      return value && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : '';
    };
    const monthBucket = (month) => {
      if (!month) return null;
      if (!monthly.has(month)) monthly.set(month, { income: 0, expenses: 0 });
      return monthly.get(month);
    };
    const expenseRows = [];
    const categoryTotals = new Map();
    const invoiceMap = new Map(invoices.map((invoice) => [String(invoice._id), invoice]));
    for (const invoice of invoices) {
      const total = invoiceTotal(invoice);
      const paidAmount = invoicePaidAmount(invoice);
      const paymentStatus = invoicePaymentStatus(invoice);
      const legacyExpense = Number(invoice.expenseAmount || 0);
      expenses += legacyExpense;
      if (legacyExpense > 0) {
        const expenseDate = invoice.date || monthFor(invoice.createdAt);
        categoryTotals.set('Invoice expense', (categoryTotals.get('Invoice expense') || 0) + legacyExpense);
        expenseRows.push({
          _id: `legacy-${invoice._id}`,
          expenseDate,
          category: 'Invoice expense',
          description: invoice.expenseNote || 'Previously recorded invoice expense',
          amount: legacyExpense,
          invoiceId: invoice._id,
          invoiceNumber: invoice.number,
          customer: invoice.customer?.name || '',
          legacy: true,
        });
        const legacyMonth = monthBucket(monthFor(expenseDate));
        if (legacyMonth) legacyMonth.expenses += legacyExpense;
      }
      if (Array.isArray(invoice.paymentEntries)) {
        let entryIncome = 0;
        for (const payment of invoice.paymentEntries) {
          if (payment.reversed) continue;
          const amount = Number(payment.amount) || 0;
          entryIncome += amount;
          paidIncome += amount;
          const incomeMonth = monthBucket(monthFor(payment.date) || monthFor(invoice.date) || monthFor(invoice.createdAt));
          if (incomeMonth) incomeMonth.income += amount;
        }
        const legacyIncome = roundMoney(Math.max(paidAmount - entryIncome, 0));
        if (legacyIncome > 0) {
          paidIncome += legacyIncome;
          const incomeMonth = monthBucket(monthFor(invoice.paidAt) || monthFor(invoice.date) || monthFor(invoice.createdAt));
          if (incomeMonth) incomeMonth.income += legacyIncome;
        }
      } else if (paidAmount > 0) {
        paidIncome += paidAmount;
        const incomeMonth = monthBucket(monthFor(invoice.paidAt) || monthFor(invoice.date) || monthFor(invoice.createdAt));
        if (incomeMonth) incomeMonth.income += paidAmount;
      }
      outstanding += Math.max(total - paidAmount, 0);
      const isOverdue = paymentStatus !== 'paid'
        && isValidDate(invoice.dueDate)
        && invoice.dueDate < today;
      if (isOverdue) overdueCount += 1;
      if (paymentStatus !== 'paid') {
        const createdAt = invoice.createdAt ? new Date(invoice.createdAt).getTime() : new Date(`${invoice.date}T00:00:00.000Z`).getTime();
        const ageDays = Number.isFinite(createdAt) ? Math.floor((now - createdAt) / 86400000) : 0;
        if (ageDays >= reminderDays || isOverdue) {
          reminders.push({
            _id: invoice._id,
            number: invoice.number,
            customer: invoice.customer?.name || '',
            total,
            ageDays,
            dueDate: invoice.dueDate || '',
            overdueDays: isOverdue
              ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${invoice.dueDate}T00:00:00Z`)) / 86400000)
              : 0,
          });
        }
      }
    }
    for (const expense of expenseRecords) {
      const amount = Number(expense.amount) || 0;
      const linkedInvoice = expense.invoiceId ? invoiceMap.get(String(expense.invoiceId)) : null;
      const expenseDate = expense.expenseDate || monthFor(expense.createdAt);
      const month = monthBucket(monthFor(expenseDate));
      if (month) month.expenses += amount;
      expenses += amount;
      categoryTotals.set(expense.category || 'Miscellaneous', (categoryTotals.get(expense.category || 'Miscellaneous') || 0) + amount);
      expenseRows.push({
        _id: expense._id,
        expenseDate,
        category: expense.category || 'Miscellaneous',
        description: expense.description || '',
        amount,
        invoiceId: linkedInvoice?._id || null,
        invoiceNumber: linkedInvoice?.number || '',
        customer: linkedInvoice?.customer?.name || '',
        legacy: false,
      });
    }
    const linkedExpenseTotals = new Map();
    for (const expense of expenseRecords) {
      if (!expense.invoiceId) continue;
      const key = String(expense.invoiceId);
      linkedExpenseTotals.set(key, (linkedExpenseTotals.get(key) || 0) + (Number(expense.amount) || 0));
    }
    const invoiceOptions = invoices.map((invoice) => {
      const total = invoiceTotal(invoice);
      const paidAmount = invoicePaidAmount(invoice);
      const expenseTotal = roundMoney((Number(invoice.expenseAmount) || 0)
        + (linkedExpenseTotals.get(String(invoice._id)) || 0));
      return {
        _id: invoice._id,
        number: invoice.number,
        customer: invoice.customer?.name || '',
        date: invoice.date || '',
        paymentStatus: invoicePaymentStatus(invoice),
        total,
        paidAmount,
        outstandingAmount: roundMoney(Math.max(total - paidAmount, 0)),
        linkedExpenseTotal: expenseTotal,
        invoiceProfit: roundMoney(total - expenseTotal),
      };
    });
    return res.json({
      paidIncome: roundMoney(paidIncome),
      outstanding: roundMoney(outstanding),
      expenseTotal: roundMoney(expenses),
      profit: roundMoney(paidIncome - expenses),
      expenseCount: expenseRows.length,
      paidCount: invoices.filter((invoice) => invoicePaymentStatus(invoice) === 'paid').length,
      partialCount: invoices.filter((invoice) => invoicePaymentStatus(invoice) === 'partial').length,
      unpaidCount: invoices.filter((invoice) => invoicePaymentStatus(invoice) === 'unpaid').length,
      overdueCount,
      reminderDays,
      reminders: reminders.sort((a, b) => b.overdueDays - a.overdueDays || b.ageDays - a.ageDays),
      monthly: [...monthly.entries()]
        .filter(([, totals]) => totals.income > 0 || totals.expenses > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-6)
        .map(([month, totals]) => ({
          month,
          income: roundMoney(totals.income),
          expenses: roundMoney(totals.expenses),
          profit: roundMoney(totals.income - totals.expenses),
        })),
      categories: [...categoryTotals.entries()]
        .map(([category, amount]) => ({ category, amount: roundMoney(amount) }))
        .sort((a, b) => b.amount - a.amount),
      expenseEntries: expenseRows.sort((a, b) => String(b.expenseDate).localeCompare(String(a.expenseDate))).slice(0, 100),
      invoiceOptions,
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/finance/export', requireAdmin, async (req, res, next) => {
  try {
    const [invoices, expenseRecords] = await Promise.all([
      req.app.locals.documents.find({ type: 'invoice' }).sort({ createdAt: -1 }).toArray(),
      req.app.locals.expenses.find({}).sort({ expenseDate: -1, createdAt: -1 }).toArray(),
    ]);
    const headers = [
      'Record type', 'Invoice number', 'Customer', 'Invoice date', 'Due date',
      'Payment status', 'Transaction date', 'Method / category', 'Description',
      'Invoice total (Rs.)', 'Amount (Rs.)', 'Balance (Rs.)', 'Reversed',
    ];
    const rows = [headers.map(csvCell).join(',')];
    for (const invoice of invoices) {
      const total = invoiceTotal(invoice);
      const paidAmount = invoicePaidAmount(invoice);
      const invoiceFields = [
        invoice.number || '',
        invoice.customer?.name || '',
        invoice.date || '',
        invoice.dueDate || '',
        invoicePaymentStatus(invoice) !== 'paid' && isValidDate(invoice.dueDate)
          && invoice.dueDate < businessDate()
          ? 'overdue'
          : invoicePaymentStatus(invoice),
      ];
      rows.push([
        'Invoice', ...invoiceFields, '', '', '', total.toFixed(2), '', Math.max(total - paidAmount, 0).toFixed(2), '',
      ].map(csvCell).join(','));

      const paymentEntries = Array.isArray(invoice.paymentEntries) ? invoice.paymentEntries : [];
      let recordedAmount = 0;
      for (const payment of paymentEntries) {
        const amount = Number(payment.amount) || 0;
        if (!payment.reversed) recordedAmount += amount;
        rows.push([
          'Payment', ...invoiceFields, payment.date || '', payment.method || '',
          '', '', amount.toFixed(2), '', payment.reversed ? 'Yes' : 'No',
        ].map(csvCell).join(','));
      }
      const legacyAmount = roundMoney(Math.max(paidAmount - recordedAmount, 0));
      if (legacyAmount > 0) {
        rows.push([
          'Payment', ...invoiceFields, invoice.paidAt || invoice.date || '',
          invoice.paymentMethod || 'Legacy payment (details unavailable)',
          'Legacy payment amount', '', legacyAmount.toFixed(2), '', 'No',
        ].map(csvCell).join(','));
      }
      const legacyExpense = Number(invoice.expenseAmount) || 0;
      if (legacyExpense > 0) {
        rows.push([
          'Expense', ...invoiceFields, invoice.date || '', 'Invoice expense',
          invoice.expenseNote || 'Previously recorded invoice expense', '', legacyExpense.toFixed(2), '', '',
        ].map(csvCell).join(','));
      }
    }
    const invoicesById = new Map(invoices.map((invoice) => [String(invoice._id), invoice]));
    for (const expense of expenseRecords) {
      const invoice = expense.invoiceId ? invoicesById.get(String(expense.invoiceId)) : null;
      rows.push([
        'Expense',
        invoice?.number || expense.invoiceNumber || '',
        invoice?.customer?.name || expense.customer || '',
        invoice?.date || '',
        invoice?.dueDate || '',
        invoice ? invoicePaymentStatus(invoice) : '',
        expense.expenseDate || '',
        expense.category || 'Miscellaneous',
        expense.description || '',
        invoice ? invoiceTotal(invoice).toFixed(2) : '',
        (Number(expense.amount) || 0).toFixed(2),
        invoice ? Math.max(invoiceTotal(invoice) - invoicePaidAmount(invoice), 0).toFixed(2) : '',
        '',
      ].map(csvCell).join(','));
    }
    const date = businessDate();
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="veerbhadra-finance-${date}.csv"`,
      'Cache-Control': 'no-store',
    });
    return res.send(`\uFEFF${rows.join('\r\n')}\r\n`);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/expenses', requireAdmin, async (req, res, next) => {
  try {
    const { description, category, expenseDate, amount, invoiceId } = req.body || {};
    const normalizedAmount = Number(amount);
    if (typeof description !== 'string' || !description.trim() || description.length > 1000) {
      return res.status(400).json({ error: 'Enter an expense description up to 1,000 characters.' });
    }
    if (!expenseCategories.has(category)) return res.status(400).json({ error: 'Choose a valid expense category.' });
    if (!isValidDate(expenseDate)) return res.status(400).json({ error: 'Enter a valid expense date.' });
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0 || normalizedAmount > 1000000000000) {
      return res.status(400).json({ error: 'Enter a valid expense amount greater than zero.' });
    }
    let linkedInvoice = null;
    if (invoiceId) {
      if (typeof invoiceId !== 'string' || !ObjectId.isValid(invoiceId)) {
        return res.status(400).json({ error: 'Choose a valid invoice or leave it unlinked.' });
      }
      linkedInvoice = await req.app.locals.documents.findOne(
        { _id: new ObjectId(invoiceId), type: 'invoice' },
        { projection: { number: 1, customer: 1 } },
      );
      if (!linkedInvoice) return res.status(404).json({ error: 'The selected invoice no longer exists.' });
    }
    const now = new Date();
    const expense = {
      description: description.trim(),
      category,
      expenseDate,
      amount: roundMoney(normalizedAmount),
      invoiceId: linkedInvoice?._id || null,
      invoiceNumber: linkedInvoice?.number || '',
      customer: linkedInvoice?.customer?.name || '',
      createdAt: now,
      updatedAt: now,
    };
    const result = await req.app.locals.expenses.insertOne(expense);
    return res.status(201).json({ ...expense, _id: result.insertedId });
  } catch (error) {
    return next(error);
  }
});

app.put('/api/expenses/:id', requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid expense ID.' });
    const { description, category, expenseDate, amount, invoiceId } = req.body || {};
    const normalizedAmount = Number(amount);
    if (typeof description !== 'string' || !description.trim() || description.length > 1000) {
      return res.status(400).json({ error: 'Enter an expense description up to 1,000 characters.' });
    }
    if (!expenseCategories.has(category)) return res.status(400).json({ error: 'Choose a valid expense category.' });
    if (!isValidDate(expenseDate)) return res.status(400).json({ error: 'Enter a valid expense date.' });
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0 || normalizedAmount > 1000000000000) {
      return res.status(400).json({ error: 'Enter a valid expense amount greater than zero.' });
    }
    let linkedInvoice = null;
    if (invoiceId) {
      if (typeof invoiceId !== 'string' || !ObjectId.isValid(invoiceId)) {
        return res.status(400).json({ error: 'Choose a valid invoice or leave it unlinked.' });
      }
      linkedInvoice = await req.app.locals.documents.findOne(
        { _id: new ObjectId(invoiceId), type: 'invoice' },
        { projection: { number: 1, customer: 1 } },
      );
      if (!linkedInvoice) return res.status(404).json({ error: 'The selected invoice no longer exists.' });
    }
    const updates = {
      description: description.trim(),
      category,
      expenseDate,
      amount: roundMoney(normalizedAmount),
      invoiceId: linkedInvoice?._id || null,
      invoiceNumber: linkedInvoice?.number || '',
      customer: linkedInvoice?.customer?.name || '',
      updatedAt: new Date(),
    };
    const result = await req.app.locals.expenses.findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: updates },
      { returnDocument: 'after' },
    );
    if (!result) return res.status(404).json({ error: 'Expense not found.' });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/expenses/:id', requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid expense ID.' });
    const result = await req.app.locals.expenses.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ error: 'Expense not found.' });
    return res.json({ deleted: true });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/documents/:id', requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid document ID.' });
    const document = await req.app.locals.documents.findOne({ _id: new ObjectId(req.params.id) });
    if (!document) return res.status(404).json({ error: 'Document not found.' });
    if (document.type === 'invoice') {
      const linkedExpenses = await req.app.locals.expenses
        .find({ invoiceId: document._id }, { projection: { amount: 1 } }).toArray();
      const invoiceAmount = invoiceTotal(document);
      const paidAmount = invoicePaidAmount(document);
      const linkedExpenseTotal = roundMoney((Number(document.expenseAmount) || 0)
        + linkedExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0));
      return res.json({
        ...document,
        paymentStatus: invoicePaymentStatus(document),
        invoiceAmount,
        paidAmount,
        outstandingAmount: roundMoney(Math.max(invoiceAmount - paidAmount, 0)),
        linkedExpenseTotal,
        invoiceProfit: roundMoney(invoiceAmount - linkedExpenseTotal),
      });
    }
    return res.json(normalizeQuotationApproval(document));
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/documents/:id/payment', requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid document ID.' });
    const { status, paidAt, amount, method, expenseAmount, expenseNote } = req.body || {};
    if (!['paid', 'partial', 'unpaid'].includes(status)) return res.status(400).json({ error: 'Choose full payment, partial payment, or unpaid.' });
    if (status !== 'unpaid' && paidAt && !isValidDate(paidAt)) return res.status(400).json({ error: 'Enter a valid payment date.' });
    if (status !== 'unpaid' && method !== undefined && !paymentMethods.has(method)) {
      return res.status(400).json({ error: 'Choose a valid payment method.' });
    }
    const id = new ObjectId(req.params.id);
    const current = await req.app.locals.documents.findOne({ _id: id, type: 'invoice' });
    if (!current) return res.status(404).json({ error: 'Invoice not found.' });
    const submittedExpense = expenseAmount === undefined
      ? Number(current.expenseAmount || 0)
      : Number(expenseAmount || 0);
    if (!Number.isFinite(submittedExpense) || submittedExpense < 0 || submittedExpense > 1000000000000) {
      return res.status(400).json({ error: 'Enter a valid non-negative expense amount.' });
    }
    const expense = roundMoney(submittedExpense);
    if (expenseNote !== undefined && (typeof expenseNote !== 'string' || expenseNote.length > 1000)) {
      return res.status(400).json({ error: 'Expense note is invalid or too long.' });
    }
    const total = invoiceTotal(current);
    const paidAmount = invoicePaidAmount(current);
    if (total <= 0 && status !== 'unpaid') {
      return res.status(400).json({ error: 'This invoice has no calculable total. Edit and save its work lines before recording a payment.' });
    }
    const payments = Array.isArray(current.paymentEntries) ? current.paymentEntries.map((payment) => ({ ...payment })) : [];
    const legacyPaidAmount = Array.isArray(current.paymentEntries)
      && current.paymentEntries.some((payment) => !payment.reversed)
      ? Number(current.legacyPaidAmount) || 0
      : Number(current.legacyPaidAmount ?? current.paidAmount) || 0;
    let nextPayments = payments;
    let nextPaidAmount = paidAmount;
    let nextPaidAt = current.paidAt || null;
    let nextPaymentMethod = current.paymentMethod || '';
    if (status !== 'unpaid') {
      const remaining = roundMoney(Math.max(total - paidAmount, 0));
      const paymentAmount = roundMoney(amount === undefined ? remaining : Number(amount));
      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        return res.status(400).json({ error: 'Enter a payment amount greater than zero.' });
      }
      if (paymentAmount > remaining) {
        return res.status(400).json({ error: `Payment cannot exceed the remaining balance of Rs. ${remaining.toFixed(2)}.` });
      }
      if (status === 'partial' && paymentAmount >= remaining) {
        return res.status(400).json({ error: 'This amount would clear the remaining balance. Choose Mark fully paid instead.' });
      }
      if (!method || !paymentMethods.has(method)) {
        return res.status(400).json({ error: 'Choose a payment method.' });
      }
      const paymentDate = paidAt || new Date().toISOString().slice(0, 10);
      nextPayments = [...payments, {
        amount: paymentAmount,
        date: paymentDate,
        method,
        createdAt: new Date(),
      }];
      nextPaidAmount = roundMoney(paidAmount + paymentAmount);
      nextPaidAt = paymentDate;
      nextPaymentMethod = method;
    } else {
      nextPayments = payments.map((payment) => payment.reversed
        ? payment
        : { ...payment, reversed: true, reversedAt: new Date() });
      nextPaidAmount = 0;
      nextPaidAt = null;
      nextPaymentMethod = '';
    }
    const updatedPaymentStatus = nextPaidAmount > 0 && nextPaidAmount >= total
      ? 'paid'
      : nextPaidAmount > 0 ? 'partial' : 'unpaid';
    const updates = {
      paymentStatus: updatedPaymentStatus,
      paidAt: nextPaidAt,
      paymentMethod: nextPaymentMethod,
      paymentEntries: nextPayments,
      legacyPaidAmount: status === 'unpaid' ? 0 : roundMoney(legacyPaidAmount),
      paymentRevision: (Number(current.paymentRevision) || 0) + 1,
      expenseAmount: expense,
      expenseNote: expenseNote === undefined ? current.expenseNote || '' : expenseNote.trim(),
      updatedAt: new Date(),
    };
    const revisionFilter = current.paymentRevision === undefined
      ? { paymentRevision: { $exists: false } }
      : { paymentRevision: current.paymentRevision };
    const updateResult = await req.app.locals.documents.updateOne(
      { _id: id, type: 'invoice', ...revisionFilter },
      { $set: updates },
    );
    if (updateResult.modifiedCount !== 1) {
      return res.status(409).json({ error: 'This invoice changed while the payment was being recorded. Refresh it and try again.' });
    }
    const linkedExpenses = await req.app.locals.expenses
      .find({ invoiceId: id }, { projection: { amount: 1 } }).toArray();
    const linkedExpenseTotal = roundMoney((Number(updates.expenseAmount) || 0)
      + linkedExpenses.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0));
    return res.json({
      ...current,
      ...updates,
      invoiceAmount: total,
      paidAmount: nextPaidAmount,
      outstandingAmount: roundMoney(Math.max(total - nextPaidAmount, 0)),
      linkedExpenseTotal,
      invoiceProfit: roundMoney(total - linkedExpenseTotal),
    });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/documents/:id', requireAdmin, async (req, res, next) => {
  let session;
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid document ID.' });
    const id = new ObjectId(req.params.id);
    session = req.app.locals.mongoClient.startSession();
    let documentDeleted = false;
    let activePaymentsPreventDeletion = false;
    let deletedExpenses = 0;
    try {
      await session.withTransaction(async () => {
        const document = await req.app.locals.documents.findOne({ _id: id }, { session });
        if (!document) {
          const orphanedExpenses = await req.app.locals.expenses.deleteMany({ invoiceId: id }, { session });
          deletedExpenses = orphanedExpenses.deletedCount;
          documentDeleted = deletedExpenses > 0;
          return;
        }
        if (document.type === 'invoice') {
          if (invoicePaidAmount(document) > 0) {
            activePaymentsPreventDeletion = true;
            return;
          }
          const expenseResult = await req.app.locals.expenses.deleteMany({ invoiceId: id }, { session });
          deletedExpenses = expenseResult.deletedCount;
        }
        const result = await req.app.locals.documents.deleteOne({ _id: id }, { session });
        documentDeleted = result.deletedCount === 1;
      });
    } catch (error) {
      const standaloneMongoError = error.code === 20
        && error.codeName === 'IllegalOperation'
        && error.message.includes('Transaction numbers are only allowed');
      if (!standaloneMongoError) throw error;
      const document = await req.app.locals.documents.findOne({ _id: id });
      if (document) {
        if (document.type === 'invoice' && invoicePaidAmount(document) > 0) {
          return res.status(409).json({ error: 'Reverse all recorded payments with Mark unpaid before deleting this invoice.' });
        }
        const result = await req.app.locals.documents.deleteOne({ _id: id });
        documentDeleted = result.deletedCount === 1;
        if (documentDeleted && document.type === 'invoice') {
          const expenseResult = await req.app.locals.expenses.deleteMany({ invoiceId: id });
          deletedExpenses = expenseResult.deletedCount;
        }
      } else {
        const orphanedExpenses = await req.app.locals.expenses.deleteMany({ invoiceId: id });
        deletedExpenses = orphanedExpenses.deletedCount;
        documentDeleted = deletedExpenses > 0;
      }
    }
    if (activePaymentsPreventDeletion) {
      return res.status(409).json({ error: 'Reverse all recorded payments with Mark unpaid before deleting this invoice.' });
    }
    if (!documentDeleted) return res.status(404).json({ error: 'Document not found.' });
    return res.json({ deleted: true, deletedExpenses });
  } catch (error) {
    return next(error);
  } finally {
    await session?.endSession();
  }
});

app.patch('/api/documents/:id/approval', requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid document ID.' });
    if (!['approved', 'rejected'].includes(req.body?.status)) {
      return res.status(400).json({ error: 'Choose approved or rejected.' });
    }
    const id = new ObjectId(req.params.id);
    const current = await req.app.locals.documents.findOne({ _id: id, type: 'quotation' });
    if (!current) return res.status(404).json({ error: 'Quotation not found.' });
    const currentStatus = normalizeQuotationApproval(current).approvalStatus;
    if (currentStatus === 'approved' && req.body.status === 'rejected') {
      return res.status(409).json({ error: 'An approved quotation cannot be rejected.' });
    }
    if (currentStatus === req.body.status && current.approvalDecisionAt) {
      return res.json(normalizeQuotationApproval(current));
    }
    const approvedAt = req.body.status === 'approved' ? new Date() : null;
    const approvalDecisionAt = new Date();
    await req.app.locals.documents.updateOne(
      { _id: id, type: 'quotation' },
      { $set: { approvalStatus: req.body.status, approvalDecisionAt, approvedAt, updatedAt: approvalDecisionAt } },
    );
    return res.json({ ...current, approvalStatus: req.body.status, approvalDecisionAt, approvedAt });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/documents', requireAdmin, async (req, res, next) => {
  try {
    const validationError = validateDocument(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const sourceError = await validateQuotationSource(req.app.locals.documents, req.body);
    if (sourceError) return res.status(400).json({ error: sourceError });

    const year = req.body.date.slice(0, 4);
    const counterId = `${req.body.type}:${year}`;
    const counter = await req.app.locals.counters.findOneAndUpdate(
      { _id: counterId },
      { $inc: { sequence: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    const number = `VE/${typeCodes[req.body.type]}/${year}/${String(counter.sequence).padStart(4, '0')}`;
    const record = {
      ...req.body,
      number,
      ...(req.body.type === 'quotation'
        ? { approvalStatus: 'pending', approvalDecisionAt: null, approvedAt: null }
        : {}),
      ...(req.body.type === 'invoice'
        ? { paymentStatus: 'unpaid', paidAt: null, paymentMethod: '', paymentEntries: [], expenseAmount: 0, expenseNote: '' }
        : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await saveCompanyProfile(req.app.locals.companies, record.customer);
    const result = await req.app.locals.documents.insertOne(record);
    await saveProductCatalog(req.app.locals.products, record.items);
    return res.status(201).json({ ...record, _id: result.insertedId });
  } catch (error) {
    return next(error);
  }
});

app.put('/api/documents/:id', requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid document ID.' });
    const current = await req.app.locals.documents.findOne({ _id: new ObjectId(req.params.id) });
    if (!current) return res.status(404).json({ error: 'Document not found.' });
    const validationError = validateDocument(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    if (req.body.type !== current.type) return res.status(400).json({ error: 'A saved document type cannot be changed.' });
    const sourceError = await validateQuotationSource(req.app.locals.documents, req.body, false);
    if (sourceError) return res.status(400).json({ error: sourceError });
    if (current.type === 'invoice' && invoicePaidAmount(current) > invoiceTotal(req.body)) {
      return res.status(400).json({ error: 'The edited invoice total cannot be less than payments already received.' });
    }

    const updates = {
      ...req.body,
      number: current.number,
      createdAt: current.createdAt,
      updatedAt: new Date(),
      ...(current.type === 'quotation'
        ? {
          approvalStatus: 'pending',
          approvalDecisionAt: null,
          approvedAt: null,
        }
        : {}),
      ...(current.type === 'invoice'
        ? {
          paymentStatus: invoicePaymentStatus(current),
          paidAt: current.paidAt || null,
          paymentMethod: current.paymentMethod || '',
          paymentRevision: (Number(current.paymentRevision) || 0) + 1,
          expenseAmount: Number(current.expenseAmount) || 0,
          expenseNote: current.expenseNote || '',
          ...(Array.isArray(current.paymentEntries) ? { paymentEntries: current.paymentEntries } : {}),
        }
        : {}),
    };
    const updateFilter = { _id: current._id };
    if (current.type === 'invoice') {
      updateFilter.paymentRevision = current.paymentRevision === undefined
        ? { $exists: false }
        : current.paymentRevision;
    }
    const updateResult = await req.app.locals.documents.updateOne(
      updateFilter,
      { $set: updates },
    );
    if (updateResult.modifiedCount !== 1) {
      return res.status(409).json({ error: 'This invoice changed while it was being edited. Refresh it and try again.' });
    }
    await saveCompanyProfile(req.app.locals.companies, updates.customer);
    await saveProductCatalog(req.app.locals.products, updates.items);
    return res.json(normalizeQuotationApproval({ ...current, ...updates }));
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Request failed:', error);
  return res.status(500).json({ error: 'The request could not be completed. Please try again.' });
});

async function startLocalServer() {
  await initializeDatabase();
  app.listen(port, () => {
    console.log(`Veerbhadra Engineers is listening on port ${port} (MongoDB database: ${app.locals.databaseName})`);
  });
}

if (require.main === module) {
  startLocalServer().catch((error) => {
    console.error('Could not start the application:', error);
    process.exitCode = 1;
  });
}

module.exports = app;
