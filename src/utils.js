// -------------------------------------------------------------
// دوال التخزين المحلي الآمنة لتفادي أخطاء الحظر أو الامتلاء
// (SecurityError / QuotaExceededError / Restricted Webviews)
// -------------------------------------------------------------

export const safeGetLocalStorage = (key, fallback = null) => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback;
    const value = window.localStorage.getItem(key);
    return value !== null ? value : fallback;
  } catch (e) {
    console.warn(`تعذر قراءة ${key} من التخزين المحلي:`, e);
    return fallback;
  }
};

export const safeSetLocalStorage = (key, value) => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      console.warn(`تحذير: مساحة التخزين المحلي (localStorage) ممتلئة عند حفظ ${key}. التطبيق سيعتمد على الذاكرة الحية والسحابة.`);
    } else {
      console.warn("تعذر الكتابة في التخزين المحلي:", e);
    }
  }
};

export const safeRemoveLocalStorage = (key) => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(key);
  } catch (e) {
    console.warn(`تعذر حذف ${key} من التخزين المحلي:`, e);
  }
};
