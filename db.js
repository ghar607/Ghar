const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DB_FILE = path.join(__dirname, "data", "db.json");

function defaultData() {
  return {
    users: [
      {
        id: 1,
        role: "admin",
        name: "Admin",
        phone: "03000000000",
        password: bcrypt.hashSync("admin123", 8),
        status: "approved",
      },
    ],
    shops: [],
    products: [],
    orders: [],
    otps: {},
    locations: [],
    banners: [],
    settings: {
      riderCommissionPercent: 10,
      adminCommissionPercent: 5,
    },
    nextId: {
      user: 2,
      shop: 1,
      product: 1,
      order: 1,
      location: 1,
      banner: 1,
    },
  };
}

function load() {
  if (!fs.existsSync(DB_FILE)) {
    save(defaultData());
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  // Migration: agar purani db.json mein locations na ho to add kar dein
  if (!data.locations) data.locations = [];
  if (!data.nextId.location) data.nextId.location = 1;
  // Migration: home page slider ke banners — purani db.json mein na hon to add kar dein
  if (!data.banners) data.banners = [];
  if (!data.nextId.banner) data.nextId.banner = 1;
  data.banners.forEach((b, i) => {
    if (b.order === undefined) b.order = i + 1;
  });
  // Migration: purane orders mein payout fields na hon to add kar dein
  (data.orders || []).forEach((o) => {
    if (o.payoutAmount === undefined) o.payoutAmount = o.total - o.commission;
    if (o.payoutSent === undefined) o.payoutSent = false;
    if (o.payoutSentAt === undefined) o.payoutSentAt = null;
    if (o.rated === undefined) o.rated = false;
  });
  // Migration: purani products mein inStock field na ho to add kar dein
  (data.products || []).forEach((p) => {
    if (p.inStock === undefined) p.inStock = true;
    // Migration: purani products mein discount aur unit (weight/volume) field na hon to add kar dein
    if (p.discount === undefined) p.discount = 0;
    if (p.unit === undefined) p.unit = "";
  });
  // Migration: purani shops mein reviews list na ho to add kar dein
  (data.shops || []).forEach((s) => {
    if (!s.reviews) s.reviews = [];
    // Migration: shopkeeper ka apna JazzCash/EasyPaisa number aur accepted payment methods
    if (s.acceptCOD === undefined) s.acceptCOD = true;
    if (s.acceptJazzCash === undefined) s.acceptJazzCash = false;
    if (s.acceptEasyPaisa === undefined) s.acceptEasyPaisa = false;
    if (s.jazzcashNumber === undefined) s.jazzcashNumber = "";
    if (s.easypaisaNumber === undefined) s.easypaisaNumber = "";
  });
  // Migration: purani db.json mein sirf ek "commissionPercent" tha, ab do alag settings hain
  if (data.settings.commissionPercent !== undefined && data.settings.riderCommissionPercent === undefined) {
    data.settings.riderCommissionPercent = data.settings.commissionPercent;
    delete data.settings.commissionPercent;
  }
  if (data.settings.riderCommissionPercent === undefined) data.settings.riderCommissionPercent = 10;
  if (data.settings.adminCommissionPercent === undefined) data.settings.adminCommissionPercent = 5;
  // Migration: purane orders mein rider/admin commission ki tafseel na ho to add kar dein
  (data.orders || []).forEach((o) => {
    if (o.riderCommission === undefined || o.adminCommission === undefined) {
      o.riderCommission = o.commission || 0;
      o.adminCommission = 0;
    }
  });
  // Migration: direct payment (customer -> shopkeeper seedha) orders ke liye
  // shopkeeper khud payment verify karta hai aur phir admin ka commission ada karta hai.
  (data.orders || []).forEach((o) => {
    if (o.directPayment === undefined) o.directPayment = o.paymentMethod !== "COD";
    if (o.commissionSent === undefined) o.commissionSent = false;
    if (o.commissionSentAt === undefined) o.commissionSentAt = null;
    if (o.commissionTransactionId === undefined) o.commissionTransactionId = null;
    if (o.commissionReceived === undefined) o.commissionReceived = false;
    if (o.commissionReceivedAt === undefined) o.commissionReceivedAt = null;
  });
  return data;
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function nextId(db, type) {
  const id = db.nextId[type];
  db.nextId[type] = id + 1;
  return id;
}

module.exports = { load, save, nextId };
