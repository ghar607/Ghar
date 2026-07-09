const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const { load, save, nextId } = require("./db");

// Mobile app (React Native) ke liye alag JSON API — website ke routes se bilkul mustaqil
const apiRouter = require("./api");

const app = express();
const PORT = process.env.PORT || 8080;

// ---------- Setup ----------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: "ghar-ki-zarurat-secret",
    resave: false,
    saveUninitialized: true,
  })
);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, "public", "uploads")),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_")),
  }),
});

const SITE = {
  name: "Ghar ki Zarurat",
  tagline: "Har Ghar Ki Zarurat",
  whatsapp: "+923367878763",
  easypaisa: "03400026136",
  jazzcash: "03367878763",
};

// ---------- Helpers ----------
function requireLogin(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      return res.redirect("/login?role=" + (roles[0] || "customer"));
    }
    next();
  };
}

function genOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Product ki discount lagi hui final price nikalne ke liye
// (agar discount % set hai to price us hisaab se kam kar dete hain).
function effectivePrice(p) {
  const base = Number(p.price) || 0;
  const disc = Number(p.discount) || 0;
  if (disc > 0) {
    return Math.round(base * (1 - disc / 100) * 100) / 100;
  }
  return base;
}

// ---------- Pakistani phone number validation ----------
// Qabil-e-qabool formats: 03XXXXXXXXX, +923XXXXXXXXX, 00923XXXXXXXXX, 923XXXXXXXXX
function isValidPakPhone(phone) {
  if (!phone) return false;
  const p = String(phone).replace(/[\s-]/g, "");
  return /^(03\d{9}|(\+92|0092|92)3\d{9})$/.test(p);
}

// Har format ko hamesha 03XXXXXXXXX shakal mein normalize kar dete hain, taake
// database mein hamesha ek jaisa format save ho aur login/lookup theek se ho.
function normalizePakPhone(phone) {
  let p = String(phone).replace(/[\s-]/g, "").replace(/^\+/, "");
  if (p.startsWith("0092")) p = p.slice(4);
  else if (p.startsWith("92")) p = p.slice(2);
  if (!p.startsWith("0")) p = "0" + p;
  return p;
}

// ---------- Password strength ----------
// Kam se kam 6 hindse (characters), aur strong banane ke liye kam se kam
// ek letter aur ek number ka hona zaroori hai.
function isStrongPassword(pw) {
  return typeof pw === "string" && pw.length >= 6 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}

// Phone number ko masked (chupa kar) dikhane ke liye — "Forgot phone number" feature mein istemal hota hai
function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 4) + "****" + phone.slice(-3);
}

// Phone number ko WhatsApp (wa.me) ke qabil format mein badalta hai (0XXXXXXXXXX -> 92XXXXXXXXXX)
function toWaNumber(phone) {
  if (!phone) return "";
  let p = String(phone).replace(/\D/g, "");
  if (p.startsWith("0")) p = "92" + p.slice(1);
  return p;
}
app.locals.toWaNumber = toWaNumber;

// Shop ki average rating aur total reviews nikalta hai
function shopRatingInfo(shop) {
  const reviews = (shop && shop.reviews) || [];
  if (reviews.length === 0) return { avg: null, count: 0 };
  const sum = reviews.reduce((s, r) => s + r.stars, 0);
  return { avg: Math.round((sum / reviews.length) * 10) / 10, count: reviews.length };
}
app.locals.shopRatingInfo = shopRatingInfo;

app.use((req, res, next) => {
  res.locals.SITE = SITE;
  res.locals.user = req.session.user || null;
  next();
});

// Mobile app ke JSON API endpoints /api/... par yahan connect ho rahe hain (api.js file mein hain)
app.use("/api", express.json(), apiRouter);

// ---------- Home ----------
app.get("/", (req, res) => {
  const db = load();
  const banners = (db.banners || []).slice().sort((a, b) => a.order - b.order);
  res.render("home", { banners });
});

// ---------- Login ----------
app.get("/login", (req, res) => {
  res.render("login", { role: req.query.role || "customer", error: null });
});

app.post("/login", (req, res) => {
  const { password, role } = req.body;
  const phone = normalizePakPhone(req.body.phone || "");
  const db = load();
  const user = db.users.find((u) => u.phone === phone && u.role === role);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render("login", { role, error: "Phone ya password ghalat hai." });
  }
  if (user.status === "blocked") {
    return res.render("login", { role, error: "Aapka account block kar diya gaya hai." });
  }
  if ((role === "shopkeeper" || role === "rider") && user.status !== "approved") {
    return res.render("login", { role, error: "Aapka account abhi admin approval ka intezaar kar raha hai." });
  }
  req.session.user = { id: user.id, name: user.name, role: user.role, phone: user.phone };
  if (role === "customer") return res.redirect("/customer/shops");
  if (role === "shopkeeper") return res.redirect("/shopkeeper/dashboard");
  if (role === "rider") return res.redirect("/rider/dashboard");
  if (role === "admin") return res.redirect("/admin/dashboard");
  res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// ---------- Signup ----------
app.get("/signup", (req, res) => {
  const db = load();
  const locations = db.locations.slice().sort((a, b) => a.name.localeCompare(b.name));
  res.render("signup", { role: req.query.role || "customer", error: null, locations });
});

app.post(
  "/signup",
  upload.fields([{ name: "profilePic" }, { name: "bikeRegPic" }, { name: "shopPic" }]),
  (req, res) => {
    const db = load();
    const { role, name, address, password, confirmPassword, shopName, shopCategory, bikeNumber, bikeRegNumber, locationId } = req.body;
    const locations = db.locations.slice().sort((a, b) => a.name.localeCompare(b.name));

    if (role === "admin") {
      return res.render("signup", { role: "customer", error: "Admin account is tarah nahi banta. Kisi mojooda admin se rabta karein.", locations });
    }

    // Pakistani phone number hona zaroori hai
    if (!isValidPakPhone(req.body.phone)) {
      return res.render("signup", { role, error: "Sahi Pakistani phone number likhein (masalan: 03xxxxxxxxx).", locations });
    }
    const phone = normalizePakPhone(req.body.phone);

    // Password kam se kam 6 hindse ka aur strong (letter + number) hona zaroori hai
    if (!isStrongPassword(password)) {
      return res.render("signup", { role, error: "Password kam se kam 6 hindson ka ho aur us mein letters aur numbers dono shamil hon.", locations });
    }
    if (password !== confirmPassword) {
      return res.render("signup", { role, error: "Password aur Confirm Password match nahi karte.", locations });
    }

    if (db.users.find((u) => u.phone === phone && u.role === role)) {
      return res.render("signup", { role, error: "Yeh phone number pehle se registered hai.", locations });
    }

    // Location sirf admin ki banayi hui list se choose ki ja sakti hai, khud nayi add nahi ki ja sakti
    const location = db.locations.find((l) => l.id == locationId);
    if (!location) {
      return res.render("signup", { role, error: "List mein se apni location select karna zaroori hai.", locations });
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
      status: role === "customer" || role === "admin" ? "approved" : "pending",
    };

    if (role === "rider") {
      newUser.bikeNumber = bikeNumber;
      newUser.bikeRegNumber = bikeRegNumber;
      newUser.profilePic = req.files.profilePic ? "/uploads/" + req.files.profilePic[0].filename : null;
      newUser.bikeRegPic = req.files.bikeRegPic ? "/uploads/" + req.files.bikeRegPic[0].filename : null;
    }

    db.users.push(newUser);

    if (role === "shopkeeper") {
      const shopId = nextId(db, "shop");
      db.shops.push({
        id: shopId,
        ownerId: id,
        name: shopName,
        category: (shopCategory || "").trim(),
        address,
        phone,
        locationId: location.id,
        locationName: location.name,
        pic: req.files.shopPic ? "/uploads/" + req.files.shopPic[0].filename : null,
        reviews: [],
        acceptCOD: true,
        acceptJazzCash: false,
        acceptEasyPaisa: false,
        jazzcashNumber: "",
        easypaisaNumber: "",
      });
    }

    save(db);

    if (role === "customer") {
      req.session.user = { id, name, role, phone };
      return res.redirect("/customer/shops");
    }
    res.render("signup_done", { role });
  }
);

// ---------- Forgot Password (OTP) ----------
app.get("/forgot", (req, res) => {
  res.render("forgot", { step: "phone", role: req.query.role || "customer", error: null, otpDemo: null });
});

app.post("/forgot/send-otp", (req, res) => {
  const { role } = req.body;
  const db = load();
  if (!isValidPakPhone(req.body.phone)) {
    return res.render("forgot", { step: "phone", role, error: "Sahi Pakistani phone number likhein (masalan: 03xxxxxxxxx).", otpDemo: null });
  }
  const phone = normalizePakPhone(req.body.phone);
  const user = db.users.find((u) => u.phone === phone && u.role === role);
  if (!user) {
    return res.render("forgot", { step: "phone", role, error: "Yeh phone number kisi account se linked nahi hai.", otpDemo: null });
  }
  const otp = genOtp();
  db.otps[phone + "_" + role] = otp;
  save(db);
  // NOTE: real SMS gateway nahi hai, isliye OTP yahan screen par demo ke taur par dikhaya ja raha hai
  res.render("forgot", { step: "otp", role, phone, error: null, otpDemo: otp });
});

app.post("/forgot/reset", (req, res) => {
  const { phone, role, otp, newPassword, confirmNewPassword } = req.body;
  const db = load();
  const key = phone + "_" + role;
  if (db.otps[key] !== otp) {
    return res.render("forgot", { step: "otp", role, phone, error: "OTP ghalat hai.", otpDemo: db.otps[key] });
  }
  if (!isStrongPassword(newPassword)) {
    return res.render("forgot", { step: "otp", role, phone, error: "Password kam se kam 6 hindson ka ho aur us mein letters aur numbers dono shamil hon.", otpDemo: db.otps[key] });
  }
  if (newPassword !== confirmNewPassword) {
    return res.render("forgot", { step: "otp", role, phone, error: "Password aur Confirm Password match nahi karte.", otpDemo: db.otps[key] });
  }
  const user = db.users.find((u) => u.phone === phone && u.role === role);
  user.password = bcrypt.hashSync(newPassword, 8);
  delete db.otps[key];
  save(db);
  res.render("login", { role, error: "Password successfully change ho gaya, ab login karein." });
});

// ---------- Forgot Phone Number (Username) ----------
// Real SMS/email gateway nahi hai, isliye is app ke demo-style ke mutabiq
// naam + role match kar ke masked phone number dikha diya jata hai.
app.get("/forgot-username", (req, res) => {
  res.render("forgot_username", { role: req.query.role || "customer", error: null, matches: null });
});

app.post("/forgot-username", (req, res) => {
  const { role, name } = req.body;
  const db = load();
  const typed = (name || "").trim().toLowerCase();
  if (!typed) {
    return res.render("forgot_username", { role, error: "Apna registered naam likhein.", matches: null });
  }
  const found = db.users.filter((u) => u.role === role && u.name.trim().toLowerCase() === typed);
  if (found.length === 0) {
    return res.render("forgot_username", { role, error: "Is naam se is role mein koi account nahi mila.", matches: null });
  }
  const matches = found.map((u) => ({ name: u.name, maskedPhone: maskPhone(u.phone) }));
  res.render("forgot_username", { role, error: null, matches });
});

// ================= CUSTOMER =================
app.get("/customer/shops", requireLogin("customer"), (req, res) => {
  const db = load();
  const approvedShopkeepers = db.users.filter((u) => u.role === "shopkeeper" && u.status === "approved").map((u) => u.id);
  let shops = db.shops.filter((s) => approvedShopkeepers.includes(s.ownerId));

  // Location ke hisaab se filter (agar select kiya gaya ho)
  const selectedLocation = req.query.locationId || "";
  if (selectedLocation) shops = shops.filter((s) => s.locationId == selectedLocation);

  // Sirf un locations ki list dikhayein jahan koi shop maujood hai
  const shopLocationIds = new Set(db.shops.map((s) => s.locationId));
  const locations = db.locations
    .filter((l) => shopLocationIds.has(l.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  res.render("customer_shops", { shops, locations, selectedLocation });
});

app.get("/customer/shop/:id", requireLogin("customer"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.id == req.params.id);
  const items = db.products.filter((p) => p.shopId == req.params.id);
  res.render("customer_products", { shop, items });
});

app.post("/customer/cart/add", requireLogin("customer"), (req, res) => {
  const db = load();
  const { productId, shopId } = req.body;
  const product = db.products.find((p) => p.id == productId);
  // Out-of-stock product tokri mein add nahi hoga
  if (product && product.inStock === false) {
    return res.redirect("/customer/shop/" + shopId);
  }
  if (!req.session.cart) req.session.cart = {};
  req.session.cart[productId] = (req.session.cart[productId] || 0) + 1;
  res.redirect("/customer/shop/" + shopId);
});

app.get("/customer/cart", requireLogin("customer"), (req, res) => {
  const db = load();
  const cart = req.session.cart || {};
  const items = Object.keys(cart).map((pid) => {
    const p = db.products.find((pr) => pr.id == pid);
    const price = effectivePrice(p);
    return { ...p, price, lineTotal: price * cart[pid], qty: cart[pid] };
  });
  const total = items.reduce((s, i) => s + i.lineTotal, 0);
  // Cart mein hamesha ek hi shop ke products hote hain, isliye pehli item se shop nikal lete hain
  // (taake checkout par usi shop ka apna JazzCash/EasyPaisa number dikha sakein).
  const shop = items.length > 0 ? db.shops.find((s) => s.id === items[0].shopId) : null;
  res.render("customer_cart", { items, total, shop, error: null });
});

app.post("/customer/cart/update", requireLogin("customer"), (req, res) => {
  const { productId, action } = req.body;
  if (!req.session.cart) req.session.cart = {};
  if (action === "inc") req.session.cart[productId] = (req.session.cart[productId] || 0) + 1;
  if (action === "dec") {
    req.session.cart[productId] = (req.session.cart[productId] || 1) - 1;
    if (req.session.cart[productId] <= 0) delete req.session.cart[productId];
  }
  if (action === "remove") delete req.session.cart[productId];
  res.redirect("/customer/cart");
});

app.post("/customer/order", requireLogin("customer"), (req, res) => {
  const db = load();
  const cart = req.session.cart || {};
  const ids = Object.keys(cart);
  if (ids.length === 0) return res.redirect("/customer/cart");

  const paymentMethod = req.body.paymentMethod;
  const transactionId = (req.body.transactionId || "").trim();
  const shopId = db.products.find((p) => p.id == ids[0]).shopId;
  const shop = db.shops.find((s) => s.id === shopId);

  const rebuildCart = () => {
    const items = ids.map((pid) => {
      const p = db.products.find((pr) => pr.id == pid);
      const price = effectivePrice(p);
      return { ...p, price, lineTotal: price * cart[pid], qty: cart[pid] };
    });
    const total = items.reduce((s, i) => s + i.lineTotal, 0);
    return { items, total };
  };

  // Shop ne yeh payment method accept hi nahi ki hui
  const methodAccepted =
    (paymentMethod === "COD" && shop && shop.acceptCOD) ||
    (paymentMethod === "JazzCash" && shop && shop.acceptJazzCash) ||
    (paymentMethod === "EasyPaisa" && shop && shop.acceptEasyPaisa);
  if (!methodAccepted) {
    const { items, total } = rebuildCart();
    return res.render("customer_cart", {
      items,
      total,
      shop,
      error: "Yeh payment method is shop par available nahi hai.",
    });
  }

  // Online payments (seedha shopkeeper ke account mein) — Transaction ID likhna zaroori hai
  if ((paymentMethod === "JazzCash" || paymentMethod === "EasyPaisa") && !transactionId) {
    const { items, total } = rebuildCart();
    return res.render("customer_cart", {
      items,
      total,
      shop,
      error: "Online payment ke liye Transaction ID likhna zaroori hai. Pehle shopkeeper ke number par payment karein, phir Transaction ID daal kar order bhejein.",
    });
  }

  const items = ids.map((pid) => {
    const p = db.products.find((pr) => pr.id == pid);
    return { productId: p.id, name: p.name, unit: p.unit || "", price: effectivePrice(p), qty: cart[pid] };
  });
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const riderCommission = Math.round((total * db.settings.riderCommissionPercent) / 100);
  const adminCommission = Math.round((total * db.settings.adminCommissionPercent) / 100);
  const commission = riderCommission + adminCommission; // dono commissions ka majmua
  const payoutAmount = total - commission; // shopkeeper ka apna hissa (JazzCash/EasyPaisa mein yeh seedha shopkeeper ke paas rehta hai)
  const directPayment = paymentMethod !== "COD"; // JazzCash/EasyPaisa: customer seedha shopkeeper ko bhejta hai

  const order = {
    id: nextId(db, "order"),
    customerId: req.session.user.id,
    customerName: req.body.name,
    customerAddress: req.body.address,
    customerPhone: req.body.phone,
    shopId,
    items,
    total,
    riderCommission,
    adminCommission,
    commission, // riderCommission + adminCommission
    payoutAmount, // total - commission = shopkeeper ka hissa
    payoutSent: false, // COD ke case mein admin ne shopkeeper ko amount bheja ya nahi
    payoutSentAt: null,
    riderPayoutSent: false, // admin ne rider ko uska commission bheja ya nahi
    riderPayoutSentAt: null,
    paymentMethod,
    transactionId: req.body.transactionId || null,
    directPayment, // true = customer ne seedha shopkeeper ke JazzCash/EasyPaisa account mein paisay bheje
    paymentVerified: paymentMethod === "COD", // COD ko verification nahi chahiye; direct payment shopkeeper khud verify karega
    // Direct payment orders mein shopkeeper commission (rider + admin) khud admin ko wapas bhejta hai
    commissionSent: false,
    commissionSentAt: null,
    commissionTransactionId: null,
    commissionReceived: false,
    commissionReceivedAt: null,
    status: "pending", // pending -> confirmed -> assigned -> picked -> delivered
    riderId: null,
    createdAt: new Date().toISOString(),
    log: [{ status: "pending", at: new Date().toISOString() }],
  };
  db.orders.push(order);
  save(db);
  req.session.cart = {};
  res.render("order_placed", { order, shop });
});

app.get("/customer/orders", requireLogin("customer"), (req, res) => {
  const db = load();
  const orders = db.orders.filter((o) => o.customerId === req.session.user.id).reverse();
  res.render("customer_orders", { orders });
});

// Customer sirf pending ya confirmed order cancel kar sakta hai (rider assign hone se pehle)
app.post("/customer/order/:id/cancel", requireLogin("customer"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id && o.customerId === req.session.user.id);
  if (order && ["pending", "confirmed"].includes(order.status)) {
    order.status = "cancelled";
    order.log.push({ status: "cancelled by customer", at: new Date().toISOString() });
    save(db);
  }
  res.redirect("/customer/orders");
});

// Customer delivered order par shop ko rating & review de sakta hai (ek hi baar)
app.post("/customer/order/:id/review", requireLogin("customer"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id && o.customerId === req.session.user.id);
  if (order && order.status === "delivered" && !order.rated) {
    const shop = db.shops.find((s) => s.id === order.shopId);
    const stars = Math.min(5, Math.max(1, parseInt(req.body.stars) || 5));
    if (shop) {
      if (!shop.reviews) shop.reviews = [];
      shop.reviews.push({
        orderId: order.id,
        customerId: req.session.user.id,
        customerName: order.customerName,
        stars,
        review: (req.body.review || "").trim(),
        at: new Date().toISOString(),
      });
    }
    order.rated = true;
    save(db);
  }
  res.redirect("/customer/orders");
});

// ================= SHOPKEEPER =================
app.get("/shopkeeper/dashboard", requireLogin("shopkeeper"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.ownerId === req.session.user.id);
  const orders = shop ? db.orders.filter((o) => o.shopId === shop.id).reverse() : [];
  const riders = db.users.filter((u) => u.role === "rider" && u.status === "approved");
  res.render("shopkeeper_dashboard", { shop, orders, riders });
});

app.get("/shopkeeper/products", requireLogin("shopkeeper"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.ownerId === req.session.user.id);
  const items = shop ? db.products.filter((p) => p.shopId === shop.id) : [];
  res.render("shopkeeper_products", { shop, items, error: null, success: null });
});

// Shopkeeper apni shop ke accepted payment methods aur apna JazzCash/EasyPaisa number set karta hai —
// customer isi number par seedha payment karega.
app.post("/shopkeeper/payment-settings", requireLogin("shopkeeper"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.ownerId === req.session.user.id);
  const items = shop ? db.products.filter((p) => p.shopId === shop.id) : [];
  if (!shop) return res.redirect("/shopkeeper/products");

  const acceptJazzCash = req.body.acceptJazzCash === "on";
  const acceptEasyPaisa = req.body.acceptEasyPaisa === "on";
  const jazzcashNumber = (req.body.jazzcashNumber || "").trim();
  const easypaisaNumber = (req.body.easypaisaNumber || "").trim();

  if (acceptJazzCash && !isValidPakPhone(jazzcashNumber)) {
    return res.render("shopkeeper_products", { shop, items, success: null, error: "JazzCash accept karne ke liye sahi Pakistani number likhein." });
  }
  if (acceptEasyPaisa && !isValidPakPhone(easypaisaNumber)) {
    return res.render("shopkeeper_products", { shop, items, success: null, error: "EasyPaisa accept karne ke liye sahi Pakistani number likhein." });
  }

  shop.acceptCOD = req.body.acceptCOD === "on";
  shop.acceptJazzCash = acceptJazzCash;
  shop.acceptEasyPaisa = acceptEasyPaisa;
  shop.jazzcashNumber = acceptJazzCash ? normalizePakPhone(jazzcashNumber) : shop.jazzcashNumber;
  shop.easypaisaNumber = acceptEasyPaisa ? normalizePakPhone(easypaisaNumber) : shop.easypaisaNumber;
  save(db);
  res.render("shopkeeper_products", { shop, items, error: null, success: "Payment settings update ho gayin." });
});

app.post("/shopkeeper/products/add", requireLogin("shopkeeper"), upload.single("pic"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.ownerId === req.session.user.id);
  db.products.push({
    id: nextId(db, "product"),
    shopId: shop.id,
    name: req.body.name,
    price: parseFloat(req.body.price),
    discount: req.body.discount ? Math.min(100, Math.max(0, parseFloat(req.body.discount))) : 0,
    unit: req.body.unit || "",
    pic: req.file ? "/uploads/" + req.file.filename : null,
    inStock: req.body.inStock === "on",
  });
  save(db);
  res.redirect("/shopkeeper/products");
});

app.post("/shopkeeper/products/:id/update", requireLogin("shopkeeper"), upload.single("pic"), (req, res) => {
  const db = load();
  const product = db.products.find((p) => p.id == req.params.id);
  if (product) {
    product.name = req.body.name;
    product.price = parseFloat(req.body.price);
    product.discount = req.body.discount ? Math.min(100, Math.max(0, parseFloat(req.body.discount))) : 0;
    product.unit = req.body.unit || "";
    product.inStock = req.body.inStock === "on";
    if (req.file) product.pic = "/uploads/" + req.file.filename;
  }
  save(db);
  res.redirect("/shopkeeper/products");
});

app.post("/shopkeeper/products/:id/delete", requireLogin("shopkeeper"), (req, res) => {
  const db = load();
  db.products = db.products.filter((p) => p.id != req.params.id);
  save(db);
  res.redirect("/shopkeeper/products");
});

// Direct payment (JazzCash/EasyPaisa) order ka Transaction ID shopkeeper apne account mein check kar ke khud verify karta hai
app.post("/shopkeeper/order/:id/verify-payment", requireLogin("shopkeeper"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.ownerId === req.session.user.id);
  const order = db.orders.find((o) => o.id == req.params.id && shop && o.shopId === shop.id);
  if (order && order.directPayment && !order.paymentVerified) {
    order.paymentVerified = true;
    order.log.push({ status: "payment verified by shopkeeper", at: new Date().toISOString() });
    save(db);
  }
  res.redirect("/shopkeeper/dashboard");
});

// Delivery ke baad, direct payment orders mein shopkeeper apna wasool kiya hua commission
// (rider + admin ka hissa) admin ke JazzCash/EasyPaisa number par khud bhejta hai aur Transaction ID darj karta hai
app.post("/shopkeeper/order/:id/send-commission", requireLogin("shopkeeper"), (req, res) => {
  const db = load();
  const shop = db.shops.find((s) => s.ownerId === req.session.user.id);
  const order = db.orders.find((o) => o.id == req.params.id && shop && o.shopId === shop.id);
  const transactionId = (req.body.transactionId || "").trim();
  if (order && order.directPayment && order.status === "delivered" && !order.commissionSent && transactionId) {
    order.commissionSent = true;
    order.commissionSentAt = new Date().toISOString();
    order.commissionTransactionId = transactionId;
    order.log.push({ status: `shopkeeper ne admin ko commission bheja (Rs. ${order.commission}, TxID: ${transactionId})`, at: order.commissionSentAt });
    save(db);
  }
  res.redirect("/shopkeeper/dashboard");
});

app.post("/shopkeeper/order/:id/confirm", requireLogin("shopkeeper"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  if (!order || !order.paymentVerified) {
    // Order na mile ya admin ne payment abhi verify na ki ho to confirm nahi ho sakta
    return res.redirect("/shopkeeper/dashboard");
  }
  order.status = "confirmed";
  order.log.push({ status: "confirmed", at: new Date().toISOString() });
  save(db);
  res.redirect("/shopkeeper/dashboard");
});

app.post("/shopkeeper/order/:id/assign", requireLogin("shopkeeper"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  order.riderId = parseInt(req.body.riderId);
  order.status = "assigned";
  order.log.push({ status: "assigned", at: new Date().toISOString() });
  save(db);
  res.redirect("/shopkeeper/dashboard");
});

// ================= RIDER =================
app.get("/rider/dashboard", requireLogin("rider"), (req, res) => {
  const db = load();
  const orders = db.orders.filter((o) => o.riderId === req.session.user.id).reverse();
  const enriched = orders.map((o) => ({ ...o, shop: db.shops.find((s) => s.id === o.shopId) }));

  // Jab tak order deliver nahi hota, tab tak top par alag reminder mein dikhana hai
  const pendingDeliveries = enriched.filter((o) => o.status !== "delivered" && o.status !== "cancelled");

  // Rider ka apna commission report — sirf delivered orders par (paid vs pending)
  const deliveredOrders = enriched.filter((o) => o.status === "delivered");
  const paidCommission = deliveredOrders
    .filter((o) => o.riderPayoutSent)
    .reduce((s, o) => s + (o.riderCommission || 0), 0);
  const pendingCommission = deliveredOrders
    .filter((o) => !o.riderPayoutSent)
    .reduce((s, o) => s + (o.riderCommission || 0), 0);

  res.render("rider_dashboard", { orders: enriched, pendingDeliveries, paidCommission, pendingCommission });
});

app.post("/rider/order/:id/pickup", requireLogin("rider"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  order.status = "picked";
  order.log.push({ status: "picked", at: new Date().toISOString() });
  save(db);
  res.redirect("/rider/dashboard");
});

app.post("/rider/order/:id/deliver", requireLogin("rider"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  order.status = "delivered";
  order.log.push({ status: "delivered", at: new Date().toISOString() });
  save(db);
  res.redirect("/rider/dashboard");
});

// ================= ADMIN =================
app.get("/admin/dashboard", requireLogin("admin"), (req, res) => {
  const db = load();
  const stats = {
    customers: db.users.filter((u) => u.role === "customer").length,
    shopkeepers: db.users.filter((u) => u.role === "shopkeeper").length,
    riders: db.users.filter((u) => u.role === "rider").length,
    pendingApprovals: db.users.filter((u) => (u.role === "shopkeeper" || u.role === "rider") && u.status === "pending").length,
    totalOrders: db.orders.length,
    delivered: db.orders.filter((o) => o.status === "delivered").length,
  };
  res.render("admin_dashboard", { stats });
});

app.get("/admin/users", requireLogin("admin"), (req, res) => {
  const db = load();
  const activeRole = ["customer", "shopkeeper", "rider"].includes(req.query.role) ? req.query.role : "all";
  let users = db.users
    .filter((u) => u.role !== "admin")
    .map((u) => ({
      ...u,
      shop: u.role === "shopkeeper" ? db.shops.find((s) => s.ownerId === u.id) : null,
    }));
  if (activeRole !== "all") users = users.filter((u) => u.role === activeRole);

  const counts = {
    all: db.users.filter((u) => u.role !== "admin").length,
    customer: db.users.filter((u) => u.role === "customer").length,
    shopkeeper: db.users.filter((u) => u.role === "shopkeeper").length,
    rider: db.users.filter((u) => u.role === "rider").length,
  };

  res.render("admin_users", { users, activeRole, counts });
});

app.post("/admin/user/:id/approve", requireLogin("admin"), (req, res) => {
  const db = load();
  const user = db.users.find((u) => u.id == req.params.id);
  user.status = "approved";
  save(db);
  res.redirect("/admin/users");
});

app.post("/admin/user/:id/block", requireLogin("admin"), (req, res) => {
  const db = load();
  const user = db.users.find((u) => u.id == req.params.id);
  user.status = "blocked";
  save(db);
  res.redirect("/admin/users");
});

app.get("/admin/orders", requireLogin("admin"), (req, res) => {
  const db = load();
  const orders = db.orders
    .map((o) => ({
      ...o,
      shop: db.shops.find((s) => s.id === o.shopId),
      rider: db.users.find((u) => u.id === o.riderId),
    }))
    .reverse();
  res.render("admin_orders", { orders });
});

// Customer ki online payment (JazzCash/EasyPaisa) sirf admin verify karta hai
app.post("/admin/order/:id/verify-payment", requireLogin("admin"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  if (order) {
    order.paymentVerified = true;
    order.log.push({ status: "payment verified by admin", at: new Date().toISOString() });
    save(db);
  }
  res.redirect("/admin/orders");
});

// Direct payment (JazzCash/EasyPaisa) orders mein shopkeeper ka bheja hua commission admin
// apne account mein check kar ke receive confirm karta hai
app.post("/admin/order/:id/confirm-commission", requireLogin("admin"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  if (order && order.commissionSent && !order.commissionReceived) {
    order.commissionReceived = true;
    order.commissionReceivedAt = new Date().toISOString();
    order.log.push({ status: "commission admin ne receive confirm ki", at: order.commissionReceivedAt });
    save(db);
  }
  res.redirect("/admin/orders");
});

// Delivery ke baad, commission kaat kar bacha hua amount (payoutAmount) shopkeeper ko admin khud bhejta hai
app.post("/admin/order/:id/send-payout", requireLogin("admin"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  // Sirf COD orders ke liye — direct payment (JazzCash/EasyPaisa) mein paisa pehle se shopkeeper ke paas hota hai
  if (order && !order.directPayment && order.paymentVerified && order.status === "delivered" && !order.payoutSent) {
    order.payoutSent = true;
    order.payoutSentAt = new Date().toISOString();
    order.log.push({ status: `shopkeeper payout bheja (Rs. ${order.payoutAmount})`, at: order.payoutSentAt });
    save(db);
  }
  res.redirect("/admin/orders");
});

// Delivery ke baad, admin rider ko uska commission alag se bhejta hai
app.post("/admin/order/:id/send-rider-payout", requireLogin("admin"), (req, res) => {
  const db = load();
  const order = db.orders.find((o) => o.id == req.params.id);
  if (order && order.riderId && order.status === "delivered" && !order.riderPayoutSent) {
    order.riderPayoutSent = true;
    order.riderPayoutSentAt = new Date().toISOString();
    order.log.push({ status: `rider ko commission bheja (Rs. ${order.riderCommission})`, at: order.riderPayoutSentAt });
    save(db);
  }
  res.redirect("/admin/orders");
});

app.get("/admin/commission", requireLogin("admin"), (req, res) => {
  const db = load();
  res.render("admin_commission", {
    riderCommissionPercent: db.settings.riderCommissionPercent,
    adminCommissionPercent: db.settings.adminCommissionPercent,
  });
});

app.post("/admin/commission/rider", requireLogin("admin"), (req, res) => {
  const db = load();
  db.settings.riderCommissionPercent = parseFloat(req.body.riderCommissionPercent);
  save(db);
  res.redirect("/admin/commission");
});

app.post("/admin/commission/admin", requireLogin("admin"), (req, res) => {
  const db = load();
  db.settings.adminCommissionPercent = parseFloat(req.body.adminCommissionPercent);
  save(db);
  res.redirect("/admin/commission");
});

app.get("/admin/add-admin", requireLogin("admin"), (req, res) => {
  res.render("admin_add_admin", { error: null, success: null });
});

app.post("/admin/add-admin", requireLogin("admin"), (req, res) => {
  const db = load();
  const { name, password, confirmPassword } = req.body;
  if (!isValidPakPhone(req.body.phone)) {
    return res.render("admin_add_admin", { error: "Sahi Pakistani phone number likhein (masalan: 03xxxxxxxxx).", success: null });
  }
  const phone = normalizePakPhone(req.body.phone);
  if (!isStrongPassword(password)) {
    return res.render("admin_add_admin", { error: "Password kam se kam 6 hindson ka ho aur us mein letters aur numbers dono shamil hon.", success: null });
  }
  if (password !== confirmPassword) {
    return res.render("admin_add_admin", { error: "Password aur Confirm Password match nahi karte.", success: null });
  }
  if (db.users.find((u) => u.phone === phone && u.role === "admin")) {
    return res.render("admin_add_admin", { error: "Yeh phone number pehle se ek admin account se linked hai.", success: null });
  }
  db.users.push({
    id: nextId(db, "user"),
    role: "admin",
    name,
    phone,
    password: bcrypt.hashSync(password, 8),
    status: "approved",
  });
  save(db);
  res.render("admin_add_admin", { error: null, success: `Naya admin "${name}" ban gaya hai.` });
});

// ---------- Home Page Slider Banners (admin hi manage karta hai) ----------
app.get("/admin/banners", requireLogin("admin"), (req, res) => {
  const db = load();
  const banners = (db.banners || []).slice().sort((a, b) => a.order - b.order);
  res.render("admin_banners", { banners, error: null });
});

app.post("/admin/banners/add", requireLogin("admin"), upload.single("image"), (req, res) => {
  const db = load();
  if (!req.file) {
    const banners = (db.banners || []).slice().sort((a, b) => a.order - b.order);
    return res.render("admin_banners", { banners, error: "Slider ke liye tasveer choose karna zaroori hai." });
  }
  const maxOrder = (db.banners || []).reduce((m, b) => Math.max(m, b.order || 0), 0);
  db.banners.push({
    id: nextId(db, "banner"),
    image: "/uploads/" + req.file.filename,
    title: (req.body.title || "").trim(),
    link: (req.body.link || "").trim() || "/login?role=customer",
    order: maxOrder + 1,
  });
  save(db);
  res.redirect("/admin/banners");
});

app.post("/admin/banners/:id/delete", requireLogin("admin"), (req, res) => {
  const db = load();
  db.banners = (db.banners || []).filter((b) => b.id != req.params.id);
  save(db);
  res.redirect("/admin/banners");
});

// ---------- Locations (master list — admin hi update kar sakta hai, delete kabhi nahi) ----------
app.get("/admin/locations", requireLogin("admin"), (req, res) => {
  const db = load();
  const locations = db.locations.slice().sort((a, b) => a.name.localeCompare(b.name));
  res.render("admin_locations", { locations, error: null, success: null });
});

app.post("/admin/locations/add", requireLogin("admin"), (req, res) => {
  const db = load();
  const name = (req.body.name || "").trim();
  let error = null,
    success = null;
  if (!name) {
    error = "Location ka naam likhein.";
  } else if (db.locations.find((l) => l.name.toLowerCase() === name.toLowerCase())) {
    error = "Yeh location pehle se list mein maujood hai.";
  } else {
    db.locations.push({ id: nextId(db, "location"), name });
    save(db);
    success = `Location "${name}" add kar di gayi.`;
  }
  const locations = db.locations.slice().sort((a, b) => a.name.localeCompare(b.name));
  res.render("admin_locations", { locations, error, success });
});

app.post("/admin/locations/:id/update", requireLogin("admin"), (req, res) => {
  const db = load();
  const loc = db.locations.find((l) => l.id == req.params.id);
  const name = (req.body.name || "").trim();
  let error = null,
    success = null;
  if (!loc) {
    error = "Location nahi mili.";
  } else if (!name) {
    error = "Location ka naam khali nahi ho sakta.";
  } else {
    const oldName = loc.name;
    loc.name = name;
    // is location ka naam istemal karne wale users/shops mein bhi naam update kar dein
    db.users.forEach((u) => {
      if (u.locationId === loc.id) u.locationName = name;
    });
    db.shops.forEach((s) => {
      if (s.locationId === loc.id) s.locationName = name;
    });
    save(db);
    success = `Location "${oldName}" ka naam "${name}" kar diya gaya.`;
  }
  const locations = db.locations.slice().sort((a, b) => a.name.localeCompare(b.name));
  res.render("admin_locations", { locations, error, success });
});

// Admin ke liye daily/monthly sales report (sirf delivered orders count hote hain)
app.get("/admin/reports", requireLogin("admin"), (req, res) => {
  const db = load();
  const delivered = db.orders.filter((o) => o.status === "delivered");

  const dailyMap = {};
  const monthlyMap = {};
  delivered.forEach((o) => {
    const d = new Date(o.createdAt);
    const dayKey = d.toISOString().slice(0, 10); // YYYY-MM-DD
    const monthKey = d.toISOString().slice(0, 7); // YYYY-MM

    // NOTE: Rider ka commission is report mein jaan-boojh kar shamil nahi kiya jata —
    // wo sirf rider ke apne dashboard par (paid/pending ke saath) dikhaya jata hai.
    if (!dailyMap[dayKey]) dailyMap[dayKey] = { date: dayKey, orders: 0, total: 0, adminCommission: 0 };
    dailyMap[dayKey].orders += 1;
    dailyMap[dayKey].total += o.total;
    dailyMap[dayKey].adminCommission += o.adminCommission || 0;

    if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { month: monthKey, orders: 0, total: 0, adminCommission: 0 };
    monthlyMap[monthKey].orders += 1;
    monthlyMap[monthKey].total += o.total;
    monthlyMap[monthKey].adminCommission += o.adminCommission || 0;
  });

  const daily = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date));
  const monthly = Object.values(monthlyMap).sort((a, b) => b.month.localeCompare(a.month));

  res.render("admin_reports", { daily, monthly, totalDelivered: delivered.length });
});

// ---------- Data Backup (admin) ----------
// Live db.json hamesha data/ folder mein save hoti hai. Yahan se admin ek click mein
// us waqt ki copy data/backups/ folder mein bhi save kar sakta hai, aur wahan se download bhi.
const DATA_DIR = path.join(__dirname, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const LIVE_DB_FILE = path.join(DATA_DIR, "db.json");

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: stat.size, at: stat.mtime };
    })
    .sort((a, b) => b.at - a.at);
}

app.get("/admin/backup", requireLogin("admin"), (req, res) => {
  res.render("admin_backup", { backups: listBackups(), success: null, error: null });
});

app.post("/admin/backup/create", requireLogin("admin"), (req, res) => {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  let success = null,
    error = null;
  if (!fs.existsSync(LIVE_DB_FILE)) {
    error = "Abhi tak koi data save nahi hua.";
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `db-backup-${stamp}.json`;
    fs.copyFileSync(LIVE_DB_FILE, path.join(BACKUP_DIR, backupName));
    success = `Backup "${backupName}" data/backups folder mein save ho gaya.`;
  }
  res.render("admin_backup", { backups: listBackups(), success, error });
});

app.get("/admin/backup/download/:filename", requireLogin("admin"), (req, res) => {
  // Sirf backups folder ke andar ki file download honi chahiye (path traversal se bachne ke liye)
  const filename = path.basename(req.params.filename);
  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) return res.redirect("/admin/backup");
  res.download(filePath, filename);
});

app.post("/admin/backup/:filename/delete", requireLogin("admin"), (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(BACKUP_DIR, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.redirect("/admin/backup");
});

app.listen(PORT, () => {
  console.log(`Ghar ki Zarurat server chal raha hai: http://127.0.0.1:${PORT}`);
});
