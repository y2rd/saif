-- =========================================================
-- إعداد جداول متجر حيدر (Haider Store) على Supabase (PostgreSQL)
-- =========================================================

-- 1. جدول إعدادات المتجر (Store Settings & Config)
CREATE TABLE IF NOT EXISTS public.store_settings (
  id TEXT PRIMARY KEY DEFAULT 'storeConfig',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. جدول الأقسام (Categories)
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  name TEXT,
  icon TEXT,
  badge TEXT,
  banner TEXT,
  display_order INT DEFAULT 0,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. جدول المنتجات (Products)
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  price NUMERIC DEFAULT 0,
  old_price NUMERIC,
  category TEXT,
  image TEXT,
  product_type TEXT DEFAULT 'digital',
  stock INT DEFAULT 0,
  badge TEXT,
  description TEXT,
  is_deleted BOOLEAN DEFAULT FALSE,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. جدول العملاء والمستخدمين (Customers)
CREATE TABLE IF NOT EXISTS public.customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  phone TEXT,
  identifier TEXT,
  password TEXT,
  role TEXT DEFAULT 'customer',
  balance NUMERIC DEFAULT 0,
  points INT DEFAULT 0,
  tier TEXT DEFAULT 'عادي',
  status TEXT DEFAULT 'نشط',
  permissions JSONB DEFAULT '{}'::jsonb,
  wallet_transactions JSONB DEFAULT '[]'::jsonb,
  notifications JSONB DEFAULT '[]'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. جدول الطلبات (Orders)
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_identifier TEXT,
  total_usd NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'قيد المراجعة',
  method TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  proof TEXT,
  is_deleted BOOLEAN DEFAULT FALSE,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. جدول طلبات شحن المحفظة (Topup Requests)
CREATE TABLE IF NOT EXISTS public.topups (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  customer_name TEXT,
  customer_identifier TEXT,
  customer_phone TEXT,
  amount_usd NUMERIC DEFAULT 0,
  method TEXT,
  proof TEXT,
  status TEXT DEFAULT 'قيد المراجعة',
  notes TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. جدول الكوبونات والعروض (Coupons)
CREATE TABLE IF NOT EXISTS public.coupons (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  discount_percent NUMERIC DEFAULT 0,
  discount_amount NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================
-- تفعيل القراءة والكتابة العامة المباشرة عبر المفتاح العام (anon)
-- =========================================================
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- سياسات الوصول الشامل (Full Access for Anon API Key)
CREATE POLICY "Allow anon all on store_settings" ON public.store_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon all on categories" ON public.categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon all on products" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon all on customers" ON public.customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon all on orders" ON public.orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon all on topups" ON public.topups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon all on coupons" ON public.coupons FOR ALL USING (true) WITH CHECK (true);

-- =========================================================
-- تفعيل البث اللحظي (Realtime) لكافة الجداول الهامة
-- =========================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.store_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.topups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.coupons;
