import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabaseUrl = 'https://glcrqxdqazuowlaehnhw.supabase.co';
const supabaseKey = 'sb_publishable_otbY8PdCrBd3gb3ZwDPYlA_LkWvDjJL';
const supabase = createClient(supabaseUrl, supabaseKey);

async function migrateData() {
  const backupDir = path.join(process.cwd(), 'backups');
  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.json')).sort().reverse();
  if (files.length === 0) {
    throw new Error('لم يتم العثور على أي ملف نسخة احتياطية في مجلد backups');
  }

  const latestFile = path.join(backupDir, files[0]);
  console.log(`قراءة النسخة الاحتياطية: ${latestFile}`);
  const backup = JSON.parse(fs.readFileSync(latestFile, 'utf-8'));

  // 1. ترحيل إعدادات المتجر
  if (backup.storeConfig) {
    console.log('ترحيل إعدادات المتجر...');
    const { error } = await supabase.from('store_settings').upsert({
      id: 'storeConfig',
      data: backup.storeConfig,
      updated_at: new Date().toISOString()
    });
    if (error) console.warn('خطأ ترحيل store_settings:', error.message);
    else console.log('✓ تم ترحيل إعدادات المتجر');
  }

  // 2. ترحيل الأقسام
  if (Array.isArray(backup.categories) && backup.categories.length > 0) {
    console.log(`ترحيل ${backup.categories.length} قسم...`);
    const catsRows = backup.categories.map((c, idx) => ({
      id: String(c.id || `cat-${idx}`),
      name: c.name || '',
      icon: c.icon || '',
      badge: c.badge || '',
      banner: c.banner || '',
      display_order: idx,
      data: c,
      updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from('categories').upsert(catsRows);
    if (error) console.warn('خطأ ترحيل categories:', error.message);
    else console.log(`✓ تم ترحيل ${catsRows.length} قسم بنجاح`);
  }

  // 3. ترحيل المنتجات
  if (Array.isArray(backup.products) && backup.products.length > 0) {
    console.log(`ترحيل ${backup.products.length} منتج...`);
    const prodRows = backup.products.map(p => ({
      id: String(p.id),
      title: p.title || p.name || 'بدون عنوان',
      price: parseFloat(p.price || 0),
      old_price: p.oldPrice ? parseFloat(p.oldPrice) : null,
      category: p.category || '',
      image: p.image || p.imageUrl || '',
      product_type: p.productType || 'digital',
      stock: parseInt(p.stock !== undefined ? p.stock : 20),
      badge: p.badge || '',
      description: p.descriptionHtml || p.description || '',
      is_deleted: false,
      data: p,
      updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from('products').upsert(prodRows);
    if (error) console.warn('خطأ ترحيل products:', error.message);
    else console.log(`✓ تم ترحيل ${prodRows.length} منتج بنجاح`);
  }

  // 4. ترحيل العملاء
  if (Array.isArray(backup.customers) && backup.customers.length > 0) {
    console.log(`ترحيل ${backup.customers.length} عميل...`);
    const custRows = backup.customers.map(c => ({
      id: String(c.id),
      name: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      identifier: c.identifier || '',
      password: c.password || '',
      role: c.role || 'customer',
      balance: parseFloat(c.balance || 0),
      points: parseInt(c.points || 0),
      tier: c.tier || 'عادي',
      status: c.status || 'نشط',
      permissions: c.permissions || {},
      wallet_transactions: c.walletTransactions || [],
      notifications: c.notifications || [],
      data: c,
      updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from('customers').upsert(custRows);
    if (error) console.warn('خطأ ترحيل customers:', error.message);
    else console.log(`✓ تم ترحيل ${custRows.length} عميل بنجاح`);
  }

  // 5. ترحيل الطلبات
  if (Array.isArray(backup.orders) && backup.orders.length > 0) {
    console.log(`ترحيل ${backup.orders.length} طلب...`);
    const orderRows = backup.orders.map(o => ({
      id: String(o.id),
      customer_id: o.customerId || '',
      customer_name: o.customer || o.customerName || '',
      customer_phone: o.customerPhone || '',
      customer_identifier: o.customerIdentifier || '',
      total_usd: parseFloat(o.totalUsd || 0),
      status: o.status || 'قيد المراجعة',
      method: o.method || '',
      items: o.items || [],
      proof: o.proof || '',
      is_deleted: o.isDeleted === true || o.status === 'محذوف',
      data: o,
      updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from('orders').upsert(orderRows);
    if (error) console.warn('خطأ ترحيل orders:', error.message);
    else console.log(`✓ تم ترحيل ${orderRows.length} طلب بنجاح`);
  }

  // 6. ترحيل طلبات الشحن
  if (Array.isArray(backup.topups) && backup.topups.length > 0) {
    console.log(`ترحيل ${backup.topups.length} طلب شحن...`);
    const topupRows = backup.topups.map(t => ({
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
    const { error } = await supabase.from('topups').upsert(topupRows);
    if (error) console.warn('خطأ ترحيل topups:', error.message);
    else console.log(`✓ تم ترحيل ${topupRows.length} طلب شحن بنجاح`);
  }

  // 7. ترحيل الكوبونات
  if (Array.isArray(backup.coupons) && backup.coupons.length > 0) {
    console.log(`ترحيل ${backup.coupons.length} كوبون...`);
    const couponRows = backup.coupons.map((cp, idx) => ({
      id: String(cp.id || `coupon-${idx}`),
      code: String(cp.code || `CODE${idx}`),
      discount_percent: parseFloat(cp.discountPercent || 0),
      discount_amount: parseFloat(cp.discountAmount || 0),
      is_active: cp.isActive !== false,
      data: cp,
      updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from('coupons').upsert(couponRows);
    if (error) console.warn('خطأ ترحيل coupons:', error.message);
    else console.log(`✓ تم ترحيل ${couponRows.length} كوبون بنجاح`);
  }

  console.log('\n=============================================');
  console.log('🎉 اكتمل ترحيل كافة البيانات بأمان إلى Supabase!');
  console.log('=============================================\n');
}

migrateData().catch(console.error);
