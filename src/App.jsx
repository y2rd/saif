import { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import AdminDashboard from './AdminDashboard';
import ProductDetailPage from './ProductDetailPage';
import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import bundledInitialProducts from './bundled_products_cache.json';
import bundledInitialCategories from './bundled_categories_cache.json';
import { 
  subscribeToStoreData, 
  syncCustomerToCloud, 
  syncOrderToCloud, 
  syncProductsToCloud, 
  syncCategoriesToCloud, 
  syncStoreConfigToCloud,
  syncTopupsToCloud,
  sendTelegramNotification,
  getCustomerByIdentifier,
  loginWithCredentials,
  registerWithCredentials,
  saveOtpToCloud,
  verifyOtpFromCloud,
  sendOtpEmailNotification,
  atomicDeductWalletBalance
} from './supabase';

function compressImage(file, maxWidth = 600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = (err) => reject(err);
      img.src = readerEvent.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

function isProductRequiringInput(prod) {
  if (!prod || typeof prod !== 'object') return false;
  if (prod.productType === 'exchange') return true;
  if (typeof prod.exchangeCurrencyName === 'string' && prod.exchangeCurrencyName.trim().length > 0) return true;
  // التحقق من الحقول المخصصة الإجبارية الجديدة
  if (Array.isArray(prod.customFields) && prod.customFields.some(f => f.label?.trim() && f.required)) return true;
  return false;
}

// دالة فحص نفاذ كمية المنتج (المخزون صفر أو أقل)
export function isProductOutOfStock(prod) {
  if (!prod || typeof prod !== 'object') return false;
  // إذا كان المنتج يحتوي على أكواد رقمية (license)، نتحقق من عدد الأكواد غير المستخدمة إذا كانت محددة
  if (prod.productType === 'license' && Array.isArray(prod.licenseKeys)) {
    const availableKeys = prod.licenseKeys.filter(k => k && !k.used && !k.isUsed);
    if (prod.licenseKeys.length > 0 && availableKeys.length === 0) return true;
  }
  // فحص حقل stock
  if (prod.stock !== undefined && prod.stock !== null && prod.stock !== '') {
    const numStock = parseInt(prod.stock, 10);
    if (!isNaN(numStock) && numStock <= 0) {
      return true;
    }
  }
  return false;
}

// دالة إرسال إشعار فوري للنظام / الهاتف (تطبيق أندرويد + متصفح الويب)
async function triggerDeviceNotification(title, body, id = Math.floor(Math.random() * 100000)) {
  // 1. إشعار تطبيق أندرويد (Capacitor Native Local Notification)
  try {
    if (typeof LocalNotifications !== 'undefined') {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        await LocalNotifications.requestPermissions();
      }
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Number(id) || Math.floor(Math.random() * 100000),
            title: title || 'متجر دكان هاي داي',
            body: body || '',
            smallIcon: 'ic_launcher_round',
            iconColor: '#004956',
            sound: 'beep.wav'
          }
        ]
      });
    }
  } catch (err) {
    // تجاهل في المتصفح العادي إذا لم تكن بيئة كاباسيتور
  }

  // 2. إشعار المتصفح (Web Notification API)
  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/favicon.svg'
        });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            new Notification(title, { body, icon: '/favicon.svg' });
          }
        });
      }
    }
  } catch (err) {}
}

export default function App() {
  const [viewMode, setViewMode] = useState('store'); // 'store' أو 'admin' أو 'product-detail' أو 'category' أو 'custom-page' أو 'section-view'
  const [activeProductForPage, setActiveProductForPage] = useState(null);
  const [activeCustomPage, setActiveCustomPage] = useState(null); // الصفحة التعريفية المفتوحة للقراءة
  const [activeSectionForPage, setActiveSectionForPage] = useState(null); // العنصر المفتوح لعرض كافة منتجاته في صفحة مستقلة
  const [adminSection, setAdminSection] = useState(null); // التوجه المباشر لتاب محدد عند الفتح (null = لا توجيه)

  // الوضع الليلي
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('haider_store_theme') === 'dark';
  });

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-theme');
      localStorage.setItem('haider_store_theme', 'dark');
    } else {
      document.body.classList.remove('dark-theme');
      localStorage.setItem('haider_store_theme', 'light');
    }
  }, [isDarkMode]);

  // العملة والمعروض: 'USD' أو 'IQD'، ولغة المتجر: 'ar' أو 'en'
  const [activeCurrency, setActiveCurrency] = useState('USD');
  const [activeLanguage, setActiveLanguage] = useState('ar');
  const [isCurrencyMenuOpen, setIsCurrencyMenuOpen] = useState(false);
  const [currencyMenuAnimating, setCurrencyMenuAnimating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const openCurrencyMenu = () => {
    setIsCurrencyMenuOpen(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setCurrencyMenuAnimating(true));
    });
  };

  const closeCurrencyMenu = () => {
    setCurrencyMenuAnimating(false);
    setTimeout(() => setIsCurrencyMenuOpen(false), 220);
  };

  const toggleCurrencyMenu = () => {
    if (isCurrencyMenuOpen) {
      closeCurrencyMenu();
    } else {
      openCurrencyMenu();
    }
  };

  // نافذة تسجيل الدخول والتسجيل والموشن
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalAnimating, setAuthModalAnimating] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' أو 'register'
  const [authMethod, setAuthMethod] = useState('phone'); // 'phone' أو 'email'
  const [selectedCountryCode, setSelectedCountryCode] = useState({ code: '+964', flag: '🇮🇶', name: 'العراق' });
  const [isCountryPickerOpen, setIsCountryPickerOpen] = useState(false);
  const [authIdentifier, setAuthIdentifier] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  // حالات كود التحقق OTP وقاعدة البيانات
  const [authStep, setAuthStep] = useState('credentials'); // 'credentials' أو 'otp'
  const [authOtp, setAuthOtp] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [otpResendCountdown, setOtpResendCountdown] = useState(0);

  // حماية لوحة التحكم: نافذة إدخال رمز الدخول للمدير
  const [isAdminAuthModalOpen, setIsAdminAuthModalOpen] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [adminAuthError, setAdminAuthError] = useState('');

  // تبويب نافذة المستخدم بعد تسجيل الدخول: 'orders' | 'wishlist' | 'account' | 'settings' | 'pending_payment' | 'wallet' | 'notifications'
  const [profileTab, setProfileTab] = useState('orders');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const [editProfileName, setEditProfileName] = useState('');
  const [editProfilePassword, setEditProfilePassword] = useState('');
  const [editProfileSuccess, setEditProfileSuccess] = useState('');

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('haider_current_user');
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.notifications)) {
        let readIds = new Set();
        try {
          const savedReadIds = localStorage.getItem('haider_read_notif_ids');
          if (savedReadIds) readIds = new Set(JSON.parse(savedReadIds));
        } catch {}
        parsed.notifications = parsed.notifications.map(n => ({
          ...n,
          read: (n.read || readIds.has(String(n.id)) || (n.topupId && readIds.has(`topup-${n.topupId}`))) ? true : false
        }));
      }
      return parsed;
    } catch {
      return null;
    }
  });



  // إغلاق القائمة المنسدلة عند النقر خارجها
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
    };
    if (isUserMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isUserMenuOpen]);

  // حالة نافذة تتبع الطلبات الفورية
  const [showOrderTrackingModal, setShowOrderTrackingModal] = useState(false);
  const [trackingQuery, setTrackingQuery] = useState('');
  const [trackingFoundOrder, setTrackingFoundOrder] = useState(null);
  const [trackingSearched, setTrackingSearched] = useState(false);

  // حالة إظهار/إخفاء قائمة الدعم الفني السريع
  const [isSupportMenuOpen, setIsSupportMenuOpen] = useState(false);

  // حالة البانر العائم للإشعار داخل التطبيق (In-App Notification Banner)
  const [inAppBanner, setInAppBanner] = useState(null);
  const lastSeenNotifsCountRef = useRef(null);

  // نافذة الحوار المنبثقة النظيفة والأنيقة في وسط الشاشة (Clean Center Modal)
  const [modalDialog, setModalDialog] = useState(null);

  const showAppModal = ({ title, message, type = 'success', confirmText = 'حسناً', onConfirm, onCancel, showCancel = false, cancelText = 'إلغاء' }) => {
    setModalDialog({
      title,
      message,
      type,
      confirmText,
      onConfirm,
      onCancel,
      showCancel,
      cancelText
    });
  };

  // الاستماع لأي أحداث تنبيه من المكونات الفرعية لفتح النافذة الأنيقة
  useEffect(() => {
    const handleCustomAppModal = (e) => {
      if (e.detail) {
        showAppModal(e.detail);
      }
    };
    window.addEventListener('app-show-modal', handleCustomAppModal);
    return () => window.removeEventListener('app-show-modal', handleCustomAppModal);
  }, []);

  const lastBannerRef = useRef({ title: '', time: 0 });

  const showNotificationBanner = (title, message, type = 'info') => {
    const now = Date.now();
    if (lastBannerRef.current.title === title && (now - lastBannerRef.current.time) < 4000) {
      return; // منع إطلاق نفس الإشعار خلال 4 ثوانٍ
    }
    lastBannerRef.current = { title, time: now };

    setInAppBanner({ title, message, type, id: now });
    triggerDeviceNotification(title, message);
    setTimeout(() => {
      setInAppBanner(prev => (prev && prev.title === title ? null : prev));
    }, 4500);
  };

  useEffect(() => {
    if (isAuthModalOpen || isAdminAuthModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isAuthModalOpen, isAdminAuthModalOpen]);

  // مؤقت إعادة إرسال الرمز
  useEffect(() => {
    let timer;
    if (otpResendCountdown > 0) {
      timer = setTimeout(() => setOtpResendCountdown(prev => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [otpResendCountdown]);

  const openAuthModal = (mode = 'login', initialTab = 'orders') => {
    setAuthMode(mode);
    setAuthStep('credentials');
    setAuthOtp('');
    setAuthError('');
    setProfileTab(initialTab);
    setIsUserMenuOpen(false);
    if (currentUser) {
      setEditProfileName(currentUser.name || '');
      setEditProfilePassword(currentUser.password || '');
    }
    setEditProfileSuccess('');
    setIsAuthModalOpen(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAuthModalAnimating(true));
    });
  };

  const closeAuthModal = () => {
    setAuthModalAnimating(false);
    setTimeout(() => {
      setIsAuthModalOpen(false);
      setAuthStep('credentials');
      setAuthOtp('');
      setAuthError('');
    }, 240);
  };

  // تم الغاء إرسال الـ OTP

  // تقديم النموذج (تسجيل دخول أو بدء إنشاء حساب جديد)
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!authIdentifier.trim()) {
      setAuthError('يرجى إدخال رقم الهاتف أو البريد الإلكتروني');
      return;
    }
    if (!authPassword.trim()) {
      setAuthError('يرجى إدخال كلمة المرور');
      return;
    }

    const trimmedInput = authIdentifier.trim();
    const isEmailFormat = trimmedInput.includes('@');
    const hasLetters = /[a-zA-Z\u0600-\u06FF]/.test(trimmedInput);

    const fullContact = (authMethod === 'phone' && !isEmailFormat && !hasLetters) 
      ? `${selectedCountryCode.code} ${trimmedInput}` 
      : trimmedInput.toLowerCase();

    setAuthLoading(true);

    try {
      // 1. فحص قائمة العملاء المحلية المحملة
      const cleanDigits = (s) => String(s || '').replace(/\D/g, '');
      const inputDigits = cleanDigits(trimmedInput);
      const inputRaw = trimmedInput.toLowerCase();
      const inputFull = fullContact.toLowerCase();

      let existingUser = customers.find(c => {
        const cName = String(c.name || '').toLowerCase().trim();
        const cEmail = String(c.email || '').toLowerCase().trim();
        const cIdent = String(c.identifier || '').toLowerCase().trim();
        const cUsername = String(c.username || '').toLowerCase().trim();
        const cPhoneDigits = cleanDigits(c.phone || c.identifier);

        if (cName && (cName === inputRaw || cName === inputFull)) return true;
        if (cUsername && (cUsername === inputRaw || cUsername === inputFull)) return true;
        if (cEmail && (cEmail === inputRaw || cEmail === inputFull)) return true;
        if (cIdent && (cIdent === inputRaw || cIdent === inputFull)) return true;
        if (c.id && (String(c.id).toLowerCase() === inputRaw || String(c.id).toLowerCase() === inputFull)) return true;
        if (inputDigits.length >= 7 && cPhoneDigits.length >= 7) {
          if (inputDigits === cPhoneDigits || inputDigits.endsWith(cPhoneDigits) || cPhoneDigits.endsWith(inputDigits) || inputDigits.slice(-9) === cPhoneDigits.slice(-9)) return true;
        }
        return false;
      });

      // 2. فحص قاعدة البيانات السحابية Firestore
      if (!existingUser) {
        existingUser = await getCustomerByIdentifier(fullContact, trimmedInput);
      }

      // 3. في حالة تسجيل الدخول ولم يُعثر عليه، محاولة التحقق بالبيانات (Credentials)
      if (authMode === 'login' && !existingUser) {
        existingUser = await loginWithCredentials(trimmedInput, authPassword.trim());
      }

      if (authMode === 'login') {
        // حالة تسجيل الدخول:
        if (!existingUser) {
          setAuthError('لم يتم العثور على حساب بهذا الاسم أو المعرّف. تأكد من البيانات أو أنشئ حساباً جديداً');
          setAuthLoading(false);
          return;
        }

        // فحص كلمة المرور إذا كانت مسجلة مسبقاً
        if (existingUser.password && existingUser.password !== authPassword.trim() && !existingUser.uid) {
          setAuthError('كلمة المرور غير صحيحة');
          setAuthLoading(false);
          return;
        }

        // تسجيل الدخول بنجاح مع أخذ الرتبة الفعلية من قاعدة البيانات (عميل customer دائماً إلا إذا تم تعيينه مدير مسبقاً من قاعدة البيانات)
        const loggedUser = {
          ...existingUser,
          role: existingUser.role === 'admin' ? 'admin' : 'customer'
        };

        setCurrentUser(loggedUser);
        try {
          localStorage.setItem('haider_current_user', JSON.stringify(loggedUser));
        } catch (e) {}

        // تحديث آخر تسجيل دخول في السحابة
        syncCustomerToCloud(loggedUser);

        setAuthLoading(false);
        closeAuthModal();
        showAppModal({
          title: 'تسجيل الدخول ناجح',
          message: `مرحباً بك مجدداً يا ${loggedUser.name || 'عميلنا العزيز'}!`,
          type: 'success',
          confirmText: 'متابعة'
        });
      } else {
        // حالة إنشاء حساب جديد:
        if (existingUser) {
          setAuthError('هذا الحساب مسجل بالفعل في المتجر! يرجى الانتقال إلى تسجيل الدخول.');
          setAuthLoading(false);
          return;
        }

        if (!authName.trim()) {
          setAuthError('يرجى إدخال الاسم الكامل');
          setAuthLoading(false);
          return;
        }

        // إنشاء الحساب مباشرة وتشفير كلمة المرور سحابياً
        const credRes = await registerWithCredentials(fullContact, authPassword.trim(), authName.trim());
        if (!credRes.success) {
          setAuthError(credRes.message);
          setAuthLoading(false);
          return;
        }

        const newCustomer = credRes.user;

        setCurrentUser(newCustomer);
        setCustomers(prev => {
          const filtered = prev.filter(c => c.identifier !== fullContact && c.id !== newCustomer.id);
          const updated = [newCustomer, ...filtered];
          try {
            localStorage.setItem('haider_store_customers', JSON.stringify(updated));
          } catch (e) {}
          return updated;
        });

        try {
          localStorage.setItem('haider_current_user', JSON.stringify(newCustomer));
        } catch (e) {}

        setAuthLoading(false);
        closeAuthModal();
        showAppModal({
          title: 'تم إنشاء الحساب بنجاح',
          message: `أهلاً بك يا ${newCustomer.name}! تم إنشاء حسابك وتسجيل دخولك كعميل في المتجر.`,
          type: 'success',
          confirmText: 'تصفح المتجر'
        });
      }
    } catch (err) {
      console.error(err);
      setAuthError('حدث خطأ في الاتصال بقاعدة البيانات. يرجى المحاولة لاحقاً');
      setAuthLoading(false);
    }
  };

  // تم إلغاء نظام الـ OTP והاستعاضة عنه بالتسجيل المباشر

  // فحص صلاحية الإدارة (تقتصر على المدير أو المشرفين فقط)
  const isManager = Boolean(
    currentUser && (
      currentUser.role === 'admin' || 
      currentUser.role === 'supervisor' ||
      Boolean(currentUser.permissions && (
        currentUser.permissions.canManageOrders ||
        currentUser.permissions.canManageProducts ||
        currentUser.permissions.canManageCoupons ||
        currentUser.permissions.canViewReports
      ))
    )
  );

  // التحقق من صلاحية الدخول للوحة الإدارة (مباشرة بدون أي رمز دخول للمدير والمشرفين)
  const handleOpenAdminPanel = () => {
    if (isManager || viewMode === 'admin') {
      setViewMode(viewMode === 'admin' ? 'store' : 'admin');
    }
  };

  const handleAdminAuthSubmit = (e) => {
    e.preventDefault();
    const configuredPin = storeConfig?.adminPin ? String(storeConfig.adminPin).trim() : '';
    const inputPin = adminPinInput.trim();

    if (!configuredPin) {
      setAdminAuthError('لم يتم تعيين رمز مرور للإدارة في إعدادات المتجر بعد.');
      return;
    }

    const isValidPin = inputPin === configuredPin;

    if (isValidPin) {
      setIsAdminAuthModalOpen(false);
      setAdminPinInput('');
      setAdminAuthError('');
      
      if (currentUser) {
        // إذا كان المستخدم مسجل دخول بالفعل، تتم ترقية حسابه الحقيقي
        const updatedAdmin = { ...currentUser, role: 'admin' };
        setCurrentUser(updatedAdmin);
        try {
          localStorage.setItem('haider_current_user', JSON.stringify(updatedAdmin));
        } catch (e) {}
      }
      setViewMode('admin');
    } else {
      setAdminAuthError('رمز مرور الإدارة غير صحيح!');
    }
  };

  // سلة المشتريات والموشن
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartAnimating, setCartAnimating] = useState(false);
  const [cartItems, setCartItems] = useState(() => {
    try {
      const saved = localStorage.getItem('haider_cart_items');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('haider_cart_items', JSON.stringify(cartItems));
    } catch (e) {}
  }, [cartItems]);
  const [isCheckingOut, setIsCheckingOut] = useState(false); // حماية فورية لمنع تكرار النقر وتدبيل الدفع
  const isCheckingOutRef = useRef(false); // قفل فوري متزامن يمنع أي نقرات متتالية قبل تحديث الـ State
  const deletedOrderIdsRef = useRef(new Set((() => {
    try {
      const saved = localStorage.getItem('haider_deleted_order_ids');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  })())); // تتبع الطلبات المحذوفة محلياً ومزامنتها عبر الريفرش لمنع إعادة ظهورها من Supabase
  const readNotifIdsRef = useRef(new Set((() => {
    try {
      const saved = localStorage.getItem('haider_read_notif_ids');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  })())); // تتبع الإشعارات المقروءة محلياً ودائماً عبر الريفرش لمنع إعادة ظهورها كجديدة من Supabase
  const [wishlist, setWishlist] = useState([]);
  const [cartBump, setCartBump] = useState(false); // موشن اهتزاز وتكبير السلة عند إضافة منتج
  const [cartToastMessage, setCartToastMessage] = useState(''); // رسالة صغيرة تحت في منتصف الشاشة بالخط الأسود
  const [cartToastVisible, setCartToastVisible] = useState(false); // التحكم في سلاسة الدخول والخروج

  // قائمة / درج الأقسام الجانبية
  const [isCategoryDrawerOpen, setIsCategoryDrawerOpen] = useState(false);
  const [categoryDrawerAnimating, setCategoryDrawerAnimating] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState({}); // الأقسام الرئيسية المفتوحة لعرض أقسامها الفرعية

  const openCategoryDrawer = () => {
    setIsCategoryDrawerOpen(true);
    requestAnimationFrame(() => {
      setCategoryDrawerAnimating(true);
    });
  };

  const closeCategoryDrawer = () => {
    setCategoryDrawerAnimating(false);
    setTimeout(() => {
      setIsCategoryDrawerOpen(false);
    }, 300);
  };

  const toggleWishlist = (productId) => {
    setWishlist(prev => 
      prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId]
    );
  };

  // نافذة تفاصيل المنتج
  const [selectedProductDetails, setSelectedProductDetails] = useState(null);

  // نموذج التقييم
  const [userRating, setUserRating] = useState(5);
  const [userReviewName, setUserReviewName] = useState('');
  const [userReviewComment, setUserReviewComment] = useState('');

  // حالات الدفع (المحفظة كخيار افتراضي أولي)
  const [paymentMethod, setPaymentMethod] = useState('wallet');
  const [paymentTxProof, setPaymentTxProof] = useState('');
  const [paymentTxId, setPaymentTxId] = useState('');
  const [copySuccessKey, setCopySuccessKey] = useState('');

  // حالات طلبات شحن المحفظة
  const [topupRequests, setTopupRequests] = useState(() => {
    try {
      const saved = localStorage.getItem('haider_store_topups');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('haider_store_topups', JSON.stringify(topupRequests));
    } catch (e) {}
  }, [topupRequests]);

  // عدد طلبات الشحن المعلقة التي تحتاج اعتماد المدير
  const pendingTopupsCount = useMemo(() => {
    return (topupRequests || []).filter(t => t.status === 'معلق').length;
  }, [topupRequests]);

  // إجمالي الإشعارات غير المقروءة الخاصة بالمدير (طلبات الشحن المعلقة غير المقروءة + الإشعارات الإدارية غير المقروءة)
  const managerNotificationsCount = useMemo(() => {
    if (!currentUser) return 0;
    const unreadCount = (currentUser.notifications || []).filter(n => !n.read).length;
    if (isManager) {
      // للمدير: نحسب فقط طلبات الشحن المعلقة التي لم يتم تحديدها كمقروءة بعد
      const unreadPendingTopups = (topupRequests || []).filter(t => 
        t.status === 'معلق' && 
        !readNotifIdsRef.current.has(`topup-${t.id}`) && 
        !readNotifIdsRef.current.has(`virtual-topup-${t.id}`)
      ).length;
      return Math.max(unreadCount, unreadPendingTopups);
    }
    return unreadCount;
  }, [currentUser, isManager, topupRequests]);

  const [isTopupModalOpen, setIsTopupModalOpen] = useState(false);
  const [topupAmountUsd, setTopupAmountUsd] = useState('');
  const [topupMethod, setTopupMethod] = useState('zaincash');
  const [topupProof, setTopupProof] = useState('');
  const [topupNote, setTopupNote] = useState('');

  // حالات تقييم الطلبات المكتملة وإرفاق الصور
  const [reviewModalOrder, setReviewModalOrder] = useState(null);
  const [reviewModalRating, setReviewModalRating] = useState(5);
  const [reviewModalComment, setReviewModalComment] = useState('');
  const [reviewModalPhoto, setReviewModalPhoto] = useState('');
  const [reviewModalProductId, setReviewModalProductId] = useState('');

  // مرجع وحالة التمرير
  const productsSectionRef = useRef(null);
  const [isHighlighting, setIsHighlighting] = useState(false);
  const editorRef = useRef(null);
  const cartToastTimerRef = useRef(null);

  // الخيارات المحددة للمنتجات
  const [selectedVariants, setSelectedVariants] = useState({});
  const [editingProduct, setEditingProduct] = useState(null);

  // حالات الفلترة والفرز في المخزون
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState('الكل');
  const [inventorySearchQuery, setInventorySearchQuery] = useState('');
  const [inventorySortBy, setInventorySortBy] = useState('newest');
  const [inventoryStockFilter, setInventoryStockFilter] = useState('all');
  const [inventoryViewLayout, setInventoryViewLayout] = useState('table');

  const openCartWithMotion = () => {
    setIsCartOpen(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setCartAnimating(true));
    });
  };

  const closeCartWithMotion = () => {
    setCartAnimating(false);
    setTimeout(() => setIsCartOpen(false), 550);
  };

  // 1. إعدادات المتجر وبيانات الدفع مع روابط وصور الباركود (QR Code)
  const [storeConfig, setStoreConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('haider_store_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        // تنظيف وحذف أي نصوص تجريبية أو تلقائية للبانر العريض إن كانت محفوظة سابقاً
        if (parsed?.homeSections?.wideBanner) {
          const wb = parsed.homeSections.wideBanner;
          if (['بانر إعلاني عريض', 'عرض التوفير الأسبوعي الخاص'].includes(wb.title)) {
            wb.title = '';
          }
          if (['وصف ترويجي خاص بالبانر', 'احصل على خصم 15% إضافي عند الدفع عبر Binance أو زين كاش بالكوبون HAYDAY2026'].includes(wb.subtitle)) {
            wb.subtitle = '';
          }
          if (['اكتشف المزيد', 'اغتنم العرض الآن'].includes(wb.buttonText)) {
            wb.buttonText = '';
          }
        }
        if (parsed?.homeSections?.productsGrid?.buttonText) {
          const pt = parsed.homeSections.productsGrid.buttonText;
          if (pt.includes('المبادلة') || pt.includes('قسم')) {
            parsed.homeSections.productsGrid.buttonText = 'إضافة للسلة';
          }
        }
        // تنظيف أي سلايدات أو صور مربعة تجريبية قديمة لم يضعها المستخدم
        if (parsed?.homeSections?.bannerSlider?.slides) {
          parsed.homeSections.bannerSlider.slides = parsed.homeSections.bannerSlider.slides.filter(
            s => s && s.id !== 'slide-1' && s.id !== 'slide-2' && !s.title?.includes('لمزرعتك في Hay Day')
          );
        }
        if (parsed?.homeSections?.squareImages?.items) {
          parsed.homeSections.squareImages.items = parsed.homeSections.squareImages.items.filter(
            i => i && !['sq-1', 'sq-2', 'sq-3', 'sq-4'].includes(i.id)
          );
        }
        // تنظيف أي عناصر واجهة تجريبية مكررة لم يضعها المستخدم
        if (Array.isArray(parsed?.homeLayout)) {
          parsed.homeLayout = parsed.homeLayout.filter(sec => {
            if (!sec || !sec.id) return true;
            return !['sec-moving-1', 'sec-moving-2', 'sec-moving-3', 'sec-moving-4', 'sec-moving-5', 'sec-moving-6', 'sec-wide-1', 'sec-wide-2', 'sec-wide-3', 'sec-wide-4'].includes(sec.id);
          });
          if (parsed.homeLayout.length === 0) {
            parsed.homeLayout = [
              { id: 'sec-products-grid', type: 'productsGrid', title: 'منتجات المتجر', enabled: true },
              { id: 'sec-items-list', type: 'itemsList', title: 'الأقسام والتصنيفات', enabled: true },
              { id: 'sec-store-features', type: 'storeFeatures', title: 'مميزات المتجر', enabled: true }
            ];
          }
        }
        if (parsed?.bannerDesc && parsed.bannerDesc.includes('تصفح أفضل البطاقات')) {
          parsed.bannerDesc = '';
        }
        if (parsed?.bannerTitle && parsed.bannerTitle.includes('أهلاً بك في المتجر الرسمي')) {
          parsed.bannerTitle = '';
        }
        if (!Array.isArray(parsed?.customPages)) {
          parsed.customPages = [
            {
              id: 'page-privacy',
              title: 'سياسة الخصوصية',
              slug: 'privacy-policy',
              content: 'نحن نلتزم بحماية خصوصية جميع زوار وعملاء متجرنا. لا نشارك بياناتكم الشخصية مع أي طرف ثالث، ونستخدم البيانات فقط لتنفيذ وإتمام طلباتكم بأمان وموثوقية وسرعة.',
              showInFooter: true
            },
            {
              id: 'page-terms',
              title: 'الشروط والأحكام',
              slug: 'terms',
              content: 'جميع المنتجات والخدمات المقدمة مضمونة 100%. يرجى التأكد من صحة البيانات المدخلة عند تنفيذ الطلب لضمان سرعة التسليم الفوري.',
              showInFooter: true
            }
          ];
        }
        return parsed;
      }
    } catch {}
    return {
    name: 'متجر دكان هاي داي',
    subTitle: '',
    logoText: 'د',
    logoUrl: '', // صورة الشعار المرفوعة
    primaryColor: '#004956',
    accentColor: '#76e5d0',
    bannerBgColor: '#00343D',
    fontFamily: 'Tajawal',
    usdToIqdRate: 1500,
    whatsapp: '966500000000',
    telegram: 'dokkan_store',
    telegramBotToken: '', // توكن بوت تيليجرام لتنبيهات الطلبات المباشرة
    telegramChatId: '',   // معرف شات المدير لاستلام الإشعارات
    enableFloatingSupport: true, // زر الدعم السريع العائم (واتساب/تيليجرام)
    // بيانات وسائل الدفع وصور الباركود
    binancePayId: '852964173',
    binanceQrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=binance-pay-852964173',
    zainCashNumber: '07801234567',
    zainCashQrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=zaincash-07801234567',
    masterCardIraqi: '5326 4800 1234 5678',
    masterCardBeneficiary: 'اسم المستفيد / مصرف التنمية العراقي',
    masterCardQrCode: '',
    okxUid: '5928172948',
    okxUsdtAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    okxQrCode: 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    announcement: '⚡ تسليم فوري لجميع الطلبات على مدار 24 ساعة',
    announcementMode: 'marquee', // 'static' أو 'marquee'
    announcements: [
      { id: 1, text: '⚡ تسليم فوري لجميع الأكواد والمنتجات الرقمية والاشتراكات على مدار 24 ساعة', bgColor: '#00343D', textColor: '#FFFFFF', isMarquee: true, direction: 'ar', speed: 20 }
    ],
    bannerTitle: '',
    bannerDesc: '',
    footerCopyright: 'جميع الحقوق محفوظة للمتجر © 2026',
    customPages: [
      {
        id: 'page-privacy',
        title: 'سياسة الخصوصية',
        slug: 'privacy-policy',
        content: 'نحن نلتزم بحماية خصوصية جميع زوار وعملاء متجرنا. لا نشارك بياناتكم الشخصية مع أي طرف ثالث، ونستخدم البيانات فقط لتنفيذ وإتمام طلباتكم بأمان وموثوقية وسرعة.',
        showInFooter: true
      },
      {
        id: 'page-terms',
        title: 'الشروط والأحكام',
        slug: 'terms',
        content: 'جميع المنتجات والخدمات المقدمة مضمونة 100%. يرجى التأكد من صحة البيانات المدخلة عند تنفيذ الطلب لضمان سرعة التسليم الفوري.',
        showInFooter: true
      }
    ],
    itemsPerRow: 3,
    // إعدادات مميزات المنتج السريعة (تسليم فوري، ضمان أصلي، دعم متواصل)
    productFeatures: {
      enabled: true,
      showInStoreFooter: true, // إظهار المميزات أيضاً في أسفل المتجر
      showStoreReviews: true, // إظهار قسم تقييمات وآراء العملاء في أسفل المتجر
      items: [
        {
          id: 'feat-1',
          enabled: true,
          title: 'سرعة التنفيذ',
          subtitle: 'خدمة آلية سريعة',
          icon: 'fa-solid fa-bolt',
          customIconUrl: ''
        },
        {
          id: 'feat-2',
          enabled: true,
          title: 'ضمان كامل',
          subtitle: '100% مضمون',
          icon: 'fa-solid fa-shield-halved',
          customIconUrl: ''
        },
        {
          id: 'feat-3',
          enabled: true,
          title: 'دعم متواصل',
          subtitle: 'واتساب ومباشر',
          icon: 'fa-solid fa-comments',
          customIconUrl: ''
        }
      ]
    },
    // إعدادات نظام نقاط الولاء والمكافآت
    loyaltyConfig: {
      enabled: true, // تشغيل أو إيقاف نظام الولاء
      spendUsdPerPoint: 10, // كم دولار ينفق العميل ليحصل على نقطة واحدة (مثال: كل $10 = 1 نقطة)
      pointsPerUsd: 10 // كم نقطة تسوى $1 دولار عند الاستبدال (مثال: كل 10 نقاط = $1 دولار)
    },
    // عناصر الصفحة الرئيسية الفعلية والنظيفة
    homeLayout: [
      { id: 'sec-products-grid', type: 'productsGrid', title: 'منتجات المتجر', enabled: true },
      { id: 'sec-items-list', type: 'itemsList', title: 'الأقسام والتصنيفات', enabled: true },
      { id: 'sec-store-features', type: 'storeFeatures', title: 'مميزات المتجر', enabled: true }
    ],
    homeSections: {
      // 1. بانر متحرك / سلايدر
      bannerSlider: {
        enabled: false,
        title: 'بانرات العروض المتحركة',
        autoplay: true,
        borderRadius: '2px',
        slides: []
      },
      // 2. صور مربعة
      squareImages: {
        enabled: false,
        title: 'تسوق حسب الفئات المميزة',
        items: []
      },
      // 3. منتجات متحركة (سلايدر عرض المنتجات المميزة)
      movingProducts: {
        enabled: true,
        title: 'منتجات مختارة لك',
        subtitle: 'أكثر المنتجات طلباً وتفضيلاً لدى عملائنا',
        sourceType: 'all', // 'all' (كل المنتجات), 'category' (تصنيف محدد), 'custom' (منتجات محددة باليد)
        selectedCategory: 'الكل',
        selectedProductIds: []
      },
      // 4. قائمة عناصر وتصنيفات
      itemsList: {
        enabled: true,
        title: 'تصفح كافة الأقسام والتصنيفات',
        layout: 'grid' // 'grid' أو 'chips'
      },
      // 5. بانر عريض إعلاني
      wideBanner: {
        enabled: true,
        title: '',
        subtitle: '',
        buttonText: '',
        imageUrl: 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=1400&auto=format&fit=crop&q=80'
      }
    }
  };
});

  const formatPrice = (priceInUsd, targetCurrency = activeCurrency) => {
    const numPrice = Number.isFinite(parseFloat(priceInUsd)) ? parseFloat(priceInUsd) : 0;
    if (targetCurrency === 'IQD') {
      const iqdPrice = Math.round(numPrice * (parseFloat(storeConfig.usdToIqdRate) || 1310));
      return `${iqdPrice.toLocaleString('en-US')} د.ع`;
    }
    return `$${numPrice.toFixed(2)}`;
  };

  const availableFonts = [
    { id: 'DIN Next LT Arabic', name: 'DIN Next LT Arabic (خط سلة الافتراضي الرسمي ⭐)' },
    { id: 'Tajawal', name: 'Tajawal (خط تجوال - سلة بديل)' },
    { id: 'Cairo', name: 'Cairo (كايرو الحديث)' },
    { id: 'Almarai', name: 'Almarai (المراعي)' },
    { id: 'Alexandria', name: 'Alexandria (الإسكندرية)' }
  ];

  // ref لتتبع أحدث قيمة لإعدادات المتجر بدون إعادة تشغيل الـ effects
  const storeConfigRef = useRef(storeConfig);
  useEffect(() => { storeConfigRef.current = storeConfig; }, [storeConfig]);

  const sizeSpecs = {
    2: { desktopSize: '1200 × 500 بكسل', mobileSize: '600 × 350 بكسل', ratio: '16:7', cardHeight: 'h-48 sm:h-64', gridClass: 'grid-cols-1 sm:grid-cols-2' },
    3: { desktopSize: '800 × 500 بكسل', mobileSize: '500 × 350 بكسل', ratio: '16:10', cardHeight: 'h-44 sm:h-56', gridClass: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' },
    4: { desktopSize: '600 × 450 بكسل', mobileSize: '400 × 350 بكسل', ratio: '4:3', cardHeight: 'h-40 sm:h-52', gridClass: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' },
    6: { desktopSize: '400 × 400 بكسل', mobileSize: '300 × 300 بكسل', ratio: '1:1', cardHeight: 'h-36 sm:h-44', gridClass: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' }
  };

  const currentSizeInfo = sizeSpecs[storeConfig.itemsPerRow] || sizeSpecs[3];

  // 2. التصنيفات المتنوعة للمتجر - تحميل فوري لحظي دون أي تأخير
  const [categories, setCategories] = useState(() => {
    try {
      const saved = localStorage.getItem('haider_store_categories');
      if (saved) {
        let parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // استبعاد التصنيفات التجريبية التلقائية القديمة
          parsed = parsed.filter(c => c && !['cat-1', 'cat-2', 'cat-3', 'cat-4'].includes(c.id) && c.name !== 'الكل' && c.id !== 'all');
          if (parsed.length > 0) return parsed;
        }
      }
    } catch {}
    return Array.isArray(bundledInitialCategories) && bundledInitialCategories.length > 0 ? bundledInitialCategories : [];
  });

  const [selectedCat, setSelectedCat] = useState('الكل');

  // 3. المنتجات - عرض فوري لحظي دون أي تأخير عند فتح الرابط
  const [products, setProducts] = useState(() => {
    try {
      const saved = localStorage.getItem('haider_store_products');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // دمج المنتجات المحلية مع الكاش المدمج: أضف أي منتج في الكاش غير موجود محلياً
          // هذا يضمن ظهور المنتجات الجديدة حتى لو كان localStorage قديماً
          if (Array.isArray(bundledInitialProducts) && bundledInitialProducts.length > 0) {
            const localIds = new Set(parsed.map(p => String(p.id)));
            const missingFromLocal = bundledInitialProducts.filter(p => !localIds.has(String(p.id)));
            if (missingFromLocal.length > 0) {
              return [...parsed, ...missingFromLocal];
            }
          }
          return parsed;
        }
      }
    } catch {}
    // إذا كان أول دخول للمتصفح، يتم تحميل قائمة المنتجات المدمجة فوراً في أول جزء من الثانية
    return Array.isArray(bundledInitialProducts) && bundledInitialProducts.length > 0 ? bundledInitialProducts : [];
  });
  // ref لتتبع أحدث قيمة للمنتجات بدون إعادة تشغيل الـ effects
  const productsRef = useRef(products);

  // 4. الطلبات
  const [orders, setOrders] = useState(() => {
    try {
      // تنظيف الطلبات الوهمية القديمة إذا لم تكن ممسوحة مسبقاً
      const dummyCleared = localStorage.getItem('haider_orders_dummy_cleared_v1');
      if (!dummyCleared) {
        localStorage.removeItem('haider_store_orders');
        localStorage.setItem('haider_orders_dummy_cleared_v1', 'true');
        return [];
      }
      let deletedIds = new Set();
      try {
        const savedDeleted = localStorage.getItem('haider_deleted_order_ids');
        if (savedDeleted) deletedIds = new Set(JSON.parse(savedDeleted));
      } catch {}

      const saved = localStorage.getItem('haider_store_orders');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(o => !deletedIds.has(String(o.id)));
        }
      }
    } catch {}
    return [];
  });

  // 5. العملاء والمستخدمين المسجلين (مربوطة حياً مع Firestore)
  const [customers, setCustomers] = useState(() => {
    try {
      const saved = localStorage.getItem('haider_store_customers');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  // فتح المتجر وعرض المنتجات مباشرة وفوراً مثل المتاجر الكبرى بدون أي شاشة انتظار معطلة
  const [isInitialSyncing, setIsInitialSyncing] = useState(false);

  // حفظ فوري في التخزين المحلي (localStorage) عند أي تعديل أو حذف
  useEffect(() => {
    try {
      localStorage.setItem('haider_store_config', JSON.stringify(storeConfig));
      localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
    } catch {}

    // تحديث عنوان تبويب الصفحة (Page Title) تلقائياً
    if (storeConfig.pageTitle || storeConfig.name) {
      document.title = storeConfig.pageTitle || storeConfig.name;
    }

    // تحديث أيقونة الموقع (Favicon) تلقائياً إذا كان هناك لوقو أو أيقونة مخصصة
    const faviconUrl = storeConfig.faviconUrl || storeConfig.logoUrl;
    if (faviconUrl) {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.getElementsByTagName('head')[0].appendChild(link);
      }
      link.href = faviconUrl;
    }
  }, [storeConfig]);

  // تحديث productsRef دائماً عند أي تغيير في المنتجات (بدون إعادة تشغيل effects أخرى)
  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  // حقن الخطوط المخصصة المحفوظة سحابياً أو محلياً

  useEffect(() => {
    try {
      const saved = localStorage.getItem('custom_store_fonts');
      const localFonts = saved ? JSON.parse(saved) : [];
      const cloudFonts = Array.isArray(storeConfig?.customFonts) ? storeConfig.customFonts : [];
      const allFontsMap = new Map();
      [...cloudFonts, ...localFonts].forEach(f => { if (f && f.id) allFontsMap.set(f.id, f); });
      allFontsMap.forEach((f) => {
        const existing = document.getElementById(`app-font-style-${f.id}`);
        if (!existing && f.dataUrl) {
          const style = document.createElement('style');
          style.id = `app-font-style-${f.id}`;
          style.textContent = `
            @font-face {
              font-family: '${f.name}';
              src: url('${f.dataUrl}') format('${f.format || 'truetype'}');
              font-weight: normal;
              font-style: normal;
              font-display: swap;
            }
          `;
          document.head.appendChild(style);
        }
      });
    } catch {}
  }, [storeConfig?.customFonts]);

  useEffect(() => {
    try {
      if (Array.isArray(products) && products.length > 0) {
        localStorage.setItem('haider_store_products', JSON.stringify(products));
      }
    } catch {}
  }, [products]);

  useEffect(() => {
    try {
      localStorage.setItem('haider_store_categories', JSON.stringify(categories));
    } catch {}
  }, [categories]);

  useEffect(() => {
    try {
      localStorage.setItem('haider_store_orders', JSON.stringify(orders));
    } catch {}
  }, [orders]);

  useEffect(() => {
    try {
      localStorage.setItem('haider_store_customers', JSON.stringify(customers));
    } catch {}
  }, [customers]);

  // مزامنة حالة العميل المسجل حالياً مع قائمة العملاء عند تحديث الرصيد أو البيانات فورياً
  useEffect(() => {
    if (currentUser && Array.isArray(customers) && customers.length > 0) {
      const curId = String(currentUser.id || '').trim();
      const curEmail = String(currentUser.email || '').trim().toLowerCase();
      const curPhone = String(currentUser.phone || '').trim();
      const curIdent = String(currentUser.identifier || '').trim().toLowerCase();

      const matched = customers.find(c => {
        if (!c || typeof c !== 'object') return false;
        const cId = String(c.id || '').trim();
        const cEmail = String(c.email || '').trim().toLowerCase();
        const cPhone = String(c.phone || '').trim();
        const cIdent = String(c.identifier || '').trim().toLowerCase();

        // مطابقة صارمة بحقول غير فارغة فقط لمنع خلط الحسابات التي تشترك في نصوص فارغة
        if (curId && cId && curId === cId) return true;
        if (curEmail && cEmail && curEmail === cEmail) return true;
        if (curPhone && cPhone && curPhone.length >= 7 && curPhone === cPhone) return true;
        if (curIdent && cIdent && curIdent.length >= 3 && curIdent === cIdent) return true;
        return false;
      });

      if (matched) {
        // نضمن دائماً تطبيق readNotifIdsRef على إشعارات matched قبل المقارنة والدمج
        const normalizedMatchedNotifs = (matched.notifications || []).map(n => ({
          ...n,
          read: (n.read || readNotifIdsRef.current.has(String(n.id)) || (n.topupId && readNotifIdsRef.current.has(`topup-${n.topupId}`))) ? true : false
        }));

        if (
          matched.balance !== currentUser.balance || 
          matched.points !== currentUser.points ||
          (matched.role && matched.role !== currentUser.role) ||
          JSON.stringify(normalizedMatchedNotifs) !== JSON.stringify(currentUser.notifications || [])
        ) {
          // إذا وصل إشعار جديد فعلياً (وليس تم فقط تحديث حالته كمقروء)، أطلق إشعار النظام والبانر المباشر فوراً
          const newNotifs = normalizedMatchedNotifs;
          const oldNotifs = Array.isArray(currentUser.notifications) ? currentUser.notifications : [];
          if (newNotifs.length > oldNotifs.length) {
            const latest = newNotifs[0];
            if (latest && !latest.read) {
              showNotificationBanner(latest.title || 'إشعار جديد', latest.message || '', latest.type || 'wallet');
            }
          }

          // نحافظ على هوية العميل الحالي (الاسم، المعرف، البريد، الهاتف) ونحدث فقط الحقول التراكمية
          const merged = {
            ...currentUser,
            balance: matched.balance !== undefined ? matched.balance : currentUser.balance,
            points: matched.points !== undefined ? matched.points : currentUser.points,
            tier: matched.tier || currentUser.tier,
            status: matched.status || currentUser.status,
            role: matched.role || currentUser.role,
            walletTransactions: matched.walletTransactions || currentUser.walletTransactions,
            notifications: normalizedMatchedNotifs
          };
          setCurrentUser(merged);
          try {
            localStorage.setItem('haider_current_user', JSON.stringify(merged));
          } catch (e) {}
        }
      }
    }
  }, [customers]);

  // مؤقت أمان لإغلاق شاشة الانتظار تلقائياً في حال بطء أو انقطاع الإنترنت (بحد أقصى 1.8 ثانية)
  useEffect(() => {
    if (isInitialSyncing) {
      const safetyTimer = setTimeout(() => {
        setIsInitialSyncing(false);
      }, 1800);
      return () => clearTimeout(safetyTimer);
    }
  }, [isInitialSyncing]);

  // مزامنة حية وفورية من Supabase (Real-time Cloud Sync)
  useEffect(() => {
    let receivedConfig = false;
    let receivedProducts = false;

    const checkSyncDone = () => {
      if (receivedConfig || receivedProducts) {
        setIsInitialSyncing(false);
      }
    };

    const unsubscribe = subscribeToStoreData({
      onConfigUpdate: (cloudConfig, cloudUpdatedAt) => {
        receivedConfig = true;
        checkSyncDone();
        if (cloudConfig && typeof cloudConfig === 'object') {
          const sanitizedConfig = { ...cloudConfig };
          if (sanitizedConfig.homeSections?.productsGrid?.buttonText) {
            const bt = sanitizedConfig.homeSections.productsGrid.buttonText;
            if (bt.includes('المبادلة') || bt.includes('قسم')) {
              sanitizedConfig.homeSections.productsGrid.buttonText = 'إضافة للسلة';
            }
          }
          if (Array.isArray(sanitizedConfig.homeLayout)) {
            sanitizedConfig.homeLayout = sanitizedConfig.homeLayout.map(sec => {
              if (sec.type === 'productsGrid' && sec.data?.buttonText) {
                const b = sec.data.buttonText;
                if (b.includes('المبادلة') || b.includes('قسم')) {
                  return { ...sec, data: { ...sec.data, buttonText: 'إضافة للسلة' } };
                }
              }
              return sec;
            });
          }
          setStoreConfig(prev => ({ ...prev, ...sanitizedConfig }));
        }
      },
      onProductsUpdate: (cloudProducts, cloudUpdatedAt) => {
        receivedProducts = true;
        checkSyncDone();
        if (Array.isArray(cloudProducts) && cloudProducts.length > 0) {
          const now = typeof cloudUpdatedAt === 'number' ? cloudUpdatedAt : Date.now();
          try {
            localStorage.setItem('haider_store_products', JSON.stringify(cloudProducts));
            localStorage.setItem('haider_store_products_updatedAt', String(now));
          } catch (e) {}
          setProducts(cloudProducts);
        }
      },
      onCategoriesUpdate: (cloudCategories, cloudUpdatedAt) => {
        if (Array.isArray(cloudCategories) && cloudCategories.length > 0) {
          const filteredCloudCategories = cloudCategories.filter(c => c && c.name !== 'الكل' && c.id !== 'all');
          const now = typeof cloudUpdatedAt === 'number' ? cloudUpdatedAt : Date.now();
          try {
            localStorage.setItem('haider_store_categories', JSON.stringify(filteredCloudCategories));
            localStorage.setItem('haider_store_categories_updatedAt', String(now));
          } catch (e) {}
          setCategories(filteredCloudCategories);
        }
      },
      onCustomersUpdate: (cloudCustomers) => {
        if (Array.isArray(cloudCustomers)) {
          setCustomers(cloudCustomers);
          // تحديث بيانات ورصيد العميل الحالي بأمان تام وبدون أي خلط بين الحسابات
          try {
            const savedCur = localStorage.getItem('haider_current_user');
            if (savedCur) {
              const parsedCur = JSON.parse(savedCur);
              if (parsedCur && typeof parsedCur === 'object') {
                // التأكد الصارم من وجود معرّف حقيقي غير فارغ لمنع المطابقات الخاطئة
                const curId = String(parsedCur.id || '').trim();
                const curEmail = String(parsedCur.email || '').trim().toLowerCase();
                const curPhone = String(parsedCur.phone || '').trim();
                const curIdent = String(parsedCur.identifier || '').trim().toLowerCase();

                const match = cloudCustomers.find(c => {
                  if (!c || typeof c !== 'object') return false;
                  const cId = String(c.id || '').trim();
                  const cEmail = String(c.email || '').trim().toLowerCase();
                  const cPhone = String(c.phone || '').trim();
                  const cIdent = String(c.identifier || '').trim().toLowerCase();

                  if (curId && cId && curId === cId) return true;
                  if (curEmail && cEmail && curEmail === cEmail) return true;
                  if (curPhone && cPhone && curPhone === cPhone && curPhone.length >= 7) return true;
                  if (curIdent && cIdent && curIdent === cIdent && curIdent.length >= 3) return true;
                  return false;
                });

                if (match) {
                  // نحدث فقط البيانات التراكمية (الرصيد، النقاط) دون استبدال هوية المستخدم الأساسية إذا كانت مختلفة
                  setCurrentUser(prev => {
                    const base = prev || parsedCur;

                    // ✅ إصلاح: استخدام readNotifIdsRef (Set ثابت) لمنع إعادة ظهور الإشعارات المقروءة
                    // readNotifIdsRef يحتفظ بـ IDs الإشعارات المقروءة حتى لو تأخّر Supabase في الحفظ
                    const cloudNotifs = match.notifications || [];
                    const localNotifs = base.notifications || [];
                    const mergedNotifs = cloudNotifs.map(n => ({
                      ...n,
                      // إذا كان الـ ID مسجّلاً كمقروء في الـ ref، نُبقيه مقروءاً دائماً
                      read: (n.read || readNotifIdsRef.current.has(String(n.id)) || (n.topupId && readNotifIdsRef.current.has(`topup-${n.topupId}`))) ? true : false
                    }));

                    const merged = {
                      ...base,
                      balance: match.balance !== undefined ? match.balance : base.balance,
                      points: match.points !== undefined ? match.points : base.points,
                      tier: match.tier || base.tier,
                      status: match.status || base.status,
                      notifications: mergedNotifs.length > 0 ? mergedNotifs : localNotifs,
                      walletTransactions: match.walletTransactions || base.walletTransactions,
                      role: match.role || base.role
                    };
                    try {
                      localStorage.setItem('haider_current_user', JSON.stringify(merged));
                    } catch (e) {}
                    return merged;
                  });
                }
              }
            }
          } catch (e) {}
        }
      },
      onOrdersUpdate: (cloudOrders) => {
        if (Array.isArray(cloudOrders)) {
          // تصفية الطلبات التي حُذفت محلياً لمنع إعادة ظهورها من Supabase
          const filtered = cloudOrders.filter(o => !deletedOrderIdsRef.current.has(String(o.id)));
          setOrders(filtered);
          try {
            localStorage.setItem('haider_store_orders', JSON.stringify(filtered));
          } catch (e) {}
        }
      },
      onCouponsUpdate: (cloudCoupons) => {
        if (Array.isArray(cloudCoupons)) {
          try {
            localStorage.setItem('haider_store_coupons', JSON.stringify(cloudCoupons));
          } catch (e) {}
        }
      },
      onTopupsUpdate: (cloudTopups) => {
        if (Array.isArray(cloudTopups)) {
          let localTopups = [];
          try {
            const saved = localStorage.getItem('haider_store_topups');
            if (saved) localTopups = JSON.parse(saved) || [];
          } catch (e) {}

          // إذا السحابة فارغة ولكن المحمول عليه طلبات محلية سابقة، ارفعها للسحابة
          if (cloudTopups.length === 0 && localTopups.length > 0) {
            syncTopupsToCloud(localTopups);
            setTopupRequests(localTopups);
          } else {
            // دمج أي طلب محلي حديث غير موجود في السحابة لضمان عدم ضياع أي طلب
            const cloudIds = new Set(cloudTopups.map(t => String(t.id)));
            const missingFromCloud = localTopups.filter(t => !cloudIds.has(String(t.id)));
            const merged = [...cloudTopups, ...missingFromCloud];
            setTopupRequests(merged);
            try {
              localStorage.setItem('haider_store_topups', JSON.stringify(merged));
            } catch (e) {}
            if (missingFromCloud.length > 0) {
              syncTopupsToCloud(merged);
            }
          }
        }
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // =========================================================================
  // نظام التوجيه بالروابط (Hash Routing System): روابط حية قابلة للمشاركة لكل صفحة
  // =========================================================================
  const isUpdatingHashRef = useRef(false);

  // 1. قراءة الهاش عند تحميل المتصفح أو الضغط على زر الرجوع/التقدم
  useEffect(() => {
    const handleHashChange = () => {
      if (isUpdatingHashRef.current) return;
      const rawHash = window.location.hash.replace(/^#\/?/, '').trim();
      if (!rawHash) {
        setViewMode('store');
        setSelectedCat('الكل');
        setActiveProductForPage(null);
        setActiveCustomPage(null);
        return;
      }

      const parts = rawHash.split('/');
      const routeType = parts[0];
      const param = decodeURIComponent(parts.slice(1).join('/'));

      if (routeType === 'admin') {
        setViewMode('admin');
        if (param) setAdminSection(param);
        return;
      }

      if (routeType === 'product' && param) {
        // محاولة العثور على المنتج في الـ ref (أحدث قيمة) أو التخزين المحلي
        let allProds = productsRef.current;
        if (!allProds || allProds.length === 0) {
          try {
            const saved = localStorage.getItem('haider_store_products');
            if (saved) {
              const parsed = JSON.parse(saved);
              if (Array.isArray(parsed)) allProds = parsed;
            }
          } catch (e) {}
        }

        const paramStr = String(param).trim();
        const paramNum = parseInt(paramStr, 10);

        let found = (allProds || []).find(p => 
          String(p.id) === paramStr || 
          String(p.slug || '') === paramStr ||
          (p.sku && String(p.sku) === paramStr)
        );

        // إذا كان باراميتر الرابط رقماً تسلسلياً (مثل 1, 2, 3 أو فهرس الترتيب)
        if (!found && !isNaN(paramNum) && allProds && allProds.length > 0) {
          if (paramNum > 0 && paramNum <= allProds.length) {
            found = allProds[paramNum - 1];
          }
        }

        if (found) {
          setActiveProductForPage(found);
          setViewMode('product-detail');
          return;
        }
      }

      if (routeType === 'category' && param) {
        setSelectedCat(param);
        setViewMode(param === 'الكل' ? 'store' : 'category');
        return;
      }

      if ((routeType === 'p' || routeType === 'page') && param) {
        const pages = Array.isArray(storeConfigRef.current?.customPages) ? storeConfigRef.current.customPages : [];
        const foundPage = pages.find(p => String(p.id) === String(param) || String(p.slug || '') === String(param) || String(p.title || '') === String(param));
        if (foundPage) {
          setActiveCustomPage(foundPage);
          setViewMode('custom-page');
          return;
        }
      }

      // إذا لم يتطابق، العودة للمتجر الرئيسي
      setViewMode('store');
    };

    window.addEventListener('hashchange', handleHashChange);
    // قراءة أولية للهاش مرة واحدة فقط عند تحميل الصفحة
    handleHashChange();

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // يعمل مرة واحدة فقط - يستخدم productsRef و storeConfigRef للوصول لأحدث البيانات دائماً


  // 2. تحديث رابط الهاش في المتصفح تلقائياً عند أي تنقل في المتجر
  useEffect(() => {
    let targetHash = '';
    if (viewMode === 'admin') {
      targetHash = `#/admin${adminSection ? `/${adminSection}` : ''}`;
    } else if (viewMode === 'product-detail' && activeProductForPage) {
      targetHash = `#/product/${activeProductForPage.id}`;
    } else if (viewMode === 'category' && selectedCat && selectedCat !== 'الكل') {
      targetHash = `#/category/${encodeURIComponent(selectedCat)}`;
    } else if (viewMode === 'custom-page' && activeCustomPage) {
      targetHash = `#/p/${encodeURIComponent(activeCustomPage.slug || activeCustomPage.id)}`;
    } else if (viewMode === 'section-view' && activeSectionForPage) {
      targetHash = `#/section/${encodeURIComponent(activeSectionForPage.title || activeSectionForPage.id)}`;
    } else {
      targetHash = '#/';
    }

    if (window.location.hash !== targetHash) {
      isUpdatingHashRef.current = true;
      try {
        window.location.hash = targetHash;
      } catch (e) {}
      setTimeout(() => {
        isUpdatingHashRef.current = false;
      }, 80);
    }
  }, [viewMode, activeProductForPage, activeCustomPage, activeSectionForPage, selectedCat, adminSection]);

  // دالة موحدة للرجوع للمتجر الرئيسي
  const handleNavigateToStore = () => {
    setViewMode('store');
    setActiveProductForPage(null);
    setActiveCustomPage(null);
    setActiveSectionForPage(null);
    setSelectedCat('الكل');
    window.location.hash = '#/';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // المراجع لتتبع الحالة الحالية بدقة وفورية داخل مستمع زر / إيماءة الرجوع في الأندرويد
  const navStateRef = useRef({
    viewMode,
    activeSectionForPage,
    isCartOpen,
    isCategoryDrawerOpen,
    isAuthModalOpen,
    isAdminAuthModalOpen,
    isCurrencyMenuOpen,
    isUserMenuOpen,
    selectedProductDetails,
    selectedCat,
    searchQuery
  });

  useEffect(() => {
    navStateRef.current = {
      viewMode,
      isCartOpen,
      isCategoryDrawerOpen,
      isAuthModalOpen,
      isAdminAuthModalOpen,
      isCurrencyMenuOpen,
      isUserMenuOpen,
      selectedProductDetails,
      selectedCat,
      searchQuery
    };
  });

  // معالجة زر الرجوع وإيماءة السحب للرجوع (Android Back Gesture / Back Button)
  useEffect(() => {
    let lastBackPressTime = 0;

    const backListenerPromise = CapApp.addListener('backButton', () => {
      const state = navStateRef.current;

      // 1. إذا كانت قائمة العملة واللغة مفتوحة
      if (state.isCurrencyMenuOpen) {
        closeCurrencyMenu();
        return;
      }

      // 2. إذا كانت قائمة المستخدم المنسدلة مفتوحة
      if (state.isUserMenuOpen) {
        setIsUserMenuOpen(false);
        return;
      }

      // 3. إذا كان مودال الدخول للإدارة مفتوحاً
      if (state.isAdminAuthModalOpen) {
        setIsAdminAuthModalOpen(false);
        return;
      }

      // 4. إذا كان مودال تسجيل الدخول/الملف الشخصي مفتوحاً
      if (state.isAuthModalOpen) {
        closeAuthModal();
        return;
      }

      // 5. إذا كانت سلة المشتريات مفتوحة
      if (state.isCartOpen) {
        closeCartWithMotion();
        return;
      }

      // 6. إذا كانت قائمة الأقسام الجانبية مفتوحة
      if (state.isCategoryDrawerOpen) {
        closeCategoryDrawer();
        return;
      }

      // 7. إذا كان مودال تفاصيل المنتج السريع مفتوحاً
      if (state.selectedProductDetails) {
        setSelectedProductDetails(null);
        return;
      }

      // 8. إذا كان المستخدم في صفحة تفاصيل المنتج الكاملة
      if (state.viewMode === 'product-detail') {
        handleNavigateToStore();
        return;
      }

      // 9. إذا كان المستخدم في صفحة تعريفية مخصصة
      if (state.viewMode === 'custom-page') {
        handleNavigateToStore();
        return;
      }

      // 10. إذا كان المستخدم في صفحة تصنيف محدد
      if (state.viewMode === 'category') {
        handleNavigateToStore();
        return;
      }

      // 10.1 إذا كان المستخدم في صفحة استعراض العنصر المستقلة
      if (state.viewMode === 'section-view') {
        handleNavigateToStore();
        return;
      }

      // 11. إذا كان المستخدم في لوحة تحكم الإدارة
      if (state.viewMode === 'admin') {
        handleNavigateToStore();
        return;
      }

      // 12. إذا كان يبحث
      if (state.searchQuery) {
        setSearchQuery('');
        return;
      }

      // 13. إذا كان مخصص قسم غير الكل في المتجر الرئيسي
      if (state.selectedCat !== 'الكل') {
        setSelectedCat('الكل');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      // 14. إذا كان في الصفحة الرئيسية بالفعل: طلب ضغطة ثانية سريعة قبل إغلاق التطبيق لتفادي الخروج غير المقصود
      const now = Date.now();
      if (now - lastBackPressTime < 2000) {
        CapApp.exitApp();
      } else {
        lastBackPressTime = now;
        alert('اضغط رجوع مرة أخرى للخروج من التطبيق');
      }
    });

    return () => {
      backListenerPromise.then(handler => handler.remove());
    };
  }, []);

  const handleUpdateOrderStatus = (orderId, newStatus) => {
    setOrders(orders.map(order => order.id === orderId ? { ...order, status: newStatus } : order));
  };

  // رفع ملف باركود مخصص في إعدادات الدفع
  const handleUploadPaymentQr = (e, configKey) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) {
        alert('حجم صورة الباركود كبير! يرجى اختيار صورة أقل من 4 ميجابايت.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setStoreConfig(prev => ({ ...prev, [configKey]: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  // نموذج إضافة / تعديل منتج
  const [formProduct, setFormProduct] = useState({
    title: '', category: 'بطاقات شحن رقمية', price: '', oldPrice: '', stock: '10', imageUrl: '', badge: '', descriptionHtml: '', hasVariants: false
  });

  const [imageUploadType, setImageUploadType] = useState('file');
  const [variantsList, setVariantsList] = useState([]);

  const calculateAverageRating = (reviews) => {
    if (!reviews || reviews.length === 0) return 0;
    const sum = reviews.reduce((acc, curr) => acc + curr.rating, 0);
    return (sum / reviews.length).toFixed(1);
  };

  const filteredAndSortedProducts = useMemo(() => {
    return products
      .filter(item => {
        if (inventoryCategoryFilter !== 'الكل' && item.category !== inventoryCategoryFilter) return false;
        if (inventorySearchQuery.trim()) {
          const q = inventorySearchQuery.toLowerCase();
          if (!item.title.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q)) return false;
        }
        if (inventoryStockFilter === 'in-stock' && item.stock <= 0) return false;
        if (inventoryStockFilter === 'low-stock' && (item.stock > 10 || item.stock <= 0)) return false;
        if (inventoryStockFilter === 'out-of-stock' && item.stock > 0) return false;
        return true;
      })
      .sort((a, b) => {
        if (inventorySortBy === 'price-desc') return b.price - a.price;
        if (inventorySortBy === 'price-asc') return a.price - b.price;
        if (inventorySortBy === 'stock-desc') return b.stock - a.stock;
        if (inventorySortBy === 'stock-low') return a.stock - b.stock;
        if (inventorySortBy === 'rating') return calculateAverageRating(b.reviews) - calculateAverageRating(a.reviews);
        return b.id - a.id;
      });
  }, [products, inventoryCategoryFilter, inventorySearchQuery, inventorySortBy, inventoryStockFilter]);

  const handleAddReview = (e) => {
    e.preventDefault();
    if (!userReviewName.trim() || !userReviewComment.trim()) return;

    const newReview = {
      id: Date.now(),
      name: userReviewName.trim(),
      rating: userRating,
      comment: userReviewComment.trim(),
      date: new Date().toISOString().split('T')[0]
    };

    const updatedProducts = products.map(p => {
      if (p.id === selectedProductDetails.id) {
        const updatedReviews = [newReview, ...(p.reviews || [])];
        const updatedProd = { ...p, reviews: updatedReviews };
        setSelectedProductDetails(updatedProd);
        return updatedProd;
      }
      return p;
    });

    setProducts(updatedProducts);
    syncProductsToCloud(updatedProducts); // حفظ سحابي
    setUserReviewName('');
    setUserReviewComment('');
    showAppModal({
      title: 'تم بنجاح',
      message: 'تم إضافة تقييمك بنجاح.',
      type: 'success'
    });
  };

  function isProductRequiringInput(prod) {
    if (!prod || typeof prod !== 'object') return false;
    if (prod.productType === 'exchange') return true;
    if (typeof prod.exchangeCurrencyName === 'string' && prod.exchangeCurrencyName.trim().length > 0) return true;
    if (Array.isArray(prod.customFields) && prod.customFields.some(f => f.label?.trim() && f.required)) return true;
    return false;
  };

  const handleAddToCart = (product, selectedTier = null, userNote = '', customQuantity = 1) => {
    // إذا كان نوع المنتج يتطلب بيانات إجبارية (مثل منتج حسب الطلب أو منتج مبادلة) ولم يتم تزويدها، نوجه العميل فوراً لصفحة المنتج لكتابتها
    const requiresInput = isProductRequiringInput(product);
    const noteValue = (typeof userNote === 'string' ? userNote : '').trim();
    if (requiresInput && !noteValue) {
      setActiveProductForPage(product);
      setViewMode('product-detail');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // إذا كان للمنتج شرائح أسعار حسب الكمية وتم اختيار شريحة معينة
    const tier = (selectedTier && typeof selectedTier === 'object')
      ? selectedTier
      : (product.hasQuantityTiers && Array.isArray(product.quantityTiers) && product.quantityTiers.length > 0
          ? product.quantityTiers[0]
          : null);

    const isExchangeProd = product.productType === 'exchange' || Boolean(product.exchangeCurrencyName && String(product.exchangeCurrencyName).trim());
    const rawPrice = tier ? tier.price : product.price;
    const priceUsd = isExchangeProd ? 0 : (Number.isFinite(parseFloat(rawPrice)) ? Math.max(0, parseFloat(rawPrice)) : 0);

    // الكمية المضافة تكون دائماً ما حدده العميل أو 1 كافتراضي في كل الحالات
    const qtyToAdd = Math.max(1, parseInt(customQuantity) || 1);
    const tierId = tier ? `tier-${tier.minQuantity || 1}` : 'default';
    const noteKey = noteValue ? `-${noteValue.slice(0, 10)}` : '';
    const cartItemId = `${product.id}-${tierId}${noteKey}`;

    const existingIndex = cartItems.findIndex(item => item.cartItemId === cartItemId);

    if (existingIndex > -1) {
      const updated = [...cartItems];
      updated[existingIndex].quantity += qtyToAdd;
      setCartItems(updated);
    } else {
      setCartItems([
        ...cartItems,
        {
          cartItemId,
          productId: product.id,
          title: product.title,
          tierLabel: tier ? tier.label : null,
          priceUsd: priceUsd,
          imageUrl: product.imageUrl,
          quantity: qtyToAdd,
          productType: product.productType || 'digital',
          isPhysical: product.productType === 'physical',
          exchangeCurrencyName: product.exchangeCurrencyName || null,
          exchangeRequiredProductName: product.exchangeRequiredProductName || null,
          exchangeAmount: product.exchangeAmount || null,
          minQuantity: Math.max(1, parseInt(product.minQuantity) || 1),
          userNote: noteValue || null
        }
      ]);
    }
    // موشن السلة: اهتزاز وتكبير أيقونة السلة
    setCartBump(true);
    setTimeout(() => setCartBump(false), 700);

    // رسالة صغيرة بالخط الأسود في منتصف الشاشة من الأسفل: دخول سلس، بقاء لمدة ثانيتين، وخروج سلس
    if (cartToastTimerRef.current) {
      clearTimeout(cartToastTimerRef.current);
    }
    setCartToastMessage('تمت إضافة المنتج إلى السلة');
    requestAnimationFrame(() => {
      setCartToastVisible(true);
    });

    cartToastTimerRef.current = setTimeout(() => {
      setCartToastVisible(false); // خروج سلس بالأنيميشن
      setTimeout(() => {
        setCartToastMessage('');
      }, 350); // بعد انتهاء أنيميشن الخروج
    }, 2000); // تجلس لمدة ثانيتين كاملتين
  };

  const updateQuantity = (cartItemId, delta) => {
    setCartItems(cartItems.map(item => {
      if (item.cartItemId === cartItemId) {
        const itemMin = Math.max(1, parseInt(item.minQuantity) || 1);
        const newQty = item.quantity + delta;
        if (delta < 0 && newQty < itemMin) {
          // إذا قلل لأقل من الحد الأدنى يحذف العنصر
          return null;
        }
        return newQty > 0 ? { ...item, quantity: newQty } : null;
      }
      return item;
    }).filter(Boolean));
  };

  const removeFromCart = (cartItemId) => {
    setCartItems(cartItems.filter(item => item.cartItemId !== cartItemId));
  };

  const updateCartItemTier = (oldCartItemId, originalProduct, newTier) => {
    setCartItems(prevItems => {
      const itemToUpdate = prevItems.find(item => item.cartItemId === oldCartItemId);
      if (!itemToUpdate) return prevItems;

      const tierId = newTier.id || newTier.label;
      const noteKey = itemToUpdate.userNote ? '-' + btoa(unescape(encodeURIComponent(itemToUpdate.userNote))).substring(0, 8) : '';
      const newCartItemId = `${originalProduct.id}-${tierId}${noteKey}`;

      if (newCartItemId === oldCartItemId) return prevItems;

      const targetIndex = prevItems.findIndex(item => item.cartItemId === newCartItemId && item.cartItemId !== oldCartItemId);
      
      let newItems = [...prevItems];
      if (targetIndex !== -1) {
        newItems[targetIndex] = {
          ...newItems[targetIndex],
          quantity: newItems[targetIndex].quantity + itemToUpdate.quantity
        };
        newItems = newItems.filter(item => item.cartItemId !== oldCartItemId);
      } else {
        const itemIndex = prevItems.findIndex(item => item.cartItemId === oldCartItemId);
        newItems[itemIndex] = {
          ...itemToUpdate,
          cartItemId: newCartItemId,
          tierLabel: newTier.label,
          priceUsd: newTier.price,
        };
      }
      return newItems;
    });
  };

  // حساب وتدقيق إجمالي السلة بالتحقق من مصفوفة المنتجات الحقيقية لمنع التلاعب بالأسعار
  const calculateValidatedCartTotal = (items) => {
    if (!Array.isArray(items)) return 0;
    return items.reduce((sum, item) => {
      if (!item) return sum;
      const realProd = Array.isArray(products) ? products.find(p => String(p.id) === String(item.productId)) : null;
      let authenticPrice = item.priceUsd;
      if (realProd) {
        if (realProd.productType === 'exchange' || Boolean(realProd.exchangeCurrencyName && String(realProd.exchangeCurrencyName).trim())) {
          authenticPrice = 0;
        } else if (item.tierLabel && Array.isArray(realProd.quantityTiers)) {
          const matchedTier = realProd.quantityTiers.find(t => t.label === item.tierLabel);
          authenticPrice = matchedTier ? parseFloat(matchedTier.price) : parseFloat(realProd.price || 0);
        } else {
          authenticPrice = parseFloat(realProd.price || 0);
        }
      }
      return sum + (Math.max(0, authenticPrice || 0) * (parseInt(item.quantity) || 1));
    }, 0);
  };

  const totalCartPriceUsd = calculateValidatedCartTotal(cartItems);
  const totalCartPriceIqd = Math.round(totalCartPriceUsd * storeConfig.usdToIqdRate);
  const totalCartCount = cartItems.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopySuccessKey(key);
    setTimeout(() => setCopySuccessKey(''), 2000);
  };

  const handleProofImageUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressed = await compressImage(file, 800, 0.75);
        setPaymentTxProof(compressed);
      } catch (err) {
        const reader = new FileReader();
        reader.onloadend = () => setPaymentTxProof(reader.result);
        reader.readAsDataURL(file);
      }
    }
  };

  const createAndRegisterOrder = ({ methodName, proof = '', txId = '' }) => {
    const isIraqiMethod = methodName === 'زين كاش' || methodName === 'ماستر كارد' || methodName === 'iraqimaster' || methodName === 'zaincash';
    const primaryTotal = isIraqiMethod ? `${totalCartPriceIqd.toLocaleString('en-US')} د.ع` : `$${totalCartPriceUsd.toFixed(2)}`;
    // توليد معرف طلب فريد غير قابل للتكرار إطلاقاً
    const newOrderId = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const methodLabels = {
      binance: 'Binance Pay',
      zaincash: 'زين كاش',
      iraqimaster: 'ماستر كارد',
      okx: 'OKX Pay',
      whatsapp: 'واتساب',
      telegram: 'تيليجرام'
    };
    const cleanMethod = methodLabels[methodName] || methodName;

    const newOrder = {
      id: newOrderId,
      customer: currentUser?.name || 'عميل',
      customerId: currentUser?.id || null,
      customerIdentifier: currentUser?.identifier || null,
      customerPhone: currentUser?.phone || null,
      totalUsd: totalCartPriceUsd,
      totalFormatted: `${primaryTotal}`,
      status: 'قيد المراجعة',
      method: cleanMethod,
      proof: proof || '',
      txId: txId || (methodName === 'whatsapp' ? 'طلب عبر واتساب' : methodName === 'telegram' ? 'طلب عبر تيليجرام' : 'غير محدد'),
      date: new Date().toISOString().split('T')[0],
      items: [...cartItems]
    };

    const updatedOrdersList = [newOrder, ...orders];
    setOrders(updatedOrdersList);
    try {
      localStorage.setItem('haider_store_orders', JSON.stringify(updatedOrdersList));
    } catch (e) {}

    // خصم المخزون من المنتجات بدقة وحساب إجمالي الكميات المشتراة
    let stockChanged = false;
    const updatedProducts = products.map(p => {
      const totalBought = cartItems
        .filter(item => String(item.productId || item.id) === String(p.id))
        .reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
      if (totalBought > 0) {
        stockChanged = true;
        return { ...p, stock: Math.max(0, (parseInt(p.stock) || 0) - totalBought) };
      }
      return p;
    });

    if (stockChanged) {
      setProducts(updatedProducts);
      syncProductsToCloud(updatedProducts);
    }

    // مزامنة الطلب مع قاعدة البيانات السحابية
    syncOrderToCloud(newOrder).catch((err) => {
      console.warn("فشلت المزامنة السحابية للطلب:", err);
    });

    // إرسال إشعار فوري لبوت تيليجرام الإدارة
    try {
      const itemsText = (newOrder.items || []).map(i => `• ${i.title} (x${i.quantity || 1})`).join('\n');
      const tgMsg = `🛒 <b>طلب جديد في المتجر #${newOrderId}</b>\n\n` +
        `👤 <b>العميل:</b> ${newOrder.customer}\n` +
        `📱 <b>الهاتف/المعرف:</b> ${newOrder.customerPhone || newOrder.customerIdentifier || 'غير محدد'}\n` +
        `💳 <b>وسيلة الدفع:</b> ${newOrder.method}\n` +
        `💰 <b>المبلغ:</b> ${primaryTotal}\n\n` +
        `📦 <b>المنتجات:</b>\n${itemsText}\n\n` +
        `⏰ <b>الوقت:</b> ${new Date().toLocaleTimeString('ar-IQ')}`;
      sendTelegramNotification(storeConfig, tgMsg);
    } catch (e) {}

    return { newOrderId, primaryTotal, newOrder };
  };

  const handleWhatsAppCheckout = () => {
    if (cartItems.length === 0) return;

    // تسجيل الطلب وحفظه في قائمة الطلبات السحابية والمحلية
    const { newOrderId, primaryTotal } = createAndRegisterOrder({
      methodName: 'whatsapp',
      proof: '',
      txId: 'طلب عبر واتساب'
    });

    let message = `مرحباً، أود إتمام الطلب رقم *${newOrderId}* من *${storeConfig.name}*:\n\n`;
    cartItems.forEach((item, index) => {
      message += `${index + 1}. *${item.title}*\n`;
      if (item.tierLabel) message += `   الباقة: ${item.tierLabel}\n`;
      if (item.userNote) message += `   ✍️ بيانات/ملاحظات العميل: ${item.userNote}\n`;
      if (item.productType === 'exchange') {
        message += `   النوع: *مبادلة*\n`;
        message += `   ( المنتج المطلوب ): ${item.exchangeRequiredProductName || item.title} - الكمية: ${item.quantity}\n`;
        message += `   ( المنتج اللي نسلمك ): ${item.exchangeCurrencyName || 'مبادلة'} - الكمية: ${(item.exchangeAmount || 1) * item.quantity}\n\n`;
      } else {
        message += `   النوع: ${
          item.productType === 'physical'
            ? 'منتج ملموس'
            : item.productType === 'license'
            ? 'بطاقة رقمية'
            : item.productType === 'custom'
            ? 'منتج حسب الطلب'
            : 'منتج رقمي'
        }\n`;
        if (item.priceUsd > 0) {
          message += `   الكمية: ${item.quantity} × $${item.priceUsd} = $${(item.quantity * item.priceUsd).toFixed(2)}\n\n`;
        } else {
          message += `   الكمية: ${item.quantity}\n\n`;
        }
      }
    });

    const hasOnlyExchange = cartItems.every(it => it.productType === 'exchange');
    if (hasOnlyExchange) {
      message += `🔄 *نوع الطلب: مبادلة مباشرة (بدون مبالغ نقدية)*`;
    } else {
      message += `💰 *الإجمالي النهائي: ${primaryTotal}*`;
    }

    showAppModal({
      title: 'اكتمل الطلب بنجاح',
      message: `تم تسجيل طلبك بنجاح (${newOrderId}) وإدراجه في قائمة الطلبات! جاري نقلك إلى واتساب للتأكيد.`,
      type: 'success'
    });
    window.open(`https://wa.me/${storeConfig.whatsapp}?text=${encodeURIComponent(message)}`, '_blank');

    setCartItems([]);
    setPaymentTxProof('');
    setPaymentTxId('');
    closeCartWithMotion();
  };

  const handleTelegramCheckout = () => {
    if (cartItems.length === 0) return;

    // تسجيل الطلب وحفظه في قائمة الطلبات
    const { newOrderId, primaryTotal } = createAndRegisterOrder({
      methodName: 'telegram',
      proof: '',
      txId: 'طلب عبر تيليجرام'
    });

    let message = `مرحباً، أود تأكيد الطلب رقم ${newOrderId} من متجر ${storeConfig.name}:\n\n`;
    cartItems.forEach((item, index) => {
      message += `${index + 1}. ${item.title}\n`;
      if (item.tierLabel) message += `   الباقة: ${item.tierLabel}\n`;
      if (item.userNote) message += `   ✍️ بيانات/ملاحظات العميل: ${item.userNote}\n`;
      if (item.productType === 'exchange') {
        message += `   النوع: مبادلة مباشرة\n`;
        message += `   - المنتج المطلوب: ${item.title} (الكمية: ${item.quantity})\n`;
        message += `   - المنتج اللي نسلمك: ${item.exchangeCurrencyName || 'مبادلة'} (الكمية: ${(item.exchangeAmount || 1) * item.quantity})\n\n`;
      } else {
        message += `   النوع: ${
          item.productType === 'physical'
            ? 'منتج ملموس'
            : item.productType === 'license'
            ? 'بطاقة رقمية'
            : item.productType === 'custom'
            ? 'منتج حسب الطلب'
            : 'منتج رقمي'
        }\n`;
        if (item.priceUsd > 0) {
          message += `   الكمية: ${item.quantity} × $${item.priceUsd} = $${(item.quantity * item.priceUsd).toFixed(2)}\n\n`;
        } else {
          message += `   الكمية: ${item.quantity}\n\n`;
        }
      }
    });

    const hasOnlyExchange = cartItems.every(it => it.productType === 'exchange');
    if (hasOnlyExchange) {
      message += `🔄 نوع الطلب: مبادلة مباشرة (بدون مبالغ نقدية)`;
    } else {
      message += `💰 الإجمالي النهائي: ${primaryTotal}`;
    }

    showAppModal({
      title: 'اكتمل الطلب بنجاح',
      message: `تم تسجيل طلبك بنجاح (${newOrderId}) وإدراجه في قائمة الطلبات! جاري نقلك إلى تيليجرام للتأكيد.`,
      type: 'success'
    });

    // إتاحة نسخ تفاصيل الطلب للحافظة لتسهيل اللصق في المحادثة
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(message);
      }
    } catch (e) {}

    const cleanTelegramUsername = (storeConfig.telegram || '').replace('@', '').trim();
    if (cleanTelegramUsername) {
      // فتح تيليجرام برابط المعرف ورسالة الطلب المرفقة
      window.open(`https://t.me/${cleanTelegramUsername}?text=${encodeURIComponent(message)}`, '_blank');
    } else {
      window.open(`https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${encodeURIComponent(message)}`, '_blank');
    }

    setCartItems([]);
    setPaymentTxProof('');
    setPaymentTxId('');
    closeCartWithMotion();
  };

  // دالة إرسال الإشعارات للعميل
  const sendNotification = (targetIdentifierOrId, notif) => {
    const newNotif = {
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title: notif.title || 'إشعار جديد',
      message: notif.message || '',
      type: notif.type || 'info',
      date: new Date().toISOString(),
      read: false
    };

    // دالة مساعدة لتحديد ما إذا كان المستخدم يطابق الفئة أو المعرف المستهدف
    const matchesTarget = (user) => {
      if (!user) return false;
      if (targetIdentifierOrId === 'all') return true;
      if (targetIdentifierOrId === 'group-customers') return user.role === 'customer' || !user.role;
      if (targetIdentifierOrId === 'group-supervisors') return user.role === 'supervisor';
      if (targetIdentifierOrId === 'group-admins') return user.role === 'admin';
      if (targetIdentifierOrId === 'group-active') return user.status === 'نشط' || !user.status;
      if (targetIdentifierOrId === 'group-tier-vip') return user.tier === 'vip' || user.tier === 'gold';
      // مطابقة فردية بالـ id أو الهاتف أو البريد أو المعرف
      return (
        user.id === targetIdentifierOrId ||
        user.identifier === targetIdentifierOrId ||
        user.phone === targetIdentifierOrId ||
        user.email === targetIdentifierOrId ||
        user.name === targetIdentifierOrId
      );
    };

    setCustomers(prev => {
      let anyMatched = false;
      const updated = prev.map(c => {
        if (matchesTarget(c)) {
          anyMatched = true;
          const currentList = Array.isArray(c.notifications) ? c.notifications : [];
          if (currentList.some(n => n.id === newNotif.id || (n.title === newNotif.title && n.message === newNotif.message && Date.now() - new Date(n.date).getTime() < 5000))) {
            return c;
          }
          const u = {
            ...c,
            notifications: [newNotif, ...currentList]
          };
          syncCustomerToCloud(u);
          return u;
        }
        return c;
      });
      try {
        localStorage.setItem('haider_store_customers', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });

    if (currentUser && matchesTarget(currentUser)) {
      const curList = Array.isArray(currentUser.notifications) ? currentUser.notifications : [];
      if (!curList.some(n => n.id === newNotif.id || (n.title === newNotif.title && n.message === newNotif.message && Date.now() - new Date(n.date).getTime() < 5000))) {
        const merged = { ...currentUser, notifications: [newNotif, ...curList] };
        setCurrentUser(merged);
        try {
          localStorage.setItem('haider_current_user', JSON.stringify(merged));
        } catch (e) {}
      }
      showNotificationBanner(newNotif.title, newNotif.message, newNotif.type || 'info');
    }
  };

  // إرسال طلب شحن رصيد المحفظة من قبل العميل
  const handleSendTopupRequest = (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const amount = parseFloat(topupAmountUsd);
    if (!amount || amount <= 0) {
      alert('يرجى إدخال مبلغ شحن صحيح.');
      return;
    }
    if (!topupProof) {
      alert('يرجى إرفاق صورة إشعار التحويل البنكي أو المحفظة.');
      return;
    }

    const newTopup = {
      id: `TOP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`,
      customerId: currentUser.id,
      customerName: currentUser.name,
      customerIdentifier: currentUser.identifier || currentUser.phone || currentUser.email,
      customerPhone: currentUser.phone,
      amountUsd: amount,
      amountIqd: Math.round(amount * storeConfig.usdToIqdRate),
      method: topupMethod,
      proof: topupProof,
      note: topupNote.trim(),
      status: 'معلق',
      date: new Date().toISOString()
    };

    const updated = [newTopup, ...topupRequests];
    setTopupRequests(updated);
    try {
      localStorage.setItem('haider_store_topups', JSON.stringify(updated));
    } catch (e) {}
    syncTopupsToCloud(updated);

    // إشعار تيليجرام فوري للمدير عند طلب شحن محفظة
    try {
      const tgMsg = `💳 <b>طلب شحن محفظة جديد #${newTopup.id}</b>\n\n` +
        `👤 <b>العميل:</b> ${newTopup.customerName}\n` +
        `📱 <b>المعرف/الهاتف:</b> ${newTopup.customerIdentifier || newTopup.customerPhone || 'غير محدد'}\n` +
        `💵 <b>المبلغ المطلوب:</b> $${newTopup.amountUsd} (${newTopup.amountIqd?.toLocaleString('en-US')} د.ع)\n` +
        `🏦 <b>وسيلة التحويل:</b> ${newTopup.method}\n` +
        (newTopup.note ? `📝 <b>ملاحظة:</b> ${newTopup.note}\n` : '') +
        `\n⏰ <i>يرجى فتح لوحة التحكم لمراجعة الإشعار واعتماد الرصيد</i>`;
      sendTelegramNotification(storeConfig, tgMsg);
    } catch (e) {}

    // إشعار العميل باستلام طلبه
    const notif = {
      id: `notif-${Date.now()}`,
      title: 'تم استلام طلب شحن المحفظة',
      message: `طلب شحن بقيمة $${amount} قيد مراجعة الإدارة الآن. سيصلك إشعار فور اعتماده.`,
      type: 'wallet',
      date: new Date().toISOString(),
      read: false
    };

    // إشعار فوري لمدير المتجر والمشرفين يظهر باللون الأحمر الغامق
    const adminTopupNotif = {
      id: `notif-admin-topup-${newTopup.id}-${Date.now()}`,
      title: 'طلب شحن محفظة جديد 💳',
      message: `قام العميل ${newTopup.customerName} بطلب شحن رصيد بقيمة $${amount} (${newTopup.method}). يرجى مراجعة إشعار التحويل واعتماده.`,
      type: 'admin-topup',
      topupId: newTopup.id,
      amount: amount,
      date: new Date().toISOString(),
      read: false
    };

    // تحديث إشعارات جميع المديرين والمشرفين في قائمة العملاء ومزامنتها
    setCustomers(prevCustomers => {
      const updatedList = prevCustomers.map(c => {
        if (c.role === 'admin' || c.role === 'supervisor') {
          const updatedC = {
            ...c,
            notifications: [adminTopupNotif, ...(c.notifications || [])]
          };
          syncCustomerToCloud(updatedC);
          return updatedC;
        }
        return c;
      });
      try {
        localStorage.setItem('haider_store_customers', JSON.stringify(updatedList));
      } catch (e) {}
      return updatedList;
    });

    const isCurrentAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor');
    const userNotifications = isCurrentAdmin
      ? [adminTopupNotif, notif, ...(currentUser.notifications || [])]
      : [notif, ...(currentUser.notifications || [])];

    const updatedUser = {
      ...currentUser,
      notifications: userNotifications
    };
    setCurrentUser(updatedUser);
    try {
      localStorage.setItem('haider_current_user', JSON.stringify(updatedUser));
    } catch (e) {}
    syncCustomerToCloud(updatedUser);

    if (isCurrentAdmin) {
      showNotificationBanner('💳 طلب شحن جديد!', `طلب شحن من ${newTopup.customerName} بقيمة $${amount}`, 'admin-topup');
    }

    alert(`✅ تم إرسال طلب الشحن بنجاح (${newTopup.id})! سيتم مراجعته وإيداع الرصيد في محفظتك قريباً.`);
    setIsTopupModalOpen(false);
    setTopupAmountUsd('');
    setTopupProof('');
    setTopupNote('');
  };

  // استبدال نقاط الولاء والمكافآت برصيد محفظة
  const handleRedeemLoyaltyPoints = () => {
    if (!currentUser) return;
    const loyaltyCfg = storeConfig.loyaltyConfig || { enabled: true, spendUsdPerPoint: 10, pointsPerUsd: 10 };
    if (loyaltyCfg.enabled === false) {
      alert('نظام نقاط الولاء متوقف حالياً من قِبل إدارة المتجر.');
      return;
    }
    const pointsPerUsd = Math.max(1, parseFloat(loyaltyCfg.pointsPerUsd) || 10);
    const pts = Math.max(0, parseInt(currentUser.points || 0) || 0);
    if (pts < pointsPerUsd) {
      alert(`الحد الأدنى لاستبدال النقاط هو ${pointsPerUsd} نقطة (تساوي $1 دولار).`);
      return;
    }

    const pointsToConvert = Math.floor(pts / pointsPerUsd) * pointsPerUsd;
    const usdToAdd = parseFloat((pointsToConvert / pointsPerUsd).toFixed(2));
    if (isNaN(usdToAdd) || usdToAdd <= 0) return;

    const currentBal = Math.max(0, parseFloat(currentUser.balance || 0) || 0);
    const newBal = parseFloat((currentBal + usdToAdd).toFixed(2));
    const remainingPts = Math.max(0, pts - pointsToConvert);

    const newTx = {
      id: `tx_${Date.now()}`,
      type: 'deposit',
      amount: usdToAdd,
      balanceAfter: newBal,
      title: `استبدال نقاط ولاء (${pointsToConvert} نقطة)`,
      date: new Date().toISOString()
    };

    const notif = {
      id: `notif-${Date.now()}`,
      title: 'استبدال نقاط المكافآت بنجاح ⭐',
      message: `تم تحويل ${pointsToConvert} نقطة إلى $${usdToAdd} وإيداعها في محفظتك!`,
      type: 'wallet',
      date: new Date().toISOString(),
      read: false
    };

    const updatedUser = {
      ...currentUser,
      balance: newBal,
      points: remainingPts,
      walletTransactions: [newTx, ...(currentUser.walletTransactions || [])],
      notifications: [notif, ...(currentUser.notifications || [])]
    };

    setCurrentUser(updatedUser);
    setCustomers(prev => prev.map(c => c.id === updatedUser.id ? updatedUser : c));
    try {
      localStorage.setItem('haider_current_user', JSON.stringify(updatedUser));
      localStorage.setItem('haider_store_customers', JSON.stringify(customers.map(c => c.id === updatedUser.id ? updatedUser : c)));
    } catch (e) {}
    syncCustomerToCloud(updatedUser);

    alert(`🎉 تم تحويل ${pointsToConvert} نقطة بنجاح إلى $${usdToAdd} في محفظتك!`);
  };

  // إرسال تقييم طلب مكتمل مع إرفاق لقطة شاشة
  const handleSubmitOrderReview = (e) => {
    e.preventDefault();
    if (!reviewModalOrder || !currentUser) return;

    const targetProdId = reviewModalProductId || reviewModalOrder.items?.[0]?.productId || reviewModalOrder.items?.[0]?.id;

    const newRev = {
      id: `rev-${Date.now()}`,
      orderId: reviewModalOrder.id,
      customerName: currentUser.name || 'عميل',
      rating: reviewModalRating,
      comment: reviewModalComment.trim(),
      photoUrl: reviewModalPhoto || '',
      date: new Date().toISOString().split('T')[0]
    };

    const updatedProds = products.map(p => {
      if (p.id === targetProdId || (reviewModalOrder.items && reviewModalOrder.items.some(it => it.title === p.title))) {
        return {
          ...p,
          reviews: [newRev, ...(p.reviews || [])]
        };
      }
      return p;
    });

    setProducts(updatedProds);
    try {
      localStorage.setItem('haider_store_products', JSON.stringify(updatedProds));
    } catch (e) {}
    syncProductsToCloud(updatedProds);

    const updatedOrds = orders.map(o => o.id === reviewModalOrder.id ? { ...o, reviewed: true } : o);
    setOrders(updatedOrds);
    try {
      localStorage.setItem('haider_store_orders', JSON.stringify(updatedOrds));
    } catch (e) {}
    syncOrderToCloud({ ...reviewModalOrder, reviewed: true });

    const notif = {
      id: `notif-${Date.now()}`,
      title: 'شكراً لتقييمك! ⭐',
      message: `تم نشر تقييمك بنجاح للطلب #${reviewModalOrder.id}. نقدر مشاركتك لتجربتك مع الآخرين.`,
      type: 'info',
      date: new Date().toISOString(),
      read: false
    };

    const updatedUser = {
      ...currentUser,
      notifications: [notif, ...(currentUser.notifications || [])]
    };
    setCurrentUser(updatedUser);
    try {
      localStorage.setItem('haider_current_user', JSON.stringify(updatedUser));
    } catch (e) {}

    alert('⭐ شكراً جزيلاً لتقييمك! تم حفظ التقييم ومشاركته بنجاح.');
    setReviewModalOrder(null);
    setReviewModalRating(5);
    setReviewModalComment('');
    setReviewModalPhoto('');
    setReviewModalProductId('');
  };

  const handleConfirmOrderWithProof = async (methodName) => {
    // فحص القفل المتزامن الفوري لمنع أي نقرات مزدوجة قبل انتهاء المعاملة السابقة
    if (isCheckingOutRef.current || isCheckingOut) {
      return;
    }

    // تفعيل القفل فوراً
    isCheckingOutRef.current = true;
    setIsCheckingOut(true);

    try {
      // 1. الدفع المباشر من رصيد المحفظة
      if (methodName === 'wallet') {
        if (!currentUser) {
          alert('يرجى تسجيل الدخول أولاً لإتمام الدفع من رصيد المحفظة.');
          setIsAuthModalOpen(true);
          return;
        }

        if (!cartItems || cartItems.length === 0) {
          alert('سلة المشتريات فارغة بالفعل!');
          return;
        }

        const orderCost = totalCartPriceUsd;
        const targetCustId = currentUser.id || currentUser.identifier?.replace(/[^a-zA-Z0-9]/g, '_');
        const newOrderId = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

        // سجل المعاملة المالية المبدئي
        const newTx = {
          id: `tx_${Date.now()}`,
          type: 'withdraw',
          amount: orderCost,
          title: `دفع للطلب رقم #${newOrderId}`
        };

        // تنفيذ المعاملة الذرية (Atomic Transaction) في Firestore
        // هذه العملية تقفل سجل العميل في السحابة وتضمن عدم إمكانية الشراء المزدوج
        let txResult;
        try {
          txResult = await atomicDeductWalletBalance(targetCustId, orderCost, newTx);
        } catch (atomicErr) {
          console.error("فشل الخصم الذري من المحفظة:", atomicErr);
          showAppModal({
            title: 'تنبيه الدفع',
            message: atomicErr.message || 'تعذر إتمام عملية الدفع من المحفظة. يرجى التحقق من اتصالك والمحاولة لاحقاً.',
            type: 'error',
            confirmText: 'حسناً',
          });
          return;
        }

      const newBal = txResult.newBalance;
      const currentBal = txResult.previousBalance;

      // حساب نقاط المكافآت المكتسبة بناءً على إعدادات نقاط الولاء
      const loyaltyCfg = storeConfig.loyaltyConfig || { enabled: true, spendUsdPerPoint: 10, pointsPerUsd: 10 };
      const isLoyaltyOn = loyaltyCfg.enabled !== false;
      const spendPerPt = Math.max(0.1, parseFloat(loyaltyCfg.spendUsdPerPoint) || 10);
      const earnedPts = isLoyaltyOn ? Math.floor(orderCost / spendPerPt) : 0;
      const newPts = (currentUser.points || 0) + earnedPts;

      const notif = {
        id: `notif-${Date.now()}`,
        title: `تم تأكيد طلبك #${newOrderId} بنجاح 🎉`,
        message: `تم خصم $${orderCost.toFixed(2)} من محفظتك. طلبك الآن قيد التنفيذ.` + (earnedPts > 0 ? ` وحصلت على ${earnedPts} نقطة مكافأة ⭐` : ''),
        type: 'wallet',
        date: new Date().toISOString(),
        read: false
      };

      const updatedUser = {
        ...currentUser,
        ...(txResult.updatedCustomer || {}),
        balance: newBal,
        points: newPts,
        notifications: [notif, ...(currentUser.notifications || [])]
      };

      setCurrentUser(updatedUser);
      setCustomers(prev => prev.map(c => c.id === updatedUser.id ? updatedUser : c));
      try {
        localStorage.setItem('haider_current_user', JSON.stringify(updatedUser));
        localStorage.setItem('haider_store_customers', JSON.stringify(customers.map(c => c.id === updatedUser.id ? updatedUser : c)));
      } catch (e) {}

      // فحص التسليم الفوري للأكواد الرقمية إن وجدت
      let assignedKeys = [];
      let prodsCopy = [...products];
      let hasProductKeyChanges = false;

      cartItems.forEach(item => {
        const prodIdx = prodsCopy.findIndex(p => p.id === item.productId || p.id === item.id || p.title === item.title);
        if (prodIdx > -1) {
          const p = prodsCopy[prodIdx];
          if (p.productType === 'license' && Array.isArray(p.licenseKeys) && p.licenseKeys.length > 0) {
            const qtyNeeded = item.quantity || 1;
            const extractedKeys = p.licenseKeys.slice(0, qtyNeeded);
            const remainingKeys = p.licenseKeys.slice(qtyNeeded);
            extractedKeys.forEach(k => {
              assignedKeys.push({
                productTitle: p.title,
                key: k
              });
            });
            prodsCopy[prodIdx] = {
              ...p,
              licenseKeys: remainingKeys,
              stock: remainingKeys.length
            };
            hasProductKeyChanges = true;
          }
        }
      });

      if (hasProductKeyChanges) {
        setProducts(prodsCopy);
        syncProductsToCloud(prodsCopy);
        try {
          localStorage.setItem('haider_store_products', JSON.stringify(prodsCopy));
        } catch (e) {}
      }

      const isAllInstantFulfilled = assignedKeys.length > 0 && cartItems.every(item => {
        const prod = products.find(p => p.id === item.productId || p.id === item.id || p.title === item.title);
        return prod && prod.productType === 'license';
      });

      // إنشاء الطلب (مكتمل فوري مع الأكواد أو قيد التنفيذ)
      const newOrder = {
        id: newOrderId,
        customer: updatedUser.name || 'عميل',
        customerId: updatedUser.id || null,
        customerIdentifier: updatedUser.identifier || null,
        customerPhone: updatedUser.phone || null,
        totalUsd: totalCartPriceUsd,
        totalFormatted: `$${totalCartPriceUsd.toFixed(2)}`,
        status: isAllInstantFulfilled ? 'مكتمل' : 'قيد التنفيذ',
        method: 'المحفظة',
        walletDeducted: true,
        walletDeductedAmount: orderCost,
        walletBalanceBefore: currentBal,
        walletBalanceAfter: newBal,
        fulfilledKeys: assignedKeys,
        proof: '',
        txId: `دفع مباشر من المحفظة - ${newTx.id}`,
        date: new Date().toISOString().split('T')[0],
        items: [...cartItems]
      };

      const updatedOrdersList = [newOrder, ...orders];
      setOrders(updatedOrdersList);
      try {
        localStorage.setItem('haider_store_orders', JSON.stringify(updatedOrdersList));
      } catch (e) {}
      syncOrderToCloud(newOrder);

      // إشعار تيليجرام للإدارة
      try {
        const tgMsg = `⚡ <b>دفع مباشر من المحفظة #${newOrderId}</b>\n\n` +
          `👤 <b>العميل:</b> ${newOrder.customer}\n` +
          `💰 <b>المبلغ:</b> $${orderCost.toFixed(2)}\n` +
          `📊 <b>الحالة:</b> ${newOrder.status}\n` +
          (assignedKeys.length > 0 ? `🔑 <b>الأكواد المسلمة:</b> ${assignedKeys.length} كود فوري\n` : '');
        sendTelegramNotification(storeConfig, tgMsg);
      } catch (e) {}

      if (assignedKeys.length > 0) {
        alert(`🎉 تم تسليم طلبك فورياً وبنجاح!\nتم خصم $${orderCost.toFixed(2)} من محفظتك وتوفير الأكواد الرقمية في قائمة طلباتك.`);
      } else {
        alert(`✅ تم الدفع بنجاح من رصيد المحفظة!\nرقم الطلب: ${newOrderId}\nالمبلغ المخصوم: $${orderCost.toFixed(2)}\nطلبك الآن "قيد التنفيذ" مباشرة.`);
      }
      setCartItems([]);
      setPaymentTxProof('');
      setPaymentTxId('');
      closeCartWithMotion();
      return;
    }

    if (!paymentTxProof) {
      alert('يرجى إرفاق صورة إشعار التحويل (لقطة الشاشة) لتأكيد الطلب.');
      return;
    }

    const { newOrderId, primaryTotal } = createAndRegisterOrder({
      methodName,
      proof: paymentTxProof,
      txId: paymentTxId
    });

    alert(`تم تسجيل طلبك بنجاح (${newOrderId}) وهو الآن "قيد المراجعة"! سيتم فتح واتساب للتأكيد.`);
    window.open(`https://wa.me/${storeConfig.whatsapp}?text=${encodeURIComponent(`طلب جديد رقم: ${newOrderId} بمبلغ ${primaryTotal}`)}`, '_blank');

      setCartItems([]);
      setPaymentTxProof('');
      setPaymentTxId('');
      closeCartWithMotion();
    } finally {
      // إتاحة النقر مجدداً بعد انتهاء العملية بالكامل وبفارق زمني أمان 600ms
      setTimeout(() => {
        isCheckingOutRef.current = false;
        setIsCheckingOut(false);
      }, 600);
    }
  };

  const handleSaveProduct = (e) => {
    e.preventDefault();
    if (!formProduct.title) return;

    const finalHtml = editorRef.current ? editorRef.current.innerHTML : formProduct.descriptionHtml;
    let basePrice = parseFloat(formProduct.price);
    let updatedList = [];

    if (editingProduct) {
      updatedList = products.map(p => p.id === editingProduct.id ? {
        ...editingProduct,
        title: formProduct.title,
        category: formProduct.category,
        price: basePrice,
        stock: parseInt(formProduct.stock) || 0,
        badge: formProduct.badge || null,
        imageUrl: formProduct.imageUrl || 'https://via.placeholder.com/500x400?text=صورة+المنتج',
        descriptionHtml: finalHtml
      } : p);
      setEditingProduct(null);
    } else {
      const newProd = {
        id: Date.now(),
        title: formProduct.title,
        category: formProduct.category,
        price: basePrice,
        stock: parseInt(formProduct.stock) || 0,
        badge: formProduct.badge || null,
        imageUrl: formProduct.imageUrl || 'https://via.placeholder.com/500x400?text=صورة+المنتج',
        descriptionHtml: finalHtml,
        reviews: []
      };
      updatedList = [newProd, ...products];
    }

    const now = Date.now();
    try {
      localStorage.setItem('haider_store_products_updatedAt', String(now));
      localStorage.setItem('haider_store_products', JSON.stringify(updatedList));
    } catch (e) {}

    setProducts(updatedList);
    syncProductsToCloud(updatedList);

    setFormProduct({ title: '', category: categories[1]?.name || 'عام', price: '', stock: '10', imageUrl: '', badge: '', descriptionHtml: '', hasVariants: false });
    setAdminSection('products');
  };

  const smoothScrollToElement = (targetElement, duration = 850) => {
    if (!targetElement) return;
    const startPosition = window.pageYOffset;
    const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - 90;
    const distance = targetPosition - startPosition;
    let startTime = null;

    const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const animationStep = (currentTime) => {
      if (startTime === null) startTime = currentTime;
      const timeElapsed = currentTime - startTime;
      const progress = Math.min(timeElapsed / duration, 1);
      window.scrollTo(0, startPosition + distance * easeInOutCubic(progress));
      if (timeElapsed < duration) {
        window.requestAnimationFrame(animationStep);
      } else {
        setIsHighlighting(true);
        setTimeout(() => setIsHighlighting(false), 1400);
      }
    };
    window.requestAnimationFrame(animationStep);
  };

  const handleCategoryClick = (catName) => {
    setActiveProductForPage(null);
    setActiveCustomPage(null);
    setSelectedCat(catName);
    
    if (catName === 'الكل') {
      setViewMode('store');
      const targetHash = '#/';
      if (window.location.hash !== targetHash) {
        isUpdatingHashRef.current = true;
        window.location.hash = targetHash;
        setTimeout(() => { isUpdatingHashRef.current = false; }, 50);
      }
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
    } else {
      setViewMode('category');
      const targetHash = `#/category/${encodeURIComponent(catName)}`;
      if (window.location.hash !== targetHash) {
        isUpdatingHashRef.current = true;
        window.location.hash = targetHash;
        setTimeout(() => { isUpdatingHashRef.current = false; }, 50);
      }
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
    }
  };

  const handleSelectVariant = (productId, variant) => {
    setSelectedVariants(prev => ({ ...prev, [productId]: variant }));
  };

  const filteredProducts = products.filter(p => {
    // إخفاء أي منتج نفذت كميته من المتجر تلقائياً
    if (isProductOutOfStock(p)) return false;

    const pCat = (p.category || '').trim();
    const curCat = (selectedCat || '').trim();

    let matchesCat = curCat === 'الكل' || curCat === '' || pCat === curCat;
    if (!matchesCat) {
      // التحقق إذا كان التصنيف المختار قسماً رئيسياً يتبعه هذا القسم الفرعي
      const selectedCatObj = categories.find(c => (c.name || '').trim() === curCat);
      if (selectedCatObj) {
        const childCats = categories.filter(c => c.parentId === selectedCatObj.id).map(c => (c.name || '').trim());
        if (childCats.includes(pCat)) {
          matchesCat = true;
        }
      }
    }
    if (!matchesCat) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return (p.title || '').toLowerCase().includes(q) || pCat.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div
      className="min-h-screen bg-[#FCFCFC] text-gray-700 font-normal leading-normal text-sm relative"
      dir="rtl"
      style={{
        fontFamily: `'${storeConfig.fontFamily}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
        fontWeight: 400
      }}
    >
      {/* شاشة تحميل أولية أنيقة وفخمة (Elegant Loader) */}
      {isInitialSyncing && (
        <div className="fixed inset-0 z-[999999] bg-gradient-to-br from-[#0b1220] to-[#00242B] flex flex-col items-center justify-center p-6 text-white select-none transition-opacity duration-500">
          <div className="relative flex items-center justify-center my-6">
            {/* الدائرة المتوهجة الخارجية */}
            <div className="absolute w-20 h-20 sm:w-28 sm:h-28 border-4 border-[#5eead4] border-b-transparent border-l-transparent rounded-full animate-spin" style={{ filter: 'drop-shadow(0 0 8px rgba(94,234,212,0.5))' }}></div>
            <div className="absolute w-20 h-20 sm:w-28 sm:h-28 border-4 border-[#00b5d8] border-t-transparent border-r-transparent rounded-full animate-spin" style={{ animationDirection: 'reverse', filter: 'drop-shadow(0 0 8px rgba(0,181,216,0.5))' }}></div>
            {/* الشعار الداخلي أو النبض */}
            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-tr from-[#00b5d8] to-[#5eead4] rounded-full animate-pulse flex items-center justify-center shadow-lg">
              <i className="fa-solid fa-gamepad text-white text-xl sm:text-2xl"></i>
            </div>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold tracking-wide text-white mt-6 mb-3 drop-shadow-md">
            {storeConfig.name || 'متجر دكان هاي داي'}
          </h2>
          <div className="flex items-center gap-2 text-xs sm:text-sm font-medium text-[#5eead4] bg-white/5 px-4 py-1.5 rounded-full backdrop-blur-md border border-white/10">
            <i className="fa-solid fa-spinner animate-spin"></i>
            <span>جاري تجهيز المتجر...</span>
          </div>
        </div>
      )}

      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Alexandria:wght@300;400;500&family=Almarai:wght@300;400&family=Cairo:wght@300;400;500&family=Tajawal:wght@300;400;500&display=swap"
        rel="stylesheet"
      />

      {/* شرائط الإعلانات في قمة الصفحة في الأول تماماً (دعم أشرطة متعددة، متحركة أو ثابتة) */}
      {viewMode === 'store' && (
        <>
          {storeConfig.announcements && storeConfig.announcements.length > 0 ? (
            <div className="flex flex-col relative z-50" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
              {storeConfig.announcements.map((bar) => (
                <div
                  key={bar.id}
                  className="w-full text-xs py-2 px-4 overflow-hidden relative"
                  style={{
                    backgroundColor: bar.bgColor || storeConfig.bannerBgColor || '#00343D',
                    color: bar.textColor || '#FFFFFF'
                  }}
                >
                  {bar.isMarquee ? (
                    <div className="w-full overflow-hidden flex items-center">
                      <div
                        className={`${bar.direction === 'en' ? 'animate-marquee-rtl' : 'animate-marquee-ltr'} font-medium text-xs sm:text-[13px] tracking-wide whitespace-nowrap`}
                        style={{ animationDuration: `${bar.speed || 20}s` }}
                      >
                        <span className="mx-6">{bar.text}</span>
                        <span className="mx-6">•</span>
                        <span className="mx-6">{bar.text}</span>
                        <span className="mx-6">•</span>
                        <span className="mx-6">{bar.text}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-7xl mx-auto text-center font-medium text-xs sm:text-[13px] tracking-wide">
                      {bar.text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : storeConfig.announcement ? (
            <div className="text-white text-xs py-1.5 px-4 text-center font-medium relative z-50" style={{ backgroundColor: storeConfig.bannerBgColor, paddingTop: 'calc(env(safe-area-inset-top) + 6px)' }}>
              {storeConfig.announcement}
            </div>
          ) : null}
        </>
      )}

      {/* الشريط العلوي الخاص بأقصى الصفحة: العربية | USD ومعه في نفس الصف البحث بدون حدود */}
      <div className="topbar-soft-blur px-3 sm:px-8 py-2 sticky top-0 z-40" style={{ paddingTop: (!storeConfig.announcements?.length && !storeConfig.announcement) ? 'calc(env(safe-area-inset-top) + 8px)' : undefined }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-4">
          
          {/* 1. في أقصى اليمين: الأزرار */}
          <div className="relative shrink-0 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full btn-soft-blur text-black flex items-center justify-center cursor-pointer transition-all duration-300"
              title={isDarkMode ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'}
            >
              <i className={`fa-solid ${isDarkMode ? 'fa-sun text-yellow-500' : 'fa-moon text-gray-700'} text-xs sm:text-sm`}></i>
            </button>

            <button
              type="button"
              onClick={toggleCurrencyMenu}
              className="px-2.5 sm:px-3 py-1 h-7 sm:h-8 rounded-full btn-soft-blur text-black text-[11px] sm:text-xs font-light flex items-center gap-1.5 cursor-pointer"
              title="تغيير العملة واللغة"
            >
              <span className="text-black">{activeLanguage === 'en' ? 'English' : 'العربية'}</span>
              <span className="text-gray-300 font-extralight">|</span>
              <span className="text-black">{activeCurrency === 'IQD' ? 'IQD' : 'USD'}</span>
            </button>

            {/* القائمة المنسدلة لاختيار العملة واللغة بموشن احترافي */}
            {isCurrencyMenuOpen && (
              <>
                <div 
                  className={`fixed inset-0 z-40 bg-black/5 transition-opacity duration-200 ${currencyMenuAnimating ? 'opacity-100' : 'opacity-0'}`}
                  onClick={closeCurrencyMenu}
                />
                <div 
                  className={`absolute right-0 mt-2 w-64 bg-white/98 backdrop-blur-xl rounded-2xl border border-gray-200/90 shadow-2xl p-3.5 z-50 text-xs origin-top-right transition-all duration-200 ease-out transform ${
                    currencyMenuAnimating 
                      ? 'opacity-100 scale-100 translate-y-0' 
                      : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'
                  }`}
                  style={{
                    boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05)'
                  }}
                >
                  {/* قسم العملة */}
                  <div className="px-1 py-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <i className="fa-solid fa-coins text-[10px] text-gray-400"></i>
                    <span>العملة</span>
                  </div>
                  <div className="space-y-1 mb-3">
                    <div
                      onClick={() => setActiveCurrency('USD')}
                      className={`px-3 py-2 rounded-xl flex items-center gap-2.5 transition cursor-pointer ${
                        activeCurrency === 'USD' ? 'bg-gray-100/80 text-gray-900' : 'hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      {/* دائرة الراديو على اليمين */}
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        activeCurrency === 'USD' ? 'border-gray-900 bg-white' : 'border-gray-300 bg-white'
                      }`}>
                        {activeCurrency === 'USD' && (
                          <div className="w-2 h-2 rounded-full bg-gray-900"></div>
                        )}
                      </div>
                      <span className="text-sm">🇺🇸</span>
                      <span className={`text-xs ${activeCurrency === 'USD' ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                        USD ($ دولار أمريكي)
                      </span>
                    </div>

                    <div
                      onClick={() => setActiveCurrency('IQD')}
                      className={`px-3 py-2 rounded-xl flex items-center gap-2.5 transition cursor-pointer ${
                        activeCurrency === 'IQD' ? 'bg-gray-100/80 text-gray-900' : 'hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      {/* دائرة الراديو على اليمين */}
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        activeCurrency === 'IQD' ? 'border-gray-900 bg-white' : 'border-gray-300 bg-white'
                      }`}>
                        {activeCurrency === 'IQD' && (
                          <div className="w-2 h-2 rounded-full bg-gray-900"></div>
                        )}
                      </div>
                      <span className="text-sm">🇮🇶</span>
                      <span className={`text-xs ${activeCurrency === 'IQD' ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                        IQD (د.ع دينار عراقي)
                      </span>
                    </div>
                  </div>

                  {/* خط فاصل */}
                  <div className="border-t border-gray-100 my-2 pt-2">
                    <div className="px-1 py-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <i className="fa-solid fa-globe text-[10px] text-gray-400"></i>
                      <span>اللغة</span>
                    </div>
                    <div className="space-y-1">
                      <div
                        onClick={() => setActiveLanguage('ar')}
                        className={`px-3 py-2 rounded-xl flex items-center gap-2.5 transition cursor-pointer ${
                          activeLanguage === 'ar' ? 'bg-gray-100/80 text-gray-900' : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        {/* دائرة الراديو على اليمين */}
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                          activeLanguage === 'ar' ? 'border-gray-900 bg-white' : 'border-gray-300 bg-white'
                        }`}>
                          {activeLanguage === 'ar' && (
                            <div className="w-2 h-2 rounded-full bg-gray-900"></div>
                          )}
                        </div>
                        <span className="text-[11px] font-mono font-medium text-gray-400">AR</span>
                        <span className={`text-xs ${activeLanguage === 'ar' ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                          العربية
                        </span>
                      </div>

                      <div
                        onClick={() => setActiveLanguage('en')}
                        className={`px-3 py-2 rounded-xl flex items-center gap-2.5 transition cursor-pointer ${
                          activeLanguage === 'en' ? 'bg-gray-100/80 text-gray-900' : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        {/* دائرة الراديو على اليمين */}
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                          activeLanguage === 'en' ? 'border-gray-900 bg-white' : 'border-gray-300 bg-white'
                        }`}>
                          {activeLanguage === 'en' && (
                            <div className="w-2 h-2 rounded-full bg-gray-900"></div>
                          )}
                        </div>
                        <span className="text-[11px] font-mono font-medium text-gray-400">US</span>
                        <span className={`text-xs font-sans ${activeLanguage === 'en' ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
                          English
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 2. ومعه في نفس الصف: حقل البحث يغطي المسافة المتبقية بالكامل */}
          <div className="flex-1 w-full min-w-0">
            <div className="relative w-full flex items-center">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن منتج، باقة، ماسات..."
                className="w-full pr-7 sm:pr-8 pl-6 sm:pl-7 h-6 sm:h-6.5 search-soft-blur border-0 rounded-full text-[10.5px] sm:text-[11px] outline-none placeholder:text-gray-400 font-light leading-none"
              />
              <i className="fa-solid fa-magnifying-glass absolute right-2.5 sm:right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] sm:text-[11px] pointer-events-none"></i>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black text-[10px] cursor-pointer"
                  title="مسح البحث"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* الهيدر الأساسي للمتجر أسفله: الأقسام + الشعار + زر الإدارة + السلة */}
      <header className="header-soft-blur px-3 sm:px-8 py-2 sm:py-2.5 z-30 relative">
        <div className="max-w-7xl mx-auto flex items-center justify-between w-full">
          {/* الجانب الأيمن: زر الأقسام (fa-bars) + الشعار */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* زر فتح قائمة الأقسام بدون حدود (أيقونة فقط) */}
            <button
              type="button"
              onClick={openCategoryDrawer}
              className="md:hidden p-2 sm:p-2 text-gray-700 hover:text-black transition flex items-center justify-center cursor-pointer shrink-0 active:scale-90 hover:bg-gray-100/60 rounded-xl"
              title="الأقسام"
            >
              <i className="fa-solid fa-bars text-base sm:text-lg text-gray-900"></i>
            </button>

            {/* الشعار واسم المتجر */}
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setViewMode('store')}>
              {storeConfig.logoUrl ? (
                <img
                  src={storeConfig.logoUrl}
                  alt={storeConfig.name || 'شعار المتجر'}
                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl object-cover shrink-0 hover:opacity-95 transition"
                  title={storeConfig.name}
                ></img>
              ) : (
                <div
                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl sm:rounded-2xl flex items-center justify-center text-white font-bold text-sm sm:text-lg shadow-2xs shrink-0 hover:opacity-95 transition"
                  style={{ backgroundColor: storeConfig.primaryColor }}
                  title={storeConfig.name}
                >
                  {storeConfig.logoText || storeConfig.name?.charAt(0) || 'م'}
                </div>
              )}
              {storeConfig.name && (
                <div className="flex flex-col">
                  <span className="font-bold text-xs sm:text-sm text-gray-900 tracking-tight leading-tight hover:text-black transition">
                    {storeConfig.name}
                  </span>
                  {storeConfig.subTitle && (
                    <span className="text-[9.5px] sm:text-[10px] text-gray-400 font-normal leading-tight truncate max-w-[140px] sm:max-w-[220px]">
                      {storeConfig.subTitle}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* الجانب الأوسط (للكمبيوتر/التابلت): روابط الأقسام مباشرة في الهيدر كما في الصورة */}
          <nav className="hidden md:flex flex-1 items-center justify-center px-4 overflow-visible">
            <ul className="flex items-center gap-3 lg:gap-5 text-[11px] font-medium">
              {categories.slice(0, 6).map(cat => (
                <li key={cat.id || cat.name}>
                  <a
                    href={`#/category/${encodeURIComponent(cat.name)}`}
                    onClick={(e) => { e.preventDefault(); handleCategoryClick(cat.name); }}
                    className={`cursor-pointer transition ${cat.name.includes('تخفيض') || cat.name.includes('عروض') ? 'text-[#8b1c1c] hover:opacity-70' : 'text-gray-700 hover:text-black'} ${selectedCat === cat.name ? 'text-black font-extrabold' : ''}`}
                  >
                    {cat.name}
                  </a>
                </li>
              ))}
              {categories.length > 6 && (
                <li className="relative group">
                  <div className="cursor-pointer transition text-gray-700 hover:text-black flex items-center gap-1.5 font-medium">
                    <span>المزيد</span>
                    <i className="fa-solid fa-angle-down group-hover:rotate-180 transition-transform duration-200 text-[10px]"></i>
                  </div>
                  <div className="absolute top-full right-0 mt-5 w-52 bg-white border border-gray-100 rounded-xl shadow-xl py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                    <div className="absolute -top-1.5 right-6 w-3 h-3 bg-white border-t border-l border-gray-100 transform rotate-45"></div>
                    <div className="relative bg-white z-10 flex flex-col rounded-xl overflow-hidden">
                      {categories.slice(6).map(cat => (
                        <a
                          key={cat.id || cat.name}
                          href={`#/category/${encodeURIComponent(cat.name)}`}
                          onClick={(e) => { e.preventDefault(); handleCategoryClick(cat.name); }}
                          className={`block w-full text-right px-4 py-2.5 hover:bg-gray-50 text-[11px] font-medium cursor-pointer ${cat.name.includes('تخفيض') || cat.name.includes('عروض') ? 'text-[#8b1c1c]' : 'text-gray-700'} ${selectedCat === cat.name ? 'bg-gray-50 text-black font-extrabold' : ''}`}
                        >
                          {cat.name}
                        </a>
                      ))}
                    </div>
                  </div>
                </li>
              )}
            </ul>
          </nav>

          {/* العناصر التفاعلية: تسجيل الدخول + زر الإدارة + السلة */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* زر تسجيل الدخول أو حساب المستخدم مع القائمة المنسدلة */}
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => {
                  if (currentUser) {
                    setIsUserMenuOpen(prev => !prev);
                  } else {
                    openAuthModal('login');
                  }
                }}
                className="relative p-2 sm:px-3 sm:py-1.5 rounded-full btn-soft-blur text-gray-700 hover:text-black transition flex items-center gap-1.5 cursor-pointer shrink-0 active:scale-95 text-xs font-light"
                title={currentUser ? `حساب: ${currentUser.name}` : "تسجيل الدخول / إنشاء حساب"}
              >
                <i className="fa-regular fa-user text-xs text-gray-700"></i>
                <span className="hidden md:inline font-light text-gray-800">
                  {currentUser ? currentUser.name : 'تسجيل الدخول'}
                </span>
                {/* إشعار أحمر غامق بالعدد عند وجود إشعارات / طلبات شحن جديدة */}
                {managerNotificationsCount > 0 && (
                  <span 
                    className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 bg-[#7F1D1D] text-white rounded-full text-[9px] font-extrabold flex items-center justify-center shadow-md animate-pulse border border-white"
                    title={`لديك ${managerNotificationsCount} إشعارات غير مقروءة`}
                  >
                    {managerNotificationsCount > 99 ? '+99' : managerNotificationsCount}
                  </span>
                )}
              </button>

              {/* القائمة المنسدلة المحدثة بالأيقونات والعناصر المطلوبة */}
              {currentUser && isUserMenuOpen && (
                <div 
                  className="absolute left-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95 duration-150 text-right"
                  dir="rtl"
                >
                  {/* رأس القائمة مع اسم المستخدم ومعرفه (عند الضغط عليه يفتح لوحة التحكم للمدير) */}
                  <div 
                    onClick={() => {
                      if (isManager) {
                        setViewMode(viewMode === 'admin' ? 'store' : 'admin');
                        setIsUserMenuOpen(false);
                      }
                    }}
                    className={`px-4 py-2.5 border-b border-gray-100 flex items-center gap-2.5 transition-colors ${
                      isManager ? 'cursor-pointer hover:bg-teal-50/50 group/adminhdr' : ''
                    }`}
                    title={isManager ? (viewMode === 'admin' ? 'الرجوع للمتجر' : 'دخول لوحة التحكم (الإدارة)') : undefined}
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-700 text-white flex items-center justify-center text-xs font-bold shrink-0 relative">
                      {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'ع'}
                      {isManager && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#004956] rounded-full border border-white flex items-center justify-center text-[7px] text-white">
                          <i className="fa-solid fa-crown text-[6px]"></i>
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs text-gray-900 truncate flex items-center gap-1.5">
                        <span>{currentUser.name}</span>
                        {isManager && (
                          <span className="text-[9px] bg-teal-100 text-[#004956] font-semibold px-1.5 py-0.2 rounded group-hover/adminhdr:bg-[#004956] group-hover/adminhdr:text-white transition">
                            {viewMode === 'admin' ? 'المتجر' : 'مدير'}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400 font-mono truncate">{currentUser.identifier}</div>
                    </div>
                    {isManager && (
                      <i className="fa-solid fa-angle-left text-gray-300 group-hover/adminhdr:text-[#004956] text-xs transition"></i>
                    )}
                  </div>

                  {/* عناصر القائمة المنسدلة */}
                  <div className="py-1">
                    {/* 1. الإشعارات */}
                    <button
                      type="button"
                      onClick={() => openAuthModal('login', 'notifications')}
                      className="w-full px-4 py-2 text-xs text-gray-700 hover:text-black hover:bg-gray-50/90 transition flex items-center justify-between cursor-pointer group"
                    >
                      <div className="flex items-center gap-3">
                        <i className="fa-regular fa-bell text-sm text-gray-500 w-4 text-center group-hover:text-black"></i>
                        <span className="font-normal text-gray-700 group-hover:text-black">الإشعارات</span>
                      </div>
                      {managerNotificationsCount > 0 && (
                        <span className="bg-[#7F1D1D] text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse shadow-2xs">
                          {managerNotificationsCount}
                        </span>
                      )}
                    </button>

                    {/* 2. الطلبات */}
                    <button
                      type="button"
                      onClick={() => openAuthModal('login', 'orders')}
                      className="w-full px-4 py-2 text-xs text-gray-700 hover:text-black hover:bg-gray-50/90 transition flex items-center gap-3 cursor-pointer"
                    >
                      <i className="fa-solid fa-box-archive text-sm text-gray-500 w-4 text-center"></i>
                      <span className="font-normal text-gray-700">الطلبات</span>
                    </button>

                    {/* 3. طلبات بانتظار الدفع */}
                    <button
                      type="button"
                      onClick={() => openAuthModal('login', 'pending_payment')}
                      className="w-full px-4 py-2 text-xs text-gray-700 hover:text-black hover:bg-gray-50/90 transition flex items-center gap-3 cursor-pointer"
                    >
                      <i className="fa-solid fa-cart-shopping text-sm text-gray-500 w-4 text-center"></i>
                      <span className="font-normal text-gray-700">طلبات بانتظار الدفع</span>
                    </button>

                    {/* 4. قائمة الأمنيات */}
                    <button
                      type="button"
                      onClick={() => openAuthModal('login', 'wishlist')}
                      className="w-full px-4 py-2 text-xs text-gray-700 hover:text-black hover:bg-gray-50/90 transition flex items-center gap-3 cursor-pointer"
                    >
                      <i className="fa-regular fa-heart text-sm text-gray-500 w-4 text-center"></i>
                      <span className="font-normal text-gray-700">قائمة الأمنيات</span>
                    </button>

                    {/* 5. محفظتي (مع إظهار الرصيد كرقم بالأسود يسار كلمة محفظتي بنهاية الصف) */}
                    <button
                      type="button"
                      onClick={() => openAuthModal('login', 'wallet')}
                      className="w-full px-4 py-2 text-xs text-gray-700 hover:text-black hover:bg-gray-50/90 transition flex items-center justify-between cursor-pointer group"
                    >
                      <div className="flex items-center gap-3">
                        <i className="fa-regular fa-credit-card text-sm text-gray-500 w-4 text-center group-hover:text-black transition-colors"></i>
                        <span className="font-normal text-gray-700 group-hover:text-black transition-colors">محفظتي</span>
                      </div>
                      <div className="flex items-baseline gap-0.5 text-black font-bold font-price text-xs">
                        <span>{parseFloat(currentUser?.balance || 0).toLocaleString('en-US')}</span>
                        <span className="text-[10px] font-normal text-black">{activeCurrency === 'IQD' ? 'د.ع' : '$'}</span>
                      </div>
                    </button>

                    {/* 6. حسابي */}
                    <button
                      type="button"
                      onClick={() => openAuthModal('login', 'account')}
                      className="w-full px-4 py-2 text-xs text-gray-700 hover:text-black hover:bg-gray-50/90 transition flex items-center gap-3 cursor-pointer"
                    >
                      <i className="fa-regular fa-circle-user text-sm text-gray-500 w-4 text-center"></i>
                      <span className="font-normal text-gray-700">حسابي</span>
                    </button>

                    {/* 7. الإعدادات */}
                    <button
                      type="button"
                      onClick={() => openAuthModal('login', 'settings')}
                      className="w-full px-4 py-2 text-xs text-gray-700 hover:text-black hover:bg-gray-50/90 transition flex items-center gap-3 cursor-pointer"
                    >
                      <i className="fa-solid fa-gear text-sm text-gray-500 w-4 text-center"></i>
                      <span className="font-normal text-gray-700">الإعدادات</span>
                    </button>

                    {/* لوحة الإدارة (فوق تسجيل الخروج مباشرة وتظهر حصرياً للمدير أو المشرفين) */}
                    {isManager && (
                      <button
                        type="button"
                        onClick={() => {
                          setViewMode(viewMode === 'admin' ? 'store' : 'admin');
                          setIsUserMenuOpen(false);
                        }}
                        className="w-full px-4 py-2 text-xs text-[#004956] hover:bg-teal-50/80 font-bold transition flex items-center justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          <i className="fa-solid fa-gauge-high text-sm text-[#004956] w-4 text-center"></i>
                          <span>{viewMode === 'admin' ? 'الرجوع للمتجر' : 'لوحة التحكم (الإدارة)'}</span>
                        </div>
                        {managerNotificationsCount > 0 && (
                          <span className="bg-[#7F1D1D] text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">
                            {managerNotificationsCount}
                          </span>
                        )}
                      </button>
                    )}

                    {/* فاصل */}
                    <div className="my-1 border-t border-gray-100"></div>

                    {/* 8. تسجيل الخروج */}
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentUser(null);
                        try { localStorage.removeItem('haider_current_user'); } catch (e) {}
                        setIsUserMenuOpen(false);
                      }}
                      className="w-full px-4 py-2 text-xs text-red-500 hover:bg-red-50/80 transition flex items-center gap-3 cursor-pointer"
                    >
                      <i className="fa-solid fa-arrow-right-from-bracket text-sm text-red-500 w-4 text-center"></i>
                      <span className="font-medium text-red-500">تسجيل الخروج</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* زر سلة المشتريات مع موشن الاهتزاز والتكبير عند إضافة أي منتج */}
            <button
              onClick={openCartWithMotion}
              className={`relative w-8 h-8 sm:w-9 sm:h-9 rounded-full text-gray-700 btn-soft-blur transition-all duration-200 active:scale-95 cursor-pointer flex items-center justify-center shrink-0 ${
                cartBump ? 'cart-icon-bump ring-2 ring-emerald-400 bg-emerald-50/50' : ''
              }`}
              title="فتح سلة المشتريات"
            >
              <i className={`fa-solid fa-cart-shopping text-xs sm:text-sm transition-colors duration-200 ${
                cartBump ? 'text-emerald-700' : 'text-black'
              }`}></i>
              {totalCartCount > 0 && (
                <span className={`absolute -top-1 -right-1 bg-[#BA3D50] text-white rounded-full text-[9px] w-4 h-4 flex items-center justify-center font-bold shadow-sm font-mono ${
                  cartBump ? 'cart-badge-pop bg-emerald-600' : ''
                }`}>
                  {totalCartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* ======================================================================== */}
      {/* درج / قائمة الأقسام الجانبية المنبثقة من اليمين                            */}
      {/* ======================================================================== */}
      {isCategoryDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden font-normal" dir="rtl">
          {/* الخلفية المظلمة */}
          <div
            onClick={closeCategoryDrawer}
            className={`fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-300 ${
              categoryDrawerAnimating ? 'opacity-100' : 'opacity-0'
            }`}
          ></div>

          {/* القائمة المنبثقة من أقصى اليمين */}
          <div className="fixed inset-y-0 right-0 max-w-full flex pr-0 pointer-events-none">
            <div
              className={`w-[85vw] max-w-sm sm:max-w-md bg-white shadow-2xl flex flex-col justify-between pointer-events-auto border-0 transition-transform duration-300 transform ${
                categoryDrawerAnimating ? 'translate-x-0' : 'translate-x-full'
              }`}
            >
              {/* رأس درج الأقسام */}
              <div className="p-4 sm:p-5 flex items-center justify-between bg-white border-b border-gray-100">
                <div>
                  <h3 className="font-bold text-base sm:text-lg text-gray-900">الأقسام الرئيسية</h3>
                </div>
                <button
                  type="button"
                  onClick={closeCategoryDrawer}
                  className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center text-gray-500 hover:text-black hover:bg-gray-100 transition cursor-pointer text-sm"
                >
                  ✕
                </button>
              </div>

              {/* قائمة الأقسام مع دعم الأقسام الفرعية وخط فاصل رقيق */}
              <div className="flex-1 overflow-y-auto px-3 sm:px-4">
                {(() => {
                  const mainCats = categories.filter(c => !c.parentId);
                  const orphanSubCats = categories.filter(c => c.parentId && !categories.some(p => p.id === c.parentId));

                  const selectAndClose = (catName) => {
                    setSelectedCat(catName);
                    closeCategoryDrawer();
                    if (catName === 'الكل') {
                      setViewMode('store');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    } else {
                      setViewMode('category');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  };

                  return (
                    <>
                      {mainCats.map((cat, idx) => {
                        const isSelected = selectedCat === cat.name;
                        const subCats = categories.filter(c => c.parentId === cat.id);
                        const hasSub = subCats.length > 0;
                        const isExpanded = !!expandedCategories[cat.id];
                        const isLast = idx === mainCats.length - 1 && orphanSubCats.length === 0;

                        return (
                          <div key={cat.id} className={!isLast ? 'border-b border-gray-100' : ''}>
                            <div className="flex items-center justify-between w-full group">
                              <button
                                type="button"
                                onClick={() => selectAndClose(cat.name)}
                                className="flex-1 py-3.5 sm:py-4 px-2 flex items-center gap-3.5 transition cursor-pointer text-right min-w-0"
                              >
                                {/* أيقونة أو صورة القسم بشكل دائري متناسق وكامل */}
                                <div className="relative w-12 h-12 rounded-full overflow-hidden shrink-0 bg-gray-100/80 p-2 flex items-center justify-center text-gray-700">
                                  {cat.imageUrl ? (
                                    <img
                                      src={cat.imageUrl}
                                      alt={cat.name}
                                      className="w-full h-full object-contain transition-transform group-hover:scale-105"
                                    />
                                  ) : cat.icon ? (
                                    <i className={`${cat.icon} text-lg text-[#004956] flex items-center justify-center`}></i>
                                  ) : (
                                    <i className="fa-solid fa-folder-tree text-lg text-[#004956] flex items-center justify-center"></i>
                                  )}
                                </div>

                                <div className="flex-1 min-w-0">
                                  <span className={`text-sm sm:text-base truncate block transition-colors font-bold ${
                                    isSelected ? 'text-[#004956]' : 'text-gray-900 group-hover:text-black'
                                  }`}>
                                    {cat.name}
                                  </span>
                                  {hasSub && (
                                    <span className="text-[10px] text-gray-400 block mt-0.5">
                                      {subCats.length} أقسام فرعية
                                    </span>
                                  )}
                                </div>
                              </button>

                              {/* زر فتح/إغلاق الأقسام الفرعية إذا وجدت */}
                              {hasSub ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedCategories(prev => ({ ...prev, [cat.id]: !prev[cat.id] }));
                                  }}
                                  className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-full transition cursor-pointer shrink-0 ml-1"
                                  title={isExpanded ? 'طي الأقسام الفرعية' : 'عرض الأقسام الفرعية'}
                                >
                                  <i className={`fa-solid fa-chevron-down text-xs transition-transform duration-200 ${
                                    isExpanded ? 'rotate-180 text-[#004956]' : ''
                                  }`}></i>
                                </button>
                              ) : isSelected ? (
                                <i className="fa-solid fa-chevron-left text-xs text-gray-900 shrink-0 ml-2"></i>
                              ) : null}
                            </div>

                            {/* قائمة الأقسام الفرعية التابعة لهذا القسم الرئيسي */}
                            {hasSub && isExpanded && (
                              <div className="mr-8 sm:mr-10 mb-2.5 pr-3 border-r-2 border-[#004956]/30 space-y-1 bg-gray-50/50 rounded-xl p-2 animate-in fade-in duration-150">
                                {subCats.map(subCat => {
                                  const isSubSelected = selectedCat === subCat.name;
                                  return (
                                    <button
                                      key={subCat.id}
                                      type="button"
                                      onClick={() => selectAndClose(subCat.name)}
                                      className={`w-full py-2 px-2.5 flex items-center gap-2.5 rounded-lg text-right transition cursor-pointer ${
                                        isSubSelected
                                          ? 'bg-[#004956] text-white font-bold shadow-xs'
                                          : 'hover:bg-white text-gray-700 font-medium'
                                      }`}
                                    >
                                      <div className="w-7 h-7 rounded-full overflow-hidden shrink-0 bg-white p-1 flex items-center justify-center border border-gray-200/60 shadow-2xs">
                                        {subCat.imageUrl ? (
                                          <img src={subCat.imageUrl} alt="" className="w-full h-full object-contain" />
                                        ) : (
                                          <i className={`${subCat.icon || 'fa-solid fa-folder-tree'} text-xs ${isSubSelected ? 'text-[#004956]' : 'text-gray-500'}`}></i>
                                        )}
                                      </div>
                                      <span className="text-xs sm:text-sm truncate flex-1">{subCat.name}</span>
                                      {isSubSelected && <i className="fa-solid fa-check text-[10px]"></i>}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {orphanSubCats.map((orphan) => {
                        const isSelected = selectedCat === orphan.name;
                        return (
                          <div key={orphan.id} className="border-b border-gray-100">
                            <button
                              type="button"
                              onClick={() => selectAndClose(orphan.name)}
                              className="w-full py-3.5 sm:py-4 px-2 flex items-center gap-3.5 transition cursor-pointer text-right group"
                            >
                              <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 bg-gray-100/80 p-2 flex items-center justify-center text-gray-700">
                                {orphan.imageUrl ? (
                                  <img src={orphan.imageUrl} alt="" className="w-full h-full object-contain" />
                                ) : (
                                  <i className={`${orphan.icon || 'fa-solid fa-folder-tree'} text-lg text-[#004956]`}></i>
                                )}
                              </div>
                              <span className={`text-sm sm:text-base truncate block transition-colors font-bold ${
                                isSelected ? 'text-black' : 'text-gray-900 group-hover:text-black'
                              }`}>
                                {orphan.name}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>

              {/* أسفل درج الأقسام */}
              <div className="p-3.5 border-t border-gray-100 bg-white flex items-center justify-between text-xs text-gray-400">
                <span className="text-[11px]">إجمالي الأقسام: {categories.length}</span>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ======================================================================== */}
      {/* نافذة تسجيل الدخول والتسجيل والملف الشخصي والإعدادات                       */}
      {/* ======================================================================== */}
      {isAuthModalOpen && typeof document !== 'undefined' && createPortal(
        <div className={`fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto ${
          profileTab === 'settings' ? 'p-0 m-0 px-0 mx-0 w-screen h-screen bg-white' : 'p-4'
        }`} dir="rtl">
          {/* الخلفية الضبابية الناعمة (مخفية في تبويب الإعدادات لملء كامل النافذة بالأبيض) */}
          <div 
            onClick={closeAuthModal}
            className={`fixed inset-0 ${profileTab === 'settings' ? 'bg-white' : 'bg-black/35 backdrop-blur-xs'} transition-opacity duration-250 ease-out ${
              authModalAnimating ? 'opacity-100' : 'opacity-0'
            }`}
          />

          {/* صندوق النافذة المنبثق */}
          <div
            className={`relative w-full ${
              profileTab === 'settings'
                ? 'fixed inset-0 w-full h-full min-h-screen min-w-full max-w-none max-h-none rounded-none border-0 shadow-none bg-white p-0 m-0 px-0 mx-0'
                : (currentUser ? 'max-w-lg min-h-[460px] max-h-[85vh]' : 'max-w-[320px] min-h-[390px]') + ' bg-white/98 backdrop-blur-2xl rounded-3xl border border-gray-100 shadow-2xl p-4 sm:p-5 my-auto'
            } flex flex-col justify-between z-10 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] transform overflow-hidden ${
              authModalAnimating
                ? 'opacity-100 scale-100 translate-y-0 rotate-0'
                : 'opacity-0 scale-90 translate-y-6 pointer-events-none'
            }`}
          >
            {/* زر الإغلاق */}
            <button
              type="button"
              onClick={closeAuthModal}
              className={`absolute top-2 left-2 ${profileTab === 'settings' ? 'w-5 h-5 text-[9px] bg-gray-100 text-gray-700' : 'w-6 h-6 text-xs bg-gray-50 text-gray-400'} rounded-full hover:bg-gray-200 hover:text-black transition-all duration-200 active:scale-90 flex items-center justify-center cursor-pointer z-20`}
            >
              ✕
            </button>

            {/* في حال كان العميل مسجلاً للدخول بالفعل: عرض ملفه وأقسامه */}
            {currentUser ? (
              <div className={`flex-1 overflow-y-auto ${profileTab === 'settings' ? 'p-0 m-0 px-0 mx-0 space-y-1 w-full' : 'pr-1 space-y-4'} flex flex-col`}>
                {/* رأس النافذة: عنوان وأيقونة الخيار المحدد فقط */}
                {(() => {
                  const currentTabInfo = {
                    orders: { title: 'الطلبات وسجل المشتريات', icon: 'fa-solid fa-box-archive' },
                    pending_payment: { title: 'طلبات بانتظار الدفع', icon: 'fa-solid fa-cart-shopping' },
                    wishlist: { title: 'قائمة الأمنيات والمفضلة', icon: 'fa-solid fa-heart' },
                    wallet: { title: 'محفظتي', icon: 'fa-solid fa-wallet' },
                    notifications: { title: 'الإشعارات والتنبيهات', icon: 'fa-solid fa-bell' },
                    account: { title: 'معلومات حسابي', icon: 'fa-solid fa-circle-user' },
                    settings: { title: 'إعدادات الحساب وكلمة المرور', icon: 'fa-solid fa-gear' },
                  }[profileTab] || { title: 'تفاصيل الحساب', icon: 'fa-solid fa-circle-user' };

                  return (
                    <div className={`flex items-center justify-between ${profileTab === 'settings' ? 'pb-1 border-0' : 'pb-3 border-b border-gray-100'}`}>
                      <div className={`flex items-center gap-1.5 text-gray-900 font-bold ${profileTab === 'settings' ? 'text-[10px]' : 'text-sm sm:text-base'}`}>
                        <div className={`${profileTab === 'settings' ? 'w-5 h-5 text-[10px] rounded-md' : 'w-8 h-8 text-sm rounded-xl'} bg-gray-100/80 flex items-center justify-center text-gray-800`}>
                          <i className={currentTabInfo.icon}></i>
                        </div>
                        <span className={profileTab === 'settings' ? 'text-[10px] font-bold' : ''}>{currentTabInfo.title}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* 1. تبويب طلباتي (الأكواد المسلّمة وحالة الطلبات) */}
                {profileTab === 'orders' && (
                  <div className="space-y-2.5 animate-field-switch">
                    {orders.filter(o => o.customer === currentUser.name || (currentUser.identifier && o.txId === currentUser.identifier)).length === 0 ? (
                      <div className="py-10 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-400 text-xs space-y-1.5">
                        <i className="fa-solid fa-box-open text-2xl text-gray-300"></i>
                        <p>لا توجد طلبات سابقة مسجلة بحسابك حتى الآن.</p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {orders
                          .filter(o => o.customer === currentUser.name || (currentUser.identifier && o.txId === currentUser.identifier))
                          .map((myOrd) => (
                            <div key={myOrd.id} className="p-3 bg-gray-50/80 rounded-xl border border-gray-200/80 text-xs space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="font-bold font-mono text-gray-900">{myOrd.id}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  myOrd.status === 'مكتمل' ? 'bg-emerald-100 text-emerald-800' :
                                  myOrd.status === 'قيد المراجعة' ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-700'
                                }`}>
                                  {myOrd.status}
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-[11px] text-gray-500">
                                <span>{myOrd.date} • {myOrd.method}</span>
                                <span className="font-bold text-black font-price">{myOrd.totalFormatted || `$${myOrd.totalUsd}`}</span>
                              </div>

                              {/* إذا كان الطلب مكتملاً وفيه أكواد مسلّمة للبطاقات الرقمية */}
                              {myOrd.status === 'مكتمل' && Array.isArray(myOrd.fulfilledKeys) && myOrd.fulfilledKeys.length > 0 && (
                                <div className="mt-2 p-2 bg-emerald-50 border border-emerald-300 rounded-lg space-y-1">
                                  <span className="text-[10px] font-bold text-emerald-900 block">
                                    🎉 كود البطاقة الرقمية الخاص بك (تم التسليم بنجاح):
                                  </span>
                                  {myOrd.fulfilledKeys.map((k, i) => (
                                    <div key={i} className="flex items-center justify-between bg-white px-2 py-1 rounded border border-emerald-200">
                                      <span className="font-mono font-bold text-xs select-all text-emerald-800">{k}</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          navigator.clipboard?.writeText(k);
                                          showToast('تم نسخ الكود بنجاح!');
                                        }}
                                        className="text-[10px] bg-emerald-700 text-white px-2 py-0.5 rounded hover:bg-emerald-800 active:scale-95 transition"
                                      >
                                        نسخ
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* تسليم المنتجات الرقمية المباشرة (روابط، نصوص، حسابات) */}
                              {myOrd.status === 'مكتمل' && myOrd.items && myOrd.items.map((item, idx) => {
                                const prod = products.find(p => p.id === (item.productId || item.id));
                                if (!prod || prod.productType !== 'digital') return null;
                                
                                return (
                                  <div key={`digital-${idx}`} className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                                    <div className="flex items-center gap-1.5 text-blue-900 mb-1">
                                      <i className="fa-solid fa-cloud-arrow-down text-[14px]"></i>
                                      <span className="text-[11px] font-bold">تسليم منتج: {prod.title || prod.name}</span>
                                    </div>
                                    
                                    {(!prod.digitalDeliveryType || prod.digitalDeliveryType === 'text') && prod.digitalDeliveryText && (
                                      <div className="bg-white p-2 rounded border border-blue-100 text-[11px] text-gray-800 whitespace-pre-wrap leading-relaxed">
                                        {prod.digitalDeliveryText}
                                      </div>
                                    )}

                                    {prod.digitalDeliveryType === 'link' && prod.digitalDeliveryLink && (
                                      <div className="flex flex-col gap-1.5">
                                        <span className="text-[10px] text-blue-800">رابط المنتج الخاص بك:</span>
                                        <div className="flex items-center gap-2">
                                          <a href={prod.digitalDeliveryLink} target="_blank" rel="noopener noreferrer" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-center py-1.5 rounded text-[11px] font-bold transition">
                                            فتح الرابط 🌐
                                          </a>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              navigator.clipboard?.writeText(prod.digitalDeliveryLink);
                                              showToast('تم نسخ الرابط بنجاح!');
                                            }}
                                            className="px-3 py-1.5 bg-white border border-blue-200 hover:bg-blue-50 text-blue-700 rounded text-[11px] font-bold transition"
                                          >
                                            نسخ
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    {prod.digitalDeliveryType === 'credentials' && (
                                      <div className="bg-white p-2 rounded border border-blue-100 space-y-2">
                                        <div className="flex items-center justify-between">
                                          <div className="flex flex-col">
                                            <span className="text-[9px] text-gray-500">الإيميل / اليوزر</span>
                                            <span className="font-mono text-[11px] font-bold select-all text-gray-900">{prod.digitalDeliveryEmail || 'غير متوفر'}</span>
                                          </div>
                                          <button type="button" onClick={() => { navigator.clipboard?.writeText(prod.digitalDeliveryEmail || ''); showToast('تم النسخ'); }} className="text-[10px] text-blue-600 hover:bg-blue-50 px-2 py-1 rounded">نسخ</button>
                                        </div>
                                        <div className="h-px bg-gray-100 w-full"></div>
                                        <div className="flex items-center justify-between">
                                          <div className="flex flex-col">
                                            <span className="text-[9px] text-gray-500">الباسوورد</span>
                                            <span className="font-mono text-[11px] font-bold select-all text-gray-900">{prod.digitalDeliveryPassword || 'غير متوفر'}</span>
                                          </div>
                                          <button type="button" onClick={() => { navigator.clipboard?.writeText(prod.digitalDeliveryPassword || ''); showToast('تم النسخ'); }} className="text-[10px] text-blue-600 hover:bg-blue-50 px-2 py-1 rounded">نسخ</button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}

                              {/* زر تقييم الطلب المكتمل */}
                              {myOrd.status === 'مكتمل' && (
                                <div className="pt-2 mt-2 flex items-center justify-between border-t border-gray-200/70">
                                  <span className="text-[10px] text-gray-500">شارك تجربتك مع الطلب:</span>
                                  {myOrd.reviewed ? (
                                    <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200 flex items-center gap-1">
                                      <span>✓</span>
                                      <span>تم التقييم</span>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReviewModalOrder(myOrd);
                                        setReviewModalRating(5);
                                        setReviewModalComment('');
                                        setReviewModalPhoto('');
                                        setReviewModalProductId(myOrd.items?.[0]?.productId || myOrd.items?.[0]?.id || '');
                                      }}
                                      className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-bold shadow-xs flex items-center gap-1 cursor-pointer transition active:scale-95"
                                    >
                                      <span>⭐</span>
                                      <span>تقييم الطلب</span>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. تبويب الأمنيات */}
                {profileTab === 'wishlist' && (
                  <div className="space-y-2.5 animate-field-switch">
                    {wishlist.length === 0 ? (
                      <div className="py-10 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200 text-gray-400 text-xs space-y-1.5">
                        <i className="fa-regular fa-heart text-2xl text-gray-300"></i>
                        <p>قائمة أمنياتك فارغة حالياً.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2">
                        {products.filter(p => wishlist.includes(p.id)).map(favProd => (
                          <div key={favProd.id} className="p-2.5 bg-gray-50 rounded-xl border border-gray-200/80 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <img src={favProd.image} alt={favProd.name} className="w-10 h-10 object-cover rounded-lg border border-gray-200" />
                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-gray-900 truncate">{favProd.name}</h4>
                                <span className="text-[11px] font-bold text-[#004956] font-price">
                                  {favProd.productType === 'exchange' || (typeof favProd.exchangeCurrencyName === 'string' && favProd.exchangeCurrencyName.trim().length > 0)
                                    ? 'مبادلة'
                                    : (favProd.currency === 'IQD' ? `${formatNumberInApp(favProd.price)} د.ع` : `$${formatNumberInApp(favProd.price)}`)}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isProductRequiringInput(favProd)) {
                                    setActiveProductForPage(favProd);
                                    setViewMode('product-detail');
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                  } else {
                                    handleAddToCart(favProd);
                                  }
                                  closeAuthModal();
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition cursor-pointer ${
                                  favProd.productType === 'exchange' || (typeof favProd.exchangeCurrencyName === 'string' && favProd.exchangeCurrencyName.trim().length > 0)
                                    ? 'bg-white hover:bg-slate-50 text-[#0f172a] border border-[#1e293b]'
                                    : 'bg-black hover:bg-gray-800 text-white'
                                }`}
                              >
                                {favProd.productType === 'exchange' || (typeof favProd.exchangeCurrencyName === 'string' && favProd.exchangeCurrencyName.trim().length > 0)
                                  ? 'طلب المبادلة'
                                  : isProductRequiringInput(favProd)
                                  ? 'تحديد البيانات'
                                  : 'أضف للسلة'}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleWishlist(favProd.id)}
                                className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-red-50 text-gray-400 hover:text-red-500 flex items-center justify-center text-xs transition cursor-pointer"
                                title="إزالة من الأمنيات"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 3. تبويب حسابي (معلومات الملف ورتبة العميل وتاريخ الانضمام) */}
                {profileTab === 'account' && (
                  <div className="space-y-3 animate-field-switch">
                    <div className="bg-gray-50/90 p-3.5 rounded-2xl border border-gray-200/80 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between py-1 border-b border-gray-200/60">
                        <span className="text-gray-500">الاسم المسجل:</span>
                        <span className="font-bold text-gray-900">{currentUser.name}</span>
                      </div>

                      <div className="flex items-center justify-between py-1 border-b border-gray-200/60">
                        <span className="text-gray-500">معرف الحساب:</span>
                        <span className="font-mono text-gray-800 dir-ltr">{currentUser.identifier}</span>
                      </div>

                      <div className="flex items-center justify-between py-1 border-b border-gray-200/60">
                        <span className="text-gray-500">رتبة العضوية:</span>
                        <span className="font-bold text-[#004956]">{currentUser.tier || 'عميل عادي'}</span>
                      </div>

                      <div className="flex items-center justify-between py-1">
                        <span className="text-gray-500">تاريخ الانضمام:</span>
                        <span className="text-gray-700">{currentUser.joinedAt ? new Date(currentUser.joinedAt).toLocaleDateString('ar-EG') : 'حديثاً'}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. تبويب الإعدادات (تعديل الاسم وكلمة المرور وتفضيلات الحساب) */}
                {profileTab === 'settings' && (
                  <div className="p-0 m-0 px-0 mx-0 space-y-1 bg-white border-0 w-full animate-field-switch">
                    {editProfileSuccess && (
                      <div style={{ fontSize: '10px' }} className="p-1 bg-emerald-50 text-emerald-800 text-center font-medium border-0 m-0 text-[10px]">
                        {editProfileSuccess}
                      </div>
                    )}

                    <form 
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!editProfileName.trim()) return;
                        const updatedUser = {
                          ...currentUser,
                          name: editProfileName.trim(),
                          password: editProfilePassword.trim() || currentUser.password
                        };
                        setCurrentUser(updatedUser);
                        try {
                          localStorage.setItem('haider_current_user', JSON.stringify(updatedUser));
                        } catch (err) {}
                        await syncCustomerToCloud(updatedUser);
                        setEditProfileSuccess('تم حفظ وتحديث البيانات بنجاح!');
                        setTimeout(() => setEditProfileSuccess(''), 3000);
                      }}
                      className="space-y-1 p-0 m-0 px-0 mx-0 border-0 w-full"
                    >
                      <div className="border-0 p-0 m-0 px-0 mx-0">
                        <label style={{ fontSize: '10px' }} className="block font-bold text-gray-700 mb-0.5 p-0 m-0 text-[10px]">تعديل الاسم الكامل</label>
                        <input
                          type="text"
                          required
                          value={editProfileName}
                          onChange={(e) => setEditProfileName(e.target.value)}
                          style={{ fontSize: '10px' }}
                          className="w-full px-1.5 py-1 bg-gray-50 focus:bg-white outline-none border-0 shadow-none m-0 text-[10px]"
                        />
                      </div>

                      <div className="border-0 p-0 m-0 px-0 mx-0">
                        <label style={{ fontSize: '10px' }} className="block font-bold text-gray-700 mb-0.5 p-0 m-0 text-[10px]">تغيير كلمة المرور</label>
                        <input
                          type="password"
                          value={editProfilePassword}
                          onChange={(e) => setEditProfilePassword(e.target.value)}
                          placeholder="اتركها فارغة إذا لا ترغب بالتغيير"
                          style={{ fontSize: '10px' }}
                          className="w-full px-1.5 py-1 bg-gray-50 focus:bg-white outline-none border-0 shadow-none m-0 text-[10px]"
                        />
                      </div>

                      <button
                        type="submit"
                        style={{ fontSize: '10px' }}
                        className="w-full py-1.5 bg-black hover:bg-gray-800 text-white font-medium transition active:scale-98 cursor-pointer mt-1 border-0 text-[10px]"
                      >
                        حفظ التعديلات
                      </button>
                    </form>
                  </div>
                )}

                {/* 5. تبويب الإشعارات */}
                {profileTab === 'notifications' && (() => {
                  // دمج الإشعارات الفعلية مع طلبات الشحن المعلقة (للمدير فقط) في عرض موحد
                  const userNotifs = currentUser.notifications || [];
                  // تحويل طلبات الشحن المعلقة إلى عناصر إشعارات للعرض (للمدير فقط وإذا لم تكن موجودة في الإشعارات الفعلية)
                  const existingTopupIds = new Set(userNotifs.filter(n => n.topupId).map(n => n.topupId));
                  const topupVirtualNotifs = isManager
                    ? (topupRequests || [])
                        .filter(t => t.status === 'معلق' && !existingTopupIds.has(t.id))
                        .map(t => ({
                          id: `virtual-topup-${t.id}`,
                          type: 'admin-topup',
                          topupId: t.id,
                          title: 'طلب شحن محفظة جديد 💳',
                          message: `قام العميل ${t.customerName} بطلب شحن رصيد بقيمة $${t.amount} (${t.method}). يرجى مراجعة إشعار التحويل واعتماده.`,
                          date: t.date || new Date().toISOString(),
                          read: readNotifIdsRef.current.has(`topup-${t.id}`) || readNotifIdsRef.current.has(`virtual-topup-${t.id}`),
                          _virtual: true
                        }))
                    : [];
                  const allNotifs = [...topupVirtualNotifs, ...userNotifs];
                  const unreadCount = allNotifs.filter(n => !n.read).length;

                  // دالة مساعدة لتحديد إشعار واحد أو كل الإشعارات كمقروءة وحفظها محلياً وسحابياً
                  const markAsRead = (targetNotif = null) => {
                    const toMark = targetNotif ? [targetNotif] : allNotifs;
                    toMark.forEach(n => {
                      if (n.id) readNotifIdsRef.current.add(String(n.id));
                      if (n.topupId) {
                        readNotifIdsRef.current.add(`topup-${n.topupId}`);
                        readNotifIdsRef.current.add(`virtual-topup-${n.topupId}`);
                      }
                    });
                    try {
                      localStorage.setItem('haider_read_notif_ids', JSON.stringify(Array.from(readNotifIdsRef.current)));
                    } catch (e) {}

                    const updatedUserNotifs = userNotifs.map(n => {
                      if (!targetNotif || n.id === targetNotif.id || (n.topupId && targetNotif.topupId && n.topupId === targetNotif.topupId)) {
                        return { ...n, read: true };
                      }
                      return n;
                    });
                    const updatedUser = { ...currentUser, notifications: updatedUserNotifs };
                    setCurrentUser(updatedUser);
                    setCustomers(prev => prev.map(c => c.id === updatedUser.id ? updatedUser : c));
                    try {
                      localStorage.setItem('haider_current_user', JSON.stringify(updatedUser));
                    } catch (e) {}
                    syncCustomerToCloud(updatedUser);
                  };

                  return (
                    <div className="space-y-3 animate-field-switch">
                      {allNotifs.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between pb-1">
                            <span className="text-xs text-gray-500 font-bold">
                              {unreadCount} إشعارات جديدة
                            </span>
                            {unreadCount > 0 && (
                              <button
                                type="button"
                                onClick={() => markAsRead(null)}
                                className="text-[11px] text-[#004956] hover:underline font-bold cursor-pointer"
                              >
                                تحديد الكل كمقروء ✓
                              </button>
                            )}
                          </div>
                          <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
                            {allNotifs.map((notif, idx) => {
                              const isAdminTopup = notif.type === 'admin-topup';
                              return (
                                <div
                                  key={notif.id || idx}
                                  onClick={() => {
                                    if (!notif.read) markAsRead(notif);
                                  }}
                                  className={`p-3 rounded-2xl border transition text-xs space-y-1.5 cursor-pointer ${
                                    isAdminTopup
                                      ? notif.read 
                                        ? 'bg-rose-50/50 border-rose-200 text-rose-950' 
                                        : 'bg-[#7F1D1D]/10 border-[#7F1D1D]/40 text-gray-950 shadow-xs ring-1 ring-[#7F1D1D]/30'
                                      : notif.read 
                                        ? 'bg-gray-50/70 border-gray-100 text-gray-700' 
                                        : 'bg-emerald-50/50 border-emerald-200 text-gray-900 shadow-2xs'
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 font-bold">
                                      {isAdminTopup ? (
                                        <span className="w-6 h-6 rounded-full bg-[#7F1D1D] text-white flex items-center justify-center text-[11px] shadow-2xs shrink-0">
                                          💳
                                        </span>
                                      ) : (
                                        <span className="text-sm">
                                          {notif.type === 'wallet' ? '💰' : notif.type === 'order' ? '📦' : notif.type === 'promo' ? '🔥' : '🔔'}
                                        </span>
                                      )}
                                      <span className={isAdminTopup ? 'text-[#7F1D1D] font-extrabold text-[12px]' : ''}>
                                        {notif.title}
                                      </span>
                                      {!notif.read && (
                                        <span className={`text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full animate-pulse ${isAdminTopup ? 'bg-[#7F1D1D]' : 'bg-emerald-600'}`}>
                                          جديد
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-gray-400 font-mono">
                                      {notif.date ? new Date(notif.date).toLocaleDateString('ar-IQ', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-gray-700 leading-relaxed pr-8">{notif.message}</p>
                                  {isAdminTopup && isManager && (
                                    <div className="pr-8 pt-1 flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          markAsRead(notif);
                                          closeAuthModal();
                                          setViewMode('admin');
                                          setAdminSection({ tab: 'customers', ts: Date.now() });
                                        }}
                                        className="px-3 py-1 bg-[#7F1D1D] hover:bg-[#991B1B] text-white font-bold text-[10px] rounded-lg shadow-xs transition active:scale-95 cursor-pointer flex items-center gap-1.5"
                                      >
                                        <i className="fa-solid fa-credit-card text-[9px]"></i>
                                        <span>مراجعة واعتماد الطلب في لوحة الإدارة</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="bg-gray-50/80 p-6 rounded-2xl border border-gray-200/80 text-center space-y-2">
                          <div className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center mx-auto text-gray-400">
                            <i className="fa-regular fa-bell text-base text-gray-400"></i>
                          </div>
                          <p className="text-xs text-gray-600 font-semibold">لا توجد إشعارات جديدة</p>
                          <p className="text-[10px] text-gray-400">ستصلك هنا كافة التنبيهات حول حالة طلباتك ورصيدك والعروض</p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 6. تبويب طلبات بانتظار الدفع */}
                {profileTab === 'pending_payment' && (
                  <div className="space-y-2.5 animate-field-switch">
                    {orders.filter(o => (o.customer === currentUser.name || (currentUser.identifier && o.txId === currentUser.identifier)) && o.status === 'قيد المراجعة').length === 0 ? (
                      <div className="bg-gray-50/80 p-6 rounded-2xl border border-gray-200/80 text-center space-y-2">
                        <div className="w-10 h-10 rounded-full bg-white border border-gray-200 flex items-center justify-center mx-auto text-gray-400">
                          <i className="fa-solid fa-check text-base text-emerald-500"></i>
                        </div>
                        <p className="text-xs text-gray-600 font-semibold">لا توجد طلبات معلقة بانتظار الدفع</p>
                        <p className="text-[10px] text-gray-400">كافة طلباتك مسددة أو مكتملة بنجاح</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {orders
                          .filter(o => (o.customer === currentUser.name || (currentUser.identifier && o.txId === currentUser.identifier)) && o.status === 'قيد المراجعة')
                          .map((ord) => (
                            <div key={ord.id} className="p-3 bg-white rounded-2xl border border-amber-200/80 shadow-2xs space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-gray-900 font-mono">{ord.id}</span>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60">
                                  بانتظار التأكيد
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-600 flex items-center justify-between">
                                <span>طريقة الدفع: {ord.method}</span>
                                <span className="font-bold text-gray-900 font-mono">{ord.totalFormatted || `$${ord.totalUsd}`}</span>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 7. تبويب محفظتي مع الرصيد وشحن الرصيد ونقاط الولاء */}
                {profileTab === 'wallet' && (
                  <div className="space-y-5 animate-field-switch text-right font-sans" dir="rtl">
                    {/* بطاقات الرصيد ونقاط الولاء وأزرار الشحن */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* بطاقة رصيد المحفظة */}
                      <div className="bg-gradient-to-br from-white to-gray-50/80 rounded-2xl p-4 border border-gray-200 shadow-2xs flex flex-col justify-between space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-2xl bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center text-base shadow-2xs">
                            <i className="fa-solid fa-wallet"></i>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsTopupModalOpen(true)}
                            className="px-3 py-1.5 bg-[#004956] hover:bg-[#00343D] text-white text-[11px] font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                          >
                            <i className="fa-solid fa-plus text-[10px]"></i>
                            <span>شحن المحفظة</span>
                          </button>
                        </div>

                        <div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-black text-gray-900 font-mono">
                              {parseFloat(currentUser?.balance || 0).toLocaleString('en-US')}
                            </span>
                            <span className="text-xs font-bold text-gray-600 font-sans">
                              {activeCurrency === 'IQD' ? 'د.ع' : '$'}
                            </span>
                          </div>
                          <span className="text-[11px] text-gray-400 font-normal block mt-0.5">
                            رصيد المحفظة المتوفر
                          </span>
                        </div>
                      </div>

                      {/* بطاقة نقاط الولاء والمكافآت (تظهر فقط إذا كان نظام الولاء مفعلاً من الإدارة) */}
                      {(() => {
                        const loyaltyCfg = storeConfig.loyaltyConfig || { enabled: true, spendUsdPerPoint: 10, pointsPerUsd: 10 };
                        if (loyaltyCfg.enabled === false) return null;
                        const pointsPerUsd = Math.max(1, parseFloat(loyaltyCfg.pointsPerUsd) || 10);
                        const canRedeem = (currentUser?.points || 0) >= pointsPerUsd;
                        const usdValue = (((currentUser?.points || 0) / pointsPerUsd)).toFixed(2);
                        const redeemableUsd = Math.floor((currentUser?.points || 0) / pointsPerUsd);

                        return (
                          <div className="bg-gradient-to-br from-amber-50/80 to-amber-100/40 rounded-2xl p-4 border border-amber-200 shadow-2xs flex flex-col justify-between space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center text-base shadow-2xs">
                                <span>⭐</span>
                              </div>
                              {canRedeem && (
                                <button
                                  type="button"
                                  onClick={handleRedeemLoyaltyPoints}
                                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold rounded-xl shadow-xs transition active:scale-95 cursor-pointer"
                                  title={`استبدال كل ${pointsPerUsd} نقطة بـ 1 دولار`}
                                >
                                  استبدال برصيد (${redeemableUsd})
                                </button>
                              )}
                            </div>

                            <div>
                              <div className="flex items-baseline gap-1">
                                <span className="text-2xl font-black text-amber-900 font-mono">
                                  {currentUser?.points || 0}
                                </span>
                                <span className="text-xs font-bold text-amber-800 font-sans">نقطة</span>
                              </div>
                              <div className="flex items-center justify-between mt-0.5">
                                <span className="text-[11px] text-amber-800/80 font-normal">
                                  تساوي ${usdValue} في محفظتك
                                </span>
                                <span className="text-[10px] text-amber-900/60 font-medium">{pointsPerUsd} نقاط = $1</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* سجل طلبات شحن المحفظة السابقة الخاصة بهذا العميل */}
                    {topupRequests.filter(t => t.customerId === currentUser.id || t.customerIdentifier === currentUser.identifier || t.customerName === currentUser.name).length > 0 && (
                      <div className="space-y-2 pt-1">
                        <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                          <i className="fa-solid fa-clock-rotate-left text-gray-400"></i>
                          <span>طلبات الشحن الأخيرة</span>
                        </h4>
                        <div className="space-y-1.5 max-h-40 overflow-y-auto">
                          {topupRequests
                            .filter(t => t.customerId === currentUser.id || t.customerIdentifier === currentUser.identifier || t.customerName === currentUser.name)
                            .map((top) => (
                              <div key={top.id} className="p-2.5 bg-gray-50 rounded-xl border border-gray-200/80 flex items-center justify-between text-xs">
                                <div>
                                  <div className="font-bold text-gray-900 font-mono">{top.id}</div>
                                  <span className="text-[10px] text-gray-400 font-mono">{top.date ? new Date(top.date).toLocaleDateString('ar-IQ') : ''}</span>
                                </div>
                                <div className="text-left font-mono">
                                  <div className="font-bold text-emerald-700">${top.amountUsd}</div>
                                  <span className={`px-2 py-0.2 rounded-full text-[9px] font-bold ${
                                    top.status === 'مقبول' ? 'bg-emerald-100 text-emerald-800' :
                                    top.status === 'مرفوض' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                                  }`}>
                                    {top.status || 'معلق'}
                                  </span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* قسم سجل العمليات */}
                    <div className="pt-2 space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold text-gray-900">
                          سجل العمليات
                        </h4>
                        {currentUser?.walletTransactions && currentUser.walletTransactions.length > 0 && (
                          <span className="text-[10px] text-gray-400">
                            {currentUser.walletTransactions.length} عملية مسجلة
                          </span>
                        )}
                      </div>

                      {/* إذا كان هناك حركات في المحفظة، نعرضها كقائمة أنيقة */}
                      {currentUser?.walletTransactions && currentUser.walletTransactions.length > 0 ? (
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
                          {currentUser.walletTransactions.map((tx, idx) => (
                            <div key={tx.id || idx} className="p-3 bg-gray-50/90 rounded-2xl border border-gray-100 flex items-center justify-between transition hover:bg-gray-100/70">
                              <div className="flex items-center gap-2.5">
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs shrink-0 ${
                                  tx.type === 'deposit' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                                }`}>
                                  <i className={`fa-solid ${tx.type === 'deposit' ? 'fa-arrow-down' : 'fa-arrow-up-right'}`}></i>
                                </div>
                                <div>
                                  <div className="text-xs font-bold text-gray-900 leading-tight">
                                    {tx.title || (tx.type === 'deposit' ? 'إيداع رصيد' : 'خصم من المحفظة')}
                                  </div>
                                  <span className="text-[10px] text-gray-400 font-mono block mt-0.5">
                                    {tx.date ? new Date(tx.date).toLocaleDateString('ar-IQ', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'مؤكدة'}
                                  </span>
                                </div>
                              </div>

                              <div className="text-left font-mono">
                                <div className={`text-xs sm:text-sm font-black ${
                                  tx.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'
                                }`}>
                                  {tx.type === 'deposit' ? '+' : '-'}{parseFloat(tx.amount || 0).toLocaleString('en-US')} {activeCurrency === 'IQD' ? 'د.ع' : '$'}
                                </div>
                                {tx.balanceAfter !== undefined && (
                                  <span className="text-[9px] text-gray-400 font-sans block">
                                    الرصيد بعدها: {parseFloat(tx.balanceAfter).toLocaleString('en-US')}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        /* حالة الفراغ: أيقونة المحفظة الرمادية الفاتحة والنص */
                        <div className="py-8 flex flex-col items-center justify-center text-center space-y-3">
                          <div className="text-gray-300 text-5xl">
                            <i className="fa-solid fa-wallet opacity-40"></i>
                          </div>
                          <p className="text-sm font-medium text-gray-800">
                            لم تُسجَّل أي عمليات بعد
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : authStep === 'otp' ? (
              /* خطوة إدخال كود التحقق OTP لتأكيد التسجيل */
              <div className="space-y-3 my-auto">
                <div className="text-center">
                  <div 
                    className="w-10 h-10 mx-auto rounded-full flex items-center justify-center text-white text-base shadow-xs mb-2"
                    style={{ backgroundColor: storeConfig.primaryColor }}
                  >
                    <i className="fa-solid fa-shield-halved"></i>
                  </div>
                  <h3 className="text-sm font-bold text-gray-900">تأكيد رقمك / بريدك</h3>
                  <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                    تم إرسال كود التحقق بنجاح إلى:
                    <span className="block font-mono font-bold text-gray-800 dir-ltr text-center mt-0.5">
                      {authMethod === 'phone' ? `${selectedCountryCode.code} ${authIdentifier}` : authIdentifier}
                    </span>
                  </p>
                </div>

                {/* إشعار إرسال الكود الحقيقي */}
                <div className="p-2.5 bg-gray-50 border border-gray-200/80 rounded-xl text-center space-y-1">
                  <div className="flex items-center justify-center gap-1.5 text-gray-800 text-xs font-medium">
                    <i className="fa-solid fa-paper-plane text-emerald-600 text-xs"></i>
                    <span>
                      {authMethod === 'phone' ? 'تم إرسال كود التحقق في رسالة SMS لهاتفك' : 'تم إرسال كود التحقق ورابط التأكيد لبريدك'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    يرجى التحقق من رسائل هاتفك أو صندوق الوارد وإدخال الرمز أدناه
                  </p>
                </div>

                {authError && (
                  <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-lg text-center font-light animate-field-switch">
                    {authError}
                  </div>
                )}

                <form onSubmit={handleVerifyOtp} className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-medium text-gray-600 mb-1 text-center">
                      أدخل رمز التحقق (OTP)
                    </label>
                    <input
                      type="text"
                      maxLength="6"
                      autoFocus
                      required
                      value={authOtp}
                      onChange={(e) => setAuthOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••••"
                      className="w-full text-center text-xl font-bold tracking-[0.3em] font-mono py-2 bg-gray-50 focus:bg-white border border-gray-300 focus:border-gray-900 rounded-xl outline-none transition shadow-2xs"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={authLoading || authOtp.length < 4}
                    className="w-full py-2 text-white font-medium text-xs rounded-xl shadow-xs hover:opacity-95 active:scale-98 transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
                    style={{ backgroundColor: storeConfig.primaryColor }}
                  >
                    {authLoading ? (
                      <span>جاري التحقق...</span>
                    ) : (
                      <>
                        <span>تأكيد وإنشاء الحساب</span>
                        <i className="fa-solid fa-check text-xs"></i>
                      </>
                    )}
                  </button>

                  <div className="flex items-center justify-between text-[10px] text-gray-500 pt-1">
                    <button
                      type="button"
                      onClick={() => setAuthStep('credentials')}
                      className="text-gray-500 hover:text-black transition cursor-pointer flex items-center gap-1"
                    >
                      <i className="fa-solid fa-arrow-right text-[9px]"></i>
                      <span>تعديل البيانات</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={otpResendCountdown > 0 || authLoading}
                      className="text-[#004956] font-medium hover:underline disabled:text-gray-400 disabled:no-underline cursor-pointer"
                    >
                      {otpResendCountdown > 0 ? `إعادة الإرسال (${otpResendCountdown}s)` : 'إعادة إرسال الرمز'}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
            /* الجزء العلوي: رأس النافذة والتبديل للمستخدم غير المسجل */
            <div>
              <div className="text-center pt-0 mb-2">
                <div 
                  className="w-7 h-7 mx-auto rounded-lg flex items-center justify-center text-white text-[11px] shadow-2xs mb-1 transition-transform duration-300 hover:scale-105"
                  style={{ backgroundColor: storeConfig.primaryColor }}
                >
                  <i className={`fa-regular ${authMode === 'login' ? 'fa-user' : 'fa-id-card'} transition-all duration-300`}></i>
                </div>
                <h3 className="text-[13px] font-medium text-gray-900 tracking-tight transition-all duration-200">
                  {authMode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب جديد'}
                </h3>
              </div>

              {/* التبديل بموشن انزلاقي سلس جداً (Smooth Sliding Tab Motion) */}
              <div className="relative grid grid-cols-2 bg-gray-100/70 rounded-lg p-0.5 mb-2 overflow-hidden border border-gray-100">
                {/* المؤشر المنزلق (Sliding Pill Indicator) */}
                <div 
                  className="absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] bg-white rounded-md shadow-xs transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] z-0"
                  style={{
                    transform: authMode === 'login' ? 'translateX(0%)' : 'translateX(-100%)'
                  }}
                />

                <button
                  type="button"
                  onClick={() => { setAuthMode('login'); setAuthError(''); }}
                  className={`relative z-10 w-full py-1 rounded-md text-[10.5px] transition-colors duration-200 cursor-pointer text-center ${
                    authMode === 'login'
                      ? 'text-gray-900 font-medium'
                      : 'text-gray-400 hover:text-gray-700 font-light'
                  }`}
                >
                  تسجيل الدخول
                </button>

                <button
                  type="button"
                  onClick={() => { setAuthMode('register'); setAuthError(''); }}
                  className={`relative z-10 w-full py-1 rounded-md text-[10.5px] transition-colors duration-200 cursor-pointer text-center ${
                    authMode === 'register'
                      ? 'text-gray-900 font-medium'
                      : 'text-gray-400 hover:text-gray-700 font-light'
                  }`}
                >
                  حساب جديد
                </button>
              </div>

              {/* إشعار الخطأ */}
              {authError && (
                <div className="mb-2 p-1.5 bg-red-50 border border-red-200 text-red-700 text-[10px] rounded-lg text-center animate-field-switch">
                  {authError}
                </div>
              )}

              {/* نموذج الإدخال */}
              <form onSubmit={handleAuthSubmit} className="space-y-2">
                {authMode === 'register' && (
                  <div className="animate-field-switch">
                    <label className="block text-[10px] font-light text-gray-500 mb-0.5">الاسم الكامل</label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        value={authName}
                        onChange={(e) => setAuthName(e.target.value)}
                        placeholder="مثال: أحمد علي"
                        className="w-full px-2.5 py-1.5 bg-gray-50/70 focus:bg-white border border-gray-200/70 focus:border-gray-900 focus:ring-1 focus:ring-gray-900/10 rounded-lg text-xs outline-none transition-all duration-200 font-light placeholder:text-gray-300 text-gray-800"
                      />
                      <i className="fa-regular fa-id-badge absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-300 pointer-events-none transition-colors"></i>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[10px] font-light text-gray-500 transition-all duration-200">
                      {authMethod === 'phone' ? 'رقم الهاتف' : 'البريد الإلكتروني'}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMethod(authMethod === 'phone' ? 'email' : 'phone');
                        setAuthIdentifier('');
                        setAuthError('');
                      }}
                      className="text-[10px] font-light text-[#004956] hover:text-[#002f37] cursor-pointer transition-all duration-200 flex items-center gap-1 px-1 py-0.2 rounded hover:bg-gray-100/70 active:scale-95 group"
                    >
                      <i className={`text-[8.5px] transition-transform duration-300 group-hover:scale-110 ${authMethod === 'phone' ? 'fa-regular fa-envelope' : 'fa-solid fa-mobile-screen'}`}></i>
                      <span className="transition-opacity duration-200">{authMethod === 'phone' ? 'بالبريد' : 'بالهاتف'}</span>
                    </button>
                  </div>
                  {authMethod === 'phone' ? (
                    <div key="auth-field-phone" className="animate-field-switch relative flex items-center gap-1.5">
                      {/* زر رمز الدولة مع العلم */}
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setIsCountryPickerOpen(!isCountryPickerOpen)}
                          className="px-2 py-1.5 bg-gray-50/90 hover:bg-gray-100 border border-gray-200/70 rounded-lg text-xs flex items-center gap-1 cursor-pointer transition-all duration-200 font-light text-gray-800 active:scale-95"
                          title="اختر رمز الدولة"
                        >
                          <span className="text-xs leading-none transition-transform duration-200">{selectedCountryCode.flag}</span>
                          <span className="font-mono text-[10px] text-gray-700" dir="ltr">{selectedCountryCode.code}</span>
                          <i className={`fa-solid fa-chevron-down text-[6px] text-gray-400 transition-transform duration-200 ${isCountryPickerOpen ? 'rotate-180' : ''}`}></i>
                        </button>

                        {/* قائمة اختيار الدول */}
                        {isCountryPickerOpen && (
                          <>
                            <div 
                              className="fixed inset-0 z-30" 
                              onClick={() => setIsCountryPickerOpen(false)}
                            />
                            <div className="absolute right-0 mt-1 w-38 bg-white rounded-xl border border-gray-200/80 shadow-xl p-1 z-40 text-xs space-y-0.5 animate-field-switch">
                              {[
                                { code: '+964', flag: '🇮🇶', name: 'العراق' },
                                { code: '+966', flag: '🇸🇦', name: 'السعودية' },
                                { code: '+971', flag: '🇦🇪', name: 'الإمارات' },
                                { code: '+965', flag: 'الكويت' },
                                { code: '+974', flag: '🇶🇦', name: 'قطر' },
                                { code: '+968', flag: '🇴🇲', name: 'عمان' },
                                { code: '+962', flag: '🇯🇴', name: 'الأردن' },
                                { code: '+20', flag: '🇪🇬', name: 'مصر' },
                                { code: '+1', flag: '🇺🇸', name: 'أمريكا' }
                              ].map((c) => (
                                <button
                                  key={c.code}
                                  type="button"
                                  onClick={() => {
                                    setSelectedCountryCode(c);
                                    setIsCountryPickerOpen(false);
                                  }}
                                  className={`w-full px-2 py-1 rounded-md flex items-center justify-between text-right cursor-pointer transition-all duration-150 ${
                                    selectedCountryCode.code === c.code 
                                      ? 'bg-gray-100 font-medium text-black' 
                                      : 'hover:bg-gray-50 text-gray-700'
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    <span>{c.flag}</span>
                                    <span className="text-[10px] font-light">{c.name}</span>
                                  </span>
                                  <span className="text-[9px] font-mono text-gray-400" dir="ltr">{c.code}</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      {/* حقل إدخال رقم الهاتف */}
                      <div className="relative flex-1">
                        <input
                          type="tel"
                          required
                          value={authIdentifier}
                          onChange={(e) => setAuthIdentifier(e.target.value)}
                          placeholder="780 123 4567"
                          className="w-full px-2.5 py-1.5 bg-gray-50/70 focus:bg-white border border-gray-200/70 focus:border-gray-900 focus:ring-1 focus:ring-gray-900/10 rounded-lg text-xs outline-none transition-all duration-200 font-light placeholder:text-gray-300 text-gray-800"
                          dir="ltr"
                          style={{ textAlign: 'right' }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div key="auth-field-email" className="animate-field-switch relative">
                      <input
                        type="email"
                        required
                        value={authIdentifier}
                        onChange={(e) => setAuthIdentifier(e.target.value)}
                        placeholder="name@example.com"
                        className="w-full px-2.5 py-1.5 bg-gray-50/70 focus:bg-white border border-gray-200/70 focus:border-gray-900 focus:ring-1 focus:ring-gray-900/10 rounded-lg text-xs outline-none transition-all duration-200 font-light placeholder:text-gray-300 text-gray-800"
                        dir="ltr"
                        style={{ textAlign: 'right' }}
                      />
                      <i className="fa-regular fa-envelope absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-300 pointer-events-none transition-colors"></i>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[10px] font-light text-gray-500">كلمة المرور</label>
                    {authMode === 'login' && (
                      <button
                        type="button"
                        onClick={() => alert('يرجى مراسلتنا عبر الواتساب لاستعادة حسابك')}
                        className="text-[9px] font-light text-gray-400 hover:text-black transition"
                      >
                        نسيت الكلمة؟
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="password"
                      required
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-2.5 py-1.5 bg-gray-50/70 focus:bg-white border border-gray-200/70 focus:border-gray-900 focus:ring-1 focus:ring-gray-900/10 rounded-lg text-xs outline-none transition-all duration-200 font-light placeholder:text-gray-300 text-gray-800"
                    />
                    <i className="fa-solid fa-lock absolute left-2.5 top-1/2 -translate-y-1/2 text-[9.5px] text-gray-300 pointer-events-none"></i>
                  </div>
                </div>

                {/* زر التأكيد الرئيسي الناعم */}
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-1.5 mt-1 text-white font-light text-xs rounded-lg shadow-2xs hover:opacity-95 active:scale-98 transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 group disabled:opacity-60"
                  style={{ backgroundColor: storeConfig.primaryColor }}
                >
                  {authLoading ? (
                    <span>جاري المعالجة...</span>
                  ) : (
                    <>
                      <span>{authMode === 'login' ? 'دخول' : 'إرسال كود التحقق'}</span>
                      <i className="fa-solid fa-arrow-left text-[8.5px] transition-transform duration-200 group-hover:-translate-x-1"></i>
                    </>
                  )}
                </button>
                {/* حاوية اختبار الأمان لرسائل SMS لفايربيس */}
                <div id="recaptcha-container" className="flex justify-center my-1"></div>
              </form>
            </div>
            )}

            {/* حاوية بديلة عامة للـ recaptcha خارج النموذج لضمان الاستدعاء */}
            <div id="recaptcha-container-global"></div>

            {/* شروط الاستخدام والخصوصية في الأسفل دائماً بثبات */}
            <div className="pt-1.5 border-t border-gray-100/70 text-center">
              <p className="text-[9.5px] font-light text-gray-400 leading-tight">
                بتسجيلك، أنت توافق على شروط الاستخدام وسياسة الخصوصية
              </p>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ======================================================================== */}
      {/* نافذة التحقق من صلاحية الإدارة (Admin Security Modal)                     */}
      {/* ======================================================================== */}
      {isAdminAuthModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
          <div className="relative w-full max-w-sm bg-white rounded-2xl border border-gray-100 shadow-2xl p-5 space-y-4 animate-field-switch">
            <button
              type="button"
              onClick={() => setIsAdminAuthModalOpen(false)}
              className="absolute top-3 left-3 w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-black flex items-center justify-center text-xs cursor-pointer transition"
            >
              ✕
            </button>

            <div className="text-center space-y-1">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-[#004956] text-white flex items-center justify-center text-xl shadow-sm mb-2">
                <i className="fa-solid fa-user-shield"></i>
              </div>
              <h3 className="text-base font-bold text-gray-900">منطقة مدير المتجر</h3>
              <p className="text-xs text-gray-500">
                يرجى إدخال رمز المرور السري المخصص لإدارة المتجر للدخول إلى لوحة التحكم.
              </p>
            </div>

            {adminAuthError && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl text-center font-medium">
                {adminAuthError}
              </div>
            )}

            <form onSubmit={handleAdminAuthSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">رمز مرور الإدارة (PIN / Password)</label>
                <div className="relative">
                  <input
                    type="password"
                    autoFocus
                    required
                    value={adminPinInput}
                    onChange={(e) => setAdminPinInput(e.target.value)}
                    placeholder="أدخل رمز مرور المدير..."
                    className="w-full px-3 py-2 bg-gray-50 focus:bg-white border border-gray-300 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 rounded-xl text-sm outline-none transition"
                  />
                  <i className="fa-solid fa-key absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#004956] hover:bg-[#00343D] text-white text-xs font-bold rounded-xl shadow-xs transition active:scale-98 cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <i className="fa-solid fa-lock-open text-xs"></i>
                  <span>تأكيد الدخول للإدارة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsAdminAuthModalOpen(false)}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-xl transition cursor-pointer"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ======================================================================== */}
      {/* نافذة سلة المشتريات (تظهر الباركود المخصص QR Code عند كل وسيلة دفع)       */}
      {/* ======================================================================== */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden font-normal">
          <div onClick={closeCartWithMotion} className={`fixed inset-0 bg-black/40 backdrop-blur-md transition-all duration-600 ${cartAnimating ? 'opacity-100' : 'opacity-0'}`}></div>
          <div className="fixed inset-y-0 left-0 max-w-full flex pl-0 pointer-events-none">
            <div className={`w-screen max-w-md bg-white shadow-xl flex flex-col justify-between pointer-events-auto border-r border-gray-100 transition-all duration-650 transform ${cartAnimating ? 'translate-x-0' : '-translate-x-full'}`} dir="rtl">
              
              <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-bag-shopping text-black text-base"></i>
                  <div>
                    <h3 className="font-medium text-sm text-gray-800">سلة المشتريات والدفع</h3>
                    <span className="text-[10px] text-gray-400">ادفع بالمسح السريع عبر الباركود</span>
                  </div>
                </div>
                <button onClick={closeCartWithMotion} className="w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {cartItems.length === 0 ? (
                  <div className="text-center py-20">
                    <i className="fa-solid fa-cart-shopping text-gray-300 text-4xl block mb-2"></i>
                    <p className="text-gray-600 text-sm font-medium">سلة مشترياتك فارغة حالياً</p>
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-gray-100 border border-gray-100 rounded-2xl p-3 bg-gray-50/30">
                      {cartItems.map((item) => (
                        <div key={item.cartItemId} className="py-2.5 flex gap-3 items-center">
                          <img src={item.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover border border-gray-100" />
                          <div className="flex-1 min-w-0">
                            <h4 className="text-xs text-gray-800 truncate font-medium">{item.title}</h4>
                            {(() => {
                              const originalProd = products.find(p => p.id === item.productId);
                              const hasTiers = originalProd && originalProd.hasQuantityTiers && Array.isArray(originalProd.quantityTiers) && originalProd.quantityTiers.length > 0;
                              
                              if (hasTiers && item.tierLabel) {
                                return (
                                  <div className="mt-1">
                                    <select
                                      value={originalProd.quantityTiers.find(t => t.label === item.tierLabel)?.id || item.tierLabel}
                                      onChange={(e) => {
                                        const selected = originalProd.quantityTiers.find(t => String(t.id || t.label) === e.target.value);
                                        if (selected) {
                                          updateCartItemTier(item.cartItemId, originalProd, selected);
                                        }
                                      }}
                                      className="text-[10px] sm:text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 focus:border-emerald-400 px-2 py-1 rounded-lg w-full max-w-[160px] outline-none cursor-pointer shadow-2xs transition-colors appearance-none relative"
                                      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27%23065f46%27%3E%3Cpath d=%27M7 10l5 5 5-5z%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'left 4px center', backgroundSize: '14px', paddingLeft: '22px' }}
                                    >
                                      {originalProd.quantityTiers.map((t, idx) => (
                                        <option key={idx} value={t.id || t.label}>{t.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                );
                              } else if (item.tierLabel) {
                                return (
                                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded block mt-0.5 w-fit">
                                    {item.tierLabel}
                                  </span>
                                );
                              }
                              return null;
                            })()}
                            {item.productType === 'exchange' && (
                              <span className="text-[9px] text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded flex items-center gap-1 mt-0.5 w-fit font-bold border border-teal-200">
                                <i className="fa-solid fa-right-left text-teal-700 text-[8.5px]"></i>
                                <span>مبادلة: {(item.exchangeAmount || 1) * item.quantity} {item.exchangeCurrencyName || ''}</span>
                              </span>
                            )}
                            {item.productType === 'physical' && (
                              <span className="text-[9px] text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded flex items-center gap-1 mt-0.5 w-fit font-medium">
                                <i className="fa-solid fa-box text-amber-700 text-[9px]"></i>
                                <span>منتج ملموس (يتطلب شحن)</span>
                              </span>
                            )}
                            {item.productType === 'license' && (
                              <span className="text-[9px] text-purple-800 bg-purple-50 px-1.5 py-0.5 rounded flex items-center gap-1 mt-0.5 w-fit font-medium">
                                <span>💳</span>
                                <span>بطاقة رقمية (كود تسليم بعد الإكمال)</span>
                              </span>
                            )}
                            {item.productType === 'digital' && (
                              <span className="text-[9px] text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1 mt-0.5 w-fit font-medium">
                                <span>⚡</span>
                                <span>منتج رقمي (بدون شحن)</span>
                              </span>
                            )}
                            {item.userNote && (
                              <div className="mt-1 p-1 bg-teal-50/70 rounded border border-teal-200 text-[9.5px] text-teal-950 leading-tight">
                                <span className="font-bold">بياناتك: </span>
                                <span>{item.userNote}</span>
                              </div>
                            )}
                            {item.productType === 'exchange' ? (
                              <div className="text-xs text-teal-900 font-bold font-price mt-0.5">
                                مقابل {(item.exchangeAmount || 1) * item.quantity} {item.exchangeCurrencyName || 'مبادلة'}
                              </div>
                            ) : (
                              <div className="text-xs text-black font-bold font-price mt-0.5">{formatPrice(item.priceUsd, activeCurrency)}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 border rounded-lg p-0.5">
                            <button onClick={() => updateQuantity(item.cartItemId, -1)} className="w-5 h-5 flex items-center justify-center text-xs">-</button>
                            <span className="text-xs">{item.quantity}</span>
                            <button onClick={() => updateQuantity(item.cartItemId, 1)} className="w-5 h-5 flex items-center justify-center text-xs">+</button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* خيارات اختيار وسيلة الدفع */}
                    <div className="pt-1">
                      <label className="block text-xs text-gray-600 mb-2 font-medium">اختر وسيلة الدفع:</label>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                        {[
                          { id: 'wallet', label: 'المحفظة', icon: '💰' },
                          { id: 'binance', label: 'Binance Pay', icon: '🟡' },
                          { id: 'zaincash', label: 'زين كاش', icon: '📱' },
                          { id: 'iraqimaster', label: 'ماستر كارد', icon: '💳' },
                          { id: 'okx', label: 'OKX Pay', icon: '⚫' },
                          { id: 'telegram', label: 'تيليجرام', icon: '✈️' },
                          { id: 'whatsapp', label: 'واتساب', icon: '💬' }
                        ].map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setPaymentMethod(m.id);
                              setPaymentTxProof('');
                            }}
                            className={`p-2 rounded-xl border text-center transition cursor-pointer text-xs ${
                              paymentMethod === m.id
                                ? 'border-[#004956] bg-emerald-50/50 text-[#004956] font-medium shadow-xs'
                                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                          >
                            <span className="text-base block">{m.icon}</span>
                            <span className="text-[10px] mt-0.5 block">{m.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* عرض تفاصيل الدفع مع الباركود التفاعلي (QR Code) أو رصيد المحفظة */}
                    <div className="relative overflow-hidden pt-1">

                      {/* 0. الدفع المباشر من رصيد المحفظة */}
                      {paymentMethod === 'wallet' && (
                        <div className="p-3.5 bg-gradient-to-b from-indigo-50/80 to-white border border-indigo-200 rounded-2xl space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-indigo-950 font-medium">الدفع برصيد المحفظة:</span>
                            <span className="font-bold text-indigo-900 font-mono">${totalCartPriceUsd.toFixed(2)}</span>
                          </div>

                          {!currentUser ? (
                            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-2">
                              <p className="text-xs text-amber-800 font-medium">
                                يرجى تسجيل الدخول أولاً لتتمكن من الدفع برصيد محفظتك.
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  closeCartWithMotion();
                                  openAuthModal('login');
                                }}
                                className="px-3 py-1.5 bg-[#004956] text-white text-xs font-bold rounded-xl cursor-pointer"
                              >
                                تسجيل الدخول الآن
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-2.5">
                              <div className="p-2.5 bg-white rounded-xl border border-indigo-100 flex items-center justify-between">
                                <div>
                                  <span className="text-[10px] text-gray-400 block">رصيد محفظتك المتوفر:</span>
                                  <span className="text-sm font-black text-gray-900 font-mono">
                                    ${parseFloat(currentUser.balance || 0).toFixed(2)}
                                  </span>
                                </div>
                                <div className="text-left font-mono text-[11px]">
                                  {parseFloat(currentUser.balance || 0) >= totalCartPriceUsd ? (
                                    <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-bold border border-emerald-200">
                                      ✓ رصيد كافٍ
                                    </span>
                                  ) : (
                                    <span className="text-red-700 bg-red-50 px-2 py-0.5 rounded-full font-bold border border-red-200">
                                      غير كافٍ (ينقصك ${(totalCartPriceUsd - parseFloat(currentUser.balance || 0)).toFixed(2)})
                                    </span>
                                  )}
                                </div>
                              </div>

                              {parseFloat(currentUser.balance || 0) >= totalCartPriceUsd ? (
                                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-900 leading-relaxed space-y-1">
                                  <div className="font-bold flex items-center gap-1">
                                    <span>⚡</span>
                                    <span>دفع فوري واعتماد تلقائي:</span>
                                  </div>
                                  <p className="text-[10.5px]">
                                    سيتم خصم المبلغ فوراً من محفظتك واعتماد الطلب بحالة "قيد التنفيذ" مباشرة بدون الحاجة لإرفاق إشعار تحويل!
                                  </p>
                                </div>
                              ) : (
                                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 leading-relaxed space-y-1">
                                  <p>رصيدك غير كافٍ لتغطية إجمالي السلة. يمكنك شحن المحفظة من ملفك الشخصي أو اختيار وسيلة دفع أخرى.</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* 1. باركود وبيانات Binance Pay */}
                      {paymentMethod === 'binance' && (
                        <div className="p-3.5 bg-gradient-to-b from-amber-50/80 to-white border border-[#F3BA2F]/60 rounded-2xl space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-amber-950 font-medium">الدفع بـ Binance Pay (USDT):</span>
                            <span className="font-bold text-amber-900 font-mono">${totalCartPriceUsd.toFixed(2)} USDT</span>
                          </div>

                          {/* عرض باركود Binance Pay إن وجد */}
                          {storeConfig.binanceQrCode && (
                            <div className="flex flex-col items-center justify-center p-3 bg-white rounded-xl border border-amber-200 shadow-2xs">
                              <img
                                src={storeConfig.binanceQrCode}
                                alt="باركود بينانس باي"
                                className="w-36 h-36 object-contain rounded-lg border border-gray-100"
                              />
                              <span className="text-[10px] text-amber-900 mt-1.5 font-medium flex items-center gap-1">
                                <span>📷</span>
                                <span>امسح الباركود بتطبيق Binance للتحويل الفوري</span>
                              </span>
                            </div>
                          )}

                          <div className="bg-white p-2.5 rounded-xl border border-amber-200 flex items-center justify-between">
                            <div>
                              <span className="text-[10px] text-gray-400 block">أو عبر Pay ID:</span>
                              <span className="text-xs text-gray-800 font-mono font-medium">{storeConfig.binancePayId}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(storeConfig.binancePayId, 'binance')}
                              className="px-2.5 py-1 bg-gray-900 text-white text-[10px] rounded-lg"
                            >
                              {copySuccessKey === 'binance' ? '✓ تم' : 'نسخ'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* 2. باركود وبيانات زين كاش (ZainCash) */}
                      {paymentMethod === 'zaincash' && (
                        <div className="p-3.5 bg-gradient-to-b from-purple-50/80 to-white border border-purple-200 rounded-2xl space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-purple-950 font-medium">المبلغ المطلوب عبر زين كاش:</span>
                            <span className="font-bold text-purple-900">{totalCartPriceIqd.toLocaleString('en-US')} د.ع</span>
                          </div>

                          {/* عرض باركود زين كاش */}
                          {storeConfig.zainCashQrCode && (
                            <div className="flex flex-col items-center justify-center p-3 bg-white rounded-xl border border-purple-200 shadow-2xs">
                              <img
                                src={storeConfig.zainCashQrCode}
                                alt="باركود زين كاش"
                                className="w-36 h-36 object-contain rounded-lg border border-gray-100"
                              />
                              <span className="text-[10px] text-purple-900 mt-1.5 font-medium flex items-center gap-1">
                                <span>📱</span>
                                <span>امسح الباركود بتطبيق زين كاش لتحويل المبلغ</span>
                              </span>
                            </div>
                          )}

                          <div className="bg-white p-2.5 rounded-xl border border-purple-200 flex items-center justify-between">
                            <div>
                              <span className="text-[10px] text-gray-400 block">أو رقم المحفظة:</span>
                              <span className="text-xs text-gray-800 font-mono font-medium" dir="ltr">{storeConfig.zainCashNumber}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(storeConfig.zainCashNumber, 'zain')}
                              className="px-2.5 py-1 bg-purple-700 text-white text-[10px] rounded-lg"
                            >
                              {copySuccessKey === 'zain' ? '✓ تم' : 'نسخ'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* 3. باركود وبيانات الماستر كارد العراقي */}
                      {paymentMethod === 'iraqimaster' && (
                        <div className="p-3.5 bg-gradient-to-b from-red-50/80 to-white border border-red-200 rounded-2xl space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-red-950 font-medium">المبلغ المطلوب مصرفياً:</span>
                            <span className="font-bold text-red-900">{totalCartPriceIqd.toLocaleString('en-US')} د.ع</span>
                          </div>

                          {/* عرض باركود الماستر كارد / الحساب البنكي إن وُجد */}
                          {storeConfig.masterCardQrCode ? (
                            <div className="flex flex-col items-center justify-center p-3 bg-white rounded-xl border border-red-200 shadow-2xs">
                              <img
                                src={storeConfig.masterCardQrCode}
                                alt="باركود البطاقة المصرفية"
                                className="w-36 h-36 object-contain rounded-lg border border-gray-100"
                              />
                              <span className="text-[10px] text-red-900 mt-1.5 font-medium">
                                امسح باركود البطاقة عبر تطبيق مصرفك
                              </span>
                            </div>
                          ) : null}

                          <div className="bg-white p-2.5 rounded-xl border border-red-200 flex items-center justify-between">
                            <div>
                              <span className="text-[10px] text-gray-400 block">{storeConfig.masterCardBeneficiary}:</span>
                              <span className="text-xs text-gray-800 font-mono font-medium" dir="ltr">{storeConfig.masterCardIraqi}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(storeConfig.masterCardIraqi, 'master')}
                              className="px-2.5 py-1 bg-red-700 text-white text-[10px] rounded-lg"
                            >
                              {copySuccessKey === 'master' ? '✓ تم' : 'نسخ'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* 4. باركود وبيانات OKX */}
                      {paymentMethod === 'okx' && (
                        <div className="p-3.5 bg-gradient-to-b from-gray-50/80 to-white border border-gray-300 rounded-2xl space-y-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-900 font-medium">المبلغ المطلوب عبر OKX:</span>
                            <span className="font-bold text-gray-900 font-mono">${totalCartPriceUsd.toFixed(2)} USDT</span>
                          </div>

                          {/* عرض باركود محفظة OKX USDT */}
                          {storeConfig.okxQrCode && (
                            <div className="flex flex-col items-center justify-center p-3 bg-white rounded-xl border border-gray-200 shadow-2xs">
                              <img
                                src={storeConfig.okxQrCode}
                                alt="باركود محفظة OKX"
                                className="w-36 h-36 object-contain rounded-lg border border-gray-100"
                              />
                              <span className="text-[10px] text-gray-700 mt-1.5 font-medium flex items-center gap-1">
                                <span>⚫</span>
                                <span>امسح الباركود للتحويل عبر شبكة TRC20</span>
                              </span>
                            </div>
                          )}

                          <div className="bg-white p-2.5 rounded-xl border border-gray-200 flex items-center justify-between">
                            <div>
                              <span className="text-[10px] text-gray-400 block">OKX UID:</span>
                              <span className="text-xs text-gray-800 font-mono font-medium">{storeConfig.okxUid}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(storeConfig.okxUid, 'okxUid')}
                              className="px-2.5 py-1 bg-gray-900 text-white text-[10px] rounded-lg"
                            >
                              {copySuccessKey === 'okxUid' ? '✓ تم' : 'نسخ'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* 5. واتساب */}
                      {paymentMethod === 'whatsapp' && (
                        <div className="p-3.5 bg-gradient-to-b from-emerald-50/80 to-white border border-[#25D366]/40 rounded-2xl space-y-2">
                          <p className="text-xs text-gray-600">
                            سيتم تسجيل طلبك وإرسال تفاصيله تلقائياً لخدمة العملاء عبر واتساب للمساعدة في الاستلام السريع.
                          </p>
                        </div>
                      )}

                      {/* 6. تيليجرام */}
                      {paymentMethod === 'telegram' && (
                        <div className="p-3.5 bg-gradient-to-b from-sky-50/80 to-white border border-sky-300 rounded-2xl space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base">✈️</span>
                            <span className="text-xs font-bold text-sky-900">التأكيد عبر تطبيق تيليجرام</span>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed">
                            سيتم تسجيل طلبك في النظام فوراً وتوجيهك إلى حساب الدعم على تيليجرام (@{storeConfig.telegram || 'dokkan_store'}) مع نص الطلب كاملاً لتأكيد الاستلام والتنفيذ.
                          </p>
                        </div>
                      )}

                      {/* رفع إشعار التحويل */}
                      {paymentMethod !== 'whatsapp' && paymentMethod !== 'telegram' && paymentMethod !== 'wallet' && (
                        <div className="space-y-2 pt-2">
                          <label className="block text-xs text-gray-700 font-medium">
                            إرفاق صورة إشعار التحويل (لقطة الشاشة) *
                          </label>
                          <label className="cursor-pointer border border-dashed border-gray-300 hover:border-gray-400 p-3 rounded-xl bg-white text-center flex flex-col items-center justify-center transition">
                            <span className="text-xl mb-0.5">📸</span>
                            <span className="text-xs text-gray-600">اضغط لرفع لقطة شاشة التحويل بعد المسح</span>
                            <input type="file" accept="image/*" onChange={handleProofImageUpload} className="hidden" />
                          </label>

                          {paymentTxProof && (
                            <div className="relative w-full h-24 rounded-xl overflow-hidden border border-gray-200 mt-2">
                              <img src={paymentTxProof} alt="إشعار التحويل" className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={() => setPaymentTxProof('')}
                                className="absolute top-1.5 right-1.5 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  </>
                )}
              </div>

              {cartItems.length > 0 && (
                <div className="p-4 border-t border-gray-100 bg-white space-y-2.5">
                  <div className="flex justify-between items-center text-sm text-gray-800">
                    <span className="font-normal">المجموع:</span>
                    <span className="text-base font-medium" style={{ color: storeConfig.primaryColor }}>
                      {cartItems.every(it => it.productType === 'exchange')
                        ? 'مبادلة (بدون نقود)'
                        : paymentMethod === 'zaincash' || paymentMethod === 'iraqimaster'
                        ? `${totalCartPriceIqd.toLocaleString('en-US')} د.ع`
                        : `$${totalCartPriceUsd.toFixed(2)}`}
                    </span>
                  </div>

                  <button
                    disabled={isCheckingOut}
                    onClick={() => {
                      if (isCheckingOut) return;
                      if (paymentMethod === 'whatsapp') {
                        handleWhatsAppCheckout();
                      } else if (paymentMethod === 'telegram') {
                        handleTelegramCheckout();
                      } else {
                        handleConfirmOrderWithProof(paymentMethod);
                      }
                    }}
                    className={`w-full py-3 text-white font-medium rounded-xl shadow-xs transition flex items-center justify-center gap-2 ${
                      isCheckingOut
                        ? 'opacity-60 cursor-not-allowed bg-gray-400'
                        : paymentMethod === 'wallet'
                        ? 'bg-emerald-700 hover:bg-emerald-800 cursor-pointer active:scale-98'
                        : 'bg-[#004956] hover:bg-[#00343D] cursor-pointer active:scale-98'
                    }`}
                  >
                    {isCheckingOut ? (
                      <>
                        <i className="fa-solid fa-circle-notch animate-spin text-sm"></i>
                        <span>جاري معالجة الطلب بأمان...</span>
                      </>
                    ) : paymentMethod === 'wallet' ? (
                      <>
                        <i className="fa-solid fa-wallet text-xs"></i>
                        <span>تأكيد ودفع من المحفظة (${totalCartPriceUsd.toFixed(2)})</span>
                      </>
                    ) : (
                      <span>تأكيد وإرسال الطلب</span>
                    )}
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* ======================================================================== */}
      {/* 1. لوحة التحكم - إضافة خانات رفع الباركود لجميع وسائل الدفع                 */}
      {/* ======================================================================== */}
      {/* ======================================================================== */}
      {/* 1. لوحة التحكم المتقدمة والمتكاملة لإدارة المنتجات الرقمية والطلبات والمستخدمين */}
      {/* ======================================================================== */}
      {viewMode === 'admin' && (
        isManager ? (
          <div className="animate-admin-entrance w-full">
            <AdminDashboard
              storeConfig={storeConfig}
              setStoreConfig={setStoreConfig}
              products={products}
              setProducts={setProducts}
              orders={orders}
              setOrders={setOrders}
              categories={categories}
              setCategories={setCategories}
              handleUploadPaymentQr={handleUploadPaymentQr}
              setActiveProductForPage={setActiveProductForPage}
              currentUser={currentUser}
              setViewMode={setViewMode}
              initialTab="analytics"
              activeSection={adminSection}
              formatPrice={formatPrice}
              activeCurrency={activeCurrency}
              customers={customers}
              setCustomers={setCustomers}
              setCurrentUser={setCurrentUser}
              topupRequests={topupRequests}
              setTopupRequests={setTopupRequests}
              sendNotification={sendNotification}
              deletedOrderIdsRef={deletedOrderIdsRef}
            />
          </div>
        ) : (
          <div className="max-w-md mx-auto my-20 p-6 bg-white rounded-2xl border border-gray-100 shadow-sm text-center">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-3 text-xl">
              <i className="fa-solid fa-lock"></i>
            </div>
            <h3 className="font-bold text-gray-900 text-sm mb-1">منطقة مخصصة للإدارة والمشرفين</h3>
            <p className="text-xs text-gray-500 mb-4">هذه الصفحة متاحة فقط للمدير والمشرفين المصرح لهم بعد تسجيل الدخول.</p>
            <button
              onClick={() => setViewMode('store')}
              className="px-4 py-2 bg-[#004956] text-white text-xs font-bold rounded-xl cursor-pointer"
            >
              العودة إلى المتجر
            </button>
          </div>
        )
      )}

      {/* ========================================================= */}
      {/* 2. واجهة عرض المتجر للعملاء                               */}
      {/* ========================================================= */}
      {viewMode === 'store' && (
        <div key="store-view-container" className="animate-page-view">
          <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 font-normal space-y-6">
            {Array.isArray(storeConfig.homeLayout) && storeConfig.homeLayout.filter(s => s.enabled !== false).length === 0 ? (
              <div className="text-center py-20 px-4 bg-[#FCFCFC] rounded-2xl border border-dashed border-gray-300 shadow-2xs space-y-3">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-gray-50 flex items-center justify-center text-[#004956] text-2xl">
                  <i className="fa-solid fa-store"></i>
                </div>
                <h3 className="text-sm font-bold text-gray-800">لا توجد عناصر مضافة للصفحة الرئيسية حالياً</h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  يمكن لمدير المتجر الدخول للوحة التحكم - تخصيص المتجر وإضافة البانرات والمنتجات والتصنيفات.
                </p>
                {isManager && (
                  <button
                    type="button"
                    onClick={handleOpenAdminPanel}
                    className="mt-2 px-4 py-2 bg-[#004956] text-white text-xs font-bold rounded-xl hover:bg-[#00343D] transition shadow-xs cursor-pointer"
                  >
                    <i className="fa-solid fa-sliders ml-1.5"></i>
                    <span>لوحة تحكم المتجر (المدير)</span>
                  </button>
                )}
              </div>
            ) : (
              (Array.isArray(storeConfig.homeLayout) ? storeConfig.homeLayout : [
                { id: 'sec-banner-slider', type: 'bannerSlider', enabled: true },
                { id: 'sec-items-list', type: 'itemsList', enabled: true },
                { id: 'sec-square-images', type: 'squareImages', enabled: true },
                { id: 'sec-moving-products', type: 'movingProducts', enabled: true },
                { id: 'sec-wide-banner', type: 'wideBanner', enabled: true },
                { id: 'sec-products-grid', type: 'productsGrid', enabled: true },
                { id: 'sec-store-features', type: 'storeFeatures', enabled: true },
                { id: 'sec-customer-reviews', type: 'customerReviews', enabled: true }
              ]).map((section) => {
                if (section.enabled === false) return null;

              // 1. بانر متحرك (سلايدر العروض والبانرات بنمط منصة سلة)
              if (section.type === 'bannerSlider') {
                const sliderConfig = storeConfig.homeSections?.bannerSlider || {};
                const slides = sliderConfig.slides || [];
                const fallbackSlide = slides[0] || {};
                const activeSlide = section.data || fallbackSlide;

                const handleSlideAction = () => {
                  const linkType = activeSlide?.linkType || (activeSlide?.linkProductId ? 'product' : activeSlide?.linkCat ? 'category' : activeSlide?.linkUrl ? 'url' : 'none');
                  
                  if (linkType === 'product' && activeSlide?.linkProductId) {
                    const targetProd = products.find(p => String(p.id) === String(activeSlide.linkProductId));
                    if (targetProd) {
                      setActiveProductForPage(targetProd);
                      setViewMode('product-detail');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                      return;
                    }
                  } else if (linkType === 'category' && activeSlide?.linkCat && activeSlide.linkCat !== 'الكل') {
                    handleCategoryClick(activeSlide.linkCat);
                    return;
                  } else if (activeSlide?.linkUrl) {
                    if (activeSlide.linkUrl.startsWith('http')) {
                      window.open(activeSlide.linkUrl, '_blank');
                    } else {
                      window.location.href = activeSlide.linkUrl;
                    }
                    return;
                  } else if (productsSectionRef.current) {
                    smoothScrollToElement(productsSectionRef.current, 700);
                  }
                };

                const rawRadius = activeSlide?.borderRadius ?? sliderConfig.borderRadius ?? '2px';
                const bannerRadius = rawRadius !== undefined && rawRadius !== null && rawRadius !== '' 
                  ? (typeof rawRadius === 'number' || !isNaN(rawRadius) ? `${rawRadius}px` : rawRadius)
                  : '2px';

                return (
                  <div 
                    key={section.id}
                    onClick={handleSlideAction}
                    style={{ borderRadius: bannerRadius }}
                    className="relative overflow-hidden group cursor-pointer"
                  >
                    <div 
                      style={{ borderRadius: bannerRadius }}
                      className="relative h-44 sm:h-64 md:h-80 w-full overflow-hidden"
                    >
                      <img
                        src={activeSlide?.imageUrl || 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&auto=format&fit=crop&q=80'}
                        alt={activeSlide?.title || 'بانر المتجر'}
                        className="w-full h-full object-cover object-center opacity-85 group-hover:scale-102 transition-transform duration-700"
                      />
                      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent flex flex-col justify-center px-5 sm:px-12 text-white text-right">
                        {(activeSlide?.badgeText !== '' && (activeSlide?.badgeText || 'عرض مميز وحصري')) && (
                          <span className="text-[10px] sm:text-xs font-bold text-emerald-400 mb-1 inline-flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span>{activeSlide?.badgeText || 'عرض مميز وحصري'}</span>
                          </span>
                        )}
                        <h2 className="text-base sm:text-2xl md:text-3xl font-extrabold max-w-xl leading-tight">
                          {activeSlide?.title || 'عروض حصرية لمزرعتك في Hay Day'}
                        </h2>
                        <p className="text-[11px] sm:text-sm text-gray-200 mt-1.5 sm:mt-2 max-w-lg line-clamp-2">
                          {activeSlide?.subtitle || 'خصومات تصل إلى 30% على الصكوك ومواد التوسعة بأعلى جودة'}
                        </p>
                        <div className="mt-3 sm:mt-5 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSlideAction();
                            }}
                            className="px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold shadow-md transition active:scale-95 cursor-pointer text-white flex items-center gap-2"
                            style={{ backgroundColor: storeConfig.primaryColor }}
                          >
                            <span>{activeSlide?.buttonText || 'تسوق الآن'}</span>
                            <i className="fa-solid fa-arrow-left text-xs"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              // 2. قائمة عناصر وتصنيفات (Categories List Widget)
              if (section.type === 'itemsList') {
                const ilData = section.data || storeConfig.homeSections?.itemsList || {};
                return (
                  <div key={section.id} className="bg-[#FCFCFC] rounded-2xl border border-gray-200/80 p-3 sm:p-4 shadow-2xs">
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <i className="fa-solid fa-layer-group text-xs text-gray-400"></i>
                        <h3 className="text-xs sm:text-sm font-semibold text-gray-900">
                          {ilData.title || storeConfig.homeSections?.itemsList?.title || 'تصفح كافة الأقسام والتصنيفات'}
                        </h3>
                      </div>
                      <span className="text-[10px] text-gray-400 font-normal">
                        {ilData.subtitle || 'اختر القسم للتصفح الفوري'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                      {categories.map((cat, idx) => {
                        const isSelected = selectedCat === cat.name;
                        return (
                          <button
                            key={cat.id || idx}
                            type="button"
                            onClick={() => handleCategoryClick(cat.name)}
                            className={`px-3 sm:px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer flex items-center gap-2 shrink-0 border ${
                              isSelected
                                ? 'bg-[#004956] text-white border-[#004956] shadow-xs'
                                : 'bg-white hover:bg-gray-100 text-gray-700 border-gray-200/80'
                            }`}
                          >
                            <i className={`fa-solid ${cat.icon || 'fa-tag'} text-xs ${isSelected ? 'text-white' : 'text-gray-500'}`}></i>
                            <span>{cat.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              // 3. صور مربعة (Square Images Grid بنمط منصة سلة)
              if (section.type === 'squareImages') {
                const sqConfig = section.data || storeConfig.homeSections?.squareImages || {};
                const items = (sqConfig.items && sqConfig.items.length > 0) ? sqConfig.items : [
                  { id: 'sq-1', title: 'فئة مميزة 1', subtitle: 'أحدث العروض', imageUrl: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=500&auto=format&fit=crop&q=80' },
                  { id: 'sq-2', title: 'فئة مميزة 2', subtitle: 'تسليم فوري', imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&auto=format&fit=crop&q=80' }
                ];

                const handleItemClick = (item) => {
                  const linkType = item?.linkType || (item?.linkProductId ? 'product' : item?.linkCat ? 'category' : item?.linkUrl ? 'url' : 'none');

                  if (linkType === 'product' && item?.linkProductId) {
                    const targetProd = products.find(p => String(p.id) === String(item.linkProductId));
                    if (targetProd) {
                      setActiveProductForPage(targetProd);
                      setViewMode('product-detail');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                      return;
                    }
                  } else if (linkType === 'category' && item?.linkCat && item.linkCat !== 'الكل') {
                    handleCategoryClick(item.linkCat);
                    return;
                  } else if (item?.linkUrl) {
                    if (item.linkUrl.startsWith('http')) {
                      window.open(item.linkUrl, '_blank');
                    } else {
                      window.location.href = item.linkUrl;
                    }
                    return;
                  } else if (productsSectionRef.current) {
                    smoothScrollToElement(productsSectionRef.current, 700);
                  }
                };

                return (
                  <div key={section.id} className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-4 bg-[#004956] rounded-full"></span>
                        <h3 className="text-xs sm:text-sm font-semibold text-gray-900">
                          {sqConfig.title || 'تسوق حسب الفئات المميزة'}
                        </h3>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                      {items.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          onClick={() => handleItemClick(item)}
                          className="group relative rounded-2xl overflow-hidden border border-gray-200/80 hover:border-gray-300 shadow-2xs hover:shadow-md transition-all duration-300 cursor-pointer bg-[#FCFCFC] flex flex-col justify-between"
                        >
                          <div className="relative pt-[100%] overflow-hidden bg-gray-50">
                            <img
                              src={item.imageUrl || 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400&auto=format&fit=crop&q=80'}
                              alt={item.title}
                              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-108"
                              loading="lazy"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent flex flex-col justify-end p-3 text-white text-right">
                              <h4 className="text-xs sm:text-sm font-bold truncate leading-tight drop-shadow-xs">
                                {item.title || 'عرض خاص'}
                              </h4>
                              {item.subtitle && (
                                <p className="text-[10px] text-gray-200 mt-0.5 truncate opacity-90 drop-shadow-xs">
                                  {item.subtitle}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }

              // 4. منتجات متحركة (Sliding Products Carousel بنمط سلة)
              if (section.type === 'movingProducts') {
                const mpConfig = section.data || storeConfig.homeSections?.movingProducts || {};
                const sourceType = mpConfig.source || mpConfig.sourceType || 'all';
                const selectedCat = mpConfig.category || mpConfig.selectedCategory || 'الكل';
                const selectedProductIds = mpConfig.productIds || mpConfig.selectedProductIds || [];

                let displayProducts = products;
                if (sourceType === 'most_demanded') {
                  // حساب المنتجات الأكثر طلباً من الطلبات المؤكدة فقط (استبعاد الملغية)
                  const demandMap = {};
                  orders.forEach(order => {
                    if (order.status === 'ملغي' || order.status === 'ملغى' || order.status === 'cancelled') return;
                    if (order.items && Array.isArray(order.items)) {
                      order.items.forEach(item => {
                        const pid = item.productId || item.id || item.title;
                        if (pid) {
                          demandMap[pid] = (demandMap[pid] || 0) + (parseInt(item.quantity) || 1);
                        }
                      });
                    } else if (order.productName || order.productTitle) {
                      const title = order.productName || order.productTitle;
                      demandMap[title] = (demandMap[title] || 0) + 1;
                    }
                  });
                  // فرز المنتجات حسب عدد مرات تأكيد الطلب
                  const sorted = [...products].sort((a, b) => {
                    const countA = demandMap[a.id] || demandMap[a.title] || 0;
                    const countB = demandMap[b.id] || demandMap[b.title] || 0;
                    return countB - countA;
                  });
                  displayProducts = sorted;
                } else if (sourceType === 'category' && selectedCat && selectedCat !== 'الكل') {
                  const filteredByCat = products.filter(p => p.category === selectedCat);
                  displayProducts = filteredByCat.length > 0 ? filteredByCat : products;
                } else if (sourceType === 'custom' && Array.isArray(selectedProductIds) && selectedProductIds.length > 0) {
                  const filteredByIds = products.filter(p => selectedProductIds.includes(p.id));
                  displayProducts = filteredByIds.length > 0 ? filteredByIds : products;
                }

                // استبعاد أي منتج نفذت كميته من شريط المنتجات المتحركة
                displayProducts = displayProducts.filter(p => !isProductOutOfStock(p));

                if (displayProducts.length === 0) return null;

                const movingTitle = mpConfig.title !== undefined && mpConfig.title !== '' ? mpConfig.title : (section.title || 'أحدث المنتجات');
                const movingSubtitle = mpConfig.subtitle !== undefined ? mpConfig.subtitle : '';
                const movingBadge = mpConfig.badgeText !== undefined ? mpConfig.badgeText : (sourceType === 'category' && selectedCat && selectedCat !== 'الكل' ? selectedCat : '');

                return (
                  <div key={section.id} className="space-y-3">
                    <div className="flex items-center justify-between pb-1 px-1">
                      {/* العنوان على اليمين: عنوان العنصر القابل للتغيير مع تنحيف وزنه */}
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm sm:text-base font-semibold text-gray-900 tracking-normal">
                          {movingTitle && movingTitle.trim() ? movingTitle : 'أحدث المنتجات'}
                        </h3>
                        {movingBadge && movingBadge.trim() && (
                          <span className="text-[10px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                            {movingBadge}
                          </span>
                        )}
                      </div>

                      {/* جهة اليسار: أزرار الأسهم الدائرية وزر "عرض الكل" لفتح صفحة مخصصة بكافة منتجات العنصر */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSectionForPage({
                              id: section.id,
                              title: movingTitle && movingTitle.trim() ? movingTitle : 'المنتجات',
                              subtitle: movingSubtitle,
                              badge: movingBadge,
                              products: displayProducts
                            });
                            setViewMode('section-view');
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="text-xs font-normal text-gray-600 hover:text-black hover:underline px-1 py-0.5 rounded cursor-pointer transition active:scale-95 flex items-center gap-1"
                          title="عرض كافة منتجات هذا العنصر في صفحة مستقلة"
                        >
                          <span>عرض الكل</span>
                          <i className="fa-solid fa-arrow-left text-[9px] text-gray-400"></i>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById(`carousel-${section.id}`);
                            if (el) el.scrollBy({ left: 240, behavior: 'smooth' });
                          }}
                          className="w-7 h-7 rounded-full border border-gray-200 bg-white hover:bg-gray-100 flex items-center justify-center text-gray-600 text-xs shadow-2xs transition active:scale-90 cursor-pointer"
                          title="السابق"
                        >
                          <i className="fa-solid fa-chevron-right text-[10px]"></i>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById(`carousel-${section.id}`);
                            if (el) el.scrollBy({ left: -240, behavior: 'smooth' });
                          }}
                          className="w-7 h-7 rounded-full border border-gray-200 bg-white hover:bg-gray-100 flex items-center justify-center text-gray-600 text-xs shadow-2xs transition active:scale-90 cursor-pointer"
                          title="التالي"
                        >
                          <i className="fa-solid fa-chevron-left text-[10px]"></i>
                        </button>
                      </div>
                    </div>

                    {/* سلايدر أفقي بنمط سلة مع بطاقات أنيقة مطابقة للصورة */}
                    <AutoMovingProductsCarousel
                      carouselId={`carousel-${section.id}`}
                      products={displayProducts}
                      wishlist={wishlist}
                      toggleWishlist={toggleWishlist}
                      activeCurrency={activeCurrency}
                      formatPrice={formatPrice}
                      calculateAverageRating={calculateAverageRating}
                      handleAddToCart={handleAddToCart}
                      setActiveProductForPage={setActiveProductForPage}
                      setViewMode={setViewMode}
                    />
                  </div>
                );
              }

              // 5. بانر عريض (Wide Promotional Banner بنمط منصة سلة)
              if (section.type === 'wideBanner') {
                const wb = section.data || storeConfig.homeSections?.wideBanner || {};
                const hasTextContent = Boolean((wb.title && wb.title.trim()) || (wb.subtitle && wb.subtitle.trim()) || (wb.buttonText && wb.buttonText.trim()));
                const handleWideBannerAction = () => {
                  const linkType = wb?.linkType || (wb?.linkProductId ? 'product' : wb?.linkCat ? 'category' : wb?.linkUrl ? 'url' : 'none');

                  if (linkType === 'product' && wb?.linkProductId) {
                    const targetProd = products.find(p => String(p.id) === String(wb.linkProductId));
                    if (targetProd) {
                      setActiveProductForPage(targetProd);
                      setViewMode('product-detail');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                      return;
                    }
                  } else if (linkType === 'category' && wb?.linkCat && wb.linkCat !== 'الكل') {
                    handleCategoryClick(wb.linkCat);
                    return;
                  } else if (wb?.linkUrl) {
                    if (wb.linkUrl.startsWith('http')) {
                      window.open(wb.linkUrl, '_blank');
                    } else {
                      window.location.href = wb.linkUrl;
                    }
                    return;
                  } else if (productsSectionRef.current) {
                    smoothScrollToElement(productsSectionRef.current, 700);
                  }
                };

                const rawRadius = wb.borderRadius !== undefined && wb.borderRadius !== null && wb.borderRadius !== ''
                  ? wb.borderRadius
                  : (storeConfig.homeSections?.wideBanner?.borderRadius ?? '2px');
                const wbRadius = typeof rawRadius === 'number' || !isNaN(rawRadius) ? `${rawRadius}px` : rawRadius;

                return (
                  <div 
                    key={section.id}
                    onClick={handleWideBannerAction}
                    style={{ borderRadius: wbRadius }}
                    className={`relative overflow-hidden cursor-pointer ${
                      hasTextContent
                        ? 'bg-gradient-to-r from-gray-900 to-gray-800 text-white p-6 sm:p-10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm border border-gray-100'
                        : wb.imageUrl ? 'p-0 block bg-transparent' : 'p-0 flex items-center justify-center bg-transparent min-h-[140px] sm:min-h-[220px]'
                    }`}
                  >
                    {/* صورة البانر: بكامل جودتها ووضوحها 100% بدون أي شفافية أو بهتان أو خلفية رمادية أو حدود */}
                    {wb.imageUrl ? (
                      <img
                        src={wb.imageUrl}
                        alt={wb.title || 'بانر إعلاني'}
                        className={
                          hasTextContent
                            ? "absolute inset-0 w-full h-full object-cover opacity-35 mix-blend-overlay"
                            : "w-full h-auto object-cover block"
                        }
                      />
                    ) : !hasTextContent ? (
                      <div className="w-full py-12 flex flex-col items-center justify-center text-gray-400 bg-gray-50 text-center px-4 rounded-xl border border-gray-100">
                        <i className="fa-solid fa-rectangle-ad text-3xl mb-2 text-gray-300"></i>
                        <span className="text-xs font-bold text-gray-500">بانر عريض بدون صورة</span>
                        <span className="text-[11px] text-gray-400">يمكنك رفع صورة من لوحة التحكم لتظهر هنا بجودتها الكاملة</span>
                      </div>
                    ) : null}

                    {hasTextContent && (
                      <>
                        <div className="relative z-10 text-right space-y-2 max-w-xl">
                          {wb.badgeText && (
                            <span className="inline-flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-full border border-amber-400/20">
                              <i className="fa-solid fa-fire text-amber-400 text-xs"></i>
                              <span>{wb.badgeText}</span>
                            </span>
                          )}
                          {wb.title && wb.title.trim() && (
                            <h3 className="text-base sm:text-2xl font-black leading-tight">
                              {wb.title}
                            </h3>
                          )}
                          {wb.subtitle && wb.subtitle.trim() && (
                            <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
                              {wb.subtitle}
                            </p>
                          )}
                        </div>
                        {wb.buttonText && wb.buttonText.trim() && (
                          <div className="relative z-10 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleWideBannerAction();
                              }}
                              className="px-5 sm:px-7 py-2.5 sm:py-3 rounded-xl bg-white text-gray-900 hover:bg-gray-100 text-xs sm:text-sm font-bold shadow-lg transition active:scale-95 cursor-pointer flex items-center gap-2"
                            >
                              <span>{wb.buttonText}</span>
                              <i className="fa-solid fa-arrow-left text-xs"></i>
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              }

              // 6. شبكة أحدث المنتجات الرئيسية
              if (section.type === 'productsGrid') {
                const pgData = section.data || storeConfig.homeSections?.productsGrid || {};
                const gridTitle = pgData.title && pgData.title.trim() 
                  ? pgData.title 
                  : (selectedCat === 'الكل' ? 'أحدث المنتجات' : selectedCat);
                // التأكد من أن نص الزر هو دائماً 'إضافة للسلة' ولا يتأثر بأي اسم قسم مثل 'قسم المبادلة'
                const rawBtn = pgData.buttonText ? pgData.buttonText.trim() : '';
                const buttonText = (rawBtn && !rawBtn.includes('قسم المبادلة') && !rawBtn.includes('المبادلة')) ? rawBtn : 'إضافة للسلة';

                return (
                  <div key={section.id} ref={productsSectionRef} className="rounded-2xl border border-gray-200/80 p-2.5 sm:p-6 bg-[#FCFCFC] shadow-2xs">
                    <div className="flex items-center justify-between mb-4 sm:mb-6 pb-2.5 sm:pb-3 border-b border-gray-200/60 px-1">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-4 bg-black rounded-full"></span>
                        <h3 className="text-sm sm:text-base font-semibold text-black tracking-normal">
                          {gridTitle}
                        </h3>
                      </div>
                      <span className="text-[10px] sm:text-xs font-normal text-gray-500 bg-gray-100 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full">{filteredProducts.length} منتج</span>
                    </div>

                    {filteredProducts.length === 0 ? (
                      <div className="text-center py-14 px-4 bg-white rounded-xl border border-dashed border-gray-200 space-y-2.5">
                        <div className="w-12 h-12 mx-auto rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400 text-xl">
                          <i className="fa-solid fa-box-open"></i>
                        </div>
                        <p className="text-xs sm:text-sm font-bold text-gray-700">لا توجد منتجات مضافة في المتجر حالياً</p>
                        <p className="text-[11px] text-gray-400">يمكنك البدء بإضافة منتجاتك وأقسامك عبر لوحة التحكم.</p>
                      </div>
                    ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
                      {filteredProducts.map((item) => {
                        const isInWishlist = wishlist.includes(item.id);
                        const hasDiscount = item.oldPrice && item.oldPrice > item.price;
                        const discountPercent = hasDiscount 
                          ? Math.round(((item.oldPrice - item.price) / item.oldPrice) * 100) 
                          : 0;
                        const avgRating = calculateAverageRating(item.reviews);

                        return (
                          <div
                            key={item.id}
                            className="s-product-card-entry bg-white border-0 shadow-none hover:shadow-none rounded-xl sm:rounded-2xl transition-all duration-300 flex flex-col justify-between cursor-pointer group overflow-hidden relative"
                            onClick={() => {
                              setActiveProductForPage(item);
                              setViewMode('product-detail');
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                          >
                            <div>
                              {/* 1. حاوية صورة المنتج ممتدة وبارزة طولياً لإبراز تفاصيل المنتج */}
                              <div className="relative pt-[112%] sm:pt-[108%] md:pt-[105%] bg-white overflow-hidden">
                                <img
                                  src={item.imageUrl}
                                  alt={item.title}
                                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                  loading="lazy"
                                />

                                {/* شارة الترويج والعروض المؤقتة ملتصقة تماماً بالحافة اليمنى وتنتهي باستدارة جهة اليسار فقط */}
                                <div className="absolute top-2 right-0 flex flex-col items-end gap-1 z-10 pointer-events-none">
                                  {item.flashSaleEnabled && item.flashSaleEndsAt && new Date(item.flashSaleEndsAt).getTime() > Date.now() && (
                                    <span className="bg-gradient-to-r from-red-600 to-rose-500 text-white text-[8px] sm:text-[9px] font-bold pr-1.5 pl-2.5 py-0.5 rounded-l-full rounded-r-none shadow-sm tracking-wide flex items-center gap-1 animate-pulse">
                                      <i className="fa-solid fa-bolt text-yellow-300 text-[8px]"></i>
                                      <span>عرض 🔥</span>
                                    </span>
                                  )}
                                  {item.badge && (
                                    <span className="bg-[#5C1420] text-white text-[8px] sm:text-[9px] font-bold pr-1.5 pl-2.5 py-0.5 rounded-l-full rounded-r-none shadow-sm tracking-wide flex items-center gap-1">
                                      <span>{item.badge}</span>
                                    </span>
                                  )}
                                </div>

                                {/* زر الإعجاب / المفضلة الدائري أعلى اليسار بنمط سلة */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleWishlist(item.id);
                                  }}
                                  title={isInWishlist ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
                                  aria-label="Add to wishlist"
                                  className={`absolute top-2 left-2 w-6 h-6 sm:w-7 sm:h-7 rounded-full border flex items-center justify-center transition-all duration-200 z-10 cursor-pointer shadow-2xs ${
                                    isInWishlist 
                                      ? 'bg-red-50 border-red-200 text-red-500 scale-110' 
                                      : 'bg-white/90 backdrop-blur-xs border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200'
                                  }`}
                                >
                                  <i className={`fa-heart text-[10px] sm:text-xs ${isInWishlist ? 'fa-solid text-red-500' : 'fa-regular'}`}></i>
                                </button>
                              </div>

                              {/* 2. محتوى البطاقة: العنوان مع مسافات مقلصة ومضبوطة */}
                              <div className="p-3 sm:p-3.5 pt-4 sm:pt-5 pb-1 sm:pb-1.5 text-right w-full" dir="rtl">
                                <h3
                                  className="s-product-card-title text-[13.5px] sm:text-[12.5px] md:text-[13px] font-normal text-gray-800 group-hover:text-primary transition-colors line-clamp-2 leading-snug text-right w-full"
                                  style={{ textAlign: 'right' }}
                                  title={item.title}
                                >
                                  {item.title}
                                </h3>
                              </div>
                            </div>

                            {/* 3. أسفل البطاقة: السعر وبمحاذاته التقييم مباشرة في نفس السطر */}
                            <div className="p-3 sm:p-3.5 pt-1.5 sm:pt-2 pb-4 sm:pb-5 text-right w-full" dir="rtl">
                              <div className="flex items-center justify-between gap-1.5 mb-2 text-right">
                                {/* السعر أو متطلبات المبادلة والسعر القديم */}
                                <div className="product-price-wrapper flex items-baseline gap-1 text-right justify-start">
                                  {item.productType === 'exchange' || (typeof item.exchangeCurrencyName === 'string' && item.exchangeCurrencyName.trim().length > 0) ? (
                                    <div className="flex items-center text-right">
                                      <span className="text-[11px] sm:text-xs font-semibold text-[#0f172a] tracking-tight">
                                        مبادلة
                                      </span>
                                    </div>
                                  ) : (
                                    <>
                                      <span 
                                        className={`text-[11px] sm:text-xs font-bold font-price tracking-tight text-right ${
                                          hasDiscount ? 'text-red-700' : 'text-black'
                                        }`}
                                      >
                                        {formatPrice(item.price, activeCurrency)}
                                      </span>
                                      {hasDiscount && (
                                        <span className="text-[8px] sm:text-[8.5px] text-gray-400 line-through font-medium font-price text-right">
                                          {formatPrice(item.oldPrice, activeCurrency)}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>

                                {/* التقييم بمحاذاة السعر في نفس السطر */}
                                {avgRating > 0 && (
                                  <div className="flex items-center gap-1 text-[10px] text-amber-500">
                                    <i className="fa-solid fa-star text-[9px]"></i>
                                    <span className="font-bold text-gray-700 text-[10px] font-mono leading-none">{avgRating}</span>
                                    <span className="text-[9px] text-gray-400 font-mono leading-none">({item.reviews.length})</span>
                                  </div>
                                )}
                              </div>

                              {/* زر إضافة للسلة بنمط منصة سلة (إطار خفيف أو تعبئة مع أيقونة حقيبة التسوق) */}
                              {item.productType === 'exchange' || (typeof item.exchangeCurrencyName === 'string' && item.exchangeCurrencyName.trim().length > 0) ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveProductForPage(item);
                                    setViewMode('product-detail');
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                  }}
                                  className="w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-md border border-[#1e293b] hover:border-[#0f172a] bg-white hover:bg-slate-50 active:scale-98 text-[#0f172a] font-bold text-[10px] sm:text-[11px] transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer shadow-2xs group/btn"
                                >
                                  <i className="fa-solid fa-right-left text-[#0f172a] text-[9px]"></i>
                                  <span>طلب المبادلة</span>
                                </button>
                              ) : isProductRequiringInput(item) ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveProductForPage(item);
                                    setViewMode('product-detail');
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                  }}
                                  className="w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-md border border-gray-200 hover:border-gray-900 bg-white hover:bg-gray-50 active:scale-98 text-gray-900 font-bold text-[10px] sm:text-[11px] transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer shadow-2xs group/btn"
                                >
                                  <i className="fa-solid fa-pen-to-square text-gray-700 group-hover/btn:text-black text-[9px]"></i>
                                  <span>تحديد البيانات</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddToCart(item, null, '', 1);
                                  }}
                                  className="btn-add-to-cart w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-[7px] border border-gray-900 active:scale-98 font-bold text-[10px] sm:text-[11px] flex items-center justify-center gap-1 cursor-pointer shadow-2xs group"
                                >
                                  <i className="fa-solid fa-bag-shopping text-[9px]"></i>
                                  <span>{buttonText || 'إضافة للسلة'}</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                );
              }

              // 7. مميزات المتجر السريعة في أسفل المتجر (Store Features)
              if (section.type === 'storeFeatures') {
                if (storeConfig.productFeatures?.enabled === false || storeConfig.productFeatures?.showInStoreFooter === false) return null;
                const sfData = section.data || storeConfig.homeSections?.storeFeatures || {};
                const activeFeatures = (sfData.items || storeConfig.productFeatures?.items || [
                  { id: 'feat-1', enabled: true, title: 'سرعة التنفيذ', subtitle: 'خدمة آلية سريعة', icon: 'fa-solid fa-bolt' },
                  { id: 'feat-2', enabled: true, title: 'ضمان كامل', subtitle: 'مباشر 100%', icon: 'fa-solid fa-shield-halved' },
                  { id: 'feat-3', enabled: true, title: 'دعم متواصل', subtitle: 'واتساب ومباشر', icon: 'fa-solid fa-comments' }
                ]).filter(f => f.enabled !== false);

                if (activeFeatures.length === 0) return null;

                return (
                  <div key={section.id} className="mt-6 sm:mt-12 pt-6 sm:pt-10 border-t border-gray-100/80">
                    {/* بطاقات المميزات: إجبار العرض في صف واحد دائماً */}
                    <div
                      className="grid grid-cols-3 gap-2 sm:gap-6 max-w-5xl mx-auto px-2 sm:px-4"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        width: '100%'
                      }}
                    >
                      {activeFeatures.map((feat, fIndex) => (
                        <div
                          key={feat.id || fIndex}
                          style={{ minWidth: 0, boxShadow: 'none' }}
                          className="relative overflow-hidden p-2 sm:p-5 rounded-full aspect-square bg-white shadow-none hover:shadow-none transition-all duration-300 flex flex-col items-center justify-center text-center group min-w-0 w-full max-w-[200px] mx-auto border-0 outline-none ring-0"
                        >
                          {/* أيقونة سوداء مع حركة ناعمة عند التمرير بدون أي خلفية أو ظل */}
                          <div 
                            className="rounded-full bg-transparent flex items-center justify-center mb-1.5 sm:mb-2.5 transition-all duration-500 ease-out shrink-0 w-8 h-8 sm:w-12 sm:h-12 group-hover:-translate-y-1 shadow-none"
                            style={{ boxShadow: 'none' }}
                          >
                            {feat.customIconUrl ? (
                              <img src={feat.customIconUrl} alt="" className="object-contain brightness-0 w-3.5 h-3.5 sm:w-5 sm:h-5 transition-transform duration-500 ease-out group-hover:scale-110 group-hover:-rotate-3" />
                            ) : (
                              <i className={`${feat.icon || 'fa-solid fa-bolt'} text-black text-xs sm:text-lg transition-transform duration-500 ease-out group-hover:scale-110 group-hover:-rotate-3`}></i>
                            )}
                          </div>

                          {/* نصوص الميزة */}
                          <h4 className="font-bold text-gray-900 text-[10px] sm:text-[13px] tracking-tight truncate w-full group-hover:text-black transition-colors mb-0.5 text-center px-1">
                            {feat.title}
                          </h4>
                          <p className="text-[8.5px] sm:text-[11px] text-gray-400 font-medium leading-tight line-clamp-1 w-full text-center px-1">
                            {feat.subtitle}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }

              // 8. تقييمات وآراء العملاء في أسفل المتجر (Customer Reviews)
              if (section.type === 'customerReviews') {
                if (storeConfig.productFeatures?.showStoreReviews === false) return null;
                // جمع التقييمات الحقيقية فقط المضافة من العملاء في المنتجات
                const allCustomerReviews = products.flatMap(p => 
                  (p.reviews || []).map(r => ({ ...r, productTitle: p.title, productImg: p.imageUrl }))
                );

                // إذا لم توجد أي تقييمات حقيقية من العملاء، لا يظهر القسم
                if (allCustomerReviews.length === 0) return null;

                const reviewsToDisplay = allCustomerReviews.slice(0, 10);
                const crData = section.data || storeConfig.homeSections?.customerReviews || {};
                return (
                  <div key={section.id}>
                    <SallaReviewsWidget 
                      reviews={reviewsToDisplay} 
                      title={crData.title || storeConfig.homeSections?.customerReviews?.title}
                      subtitle={crData.subtitle || storeConfig.homeSections?.customerReviews?.subtitle}
                    />
                  </div>
                );
              }

              return null;
            }))}
          </main>
        </div>
      )}

      {/* ========================================================= */}
      {/* 3. صفحة مخصصة للقسم تعرض منتجاته فقط بنمط منصة سلة          */}
      {/* ========================================================= */}
      {viewMode === 'category' && (() => {
        const cleanSelected = (selectedCat || '').trim();
        const currentCatObj = categories.find(c => {
          const cName = (c.name || '').trim();
          return cName === cleanSelected || c.id === cleanSelected;
        }) || { name: selectedCat };

        const categoryProducts = products.filter(p => {
          // إخفاء أي منتج نفذت كميته من صفحة القسم
          if (isProductOutOfStock(p)) return false;

          const pCat = (p.category || '').trim();
          const curCat = cleanSelected;

          let matchesCat = false;
          if (curCat === 'الكل' || curCat === '' || !curCat) {
            matchesCat = true;
          } else {
            const currentCat = categories.find(c => (c.name || '').trim() === curCat || c.id === curCat);
            if (currentCat) {
              const childCatNames = categories.filter(c => c.parentId === currentCat.id).map(c => (c.name || '').trim());
              const validNames = [(currentCat.name || '').trim(), ...childCatNames];
              matchesCat = validNames.some(vn => vn === pCat || (vn && pCat && (pCat.includes(vn) || vn.includes(pCat))));
            } else {
              matchesCat = pCat === curCat || (pCat && curCat && (pCat.includes(curCat) || curCat.includes(pCat)));
            }
          }
          if (!matchesCat) return false;
          if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            return (p.title || '').toLowerCase().includes(q) || pCat.toLowerCase().includes(q);
          }
          return true;
        });

        return (
          <div key={`category-page-${selectedCat}`} className="min-h-[70vh] bg-[#FCFCFC] pb-16 animate-page-view" dir="rtl">
            {/* محتوى صفحة القسم: المنتجات فقط */}
            <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 font-normal">
              {categoryProducts.length === 0 ? (
                <div className="text-center py-20 px-4 bg-white rounded-2xl border border-dashed border-gray-300 shadow-2xs space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400 text-2xl">
                    <i className="fa-solid fa-box-open"></i>
                  </div>
                  <h3 className="text-sm font-bold text-gray-800">لا توجد منتجات في قسم "{selectedCat}" حالياً</h3>
                  <p className="text-xs text-gray-500 max-w-sm mx-auto">
                    يمكنك تصفح باقي الأقسام أو العودة للصفحة الرئيسية للمتجر.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('store');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="mt-2 px-4 py-2 bg-[#004956] text-white text-xs font-bold rounded-xl hover:bg-[#00343D] transition shadow-xs cursor-pointer"
                  >
                    العودة للرئيسية
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
                  {categoryProducts.map((item) => {
                    const isInWishlist = wishlist.includes(item.id);
                    const hasDiscount = item.oldPrice && item.oldPrice > item.price;
                    const avgRating = calculateAverageRating(item.reviews);

                    return (
                      <div
                        key={item.id}
                        className="s-product-card-entry bg-white border-0 shadow-none hover:shadow-none rounded-xl sm:rounded-2xl transition-all duration-300 flex flex-col justify-between cursor-pointer group overflow-hidden relative"
                        onClick={() => {
                          setActiveProductForPage(item);
                          setViewMode('product-detail');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        <div>
                          {/* 1. حاوية صورة المنتج ممتدة وبارزة طولياً لإبراز تفاصيل المنتج */}
                          <div className="relative pt-[112%] sm:pt-[108%] md:pt-[105%] bg-white overflow-hidden">
                            <img
                              src={item.imageUrl}
                              alt={item.title}
                              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                              loading="lazy"
                            />

                            {/* شارة الترويج والعروض المؤقتة ملتصقة تماماً بالحافة اليمنى */}
                            <div className="absolute top-2.5 right-0 flex flex-col items-end gap-1.5 z-10 pointer-events-none">
                              {item.flashSaleEnabled && item.flashSaleEndsAt && new Date(item.flashSaleEndsAt).getTime() > Date.now() && (
                                <span className="bg-gradient-to-r from-red-600 to-rose-500 text-white text-[8.5px] sm:text-[9.5px] font-bold pr-2 pl-3 py-0.5 rounded-l-full rounded-r-none shadow-sm tracking-wide flex items-center gap-1 animate-pulse">
                                  <i className="fa-solid fa-bolt text-yellow-300 text-[9px]"></i>
                                  <span>عرض مؤقت 🔥</span>
                                </span>
                              )}
                              {item.badge && (
                                <span className="bg-[#5C1420] text-white text-[8.5px] sm:text-[9.5px] font-bold pr-2 pl-3 py-0.5 rounded-l-full rounded-r-none shadow-sm tracking-wide flex items-center gap-1">
                                  <span>{item.badge}</span>
                                </span>
                              )}
                            </div>

                            {/* زر الإعجاب / المفضلة الدائري أعلى اليسار */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleWishlist(item.id);
                              }}
                              title={isInWishlist ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
                              aria-label="Add to wishlist"
                              className={`absolute top-2.5 left-2.5 w-7 h-7 sm:w-8 sm:h-8 rounded-full border flex items-center justify-center transition-all duration-200 z-10 cursor-pointer shadow-2xs ${
                                isInWishlist 
                                  ? 'bg-red-50 border-red-200 text-red-500 scale-110' 
                                  : 'bg-white/90 backdrop-blur-xs border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200'
                              }`}
                            >
                              <i className={`fa-heart text-xs sm:text-sm ${isInWishlist ? 'fa-solid text-red-500' : 'fa-regular'}`}></i>
                            </button>
                          </div>

                          {/* 2. محتوى البطاقة: العنوان */}
                          <div className="p-3 sm:p-3.5 pt-4 sm:pt-5 pb-1 sm:pb-1.5 text-right w-full" dir="rtl">
                            <h3
                              className="s-product-card-title text-[13.5px] sm:text-[12.5px] md:text-[13px] font-normal text-gray-800 group-hover:text-primary transition-colors line-clamp-2 leading-snug text-right w-full"
                              style={{ textAlign: 'right' }}
                              title={item.title}
                            >
                              {item.title}
                            </h3>
                          </div>
                        </div>

                        {/* 3. أسفل البطاقة: السعر وبمحاذاته التقييم مباشرة */}
                        <div className="p-3 sm:p-4 pt-1.5 sm:pt-2 pb-4 sm:pb-5 text-right w-full" dir="rtl">
                          <div className="flex items-center justify-between gap-2 mb-2.5 text-right">
                            {/* السعر والسعر القديم أو متطلبات المبادلة */}
                            <div className="product-price-wrapper flex items-baseline gap-1 text-right justify-start">
                              {item.productType === 'exchange' || (typeof item.exchangeCurrencyName === 'string' && item.exchangeCurrencyName.trim().length > 0) ? (
                                <div className="flex items-center text-right">
                                  <span className="text-[11px] sm:text-xs font-semibold text-[#0f172a] tracking-tight">
                                    مبادلة
                                  </span>
                                </div>
                              ) : (
                                <>
                                  <span 
                                    className={`text-[11px] sm:text-xs font-bold font-price tracking-tight text-right ${
                                      hasDiscount ? 'text-red-700' : 'text-black'
                                    }`}
                                  >
                                    {formatPrice(item.price, activeCurrency)}
                                  </span>
                                  {hasDiscount && (
                                    <span className="text-[8px] sm:text-[8.5px] text-gray-400 line-through font-medium font-price text-right">
                                      {formatPrice(item.oldPrice, activeCurrency)}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>

                            {/* التقييم بمحاذاة السعر في نفس السطر */}
                            {avgRating > 0 && (
                              <div className="flex items-center gap-1 text-[10px] text-amber-500">
                                <i className="fa-solid fa-star text-[9px]"></i>
                                <span className="font-bold text-gray-700 text-[10px] font-mono leading-none">{avgRating}</span>
                                <span className="text-[9px] text-gray-400 font-mono leading-none">({item.reviews.length})</span>
                              </div>
                            )}
                          </div>

                          {/* زر إضافة للسلة بنمط منصة سلة */}
                          {item.productType === 'exchange' || (typeof item.exchangeCurrencyName === 'string' && item.exchangeCurrencyName.trim().length > 0) ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveProductForPage(item);
                                setViewMode('product-detail');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-md border border-[#1e293b] hover:border-[#0f172a] bg-white hover:bg-slate-50 active:scale-98 text-[#0f172a] font-bold text-[10px] sm:text-[11px] transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer shadow-2xs group/btn"
                            >
                              <i className="fa-solid fa-right-left text-[#0f172a] text-[9px]"></i>
                              <span>طلب المبادلة</span>
                            </button>
                          ) : isProductRequiringInput(item) ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveProductForPage(item);
                                setViewMode('product-detail');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-md border border-gray-200 hover:border-gray-900 bg-white hover:bg-gray-50 active:scale-98 text-gray-900 font-bold text-[10px] sm:text-[11px] transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer shadow-2xs group/btn"
                            >
                              <i className="fa-solid fa-pen-to-square text-gray-700 group-hover/btn:text-black text-[9px]"></i>
                              <span>تحديد البيانات</span>
                            </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAddToCart(item, null, '', 1);
                                  }}
                                  className="btn-add-to-cart w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-[7px] border border-gray-900 active:scale-98 font-bold text-[10px] sm:text-[11px] flex items-center justify-center gap-1 cursor-pointer shadow-2xs group"
                                >
                                  <i className="fa-solid fa-bag-shopping text-[9px]"></i>
                                  <span>إضافة للسلة</span>
                                </button>
                              )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </main>
          </div>
        );
      })()}

      {/* ========================================================= */}
      {/* 3.1 صفحة مخصصة ومستقلة بالكامل لعرض منتجات العنصر (Section View Page) */}
      {/* ========================================================= */}
      {viewMode === 'section-view' && activeSectionForPage && (() => {
        const rawSectionProducts = Array.isArray(activeSectionForPage.products) ? activeSectionForPage.products : [];
        const sectionProducts = rawSectionProducts
          .map(sp => products.find(p => p.id === sp.id) || sp)
          .filter(p => !isProductOutOfStock(p))
          .filter(p => {
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase().trim();
            return p.title.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q));
          });

        return (
          <div key={`section-page-${activeSectionForPage.id}`} className="min-h-[70vh] bg-[#FCFCFC] pb-16 animate-page-view" dir="rtl">
            <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 font-normal">
              {/* شريط التنقل والترويسة */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-gray-200/80 bg-white p-4 rounded-2xl border shadow-2xs">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleNavigateToStore}
                    className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center text-xs transition cursor-pointer active:scale-95"
                    title="الرجوع للمتجر"
                  >
                    <i className="fa-solid fa-arrow-right"></i>
                  </button>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-4 bg-[#004956] rounded-full"></span>
                      <h2 className="text-sm sm:text-base font-semibold text-gray-900">
                        {activeSectionForPage.title}
                      </h2>
                      {activeSectionForPage.badge && (
                        <span className="text-[10px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                          {activeSectionForPage.badge}
                        </span>
                      )}
                    </div>
                    {activeSectionForPage.subtitle ? (
                      <p className="text-xs text-gray-400 mt-0.5 mr-3.5">
                        {activeSectionForPage.subtitle}
                      </p>
                    ) : (
                      <p className="text-[11px] text-gray-400 mt-0.5 mr-3.5">
                        كافة المنتجات المندرجة تحت هذا العنصر
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 mr-auto sm:mr-0">
                  <span className="text-xs font-medium text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                    {sectionProducts.length} منتج
                  </span>
                  <button
                    type="button"
                    onClick={handleNavigateToStore}
                    className="text-xs font-medium text-[#004956] hover:underline cursor-pointer"
                  >
                    الرئيسية
                  </button>
                </div>
              </div>

              {sectionProducts.length === 0 ? (
                <div className="text-center py-20 px-4 bg-white rounded-2xl border border-dashed border-gray-300 shadow-2xs space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400 text-2xl">
                    <i className="fa-solid fa-box-open"></i>
                  </div>
                  <h3 className="text-sm font-bold text-gray-800">لا توجد منتجات متوفرة في هذا العنصر حالياً</h3>
                  <p className="text-xs text-gray-500 max-w-sm mx-auto">
                    يمكنك العودة للصفحة الرئيسية وتصفح باقي عروض وأقسام المتجر.
                  </p>
                  <button
                    type="button"
                    onClick={handleNavigateToStore}
                    className="mt-2 px-4 py-2 bg-[#004956] text-white text-xs font-bold rounded-xl hover:bg-[#00343D] transition shadow-xs cursor-pointer"
                  >
                    العودة للمتجر
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
                  {sectionProducts.map((item) => {
                    const isInWishlist = wishlist.includes(item.id);
                    const hasDiscount = item.oldPrice && item.oldPrice > item.price;
                    const avgRating = calculateAverageRating(item.reviews);

                    return (
                      <div
                        key={item.id}
                        className="s-product-card-entry bg-white border-0 shadow-none hover:shadow-none rounded-xl sm:rounded-2xl transition-all duration-300 flex flex-col justify-between cursor-pointer group overflow-hidden relative"
                        onClick={() => {
                          setActiveProductForPage(item);
                          setViewMode('product-detail');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                      >
                        <div>
                          {/* 1. حاوية صورة المنتج ممتدة وبارزة طولياً لإبراز تفاصيل المنتج */}
                          <div className="relative pt-[112%] sm:pt-[108%] md:pt-[105%] bg-white overflow-hidden">
                            <img
                              src={item.imageUrl}
                              alt={item.title}
                              className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                              loading="lazy"
                            />

                            {/* شارة الترويج والعروض المؤقتة ملتصقة تماماً بالحافة اليمنى */}
                            <div className="absolute top-2.5 right-0 flex flex-col items-end gap-1.5 z-10 pointer-events-none">
                              {item.flashSaleEnabled && item.flashSaleEndsAt && new Date(item.flashSaleEndsAt).getTime() > Date.now() && (
                                <span className="bg-gradient-to-r from-red-600 to-rose-500 text-white text-[8.5px] sm:text-[9.5px] font-bold pr-2 pl-3 py-0.5 rounded-l-full rounded-r-none shadow-sm tracking-wide flex items-center gap-1 animate-pulse">
                                  <i className="fa-solid fa-bolt text-yellow-300 text-[9px]"></i>
                                  <span>عرض مؤقت 🔥</span>
                                </span>
                              )}
                              {item.badge && (
                                <span className="bg-[#5C1420] text-white text-[8.5px] sm:text-[9.5px] font-bold pr-2 pl-3 py-0.5 rounded-l-full rounded-r-none shadow-sm tracking-wide flex items-center gap-1">
                                  <span>{item.badge}</span>
                                </span>
                              )}
                            </div>

                            {/* زر الإعجاب / المفضلة الدائري أعلى اليسار */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleWishlist(item.id);
                              }}
                              title={isInWishlist ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
                              aria-label="Add to wishlist"
                              className={`absolute top-2.5 left-2.5 w-7 h-7 sm:w-8 sm:h-8 rounded-full border flex items-center justify-center transition-all duration-200 z-10 cursor-pointer shadow-2xs ${
                                isInWishlist 
                                  ? 'bg-red-50 border-red-200 text-red-500 scale-110' 
                                  : 'bg-white/90 backdrop-blur-xs border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200'
                              }`}
                            >
                              <i className={`fa-heart text-xs sm:text-sm ${isInWishlist ? 'fa-solid text-red-500' : 'fa-regular'}`}></i>
                            </button>
                          </div>

                          {/* 2. محتوى البطاقة: العنوان */}
                          <div className="p-3 sm:p-3.5 pt-4 sm:pt-5 pb-1 sm:pb-1.5 text-right w-full" dir="rtl">
                            <h3
                              className="s-product-card-title text-[13.5px] sm:text-[12.5px] md:text-[13px] font-normal text-gray-800 group-hover:text-primary transition-colors line-clamp-2 leading-snug text-right w-full"
                              style={{ textAlign: 'right' }}
                              title={item.title}
                            >
                              {item.title}
                            </h3>
                          </div>
                        </div>

                        {/* 3. أسفل البطاقة: السعر وبمحاذاته التقييم مباشرة */}
                        <div className="p-3 sm:p-4 pt-1.5 sm:pt-2 pb-4 sm:pb-5 text-right w-full" dir="rtl">
                          <div className="flex items-center justify-between gap-2 mb-2.5 text-right">
                            <div className="product-price-wrapper flex items-baseline gap-1 text-right justify-start">
                              {item.productType === 'exchange' || (typeof item.exchangeCurrencyName === 'string' && item.exchangeCurrencyName.trim().length > 0) ? (
                                <div className="flex items-center text-right">
                                  <span className="text-[11px] sm:text-xs font-semibold text-[#0f172a] tracking-tight">
                                    مبادلة
                                  </span>
                                </div>
                              ) : (
                                <>
                                  <span 
                                    className={`text-[11px] sm:text-xs font-bold font-price tracking-tight text-right ${
                                      hasDiscount ? 'text-red-700' : 'text-black'
                                    }`}
                                  >
                                    {formatPrice(item.price, activeCurrency)}
                                  </span>
                                  {hasDiscount && (
                                    <span className="text-[8px] sm:text-[8.5px] text-gray-400 line-through font-medium font-price text-right">
                                      {formatPrice(item.oldPrice, activeCurrency)}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>

                            {avgRating > 0 && (
                              <div className="flex items-center gap-1 text-[10px] text-amber-500">
                                <i className="fa-solid fa-star text-[9px]"></i>
                                <span className="font-bold text-gray-700 text-[10px] font-mono leading-none">{avgRating}</span>
                                <span className="text-[9px] text-gray-400 font-mono leading-none">({item.reviews.length})</span>
                              </div>
                            )}
                          </div>

                          {/* زر إضافة للسلة بنمط منصة سلة */}
                          {item.productType === 'exchange' || (typeof item.exchangeCurrencyName === 'string' && item.exchangeCurrencyName.trim().length > 0) ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveProductForPage(item);
                                setViewMode('product-detail');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-md border border-[#1e293b] hover:border-[#0f172a] bg-white hover:bg-slate-50 active:scale-98 text-[#0f172a] font-bold text-[10px] sm:text-[11px] transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer shadow-2xs group/btn"
                            >
                              <i className="fa-solid fa-right-left text-[#0f172a] text-[9px]"></i>
                              <span>طلب المبادلة</span>
                            </button>
                          ) : isProductRequiringInput(item) ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveProductForPage(item);
                                setViewMode('product-detail');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-md border border-gray-200 hover:border-gray-900 bg-white hover:bg-gray-50 active:scale-98 text-gray-900 font-bold text-[10px] sm:text-[11px] transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer shadow-2xs group/btn"
                            >
                              <i className="fa-solid fa-pen-to-square text-gray-700 group-hover/btn:text-black text-[9px]"></i>
                              <span>تحديد البيانات</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddToCart(item, null, '', 1);
                              }}
                              className="btn-add-to-cart w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-[7px] border border-gray-900 active:scale-98 font-bold text-[10px] sm:text-[11px] flex items-center justify-center gap-1 cursor-pointer shadow-2xs group"
                            >
                              <i className="fa-solid fa-bag-shopping text-[9px]"></i>
                              <span>إضافة للسلة</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </main>
          </div>
        );
      })()}

      {/* ========================================================= */}
      {/* 4. صفحة تفاصيل المنتج المستقلة بالكامل بنمط منصة سلة (Salla Style) */}
      {/* ========================================================= */}
      {viewMode === 'product-detail' && activeProductForPage && (() => {
        // العثور دائماً على أحدث نسخة من المنتج من مصفوفة المنتجات المركزية لضمان ظهور التعديل فوراً
        const latestProduct = products.find(p => p.id === activeProductForPage.id) || activeProductForPage;
        return (
          <ProductDetailPage
            product={latestProduct}
            onBack={handleNavigateToStore}
            storeConfig={storeConfig}
            formatPrice={formatPrice}
            activeCurrency={activeCurrency}
            onAddToCart={handleAddToCart}
            relatedProducts={products.filter(p => !isProductOutOfStock(p))}
            onSelectProduct={(p) => setActiveProductForPage(p)}
            onSelectCategory={(catName) => {
              setSelectedCat(catName);
              if (catName === 'الكل') {
                handleNavigateToStore();
              } else {
                setViewMode('category');
              }
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        );
      })()}

      {/* ========================================================= */}
      {/* 5. عرض محتوى الصفحة التعريفية المخصصة (Custom Page View) */}
      {/* ========================================================= */}
      {viewMode === 'custom-page' && activeCustomPage && (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 animate-in fade-in zoom-in-95 duration-150 font-normal" dir="rtl">
          {/* زر الرجوع للمتجر */}
          <button
            type="button"
            onClick={handleNavigateToStore}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-gray-100 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 shadow-2xs mb-6 cursor-pointer transition active:scale-95"
          >
            <i className="fa-solid fa-arrow-right text-xs"></i>
            <span>العودة إلى المتجر</span>
          </button>

          {/* محتوى الصفحة بتصميم نظيف وراقي */}
          <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-6 sm:p-10 space-y-6">
            <div className="border-b border-gray-100 pb-5">
              <span className="text-[11px] font-bold text-[#004956] bg-teal-50 border border-teal-200/60 px-2.5 py-1 rounded-lg inline-block mb-2">
                صفحة تعريفية
              </span>
              <h1 className="text-xl sm:text-2xl font-black text-gray-900 leading-tight">
                {activeCustomPage.title}
              </h1>
            </div>

            <div className="text-gray-700 text-sm sm:text-base leading-relaxed whitespace-pre-line">
              {activeCustomPage.content || 'لا يوجد محتوى مكتوب في هذه الصفحة حالياً.'}
            </div>

            <div className="pt-6 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
              <span>{storeConfig.name || 'المتجر'}</span>
              <button
                type="button"
                onClick={handleNavigateToStore}
                className="text-[#004956] font-bold hover:underline cursor-pointer"
              >
                تصفح المنتجات ←
              </button>
            </div>
          </div>
        </div>
      )}

      {/* الفوتر الأسود الاحترافي */}
      <footer className="bg-black text-white border-t border-neutral-800 mt-16 py-6 sm:py-7" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-4">
          {/* روابط الصفحات التعريفية في الفوتر */}
          {Array.isArray(storeConfig.customPages) && storeConfig.customPages.filter(p => p.showInFooter !== false).length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-b border-neutral-800/80 pb-4 text-xs font-medium text-gray-300">
              {storeConfig.customPages.filter(p => p.showInFooter !== false).map((page) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => {
                    setActiveCustomPage(page);
                    setViewMode('custom-page');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="hover:text-white transition hover:underline cursor-pointer py-1"
                  title={page.title}
                >
                  {page.title}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            {/* يمين الفوتر (في RTL): نص الحقوق المباشر والمتزامن */}
            <p className="text-xs sm:text-sm text-gray-400 order-2 sm:order-1 text-center sm:text-right">
              {storeConfig.footerCopyright || 'جميع الحقوق محفوظة للمتجر © 2026'}
            </p>

          {/* يسار الفوتر (في RTL): أيقونات وسائل الدفع الحقيقية مفرغة بدون خلفيات بيضاء وبأحجام متناسقة ومتساوية */}
          <div className="flex items-center flex-wrap justify-center gap-1 sm:gap-1.5 order-1 sm:order-2">
            {/* زين كاش - ZainCash مفرغة من الملف الأصلي */}
            <div
              className="w-8 h-6 sm:w-9 sm:h-6 flex items-center justify-center opacity-90 hover:opacity-100 transition hover:scale-105 px-0.5"
              title="زين كاش - ZainCash"
            >
              <img
                src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANIAAAA8CAYAAAAT1+SwAAAbmElEQVR42u1dabgcVZl+v+q+SyAJoIAQNgVFAwhqVEQehIgIKILssmdExcGFRRZFx0Fc2JSAMjo4uCHLsLgwLiCRBFDCKiJEAiGyCGFTEAhJ7tJd7/yo98CXY1V19b19703wnuepp/veruXUOefb3+87hvE23kapkTQAEwCkAAjAdDTNbGB8hMbbeKtGREW/da/s72cr0kCbGceX3MuTiMLckjwEwD4AVgPwFIArzOyy8TXQgUEm2U1yAslekl3u6Nb/uss42nhb4ee3TrJG8lLmt7N1Xi/J+vioVR/cJAzuEK9Lxkdx5ZlrfV4goukn2XBHv/5/qs7rGVftWg9qXYYl3f9WA7ARgLcCaAJIZIjCGaNPAJhrZs9GOnfNzBrjy3XFJSIzS0m+BcAfAAwCqEfrjjoGAWwK4FEAMLN0ZXrX+igMZg1ATQTUkIjfCsAHAGwJYDqAVQG0MjifJTkHwN8B/NDM5gJoRPdvji/fFZJRv1LEkuQw78AsewBMFOGNaxwxEQVRLRtoBsnbSKaRjpyS7CO5LOfoIzmYo1ffpvtNCCpBu6rieBsVJgqS79WcNVjcUpJv8OrgeHtJjQvfP0Jyfg7h9LO9NqjrPCHOJ/mRWCcfbyuUfbQFyaWavzRnXpv63HRlnUMboQHsNbM+kq8GcA6A3fVTE1kwrsud3gRwk3Tk2dKR6wAaANYHsJO+bw7gVe66QakKQQqdC+AUqX49APrHXakrjuub5I0A3gmg36nx1Nx2A/gZMrd49/jcZQPXpc8DSD7tRLoX630kf0RyP5JTK953PZJb67qB6L5B9buX5HrjkmmFdH9vSPKeAk3jepKrK8zRMz5oyxNR6tSxhvv+A5Kbt7jPmjrWKfh9C93HqwaBmO4hOUWu8nGbqQWqYJSe3+3m9Ysk/yomu4DkMSRXVdywN6yhf1nVzqlzBwK4KMJTJQD+CmAfM7stEJ2ZDZKcCODNAN4h9W1tqQDh2msBPA/gNgC/NbMF7pl7Afi2VL6mrqkDmAdgq6D2mdngv7jBn+gocykTQDpSbufgCtf3VTVPfWbWPxRUQ8wcRloV9M8bsWc578whTkI0nVT6Ecm1A8E57nQKyYVtOBueJ/lLkq+LpNNjOZLpnICaaCPQOxZHrdOSU+9d0/2tjWB3zfXJRtGza20G5WsF96mNUp//CRRgnRgIM2uSfBuAWyUZTNwvBfBVMztFBEQz6yd5LIATnPMgL1AXt0HnpFgs58LnZchuDmAWgHVcgK8GYGczuyb0cWXwcA1HIuQFqaUqrQZgewCTnKSHi+3cC2ABgCVm1hcxSHZCSmn+e/Tshpm94NfPEKTaZL9ezOy5+JwOz88kjZWXoi/23TpgE4V73A7gjZFnbqaZHUtykpktJrkGgMsAvEfXDDgPzlIR4s2a2C7dZ3cAO2gxQF6e4FqfCeBEqYh7AviJI2QDcIOZTS8aXC2UFMDHpVqmGqwRpxv1rx/AlQCeNbMbHUSm0Q7hi4C6QlCa5CuQBbp3A/A2AOsBWL3kFg0ALwBYJBX6FwCuN7OnHREMyZNGsq5A/GcBfFbP6gNwNYCvmNlDwSyoiJLYAMAxAA52jJUA5gD4iZldrDFsdhL1QvJ2AK8F8CSA3wD4bzO7R2PTGO7NQ7D1VOdFCzGBy+SFmaRzppN82J0XVLCHSR5N8jUlz1mf5AkklzgVLsSgDnfn/ThycKQkd/HqZ0H/v8Gxb7NIbt9uWoFUHQtwK5LHunFmjkMm78hrj0sl39Kpi8lQ44lS4xnFkZ4heUDR/OTEo96ofpW1s1yAvpM+gAei5/STPNObK8PRwxOS67ogaVi8j8qdmQjRMNl1ZMB58WZJSr3o3XEo8B4dE9xCeTPJRe5ZTdlNG6s/mynw13Qu8suCC7ZA3QDJD2tBLStZbCN1eOazjOS7q7rv/eIjeTzJh9xEB2bVLAiCxqiC1BFbI1owx+UQhrVJSP+pZ/Trc8A9e88SZmc6VpW3L6yhNDoG3T3PiplMBwjpPvccH1j+WkeQC87B4GNF++m3AN/5dY4r/ES96IuI7qKXDgSp7/vmSLX/coN+o3sWSf6N5Fq6R1fsltU120YEPhYt9HcJyTcWLVbnSAhMYHPFYTwBpR3oTxpJq+uEkURId6hI7GGdnOyIIH7nv8j9XYsZnnOdn5BzfV4Lv8/UWHUEOiZXvUdheAm/cyc8df/nOA1J3h4kin7fKYeIZgcbq8pLakBCnMGcChc40yKSa+i349zzAufYK8+Dp3v26PNOx4HHqoVF8N0YZhV5jFbR982cqjPQIQLKI6gBp+5t5/pRGyYheYY4vYDZhXV0g9NEqo7jh4etehUTkscOXpkMJYAnn3+T5PoAto08gN8IhqM41hciL2GfjPvwdxUEuikWFFIwzneOgRTAugDept+udvGk8Iy3FxjKDQdT+SSyjM1u91unj7RCXI/I6hoUtZqZLVVqwmx5KhsyvK3EudHM6c+g6xdL+tSl89YBMJvkITLkrUOOlzqATeUQqkW20SDJDQFs4WKSqJDV0ABwNsltFN8cCdd4SPnZOsnxxdcreGfCda8D8ApNUg3AEgB/1gAMAHi9vGF0111hZgvkOhwIrsSyzEp5a9YGkOjeNwJ4UM9MnZcOkRs9fG6Hl3B9ywXxVHQjMbPfA3iTPH+p7tPpI6kYJB8s8Vz1S/W72gWii5hR6ryYtZz+dLl+mQtqFy3OsNAv0AJtdHCB9jkG5ucoBTARwBpthGzCepgE4FskV9faqXcYghSe86p6JIUs+8rVvL+8pL3FxW0SZAl4dwPoERfYJrhl3TV3uGe148P/nGJPpglsOo4Gucl/oz48AmAD91tfC3HXlA32hJntIzj/ByUZ2KHBXgxgfwDTWrjZcyWSc7hsqJjZWo6B5TX/22IAcwHcEo0ZJIF3B/BqZHlhKLlv4uKDVyh2+ESHYjdl6yGN4l9VWk0MaRqAc8zsMKl4I1GtKDc/PkGWcPeHCi/9dsfJujTBXmJtHEkKAJitIGqVOElNHPggANsoXtRNMs0Z1NVEFE+QnCdCajpO2qo1AfSQTM3sXgCndTigtwuAE50ELYsv/SJnwdfEQI6TJBqMUPSxGlcH8BcAZwK41swWlnTvJJIbA/g0gMMlAcqIqQlgihbovqOEKLAW6mHeOUElPURr4usBXd7pvuVxxW7pq0sruA6XRS/yeKQW7pLzgssiYqsyeMdK5UKkxsX9hgJ20xxXAoA1ZaBbiVQaMLM+MxsYJmSoWw6MiVKVu0heDuAqZJmiSUE/AjO6VUFFC0HZEGAkuQOAI6KgdN6Y1QH8D4DtzOw8M1tY9k56/wfM7GhkuMfZIeu4hNs3AOxD8kOS6F1jjBm1FlngZwDYWoy5NhLGkjfoG8qbf2e0EKtyiVp037keEKnvUyvqul1SD2fIFnvYiflVBDdBhKyAFuvaUT+COlIprmBmqZk1hnIEO0IQmE0B/Fx5NmkLZEECYD6AvTxiRP0N135JDCNv4QRJNADg62b2MQBPBrxd2Tt5vKGZLTSzHQF80xFMmaF9jpAU6RiizF+Q+soCVTyMzU9ITpH5kowUIYXv7wXwxxzVosp9dtRgBmP5d24RhM9DAtEFwKI7XowpSTJ8CMD3ADwLYI4WWAMZ/GVDVywFyKAtwR5i1P9/yJNYGwW8XPCqvVOwlfc5QilSKYOD5EgzWyTnRxivRB7LnQC8yxn8RTbRl8zseNl8XSIWVmUeCjH0mtlRAL7rPGBFhLS21O7mKMGr4neGJOiMgOMrWZ9TAJytsU06Sfh5Lz4NquTSJm4sdDRxBt31yDB0Nacq7E1yfzkyAiavC0B3mExxjE8BuFD3u9DM/gZgghbFzo44Tc8LxPtWZ7fF79kcCQh8qMOnRR+QAL+r4FUb1LjMB/BuM7tOXso8Hf6ASLLnEeOlZvY19aWKsyiPoPoADIgpHI8sJaXIzgwS4FiMbVvDzH4K4GxnFxWpo/uSPFjrrHcksxmfIvm+MvyTC8bu54KfAf/2dlf0MS94GmA9x8T4OmHqDiP5K3ffZSQ3kLTqEZ7sDy5QmOrvHkm4X+YgLeb6xMORSK1X/7pdBL4ZBe+KkAz3KB5XCAvSOz/ixi8vaLqM5NROJTS6OZ5agpYI8JznQmpLzOUrBGTDOMzIqfURMHZvKBjDhkNdmKBo15cUWvFojZ2Lgt5tBGRfbEmBvt5dQQoBwJ8UOwpu0W4ABwaur8+vSCp1ObfvJABnKeY0RwMxR9zvh1KH+sUJv2BmjwDoFYc9Tm53j/K+Ur91IUvoi22w+W04OIaCbu6TO/oaAKe7viUFYxecBefKIfAoyVViF7IjiC2RIbjz3ObhWTeZ2XwA9U6kjMiB0Kt7XlSgNgX7bTKypEyMgXoHpXpQttKuCoHUcqSoOZX0myTXlfZTGwnu+hTJS1pRq4tr3OwoPSW5WJ4zDwrdURzTS68i1HGf+368rl9F0maqEMMNB8ZcQvL1Om+fnNT2lOShcNi/DiakhffbgeSTFUpOeW52dKvKRzncfLCAKw8qvd86Vd450ip2L4HnhDH+Tt6aGSWJNNsjvgU36i8B7IZn/tpd1zVsieQ+N1IMYaBiwAuSLOak0kR5lwDASPaY2bUK+j3iIul1cdP+iHP0AHgMwMFmdqbSkoMD4RwX4Q720ffN7D7h6E5y9khI7usHcEvkBOmE2hO8ih8E8CsZ3Y0WAdJEEnwPMzs7MIgKwczXl2gGNc3X1eLKnbQB6ZxGj+lZLPDeTtE6GsvqPymAVcxsjjSDpMBeCg6UXUmeI20m6WSq+C4isN+KGyUV0rPXko6cRnbBbq4wZEBur67co/slWTxneUYo8Y+qjFfI7QfJdUje5DhC6oCym+icPSMuFT5/rb52pEC7HxOSZzndu4o9dH2omqTxrVdIaTaSFxZIpPDMeUozSNpJL69Y/SfE5y4u6EPg+M8JirOcnTTKEqnuYUBR1kGZhrBHBQ2sVCItlxwmY/9pvewrHQy9KL0hiNKjIjHfkIq3vzt3giPYXpJrkzxQxSPfQXLNGPOn71u5XKZmpGIcFFQs54BoRIP3A+dZG25GcGAIU0heWSFtIY0M4olV++JU58lKBWHOc8I7nj9SzhQ3D2e2IKRnFU9a7v1GmZBqbj0nWs/zShhdU/d4VIzIihhcJUKKLggP3lM3ntBCKnXr89qCgb442EyOE3flZYFGnGwTkt8UQfoFG17kAHfuKTnPbmjSdm2VgdnmglrP1WcbbGEPhb6e4N67p52qNfLYPdeCkC5oxwM1RG3lXQV2UujTPwoIqWu0CSnq9+YREy6SStcJjVIfCiElOZPXK5330AolnLqcrbK7vCV1l57QVPzjRpLnC+S4mpkNxlsdCii7lhIFfw7gDgCfks2VRjGhg8wsOET2RoZh8/ZJCFo+aGZXebjNELegSRSsPFDAz6ktYDo+OHm8mZ2RE5huV/cf7aKOscTsLUCjhJjdJADvzvGYjonN5LyOfwZwWMlaDnbU9gBOVnypbaa7HPVpsTwGYBMAewg98FARutdVU0mQYeh2A3AJMkhPwwEcN0AGhpwBYDHJm5EVkUicS3dHTcakHNcuHZr3MDO7RBxnHQXhuiMwaAhcnhcBLdspJhJQCgF79wm5q9EiyBoIbBGA/cxsrqTQ4BAR0lVytvo6WLut5gzyPrmHDVlBmr8BWDMHiR1yikKBmnQFKTncL2fOBYqN7l/AAOtaW58heaeZXRiKtrQblZ8UbBSSX3Ei8IdV1SJn4L3aBUVZochGnmE+GKWSk+Rckls4jrmeShQXZS3eHYK4Q6xbFrJQ1yJ5ecUga3j2pW48JwzFdnGq0SRXty8tUEtu0XOGBXtxmcir+1oZ7vd7C9SbME+H5ahn9bFQ7XJS882pZ40SVfwxkluG6yqrdsJxTUWWEgEANzhxfRjJaRKTrYhpUKL0ITPbDVkW7INRIlnTZWYOREfTuSrrLhHtKbm1tzWzeXgpPWOW3MJ5GC8COFUSgENYwHWXhXoHMtBpoyTImjp18mIABwJ4RkQ8MJRyTUo1qZvZYgV6kSNVw0LfQn0ergoYYFzHAJiuPtQiKb1S7EkcVUUNEnRvgVvz3PTh3dZVOKMLGRA3aQdrl7oYy+8BLHQP+744aq3MmBVOrs/ZFOcpIn88snp1dMTRJXXMHz6DEwDuAvBVAFuZ2akh90a5SX8S8cc5M4GoblAqQq3qtvNhv1pkmL8+kjspC3V9pw5YiT1kin0dFCbJzPrNrBP4vt6ShRvG4C1a7N3DXHipVPOTPLh4Zd4dQu/UZWZ3A/h8XiZuZC+tD+AC9/5WlQtvG0r8uvJUvnbczHZrhcUSTN6Tw0j+TGLyPsWT7pfKcJ/Kc51Mchvn7ak5N/u/FaAE4qIX74lFc0W8XJcrbVX2nFi1eNrXZ+tgCah6VEFnsCRGde5w0BsOgb+hsJCUpy5x47KghWo3Y0VT7SKnUVDXf9SiIlG478ecql8pjvRmFRUMUJzVXZA1r1ZY0obHqycHNlLLqY+XVyqry9kJ/9sibhNe/qR23d0uAW8yySsq2EMe/HiHECGBGG0EXM/btABiBqjURnqXtm2l4LImeYS776ci+3dlJqQeEUSwAa8vIYyw7pskp0UFIkvd3/3yrIVCJc8jq/5jDu5/DMmQy8EqmC6pe/3yBvpco2aODhv2l50oWNEAgG5h0u6UxyWoMVaQi3MzgNNFgGkVB4kmLkEGTbpSenTT7eBQBJupIyuZvLWZPRzAqx1WgYKOfqfc7kmBndRUsuMJGtteqSRJO9uu6F7HOpvifSVq0Mqm3vXLC9fUpt4HIwNT57noza2zH6vwztJSG0mLbiGAB5DVKQiFTL6t/3e5yTqK5E0ANlBqNqsWCnQZmmlOvCIUf2+a2QvK6dlFDoWZci4UJbSFSV8C4N/b3GR60C3OK5HVGB9ogZcLY/F1Mzs2ZFuOxO7qIsqamS1DVjPdCpwnIXZ3JMmPmllA2ycVnSuh3NlMZFm94V0m4GXWVJGqRxkFH2wRX2rKFj+tZfjEYanOD3qxU3e2ilDNQZQ+QvIzoa63h/U4eIaVVAr19QMsslN2JHlNZPe0UrGaJKc7d3MlBHQOxGmgRaHEUEByJwffmSB1od3aDkkVNdmdN4Xk350ql+e+TYXe/1Cksi03J3GFW4ec97AZkrw2UjFXWtWupHLvWS3mvlklZuMJaTf970ZVLZ3g9h96PKduN5ntbXQ0yc0KjPfusG9NsEMKXmyq7rMgB+JTpaLm6e1CZNx+QK909mBaMpgNkj8N9lCHkQQ9DkJUi4Cx5ubiohbQJN//LwotEttBvTnPn+nqpXsY0O8iZvuyICQfX9L3W1qkwLQkprpUkzqyvPfbkBU+mWlmM7Qdyzxx4LD/UOrE3CZSBwZUKWchsvTyBao98E+qkQKVawLYWirbdMWwepyqNuhc4gul/0+JIuqhuujZZnZi2HqkPSlvTZLvRZaYVlZrLqhzfwGwv1DOA8NM8b8KwDNSy+51FYN6fVVWqc8UEzoOwPtL+msO1fElAIeTvAhZea+/m9n9ivdtoHvsDGA/zUWclEdktTIw0rUuhlDSoCNqs1oPgL20vqcWjGtSpbQrVWtgKclfIKt5cDDJ+WZ2OsnJIqatARylYF3iyt5Ci/4gd9/nSd7hJpZOF90YwEYF9krodLf+/rKCrnu6F2RERMeExdemoR904C3d4ktalO09roML4z/c99tI3qX3mRf2SIprMpjZ49q5YZZbWFZgKDeRQbw+p6MpaNagMownRwHlJGfRXl7gaBlObtNQGY+NkL0EM1tE8sgW49r63Zzu/CqHNCbJE+LcGaU+PJgjnvvbLOQ+qGzY/hyReinJvUl+r8DVS5Lf8Dk7w9g4+tScnRfK+jwQfbZ7DETbgvj2pNuJIimJK51ecWeGZsmzfLZynq31mNzEvsrT/UNQ7boi6NlgO6qdjg1d/lraCdWuYC0cWQHVz9I0CqcvHqjOhpTvb7kEu7Bp2BokP0HyKhe88xMx4IjEH+F/eR19lOR3SG6ngOqt0aT5PKMzhruZlHvfA9oxKkeo+f2cnhBe0XKwbubS289qcxeK1DmMyvKn+nOCkcFBcXfkjGiHkD5XYIcUXlthN4qOEJJzliVi4qy460Vg7PcUTdJ5OnGpy+zcuiBL9LUkT1M24jNsb2PlW0l+3+8v4xLIfKKg3zvIe+fqwxg472x4vo0tQ0ayhUV8RottXXqdkyAeK3Zg+5arImM/MJ0jCjh2FakyRQiQmJBbEVLZ/kidJCRfo+KuipJpuXywPPRvneQlbvGG9nOS7yja3Vk7le9B8nDBgS5VlaA5IpgPazJmqOKlv8+n+dKOc2kO57tOINKOJbA59/cnc4qJDObsCjfSRyjqMj+gr8tCCA7O9XzU/2YbRBUXork8eG2juQ37U93kiD5tkxi+7K5tVry2bMe+jhGSM2FqJKdJMygjJr/T4valSV0OluNjOalgNDsE7NIwOv4a4doeiTroY1aLSB7qXMCdrASUONXhIGUHrwitL6/+Qc489UTZxM+XpKT4Iy+tZRHJgx1j64ld8BqvN7kFzWjL0EMLiKHLQc/OjYi49NoWe8j26dpZncqCdutsM5e+0mDxvrsHtfSx6zgy6rjndPcKhPoRUfFaoS5Bzj3XVg7RATKW50TSbiAn+HqJtjF5UaXpZF0CV1Qy6PGrkvwAye/qvf6hWgSjdYTnPURycqtN37RAV3V/b6ziMXeRfKEi0d5N8mOu4ExviAHmqD1BpXwFyR9EjimSPKKoJFfQdPT3x53jovTaHGLaUPbhYnft7R0ipLDuu92zLikYt3kk9w1jZhWgI6lSrL+KbA8dKIaSRFAcv8X87VGKxmqKF8FlUcLdy6ItSn4L4DSV8ULb2YpDL/TYyEl/H6uYyeJW7nyl0IcM1sTForoVYgi1wvfUuIes5VnIyms9BOBGwYMqjbPPllZMcBeXYvJHZEU+A+QoNwNX2MseAO9BVsYsQbaNUOG1Oc/eQvGvBoDnAPxSmblppwDDbjzfj6z8dOpKcv9UIaNayzIGfjdwFeE4Jto5O0ipvja8Xv0S533R/58j+e1QLrmkdsBI1yqoVd0fdUVrHno1hGtsKKiAAjuj3k6KTR7iv5WTqMDrVhuF2hVeG6i3ldHoOZUqxbwLWWGSbR0iIc4WzQsSxm0JsozcnyHbDOsB5zKtAegfy4SyMdymBMN5b01wGPMkmhOLEBAc6uYCIZs4b/6rSFMHrE1dfyrVe9AaqbuAf7OTEinHWZJE+xanftys3YIgXoyR3Fzwnl0loie4lPW4PQXgz5rca6QCzjWzBTGn6kTt6vH28m9BtY2/j9VOZ0PhQkkR51Al0bwXelpbs+QVTRkxbjLextsKSUg5Yr3uEuFYtks5XqonkDgHBUdq36LxNt5Gq/0/pISynoujaR4AAAAASUVORK5CYII="
                alt="Zain"
                className="max-h-5 max-w-full object-contain"
              />
            </div>

            {/* ماستر كارد - MasterCard مفرغة */}
            <div
              className="w-8 h-6 sm:w-9 sm:h-6 flex items-center justify-center opacity-90 hover:opacity-100 transition hover:scale-105 px-0.5"
              title="MasterCard"
            >
              <svg className="max-h-4.5 max-w-full w-auto" viewBox="0 0 38 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="13" cy="12" r="9" fill="#EB001B"/>
                <circle cx="25" cy="12" r="9" fill="#F79E1B"/>
                <path d="M19 5.86a8.96 8.96 0 0 1 3.2 6.14 8.96 8.96 0 0 1-3.2 6.14 8.96 8.96 0 0 1-3.2-6.14A8.96 8.96 0 0 1 19 5.86Z" fill="#FF5F00"/>
              </svg>
            </div>

            {/* بينانس باي - Binance Pay مفرغة */}
            <div
              className="w-8 h-6 sm:w-9 sm:h-6 flex items-center justify-center opacity-90 hover:opacity-100 transition hover:scale-105 px-0.5"
              title="Binance Pay"
            >
              <svg className="max-h-4.5 max-w-full w-auto" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L8.5 5.5L12 9L15.5 5.5L12 2Z" fill="#F3BA2F"/>
                <path d="M5.5 8.5L2 12L5.5 15.5L9 12L5.5 8.5Z" fill="#F3BA2F"/>
                <path d="M18.5 8.5L15 12L18.5 15.5L22 12L18.5 8.5Z" fill="#F3BA2F"/>
                <path d="M12 15L8.5 18.5L12 22L15.5 18.5L12 15Z" fill="#F3BA2F"/>
                <path d="M12 10.2L10.2 12L12 13.8L13.8 12L12 10.2Z" fill="#F3BA2F"/>
              </svg>
            </div>

            {/* تيذر USDT مفرغة */}
            <div
              className="w-8 h-6 sm:w-9 sm:h-6 flex items-center justify-center opacity-90 hover:opacity-100 transition hover:scale-105 px-0.5"
              title="Tether USDT"
            >
              <svg className="max-h-4.5 max-w-full w-auto" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="16" r="15" fill="#26A17B"/>
                <path d="M17.9 14.8v-1.9h4.3v-2.3h-12.4v2.3h4.3v1.9c-4.1.2-7.2 1-7.2 2 0 1 3.1 1.8 7.2 2v6.6h3.8v-6.6c4.1-.2 7.2-1 7.2-2 0-1-3.1-1.8-7.2-2zm0 3.3c-.4 0-1.2.1-1.9.1-1.1 0-1.6 0-1.9-.1-3.3-.1-5.7-.7-5.7-1.4 0-.7 2.4-1.3 5.7-1.4.4 0 1.2-.1 1.9-.1.8 0 1.5 0 1.9.1 3.3.1 5.7.7 5.7 1.4 0 .7-2.4 1.3-5.7 1.4z" fill="#FFFFFF"/>
              </svg>
            </div>

            {/* منصة OKX مفرغة من الملف الأصلي */}
            <div
              className="w-8 h-6 sm:w-9 sm:h-6 flex items-center justify-center opacity-90 hover:opacity-100 transition hover:scale-105 px-0.5"
              title="OKX"
            >
              <img
                src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANIAAAA/CAYAAACVQ5YeAAACgElEQVR4nO3dMWsUQRyG8TciGG2S0sJCO0u/gbESbUQsLCwMWJhSOwvBWIitnbVgEcHCwkYUjN/CTsHeS3cphJGBFWzUG3yGze09PzhIsTf7v7t9SK7YSUopt0sp87JaZsPrzoKPC8NzKF9KKecbzr8sc26D11LrZ5SR5vxe51yrAyfZzOqZJzm14LEPkjyFz/8wyRN4zbHnnMHXUstn1AKf89iKRlStdzp2Ucc7rDn2nJtL8Hq6zFlDkvSfDEkCGJIEMCQJYEgSwJAkgCFJAEOSAIYkAQxJAhiSBDAkCWBIEsCQJIAhSQBDkgCGJB3RuzR/+ZbkB7TWuUxPvUvzLLzm+yTXkmxA6x0k+dBw/L0kd6E7Ww+T7A0/nwGv1a8d5nxV92wo4d1P8gxcbzfJo7BKw2/kHudPh9dzKcmnTMsu/N7X9R4H1iuktQ5r0nNOLaReG6qMrXRYD/9K43ekaen5p7r+wpAkgCFJAEOSAIYkAQxJAhiSBDAkCWBIEsCQJIAhSQBDkgCGJAEMSQIYkgQwJAlgSBLAkKQjfEdl3bTiNbT5SZ3xTqbn8/AIuFFJfd+3ho1VqDX3G59zOclJ4NzzJO+SXE9yC7pW623mL3rM2Sukm8NDf7bXYROOnSTP4TW3f7v4/uXjEDJlf9jQ5U1Y+Jz+aTctpzus2bJl2BZ87ovpA5/TkCSAIUkAQ5IAhiQBDEkCGJIEMCQJYEgSwJAkgCFJAEOSAIYkAQxJAhiSBDAkCWBIEsCQJCikWVZT3Y9gUYcjn39Z5jwY8dxjrntQ92y4muTGiv1r+bopy9uG418mOQFvKlI3h6HVOTeSrINhtsx5BbyWWj+jFvicPwFHV1wXrVk3kAAAAABJRU5ErkJggg=="
                alt="OKX"
                className="h-3.5 sm:h-4 w-auto max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      </div>
    </footer>

      {/* رسالة صغيرة وأنيقة بالخط الأسود تظهر في نص الشاشة من الأسفل فقط مع دخول وخروج فائق السلاسة */}
      {cartToastMessage && (
        <div 
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white/95 backdrop-blur-sm text-black border border-gray-300 px-3.5 py-1.5 rounded-full shadow-md flex items-center gap-1.5 pointer-events-none transition-all duration-300 ease-out transform ${
            cartToastVisible 
              ? 'opacity-100 translate-y-0 scale-100' 
              : 'opacity-0 translate-y-3 scale-95'
          }`}
        >
          <i className="fa-solid fa-check text-black text-[10px]"></i>
          <span className="text-[11px] font-bold text-black tracking-tight">{cartToastMessage}</span>
        </div>
      )}

      {/* ========================================================= */}
      {/* نافذة طلب شحن المحفظة ذاتياً من قبل العميل (Top-up Modal) */}
      {/* ========================================================= */}
      {isTopupModalOpen && typeof document !== 'undefined' && createPortal(
        <div 
          onClick={() => setIsTopupModalOpen(false)}
          className="fixed inset-0 z-9999 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overscroll-contain animate-fadeIn"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh' }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-right font-sans"
            dir="rtl"
          >
            {/* رأس النافذة */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center text-sm shadow-2xs">
                  <i className="fa-solid fa-wallet"></i>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 text-sm sm:text-base">طلب شحن المحفظة</h4>
                  <p className="text-[10px] text-gray-400">حول المبلغ وارفع الإشعار ليتم إيداعه فوراً</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTopupModalOpen(false)}
                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* محتوى النموذج */}
            <form onSubmit={handleSendTopupRequest} className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
              {/* اختيار وسيلة التحويل */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1.5">اختر وسيلة التحويل:</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'zaincash', name: 'زين كاش (ZainCash)', icon: '📱' },
                    { id: 'binance', name: 'Binance Pay', icon: '🟡' },
                    { id: 'iraqimaster', name: 'ماستر كارد / بنكي', icon: '💳' },
                    { id: 'okx', name: 'منصة OKX (USDT)', icon: '⚡' }
                  ].map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setTopupMethod(m.id)}
                      className={`p-2.5 rounded-xl border text-right transition cursor-pointer flex items-center gap-2 ${
                        topupMethod === m.id
                          ? 'border-emerald-600 bg-emerald-50/70 text-emerald-950 font-bold shadow-2xs'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700 bg-white'
                      }`}
                    >
                      <span className="text-base">{m.icon}</span>
                      <span className="text-[11px]">{m.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* بيانات الحساب والباركود الخاص بالوسيلة المحددة */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/80 space-y-2">
                {topupMethod === 'zaincash' && (
                  <>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-500">رقم محفظة زين كاش:</span>
                      <span className="font-mono font-bold text-purple-900 dir-ltr">{storeConfig.zainCashNumber}</span>
                    </div>
                    {storeConfig.zainCashQrCode && (
                      <div className="flex justify-center pt-1">
                        <img src={storeConfig.zainCashQrCode} alt="QR زين كاش" className="w-28 h-28 object-contain rounded-lg border border-gray-200 bg-white p-1" />
                      </div>
                    )}
                  </>
                )}

                {topupMethod === 'binance' && (
                  <>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-500">معرف Binance Pay ID:</span>
                      <span className="font-mono font-bold text-amber-900 dir-ltr">{storeConfig.binancePayId}</span>
                    </div>
                    {storeConfig.binanceQrCode && (
                      <div className="flex justify-center pt-1">
                        <img src={storeConfig.binanceQrCode} alt="QR بينانس" className="w-28 h-28 object-contain rounded-lg border border-gray-200 bg-white p-1" />
                      </div>
                    )}
                  </>
                )}

                {topupMethod === 'iraqimaster' && (
                  <>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-500">رقم البطاقة المصرفية:</span>
                      <span className="font-mono font-bold text-red-900 dir-ltr">{storeConfig.masterCardIraqi}</span>
                    </div>
                    <div className="text-[10px] text-gray-500">{storeConfig.masterCardBeneficiary}</div>
                  </>
                )}

                {topupMethod === 'okx' && (
                  <>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-500">معرف OKX UID:</span>
                      <span className="font-mono font-bold text-gray-900 dir-ltr">{storeConfig.okxUid}</span>
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono break-all dir-ltr">{storeConfig.okxUsdtAddress}</div>
                  </>
                )}
              </div>

              {/* مبلغ الشحن المطلوب */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                  المبلغ المطلوب شحنه بالدولار ($):
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    placeholder="مثال: 25"
                    value={topupAmountUsd}
                    onChange={(e) => setTopupAmountUsd(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 focus:border-emerald-600 focus:bg-white rounded-xl text-xs outline-none font-mono"
                  />
                  <span className="absolute left-3 top-2 text-gray-400 font-bold">$</span>
                </div>
                {topupAmountUsd && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    يعادل تقريباً: <span className="font-bold text-emerald-800 font-mono">{(parseFloat(topupAmountUsd) * (storeConfig.usdToIqdRate || 1500)).toLocaleString('en-US')} د.ع</span>
                  </p>
                )}
              </div>

              {/* رفع صورة إشعار التحويل */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                  إرفاق إشعار التحويل البنكي / الإيصال: <span className="text-red-500">*</span>
                </label>
                {topupProof ? (
                  <div className="relative border border-emerald-300 rounded-xl p-2 bg-emerald-50/40 flex items-center justify-between">
                    <img src={topupProof} alt="إيصال الشحن" className="w-12 h-12 object-cover rounded-lg border border-gray-200" />
                    <span className="text-[11px] font-bold text-emerald-800">✓ تم تجهيز صورة الإيصال</span>
                    <button
                      type="button"
                      onClick={() => setTopupProof('')}
                      className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-[10px] cursor-pointer"
                    >
                      تغيير
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-gray-300 hover:border-emerald-500 rounded-xl bg-gray-50/60 hover:bg-emerald-50/20 cursor-pointer transition">
                    <i className="fa-solid fa-cloud-arrow-up text-xl text-gray-400 mb-1"></i>
                    <span className="text-[11px] font-bold text-gray-700">اضغط لرفع لقطة شاشة التحويل</span>
                    <span className="text-[9px] text-gray-400">JPG, PNG (يتم ضغطها وتجهيزها فورياً)</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          try {
                            const compressed = await compressImage(file, 600, 0.7);
                            setTopupProof(compressed);
                          } catch (err) {
                            alert('حدث خطأ أثناء قراءة الصورة');
                          }
                        }
                      }}
                    />
                  </label>
                )}
              </div>

              {/* ملاحظات إضافية */}
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  ملاحظات أو رقم الحساب المحول منه (اختياري):
                </label>
                <input
                  type="text"
                  placeholder="مثال: رقم العملية أو اسم المحول..."
                  value={topupNote}
                  onChange={(e) => setTopupNote(e.target.value)}
                  className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 focus:border-emerald-600 focus:bg-white rounded-xl text-xs outline-none"
                />
              </div>

              {/* زر الإرسال */}
              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl font-bold text-xs shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fa-solid fa-paper-plane text-xs"></i>
                  <span>إرسال طلب الشحن للإدارة</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================= */}
      {/* نافذة تقييم الطلب مع إرفاق لقطة شاشة واستلام المنتجات */}
      {/* ========================================================= */}
      {reviewModalOrder && typeof document !== 'undefined' && createPortal(
        <div 
          onClick={() => setReviewModalOrder(null)}
          className="fixed inset-0 z-9999 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overscroll-contain animate-fadeIn"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh' }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-right font-sans"
            dir="rtl"
          >
            {/* رأس النافذة */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-amber-50 to-white">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-sm shadow-2xs">
                  <span>⭐</span>
                </div>
                <div>
                  <h4 className="font-bold text-gray-900 text-sm sm:text-base">تقييم الطلب #{reviewModalOrder.id}</h4>
                  <p className="text-[10px] text-gray-400">شارك رأيك وصورة استلام المنتج لدعم المتجر والآخرين</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReviewModalOrder(null)}
                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* محتوى نموذج التقييم */}
            <form onSubmit={handleSubmitOrderReview} className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
              {/* المنتج المراد تقييمه */}
              {reviewModalOrder.items && reviewModalOrder.items.length > 1 && (
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 mb-1">المنتج المراد تقييمه:</label>
                  <select
                    value={reviewModalProductId}
                    onChange={(e) => setReviewModalProductId(e.target.value)}
                    className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none"
                  >
                    {reviewModalOrder.items.map((it, idx) => (
                      <option key={idx} value={it.productId || it.id}>{it.title}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* التقييم بالنجوم */}
              <div className="text-center py-2 bg-amber-50/50 rounded-xl border border-amber-200/60">
                <span className="block text-[11px] font-bold text-gray-700 mb-1.5">ما هو تقييمك العام للخدمة؟</span>
                <div className="flex items-center justify-center gap-2 text-2xl text-amber-400">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setReviewModalRating(star)}
                      className="cursor-pointer transition hover:scale-125 focus:outline-none"
                    >
                      <i className={`fa-star ${reviewModalRating >= star ? 'fa-solid' : 'fa-regular text-gray-300'}`}></i>
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-amber-800 font-bold block mt-1">
                  {reviewModalRating === 5 ? 'ممتاز جداً 🌟🌟🌟🌟🌟' :
                   reviewModalRating === 4 ? 'جيد جداً 👍' :
                   reviewModalRating === 3 ? 'متوسط 😐' :
                   reviewModalRating === 2 ? 'ضعيف 👎' : 'سيء جداً ⚠️'}
                </span>
              </div>

              {/* تعليق وملاحظات العميل */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                  رأيك وتجربتك بالتفصيل: <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="أكتب رأيك في سرعة التسليم، جودة المنتج، والتعامل..."
                  value={reviewModalComment}
                  onChange={(e) => setReviewModalComment(e.target.value)}
                  className="w-full p-2.5 bg-gray-50 border border-gray-200 focus:border-amber-500 focus:bg-white rounded-xl text-xs outline-none leading-relaxed"
                />
              </div>

              {/* إرفاق لقطة شاشة / صورة استلام المنتج */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                  إرفاق لقطة شاشة أو صورة من مزرعتك/استلامك (اختياري ومميز):
                </label>
                {reviewModalPhoto ? (
                  <div className="relative border border-amber-300 rounded-xl p-2 bg-amber-50/40 flex items-center justify-between">
                    <img src={reviewModalPhoto} alt="صورة التقييم" className="w-14 h-14 object-cover rounded-lg border border-gray-200" />
                    <span className="text-[11px] font-bold text-amber-900">✓ تم تجهيز الصورة المرفقة</span>
                    <button
                      type="button"
                      onClick={() => setReviewModalPhoto('')}
                      className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-[10px] cursor-pointer"
                    >
                      إزالة
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-3.5 border-2 border-dashed border-gray-300 hover:border-amber-500 rounded-xl bg-gray-50/60 hover:bg-amber-50/20 cursor-pointer transition">
                    <i className="fa-solid fa-camera text-xl text-gray-400 mb-1"></i>
                    <span className="text-[11px] font-bold text-gray-700">اضغط لرفع لقطة شاشة</span>
                    <span className="text-[9px] text-gray-400">ستظهر مع تقييمك ليراها الزوار في صفحة المنتج</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          try {
                            const compressed = await compressImage(file, 600, 0.7);
                            setReviewModalPhoto(compressed);
                          } catch (err) {
                            alert('حدث خطأ أثناء قراءة الصورة');
                          }
                        }
                      }}
                    />
                  </label>
                )}
              </div>

              {/* زر النشر */}
              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 active:scale-98 text-white rounded-xl font-bold text-xs shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fa-solid fa-star text-xs"></i>
                  <span>نشر التقييم ومشاركته</span>
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
      {/* ========================================================= */}
      {/* نافذة تتبع الطلبات للعملاء (Order Tracking Modal) */}
      {/* ========================================================= */}
      {showOrderTrackingModal && typeof document !== 'undefined' && createPortal(
        <div 
          onClick={() => setShowOrderTrackingModal(false)}
          className="fixed inset-0 z-9999 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh' }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4 text-right animate-in zoom-in-95"
            dir="rtl"
          >
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-teal-50 text-[#004956] flex items-center justify-center text-sm font-bold">
                  <i className="fa-solid fa-truck-fast"></i>
                </div>
                <div>
                  <h4 className="font-bold text-sm text-gray-900">تتبع حالة الطلب</h4>
                  <span className="text-[10px] text-gray-400">أدخل رقم الطلب أو رقم هاتفك لمعرفة حالة الشحنة</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOrderTrackingModal(false)}
                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form 
              onSubmit={(e) => {
                e.preventDefault();
                setTrackingSearched(true);
                const q = trackingQuery.trim().toLowerCase();
                if (!q) {
                  setTrackingFoundOrder(null);
                  return;
                }
                const found = orders.find(o => 
                  String(o.id || '').toLowerCase().includes(q) ||
                  String(o.customerPhone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '')) ||
                  String(o.customerIdentifier || '').toLowerCase().includes(q)
                );
                setTrackingFoundOrder(found || null);
              }}
              className="space-y-3"
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={trackingQuery}
                  onChange={(e) => setTrackingQuery(e.target.value)}
                  placeholder="مثال: ORD-123456 أو رقم الهاتف"
                  className="flex-1 p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:border-[#004956]"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-[#004956] text-white rounded-xl text-xs font-bold hover:opacity-90 transition cursor-pointer"
                >
                  بحث
                </button>
              </div>

              {trackingSearched && (
                <div>
                  {trackingFoundOrder ? (
                    <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-gray-900">{trackingFoundOrder.id}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          trackingFoundOrder.status === 'مكتمل' ? 'bg-emerald-100 text-emerald-800' :
                          trackingFoundOrder.status === 'ملغي' ? 'bg-red-100 text-red-800' :
                          trackingFoundOrder.status === 'قيد التنفيذ' ? 'bg-blue-100 text-blue-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {trackingFoundOrder.status}
                        </span>
                      </div>

                      <div className="text-[11px] text-gray-600 space-y-1">
                        <div><strong>العميل:</strong> {trackingFoundOrder.customer}</div>
                        <div><strong>الإجمالي:</strong> {trackingFoundOrder.totalFormatted || `$${trackingFoundOrder.totalUsd}`}</div>
                        <div><strong>التاريخ:</strong> {trackingFoundOrder.date}</div>
                      </div>

                      {Array.isArray(trackingFoundOrder.fulfilledKeys) && trackingFoundOrder.fulfilledKeys.length > 0 && (
                        <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg space-y-1">
                          <span className="font-bold text-emerald-900 text-[10px] block">🔑 الأكواد المسلمة:</span>
                          {trackingFoundOrder.fulfilledKeys.map((k, idx) => (
                            <div key={idx} className="font-mono text-emerald-800 font-bold select-all text-xs bg-white p-1 rounded border border-emerald-200">
                              {k.key}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 bg-red-50 text-red-600 rounded-xl text-center text-xs">
                      لم يتم العثور على أي طلب يطابق هذا الرقم.
                    </div>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================= */}
      {/* زر الدعم الفني المباشر العائم مع قائمة سريعة (WhatsApp & Telegram) */}
      {/* ========================================================= */}
      {storeConfig.enableFloatingSupport !== false && viewMode === 'store' && (
        <div className="fixed bottom-5 left-5 z-999 flex flex-col items-start gap-2 select-none" dir="ltr">
          {isSupportMenuOpen && (
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-2 space-y-1.5 animate-in fade-in slide-in-from-bottom-2 duration-200 text-right" dir="rtl">
              {storeConfig.whatsapp && (
                <a
                  href={`https://wa.me/${storeConfig.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent('مرحباً، أحتاج مساعدة بخصوص المتجر')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 text-xs font-bold text-green-700 hover:bg-green-50 rounded-xl flex items-center gap-2 transition cursor-pointer"
                >
                  <i className="fa-brands fa-whatsapp text-green-500 text-sm"></i>
                  <span>محادثة واتساب مباشرة</span>
                </a>
              )}

              {storeConfig.telegram && (
                <a
                  href={`https://t.me/${storeConfig.telegram.replace('@', '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-50 rounded-xl flex items-center gap-2 transition cursor-pointer"
                >
                  <i className="fa-brands fa-telegram text-sky-500 text-sm"></i>
                  <span>قناة / دعم تيليجرام</span>
                </a>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsSupportMenuOpen(!isSupportMenuOpen)}
            className="w-12 h-12 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform cursor-pointer"
            title="الدعم الفني السريع وتتبع الطلبات"
          >
            <i className={`fa-solid ${isSupportMenuOpen ? 'fa-xmark' : 'fa-headset'} text-lg`}></i>
          </button>
        </div>
      )}

      {/* ========================================================= */}
      {/* بانر الإشعار العائم التفاعلي داخل التطبيق (In-App Notification Banner) */}
      {/* ========================================================= */}
      {inAppBanner && typeof document !== 'undefined' && createPortal(
        <div 
          onClick={() => {
            setIsUserMenuOpen(false);
            setProfileTab('notifications');
            setIsAuthModalOpen(false);
            setViewMode('store');
            setInAppBanner(null);
          }}
          className="fixed top-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-10000 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-emerald-200 p-3.5 flex items-start gap-3 cursor-pointer animate-in slide-in-from-top-4 duration-300 select-none hover:shadow-emerald-100"
          dir="rtl"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 text-base shadow-sm">
            <i className="fa-solid fa-bell animate-bounce"></i>
          </div>
          <div className="flex-1 min-w-0 pr-0.5">
            <div className="flex items-center justify-between gap-1">
              <h5 className="font-bold text-xs text-gray-900 truncate">{inAppBanner.title}</h5>
              <button 
                type="button" 
                onClick={(e) => { e.stopPropagation(); setInAppBanner(null); }}
                className="text-gray-400 hover:text-gray-600 text-xs p-1"
              >
                ✕
              </button>
            </div>
            <p className="text-[11px] text-gray-600 line-clamp-2 mt-0.5 leading-relaxed">{inAppBanner.message}</p>
          </div>
        </div>,
        document.body
      )}

      {/* ========================================================= */}
      {/* نافذة التنبيه والتأكيد الأنيقة النظيفة في وسط الشاشة (Clean Center Modal) */}
      {/* ========================================================= */}
      {modalDialog && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[9999999] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs select-none animate-in fade-in duration-200"
          dir="rtl"
          onClick={() => {
            if (modalDialog.onCancel) modalDialog.onCancel();
            setModalDialog(null);
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl p-6 sm:p-7 max-w-sm w-full text-center shadow-2xl border border-gray-100 flex flex-col items-center animate-in zoom-in-95 duration-200"
          >
            {/* أيقونة الحالة الدائرية */}
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 text-2xl shadow-xs ${
              modalDialog.type === 'error'
                ? 'bg-rose-50 text-rose-600 border border-rose-100'
                : modalDialog.type === 'warning'
                ? 'bg-amber-50 text-amber-600 border border-amber-100'
                : modalDialog.type === 'info'
                ? 'bg-sky-50 text-sky-600 border border-sky-100'
                : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
            }`}>
              {modalDialog.type === 'error' ? (
                <i className="fa-solid fa-circle-exclamation"></i>
              ) : modalDialog.type === 'warning' ? (
                <i className="fa-solid fa-triangle-exclamation"></i>
              ) : modalDialog.type === 'info' ? (
                <i className="fa-solid fa-circle-info"></i>
              ) : (
                <i className="fa-solid fa-circle-check"></i>
              )}
            </div>

            {/* العنوان */}
            {modalDialog.title && (
              <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-1.5 leading-snug">
                {modalDialog.title}
              </h3>
            )}

            {/* نص الرسالة الأنيق والمختصر */}
            <p className="text-xs sm:text-sm text-gray-600 leading-relaxed mb-6 font-normal whitespace-pre-line">
              {modalDialog.message}
            </p>

            {/* أزرار الإجراء */}
            <div className={`w-full flex items-center gap-2.5 ${modalDialog.showCancel ? 'grid grid-cols-2' : ''}`}>
              {modalDialog.showCancel && (
                <button
                  type="button"
                  onClick={() => {
                    if (modalDialog.onCancel) modalDialog.onCancel();
                    setModalDialog(null);
                  }}
                  className="w-full py-2.5 px-4 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold text-xs transition cursor-pointer active:scale-98"
                >
                  {modalDialog.cancelText || 'إلغاء'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (modalDialog.onConfirm) modalDialog.onConfirm();
                  setModalDialog(null);
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-gray-900 hover:bg-black text-white font-bold text-xs transition shadow-sm cursor-pointer active:scale-98"
              >
                {modalDialog.confirmText || 'حسناً'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// =========================================================
// مكون شريط المنتجات المتحركة تلقائياً كل ثانيتين (Auto Moving Products Carousel)
// =========================================================
function AutoMovingProductsCarousel({
  carouselId,
  products = [],
  wishlist = [],
  toggleWishlist,
  activeCurrency,
  formatPrice,
  calculateAverageRating,
  handleAddToCart,
  setActiveProductForPage,
  setViewMode
}) {
  const containerRef = useRef(null);
  const isInteractingRef = useRef(false);
  const touchTimeoutRef = useRef(null);
  const currentIndexRef = useRef(0);

  useEffect(() => {
    if (products.length <= 1) return;

    const timer = setInterval(() => {
      if (isInteractingRef.current) return;
      const el = containerRef.current;
      if (!el) return;

      const children = el.children;
      if (!children || children.length === 0) return;

      let nextIndex = currentIndexRef.current + 1;
      if (nextIndex >= products.length) {
        nextIndex = 0;
      }
      currentIndexRef.current = nextIndex;

      const targetChild = children[nextIndex];
      if (targetChild) {
        const targetOffset = targetChild.offsetLeft - el.offsetLeft;
        el.scrollTo({
          left: targetOffset,
          behavior: 'smooth'
        });
      }
    }, 2500);

    return () => {
      clearInterval(timer);
      if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
    };
  }, [products.length]);

  const handleTouchStart = () => {
    isInteractingRef.current = true;
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
  };

  const handleTouchEnd = () => {
    if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current);
    touchTimeoutRef.current = setTimeout(() => {
      isInteractingRef.current = false;
    }, 1500);
  };

  return (
    <div
      id={carouselId}
      ref={containerRef}
      onMouseEnter={() => { isInteractingRef.current = true; }}
      onMouseLeave={() => { isInteractingRef.current = false; }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="flex items-stretch gap-3 sm:gap-4 overflow-x-auto pb-3 pt-1 scrollbar-none scroll-smooth"
    >
      {products.map((p) => {
        const isInWishlist = wishlist.includes(p.id);
        const hasDiscount = p.oldPrice && p.oldPrice > p.price;
        const avgRating = calculateAverageRating(p.reviews);

        return (
          <div
            key={p.id}
            onClick={() => {
              setActiveProductForPage(p);
              setViewMode('product-detail');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="w-44 sm:w-48 md:w-56 lg:w-[230px] shrink-0 bg-white border-0 shadow-none hover:shadow-none rounded-xl sm:rounded-2xl transition-all duration-300 flex flex-col justify-between cursor-pointer group overflow-hidden relative"
          >
            <div>
              {/* 1. حاوية صورة المنتج ممتدة طولياً لإبراز تفاصيل المنتج */}
              <div className="relative pt-[112%] sm:pt-[108%] bg-white overflow-hidden flex items-center justify-center">
                <img
                  src={p.imageUrl}
                  alt={p.title}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                />

                {/* زر المفضلة الدائري الشفاف في الزاوية العلوية كما في الصورة المرجعية */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWishlist(p.id);
                  }}
                  title={isInWishlist ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
                  aria-label="Add to wishlist"
                  className={`absolute top-2.5 left-2.5 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 z-10 cursor-pointer ${
                    isInWishlist 
                      ? 'bg-red-50 text-red-500' 
                      : 'bg-white/80 backdrop-blur-xs text-gray-400 hover:text-red-500 hover:bg-white'
                  }`}
                >
                  <i className={`fa-heart text-xs ${isInWishlist ? 'fa-solid text-red-500' : 'fa-regular'}`}></i>
                </button>
              </div>

              {/* 2. عنوان المنتج بمحاذاة اليمين */}
              <div className="p-2.5 pt-4 sm:pt-5 pb-1 text-right w-full" dir="rtl">
                <h3
                  className="s-product-card-title text-[13px] sm:text-[12px] font-medium text-gray-800 line-clamp-1 leading-snug text-right w-full"
                  style={{ textAlign: 'right' }}
                  title={p.title}
                >
                  {p.title}
                </h3>
              </div>
            </div>

            {/* 3. أسفل البطاقة: السعر وزر إضافة للسلة المطابق لـ سلة */}
            <div className="p-2.5 pt-1 pb-4 sm:pb-5 text-right w-full" dir="rtl">
              <div className="flex items-center justify-between gap-1.5 mb-2 text-right">
                <div className="product-price-wrapper flex items-baseline gap-1 text-right justify-start">
                  <span className="text-[9.5px] sm:text-[10px] font-bold text-gray-900 font-price text-right">
                    {formatPrice(p.price, activeCurrency)}
                  </span>
                  {hasDiscount && (
                    <span className="text-[8px] sm:text-[8.5px] text-gray-400 line-through font-price text-right">
                      {formatPrice(p.oldPrice, activeCurrency)}
                    </span>
                  )}
                </div>

                {avgRating > 0 && (
                  <div className="flex items-center gap-1 text-[10px] text-amber-500">
                    <i className="fa-solid fa-star text-[9px]"></i>
                    <span className="font-bold text-gray-700 text-[10px] font-mono leading-none">{avgRating}</span>
                  </div>
                )}
              </div>

              {/* زر أضف إلى السلة المطابق تماماً للصورة المرجعية */}
              {p.productType === 'exchange' || (typeof p.exchangeCurrencyName === 'string' && p.exchangeCurrencyName.trim().length > 0) ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveProductForPage(p);
                    setViewMode('product-detail');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-md border border-[#1e293b] hover:border-[#0f172a] bg-white hover:bg-slate-50 active:scale-98 text-[#0f172a] font-bold text-[10px] sm:text-[11px] transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                >
                  <i className="fa-solid fa-right-left text-[#0f172a] text-[9px]"></i>
                  <span>طلب المبادلة</span>
                </button>
              ) : isProductRequiringInput(p) ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveProductForPage(p);
                    setViewMode('product-detail');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-md border border-gray-200 hover:border-black bg-white hover:bg-gray-50 active:scale-98 text-gray-900 font-bold text-[10px] sm:text-[11px] transition-all duration-200 flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                >
                  <i className="fa-solid fa-pen-to-square text-gray-700 text-[9px]"></i>
                  <span>تحديد البيانات</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddToCart(p, null, '', 1);
                  }}
                  className="btn-add-to-cart w-[94%] mx-auto py-1 sm:py-1.5 h-7 sm:h-8 rounded-[7px] border border-gray-900 active:scale-98 font-bold text-[10px] sm:text-[11px] flex items-center justify-center gap-1 cursor-pointer shadow-2xs group"
                >
                  <i className="fa-solid fa-bag-shopping text-[9px]"></i>
                  <span>أضف إلى السلة</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =========================================================
// مكون تقييمات العملاء التلقائي المتحرك بنمط منصة سلة (Salla Style Review Slider)
// =========================================================
function SallaReviewsWidget({ reviews = [], title = '', subtitle = '' }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [fadeAnim, setFadeAnim] = useState(true);
  const [showAllModal, setShowAllModal] = useState(false);
  const [modalAnim, setModalAnim] = useState(false);

  const openAllModal = () => {
    setShowAllModal(true);
    // تشغيل الموشن مباشرة بعد إدراج العنصر في DOM
    setTimeout(() => setModalAnim(true), 15);
  };

  const closeAllModal = () => {
    setModalAnim(false);
    setTimeout(() => setShowAllModal(false), 280);
  };

  // قفل سكرول الصفحة الرئيسية كلياً عند فتح نافذة التقييمات حتى لا يتحرك الموقع في الخلفية نهائياً
  useEffect(() => {
    if (showAllModal) {
      const origBodyOverflow = document.body.style.overflow;
      const origHtmlOverflow = document.documentElement.style.overflow;
      const origTouchAction = document.body.style.touchAction;

      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';

      return () => {
        document.body.style.overflow = origBodyOverflow;
        document.documentElement.style.overflow = origHtmlOverflow;
        document.body.style.touchAction = origTouchAction;
      };
    }
  }, [showAllModal]);

  const total = reviews.length;

  const goToReview = (index) => {
    if (total <= 1) return;
    setFadeAnim(false);
    setTimeout(() => {
      setCurrentIndex((index + total) % total);
      setFadeAnim(true);
    }, 180);
  };

  const handleNext = () => goToReview(currentIndex + 1);
  const handlePrev = () => goToReview(currentIndex - 1);

  // التبديل التلقائي كل 4.5 ثوانٍ مثل سلة مع إيقاف مؤقت عند التمرير بالماوس
  useEffect(() => {
    if (total <= 1 || isPaused) return;
    const timer = setInterval(() => {
      handleNext();
    }, 4500);
    return () => clearInterval(timer);
  }, [currentIndex, isPaused, total]);

  if (!reviews || reviews.length === 0) return null;
  const prevIndex = (currentIndex - 1 + total) % total;
  const nextIndex = (currentIndex + 1) % total;

  const current = reviews[currentIndex] || reviews[0];
  const prevReview = reviews[prevIndex] || current;
  const nextReview = reviews[nextIndex] || current;

  // دالة تحديد جنس المشتري (ذكر أم أنثى) بناءً على الاسم أو الحقل
  const isFemaleCustomer = (name = '', gender = '') => {
    if (gender === 'female' || gender === 'انثى') return true;
    if (gender === 'male' || gender === 'ذكر') return false;
    const femaleNames = [
      'سارة', 'مريم', 'فاطمة', 'نور', 'زينب', 'هدى', 'ريم', 'روان', 'شهد', 
      'دلال', 'منى', 'أمل', 'أميرة', 'عبير', 'غدير', 'رنا', 'آية', 'إسراء', 
      'زهراء', 'حوراء', 'بنين', 'تقى', 'سجى', 'رغد', 'ملاك', 'يارا', 'حنين',
      'نجلاء', 'خلود', 'أسماء', 'هند', 'جمانة', 'لمى', 'ليان', 'ريماس', 'جود'
    ];
    const firstName = name.trim().split(' ')[0];
    return femaleNames.includes(firstName) || firstName.endsWith('ة') || firstName.endsWith('اء');
  };

  const isFemale = isFemaleCustomer(current.name, current.gender);
  const mainTitle = title && title.trim() ? title : 'آراء وتقييمات العملاء';

  return (
    <div className="mt-5 pt-3 overflow-hidden">
      {/* الترويسة بمحاذاة العنوان والعداد يميناً وزر 'عرض الكل' يساراً */}
      <div className="max-w-xl mx-auto px-2 mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm sm:text-base font-semibold text-gray-900 flex items-center gap-2">
            <span>{mainTitle}</span>
            <span className="text-[10px] font-normal px-2 py-0.5 bg-amber-50 text-amber-800 rounded-xs">
              {currentIndex + 1} من {total}
            </span>
          </h3>
          {subtitle && subtitle.trim() && (
            <span className="hidden sm:inline text-[11px] text-gray-500 mr-2">
              {subtitle}
            </span>
          )}
        </div>

        {/* زر عرض الكل بمحاذاتها يساراً */}
        <button
          type="button"
          onClick={openAllModal}
          className="text-xs font-medium text-[#004956] hover:text-[#003842] flex items-center gap-1 cursor-pointer"
        >
          <span>عرض الكل</span>
          <i className="fa-solid fa-arrow-left text-[10px]"></i>
        </button>
      </div>

      {/* بطاقة التقييم الرئيسية */}
      <div 
        className="relative max-w-xl mx-auto px-2"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onTouchStart={() => setIsPaused(true)}
        onTouchEnd={() => setIsPaused(false)}
      >
        {/* بطاقة التقييم الرئيسية النشطة مع حواف راديوس 2px */}
        <div className="w-full bg-[#FCFCFC] rounded-[2px] border border-gray-200/80 px-4 py-2.5 sm:px-5 sm:py-3 relative shadow-xs transition-all" style={{ borderRadius: '2px' }}>
          <div
            className={`transition-all duration-200 ease-out ${
              fadeAnim ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
            }`}
          >
            {/* رأس البطاقة: صورة الحرف واسم العميل وتاريخ التقييم ونجوم التقييم */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                {/* صورة دائرية للمشتري مع خلفية بيضاء وأيقونة ثلاثية الأبعاد (3D Avatar) */}
                <div className="w-8 h-8 rounded-full bg-white border border-gray-200/60 flex items-center justify-center shrink-0 shadow-2xs overflow-hidden">
                  <img 
                    src={current.avatarUrl || (isFemale 
                      ? "https://cdn-icons-png.flaticon.com/512/4042/4042422.png" 
                      : "https://cdn-icons-png.flaticon.com/512/7084/7084424.png"
                    )} 
                    alt={current.name} 
                    className="w-full h-full rounded-full object-cover" 
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm font-bold text-gray-900 leading-none">
                      {current.name}
                    </span>
                    <span className="text-[10px] text-gray-400 leading-none">
                      • {current.date || 'طلب مؤكد'}
                    </span>
                  </div>
                </div>
              </div>

              {/* النجوم الذهبية والتقييم */}
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="flex text-amber-400 text-[11px] sm:text-xs gap-0.5">
                  {Array.from({ length: current.rating || 5 }).map((_, i) => (
                    <i key={i} className="fa-solid fa-star"></i>
                  ))}
                </div>
              </div>
            </div>

            {/* نص رأي العميل مع أيقونة الاقتباس بشكل مدمج */}
            <div className="mt-1.5 pt-1.5 flex items-start gap-2">
              <i className="fa-solid fa-quote-right text-amber-400/30 text-sm shrink-0 mt-0.5"></i>
              <p className="text-xs text-gray-700 leading-relaxed font-normal">
                {current.comment}
              </p>
            </div>
          </div>

          {/* أزرار التنقل السريع والمؤشرات السفلية مدمجة وقصيرة */}
          <div className="mt-2 pt-1.5 flex items-center justify-between">
            {/* مؤشرات النقاط لعدد التقييمات */}
            <div className="flex items-center gap-1">
              {reviews.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => goToReview(idx)}
                  className={`h-1 transition-all duration-300 cursor-pointer ${
                    idx === currentIndex
                      ? 'w-4 bg-[#004956]'
                      : 'w-1.5 bg-gray-200 hover:bg-gray-300'
                  }`}
                  title={`انتقال للتقييم ${idx + 1}`}
                  aria-label={`تقييم ${idx + 1}`}
                />
              ))}
            </div>

            {/* أزرار التالي والسابق دائرية */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrev}
                className="w-7 h-7 rounded-full bg-gray-50 hover:bg-gray-100 text-gray-600 flex items-center justify-center transition-colors cursor-pointer active:scale-95 text-[9px] shadow-2xs"
                title="التقييم السابق (يمين)"
                aria-label="التقييم السابق"
              >
                <i className="fa-solid fa-chevron-right"></i>
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="w-7 h-7 rounded-full bg-gray-50 hover:bg-gray-100 text-gray-600 flex items-center justify-center transition-colors cursor-pointer active:scale-95 text-[9px] shadow-2xs"
                title="التقييم التالي (يسار)"
                aria-label="التقييم التالي"
              >
                <i className="fa-solid fa-chevron-left"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* نافذة عرض جميع التقييمات تُرسم مباشرة على body وتظهر بالضبط في منتصف الشاشة */}
      {showAllModal && typeof document !== 'undefined' && createPortal(
        <div 
          onClick={closeAllModal}
          onWheel={(e) => {
            // منع تسريب السكرول من الخلفية إلى الموقع
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
          className={`fixed inset-0 z-9999 flex items-center justify-center p-4 transition-all duration-300 ease-out overscroll-contain select-none ${
            modalAnim ? 'bg-black/50 backdrop-blur-xs opacity-100' : 'bg-black/0 backdrop-blur-none opacity-0'
          }`}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh' }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className={`bg-white rounded-[2px] max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden transition-all duration-300 cubic-bezier(0.16, 1, 0.3, 1) transform select-text ${
              modalAnim 
                ? 'opacity-100 scale-100 translate-y-0' 
                : 'opacity-0 scale-90 translate-y-6'
            }`}
            style={{ borderRadius: '2px' }}
          >
            {/* رأس المودال */}
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-gray-900 text-sm sm:text-base">
                  {mainTitle}
                </h4>
                <span className="text-xs bg-amber-50 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                  {total} تقييم
                </span>
              </div>
              <button
                type="button"
                onClick={closeAllModal}
                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-transform hover:rotate-90 duration-200 cursor-pointer"
                title="إغلاق"
              >
                <i className="fa-solid fa-xmark text-xs"></i>
              </button>
            </div>

            {/* قائمة التقييمات محصورة السكرول بداخلها فقط */}
            <div className="p-4 overflow-y-auto space-y-3 divide-y divide-gray-100 overscroll-contain">
              {reviews.map((rev, idx) => {
                const female = isFemaleCustomer(rev.name, rev.gender);
                return (
                  <div key={idx} className={idx > 0 ? "pt-3" : ""}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 shadow-2xs overflow-hidden">
                          <img 
                            src={rev.avatarUrl || (female 
                              ? "https://cdn-icons-png.flaticon.com/512/4042/4042422.png" 
                              : "https://cdn-icons-png.flaticon.com/512/7084/7084424.png"
                            )} 
                            alt={rev.name} 
                            className="w-full h-full rounded-full object-cover" 
                          />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-gray-900">{rev.name}</div>
                          <div className="text-[10px] text-gray-400">{rev.date || 'طلب مؤكد'}</div>
                        </div>
                      </div>
                      <div className="flex text-amber-400 text-xs gap-0.5">
                        {Array.from({ length: rev.rating || 5 }).map((_, i) => (
                          <i key={i} className="fa-solid fa-star"></i>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-gray-700 mt-2 leading-relaxed">
                      {rev.comment}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
