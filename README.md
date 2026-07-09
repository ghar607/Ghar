# Ghar ki Zarurat — Setup Guide (Termux)

## 1. Zip extract karein
```
cd storage/downloads
unzip ghar-ki-zarurat.zip
cd ghar-ki-zarurat
```

## 2. Node.js install karein (agar pehle se nahi hai)
```
pkg update && pkg upgrade -y
pkg install nodejs -y
```

## 3. Dependencies install karein
```
npm install
```

## 4. Server chalayein
```
npm start
```
Phir mobile browser mein open karein: **http://127.0.0.1:8080**

---

## Default Admin Login
- Phone: `03000000000`
- Password: `admin123`

Pehla kaam: admin se login karke naye shopkeeper/rider signups ko `/admin/users` page se **approve** karein — tab wo login kar sakein ge.

---

## Kya Real Hai, Kya Demo Hai (Zaroori)

- **OTP (forgot password):** Real SMS gateway (jaise paid SMS API) attach nahi hai, isliye OTP code login screen par hi dikhaya jata hai taake aap poora flow test kar sakein. Production mein isay kisi SMS provider se jorna hoga.
- **JazzCash / EasyPaisa:** Automatic payment gateway nahi hai (uske liye un companies se merchant account chahiye). Filhaal customer manual transfer karke Transaction ID likh deta hai, jo shopkeeper/admin order dekh kar verify karte hain. Cash on Delivery poori tarah kaam karta hai.
- **Data storage:** Sara data ek simple JSON file (`data/db.json`) mein save hota hai — chhote scale ke liye theek hai. Bara scale par real database (MySQL/MongoDB) chahiye hoga.
- **File uploads** (rider ki tasveer, bike registration card, shop/product pics) `public/uploads` folder mein save hoti hain.

---

## Website Ka Flow
1. Home page par 3 buttons: Customer / Shopkeeper / Rider, aur side mein Admin.
2. Har role apna login/signup/forgot-password karta hai.
3. Customer → shops dekhta hai → shop kholta hai → products dikhte hain → cart → checkout (naam, address, phone, payment method) → order shopkeeper ke pass jata hai.
4. **Payment verification (Admin karta hai):** Online payment (JazzCash/EasyPaisa) hone par **admin** transaction check kar ke verify karta hai. COD ko verification ki zaroorat nahi.
5. Shopkeeper → payment verified hone ke baad order confirm karta hai → rider assign karta hai (sirf approved riders dikhte hain).
6. Rider → pickup confirm → delivery confirm.
7. **Payout (Admin karta hai):** Order delivered ho jaye aur payment verified ho, to admin ke pass "Shopkeeper Ko Payout Bheja" button aata hai — is se pata chalta hai **Total − Commission = Shopkeeper ka hissa**, jo admin khud (JazzCash/EasyPaisa) shopkeeper ko bhejta hai aur system mein mark kar deta hai.
8. Admin → sab users approve/block kar sakta hai, sare orders full detail mein dekh sakta hai (payment verify + payout dono yahin se), aur commission percentage set kar sakta hai.

## Reset / Fresh Start
Agar sara data delete karke fresh shuru karna ho, `data/db.json` file delete kar dein — dobara server start karne par nayi file admin account ke sath ban jayegi.
