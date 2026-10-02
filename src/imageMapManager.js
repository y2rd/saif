// -------------------------------------------------------------
// مدير الصور والموارد الخفيف: جلب البيانات بشكل ديناميكي (Lazy Load)
// بدلاً من حشر 48 ميجابايت داخل ملف الجافاسكريبت الرئيسي!
// -------------------------------------------------------------
import { DEFAULT_PRODUCT_IMAGE } from './defaultProductImage';

let inMemoryImagesMap = {};
let isImagesMapLoaded = false;
let imagesMapPromise = null;

export function loadProductImagesMap() {
  if (isImagesMapLoaded) return Promise.resolve(inMemoryImagesMap);
  if (imagesMapPromise) return imagesMapPromise;

  imagesMapPromise = fetch('./product_images_map.json')
    .then(res => {
      if (!res.ok) throw new Error('فشل جلب خريطة الصور');
      return res.json();
    })
    .then(data => {
      if (data && typeof data === 'object') {
        inMemoryImagesMap = data;
        isImagesMapLoaded = true;
      }
      return inMemoryImagesMap;
    })
    .catch(err => {
      console.warn('تعذر تحميل خريطة الصور الساكنة:', err);
      return {};
    });

  return imagesMapPromise;
}

export function getProductImage(prod) {
  if (!prod) return DEFAULT_PRODUCT_IMAGE;
  if (typeof prod === 'string') {
    return inMemoryImagesMap[prod] || DEFAULT_PRODUCT_IMAGE;
  }
  return (
    prod.imageUrl ||
    prod.image ||
    inMemoryImagesMap[prod.id] ||
    inMemoryImagesMap[prod.title] ||
    DEFAULT_PRODUCT_IMAGE
  );
}

// دالة جلب كاش المنتجات الأولي من ملف static منفصل
export async function fetchInitialProductsCache() {
  try {
    const res = await fetch('./bundled_products_cache.json');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('تعذر جلب كاش المنتجات المسبق:', e);
    return [];
  }
}

// دالة جلب كاش التصنيفات الأولي من ملف static منفصل
export async function fetchInitialCategoriesCache() {
  try {
    const res = await fetch('./bundled_categories_cache.json');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('تعذر جلب كاش التصنيفات المسبق:', e);
    return [];
  }
}
