// -------------------------------------------------------------
// دالة التخزين المحلي الآمنة لتفادي أخطاء QuotaExceededError
// -------------------------------------------------------------
export const safeSetLocalStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      console.warn(`تحذير: مساحة التخزين المحلي (localStorage) ممتلئة. تم تجاهل حفظ المفتاح: ${key}. التطبيق سيعتمد على البيانات السحابية.`);
    } else {
      console.error("خطأ غير متوقع في التخزين المحلي:", e);
    }
  }
};
