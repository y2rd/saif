// -------------------------------------------------------------
// دالة التخزين المحلي الآمنة لتفادي أخطاء QuotaExceededError
// -------------------------------------------------------------
export const safeSetLocalStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      console.warn(`تحذير: مساحة التخزين المحلي ممتلئة عند حفظ ${key}. جاري تنظيف الحجم لتوفير مساحة...`);
      try {
        if (key === 'haider_store_products') {
          // إذا كانت المنتجات تتجاوز 5MB، نحفظ بياناتها الأساسية بدون سلاسل Base64 الثقيلة
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed)) {
            const stripped = parsed.map(p => {
              const copy = { ...p };
              if (copy.image && copy.image.length > 500) copy.image = '';
              if (copy.imageUrl && copy.imageUrl.length > 500) copy.imageUrl = '';
              return copy;
            });
            localStorage.setItem(key, JSON.stringify(stripped));
            return;
          }
        }
      } catch (innerErr) {
        console.warn('تعذر حفظ النسخة المخففة:', innerErr);
      }
    } else {
      console.error("خطأ غير متوقع في التخزين المحلي:", e);
    }
  }
};
