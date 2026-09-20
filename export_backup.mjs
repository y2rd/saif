import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

const firebaseConfig = {
  apiKey: "AIzaSyB-kOYyQmty8H_d_KKEezo75MVJ6xC8uSw",
  authDomain: "haydaystore.firebaseapp.com",
  projectId: "haydaystore",
  storageBucket: "haydaystore.firebasestorage.app",
  messagingSenderId: "774896418079",
  appId: "1:774896418079:web:bf64a270db68dbec65442a",
  measurementId: "G-KB3HVNSKL4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function createBackup() {
  const backupDir = path.join(process.cwd(), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const data = {
    exportedAt: new Date().toISOString(),
    storeConfig: null,
    products: [],
    categories: [],
    coupons: [],
    topups: [],
    customers: [],
    orders: []
  };

  console.log("جاري استخراج إعدادات المتجر...");
  try {
    const sc = await getDoc(doc(db, 'settings', 'storeConfig'));
    if (sc.exists()) data.storeConfig = sc.data();
  } catch (e) {
    console.warn("تعذر جلب storeConfig:", e.message);
  }

  console.log("جاري استخراج المنتجات...");
  try {
    const sp = await getDoc(doc(db, 'store', 'products'));
    if (sp.exists()) data.products = sp.data().list || [];
  } catch (e) {
    console.warn("تعذر جلب المنتجات:", e.message);
  }

  console.log("جاري استخراج الأقسام...");
  try {
    const scat = await getDoc(doc(db, 'store', 'categories'));
    if (scat.exists()) data.categories = scat.data().list || [];
  } catch (e) {
    console.warn("تعذر جلب الأقسام:", e.message);
  }

  console.log("جاري استخراج الكوبونات...");
  try {
    const scoup = await getDoc(doc(db, 'store', 'coupons'));
    if (scoup.exists()) data.coupons = scoup.data().list || [];
  } catch (e) {
    console.warn("تعذر جلب الكوبونات:", e.message);
  }

  console.log("جاري استخراج طلبات الشحن...");
  try {
    const stopup = await getDoc(doc(db, 'store', 'topups'));
    if (stopup.exists()) data.topups = stopup.data().list || [];
  } catch (e) {
    console.warn("تعذر جلب طلبات الشحن:", e.message);
  }

  console.log("جاري استخراج العملاء...");
  try {
    const custs = await getDocs(collection(db, 'customers'));
    custs.forEach(d => data.customers.push({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("تعذر جلب العملاء:", e.message);
  }

  console.log("جاري استخراج الطلبات...");
  try {
    const ords = await getDocs(collection(db, 'orders'));
    ords.forEach(d => data.orders.push({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("تعذر جلب الطلبات:", e.message);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `firebase_full_backup_${timestamp}.json`;
  const filePath = path.join(backupDir, fileName);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

  console.log("\n==========================================");
  console.log("✅ تم حفظ النسخة الاحتياطية بنجاح في:");
  console.log(filePath);
  console.log("إحصائيات البيانات المحفوظة:");
  console.log({
    المنتجات: data.products.length,
    الأقسام: data.categories.length,
    الكوبونات: data.coupons.length,
    طلبات_الشحن: data.topups.length,
    العملاء: data.customers.length,
    الطلبات: data.orders.length
  });
  console.log("==========================================\n");
}

createBackup().catch(console.error);
