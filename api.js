// =====================================================================
// api.js — Ye file sirf MOBILE APP (React Native) ke liye hai.
// Website (views/*.ejs, server.js ke andar wale routes) is se bilkul
// alag/mustaqil hai — is file mein kuch bhi badlein, website par
// koi asar nahi parega.
//
// Mobile app JSON data mangta hai (HTML page nahi), isliye yahan
// har route JSON response deta hai. Login ke liye session/cookie ki
// jagah JWT token istemal hota hai (mobile apps ke liye yeh tareeqa
// zyada aasan aur reliable hai).
// =====================================================================

const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const { load, save, nextId } = require("./db");

const router = express.Router();

// Production mein isay .env variable se lena chahiye — filhaal simple rakha hai
const JWT_SECRET = process.env.JWT_SECRET || "ghar-ki-zarurat-mobile-secret";

// ---------- Chote helper functions (server.js walon jaisay hi, taake yeh file mustaqil rahe) ----------
function isValidPakPhone(phone) {
  if (!phone) return false;
  const p = String(phone).replace(/[\s-]/g, "");
  return /^(03\d{9}|(\+92|0092|92)3\d{9})$/.test(p);
}

function normalizePakPhone(phone) {
  let p = String(phone).replace(/[\s-]/g, "").replace(/^\+/, "");
  if (p.startsWith("0092")) p = p.slice(4);
  else if (p.startsWith("92")) p = p.slice(2);
  if (!p.startsWith("0")) p = "0" + p;
  return p;
}

function isStrongPassword(pw) {
  return typeof pw === "string" && pw.length >= 6 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}

function effectivePrice(p) {
  const base = Number(p.price) || 0;
  const disc = Number(p.discount) || 0;
  if (disc > 0) return Math.round(base * (1 - disc / 100) * 100) / 100;
  return base;
}

// Product/shop images upload karne ke liye (website wale multer se mustaqil, lekin isi uploads folder mein save karta hai)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, "public", "uploads")),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_")),
  }),
});

// ---------- Auth middleware (JWT token check karta hai) ----------
function requireAuth(...roles) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Login zaroori hai." });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ error: "Is action ki ijazat nahi hai." });
      }
      req.apiUser = payload; // { id, name, role, phone }
      next();
    } catch (e) {
      return res.status(401).json({ error: "Token invalid ya expire ho gaya hai, dobara login karein." });
    }
  };
}

// =====================================================================
// ---------- AUTH ----------
// =====================================================================

// POST /api/login  { phone, password, role }
router.post("/login", (req, res) => {
  const { password, role } = req.body;
  if (!isValidPakPhone(req.body.phone)) {
    return res.status(400).json({ error: "Sahi Pakistani phone number likhein." });
  }
  const phone = normalizePakPhone(req.body.phone);
  const db = load();
  const user = db.users.find((u) => u.phone === phone && u.role === role);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: "Phone ya password ghalat hai." });
  }
  if (user.status === "blocked") {
    return res.status(403).json({ error: "Aapka account block kar diya gaya hai." });
  }
  if ((role === "shopkeeper" || role === "rider") && user.status !== "approved") {
    return res.status(403).json({ error: "Aapka account abhi admin approval ka intezaar kar raha hai." });
  }
  const payload = { id: user.id, name: user.name, role: user.role, phone: user.phone };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: payload });
});

// GET /api/locations — signup dropdown ke liye
router.get("/locations", (req, res) => {
  const db = load();
  const locations = db.locations.slice().sort((a, b) => a.name.localeCompare(b.name));
  res.json({ locations });
});

// POST /api/signup — abhi sirf CUSTOMER signup (shopkeeper/rider signup, jin mein file uploads
// zaroori hain, agle step mein add karenge jab app ka basic flow chal jaye)
router.post("/signup", (req, res) => {
  const db = load();
  const { name, address, password, confirmPassword, locationId } = req.body;
  const role = "customer";

  if (!isValidPakPhone(req.body.phone)) {
    return res.status(400).json({ error: "Sahi Pakistani phone number likhein." });
  }
  const phone = normalizePakPhone(req.body.phone);

  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: "Password kam se kam 6 hindson ka ho aur letters+numbers dono shamil hon." });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: "Password match nahi karte." });
  }
  if (db.users.find((u) => u.phone === phone && u.role === role)) {
    return res.status(400).json({ error: "Yeh phone number pehle se registered hai." });
  }
  const location = db.locations.find((l) => l.id == locationId);
  if (!location) {
    return res.status(400).json({ error: "Location select karna zaroori hai." });
  }

  const id = nextId(db, "user");
  const newUser = {
    id,
    role,
    name,
    phone,
    address,
    locationId: location.id,
    locationName: location.name,
    password: bcrypt.hashSync(password, 8),
    status: "approved",
  };
  db.users.push(newUser);
  save(db);

  const payload = { id, name, role, phone };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: payload });
});

// =====================================================================
// ---------- CUSTOMER ----------
// =====================================================================

// GET /api/customer/shops?locationId=...
router.get("/customer/shops", requireAuth("customer"), (req, res) => {
  const db = load();
  const approvedShopkeepers = db.users.filter((u) => u.role === "shopkeeper" && u.status === "approved").map((u) => u.id);
  let shops = db.shops.filter((s) => approvedShopkeepers.includes(s.ownerId));

  const selectedLocation = req.query.locationId || "";
  if (selectedLocation) shops = shops.filter((s) => s.locationId == selectedLocation);

  res.json({ shops });
});

// GET /api/customer/shop/:id — shop details + uske products
router.get("/customer/shop/:id", requireAuth("customer"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.id == req.params.id);
  if (!shop) return res.status(404).json({ error: "Shop nahi mili." });
  const items = db.products.filter((p) => p.shopId == req.params.id).map((p) => ({ ...p, price: effectivePrice(p) }));
  res.json({ shop, items });
});

// POST /api/customer/order
// body: { shopId, items: [{ productId, qty }], name, address, phone, paymentMethod, transactionId }
router.post("/customer/order", requireAuth("customer"), (req, res) => {
  const db = load();
  const { shopId, items, paymentMethod } = req.body;
  const transactionId = (req.body.transactionId || "").trim();

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart khali hai." });
  }
  const shop = db.shops.find((s) => s.id == shopId);
  if (!shop) return res.status(404).json({ error: "Shop nahi mili." });

  const methodAccepted =
    (paymentMethod === "COD" && shop.acceptCOD) ||
    (paymentMethod === "JazzCash" && shop.acceptJazzCash) ||
    (paymentMethod === "EasyPaisa" && shop.acceptEasyPaisa);
  if (!methodAccepted) {
    return res.status(400).json({ error: "Yeh payment method is shop par available nahi hai." });
  }
  if ((paymentMethod === "JazzCash" || paymentMethod === "EasyPaisa") && !transactionId) {
    return res.status(400).json({ error: "Online payment ke liye Transaction ID likhna zaroori hai." });
  }

  const orderItems = items.map((it) => {
    const p = db.products.find((pr) => pr.id == it.productId);
    return { productId: p.id, name: p.name, unit: p.unit || "", price: effectivePrice(p), qty: it.qty };
  });
  const total = orderItems.reduce((s, i) => s + i.price * i.qty, 0);
  const riderCommission = Math.round((total * db.settings.riderCommissionPercent) / 100);
  const adminCommission = Math.round((total * db.settings.adminCommissionPercent) / 100);
  const commission = riderCommission + adminCommission;
  const payoutAmount = total - commission;
  const directPayment = paymentMethod !== "COD";

  const order = {
    id: nextId(db, "order"),
    customerId: req.apiUser.id,
    customerName: req.body.name,
    customerAddress: req.body.address,
    customerPhone: req.body.phone,
    shopId: shop.id,
    items: orderItems,
    total,
    riderCommission,
    adminCommission,
    commission,
    payoutAmount,
    payoutSent: false,
    payoutSentAt: null,
    riderPayoutSent: false,
    riderPayoutSentAt: null,
    paymentMethod,
    transactionId: transactionId || null,
    directPayment,
    paymentVerified: paymentMethod === "COD",
    commissionSent: false,
    commissionSentAt: null,
    commissionTransactionId: null,
    commissionReceived: false,
    commissionReceivedAt: null,
    status: "pending",
    riderId: null,
    createdAt: new Date().toISOString(),
    log: [{ status: "pending", at: new Date().toISOString() }],
  };
  db.orders.push(order);
  save(db);
  res.json({ order });
});

// GET /api/customer/orders
router.get("/customer/orders", requireAuth("customer"), (req, res) => {
  const db = load();
  const orders = db.orders.filter((o) => o.customerId === req.apiUser.id).reverse();
  res.json({ orders });
});

// POST /api/customer/order/:id/cancel
router.post("/customer/order/:id/cancel", requireAuth("customer"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id && o.customerId === req.apiUser.id);
  if (!order) return res.status(404).json({ error: "Order nahi mila." });
  if (!["pending", "confirmed"].includes(order.status)) {
    return res.status(400).json({ error: "Yeh order ab cancel nahi ho sakta." });
  }
  order.status = "cancelled";
  order.log.push({ status: "cancelled by customer", at: new Date().toISOString() });
  save(db);
  res.json({ order });
});

// POST /api/customer/order/:id/review  { stars, review }
router.post("/customer/order/:id/review", requireAuth("customer"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id && o.customerId === req.apiUser.id);
  if (!order) return res.status(404).json({ error: "Order nahi mila." });
  if (order.status !== "delivered" || order.rated) {
    return res.status(400).json({ error: "Is order par review nahi de sakte." });
  }
  const shop = db.shops.find((s) => s.id === order.shopId);
  const stars = Math.min(5, Math.max(1, parseInt(req.body.stars) || 5));
  if (shop) {
    if (!shop.reviews) shop.reviews = [];
    shop.reviews.push({
      orderId: order.id,
      customerId: req.apiUser.id,
      customerName: order.customerName,
      stars,
      review: (req.body.review || "").trim(),
      at: new Date().toISOString(),
    });
  }
  order.rated = true;
  save(db);
  res.json({ ok: true });
});

// =====================================================================
// ---------- SHOPKEEPER ----------
// =====================================================================

// GET /api/shopkeeper/dashboard — shop + uske orders + approved riders
router.get("/shopkeeper/dashboard", requireAuth("shopkeeper"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.ownerId === req.apiUser.id);
  const orders = shop ? db.orders.filter((o) => o.shopId === shop.id).reverse() : [];
  const riders = db.users.filter((u) => u.role === "rider" && u.status === "approved");
  res.json({ shop, orders, riders });
});

// GET /api/shopkeeper/products
router.get("/shopkeeper/products", requireAuth("shopkeeper"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.ownerId === req.apiUser.id);
  const items = shop ? db.products.filter((p) => p.shopId === shop.id) : [];
  res.json({ shop, items });
});

// POST /api/shopkeeper/products/add  (multipart form: pic + name, price, discount, unit, inStock)
router.post("/shopkeeper/products/add", requireAuth("shopkeeper"), upload.single("pic"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.ownerId === req.apiUser.id);
  if (!shop) return res.status(400).json({ error: "Aapki koi shop nahi mili." });
  const product = {
    id: nextId(db, "product"),
    shopId: shop.id,
    name: req.body.name,
    price: parseFloat(req.body.price),
    discount: req.body.discount ? Math.min(100, Math.max(0, parseFloat(req.body.discount))) : 0,
    unit: req.body.unit || "",
    pic: req.file ? "/uploads/" + req.file.filename : null,
    inStock: req.body.inStock === "true" || req.body.inStock === "on",
  };
  db.products.push(product);
  save(db);
  res.json({ product });
});

// POST /api/shopkeeper/products/:id/update
router.post("/shopkeeper/products/:id/update", requireAuth("shopkeeper"), upload.single("pic"), (req, res) => {
  const db = load();
  const product = db.products.find((p) => p.id == req.params.id);
  if (!product) return res.status(404).json({ error: "Product nahi mila." });
  product.name = req.body.name;
  product.price = parseFloat(req.body.price);
  product.discount = req.body.discount ? Math.min(100, Math.max(0, parseFloat(req.body.discount))) : 0;
  product.unit = req.body.unit || "";
  product.inStock = req.body.inStock === "true" || req.body.inStock === "on";
  if (req.file) product.pic = "/uploads/" + req.file.filename;
  save(db);
  res.json({ product });
});

// POST /api/shopkeeper/products/:id/delete
router.post("/shopkeeper/products/:id/delete", requireAuth("shopkeeper"), (req, res) => {
  const db = load();
  db.products = db.products.filter((p) => p.id != req.params.id);
  save(db);
  res.json({ ok: true });
});

// POST /api/shopkeeper/order/:id/verify-payment
router.post("/shopkeeper/order/:id/verify-payment", requireAuth("shopkeeper"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.ownerId === req.apiUser.id);
  const order = db.orders.find((o) => o.id == req.params.id && shop && o.shopId === shop.id);
  if (!order) return res.status(404).json({ error: "Order nahi mila." });
  if (order.directPayment && !order.paymentVerified) {
    order.paymentVerified = true;
    order.log.push({ status: "payment verified by shopkeeper", at: new Date().toISOString() });
    save(db);
  }
  res.json({ order });
});

// POST /api/shopkeeper/order/:id/confirm
router.post("/shopkeeper/order/:id/confirm", requireAuth("shopkeeper"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  if (!order || !order.paymentVerified) {
    return res.status(400).json({ error: "Order confirm nahi ho sakta." });
  }
  order.status = "confirmed";
  order.log.push({ status: "confirmed", at: new Date().toISOString() });
  save(db);
  res.json({ order });
});

// POST /api/shopkeeper/order/:id/assign  { riderId }
router.post("/shopkeeper/order/:id/assign", requireAuth("shopkeeper"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  if (!order) return res.status(404).json({ error: "Order nahi mila." });
  order.riderId = parseInt(req.body.riderId);
  order.status = "assigned";
  order.log.push({ status: "assigned", at: new Date().toISOString() });
  save(db);
  res.json({ order });
});

// =====================================================================
// ---------- RIDER ----------
// =====================================================================

// GET /api/rider/dashboard
router.get("/rider/dashboard", requireAuth("rider"), (req, res) => {
  const db = load();
  const orders = db.orders.filter((o) => o.riderId === req.apiUser.id).reverse();
  const enriched = orders.map((o) => ({ ...o, shop: db.shops.find((s) => s.id === o.shopId) }));
  const pendingDeliveries = enriched.filter((o) => o.status !== "delivered" && o.status !== "cancelled");
  const deliveredOrders = enriched.filter((o) => o.status === "delivered");
  const paidCommission = deliveredOrders.filter((o) => o.riderPayoutSent).reduce((s, o) => s + (o.riderCommission || 0), 0);
  const pendingCommission = deliveredOrders.filter((o) => !o.riderPayoutSent).reduce((s, o) => s + (o.riderCommission || 0), 0);
  res.json({ orders: enriched, pendingDeliveries, paidCommission, pendingCommission });
});

// POST /api/rider/order/:id/pickup
router.post("/rider/order/:id/pickup", requireAuth("rider"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  if (!order) return res.status(404).json({ error: "Order nahi mila." });
  order.status = "picked";
  order.log.push({ status: "picked", at: new Date().toISOString() });
  save(db);
  res.json({ order });
});

// POST /api/rider/order/:id/deliver
router.post("/rider/order/:id/deliver", requireAuth("rider"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  if (!order) return res.status(404).json({ error: "Order nahi mila." });
  order.status = "delivered";
  order.log.push({ status: "delivered", at: new Date().toISOString() });
  save(db);
  res.json({ order });
});

module.exports = router;
