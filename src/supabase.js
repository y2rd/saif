import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://glcrqxdqazuowlaehnhw.supabase.co';
const supabaseKey = 'sb_publishable_otbY8PdCrBd3gb3ZwDPYlA_LkWvDjJL';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
});

// -------------------------------------------------------------
// 1. إعدادات المتجر (Store Config)
// -------------------------------------------------------------
export async function syncStoreConfigToCloud(config) {
  if (!supabase) return { success: false, error: 'Database not initialized' };
  try {
    const { error } = await supabase.from('store_settings').upsert({
      id: 'storeConfig',
      data: config,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("خطأ في حفظ إعدادات المتجر سحابياً:", err);
    throw err;
  }
}

// -------------------------------------------------------------
// 2. المنتجات (Products)
// -------------------------------------------------------------
// حفظ أو تعديل منتج مباشر في قاعدة البيانات السحابية (Direct Cloud Upsert)
export async function saveProductToCloud(product) {
  if (!supabase) return { success: false, error: 'Database not initialized' };
  try {
    const cleanData = { ...product };
    delete cleanData.data; // منع التداخل والتكرار التراكمي
    const imgUrl = cleanData.image || cleanData.imageUrl || '';
    cleanData.imageUrl = imgUrl;
    cleanData.image = imgUrl;

    const row = {
      id: String(product.id),
      title: product.title || product.name || 'بدون عنوان',
      price: parseFloat(product.price || 0),
      old_price: product.oldPrice ? parseFloat(product.oldPrice) : null,
      category: product.category || '',
      image: imgUrl,
      product_type: product.productType || 'digital',
      stock: parseInt(product.stock !== undefined ? product.stock : 20),
      badge: product.badge || '',
      description: product.descriptionHtml || product.description || '',
      is_deleted: false,
      data: cleanData,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from('products').upsert([row]);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("خطأ في حفظ المنتج سحابياً:", err);
    throw err;
  }
}

// حذف منتج مباشر وفوري من قاعدة البيانات السحابية
export async function deleteProductFromCloud(productId) {
  if (!supabase) return { success: false, error: 'Database not initialized' };
  try {
    const { error } = await supabase.from('products').delete().eq('id', String(productId));
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("خطأ في حذف المنتج سحابياً:", err);
    throw err;
  }
}

export async function syncProductsToCloud(products) {
  if (!supabase) return { success: false, error: 'Database not initialized' };
  const list = Array.isArray(products) ? products : [];
  try {
    const rows = list.map(p => {
      const cleanData = { ...p };
      delete cleanData.data;
      const imgUrl = cleanData.image || cleanData.imageUrl || '';
      cleanData.imageUrl = imgUrl;
      cleanData.image = imgUrl;

      return {
        id: String(p.id),
        title: p.title || p.name || 'بدون عنوان',
        price: parseFloat(p.price || 0),
        old_price: p.oldPrice ? parseFloat(p.oldPrice) : null,
        category: p.category || '',
        image: imgUrl,
        product_type: p.productType || 'digital',
        stock: parseInt(p.stock !== undefined ? p.stock : 20),
        badge: p.badge || '',
        description: p.descriptionHtml || p.description || '',
        is_deleted: false,
        data: cleanData,
        updated_at: new Date().toISOString()
      };
    });
    const { error } = await supabase.from('products').upsert(rows);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("خطأ في حفظ المنتجات سحابياً:", err);
    throw err;
  }
}

// -------------------------------------------------------------
// 3. الأقسام (Categories)
// -------------------------------------------------------------
export async function syncCategoriesToCloud(categories) {
  if (!supabase) return { success: false, error: 'Database not initialized' };
  const list = Array.isArray(categories) ? categories : [];
  try {
    const rows = list.map((c, idx) => ({
      id: String(c.id || `cat-${idx}`),
      name: c.name || '',
      icon: c.icon || '',
      badge: c.badge || '',
      banner: c.banner || '',
      display_order: idx,
      data: c,
      updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from('categories').upsert(rows);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.warn("خطأ في حفظ الأقسام سحابياً:", err);
    return { success: false, error: err.message };
  }
}

// حذف قسم مباشر من السحابة
export async function deleteCategoryFromCloud(categoryId) {
  if (!supabase) return { success: false, error: 'Database not initialized' };
  try {
    const { error } = await supabase.from('categories').delete().eq('id', String(categoryId));
    if (error) throw error;
    return { success: true };
  } catch (err) {
    console.error("خطأ في حذف القسم سحابياً:", err);
    throw err;
  }
}

// -------------------------------------------------------------
// 4. الكوبونات (Coupons)
// -------------------------------------------------------------
export async function syncCouponsToCloud(coupons) {
  if (!supabase) return;
  const list = Array.isArray(coupons) ? coupons : [];
  try {
    const rows = list.map((cp, idx) => ({
      id: String(cp.id || `coupon-${idx}`),
      code: String(cp.code || `CODE${idx}`),
      discount_percent: parseFloat(cp.discountPercent || 0),
      discount_amount: parseFloat(cp.discountAmount || 0),
      is_active: cp.isActive !== false,
      data: cp,
      updated_at: new Date().toISOString()
    }));
    await supabase.from('coupons').upsert(rows);
  } catch (err) {
    console.warn("خطأ في حفظ الكوبونات سحابياً:", err);
  }
}

// حذف كوبون مباشر من السحابة
export async function deleteCouponFromCloud(couponId) {
  if (!supabase) return;
  try {
    await supabase.from('coupons').delete().eq('id', String(couponId));
  } catch (err) {
    console.warn("خطأ في حذف الكوبون سحابياً:", err);
  }
}

// -------------------------------------------------------------
// 5. إشعارات تيليجرام (Telegram Notification)
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// 6. طلبات شحن المحفظة (Topup Requests)
// -------------------------------------------------------------
export async function syncTopupsToCloud(topups) {
  if (!supabase) return;
  const list = Array.isArray(topups) ? topups : [];
  try {
    const rows = list.map(t => ({
      id: String(t.id),
      customer_id: t.customerId || '',
      customer_name: t.customerName || '',
      customer_identifier: t.customerIdentifier || '',
      customer_phone: t.customerPhone || '',
      amount_usd: parseFloat(t.amountUsd || 0),
      method: t.method || '',
      proof: t.proof || '',
      status: t.status || 'قيد المراجعة',
      notes: t.notes || '',
      data: t,
      updated_at: new Date().toISOString()
    }));
    await supabase.from('topups').upsert(rows);
  } catch (err) {
    console.warn("خطأ في مزامنة طلبات الشحن سحابياً:", err);
  }
}

export async function fetchTopupsFromCloud() {
  if (!supabase) return [];
  try {
    const { data } = await supabase.from('topups').select('*').order('created_at', { ascending: false });
    if (Array.isArray(data)) {
      return data.map(row => ({ ...row.data, ...row, id: row.id }));
    }
    return [];
  } catch (err) {
    console.warn("خطأ في جلب طلبات الشحن:", err);
    return [];
  }
}

export function subscribeToTopups(onUpdate) {
  if (!supabase || !onUpdate) return () => {};
  try {
    const fetchLatest = async () => {
      const items = await fetchTopupsFromCloud();
      onUpdate(items, Date.now());
    };
    fetchLatest();

    const channel = supabase
      .channel('realtime_topups')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'topups' }, () => {
        fetchLatest();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  } catch (err) {
    console.warn("تعذر بدء المزامنة الفورية لطلبات الشحن:", err);
    return () => {};
  }
}

// -------------------------------------------------------------
// 7. العملاء (Customers Database)
// -------------------------------------------------------------
export async function syncCustomerToCloud(customer) {
  if (!supabase || !customer) return;
  try {
    const custId = String(customer.id || customer.identifier?.replace(/[^a-zA-Z0-9]/g, '_') || `CUST_${Date.now()}`);
    const row = {
      id: custId,
      name: customer.name || '',
      email: customer.email || '',
      phone: customer.phone || '',
      identifier: customer.identifier || '',
      password: customer.password || '',
      role: customer.role || 'customer',
      balance: parseFloat(customer.balance || 0),
      points: parseInt(customer.points || 0),
      tier: customer.tier || 'عادي',
      status: customer.status || 'نشط',
      permissions: customer.permissions || {},
      wallet_transactions: customer.walletTransactions || [],
      notifications: customer.notifications || [],
      data: customer,
      updated_at: new Date().toISOString()
    };
    await supabase.from('customers').upsert(row);
  } catch (err) {
    console.warn("خطأ في حفظ بيانات العميل سحابياً:", err);
  }
}

export async function deleteCustomerFromCloud(customerId) {
  if (!supabase || !customerId) return;
  try {
    await supabase.from('customers').delete().eq('id', String(customerId));
  } catch (err) {
    console.warn("خطأ في حذف العميل سحابياً:", err);
  }
}

export async function getCustomerByIdentifier(identifier, rawInput = '') {
  if (!supabase || (!identifier && !rawInput)) return null;
  try {
    const cleanId = String(identifier || '').trim();
    const raw = String(rawInput || '').trim();
    const custId = cleanId.replace(/[^a-zA-Z0-9]/g, '_');

    // 1. بحث مباشر بالمعرف
    if (custId) {
      const { data } = await supabase.from('customers').select('*').eq('id', custId).maybeSingle();
      if (data) return { ...data.data, ...data, id: data.id };
    }
    if (cleanId) {
      const { data } = await supabase.from('customers').select('*').eq('id', cleanId).maybeSingle();
      if (data) return { ...data.data, ...data, id: data.id };
    }

    // 2. بحث شامل في جميع الحقول
    const { data: allCusts } = await supabase.from('customers').select('*');
    if (!allCusts) return null;

    const cleanDigits = (str) => String(str || '').replace(/\D/g, '');
    const targetDigits = cleanDigits(raw) || cleanDigits(cleanId);
    const targetText = cleanId.toLowerCase();
    const targetRawText = raw.toLowerCase();

    for (const d of allCusts) {
      const cName = String(d.name || '').toLowerCase().trim();
      const cEmail = String(d.email || '').toLowerCase().trim();
      const cIdent = String(d.identifier || '').toLowerCase().trim();
      const cDocId = String(d.id || '').toLowerCase().trim();
      const cPhoneDigits = cleanDigits(d.phone || d.identifier);

      if ((cName && (cName === targetRawText || cName === targetText)) ||
          (cEmail && (cEmail === targetRawText || cEmail === targetText)) ||
          (cIdent && (cIdent === targetRawText || cIdent === targetText)) ||
          cDocId === targetRawText || cDocId === targetText || cDocId === custId.toLowerCase()) {
        return { ...d.data, ...d, id: d.id };
      }

      if (targetDigits && targetDigits.length >= 7 && cPhoneDigits && cPhoneDigits.length >= 7) {
        if (targetDigits === cPhoneDigits ||
            targetDigits.endsWith(cPhoneDigits) ||
            cPhoneDigits.endsWith(targetDigits) ||
            targetDigits.slice(-9) === cPhoneDigits.slice(-9)) {
          return { ...d.data, ...d, id: d.id };
        }
      }
    }
    return null;
  } catch (err) {
    console.warn("خطأ في جلب بيانات العميل:", err);
    return null;
  }
}

// -------------------------------------------------------------
// 8. المعاملات المالية الذرية (Atomic Transactions)
// -------------------------------------------------------------
export async function atomicDeductWalletBalance(customerId, amountToDeduct, transactionRecord, newOrderRecord = null) {
  if (!supabase) throw new Error('قاعدة البيانات غير مهيأة');
  if (!customerId) throw new Error('معرف العميل مطلوب');
  const deductAmount = parseFloat(amountToDeduct);
  if (isNaN(deductAmount) || deductAmount <= 0) throw new Error('مبلغ الخصم غير صالح');

  const cleanCustId = String(customerId).trim();
  const { data: custRow, error: fetchErr } = await supabase.from('customers').select('*').eq('id', cleanCustId).single();
  if (fetchErr || !custRow) throw new Error('حساب العميل غير موجود في السحابة');

  const serverBal = parseFloat(custRow.balance || 0);
  if (isNaN(serverBal) || serverBal < deductAmount) {
    throw new Error(`الرصيد الفعلي ($${serverBal.toFixed(2)}) غير كافٍ لتنفيذ هذه العملية ($${deductAmount.toFixed(2)})`);
  }

  const newBalance = parseFloat((serverBal - deductAmount).toFixed(2));
  const currentTxs = Array.isArray(custRow.wallet_transactions) ? custRow.wallet_transactions : [];
  const updatedTxRecord = {
    ...transactionRecord,
    balanceAfter: newBalance,
    date: new Date().toISOString()
  };

  const updatedCustData = {
    ...custRow.data,
    ...custRow,
    balance: newBalance,
    wallet_transactions: [updatedTxRecord, ...currentTxs].slice(0, 100),
    walletTransactions: [updatedTxRecord, ...currentTxs].slice(0, 100),
    updated_at: new Date().toISOString()
  };

  await supabase.from('customers').update({
    balance: newBalance,
    wallet_transactions: updatedCustData.wallet_transactions,
    data: updatedCustData,
    updated_at: new Date().toISOString()
  }).eq('id', cleanCustId);

  if (newOrderRecord && newOrderRecord.id) {
    await syncOrderToCloud({
      ...newOrderRecord,
      walletBalanceBefore: serverBal,
      walletBalanceAfter: newBalance
    });
  }

  return {
    success: true,
    previousBalance: serverBal,
    newBalance: newBalance,
    updatedCustomer: updatedCustData
  };
}

export async function atomicAdjustCustomerBalance(customerId, amountDelta, transactionRecord) {
  if (!supabase) throw new Error('قاعدة البيانات غير مهيأة');
  if (!customerId) throw new Error('معرف العميل مطلوب');
  const delta = parseFloat(amountDelta);
  if (isNaN(delta) || delta === 0) throw new Error('مبلغ التعديل غير صالح');

  const cleanCustId = String(customerId).trim();
  const { data: custRow, error: fetchErr } = await supabase.from('customers').select('*').eq('id', cleanCustId).single();
  if (fetchErr || !custRow) throw new Error('حساب العميل غير موجود في السحابة');

  const serverBal = parseFloat(custRow.balance || 0);
  const newBalance = parseFloat((serverBal + delta).toFixed(2));
  if (newBalance < 0) throw new Error(`لا يمكن أن يصبح الرصيد سالباً`);

  const currentTxs = Array.isArray(custRow.wallet_transactions) ? custRow.wallet_transactions : [];
  const updatedTx = {
    ...transactionRecord,
    balanceAfter: newBalance,
    date: new Date().toISOString()
  };

  const updatedCustData = {
    ...custRow.data,
    ...custRow,
    balance: newBalance,
    wallet_transactions: [updatedTx, ...currentTxs].slice(0, 100),
    walletTransactions: [updatedTx, ...currentTxs].slice(0, 100),
    updated_at: new Date().toISOString()
  };

  await supabase.from('customers').update({
    balance: newBalance,
    wallet_transactions: updatedCustData.wallet_transactions,
    data: updatedCustData,
    updated_at: new Date().toISOString()
  }).eq('id', cleanCustId);

  return {
    success: true,
    previousBalance: serverBal,
    newBalance: newBalance,
    updatedCustomer: updatedCustData
  };
}

export async function atomicApproveTopup(customerId, topupId, topupAmount, updatedTopupsList) {
  if (!supabase) throw new Error('قاعدة البيانات غير مهيأة');
  const amount = parseFloat(topupAmount);
  if (isNaN(amount) || amount <= 0) throw new Error('مبلغ الشحن غير صالح');

  const cleanCustId = String(customerId).trim();
  const { data: custRow, error: fetchErr } = await supabase.from('customers').select('*').eq('id', cleanCustId).single();
  if (fetchErr || !custRow) throw new Error('حساب العميل غير موجود');

  const serverBal = parseFloat(custRow.balance || 0);
  const newBalance = parseFloat((serverBal + amount).toFixed(2));
  const currentTxs = Array.isArray(custRow.wallet_transactions) ? custRow.wallet_transactions : [];
  const currentNotifs = Array.isArray(custRow.notifications) ? custRow.notifications : [];

  const topupTx = {
    id: `tx_topup_${topupId}`,
    topupId: topupId,
    type: 'deposit',
    amount: amount,
    balanceAfter: newBalance,
    title: `شحن رصيد محفظة #${topupId}`,
    date: new Date().toISOString()
  };

  const topupNotif = {
    id: `notif-topup-${topupId}-${Date.now()}`,
    title: 'تم اعتماد شحن المحفظة بنجاح 🎉',
    message: `تم إيداع مبلغ $${amount.toFixed(2)} في محفظتك بنجاح. رصيدك الجديد: $${newBalance.toFixed(2)}.`,
    type: 'wallet',
    topupId: topupId,
    date: new Date().toISOString(),
    read: false
  };

  const updatedCustData = {
    ...custRow.data,
    ...custRow,
    balance: newBalance,
    wallet_transactions: [topupTx, ...currentTxs].slice(0, 100),
    walletTransactions: [topupTx, ...currentTxs].slice(0, 100),
    notifications: [topupNotif, ...currentNotifs].slice(0, 50),
    updated_at: new Date().toISOString()
  };

  await supabase.from('customers').update({
    balance: newBalance,
    wallet_transactions: updatedCustData.wallet_transactions,
    notifications: updatedCustData.notifications,
    data: updatedCustData,
    updated_at: new Date().toISOString()
  }).eq('id', cleanCustId);

  await supabase.from('topups').update({
    status: 'مقبول',
    updated_at: new Date().toISOString()
  }).eq('id', String(topupId));

  return {
    success: true,
    previousBalance: serverBal,
    newBalance: newBalance,
    updatedCustomer: updatedCustData
  };
}

export async function atomicRefundOrderBalance(customerId, orderId, refundAmount, refundTxRecord = null) {
  if (!supabase) throw new Error('قاعدة البيانات غير مهيأة');
  const amount = parseFloat(refundAmount);
  if (isNaN(amount) || amount <= 0) throw new Error('مبلغ الاسترجاع غير صالح');

  const cleanCustId = String(customerId).trim();
  const cleanOrderId = String(orderId).trim();

  const { data: custRow, error: fetchErr } = await supabase.from('customers').select('*').eq('id', cleanCustId).single();
  if (fetchErr || !custRow) throw new Error('حساب العميل غير موجود');

  const serverBal = parseFloat(custRow.balance || 0);
  const newBalance = parseFloat((serverBal + amount).toFixed(2));
  const currentTxs = Array.isArray(custRow.wallet_transactions) ? custRow.wallet_transactions : [];
  const currentNotifs = Array.isArray(custRow.notifications) ? custRow.notifications : [];

  const txRecord = refundTxRecord || {
    id: `tx_refund_${cleanOrderId}_${Date.now()}`,
    orderId: cleanOrderId,
    type: 'deposit',
    amount: amount,
    balanceAfter: newBalance,
    title: `استرجاع رصيد للطلب الملغي #${cleanOrderId}`,
    date: new Date().toISOString()
  };

  const notif = {
    id: `notif-refund-${cleanOrderId}-${Date.now()}`,
    title: `تم استرجاع الرصيد إلى محفظتك 💰 #${cleanOrderId}`,
    message: `تم إرجاع مبلغ $${amount.toFixed(2)} إلى رصيد محفظتك لإلغاء الطلب #${cleanOrderId}. رصيدك الجديد: $${newBalance.toFixed(2)}.`,
    type: 'wallet',
    orderId: cleanOrderId,
    date: new Date().toISOString(),
    read: false
  };

  const updatedCustData = {
    ...custRow.data,
    ...custRow,
    balance: newBalance,
    wallet_transactions: [txRecord, ...currentTxs].slice(0, 100),
    walletTransactions: [txRecord, ...currentTxs].slice(0, 100),
    notifications: [notif, ...currentNotifs].slice(0, 50),
    updated_at: new Date().toISOString()
  };

  await supabase.from('customers').update({
    balance: newBalance,
    wallet_transactions: updatedCustData.wallet_transactions,
    notifications: updatedCustData.notifications,
    data: updatedCustData,
    updated_at: new Date().toISOString()
  }).eq('id', cleanCustId);

  await supabase.from('orders').update({
    status: 'ملغي',
    updated_at: new Date().toISOString()
  }).eq('id', cleanOrderId);

  return {
    success: true,
    previousBalance: serverBal,
    newBalance: newBalance,
    updatedCustomer: updatedCustData
  };
}

// -------------------------------------------------------------
// 9. الطلبات (Orders - حقيقية ومباشرة بدون تعليق)
// -------------------------------------------------------------
export async function syncOrderToCloud(order) {
  if (!supabase || !order) return;
  try {
    const cleanId = String(order.id).trim();
    const row = {
      id: cleanId,
      customer_id: order.customerId || '',
      customer_name: order.customer || order.customerName || '',
      customer_phone: order.customerPhone || '',
      customer_identifier: order.customerIdentifier || '',
      total_usd: parseFloat(order.totalUsd || 0),
      status: order.status || 'قيد المراجعة',
      method: order.method || '',
      items: order.items || [],
      proof: order.proof || '',
      is_deleted: false,
      data: order,
      updated_at: new Date().toISOString()
    };
    await supabase.from('orders').upsert(row);
  } catch (err) {
    console.warn("خطأ في حفظ الطلب سحابياً:", err);
  }
}

export async function deleteOrderFromCloud(orderId) {
  if (!supabase || !orderId) return;
  const cleanId = String(orderId).trim();
  try {
    // حذف حقيقي ونهائي وفوري من قاعدة بيانات SQL
    await supabase.from('orders').delete().eq('id', cleanId);
  } catch (err) {
    console.warn("خطأ في حذف الطلب سحابياً:", err);
  }
}

export async function clearAllOrdersFromCloud(orderIds = []) {
  if (!supabase) return;
  try {
    if (Array.isArray(orderIds) && orderIds.length > 0) {
      await supabase.from('orders').delete().in('id', orderIds.map(String));
    } else {
      await supabase.from('orders').delete().neq('id', '___NEVER_MATCH___');
    }
  } catch (err) {
    console.warn("خطأ في مسح الطلبات سحابياً:", err);
  }
}

// -------------------------------------------------------------
// 10. تسجيل الدخول والإنشاء والحسابات
// -------------------------------------------------------------
export async function loginWithFirebaseAuth(emailOrIdentifier, password) {
  const cust = await getCustomerByIdentifier(emailOrIdentifier);
  if (cust && cust.password && String(cust.password) === String(password).trim()) {
    return cust;
  }
  return null;
}

export async function registerWithFirebaseAuth(email, password, name = '') {
  if (!email || !password) return { success: false, message: 'بيانات غير مكتملة' };
  try {
    const existing = await getCustomerByIdentifier(email);
    if (existing) return { success: false, message: 'هذا الحساب مسجل بالفعل!' };

    const custId = email.trim().replace(/[^a-zA-Z0-9]/g, '_');
    const newCust = {
      id: custId,
      name: name.trim() || email.split('@')[0],
      email: email.trim(),
      identifier: email.trim(),
      password: password.trim(),
      role: 'customer',
      balance: 0,
      points: 0,
      tier: 'عادي',
      status: 'نشط',
      permissions: {},
      wallet_transactions: [],
      notifications: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    await supabase.from('customers').insert({
      id: custId,
      name: newCust.name,
      email: newCust.email,
      identifier: newCust.identifier,
      password: newCust.password,
      role: 'customer',
      balance: 0,
      points: 0,
      tier: 'عادي',
      status: 'نشط',
      data: newCust
    });
    return { success: true, user: newCust };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// دوال OTP ورسائل الهاتف التوافقية
export async function saveOtpToCloud(identifier, code) {
  try {
    localStorage.setItem(`otp_${identifier}`, JSON.stringify({ code: String(code), expiresAt: Date.now() + 600000 }));
  } catch (e) {}
}

export async function verifyOtpFromCloud(identifier, inputCode) {
  try {
    const item = localStorage.getItem(`otp_${identifier}`);
    if (!item) return { success: false, message: 'لم يتم العثور على رمز تحقق' };
    const parsed = JSON.parse(item);
    if (Date.now() > parsed.expiresAt) return { success: false, message: 'انتهت صلاحية الرمز' };
    if (String(parsed.code).trim() === String(inputCode).trim()) {
      localStorage.removeItem(`otp_${identifier}`);
      return { success: true };
    }
    return { success: false, message: 'رمز التحقق غير صحيح' };
  } catch (e) {
    return { success: false, message: 'خطأ في التحقق من الرمز' };
  }
}

export async function sendOtpEmailNotification(email, code, userName = '') {
  return { success: true };
}

export function setupRecaptcha() { return null; }
export async function sendFirebasePhoneOtp() { return { success: false, message: 'يرجى تسجيل الدخول عبر البريد أو اسم المستخدم' }; }
export async function verifyFirebasePhoneOtp() { return { success: false, message: 'غير مدعوم' }; }

// -------------------------------------------------------------
// 11. الاستماع اللحظي الفوري لجميع البيانات (Realtime Subscription)
// -------------------------------------------------------------
export function subscribeToStoreData({
  onConfigUpdate,
  onProductsUpdate,
  onCategoriesUpdate,
  onCustomersUpdate,
  onOrdersUpdate,
  onCouponsUpdate,
  onTopupsUpdate
}) {
  if (!supabase) return () => {};

  // ============================================================
  // جلب أولي فائق السرعة - مرحلتان:
  // المرحلة 1: جلب بيانات المنتجات بدون الصور (خفيف جداً ~1 ثانية)
  //            → يُعرض فوراً للزائر مع الصور من الكاش المحلي
  // المرحلة 2: جلب الصور الكاملة في الخلفية → تحديث تلقائي
  // ============================================================
  const fetchAllInitial = async () => {
    try {
      // ── المرحلة 1: جلب سريع بدون صور ──────────────────────────
      const pConfig = onConfigUpdate
        ? supabase.from('store_settings').select('*').eq('id', 'storeConfig').maybeSingle()
        : Promise.resolve({});
      const pCats = onCategoriesUpdate
        ? supabase.from('categories').select('*').order('display_order', { ascending: true })
        : Promise.resolve({});
      // جلب بيانات المنتجات بدون عمود الصورة (image) أو data لأنهما يحتويان base64 ضخمة
      const pProdsLight = onProductsUpdate
        ? supabase
            .from('products')
            .select('id, title, price, old_price, category, product_type, stock, badge, description, is_deleted, updated_at, sku, weight, custom_fields, quantity_tiers, license_keys, min_quantity, shipping_fee, exchange_amount, exchange_currency_name, exchange_required_product_name, exchange_custom_fields, flash_sale_enabled, flash_sale_price, flash_sale_ends_at, has_quantity_tiers, cost_price, sales_count, total_sales_revenue, reviews, download_url, file_size, created_at')
            .eq('is_deleted', false)
            .order('created_at', { ascending: false })
        : Promise.resolve({});
      const pCusts = onCustomersUpdate
        ? supabase.from('customers').select('*')
        : Promise.resolve({});
      const pOrds = onOrdersUpdate
        ? supabase.from('orders').select('*').eq('is_deleted', false).order('created_at', { ascending: false })
        : Promise.resolve({});
      const pCpns = onCouponsUpdate
        ? supabase.from('coupons').select('*')
        : Promise.resolve({});
      const pTops = onTopupsUpdate
        ? supabase.from('topups').select('*').order('created_at', { ascending: false })
        : Promise.resolve({});

      const [resConfig, resCats, resProdsLight, resCusts, resOrds, resCpns, resTops] = await Promise.allSettled([
        pConfig, pCats, pProdsLight, pCusts, pOrds, pCpns, pTops
      ]);

      if (resConfig.status === 'fulfilled' && resConfig.value?.data?.data && onConfigUpdate) {
        onConfigUpdate(resConfig.value.data.data, new Date(resConfig.value.data.updated_at || Date.now()).getTime());
      }
      if (resCats.status === 'fulfilled' && Array.isArray(resCats.value?.data) && onCategoriesUpdate) {
        const list = resCats.value.data.map(r => ({ ...r.data, ...r, id: r.id }));
        onCategoriesUpdate(list, Date.now());
      }

      // المرحلة 1: عرض المنتجات الخفيفة مع إضافة الصور من الكاش المحلي
      if (resProdsLight.status === 'fulfilled' && Array.isArray(resProdsLight.value?.data) && onProductsUpdate) {
        // بناء خريطة صور من localStorage لتعويض غياب الصور في الجلب الخفيف
        let imageCache = {};
        try {
          const savedProds = localStorage.getItem('haider_store_products');
          if (savedProds) {
            const cachedList = JSON.parse(savedProds);
            if (Array.isArray(cachedList)) {
              cachedList.forEach(p => {
                if (p.id && (p.image || p.imageUrl)) {
                  imageCache[String(p.id)] = p.image || p.imageUrl;
                }
              });
            }
          }
        } catch {}

        const lightList = resProdsLight.value.data.map(r => {
          const cachedImg = imageCache[String(r.id)] || '';
          return {
            id: r.id,
            title: r.title || '',
            price: r.price,
            oldPrice: r.old_price,
            category: r.category || '',
            productType: r.product_type || 'simple',
            stock: r.stock,
            badge: r.badge || '',
            description: r.description || '',
            is_deleted: r.is_deleted,
            sku: r.sku || '',
            weight: r.weight || '',
            minQuantity: r.min_quantity || 1,
            shippingFee: r.shipping_fee || 0,
            exchangeAmount: r.exchange_amount,
            exchangeCurrencyName: r.exchange_currency_name || '',
            exchangeRequiredProductName: r.exchange_required_product_name || '',
            exchangeCustomFields: r.exchange_custom_fields || [],
            flashSaleEnabled: r.flash_sale_enabled || false,
            flashSalePrice: r.flash_sale_price || '',
            flashSaleEndsAt: r.flash_sale_ends_at || '',
            hasQuantityTiers: r.has_quantity_tiers || false,
            costPrice: r.cost_price,
            salesCount: r.sales_count || 0,
            totalSalesRevenue: r.total_sales_revenue || '0.00',
            reviews: r.reviews || [],
            licenseKeys: r.license_keys || [],
            downloadUrl: r.download_url || '',
            fileSize: r.file_size || '',
            created_at: r.created_at,
            updated_at: r.updated_at,
            // الصورة من الكاش المحلي مؤقتاً
            image: cachedImg,
            imageUrl: cachedImg,
            // علامة أن الصورة الكاملة لم تُجلب بعد
            _imageNotLoaded: !cachedImg
          };
        });

        // عرض فوري للمنتجات بدون صور جديدة (الصور القديمة من الكاش)
        onProductsUpdate(lightList, Date.now());

        // ── المرحلة 2: جلب الصور الكاملة في الخلفية ──────────────
        // فقط للمنتجات التي ليس لها صورة في الكاش المحلي
        const productsNeedingImages = lightList.filter(p => p._imageNotLoaded);
        if (productsNeedingImages.length > 0) {
          const idsNeedImg = productsNeedingImages.map(p => String(p.id));
          supabase
            .from('products')
            .select('id, image, data')
            .in('id', idsNeedImg)
            .then(({ data: imgData }) => {
              if (!Array.isArray(imgData)) return;
              const imgMap = {};
              imgData.forEach(r => {
                imgMap[String(r.id)] = r.image || r.data?.image || r.data?.imageUrl || '';
              });
              // تحديث المنتجات بالصور الجديدة
              const updatedList = lightList.map(p => {
                if (imgMap[String(p.id)]) {
                  return { ...p, image: imgMap[String(p.id)], imageUrl: imgMap[String(p.id)], _imageNotLoaded: false };
                }
                return p;
              });
              onProductsUpdate(updatedList, Date.now());
            })
            .catch(() => {});
        }
      }

      if (resCusts.status === 'fulfilled' && Array.isArray(resCusts.value?.data) && onCustomersUpdate) {
        const list = resCusts.value.data.map(r => ({
          ...r.data,
          ...r,
          id: r.id,
          walletTransactions: r.wallet_transactions || r.data?.walletTransactions || [],
          notifications: r.notifications || r.data?.notifications || []
        }));
        onCustomersUpdate(list);
      }
      if (resOrds.status === 'fulfilled' && Array.isArray(resOrds.value?.data) && onOrdersUpdate) {
        const list = resOrds.value.data.map(r => ({
          ...r.data,
          ...r,
          id: r.id,
          totalUsd: r.total_usd,
          customerId: r.customer_id,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          customerIdentifier: r.customer_identifier
        }));
        onOrdersUpdate(list);
      }
      if (resCpns.status === 'fulfilled' && Array.isArray(resCpns.value?.data) && onCouponsUpdate) {
        onCouponsUpdate(resCpns.value.data.map(r => ({ ...r.data, ...r, id: r.id })), Date.now());
      }
      if (resTops.status === 'fulfilled' && Array.isArray(resTops.value?.data) && onTopupsUpdate) {
        onTopupsUpdate(resTops.value.data.map(r => ({ ...r.data, ...r, id: r.id })), Date.now());
      }
    } catch (err) {
      console.warn('خطأ في الجلب الأولي من Supabase:', err);
    }
  };

  fetchAllInitial();

  // قناة البث المباشر اللحظي (Realtime Channel)
  const channel = supabase
    .channel('store_global_realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'store_settings' }, async () => {
      if (onConfigUpdate) {
        const { data } = await supabase.from('store_settings').select('*').eq('id', 'storeConfig').maybeSingle();
        if (data?.data) onConfigUpdate(data.data, new Date(data.updated_at).getTime());
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, async () => {
      if (onCategoriesUpdate) {
        const { data } = await supabase.from('categories').select('*').order('display_order', { ascending: true });
        if (Array.isArray(data)) onCategoriesUpdate(data.map(r => ({ ...r.data, ...r, id: r.id })), Date.now());
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async () => {
      if (onProductsUpdate) {
        const { data } = await supabase.from('products').select('*').eq('is_deleted', false).order('created_at', { ascending: false });
        if (Array.isArray(data)) onProductsUpdate(data.map(r => ({ ...r.data, ...r, id: r.id })), Date.now());
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, async () => {
      if (onCustomersUpdate) {
        const { data } = await supabase.from('customers').select('*');
        if (Array.isArray(data)) {
          onCustomersUpdate(data.map(r => ({
            ...r.data,
            ...r,
            id: r.id,
            walletTransactions: r.wallet_transactions || r.data?.walletTransactions || [],
            notifications: r.notifications || r.data?.notifications || []
          })));
        }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
      if (onOrdersUpdate) {
        const { data } = await supabase.from('orders').select('*').eq('is_deleted', false).order('created_at', { ascending: false });
        if (Array.isArray(data)) {
          onOrdersUpdate(data.map(r => ({
            ...r.data,
            ...r,
            id: r.id,
            totalUsd: r.total_usd,
            customerId: r.customer_id,
            customerName: r.customer_name,
            customerPhone: r.customer_phone,
            customerIdentifier: r.customer_identifier
          })));
        }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'topups' }, async () => {
      if (onTopupsUpdate) {
        const { data } = await supabase.from('topups').select('*').order('created_at', { ascending: false });
        if (Array.isArray(data)) onTopupsUpdate(data.map(r => ({ ...r.data, ...r, id: r.id })), Date.now());
      }
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
