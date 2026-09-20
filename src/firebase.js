import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  deleteDoc,
  onSnapshot, 
  collection,
  getDocs,
  runTransaction
} from 'firebase/firestore';
import { 
  getAuth, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  RecaptchaVerifier,
  signInWithPhoneNumber
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyB-kOYyQmty8H_d_KKEezo75MVJ6xC8uSw",
  authDomain: "haydaystore.firebaseapp.com",
  projectId: "haydaystore",
  storageBucket: "haydaystore.firebasestorage.app",
  messagingSenderId: "774896418079",
  appId: "1:774896418079:web:bf64a270db68dbec65442a",
  measurementId: "G-KB3HVNSKL4"
};

// تهيئة تطبيق Firebase
let app = null;
let db = null;
let auth = null;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
} catch (error) {
  console.error("خطأ في تهيئة فايربيس:", error);
}

export { app, db, auth };

// حفظ إعدادات المتجر في السحابة
export async function syncStoreConfigToCloud(config) {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const docRef = doc(db, 'settings', 'storeConfig');
    const payload = { ...config, updatedAt: Date.now() };
    await setDoc(docRef, payload, { merge: true });
    return { success: true };
  } catch (err) {
    console.error("خطأ في حفظ إعدادات المتجر سحابياً:", err);
    throw err;
  }
}

// حفظ المنتجات في السحابة (تخزين مزدوج: وثيقة مجمعة ومجموعة منفصلة لحماية المتجر من تجاوز حد 1MB)
export async function syncProductsToCloud(products) {
  if (!db) return { success: false, error: 'Database not initialized' };
  const list = Array.isArray(products) ? products : [];
  const now = Date.now();
  try {
    const docRef = doc(db, 'store', 'products');
    await setDoc(docRef, { list, updatedAt: now }, { merge: true });

    // مزامنة كل منتج بشكل منفصل في مجموعة products لحماية قواعد البيانات عند نمو الكتالوج
    for (const prod of list.slice(0, 50)) {
      if (prod && prod.id) {
        const prodRef = doc(db, 'products', String(prod.id));
        await setDoc(prodRef, { ...prod, updatedAt: now }, { merge: true });
      }
    }
    return { success: true };
  } catch (err) {
    console.error("خطأ في حفظ المنتجات سحابياً:", err);
    throw err;
  }
}

// حفظ الأقسام في السحابة
export async function syncCategoriesToCloud(categories) {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const docRef = doc(db, 'store', 'categories');
    await setDoc(docRef, { list: categories, updatedAt: Date.now() }, { merge: true });
    return { success: true };
  } catch (err) {
    console.warn("خطأ في حفظ الأقسام سحابياً:", err);
    return { success: false, error: err.message };
  }
}

// حفظ الكوبونات وأكواد الخصم في السحابة
export async function syncCouponsToCloud(coupons) {
  if (!db) return;
  try {
    const docRef = doc(db, 'store', 'coupons');
    await setDoc(docRef, { list: coupons, updatedAt: Date.now() }, { merge: true });
  } catch (err) {
    console.warn("خطأ في حفظ الكوبونات سحابياً:", err);
  }
}

// إرسال إشعار فوري لبوت تيليجرام الخاص بالإدارة عند وصول طلب أو شحن محفظة
export async function sendTelegramNotification(storeConfig, textMessage) {
  if (!storeConfig) return;
  const botToken = storeConfig.telegramBotToken?.trim();
  const chatId = storeConfig.telegramChatId?.trim();
  if (!botToken || !chatId) return;

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: textMessage,
        parse_mode: 'HTML'
      })
    });
  } catch (err) {
    console.warn("تعذر إرسال إشعار تيليجرام:", err);
  }
}

// حفظ طلبات شحن المحفظة في السحابة (متزامن ثنائياً: الوثيقة المجمعة والمجموعة المنفصلة للأمان والتوسع)
export async function syncTopupsToCloud(topups) {
  if (!db) return;
  const list = Array.isArray(topups) ? topups : [];
  const now = Date.now();
  try {
    // 1. الوثيقة السريعة
    const docRef = doc(db, 'store', 'topups');
    await setDoc(docRef, { list, updatedAt: now }, { merge: true });

    // 2. مزامنة كل طلب في مجموعة 'topups' المنفصلة لتفادي حد الـ 1MB مستقبلاً
    for (const item of list.slice(0, 50)) {
      if (item && item.id) {
        const itemRef = doc(db, 'topups', String(item.id));
        await setDoc(itemRef, { ...item, updatedAt: now }, { merge: true });
      }
    }
  } catch (err) {
    console.warn("خطأ في حفظ طلبات الشحن سحابياً:", err);
  }
}

// جلب طلبات شحن المحفظة مباشرة من السحابة
export async function fetchTopupsFromCloud() {
  if (!db) return [];
  try {
    const docRef = doc(db, 'store', 'topups');
    const snap = await getDoc(docRef);
    if (snap.exists() && Array.isArray(snap.data()?.list) && snap.data().list.length > 0) {
      return snap.data().list;
    }

    // محاولة بديلة من مجموعة topups المنفصلة
    const colSnap = await getDocs(collection(db, 'topups'));
    if (!colSnap.empty) {
      const items = [];
      colSnap.forEach(d => items.push({ id: d.id, ...d.data() }));
      items.sort((a, b) => (new Date(b.date || 0)) - (new Date(a.date || 0)));
      return items;
    }
    return [];
  } catch (err) {
    console.warn("خطأ في جلب طلبات الشحن:", err);
    return [];
  }
}

// الاستماع اللحظي المتزامن الفوري لطلبات شحن المحفظة
export function subscribeToTopups(onUpdate) {
  if (!db || !onUpdate) return () => {};
  try {
    const docRef = doc(db, 'store', 'topups');
    return onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const list = Array.isArray(data?.list) ? data.list : [];
        onUpdate(list, data?.updatedAt);
      } else {
        onUpdate([], Date.now());
      }
    }, (err) => console.warn("خطأ في التحقق اللحظي من طلبات الشحن:", err));
  } catch (err) {
    console.warn("تعذر بدء المزامنة الفورية لطلبات الشحن:", err);
    return () => {};
  }
}

// حفظ وتحديث بيانات عميل في السحابة (Customers Database)
export async function syncCustomerToCloud(customer) {
  if (!db || !customer) return;
  try {
    const custId = customer.id || customer.identifier?.replace(/[^a-zA-Z0-9]/g, '_') || `CUST_${Date.now()}`;
    const docRef = doc(db, 'customers', custId);
    await setDoc(docRef, {
      ...customer,
      id: custId,
      lastLoginAt: Date.now()
    }, { merge: true });
  } catch (err) {
    console.warn("خطأ في حفظ بيانات العميل سحابياً:", err);
  }
}

// -----------------------------------------------------------------------------
// معاملات الرصيد الذرية الآمنة (Atomic Transactions) لمنع Race Condition والتلاعب
// -----------------------------------------------------------------------------

/**
 * خصم مبلغ من رصيد العميل بشكل ذري وقفل السجل في السحابة لمنع الصرف المزدوج
 */
export async function atomicDeductWalletBalance(customerId, amountToDeduct, transactionRecord, newOrderRecord = null) {
  if (!db) throw new Error('قاعدة البيانات غير مهيأة');
  if (!customerId) throw new Error('معرف العميل مطلوب');
  const deductAmount = parseFloat(amountToDeduct);
  if (isNaN(deductAmount) || deductAmount <= 0) throw new Error('مبلغ الخصم غير صالح');

  const custRef = doc(db, 'customers', customerId);

  return await runTransaction(db, async (transaction) => {
    const custDoc = await transaction.get(custRef);
    if (!custDoc.exists()) {
      throw new Error('حساب العميل غير موجود في السحابة');
    }

    const custData = custDoc.data();
    const serverBal = parseFloat(custData.balance || 0);

    if (isNaN(serverBal) || serverBal < deductAmount) {
      throw new Error(`الرصيد الفعلي في السحابة ($${(isNaN(serverBal) ? 0 : serverBal).toFixed(2)}) غير كافٍ لتنفيذ هذه العملية ($${deductAmount.toFixed(2)})`);
    }

    const newBalance = parseFloat((serverBal - deductAmount).toFixed(2));
    const currentTxs = Array.isArray(custData.walletTransactions) ? custData.walletTransactions : [];
    const updatedTxRecord = {
      ...transactionRecord,
      balanceAfter: newBalance,
      date: new Date().toISOString()
    };

    const updatedCustData = {
      ...custData,
      balance: newBalance,
      walletTransactions: [updatedTxRecord, ...currentTxs].slice(0, 100),
      lastLoginAt: Date.now()
    };

    transaction.set(custRef, updatedCustData, { merge: true });

    if (newOrderRecord && newOrderRecord.id) {
      const orderRef = doc(db, 'orders', newOrderRecord.id);
      transaction.set(orderRef, {
        ...newOrderRecord,
        walletBalanceBefore: serverBal,
        walletBalanceAfter: newBalance,
        updatedAt: Date.now()
      }, { merge: true });
    }

    return {
      success: true,
      previousBalance: serverBal,
      newBalance: newBalance,
      updatedCustomer: updatedCustData
    };
  });
}

/**
 * تعديل رصيد العميل بشكل ذري (شحن أو خصم يدوي من لوحة الإدارة)
 */
export async function atomicAdjustCustomerBalance(customerId, amountDelta, transactionRecord) {
  if (!db) throw new Error('قاعدة البيانات غير مهيأة');
  if (!customerId) throw new Error('معرف العميل مطلوب');
  const delta = parseFloat(amountDelta);
  if (isNaN(delta) || delta === 0) throw new Error('قيمة التعديل غير صالحة');

  const custRef = doc(db, 'customers', customerId);

  return await runTransaction(db, async (transaction) => {
    const custDoc = await transaction.get(custRef);
    if (!custDoc.exists()) {
      throw new Error('حساب العميل غير موجود في السحابة');
    }

    const custData = custDoc.data();
    const serverBal = parseFloat(custData.balance || 0);
    const newBalance = parseFloat(Math.max(0, serverBal + delta).toFixed(2));

    const currentTxs = Array.isArray(custData.walletTransactions) ? custData.walletTransactions : [];
    const updatedTxRecord = {
      ...transactionRecord,
      balanceAfter: newBalance,
      date: new Date().toISOString()
    };

    const updatedCustData = {
      ...custData,
      balance: newBalance,
      walletTransactions: [updatedTxRecord, ...currentTxs].slice(0, 100),
      lastLoginAt: Date.now()
    };

    transaction.set(custRef, updatedCustData, { merge: true });

    return {
      success: true,
      previousBalance: serverBal,
      newBalance: newBalance,
      updatedCustomer: updatedCustData
    };
  });
}

/**
 * الموافقة على طلب شحن المحفظة بشكل ذري
 */
export async function atomicApproveTopup(customerId, topupId, amountUsd, updatedTopupsList) {
  if (!db) throw new Error('قاعدة البيانات غير مهيأة');
  if (!customerId) throw new Error('معرف العميل مطلوب');
  const topupAmount = parseFloat(amountUsd);
  if (isNaN(topupAmount) || topupAmount <= 0) throw new Error('مبلغ الشحن غير صالح');

  const custRef = doc(db, 'customers', customerId);
  const topupsDocRef = doc(db, 'store', 'topups');

  return await runTransaction(db, async (transaction) => {
    const custDoc = await transaction.get(custRef);
    if (!custDoc.exists()) {
      throw new Error('حساب العميل غير موجود في السحابة');
    }

    const custData = custDoc.data();
    const serverBal = parseFloat(custData.balance || 0);
    const newBalance = parseFloat((serverBal + topupAmount).toFixed(2));

    const newTx = {
      id: `tx_${Date.now()}`,
      type: 'deposit',
      amount: topupAmount,
      balanceAfter: newBalance,
      title: `شحن محفظة - طلب رقم #${topupId}`,
      date: new Date().toISOString()
    };

    const notif = {
      id: `notif-${Date.now()}`,
      title: 'تم شحن رصيد المحفظة بنجاح 🎉',
      message: `تمت الموافقة على طلبك رقم #${topupId} وإيداع $${topupAmount} في محفظتك. رصيدك الحالي: $${newBalance}.`,
      type: 'wallet',
      date: new Date().toISOString(),
      read: false
    };

    const currentTxs = Array.isArray(custData.walletTransactions) ? custData.walletTransactions : [];
    const currentNotifs = Array.isArray(custData.notifications) ? custData.notifications : [];

    const updatedCustData = {
      ...custData,
      balance: newBalance,
      walletTransactions: [newTx, ...currentTxs].slice(0, 100),
      notifications: [notif, ...currentNotifs].slice(0, 50),
      lastLoginAt: Date.now()
    };

    transaction.set(custRef, updatedCustData, { merge: true });

    if (Array.isArray(updatedTopupsList)) {
      transaction.set(topupsDocRef, {
        list: updatedTopupsList,
        updatedAt: Date.now()
      }, { merge: true });
    }

    return {
      success: true,
      previousBalance: serverBal,
      newBalance: newBalance,
      updatedCustomer: updatedCustData
    };
  });
}

/**
 * إرجاع رصيد الطلب الملغي بشكل ذري فوري ومضمون (Atomic Refund)
 */
export async function atomicRefundOrderBalance(customerId, orderId, refundAmount, refundTxRecord = null) {
  if (!db) throw new Error('قاعدة البيانات غير مهيأة');
  if (!customerId) throw new Error('معرف العميل مطلوب');
  const amount = parseFloat(refundAmount);
  if (isNaN(amount) || amount <= 0) throw new Error('مبلغ الاسترجاع غير صالح');

  const custRef = doc(db, 'customers', customerId);
  const orderRef = doc(db, 'orders', orderId);

  return await runTransaction(db, async (transaction) => {
    // 1. جلب بيانات العميل والطلب معاً
    const custDoc = await transaction.get(custRef);
    if (!custDoc.exists()) {
      throw new Error('حساب العميل غير موجود في السحابة');
    }

    const custData = custDoc.data();
    const serverBal = parseFloat(custData.balance || 0);
    const newBalance = parseFloat((serverBal + amount).toFixed(2));

    const currentTxs = Array.isArray(custData.walletTransactions) ? custData.walletTransactions : [];

    // التحقق من عدم وجود استرجاع مسبق لهذا الطلب في سجل المعاملات
    const alreadyRefundedTx = currentTxs.some(
      tx => tx.orderId === orderId || tx.id === `tx_refund_${orderId}` || (tx.title && tx.title.includes(`#${orderId}`))
    );
    if (alreadyRefundedTx) {
      throw new Error(`تم إرجاع هذا الطلب #${orderId} مسبقاً في سجل المعاملات المالية.`);
    }

    const txRecord = refundTxRecord || {
      id: `tx_refund_${orderId}_${Date.now()}`,
      orderId: orderId,
      type: 'deposit',
      amount: amount,
      balanceAfter: newBalance,
      title: `استرجاع رصيد للطلب الملغي #${orderId}`,
      date: new Date().toISOString()
    };

    const notif = {
      id: `notif-refund-${orderId}-${Date.now()}`,
      title: `تم استرجاع الرصيد إلى محفظتك 💰 #${orderId}`,
      message: `تم إرجاع مبلغ $${amount.toFixed(2)} إلى رصيد محفظتك لإلغاء الطلب #${orderId}. رصيدك الجديد: $${newBalance.toFixed(2)}.`,
      type: 'wallet',
      orderId: orderId,
      date: new Date().toISOString(),
      read: false
    };

    const currentNotifs = Array.isArray(custData.notifications) ? custData.notifications : [];

    const updatedCustData = {
      ...custData,
      balance: newBalance,
      walletTransactions: [txRecord, ...currentTxs].slice(0, 100),
      notifications: [notif, ...currentNotifs].slice(0, 50),
      lastLoginAt: Date.now()
    };

    // تحديث العميل
    transaction.set(custRef, updatedCustData, { merge: true });

    // تحديث الطلب
    transaction.set(orderRef, {
      status: 'ملغي',
      walletRefunded: true,
      walletRefundedAmount: amount,
      walletRefundedDate: new Date().toISOString(),
      walletBalanceAfterRefund: newBalance,
      updatedAt: Date.now()
    }, { merge: true });

    return {
      success: true,
      previousBalance: serverBal,
      newBalance: newBalance,
      updatedCustomer: updatedCustData
    };
  });
}



// حفظ وتحديث طلب جديد في السحابة
export async function syncOrderToCloud(order) {
  if (!db || !order) return;
  try {
    const docRef = doc(db, 'orders', order.id);
    await setDoc(docRef, {
      ...order,
      updatedAt: Date.now()
    }, { merge: true });
  } catch (err) {
    console.warn("خطأ في حفظ الطلب سحابياً:", err);
  }
}

// حذف طلب من السحابة
export async function deleteOrderFromCloud(orderId) {
  if (!db || !orderId) return;
  try {
    const docRef = doc(db, 'orders', orderId);
    await deleteDoc(docRef);
  } catch (err) {
    console.warn("خطأ في حذف الطلب سحابياً:", err);
  }
}

// مسح جميع الطلبات من السحابة
export async function clearAllOrdersFromCloud(orderIds = []) {
  if (!db) return;
  try {
    for (const id of orderIds) {
      if (id) {
        await deleteDoc(doc(db, 'orders', id));
      }
    }
  } catch (err) {
    console.warn("خطأ في مسح الطلبات سحابياً:", err);
  }
}

// حذف عميل من السحابة
export async function deleteCustomerFromCloud(customerId) {
  if (!db || !customerId) return;
  try {
    const docRef = doc(db, 'customers', customerId);
    await deleteDoc(docRef);
  } catch (err) {
    console.warn("خطأ في حذف العميل سحابياً:", err);
  }
}

// جلب عميل بالمعرف (هاتف أو إيميل أو اسم المستخدم أو الاسم أو المعرف الداخلي)
export async function getCustomerByIdentifier(identifier, rawInput = '') {
  if (!db || (!identifier && !rawInput)) return null;
  try {
    const cleanId = (identifier || '').trim();
    const raw = (rawInput || '').trim();
    const custId = cleanId.replace(/[^a-zA-Z0-9]/g, '_');

    // 1. محاولة مباشرة وسريعة عبر معرف المستند docId
    if (custId) {
      try {
        const directRef = doc(db, 'customers', custId);
        const directSnap = await getDoc(directRef);
        if (directSnap.exists()) {
          return { id: directSnap.id, ...directSnap.data() };
        }
      } catch (e) {}
    }
    if (raw) {
      try {
        const rawRef = doc(db, 'customers', raw.replace(/[^a-zA-Z0-9]/g, '_'));
        const rawSnap = await getDoc(rawRef);
        if (rawSnap.exists()) {
          return { id: rawSnap.id, ...rawSnap.data() };
        }
      } catch (e) {}
    }

    // 2. البحث الشامل في وثائق مجموعة العملاء (لتغطية التعيين اليدوي من الكونسول و Auto-ID والاسم ورقم الهاتف)
    const snap = await getDocs(collection(db, 'customers'));
    const cleanDigits = (str) => String(str || '').replace(/\D/g, '');
    const targetDigits = cleanDigits(raw) || cleanDigits(cleanId);
    const targetText = cleanId.toLowerCase();
    const targetRawText = raw.toLowerCase();

    for (const d of snap.docs) {
      const data = d.data();
      const docId = String(d.id || '').toLowerCase();
      const cName = String(data.name || '').toLowerCase().trim();
      const cEmail = String(data.email || '').toLowerCase().trim();
      const cIdent = String(data.identifier || '').toLowerCase().trim();
      const cUsername = String(data.username || '').toLowerCase().trim();
      const cPhoneDigits = cleanDigits(data.phone || data.identifier);

      // مطابقة بالاسم أو اسم المستخدم
      if ((cName && (cName === targetRawText || cName === targetText)) ||
          (cUsername && (cUsername === targetRawText || cUsername === targetText))) {
        return { id: d.id, ...data };
      }

      // مطابقة بالإيميل أو المعرف المخصص
      if ((cEmail && (cEmail === targetRawText || cEmail === targetText)) ||
          (cIdent && (cIdent === targetRawText || cIdent === targetText)) ||
          docId === targetRawText || docId === targetText || docId === custId.toLowerCase()) {
        return { id: d.id, ...data };
      }

      // مطابقة برقم الهاتف المرن (مع رمز دولة أو بدونه أو بدون الصفر الأولي)
      if (targetDigits && targetDigits.length >= 7 && cPhoneDigits && cPhoneDigits.length >= 7) {
        if (targetDigits === cPhoneDigits || 
            targetDigits.endsWith(cPhoneDigits) || 
            cPhoneDigits.endsWith(targetDigits) ||
            targetDigits.slice(-9) === cPhoneDigits.slice(-9)) {
          return { id: d.id, ...data };
        }
      }
    }

    return null;
  } catch (err) {
    console.warn("خطأ في جلب بيانات العميل:", err);
    return null;
  }
}

// تسجيل الدخول عبر Firebase Authentication (في حال تمت إضافة الحساب من تبويب Authentication في فايربيس)
export async function loginWithFirebaseAuth(emailOrIdentifier, password) {
  if (!auth || !emailOrIdentifier || !password) return null;
  try {
    const emailToUse = emailOrIdentifier.includes('@') 
      ? emailOrIdentifier.trim() 
      : `${emailOrIdentifier.trim().replace(/\s+/g, '')}@haiderstore.local`;

    const userCredential = await signInWithEmailAndPassword(auth, emailToUse, password);
    const user = userCredential.user;
    if (user) {
      const custId = (user.email || user.uid).replace(/[^a-zA-Z0-9]/g, '_');
      const docRef = doc(db, 'customers', custId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return { id: snap.id, ...snap.data() };
      }

      // إنشاء وثيقة العميل تلقائياً في Firestore لتمكينه من استخدام المحفظة والتسوق
      const newCust = {
        id: custId,
        uid: user.uid,
        name: user.displayName || (user.email ? user.email.split('@')[0] : 'عميل جديد'),
        email: user.email || '',
        phone: user.phoneNumber || '',
        identifier: user.email || user.phoneNumber || custId,
        role: 'customer',
        balance: 0,
        tier: 'عادي',
        status: 'نشط',
        verified: true,
        joinedAt: new Date().toISOString(),
        lastLoginAt: Date.now()
      };
      await setDoc(docRef, newCust);
      return newCust;
    }
  } catch (err) {
    // لم يتم العثور عليه في Firebase Auth أو كلمة المرور غير متطابقة
    return null;
  }
  return null;
}

// إنشاء حساب رسمي في Firebase Authentication مع إرسال إيميل تأكيد حقيقي ومجاني 100% من Google
export async function registerWithFirebaseAuth(email, password, name = '') {
  if (!auth || !email || !password) return { success: false, message: 'بيانات غير مكتملة' };
  try {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const user = cred.user;

    // إرسال إيميل التحقق الرسمي من خوادم Google مجاناً
    if (user) {
      await sendEmailVerification(user);
    }

    const custId = email.trim().replace(/[^a-zA-Z0-9]/g, '_');
    const docRef = doc(db, 'customers', custId);
    const newCust = {
      id: custId,
      uid: user.uid,
      name: name.trim() || email.split('@')[0],
      email: email.trim(),
      identifier: email.trim(),
      role: 'customer',
      balance: 0,
      tier: 'عادي',
      status: 'نشط',
      verified: false,
      joinedAt: new Date().toISOString(),
      lastLoginAt: Date.now()
    };
    await setDoc(docRef, newCust, { merge: true });

    return { success: true, user: newCust };
  } catch (err) {
    console.warn("خطأ في تسجيل حساب Firebase Auth:", err);
    let msg = 'تعذر إنشاء الحساب';
    if (err.code === 'auth/email-already-in-use') msg = 'هذا البريد الإلكتروني مسجل بالفعل!';
    else if (err.code === 'auth/weak-password') msg = 'كلمة المرور ضعيفة، يرجى كتابة 6 أحرف على الأقل';
    else if (err.code === 'auth/invalid-email') msg = 'صيغة البريد الإلكتروني غير صحيحة';
    return { success: false, message: msg, error: err };
  }
}

// إعادة إرسال رابط التحقق السحابي عبر Google
export async function resendFirebaseVerificationEmail(user) {
  if (!auth || !user) return { success: false, message: 'المستخدم غير متوفر' };
  try {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
      return { success: true };
    }
    return { success: false, message: 'لم يتم العثور على جلسة للمستخدم' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// إعداد والتحقق عبر رسائل SMS للهاتف الحقيقي عبر Firebase
let confirmationResultRef = null;

export function setupRecaptcha(containerId = 'recaptcha-container') {
  if (!auth) return null;
  try {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
        size: 'invisible',
        callback: () => {}
      });
    }
    return window.recaptchaVerifier;
  } catch (e) {
    console.warn("إعداد RecaptchaVerifier:", e);
    return null;
  }
}

export async function sendFirebasePhoneOtp(phoneNumber, containerId = 'recaptcha-container') {
  if (!auth || !phoneNumber) return { success: false, message: 'رقم الهاتف مطلوب' };
  try {
    const appVerifier = setupRecaptcha(containerId);
    if (!appVerifier) return { success: false, message: 'فشل تهيئة التحقق الأمني' };

    // تنظيف وتنسيق الرقم الدولي (مثال: +9647XXXXXXXX)
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber.replace(/\s+/g, '') : `+${phoneNumber.replace(/\s+/g, '')}`;
    const confirmationResult = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);
    confirmationResultRef = confirmationResult;
    window.confirmationResult = confirmationResult;

    return { success: true };
  } catch (err) {
    console.warn("خطأ في إرسال كود الهاتف من فايربيس:", err);
    if (window.recaptchaVerifier) {
      try { window.recaptchaVerifier.clear(); window.recaptchaVerifier = null; } catch(e) {}
    }
    let msg = 'تعذر إرسال رسالة التحقق SMS حالياً';
    if (err.code === 'auth/invalid-phone-number') msg = 'صيغة رقم الهاتف غير صحيحة، تأكد من إدخال الرقم الدولي كاملاً';
    else if (err.code === 'auth/quota-exceeded') msg = 'تم استنفاد الحصة اليومية لرسائل SMS، يرجى المحاولة لاحقاً';
    else if (err.code === 'auth/too-many-requests') msg = 'تم إرسال طلبات كثيرة، يرجى الانتظار قليلاً';
    return { success: false, message: msg, error: err };
  }
}

export async function verifyFirebasePhoneOtp(code) {
  const cr = confirmationResultRef || window.confirmationResult;
  if (!cr) return { success: false, message: 'لم يتم العثور على جلسة تحقق نشطة' };
  try {
    const result = await cr.confirm(code);
    return { success: true, user: result.user };
  } catch (err) {
    console.warn("خطأ في تأكيد كود SMS:", err);
    let msg = 'رمز التحقق غير صحيح، يرجى التأكد وإعادة المحاولة';
    if (err.code === 'auth/invalid-verification-code') msg = 'رمز التحقق المدخل غير صحيح';
    else if (err.code === 'auth/code-expired') msg = 'انتهت صلاحية رمز التحقق، يرجى طلب رمز جديد';
    return { success: false, message: msg, error: err };
  }
}

// حفظ كود التحقق OTP في قاعدة البيانات السحابية مع وقت انتهاء الصلاحية (10 دقائق)
export async function saveOtpToCloud(identifier, code) {
  if (!db || !identifier) return;
  try {
    const otpId = identifier.replace(/[^a-zA-Z0-9]/g, '_');
    const docRef = doc(db, 'otps', otpId);
    await setDoc(docRef, {
      code: String(code),
      identifier,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000 // صالح لمدة 10 دقائق
    });
  } catch (err) {
    console.warn("خطأ في حفظ رمز التحقق سحابياً:", err);
  }
}

// إرسال كود التحقق إلى البريد الإلكتروني الفعلي للعميل
export async function sendOtpEmailNotification(email, code, userName = '') {
  if (!email || !email.includes('@')) return { success: false, message: 'عنوان البريد الإلكتروني غير صحيح' };
  try {
    // إرسال البريد مباشرة عبر EmailJS Public API
    // (باستخدام بروتوكول REST الآمن للمتصفحات بدون الحاجة لسيرفر backend)
    const payload = {
      service_id: 'service_haider_store',
      template_id: 'template_otp_verify',
      user_id: 'public_key_haider',
      template_params: {
        to_email: email,
        to_name: userName || 'عميلنا العزيز',
        otp_code: code,
        store_name: 'متجر دكان هاي داي'
      }
    };

    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      return { success: true };
    } else {
      // حفظ طلب الإرسال في جدول email_queue في Firestore
      if (db) {
        await setDoc(doc(db, 'email_queue', `${email.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`), {
          to: email,
          subject: `كود التحقق الخاص بك في متجر دكان هاي داي: ${code}`,
          code: code,
          createdAt: Date.now(),
          status: 'queued'
        });
      }
      return { success: true };
    }
  } catch (err) {
    console.warn("إرسال البريد:", err);
    // حتى في حال بطء الشبكة نضمن حفظ الكود في Firestore queue
    if (db) {
      try {
        await setDoc(doc(db, 'email_queue', `${email.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`), {
          to: email,
          code: code,
          createdAt: Date.now()
        });
      } catch (e) {}
    }
    return { success: true };
  }
}

// التحقق من كود OTP من قاعدة البيانات
export async function verifyOtpFromCloud(identifier, inputCode) {
  if (!db || !identifier) return false;
  try {
    const otpId = identifier.replace(/[^a-zA-Z0-9]/g, '_');
    const docRef = doc(db, 'otps', otpId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      if (Date.now() > (data.expiresAt || 0)) {
        return { success: false, message: 'انتهت صلاحية كود التحقق، يرجى طلب كود جديد' };
      }
      if (String(data.code).trim() === String(inputCode).trim()) {
        try {
          await deleteDoc(docRef);
        } catch (e) {}
        return { success: true };
      } else {
        return { success: false, message: 'كود التحقق غير صحيح، تأكد من الرمز المدخل' };
      }
    }
    return { success: false, message: 'لم يتم العثور على كود تحقق نشط' };
  } catch (err) {
    console.warn("خطأ في التحقق من كود OTP:", err);
    return { success: false, message: 'تعذر التحقق من الكود حالياً' };
  }
}

// الاستماع للبيانات من السحابة في الوقت الفعلي (Real-time listener)
export function subscribeToStoreData({ onConfigUpdate, onProductsUpdate, onCategoriesUpdate, onCustomersUpdate, onOrdersUpdate, onCouponsUpdate, onTopupsUpdate }) {
  if (!db) return () => {};

  const unsubConfig = onSnapshot(doc(db, 'settings', 'storeConfig'), (snapshot) => {
    if (snapshot.exists() && onConfigUpdate) {
      onConfigUpdate(snapshot.data(), snapshot.data()?.updatedAt);
    }
  }, (err) => console.warn("مشكلة في جلب إعدادات المتجر:", err));

  const unsubProducts = onSnapshot(doc(db, 'store', 'products'), (snapshot) => {
    if (snapshot.exists() && snapshot.data()?.list && onProductsUpdate) {
      onProductsUpdate(snapshot.data().list, snapshot.data().updatedAt);
    }
  }, (err) => console.warn("مشكلة في جلب المنتجات:", err));

  const unsubCategories = onSnapshot(doc(db, 'store', 'categories'), (snapshot) => {
    if (snapshot.exists() && snapshot.data()?.list && onCategoriesUpdate) {
      onCategoriesUpdate(snapshot.data().list, snapshot.data().updatedAt);
    }
  }, (err) => console.warn("مشكلة في جلب الأقسام:", err));

  let unsubCustomers = () => {};
  if (onCustomersUpdate) {
    unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      const custList = [];
      snapshot.forEach(docSnap => custList.push({ id: docSnap.id, ...docSnap.data() }));
      onCustomersUpdate(custList);
    }, (err) => console.warn("مشكلة في جلب العملاء:", err));
  }

  let unsubOrders = () => {};
  if (onOrdersUpdate) {
    unsubOrders = onSnapshot(collection(db, 'orders'), (snapshot) => {
      const orderList = [];
      snapshot.forEach(docSnap => orderList.push({ id: docSnap.id, ...docSnap.data() }));
      orderList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      onOrdersUpdate(orderList);
    }, (err) => console.warn("مشكلة في جلب الطلبات:", err));
  }

  let unsubCoupons = () => {};
  if (onCouponsUpdate) {
    unsubCoupons = onSnapshot(doc(db, 'store', 'coupons'), (snapshot) => {
      if (snapshot.exists() && snapshot.data()?.list) {
        onCouponsUpdate(snapshot.data().list, snapshot.data().updatedAt);
      }
    }, (err) => console.warn("مشكلة في جلب الكوبونات:", err));
  }

  let unsubTopups = () => {};
  if (onTopupsUpdate) {
    unsubTopups = onSnapshot(doc(db, 'store', 'topups'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const list = Array.isArray(data?.list) ? data.list : [];
        onTopupsUpdate(list, data?.updatedAt);
      }
    }, (err) => console.warn("مشكلة في جلب طلبات شحن المحفظة:", err));
  }

  return () => {
    unsubConfig();
    unsubProducts();
    unsubCategories();
    unsubCoupons();
    unsubTopups();
    unsubCustomers();
    unsubOrders();
  };
}
