require('dotenv').config();

const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { MongoClient, ObjectId } = require('mongodb');
const { rateLimit } = require('express-rate-limit');

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
const documentTypes = new Set(['quotation', 'invoice', 'challan', 'service-report']);
const typeCodes = {
  quotation: 'QUO',
  invoice: 'INV',
  challan: 'DC',
  'service-report': 'SR',
};

app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 've-admin-session',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'adminSessions',
    ttl: 60 * 60 * 8,
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
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

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
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

function validateDocument(body) {
  if (!body || !documentTypes.has(body.type)) return 'Choose a valid document type.';
  if (!isValidDate(body.date)) return 'Enter a valid document date.';
  if (!body.customer || typeof body.customer !== 'object' || Array.isArray(body.customer)) return 'Enter the client details.';
  if (typeof body.customer.name !== 'string' || !body.customer.name.trim()) return 'Client / Company Name is required.';
  const minimumItems = body.type === 'service-report' ? 0 : 1;
  if (!Array.isArray(body.items) || body.items.length < minimumItems || body.items.length > 100) return 'Add valid work rows.';
  if (body.items.some((item) => (
    !item || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 2000
    || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || Number(item.quantity) > 1000000000
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
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const usernameMatches = safeEqual(username, process.env.ADMIN_USERNAME.trim().toLowerCase());
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

app.get('/api/documents', requireAdmin, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.type) {
      if (!documentTypes.has(req.query.type)) return res.status(400).json({ error: 'Choose a valid document type.' });
      filter.type = req.query.type;
    }
    const documents = await req.app.locals.documents
      .find(filter, { projection: { type: 1, number: 1, date: 1, customer: 1, createdAt: 1, approvalStatus: 1, sourceQuotationNumber: 1 } })
      .sort({ createdAt: -1 })
      .limit(250)
      .toArray();
    return res.json(documents);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/documents/:id', requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid document ID.' });
    const document = await req.app.locals.documents.findOne({ _id: new ObjectId(req.params.id) });
    if (!document) return res.status(404).json({ error: 'Document not found.' });
    return res.json(document);
  } catch (error) {
    return next(error);
  }
});

app.patch('/api/documents/:id/approval', requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Invalid document ID.' });
    if (!['approved', 'pending'].includes(req.body?.status)) {
      return res.status(400).json({ error: 'Choose approved or pending approval.' });
    }
    const id = new ObjectId(req.params.id);
    const current = await req.app.locals.documents.findOne({ _id: id, type: 'quotation' });
    if (!current) return res.status(404).json({ error: 'Quotation not found.' });
    const approvedAt = req.body.status === 'approved' ? new Date() : null;
    await req.app.locals.documents.updateOne(
      { _id: id, type: 'quotation' },
      { $set: { approvalStatus: req.body.status, approvedAt, updatedAt: new Date() } },
    );
    return res.json({ ...current, approvalStatus: req.body.status, approvedAt });
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
      ...(req.body.type === 'quotation' ? { approvalStatus: 'pending' } : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await saveCompanyProfile(req.app.locals.companies, record.customer);
    const result = await req.app.locals.documents.insertOne(record);
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

    const updates = {
      ...req.body,
      number: current.number,
      createdAt: current.createdAt,
      updatedAt: new Date(),
      ...(current.type === 'quotation'
        ? {
          approvalStatus: current.approvalStatus === 'approved' ? 'pending' : current.approvalStatus || 'pending',
          ...(current.approvalStatus === 'approved' ? { approvedAt: null } : {}),
        }
        : {}),
    };
    await req.app.locals.documents.updateOne(
      { _id: current._id },
      { $set: updates },
    );
    await saveCompanyProfile(req.app.locals.companies, updates.customer);
    return res.json({ ...current, ...updates });
  } catch (error) {
    return next(error);
  }
});

app.use(express.static(__dirname));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Request failed:', error);
  return res.status(500).json({ error: 'The request could not be completed. Please try again.' });
});

async function start() {
  await mongoClient.connect();
  const database = mongoClient.db();
  app.locals.documents = database.collection('documents');
  app.locals.companies = database.collection('companies');
  app.locals.counters = database.collection('documentCounters');
  await app.locals.documents.createIndex({ type: 1, number: 1 }, { unique: true });
  await app.locals.documents.createIndex({ createdAt: -1 });
  await app.locals.companies.createIndex({ normalizedName: 1 }, { unique: true });
  app.listen(port, () => {
    console.log(`Veerbhadra Engineers is listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Could not start the application:', error);
  process.exitCode = 1;
});
