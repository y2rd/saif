import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import hayDayPresetImages from './hayday_presets.json';
import { 
  syncStoreConfigToCloud, 
  syncProductsToCloud, 
  syncCategoriesToCloud,
  syncCouponsToCloud,
  syncTopupsToCloud,
  fetchTopupsFromCloud,
  subscribeToTopups,
  syncCustomerToCloud,
  deleteCustomerFromCloud,
  syncOrderToCloud,
  deleteOrderFromCloud,
  clearAllOrdersFromCloud
} from './firebase';

export default function AdminDashboard({
  storeConfig,
  setStoreConfig,
  products,
  setProducts,
  orders,
  setOrders,
  categories,
  setCategories,
  handleUploadPaymentQr,
  setActiveProductForPage,
  currentUser,
  setViewMode,
  initialTab,
  formatPrice: propFormatPrice,
  activeCurrency = 'USD',
  customers: propCustomers,
  setCustomers: propSetCustomers,
  setCurrentUser,
  topupRequests: propTopupRequests = [],
  setTopupRequests: propSetTopupRequests,
  sendNotification
}) {
  const formatPrice = propFormatPrice || ((price) => `$${Number(price || 0).toFixed(2)}`);
  const [activeTab, setActiveTab] = useState(initialTab || 'store-design'); // analytics, products, orders, customers, coupons, store-design, settings
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // حالات طلبات الشحن والإشعارات
  const [selectedTopupProof, setSelectedTopupProof] = useState(null);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastTarget, setBroadcastTarget] = useState('all');
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');

  // دعم السحب بالماوس واللمس (Drag-to-Scroll) لشريط التبويبات الأفقي
  const tabsBarRef = useRef(null);
  const isDraggingTabsRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragScrollLeftRef = useRef(0);
  const hasDraggedFarRef = useRef(false);

  const handleTabsMouseDown = (e) => {
    if (!tabsBarRef.current) return;
    isDraggingTabsRef.current = true;
    hasDraggedFarRef.current = false;
    dragStartXRef.current = e.pageX - tabsBarRef.current.offsetLeft;
    dragScrollLeftRef.current = tabsBarRef.current.scrollLeft;
  };

  const handleTabsMouseMove = (e) => {
    if (!isDraggingTabsRef.current || !tabsBarRef.current) return;
    e.preventDefault();
    const x = e.pageX - tabsBarRef.current.offsetLeft;
    const walk = (x - dragStartXRef.current) * 1.5; // سرعة السحب
    if (Math.abs(walk) > 5) {
      hasDraggedFarRef.current = true;
    }
    tabsBarRef.current.scrollLeft = dragScrollLeftRef.current - walk;
  };

  const handleTabsMouseUp = () => {
    isDraggingTabsRef.current = false;
  };

  // تمرير التبويب النشط تلقائياً إلى مجال الرؤية
  useEffect(() => {
    if (tabsBarRef.current) {
      const activeEl = tabsBarRef.current.querySelector('[data-active="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeTab]);


  // حالة المنتجات والفرز والتقسيم
  const [productSearch, setProductSearch] = useState('');
  const [productCatFilter, setProductCatFilter] = useState('الكل');
  const [productSortBy, setProductSortBy] = useState('default'); // default, price-asc, price-desc, stock-asc, stock-desc, name-asc
  const [productStockFilter, setProductStockFilter] = useState('all'); // all, in-stock, low-stock, out-of-stock
  const [groupByCategory, setGroupByCategory] = useState(true); // تقسيم حسب التصنيف
  const [editingProduct, setEditingProduct] = useState(null);
  const [showProductModal, setShowProductModal] = useState(false);
  const richTextEditorRef = useRef(null);
  // وضع تحرير الوصف: 'visual' (مرئي مباشر) أو 'code' (نصي مباشر بدون أي أخطاء)
  const [descEditorMode, setDescEditorMode] = useState('visual');
  // رسالة التوست (Toast) الخضراء العلوية
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 3500);
  };

  // مزامنة محتوى محرر النصوص المباشر (WYSIWYG) عند فتح نافذة المنتج أو تغيير المنتج
  useEffect(() => {
    if (showProductModal && descEditorMode === 'visual') {
      const timer = setTimeout(() => {
        if (richTextEditorRef.current) {
          if (richTextEditorRef.current.innerHTML !== (productForm.descriptionHtml || '')) {
            richTextEditorRef.current.innerHTML = productForm.descriptionHtml || '';
          }
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [showProductModal, editingProduct, descEditorMode]);

  // تنفيذ أوامر التنسيق المباشرة (عريض، مائل، محاذاة، قوائم، ألوان، إلخ) بأمان تام
  const execFormat = (command, value = null) => {
    try {
      if (descEditorMode !== 'visual') return;
      if (richTextEditorRef.current) {
        richTextEditorRef.current.focus();
        document.execCommand(command, false, value);
        const newHtml = richTextEditorRef.current.innerHTML;
        setProductForm(prev => ({ ...prev, descriptionHtml: newHtml }));
      }
    } catch (err) {
      console.warn('Command execution ignored:', err);
    }
  };

  // نموذج إضافة / تعديل منتج (رقمي أو سلعة مادية ملموسة مع باقات الكميات والأسعار)
  const initialProductForm = {
    title: '',
    category: categories.find(c => c.name !== 'الكل')?.name || 'عام',
    price: '',
    oldPrice: '',
    costPrice: '',
    stock: 20,
    badge: 'تسليم فوري',
    productType: 'license', // 'license' أو 'file' أو 'service' أو 'physical' أو 'exchange'
    downloadUrl: '',
    fileSize: '',
    licenseKeys: '',
    imageUrl: '',
    descriptionHtml: '',
    // حقول السلعة المادية
    weight: '0.5 kg',
    sku: '',
    // حقول المنتج حسب الطلب
    customFieldLabel: '',
    customFieldPlaceholder: '',
    customFieldNote: '',
    // حقول منتج المبادلة
    exchangeCurrencyName: '', // اسم العملة أو المادة المطلوبة (صكوك، قمح، كروت، إلخ)
    exchangeAmount: '',       // الكمية المطلوبة للمبادلة
    minQuantity: 1,           // الحد الأدنى لكمية العميل
    exchangeCustomFields: ['آيدي المزرعة'], // الخانات المخصصة التي يحددها المدير ويكتب العميل فيها
    customFields: [], // الحقول المخصصة العامة: [{id, label, required}] يضيفها المدير بنفسه لأي نوع منتج
    // خيارات وأسعار المنتج الإضافية
    hasQuantityTiers: false,
    quantityTiers: [
      { minQuantity: 1, label: '', price: '' }
    ],
    // العروض المؤقتة والعد التنازلي (Flash Sale)
    flashSaleEnabled: false,
    flashSalePrice: '',
    flashSaleEndsAt: ''
  };
  const [productForm, setProductForm] = useState(initialProductForm);

  // حالة الطلبات
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('الكل');
  const [selectedOrderDetails, setSelectedOrderDetails] = useState(null);

  // حالة المستخدمين / العملاء مع صلاحيات الإشراف والأدوار (مربوطة مع قاعدة البيانات السحابية والمتجر)
  const [internalCustomers, setInternalCustomers] = useState(() => {
    try {
      const saved = localStorage.getItem('haider_store_customers');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const customers = propCustomers !== undefined ? propCustomers : internalCustomers;
  const setCustomers = propSetCustomers || setInternalCustomers;
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerRoleFilter, setCustomerRoleFilter] = useState('all');
  const [customerStatusFilter, setCustomerStatusFilter] = useState('all');
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [selectedCustomerForView, setSelectedCustomerForView] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'customer',
    status: 'نشط',
    tier: 'bronze',
    balance: '',
    notes: '',
    permissions: {
      canManageOrders: false,
      canManageProducts: false,
      canViewReports: false,
      canManageCoupons: false
    }
  });

  // حالة نافذة شحن رصيد المحفظة للعميل
  const [walletModalCustomer, setWalletModalCustomer] = useState(null);
  const [walletAmountInput, setWalletAmountInput] = useState('');
  const [walletActionType, setWalletActionType] = useState('deposit'); // 'deposit' إضافة أو 'deduct' خصم أو 'set' تعيين
  const [walletNoteInput, setWalletNoteInput] = useState('');

  // حالة طلبات شحن المحفظة مع دعم التخزين المحلي والتحديث اليدوي الفوري
  const [internalTopups, setInternalTopups] = useState(() => {
    try {
      const saved = localStorage.getItem('haider_store_topups');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const topupRequests = (Array.isArray(propTopupRequests) && propTopupRequests.length > 0) ? propTopupRequests : internalTopups;
  const setTopupRequests = propSetTopupRequests || setInternalTopups;
  const [isRefreshingTopups, setIsRefreshingTopups] = useState(false);

  // اشتراك وتحقق آلي فوري متزامن لطلبات الشحن في الوقت الفعلي
  useEffect(() => {
    const unsubscribe = subscribeToTopups((cloudList) => {
      if (Array.isArray(cloudList)) {
        setInternalTopups(cloudList);
        if (propSetTopupRequests) {
          propSetTopupRequests(cloudList);
        }
        try {
          localStorage.setItem('haider_store_topups', JSON.stringify(cloudList));
        } catch {}
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [propSetTopupRequests]);

  const handleManualRefreshTopups = async () => {
    setIsRefreshingTopups(true);
    try {
      const cloudList = await fetchTopupsFromCloud();
      if (Array.isArray(cloudList)) {
        setInternalTopups(cloudList);
        if (setTopupRequests) setTopupRequests(cloudList);
        try {
          localStorage.setItem('haider_store_topups', JSON.stringify(cloudList));
        } catch {}
        showToast(`✅ تم التحقق والمزامنة الفورية (${cloudList.length} طلب)`);
      } else {
        showToast('تم فحص السحابة، لا توجد طلبات جديدة');
      }
    } catch (e) {
      showToast('تعذر جلب الطلبات من السحابة حالياً');
    } finally {
      setIsRefreshingTopups(false);
    }
  };

  // حالة الكوبونات والخصومات
  const [coupons, setCoupons] = useState(() => {
    try {
      const saved = localStorage.getItem('haider_store_coupons');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const [couponSearch, setCouponSearch] = useState('');
  const [couponFilterStatus, setCouponFilterStatus] = useState('all'); // all, active, expired, disabled
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponDiscount, setNewCouponDiscount] = useState('');
  const [newCouponLimit, setNewCouponLimit] = useState('100');
  const [newCouponExpiry, setNewCouponExpiry] = useState('2026-12-31');
  const [newCouponTargetType, setNewCouponTargetType] = useState('all'); // 'all', 'specific', 'excluded'
  const [newCouponProductIds, setNewCouponProductIds] = useState([]);
  const [newCouponMinOrder, setNewCouponMinOrder] = useState('');
  const [newCouponProductSearch, setNewCouponProductSearch] = useState('');
  const [showAddCouponModal, setShowAddCouponModal] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState(null);

  // حفظ بيانات العملاء والكوبونات محلياً
  useEffect(() => {
    try {
      localStorage.setItem('haider_store_customers', JSON.stringify(customers));
    } catch {}
  }, [customers]);

  useEffect(() => {
    try {
      localStorage.setItem('haider_store_coupons', JSON.stringify(coupons));
      syncCouponsToCloud(coupons);
    } catch {}
  }, [coupons]);

  // حالة الخطوط المخصصة المرفوعة
  const [customFonts, setCustomFonts] = useState(() => {
    try {
      const saved = localStorage.getItem('custom_store_fonts');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newFontName, setNewFontName] = useState('');
  const [newFontFileName, setNewFontFileName] = useState('');
  const [newFontDataUrl, setNewFontDataUrl] = useState('');
  const fontFileInputRef = useRef(null);

  // حقن الخطوط المرفوعة في المستند لتعمل مباشرة
  useEffect(() => {
    customFonts.forEach((f) => {
      const existingStyle = document.getElementById(`font-style-${f.id}`);
      if (!existingStyle && f.dataUrl) {
        const style = document.createElement('style');
        style.id = `font-style-${f.id}`;
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
  }, [customFonts]);

  // رفع ملف خط جديد (.ttf, .otf, .woff, .woff2)
  const handleUploadFontFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      alert('حجم ملف الخط كبير جداً! يرجى اختيار ملف خط أقل من 8 ميجابايت.');
      return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    let format = 'truetype';
    if (ext === 'woff') format = 'woff';
    else if (ext === 'woff2') format = 'woff2';
    else if (ext === 'otf') format = 'opentype';

    const reader = new FileReader();
    reader.onload = (loadEvt) => {
      setNewFontDataUrl(loadEvt.target.result);
      setNewFontFileName(file.name);
      if (!newFontName) {
        const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, ' ');
        setNewFontName(cleanName);
      }
    };
    reader.readAsDataURL(file);
  };

  // حفظ الخط الجديد المرفوع
  const handleSaveCustomFont = (e) => {
    e.preventDefault();
    if (!newFontName.trim() || !newFontDataUrl) {
      alert('يرجى تحديد اسم للخط ورفع ملف الخط بصيغة ttf أو otf أو woff!');
      return;
    }

    const fontId = `custom-font-${Date.now()}`;
    const newFontObj = {
      id: fontId,
      name: newFontName.trim(),
      fileName: newFontFileName,
      dataUrl: newFontDataUrl,
      desc: 'خط مخصص تم رفعه من جهازك',
      badge: 'خط مخصص',
      sample: 'أهلاً بك في متجرنا الرقمي 123'
    };

    const updatedFonts = [...customFonts, newFontObj];
    setCustomFonts(updatedFonts);
    try {
      localStorage.setItem('custom_store_fonts', JSON.stringify(updatedFonts));
    } catch (err) {
      console.warn('LocalStorage limit reached', err);
    }

    // تعيين الخط مباشرة للمتجر وحفظه سحابياً
    const updatedConfig = { ...storeConfig, fontFamily: newFontName.trim(), customFonts: updatedFonts };
    setStoreConfig(updatedConfig);
    syncStoreConfigToCloud(updatedConfig);

    // إعادة تعيين النموذج
    setNewFontName('');
    setNewFontFileName('');
    setNewFontDataUrl('');
    if (fontFileInputRef.current) fontFileInputRef.current.value = '';
    alert(`تم رفع وتطبيق الخط "${newFontObj.name}" بنجاح ومزامنته سحابياً!`);
  };

  // حذف خط مخصص مرفوع
  const handleDeleteCustomFont = (fontId, fontName) => {
    if (window.confirm(`هل أنت متأكد من حذف الخط "${fontName}"؟`)) {
      const updated = customFonts.filter(f => f.id !== fontId);
      setCustomFonts(updated);
      try {
        localStorage.setItem('custom_store_fonts', JSON.stringify(updated));
      } catch {}

      // إزالة ستايل الخط من المستند
      const st = document.getElementById(`font-style-${fontId}`);
      if (st) st.remove();

      // إذا كان الخط النشط محذوفاً، العودة للخط الافتراضي
      const updatedConfig = {
        ...storeConfig,
        customFonts: updated,
        ...(storeConfig.fontFamily === fontName ? { fontFamily: 'DIN Next LT Arabic' } : {})
      };
      setStoreConfig(updatedConfig);
      syncStoreConfigToCloud(updatedConfig);
    }
  };

  // الدالة المركزية لحفظ كافة إعدادات وتخصيصات المتجر وتثبيتها محلياً وسحابياً
  const [isSavingGlobalSettings, setIsSavingGlobalSettings] = useState(false);
  const handleSaveAllSettings = async () => {
    setIsSavingGlobalSettings(true);
    try {
      const now = Date.now();
      localStorage.setItem('haider_store_config', JSON.stringify(storeConfig));
      localStorage.setItem('haider_store_config_updatedAt', String(now));
      localStorage.setItem('haider_store_categories', JSON.stringify(categories));
      localStorage.setItem('haider_store_categories_updatedAt', String(now));
      
      syncStoreConfigToCloud(storeConfig);
      syncCategoriesToCloud(categories);
      syncCouponsToCloud(coupons);
      if (Array.isArray(topupRequests)) syncTopupsToCloud(topupRequests);

      showToast('✅ تم حفظ وتطبيق كافة إعدادات وتعديلات المتجر بنجاح!');
    } catch (err) {
      console.error('Error saving settings:', err);
      showToast('تم حفظ الإعدادات بنجاح في المتصفح!');
    } finally {
      setTimeout(() => setIsSavingGlobalSettings(false), 500);
    }
  };

  // نظام التراجع والتقدم (Undo / Redo) لتصميم وإعدادات المتجر
  const [configHistory, setConfigHistory] = useState(() => [JSON.parse(JSON.stringify(storeConfig))]);
  const [configHistoryIndex, setConfigHistoryIndex] = useState(0);
  const isHistoryActionRef = useRef(false);

  useEffect(() => {
    if (isHistoryActionRef.current) {
      isHistoryActionRef.current = false;
      return;
    }
    const currentSerialized = JSON.stringify(storeConfig);
    setConfigHistory(prev => {
      const lastItem = prev[configHistoryIndex];
      if (lastItem && JSON.stringify(lastItem) === currentSerialized) {
        return prev;
      }
      const newHistory = prev.slice(0, configHistoryIndex + 1);
      newHistory.push(JSON.parse(currentSerialized));
      // الحد الأقصى لسجل التراجع 30 خطوة
      if (newHistory.length > 30) newHistory.shift();
      return newHistory;
    });
    setConfigHistoryIndex(prev => {
      const newLen = Math.min(prev + 2, 30);
      return newLen - 1;
    });
  }, [storeConfig]);

  const handleUndoConfig = () => {
    if (configHistoryIndex > 0) {
      const targetIndex = configHistoryIndex - 1;
      const targetState = configHistory[targetIndex];
      if (targetState) {
        isHistoryActionRef.current = true;
        setConfigHistoryIndex(targetIndex);
        setStoreConfig(JSON.parse(JSON.stringify(targetState)));
        showToast('↩️ تم التراجع خطوة للخلف');
      }
    }
  };

  const handleRedoConfig = () => {
    if (configHistoryIndex < configHistory.length - 1) {
      const targetIndex = configHistoryIndex + 1;
      const targetState = configHistory[targetIndex];
      if (targetState) {
        isHistoryActionRef.current = true;
        setConfigHistoryIndex(targetIndex);
        setStoreConfig(JSON.parse(JSON.stringify(targetState)));
        showToast('↪️ تم التقدم خطوة للأمام');
      }
    }
  };

  // نموذج إضافة وتعديل الأقسام
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatParentId, setNewCatParentId] = useState(''); // معرف القسم الأب (أو فارغ للقسم الرئيسي)
  const [newCatImage, setNewCatImage] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('fa-solid fa-folder-tree');
  const [editingCatId, setEditingCatId] = useState(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatParentId, setEditCatParentId] = useState(''); // معرف القسم الأب عند التعديل
  const [editCatImage, setEditCatImage] = useState('');
  const [editCatIcon, setEditCatIcon] = useState('');
  const [hayDaySearch, setHayDaySearch] = useState('');
  const [analyticsTimeframe, setAnalyticsTimeframe] = useState('شهرياً'); // شهرياً, أسبوعياً, سنوياً
  const [analyticsHoverPoint, setAnalyticsHoverPoint] = useState(2); // default hovering March
  const [analyticsOrdersFilter, setAnalyticsOrdersFilter] = useState('الكل');

  // قائمة أيقونات جاهزة ومميزة من الموقع
  const categoryPresetIcons = [
    { label: 'قسم عام', icon: 'fa-solid fa-folder-tree' },
    { label: 'ألعاب ومزارع', icon: 'fa-solid fa-tractor' },
    { label: 'عملات وكوينز', icon: 'fa-solid fa-coins' },
    { label: 'جواهر وماسات', icon: 'fa-solid fa-gem' },
    { label: 'تراخيص وبرامج', icon: 'fa-solid fa-key' },
    { label: 'بطاقات شحن', icon: 'fa-solid fa-credit-card' },
    { label: 'حسابات واشتراكات', icon: 'fa-solid fa-user-check' },
    { label: 'أدوات ومعدات', icon: 'fa-solid fa-hammer' },
    { label: 'سلع مادية وشحن', icon: 'fa-solid fa-box' },
    { label: 'صاعقة وتسليم فوري', icon: 'fa-solid fa-bolt' },
    { label: 'خدمات ودعم', icon: 'fa-solid fa-headset' },
    { label: 'عروض وتخفيضات', icon: 'fa-solid fa-tags' },
    { label: 'درع وضمان', icon: 'fa-solid fa-shield-halved' },
    { label: 'تاج VIP', icon: 'fa-solid fa-crown' },
    { label: 'نجمة مميزة', icon: 'fa-solid fa-star' }
  ];


  // حسابات ومؤشرات الإحصائيات (Analytics KPIs)
  const totalRevenue = useMemo(() => {
    return orders
      .filter(o => o.status === 'مكتمل' || o.status === 'قيد المراجعة')
      .reduce((sum, o) => sum + (parseFloat(o.totalUsd) || 0), 0);
  }, [orders]);

  const completedOrdersCount = useMemo(() => {
    return orders.filter(o => o.status === 'مكتمل').length;
  }, [orders]);

  const pendingOrdersCount = useMemo(() => {
    return orders.filter(o => o.status === 'قيد المراجعة').length;
  }, [orders]);

  // حالات محرر وتخصيص صفحات المتجر بنمط سلة (Visual Page Builder)
  const [customizerViewport, setCustomizerViewport] = useState('desktop'); // 'desktop' أو 'mobile'
  const [customizerMobileTab, setCustomizerMobileTab] = useState('sections'); // 'sections' (العناصر) أو 'preview' (المعاينة)
  const [activeSectionEditId, setActiveSectionEditId] = useState(null);
  const [showAddSectionModal, setShowAddSectionModal] = useState(false);
  const [openSectionMenuId, setOpenSectionMenuId] = useState(null); // معرف العنصر الذي تفتح له قائمة الثلاث نقاط
  const [editingLayoutSection, setEditingLayoutSection] = useState(null); // العنصر المفتوح للتحرير الكامل والتخصيص
  const [newSectionCustomTitle, setNewSectionCustomTitle] = useState(''); // الاسم المخصص للعنصر الجديد قبل إضافته

  const totalStockCount = useMemo(() => {
    return products.reduce((sum, p) => sum + (parseInt(p.stock) || 0), 0);
  }, [products]);

  // إحصاءات المبيعات حسب وسيلة الدفع
  const paymentStats = useMemo(() => {
    const stats = {};
    orders.forEach(o => {
      const m = o.method || 'أخرى';
      stats[m] = (stats[m] || 0) + (parseFloat(o.totalUsd) || 0);
    });
    return stats;
  }, [orders]);

  // إحصائيات الأرباح والمبيعات بحسب وسائل الدفع المتاحة في المتجر
  const earningsBreakdown = useMemo(() => {
    let binance = 0;
    let zaincash = 0;
    let mastercard = 0;
    let other = 0;

    orders.forEach(o => {
      const amt = parseFloat(o.totalUsd) || 0;
      const m = (o.method || '').toLowerCase();
      if (m.includes('binance') || m.includes('بينانس')) {
        binance += amt;
      } else if (m.includes('zain') || m.includes('زين')) {
        zaincash += amt;
      } else if (m.includes('master') || m.includes('ماستر') || m.includes('بطاق') || m.includes('بنك') || m.includes('card')) {
        mastercard += amt;
      } else {
        other += amt;
      }
    });

    const total = (binance + zaincash + mastercard + other) || (totalRevenue || 1);
    return {
      binance: binance || (totalRevenue ? totalRevenue * 0.40 : 40),
      zaincash: zaincash || (totalRevenue ? totalRevenue * 0.35 : 35),
      mastercard: mastercard || (totalRevenue ? totalRevenue * 0.20 : 20),
      other: other || (totalRevenue ? totalRevenue * 0.05 : 5),
      total: totalRevenue || 100
    };
  }, [orders, totalRevenue]);

  // المنتجات الأكثر طلباً والأعلى مبيعاً (تعتمد حصرياً على الطلبات المؤكدة وغير الملغية)
  const topDemandedProducts = useMemo(() => {
    // حساب مرات طلب كل منتج من الطلبات الفعلية المؤكدة فقط
    const demandMap = {};
    orders.forEach(order => {
      // استبعاد الطلبات الملغية أو غير المؤكدة
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

    // دمج الإحصاءات مع بيانات المنتجات الفعلية (طلبات حقيقية فقط بدون أي أرقام عشوائية)
    return products
      .map(p => {
        const orderCount = demandMap[p.id] || demandMap[p.title] || 0;
        const revenue = (orderCount * (parseFloat(p.price) || 0)).toFixed(2);
        return {
          ...p,
          salesCount: orderCount,
          totalSalesRevenue: revenue
        };
      })
      .sort((a, b) => b.salesCount - a.salesCount)
      .slice(0, 6);
  }, [products, orders]);

  // فلترة وفرز المنتجات
  const filteredProducts = useMemo(() => {
    let result = products.filter(p => {
      // فلترة القسم (يشمل القسم نفسه أو الأقسام الفرعية التابعة له)
      if (productCatFilter !== 'الكل') {
        const filterCatObj = categories.find(c => c.name === productCatFilter);
        if (filterCatObj) {
          const childCatNames = categories.filter(c => c.parentId === filterCatObj.id).map(c => c.name);
          const allowedCats = [filterCatObj.name, ...childCatNames];
          if (!allowedCats.includes(p.category)) return false;
        } else if (p.category !== productCatFilter) {
          return false;
        }
      }
      // فلترة حالة المخزون
      if (productStockFilter === 'in-stock' && (parseInt(p.stock) || 0) <= 0) return false;
      if (productStockFilter === 'low-stock' && ((parseInt(p.stock) || 0) > 5 || (parseInt(p.stock) || 0) <= 0)) return false;
      if (productStockFilter === 'out-of-stock' && (parseInt(p.stock) || 0) > 0) return false;
      // بحث بالاسم أو الشارة
      if (productSearch.trim()) {
        const q = productSearch.toLowerCase();
        return p.title.toLowerCase().includes(q) || (p.badge && p.badge.toLowerCase().includes(q)) || (p.category && p.category.toLowerCase().includes(q));
      }
      return true;
    });

    // تطبيق خيارات الفرز
    return result.sort((a, b) => {
      if (productSortBy === 'price-asc') return (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
      if (productSortBy === 'price-desc') return (parseFloat(b.price) || 0) - (parseFloat(a.price) || 0);
      if (productSortBy === 'stock-asc') return (parseInt(a.stock) || 0) - (parseInt(b.stock) || 0);
      if (productSortBy === 'stock-desc') return (parseInt(b.stock) || 0) - (parseInt(a.stock) || 0);
      if (productSortBy === 'name-asc') return a.title.localeCompare(b.title, 'ar');
      return b.id - a.id;
    });
  }, [products, productCatFilter, productSearch, productSortBy, productStockFilter]);

  // تقسيم المنتجات حسب التصنيف
  const groupedProducts = useMemo(() => {
    const groups = {};
    filteredProducts.forEach(p => {
      const cat = p.category || 'أخرى';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });
    return groups;
  }, [filteredProducts]);

  // إغلاق النوافذ المنبثقة عند الضغط على زر Esc
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (selectedOrderDetails) setSelectedOrderDetails(null);
        if (showProductModal) setShowProductModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedOrderDetails, showProductModal]);

  // فلترة الطلبات
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (orderStatusFilter !== 'الكل' && o.status !== orderStatusFilter) return false;
      if (orderSearch.trim()) {
        const q = orderSearch.toLowerCase();
        return o.id.toLowerCase().includes(q) || o.customer.toLowerCase().includes(q) || (o.method && o.method.toLowerCase().includes(q));
      }
      return true;
    });
  }, [orders, orderStatusFilter, orderSearch]);

  // فلترة وإحصائيات المستخدمين
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      if (customerRoleFilter !== 'all' && c.role !== customerRoleFilter) return false;
      if (customerStatusFilter !== 'all' && c.status !== customerStatusFilter) return false;
      if (customerSearch.trim()) {
        const q = customerSearch.toLowerCase();
        return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.phone.includes(q) || (c.notes && c.notes.toLowerCase().includes(q));
      }
      return true;
    });
  }, [customers, customerSearch, customerRoleFilter, customerStatusFilter]);

  const customerStats = useMemo(() => {
    const total = customers.length;
    const admins = customers.filter(c => c.role === 'admin').length;
    const supervisors = customers.filter(c => c.role === 'supervisor').length;
    const regularCustomers = customers.filter(c => c.role === 'customer').length;
    const active = customers.filter(c => c.status === 'نشط').length;
    const blocked = customers.filter(c => c.status === 'محظور').length;
    const totalRevenueFromCustomers = customers.reduce((sum, c) => sum + (parseFloat(c.totalSpent || c.spent || 0)), 0);
    const totalWalletBalances = customers.reduce((sum, c) => sum + (parseFloat(c.balance) || 0), 0);
    return { total, admins, supervisors, regularCustomers, active, blocked, totalRevenueFromCustomers, totalWalletBalances };
  }, [customers]);

  // إحصائيات وفلترة الكوبونات
  const couponStats = useMemo(() => {
    const total = coupons.length;
    const active = coupons.filter(c => c.status === 'نشط').length;
    const totalUsages = coupons.reduce((sum, c) => sum + (c.usageCount || 0), 0);
    const targetingSpecific = coupons.filter(c => c.targetType === 'specific' || c.targetType === 'excluded').length;
    return { total, active, totalUsages, targetingSpecific };
  }, [coupons]);

  const filteredCoupons = useMemo(() => {
    return coupons.filter(c => {
      if (couponFilterStatus === 'active' && c.status !== 'نشط') return false;
      if (couponFilterStatus === 'expired' && c.status !== 'منتهي') return false;
      if (couponFilterStatus === 'disabled' && c.status !== 'معطل') return false;
      if (couponSearch.trim()) {
        const q = couponSearch.toLowerCase();
        return c.code.toLowerCase().includes(q);
      }
      return true;
    });
  }, [coupons, couponFilterStatus, couponSearch]);

  // فتح نافذة تحرير منتج
  const handleOpenEditProduct = (prod) => {
    setEditingProduct(prod);
    const desc = prod.descriptionHtml || '';
    setProductForm({
      title: prod.title || '',
      category: prod.category || categories[1]?.name || 'عام',
      price: prod.price ?? '',
      oldPrice: prod.oldPrice ?? '',
      costPrice: prod.costPrice ?? '',
      stock: prod.stock ?? 0,
      badge: prod.badge || '',
      productType: prod.productType || 'license',
      downloadUrl: prod.downloadUrl || '',
      fileSize: prod.fileSize || '',
      licenseKeys: Array.isArray(prod.licenseKeys) ? prod.licenseKeys.join('\n') : (prod.licenseKeys || ''),
      imageUrl: prod.imageUrl || '',
      descriptionHtml: desc,
      weight: prod.weight || '0.5 kg',
      sku: prod.sku || '',
      shippingFee: prod.shippingFee ?? 0,
      customFieldLabel: prod.customFieldLabel || '',
      customFieldPlaceholder: prod.customFieldPlaceholder || '',
      customFieldNote: prod.customFieldNote || '',
      exchangeCurrencyName: prod.exchangeCurrencyName || '',
      exchangeAmount: prod.exchangeAmount ?? '',
      minQuantity: prod.minQuantity !== undefined ? prod.minQuantity : 1,
      exchangeCustomFields: Array.isArray(prod.exchangeCustomFields) && prod.exchangeCustomFields.length > 0 
        ? prod.exchangeCustomFields 
        : ['آيدي المزرعة'],
      customFields: Array.isArray(prod.customFields) ? prod.customFields : [],
      hasQuantityTiers: prod.hasQuantityTiers || false,
      quantityTiers: prod.quantityTiers && prod.quantityTiers.length > 0 ? prod.quantityTiers : [
        { minQuantity: 1, label: '', price: prod.price || '' }
      ],
      flashSaleEnabled: prod.flashSaleEnabled || false,
      flashSalePrice: prod.flashSalePrice ?? '',
      flashSaleEndsAt: prod.flashSaleEndsAt || ''
    });
    setShowProductModal(true);
  };

  const handleOpenNewProduct = () => {
    setEditingProduct(null);
    setProductForm(initialProductForm);
    setShowProductModal(true);
  };

  // حفظ المنتج
  const handleSaveProductSubmit = (e) => {
    e.preventDefault();
    if (!productForm.title) {
      alert('يرجى كتابة عنوان المنتج على الأقل.');
      return;
    }
    if (productForm.productType !== 'exchange' && !productForm.price) {
      alert('يرجى كتابة سعر المنتج.');
      return;
    }
    if (productForm.productType === 'exchange' && !productForm.exchangeCurrencyName) {
      alert('يرجى تحديد أو كتابة اسم عملة/مادة المبادلة.');
      return;
    }

    const licenseKeysArray = productForm.licenseKeys
      ? productForm.licenseKeys.split('\n').map(k => k.trim()).filter(Boolean)
      : [];

    const computedStock = productForm.productType === 'license' && licenseKeysArray.length > 0
      ? licenseKeysArray.length
      : parseInt(productForm.stock) || 0;

    // تنظيف خيارات وأسعار المنتج
    const formattedTiers = productForm.hasQuantityTiers
      ? productForm.quantityTiers.filter(t => t.price && t.label && t.label.trim() !== '').map((t, idx) => ({
          minQuantity: parseInt(t.minQuantity) || (idx + 1),
          label: t.label.trim(),
          price: parseFloat(t.price)
        }))
      : [];

    const isEx = productForm.productType === 'exchange';
    const parsedPrice = isEx ? 0 : (parseFloat(productForm.price) || 0);
    const parsedMinQty = isEx ? Math.max(1, parseInt(productForm.minQuantity) || 1) : 1;
    const parsedExAmount = isEx ? (parseFloat(productForm.exchangeAmount) || 1) : '';

    if (editingProduct) {
      const updatedProduct = {
        ...editingProduct,
        ...productForm,
        price: parsedPrice,
        oldPrice: (!isEx && productForm.oldPrice) ? parseFloat(productForm.oldPrice) : null,
        costPrice: (!isEx && productForm.costPrice) ? parseFloat(productForm.costPrice) : null,
        stock: computedStock,
        licenseKeys: licenseKeysArray,
        hasQuantityTiers: isEx ? false : productForm.hasQuantityTiers,
        quantityTiers: isEx ? [] : formattedTiers,
        minQuantity: parsedMinQty,
        exchangeAmount: parsedExAmount
      };
      const newProds = products.map(p => p.id === editingProduct.id ? updatedProduct : p);
      const now = Date.now();
      try {
        localStorage.setItem('haider_store_products_updatedAt', String(now));
        localStorage.setItem('haider_store_products', JSON.stringify(newProds));
      } catch (e) {}
      setProducts(newProds);
      syncProductsToCloud(newProds);
      if (setActiveProductForPage) {
        setActiveProductForPage(prev => (prev && prev.id === editingProduct.id ? updatedProduct : prev));
      }
      showToast('تم تحديث وحفظ بيانات المنتج بنجاح');
    } else {
      const newProd = {
        id: Date.now(),
        ...productForm,
        price: parsedPrice,
        oldPrice: (!isEx && productForm.oldPrice) ? parseFloat(productForm.oldPrice) : null,
        costPrice: (!isEx && productForm.costPrice) ? parseFloat(productForm.costPrice) : null,
        stock: computedStock,
        licenseKeys: licenseKeysArray,
        hasQuantityTiers: isEx ? false : productForm.hasQuantityTiers,
        quantityTiers: isEx ? [] : formattedTiers,
        minQuantity: parsedMinQty,
        exchangeAmount: parsedExAmount,
        imageUrl: productForm.imageUrl || 'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=800&auto=format&fit=crop&q=80',
        reviews: []
      };
      const newProds = [newProd, ...products];
      const now = Date.now();
      try {
        localStorage.setItem('haider_store_products_updatedAt', String(now));
        localStorage.setItem('haider_store_products', JSON.stringify(newProds));
      } catch (e) {}
      setProducts(newProds);
      syncProductsToCloud(newProds);
      showToast('تمت إضافة المنتج الجديد بنجاح');
    }

    setShowProductModal(false);
  };

  // حذف منتج
  const handleDeleteProduct = (productId) => {
    if (window.confirm('هل أنت متأكد من رغبتك في حذف هذا المنتج؟')) {
      const updated = products.filter(p => p.id !== productId);
      const now = Date.now();
      try {
        localStorage.setItem('haider_store_products_updatedAt', String(now));
        localStorage.setItem('haider_store_products', JSON.stringify(updated));
      } catch (e) {}
      setProducts(updated);
      syncProductsToCloud(updated);
      showToast('تم حذف المنتج بنجاح');
    }
  };

  // تحديث حالة الطلب مع تسليم أكواد البطاقات الرقمية وخصم رصيد المحفظة تلقائياً عند تغيير الحالة إلى "مكتمل"
  const handleUpdateOrderStatus = (orderId, newStatus) => {
    let assignedKeys = [];
    const targetOrder = orders.find(o => o.id === orderId);
    let walletDeductedToast = '';

    if (newStatus === 'مكتمل' && targetOrder) {
      // 1. تسليم أكواد البطاقات الرقمية إن وجدت
      if (!targetOrder.fulfilledKeys || targetOrder.fulfilledKeys.length === 0) {
        if (Array.isArray(targetOrder.items) && targetOrder.items.length > 0) {
          let prodsCopy = [...products];
          let hasProductKeyChanges = false;

          targetOrder.items.forEach(item => {
            const prodIdx = prodsCopy.findIndex(p => p.id === item.productId || p.title === item.title);
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
        }
      }

      // 2. فحص رصيد محفظة العميل والخصم منها تلقائياً إذا لم يتم الخصم سابقاً
      if (!targetOrder.walletDeducted) {
        // البحث عن العميل المرتبط بالطلب
        const targetCust = customers.find(c =>
          (targetOrder.customerId && c.id === targetOrder.customerId) ||
          (targetOrder.customerIdentifier && (c.identifier === targetOrder.customerIdentifier || c.phone === targetOrder.customerIdentifier || c.email === targetOrder.customerIdentifier)) ||
          (targetOrder.customerPhone && (c.phone === targetOrder.customerPhone || c.identifier === targetOrder.customerPhone)) ||
          (targetOrder.customer && (
            c.name === targetOrder.customer ||
            c.name === (targetOrder.customer || '').replace(/\s*\([^)]*\)/g, '').trim()
          ))
        );

        if (targetCust) {
          const currentBal = parseFloat(targetCust.balance || 0);
          const orderCost = parseFloat(targetOrder.totalUsd || 0);

          if (currentBal >= orderCost && orderCost > 0) {
            const newBal = parseFloat((currentBal - orderCost).toFixed(2));
            const newTx = {
              id: `tx_${Date.now()}`,
              type: 'withdraw',
              amount: orderCost,
              balanceAfter: newBal,
              title: `دفع للطلب رقم #${targetOrder.id}`,
              date: new Date().toISOString()
            };

            const updatedCust = {
              ...targetCust,
              balance: newBal,
              walletTransactions: [newTx, ...(targetCust.walletTransactions || [])]
            };

            const updatedCustomersList = customers.map(c => c.id === targetCust.id ? updatedCust : c);
            setCustomers(updatedCustomersList);
            syncCustomerToCloud(updatedCust);
            try {
              localStorage.setItem('haider_store_customers', JSON.stringify(updatedCustomersList));
            } catch (e) {}

            // إذا كان هذا العميل مسجلاً دخول الآن كـ currentUser محلياً، نحدث رصيده فوراً
            try {
              const savedCur = localStorage.getItem('haider_current_user');
              if (savedCur) {
                const parsedCur = JSON.parse(savedCur);
                if (parsedCur && (parsedCur.id === updatedCust.id || parsedCur.identifier === updatedCust.identifier || parsedCur.phone === updatedCust.phone)) {
                  const mergedUser = { ...parsedCur, ...updatedCust };
                  localStorage.setItem('haider_current_user', JSON.stringify(mergedUser));
                  if (setCurrentUser) setCurrentUser(mergedUser);
                }
              }
            } catch (err) {}

            walletDeductedToast = ` وتم خصم ${orderCost} $ من محفظة العميل (المتبقي: ${newBal} $)`;
            targetOrder.walletDeducted = true;
            targetOrder.walletDeductedAmount = orderCost;
          } else if (orderCost > 0) {
            // رصيد المحفظة لا يكفي
            const shortage = (orderCost - currentBal).toFixed(2);
            targetOrder.walletWarning = `تنبيه: سعر طلب العميل (${orderCost} $) يتعدى رصيد المحفظة المتوفر (${currentBal} $). النقص: ${shortage} $`;
            alert(`⚠️ ملاحظة هامة للمدير:\nسعر طلب العميل (${orderCost} $) يتعدى رصيد المحفظة المتوفر (${currentBal} $).\nلم يتم خصم المبلغ لأن الرصيد لا يكفي.`);
          }
        }
      }

      // 3. منح نقاط المكافآت والولاء للعميل عند اكتمال الطلب (إذا لم يتم منحه سابقاً)
      const loyaltyCfg = storeConfig.loyaltyConfig || { enabled: true, spendUsdPerPoint: 10, pointsPerUsd: 10 };
      if (loyaltyCfg.enabled !== false && !targetOrder.loyaltyAwarded) {
        const targetCust = customers.find(c =>
          (targetOrder.customerId && c.id === targetOrder.customerId) ||
          (targetOrder.customerIdentifier && (c.identifier === targetOrder.customerIdentifier || c.phone === targetOrder.customerIdentifier || c.email === targetOrder.customerIdentifier)) ||
          (targetOrder.customerPhone && (c.phone === targetOrder.customerPhone || c.identifier === targetOrder.customerPhone)) ||
          (targetOrder.customer && (
            c.name === targetOrder.customer ||
            c.name === (targetOrder.customer || '').replace(/\s*\([^)]*\)/g, '').trim()
          ))
        );

        const spendPerPt = Math.max(0.1, parseFloat(loyaltyCfg.spendUsdPerPoint) || 10);
        const orderAmount = parseFloat(targetOrder.totalUsd || 0);
        const earnedPts = Math.floor(orderAmount / spendPerPt);

        if (targetCust && earnedPts > 0) {
          const newPts = (targetCust.points || 0) + earnedPts;
          const notif = {
            id: `notif-${Date.now()}`,
            title: `حصلت على ${earnedPts} نقطة ولاء! ⭐`,
            message: `تهانينا! لاكتمال طلبك رقم #${targetOrder.id}، تمت إضافة ${earnedPts} نقطة مكافأة لحسابك. مجموع نقاطك: ${newPts} نقطة.`,
            type: 'wallet',
            date: new Date().toISOString(),
            read: false
          };

          const updatedCust = {
            ...targetCust,
            points: newPts,
            notifications: [notif, ...(targetCust.notifications || [])]
          };

          const updatedCustomersList = customers.map(c => c.id === targetCust.id ? updatedCust : c);
          setCustomers(updatedCustomersList);
          syncCustomerToCloud(updatedCust);
          try {
            localStorage.setItem('haider_store_customers', JSON.stringify(updatedCustomersList));
            const savedCur = localStorage.getItem('haider_current_user');
            if (savedCur) {
              const parsedCur = JSON.parse(savedCur);
              if (parsedCur && (parsedCur.id === updatedCust.id || parsedCur.identifier === updatedCust.identifier || parsedCur.phone === updatedCust.phone)) {
                const mergedUser = { ...parsedCur, ...updatedCust };
                localStorage.setItem('haider_current_user', JSON.stringify(mergedUser));
                if (setCurrentUser) setCurrentUser(mergedUser);
              }
            }
          } catch (e) {}

          targetOrder.loyaltyAwarded = true;
          targetOrder.loyaltyAwardedPoints = earnedPts;
        }
      }
    }

    const updatedOrders = orders.map(o => {
      if (o.id === orderId) {
        return {
          ...o,
          status: newStatus,
          fulfilledKeys: assignedKeys.length > 0 ? assignedKeys : (o.fulfilledKeys || []),
          walletDeducted: targetOrder?.walletDeducted || o.walletDeducted || false,
          walletDeductedAmount: targetOrder?.walletDeductedAmount || o.walletDeductedAmount || 0,
          walletWarning: targetOrder?.walletWarning || o.walletWarning || null
        };
      }
      return o;
    });

    setOrders(updatedOrders);
    try {
      localStorage.setItem('haider_store_orders', JSON.stringify(updatedOrders));
    } catch (e) {}

    const modifiedOrder = updatedOrders.find(o => o.id === orderId);
    if (modifiedOrder) {
      syncOrderToCloud(modifiedOrder);
    }

    if (selectedOrderDetails && selectedOrderDetails.id === orderId) {
      setSelectedOrderDetails(prev => ({
        ...prev,
        status: newStatus,
        fulfilledKeys: assignedKeys.length > 0 ? assignedKeys : (prev.fulfilledKeys || []),
        walletDeducted: targetOrder?.walletDeducted || prev.walletDeducted || false,
        walletDeductedAmount: targetOrder?.walletDeductedAmount || prev.walletDeductedAmount || 0,
        walletWarning: targetOrder?.walletWarning || prev.walletWarning || null
      }));
    }

    if (newStatus === 'مكتمل' && assignedKeys.length > 0) {
      showToast(`تم إكمال الطلب وتسليم ${assignedKeys.length} كود بنجاح للعميل!${walletDeductedToast}`);
    } else {
      showToast(`تم تحديث حالة الطلب إلى "${newStatus}"${walletDeductedToast}`);
    }
  };

  // حذف طلب مفرد
  const handleDeleteOrder = (orderId) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الطلب نهائياً؟')) return;
    const updated = orders.filter(o => o.id !== orderId);
    setOrders(updated);
    try {
      localStorage.setItem('haider_store_orders', JSON.stringify(updated));
    } catch (e) {}
    deleteOrderFromCloud(orderId);
    if (selectedOrderDetails && selectedOrderDetails.id === orderId) {
      setSelectedOrderDetails(null);
    }
    showToast('تم حذف الطلب بنجاح');
  };

  // مسح جميع الطلبات
  const handleClearAllOrders = () => {
    if (orders.length === 0) return;
    if (!window.confirm('تحذير: هل أنت متأكد من رغبتك في حذف جميع الطلبات الحالية؟')) return;
    clearAllOrdersFromCloud(orders.map(o => o.id));
    setOrders([]);
    try {
      localStorage.setItem('haider_store_orders', JSON.stringify([]));
      localStorage.removeItem('haider_store_orders');
    } catch (e) {}
    setSelectedOrderDetails(null);
    showToast('تم حذف جميع الطلبات بنجاح');
  };

  // إضافة قسم جديد للمتجر
  const handleAddCategory = (e) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    const newCat = {
      id: `cat-${Date.now()}`,
      name: newCatName.trim(),
      parentId: newCatParentId || null,
      imageUrl: newCatImage.trim() || '',
      icon: newCatIcon || 'fa-solid fa-folder-tree'
    };
    const updatedCats = [...categories, newCat];
    setCategories(updatedCats);
    syncCategoriesToCloud(updatedCats);
    try { localStorage.setItem('haider_store_categories', JSON.stringify(updatedCats)); } catch (e) {}
    setNewCatName('');
    setNewCatParentId('');
    setNewCatImage('');
    setNewCatIcon('fa-solid fa-folder-tree');
    setShowAddCategoryModal(false);
    showToast('تمت إضافة القسم بنجاح');
  };

  const startEditCategory = (cat) => {
    setEditingCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatParentId(cat.parentId || '');
    setEditCatImage(cat.imageUrl || '');
    setEditCatIcon(cat.icon || 'fa-solid fa-folder-tree');
  };

  const handleUpdateCategory = (e) => {
    e.preventDefault();
    if (!editCatName.trim()) return;
    const updatedCats = categories.map(c => c.id === editingCatId ? {
      ...c,
      name: editCatName.trim(),
      parentId: editCatParentId || null,
      imageUrl: editCatImage.trim() || '',
      icon: editCatIcon || c.icon || 'fa-solid fa-folder-tree'
    } : c);
    setCategories(updatedCats);
    syncCategoriesToCloud(updatedCats);
    try { localStorage.setItem('haider_store_categories', JSON.stringify(updatedCats)); } catch (e) {}
    setEditingCatId(null);
    setEditCatParentId('');
    showToast('تم تحديث بيانات القسم بنجاح');
  };

  const handleDeleteCategory = (catId) => {
    if (categories.length <= 1) {
      alert('يجب الإبقاء على قسم واحد على الأقل في المتجر.');
      return;
    }
    const hasChildren = categories.some(c => c.parentId === catId);
    const confirmMsg = hasChildren 
      ? 'هذا القسم يحتوي على أقسام فرعية تابعة له. هل أنت متأكد من رغبتك في حذفه وتحويل الأقسام الفرعية لأقسام رئيسية؟'
      : 'هل أنت متأكد من رغبتك في حذف هذا القسم؟';
    if (window.confirm(confirmMsg)) {
      const updatedCats = categories
        .filter(c => c.id !== catId)
        .map(c => c.parentId === catId ? { ...c, parentId: null } : c);
      setCategories(updatedCats);
      syncCategoriesToCloud(updatedCats);
      try { localStorage.setItem('haider_store_categories', JSON.stringify(updatedCats)); } catch (e) {}
      showToast('تم حذف القسم بنجاح');
    }
  };

  // إعادة ترتيب الأقسام بالسحب والإفلات أو التحريك للأعلى والأسفل
  const handleMoveCategory = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = categories.findIndex(c => c.id === fromId);
    const toIdx = categories.findIndex(c => c.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const newCats = [...categories];
    const [movedCat] = newCats.splice(fromIdx, 1);
    newCats.splice(toIdx, 0, movedCat);

    setCategories(newCats);
    syncCategoriesToCloud(newCats);
    try { localStorage.setItem('haider_store_categories', JSON.stringify(newCats)); } catch (e) {}
    showToast('تم تحديث ترتيب الأقسام بنجاح');
  };

  const handleMoveCategoryUp = (catId) => {
    const idx = categories.findIndex(c => c.id === catId);
    if (idx <= 0) return;
    const targetCat = categories[idx];
    // إذا كان فرعياً نحركه مع الفرعيات التابعة لنفس الأب، وإذا كان رئيسياً مع الرئيسيات
    const prevIdx = categories.slice(0, idx).reduce((lastIdx, c, i) => {
      if ((targetCat.parentId && c.parentId === targetCat.parentId) || (!targetCat.parentId && !c.parentId)) {
        return i;
      }
      return lastIdx;
    }, -1);

    const swapIdx = prevIdx !== -1 ? prevIdx : idx - 1;
    const newCats = [...categories];
    const [moved] = newCats.splice(idx, 1);
    newCats.splice(swapIdx, 0, moved);

    setCategories(newCats);
    syncCategoriesToCloud(newCats);
    try { localStorage.setItem('haider_store_categories', JSON.stringify(newCats)); } catch (e) {}
    showToast(`تم تحريك قسم "${targetCat.name}" للأعلى وحفظ الترتيب سحابياً`);
  };

  const handleMoveCategoryDown = (catId) => {
    const idx = categories.findIndex(c => c.id === catId);
    if (idx === -1 || idx >= categories.length - 1) return;
    const targetCat = categories[idx];

    let nextIdx = -1;
    for (let i = idx + 1; i < categories.length; i++) {
      const c = categories[i];
      if ((targetCat.parentId && c.parentId === targetCat.parentId) || (!targetCat.parentId && !c.parentId)) {
        nextIdx = i;
        break;
      }
    }

    const swapIdx = nextIdx !== -1 ? nextIdx : idx + 1;
    const newCats = [...categories];
    const [moved] = newCats.splice(idx, 1);
    newCats.splice(swapIdx, 0, moved);

    setCategories(newCats);
    syncCategoriesToCloud(newCats);
    try { localStorage.setItem('haider_store_categories', JSON.stringify(newCats)); } catch (e) {}
    showToast(`تم تحريك قسم "${targetCat.name}" للأسفل وحفظ الترتيب سحابياً`);
  };

  // فتح نموذج تعديل الكوبون
  const handleOpenEditCoupon = (coupon) => {
    setEditingCoupon(coupon);
    setNewCouponCode(coupon.code);
    setNewCouponDiscount(coupon.discountPercent.toString());
    setNewCouponLimit(coupon.maxUsage ? coupon.maxUsage.toString() : '100');
    setNewCouponExpiry(coupon.expiryDate || '2026-12-31');
    setNewCouponTargetType(coupon.targetType || 'all');
    setNewCouponProductIds(coupon.selectedProductIds || []);
    setNewCouponMinOrder(coupon.minOrderAmount ? coupon.minOrderAmount.toString() : '');
    setNewCouponProductSearch('');
    setShowAddCouponModal(true);
  };

  // إضافة أو تحديث كوبون
  const handleAddCoupon = (e) => {
    e.preventDefault();
    if (!newCouponCode || !newCouponDiscount) return;
    if ((newCouponTargetType === 'specific' || newCouponTargetType === 'excluded') && newCouponProductIds.length === 0) {
      alert('يرجى تحديد منتج واحد على الأقل للنطاق المختار.');
      return;
    }

    if (editingCoupon) {
      const updatedCp = {
        ...editingCoupon,
        code: newCouponCode.toUpperCase().trim(),
        discountPercent: parseInt(newCouponDiscount),
        maxUsage: parseInt(newCouponLimit) || 100,
        expiryDate: newCouponExpiry,
        targetType: newCouponTargetType,
        selectedProductIds: newCouponTargetType === 'all' ? [] : [...newCouponProductIds],
        minOrderAmount: parseFloat(newCouponMinOrder) || 0
      };
      setCoupons(coupons.map(c => c.id === editingCoupon.id ? updatedCp : c));
      showToast('تم تحديث بيانات الكوبون بنجاح');
    } else {
      const newCp = {
        id: `CP-${Date.now()}`,
        code: newCouponCode.toUpperCase().trim(),
        discountPercent: parseInt(newCouponDiscount),
        usageCount: 0,
        maxUsage: parseInt(newCouponLimit) || 100,
        expiryDate: newCouponExpiry,
        status: 'نشط',
        targetType: newCouponTargetType, // 'all', 'specific', 'excluded'
        selectedProductIds: newCouponTargetType === 'all' ? [] : [...newCouponProductIds],
        minOrderAmount: parseFloat(newCouponMinOrder) || 0
      };
      setCoupons([newCp, ...coupons]);
      showToast('تم إنشاء كود الخصم بنجاح وبكافة تفاصيل التخصيص');
    }

    setEditingCoupon(null);
    setNewCouponCode('');
    setNewCouponDiscount('');
    setNewCouponLimit('100');
    setNewCouponExpiry('2026-12-31');
    setNewCouponTargetType('all');
    setNewCouponProductIds([]);
    setNewCouponMinOrder('');
    setShowAddCouponModal(false);
  };

  // تبديل حالة الكوبون
  const toggleCouponStatus = (couponId) => {
    setCoupons(coupons.map(c => c.id === couponId ? {
      ...c,
      status: c.status === 'نشط' ? 'معطل' : 'نشط'
    } : c));
  };

  // حذف الكوبون
  const handleDeleteCoupon = (couponId) => {
    if (window.confirm('هل أنت متأكد من رغبتك في حذف هذا الكوبون نهائياً؟')) {
      setCoupons(coupons.filter(c => c.id !== couponId));
    }
  };

  // تبديل اختيار منتج للكوبون
  const toggleCouponProductSelection = (productId) => {
    setNewCouponProductIds(prev => 
      prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId]
    );
  };

  // تبديل حالة المستخدم (حظر / تفعيل)
  const toggleCustomerStatus = (customerId) => {
    setCustomers(customers.map(c => c.id === customerId ? {
      ...c,
      status: c.status === 'نشط' ? 'محظور' : 'نشط'
    } : c));
  };

  // تغيير دور العميل / المشرف مباشرة
  const handleChangeCustomerRole = (customerId, newRole) => {
    setCustomers(customers.map(c => {
      if (c.id === customerId) {
        let updatedPerms = { ...c.permissions };
        if (newRole === 'admin') {
          updatedPerms = { canManageOrders: true, canManageProducts: true, canViewReports: true, canManageCoupons: true };
        } else if (newRole === 'supervisor') {
          updatedPerms = { canManageOrders: true, canManageProducts: false, canViewReports: true, canManageCoupons: true };
        } else {
          updatedPerms = { canManageOrders: false, canManageProducts: false, canViewReports: false, canManageCoupons: false };
        }
        return { ...c, role: newRole, permissions: updatedPerms };
      }
      return c;
    }));
  };

  // حفظ عميل أو مشرف جديد
  const handleSaveCustomer = (e) => {
    e.preventDefault();
    if (!newCustomerForm.name.trim()) {
      alert('يرجى كتابة اسم العميل أو المشرف.');
      return;
    }

    if (editingCustomer) {
      const updatedCust = {
        ...editingCustomer,
        name: newCustomerForm.name.trim(),
        email: newCustomerForm.email.trim(),
        phone: newCustomerForm.phone.trim(),
        role: newCustomerForm.role,
        status: newCustomerForm.status,
        tier: newCustomerForm.tier,
        balance: newCustomerForm.balance !== '' ? parseFloat(newCustomerForm.balance) || 0 : (editingCustomer.balance || 0),
        notes: newCustomerForm.notes.trim(),
        permissions: { ...newCustomerForm.permissions }
      };
      setCustomers(customers.map(c => c.id === editingCustomer.id ? updatedCust : c));
      syncCustomerToCloud(updatedCust);
      showToast('تم تحديث بيانات وصلاحيات الحساب بنجاح');
    } else {
      const initialBal = parseFloat(newCustomerForm.balance) || 0;
      const newCust = {
        id: `CUST-${Date.now().toString().slice(-4)}`,
        name: newCustomerForm.name.trim(),
        email: newCustomerForm.email.trim() || 'user@example.com',
        phone: newCustomerForm.phone.trim() || '07800000000',
        identifier: newCustomerForm.phone.trim() || newCustomerForm.email.trim(),
        role: newCustomerForm.role,
        ordersCount: 0,
        totalSpent: 0,
        balance: initialBal,
        walletTransactions: initialBal > 0 ? [{
          id: `tx_${Date.now()}`,
          type: 'deposit',
          amount: initialBal,
          title: 'رصيد افتتاحي من الإدارة',
          date: new Date().toISOString()
        }] : [],
        status: newCustomerForm.status,
        tier: newCustomerForm.tier,
        joinDate: new Date().toISOString().split('T')[0],
        notes: newCustomerForm.notes.trim(),
        permissions: { ...newCustomerForm.permissions }
      };
      setCustomers([newCust, ...customers]);
      syncCustomerToCloud(newCust);
      showToast('تمت إضافة الحساب الجديد مع الصلاحيات المحددة بنجاح');
    }

    setShowAddCustomerModal(false);
    setEditingCustomer(null);
    setNewCustomerForm({
      name: '',
      email: '',
      phone: '',
      role: 'customer',
      status: 'نشط',
      tier: 'bronze',
      balance: '',
      notes: '',
      permissions: { canManageOrders: false, canManageProducts: false, canViewReports: false, canManageCoupons: false }
    });
  };

  // شحن / تعديل رصيد المحفظة للعميل من لوحة التحكم
  const handleUpdateCustomerWallet = (e) => {
    e.preventDefault();
    if (!walletModalCustomer) return;
    const amountNum = parseFloat(walletAmountInput);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert('يرجى إدخال مبلغ صحيح أكبر من 0');
      return;
    }

    const currentBal = parseFloat(walletModalCustomer.balance) || 0;
    let newBal = currentBal;
    let txType = 'deposit';
    let txTitle = walletNoteInput.trim() || 'شحن رصيد من الإدارة';

    if (walletActionType === 'deposit') {
      newBal = currentBal + amountNum;
      txType = 'deposit';
      txTitle = walletNoteInput.trim() || `إيداع رصيد من الإدارة (+${amountNum})`;
    } else if (walletActionType === 'deduct') {
      if (amountNum > currentBal) {
        alert('المبلغ المطلوب خصمه أكبر من رصيد العميل الحالي!');
        return;
      }
      newBal = Math.max(0, currentBal - amountNum);
      txType = 'deduct';
      txTitle = walletNoteInput.trim() || `خصم رصيد من الإدارة (-${amountNum})`;
    } else if (walletActionType === 'set') {
      newBal = amountNum;
      txType = amountNum >= currentBal ? 'deposit' : 'deduct';
      txTitle = walletNoteInput.trim() || `تعديل الرصيد إلى (${amountNum})`;
    }

    const newTx = {
      id: `tx_${Date.now()}`,
      type: txType,
      amount: amountNum,
      balanceAfter: newBal,
      title: txTitle,
      date: new Date().toISOString()
    };

    const updatedCust = {
      ...walletModalCustomer,
      balance: newBal,
      walletTransactions: [newTx, ...(walletModalCustomer.walletTransactions || [])]
    };

    setCustomers(customers.map(c => c.id === walletModalCustomer.id ? updatedCust : c));
    syncCustomerToCloud(updatedCust);

    // إذا كان هذا العميل مسجلاً دخول الآن كـ currentUser محلياً، نحدث رصيده فوراً
    try {
      const savedCur = localStorage.getItem('haider_current_user');
      if (savedCur) {
        const parsedCur = JSON.parse(savedCur);
        if (parsedCur && (parsedCur.id === updatedCust.id || parsedCur.identifier === updatedCust.identifier || parsedCur.phone === updatedCust.phone)) {
          const mergedUser = { ...parsedCur, ...updatedCust };
          localStorage.setItem('haider_current_user', JSON.stringify(mergedUser));
          if (setCurrentUser) setCurrentUser(mergedUser);
        }
      }
    } catch (err) {}

    if (selectedCustomerForView?.id === walletModalCustomer.id) {
      setSelectedCustomerForView(updatedCust);
    }

    setWalletModalCustomer(null);
    setWalletAmountInput('');
    setWalletNoteInput('');
    showToast(`✅ تم تحديث رصيد ${updatedCust.name} بنجاح: ${newBal} ${activeCurrency === 'IQD' ? 'د.ع' : '$'}`);
  };

  // الموافقة على طلب شحن المحفظة
  const handleApproveTopup = (topup) => {
    if (!window.confirm(`هل أنت متأكد من الموافقة على شحن $${topup.amountUsd} لمحفظة ${topup.customerName}؟`)) return;

    const targetCust = customers.find(c =>
      (topup.customerId && c.id === topup.customerId) ||
      (topup.customerIdentifier && (c.identifier === topup.customerIdentifier || c.phone === topup.customerIdentifier || c.email === topup.customerIdentifier)) ||
      c.name === topup.customerName
    );

    if (targetCust) {
      const currentBal = parseFloat(targetCust.balance || 0);
      const newBal = parseFloat((currentBal + parseFloat(topup.amountUsd)).toFixed(2));
      const newTx = {
        id: `tx_${Date.now()}`,
        type: 'deposit',
        amount: parseFloat(topup.amountUsd),
        balanceAfter: newBal,
        title: `شحن محفظة - طلب رقم #${topup.id}`,
        date: new Date().toISOString()
      };

      const notif = {
        id: `notif-${Date.now()}`,
        title: 'تم شحن رصيد المحفظة بنجاح 🎉',
        message: `تمت الموافقة على طلبك رقم #${topup.id} وإيداع $${topup.amountUsd} في محفظتك. رصيدك الحالي: $${newBal}.`,
        type: 'wallet',
        date: new Date().toISOString(),
        read: false
      };

      const updatedCust = {
        ...targetCust,
        balance: newBal,
        walletTransactions: [newTx, ...(targetCust.walletTransactions || [])],
        notifications: [notif, ...(targetCust.notifications || [])]
      };

      const updatedCusts = customers.map(c => c.id === targetCust.id ? updatedCust : c);
      setCustomers(updatedCusts);
      syncCustomerToCloud(updatedCust);
      try {
        localStorage.setItem('haider_store_customers', JSON.stringify(updatedCusts));
      } catch (e) {}

      try {
        const savedCur = localStorage.getItem('haider_current_user');
        if (savedCur) {
          const parsed = JSON.parse(savedCur);
          if (parsed && (parsed.id === updatedCust.id || parsed.identifier === updatedCust.identifier)) {
            const merged = { ...parsed, ...updatedCust };
            localStorage.setItem('haider_current_user', JSON.stringify(merged));
            if (setCurrentUser) setCurrentUser(merged);
          }
        }
      } catch (e) {}
    }

    if (setTopupRequests) {
      setTopupRequests(prev => {
        const updated = prev.map(t => t.id === topup.id ? { ...t, status: 'مقبول' } : t);
        syncTopupsToCloud(updated);
        return updated;
      });
    }
    showToast(`✅ تمت الموافقة على شحن المحفظة وإيداع $${topup.amountUsd} بنجاح!`);
  };

  // رفض طلب شحن المحفظة
  const handleRejectTopup = (topup) => {
    const reason = window.prompt('يرجى كتابة سبب رفض طلب الشحن:', 'بيانات التحويل غير مطابقة أو لم يصل المبلغ');
    if (reason === null) return;

    if (setTopupRequests) {
      setTopupRequests(prev => {
        const updated = prev.map(t => t.id === topup.id ? { ...t, status: 'مرفوض', rejectReason: reason } : t);
        syncTopupsToCloud(updated);
        return updated;
      });
    }

    const notif = {
      id: `notif-${Date.now()}`,
      title: `رفض طلب شحن المحفظة #${topup.id}`,
      message: `تم رفض طلب الشحن الخاص بك. السبب: ${reason || 'بيانات غير مطابقة'}.`,
      type: 'wallet',
      date: new Date().toISOString(),
      read: false
    };

    if (sendNotification) {
      sendNotification(topup.customerId || topup.customerIdentifier, notif);
    } else {
      const targetCust = customers.find(c => c.id === topup.customerId || c.identifier === topup.customerIdentifier || c.name === topup.customerName);
      if (targetCust) {
        const updatedCust = {
          ...targetCust,
          notifications: [notif, ...(targetCust.notifications || [])]
        };
        const updatedCusts = customers.map(c => c.id === targetCust.id ? updatedCust : c);
        setCustomers(updatedCusts);
        syncCustomerToCloud(updatedCust);
      }
    }
    showToast('تم رفض طلب الشحن وإشعار العميل بالسبب.');
  };

  // إرسال إشعار عام للعملاء
  const handleSendBroadcastNotification = (e) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) {
      alert('يرجى كتابة عنوان ونص الإشعار.');
      return;
    }

    const notif = {
      id: `notif-${Date.now()}`,
      title: broadcastTitle.trim(),
      message: broadcastMessage.trim(),
      type: 'promo',
      date: new Date().toISOString(),
      read: false
    };

    if (broadcastTarget === 'all') {
      const updated = customers.map(c => ({
        ...c,
        notifications: [notif, ...(c.notifications || [])]
      }));
      setCustomers(updated);
      try {
        localStorage.setItem('haider_store_customers', JSON.stringify(updated));
      } catch (e) {}
      if (sendNotification) {
        sendNotification('all', notif);
      }
      showToast('📢 تم إرسال الإشعار لجميع العملاء بنجاح!');
    } else {
      const updated = customers.map(c => c.id === broadcastTarget ? ({
        ...c,
        notifications: [notif, ...(c.notifications || [])]
      }) : c);
      setCustomers(updated);
      const targetC = customers.find(c => c.id === broadcastTarget);
      if (targetC) syncCustomerToCloud({ ...targetC, notifications: [notif, ...(targetC.notifications || [])] });
      try {
        localStorage.setItem('haider_store_customers', JSON.stringify(updated));
      } catch (e) {}
      if (sendNotification) {
        sendNotification(broadcastTarget, notif);
      }
      showToast('📢 تم إرسال الإشعار للعميل المحدد بنجاح!');
    }

    setShowBroadcastModal(false);
    setBroadcastTitle('');
    setBroadcastMessage('');
  };

  // حذف عميل أو حساب
  const handleDeleteCustomer = (customerId) => {
    if (window.confirm('هل أنت متأكد من رغبتك في حذف هذا الحساب نهائياً من قاعدة البيانات؟')) {
      setCustomers(customers.filter(c => c.id !== customerId));
      deleteCustomerFromCloud(customerId);
      if (selectedCustomerForView?.id === customerId) {
        setSelectedCustomerForView(null);
      }
    }
  };

  // فتح نافذة التعديل
  const openEditCustomerModal = (customer) => {
    setEditingCustomer(customer);
    setNewCustomerForm({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      role: customer.role || 'customer',
      status: customer.status || 'نشط',
      tier: customer.tier || 'bronze',
      balance: customer.balance !== undefined ? String(customer.balance) : '',
      notes: customer.notes || '',
      permissions: customer.permissions || {
        canManageOrders: customer.role === 'admin' || customer.role === 'supervisor',
        canManageProducts: customer.role === 'admin',
        canViewReports: customer.role === 'admin' || customer.role === 'supervisor',
        canManageCoupons: customer.role === 'admin' || customer.role === 'supervisor'
      }
    });
    setShowAddCustomerModal(true);
  };

  // تصدير البيانات كـ CSV
  const exportDataCSV = (type) => {
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    if (type === 'orders') {
      csvContent += "رقم الطلب,العميل,المبلغ,طريقة الدفع,الحالة,التاريخ\n";
      orders.forEach(o => {
        csvContent += `"${o.id}","${o.customer}","${o.totalFormatted || o.totalUsd}","${o.method}","${o.status}","${o.date}"\n`;
      });
    } else if (type === 'products') {
      csvContent += "المعرف,الاسم,القسم,السعر,المخزون,النوع\n";
      products.forEach(p => {
        csvContent += `"${p.id}","${p.title}","${p.category}","${p.price}","${p.stock}","${p.productType || 'رقمي'}"\n`;
      });
    } else if (type === 'customers') {
      csvContent += "المعرف,الاسم,البريد,الهاتف,الدور,الرتبة,الطلبات,المصروفات,الحالة,تاريخ الانضمام\n";
      customers.forEach(c => {
        csvContent += `"${c.id}","${c.name}","${c.email}","${c.phone}","${c.role === 'admin' ? 'مدير عام' : c.role === 'supervisor' ? 'مشرف متجر' : 'عميل'}","${c.tier || 'عادي'}","${c.ordersCount}","${c.totalSpent}","${c.status}","${c.joinDate}"\n`;
      });
    }
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${type}_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // تصدير نسخة احتياطية كاملة من المتجر
  const handleExportFullBackup = () => {
    const backupData = {
      storeConfig,
      products,
      categories,
      orders,
      exportedAt: new Date().toISOString(),
      version: '1.0'
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `haider_store_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('تم تصدير وتحميل ملف النسخة الاحتياطية بنجاح');
  };

  // استيراد نسخة احتياطية للمتجر
  const handleImportFullBackup = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (!data || typeof data !== 'object') throw new Error('الملف غير صالح');
        
        const now = Date.now();
        if (Array.isArray(data.products) && data.products.length > 0) {
          setProducts(data.products);
          localStorage.setItem('haider_store_products', JSON.stringify(data.products));
          localStorage.setItem('haider_store_products_updatedAt', String(now));
          syncProductsToCloud(data.products);
        }
        if (Array.isArray(data.categories) && data.categories.length > 0) {
          setCategories(data.categories);
          localStorage.setItem('haider_store_categories', JSON.stringify(data.categories));
          localStorage.setItem('haider_store_categories_updatedAt', String(now));
          syncCategoriesToCloud(data.categories);
        }
        if (data.storeConfig && typeof data.storeConfig === 'object') {
          setStoreConfig(data.storeConfig);
          localStorage.setItem('haider_store_config', JSON.stringify(data.storeConfig));
          localStorage.setItem('haider_store_config_updatedAt', String(now));
          syncStoreConfigToCloud(data.storeConfig);
        }
        if (Array.isArray(data.orders)) {
          setOrders(data.orders);
          localStorage.setItem('haider_store_orders', JSON.stringify(data.orders));
        }
        showToast('تم استيراد وتطبيق وتثبيت كافة بيانات المتجر بنجاح!');
      } catch (err) {
        alert('حدث خطأ أثناء قراءة ملف النسخة الاحتياطية: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // نسخ كود البيانات لدمجه في الكود مباشرة
  const handleCopyStoreJSON = () => {
    const backupData = {
      products,
      categories,
      storeConfig
    };
    navigator.clipboard.writeText(JSON.stringify(backupData, null, 2));
    showToast('تم نسخ كود البيانات إلى الحافظة بنجاح!');
  };

  // رفع واختبار المزامنة السحابية مع فحص الصلاحيات
  const [cloudSyncStatus, setCloudSyncStatus] = useState(null);
  const handleForceCloudSync = async () => {
    setCloudSyncStatus('syncing');
    showToast('جاري رفع ومزامنة البيانات مع السحابة...');
    try {
      const pRes = syncProductsToCloud(products);
      const cRes = syncCategoriesToCloud(categories);
      const cfgRes = syncStoreConfigToCloud(storeConfig);
      await Promise.all([pRes, cRes, cfgRes]);
      setCloudSyncStatus('success');
      showToast('✅ تم إرسال ومزامنة البيانات مع السحابة بنجاح!');
    } catch (err) {
      setCloudSyncStatus('error');
      alert('تعذر إتمام المزامنة السحابية: ' + (err.message || err));
    }
  };

  // التحقق الأمني: منع أي مستخدم ليس مديراً (role !== 'admin') من رؤية أو استخدام لوحة التحكم
  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6" dir="rtl">
        <div className="max-w-md w-full bg-white rounded-3xl border border-gray-200 shadow-xl p-8 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-red-50 text-red-500 flex items-center justify-center text-3xl shadow-2xs">
            <i className="fa-solid fa-lock"></i>
          </div>
          <h2 className="text-lg font-bold text-gray-900">منطقة محظورة - مخصصة للإدارة فقط</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            عذراً، هذا القسم مخصص لمدير المتجر فقط. حسابك الحالي مسجل برتبة 
            <span className="font-bold text-gray-800 mx-1">({currentUser ? 'عميل' : 'زائر غير مسجل'})</span> 
            ولا تملك الصلاحيات الكافية للوصول إلى لوحة التحكم.
          </p>
          <button
            type="button"
            onClick={() => setViewMode('store')}
            className="w-full py-2.5 px-4 bg-[#004956] hover:bg-[#00343D] text-white text-xs font-bold rounded-xl shadow-xs transition active:scale-95 cursor-pointer flex items-center justify-center gap-2"
          >
            <i className="fa-solid fa-store text-xs"></i>
            <span>العودة إلى المتجر</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="admin-dashboard-container flex flex-col md:flex-row min-h-[calc(100vh-65px)] bg-white relative font-normal"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)'
      }}
    >
      {/* إشعار التوست الأخضر أعلى يسار الصفحة ثابت في شاشة العرض (Viewport) عبر createPortal ولا يتأثر بأي سكرول أو حاوية */}
      {typeof document !== 'undefined' && toastMessage && createPortal(
        <div 
          style={{ 
            position: 'fixed', 
            top: '20px', 
            left: '20px', 
            zIndex: 2147483647,
            direction: 'rtl'
          }}
          className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded-lg shadow-2xl border border-emerald-400/40 pointer-events-auto"
        >
          <i className="fa-solid fa-check text-[11px] text-white shrink-0 font-normal"></i>
          <span className="text-xs font-light tracking-normal text-white">{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-white/70 hover:text-white mr-1 text-[10px] cursor-pointer p-0.5 leading-none transition"
            title="إغلاق"
          >
            ✕
          </button>
        </div>,
        document.body
      )}

      {/* شريط الجوال المتجاوب: زر فتح الأقسام في اليمين بخلفية بيضاء وبدون حدود */}
      <div className="md:hidden bg-white px-2 py-1.5 flex items-center justify-between sticky top-[53px] z-20 border-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="p-1 px-2.5 text-white bg-[#004956] hover:bg-[#00343D] rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition shadow-2xs active:scale-95 border-0"
            title="فتح قائمة الأقسام الجانبية"
          >
            <i className="fa-solid fa-bars text-xs"></i>
            <span className="leading-none">الأقسام</span>
          </button>
          
          <span className="text-xs font-bold text-gray-800 leading-none">
            {activeTab === 'analytics' && 'المؤشرات والتحليلات'}
            {activeTab === 'orders' && 'إدارة الطلبات'}
            {activeTab === 'products' && 'كتالوج المنتجات'}
            {activeTab === 'categories' && 'أقسام المتجر'}
            {activeTab === 'customers' && 'قاعدة العملاء'}
            {activeTab === 'coupons' && 'كوبونات الخصم'}
            {activeTab === 'store-design' && 'تصميم المتجر'}
            {activeTab === 'announcements' && 'أشرطة الإعلانات'}
            {activeTab === 'fonts' && 'مظهر المتجر والخطوط'}
            {activeTab === 'features' && 'المميزات السريعة'}
            {activeTab === 'loyalty' && 'برنامج الولاء والمكافآت'}
            {activeTab === 'payments' && 'وسائل الدفع والباركود'}
            {activeTab === 'cloud-backup' && 'النسخ الاحتياطي والسحابة'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 text-[10px] text-gray-600 bg-gray-50 px-2 py-0.5 rounded-md font-medium border-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="leading-none">لوحة الإدارة</span>
          </div>
        </div>
      </div>

      {/* شريط تبويبات أفقي سريع موحد بخلفية بيضاء وبدون حدود مع خط 14px */}
      <div 
        ref={tabsBarRef}
        onMouseDown={handleTabsMouseDown}
        onMouseMove={handleTabsMouseMove}
        onMouseUp={handleTabsMouseUp}
        onMouseLeave={handleTabsMouseUp}
        className="md:hidden bg-white px-2 py-1.5 overflow-x-auto flex items-center gap-1.5 scrollbar-none sticky top-[95px] z-10 select-none cursor-grab active:cursor-grabbing touch-pan-x border-0 shadow-xs"
        style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'smooth' }}
      >
        {[
          { id: 'analytics', label: 'المؤشرات', icon: 'fa-chart-line' },
          { id: 'orders', label: 'الطلبات', icon: 'fa-bag-shopping', badge: pendingOrdersCount },
          { id: 'products', label: 'المنتجات', icon: 'fa-boxes-stacked' },
          { id: 'categories', label: 'الأقسام', icon: 'fa-folder-tree' },
          { id: 'customers', label: 'العملاء', icon: 'fa-users' },
          { id: 'coupons', label: 'الكوبونات', icon: 'fa-tags' },
          { id: 'store-design', label: 'تصميم المتجر', icon: 'fa-brush', badge: 'جديد' },
          { id: 'announcements', label: 'الإعلانات', icon: 'fa-bullhorn' },
          { id: 'fonts', label: 'المظهر', icon: 'fa-palette' },
          { id: 'features', label: 'المميزات السريعة', icon: 'fa-bolt' },
          { id: 'loyalty', label: 'الولاء والمكافآت', icon: 'fa-gift' },
          { id: 'payments', label: 'الدفع', icon: 'fa-credit-card' },
          { id: 'cloud-backup', label: 'النسخ والسحابة', icon: 'fa-cloud-arrow-up' }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            data-active={activeTab === tab.id}
            onClick={() => {
              if (hasDraggedFarRef.current) return;
              setActiveTab(tab.id);
              setMobileMenuOpen(false);
            }}
            className={`admin-nav-tab-btn px-3 py-1.5 rounded-lg text-[14px] whitespace-nowrap flex items-center gap-1.5 transition cursor-pointer shrink-0 border-0 ${
              activeTab === tab.id 
                ? 'bg-white text-gray-950 font-bold shadow-xs' 
                : 'bg-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <i className={`fa-solid ${tab.icon} text-xs`}></i>
            <span className="leading-none">{tab.label}</span>
            {tab.badge > 0 && (
              <span className="bg-amber-500 text-white rounded-full px-1.5 py-0.2 text-[9px] font-bold leading-none">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

            {/* ========================================================= */}
        {/* قسم النسخ الاحتياطي والمزامنة السحابية (حل مشكلة الرفع للاستضافة) */}
        {/* ========================================================= */}
        {activeTab === 'cloud-backup' && (
          <div className="max-w-4xl mx-auto space-y-5">
            <div>
              <h2 className="text-lg font-bold text-black flex items-center gap-2">
                <i className="fa-solid fa-cloud-arrow-up text-[#004956] text-lg"></i>
                <span>النسخ الاحتياطي والمزامنة السحابية (بيانات المتجر والاستضافة)</span>
              </h2>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                حل مشكلة نقل المنتجات والأقسام وإعدادات المتجر من جهازك المحلي إلى المتجر المرفوع على أي منصة استضافة (Vercel, Netlify, GitHub, Hostinger)
              </p>
            </div>

            {/* تنبيه وشرح سبب ظهور المنتجات الافتراضية */}
            <div className="p-4 bg-sky-50 border border-sky-200 rounded-2xl space-y-2">
              <div className="flex items-center gap-2 text-sky-950 font-bold text-xs">
                <i className="fa-solid fa-circle-info text-sky-600 text-sm"></i>
                <span>لماذا تظهر منتجات افتراضية عند رفع المتجر على استضافة جديدة؟</span>
              </div>
              <p className="text-xs text-sky-900 leading-relaxed font-normal">
                المنتجات والأقسام التي تعدلها حالياً على جهازك محفوظة في <strong>الذاكرة المحلية لمتصفحك (localStorage)</strong>. عندما يزور شخص ما رابط المتجر المرفوع لأول مرة، يكون متصفحه فارغاً فيقوم المتجر بعرض البيانات الافتراضية ما لم يتم جلبها من السحابة أو استيرادها. اختر أحد الحلول السريعة أدناه:
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* الحل 1: تصدير واستيراد ملف JSON (أسهل وأسرع حل بدون إعدادات) */}
              <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 space-y-3.5 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                    <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center text-xs font-bold">1</span>
                    <h3 className="text-xs font-bold text-gray-900">تصدير واستيراد ملف النسخة الاحتياطية (JSON)</h3>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                    اضغط زر "تحميل ملف النسخة" لتحميل كافة منتجاتك وأقسامك في ملف، ثم افتح لوحة التحكم في الرابط المرفوع واضغط "استيراد ملف" لتظهر فوراً!
                  </p>
                </div>

                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={handleExportFullBackup}
                    className="w-full py-2.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-98"
                  >
                    <i className="fa-solid fa-download text-xs"></i>
                    <span>تحميل ملف النسخة الاحتياطية (Export JSON)</span>
                  </button>

                  <label className="w-full py-2.5 px-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-800 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer active:scale-98">
                    <i className="fa-solid fa-upload text-xs text-gray-600"></i>
                    <span>استيراد وتطبيق ملف النسخة (Import JSON)</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleImportFullBackup}
                    />
                  </label>
                </div>
              </div>

              {/* الحل 2: المزامنة السحابية المباشرة (Firebase Firestore) */}
              <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 space-y-3.5 shadow-2xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
                    <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center text-xs font-bold">2</span>
                    <h3 className="text-xs font-bold text-gray-900">المزامنة السحابية المباشرة (Firebase Firestore)</h3>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                    رفع البيانات إلى السحابة فوراً لتكون مركزية وتظهر تلقائياً لأي زائر يدخل المتجر من أي هاتف أو كمبيوتر في العالم بدون الحاجة لاستيراد يدوي.
                  </p>
                </div>

                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={handleForceCloudSync}
                    className="w-full py-2.5 px-3 bg-[#004956] hover:bg-[#00343D] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-98"
                  >
                    <i className={`fa-solid ${cloudSyncStatus === 'syncing' ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'} text-xs`}></i>
                    <span>رفع ومزامنة كافة البيانات مع السحابة الآن</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyStoreJSON}
                    className="w-full py-2 px-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 rounded-xl text-xs font-medium transition flex items-center justify-center gap-1.5 cursor-pointer"
                    title="نسخ كود JSON بالكامل"
                  >
                    <i className="fa-regular fa-copy text-xs"></i>
                    <span>نسخ كود المنتجات والأقسام (لجعله افتراضياً بالكود)</span>
                  </button>
                </div>
              </div>

            </div>

            {/* دليل وتأكيد قواعد فايربيس (Firebase Firestore Rules) */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 space-y-3 shadow-2xs">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-shield-halved text-[#004956] text-sm"></i>
                  <h3 className="text-xs font-bold text-gray-900">خطوة مهمة: قواعد الحماية في Firebase (Firestore Rules)</h3>
                </div>
                <span className="text-[10px] bg-emerald-50 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                  مطلوبة لمرة واحدة فقط
                </span>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed font-normal">
                لتتمكن المنصة المرفوعة من قراءة المنتجات وتحديثها للزوار، تأكد من فتح قواعد Firestore في لوحة تحكم فايربيس (Firebase Console) &gt; Firestore Database &gt; Rules:
              </p>
              <div className="relative bg-gray-900 text-emerald-400 p-3 rounded-xl font-mono text-[11px] overflow-x-auto text-left" dir="ltr">
                <pre>{`rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if true;\n    }\n  }\n}`}</pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} {\n      allow read, write: if true;\n    }\n  }\n}`);
                    showToast('تم نسخ كود قواعد فايربيس إلى الحافظة!');
                  }}
                  className="absolute top-2 right-2 px-2 py-1 bg-white/20 hover:bg-white/30 text-white rounded text-[10px] font-sans transition cursor-pointer"
                >
                  نسخ القواعد
                </button>
              </div>
            </div>

          </div>
        )}
      {/* خلفية معتمة (Backdrop) عند فتح القائمة على الجوال */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="md:hidden fixed inset-0 bg-black/50 backdrop-blur-xs z-40 transition-opacity"
        />
      )}

      {/* القائمة الجانبية (Sidebar) بخلفية بيضاء موحدة وبدون حدود مع خط 14px */}
      <aside
        className={`bg-white border-0 flex flex-col justify-between shadow-none transition-all duration-300 z-50 ${
          mobileMenuOpen
            ? 'fixed top-0 right-0 bottom-0 w-64 max-w-[85vw] h-full translate-x-0'
            : 'fixed top-0 right-0 bottom-0 w-64 max-w-[85vw] h-full translate-x-full md:static md:w-56 md:h-auto md:translate-x-0 md:flex'
        }`}
        style={mobileMenuOpen ? {
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)'
        } : undefined}
      >
        {/* رأس القائمة في الجوال مع زر إغلاق صريح */}
        <div className="md:hidden flex items-center justify-between p-3 bg-white border-b border-gray-100">
          <div className="flex items-center gap-1.5">
            <i className="fa-solid fa-layer-group text-gray-700 text-sm"></i>
            <span className="text-xs font-bold text-gray-900">أقسام لوحة التحكم</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="w-7 h-7 rounded-full bg-gray-100 border-0 flex items-center justify-center text-gray-600 text-xs hover:bg-gray-200 cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div>
          <div className="p-2 space-y-3">
            
            {/* المجموعة الأولى: نظرة عامة والمبيعات */}
            <div>
              <div className="px-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                الرئيسية والمبيعات
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => { setActiveTab('analytics'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'analytics' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <i className={`fa-solid fa-chart-line text-sm ${activeTab === 'analytics' ? 'text-gray-950' : 'text-gray-500'}`}></i>
                  <span>التحليلات والمؤشرات</span>
                </button>

                <button
                  onClick={() => { setActiveTab('orders'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center justify-between px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'orders' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <i className={`fa-solid fa-bag-shopping text-sm ${activeTab === 'orders' ? 'text-gray-950' : 'text-gray-500'}`}></i>
                    <span>الطلبات والمبيعات</span>
                  </div>
                  {pendingOrdersCount > 0 ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500 text-white font-bold animate-pulse">
                      {pendingOrdersCount} جديد
                    </span>
                  ) : (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === 'orders' ? 'bg-gray-100 text-gray-900 font-bold' : 'bg-gray-100 text-gray-500'}`}>
                      {orders.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* المجموعة الثانية: الكتالوج والمنتجات */}
            <div>
              <div className="px-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                المنتجات والكتالوج
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => { setActiveTab('products'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center justify-between px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'products' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <i className={`fa-solid fa-boxes-stacked text-sm ${activeTab === 'products' ? 'text-gray-950' : 'text-gray-500'}`}></i>
                    <span>المنتجات والمخزون</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === 'products' ? 'bg-gray-100 text-gray-900 font-bold' : 'bg-gray-100 text-gray-500'}`}>
                    {products.length}
                  </span>
                </button>

                <button
                  onClick={() => { setActiveTab('categories'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center justify-between px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'categories' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <i className={`fa-solid fa-folder-tree text-sm ${activeTab === 'categories' ? 'text-gray-950' : 'text-gray-500'}`}></i>
                    <span>أقسام المتجر</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === 'categories' ? 'bg-gray-100 text-gray-900 font-bold' : 'bg-gray-100 text-gray-500'}`}>
                    {categories.length}
                  </span>
                </button>
              </div>
            </div>

            {/* المجموعة الثالثة: العملاء والتسويق */}
            <div>
              <div className="px-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                العملاء والتسويق
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => { setActiveTab('customers'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center justify-between px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'customers' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <i className={`fa-solid fa-users text-sm ${activeTab === 'customers' ? 'text-gray-950' : 'text-gray-500'}`}></i>
                    <span>قاعدة العملاء</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === 'customers' ? 'bg-gray-100 text-gray-900 font-bold' : 'bg-gray-100 text-gray-500'}`}>
                    {customers.length}
                  </span>
                </button>

                <button
                  onClick={() => { setActiveTab('coupons'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center justify-between px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'coupons' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <i className={`fa-solid fa-tags text-sm ${activeTab === 'coupons' ? 'text-gray-950' : 'text-gray-500'}`}></i>
                    <span>كوبونات الخصم</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === 'coupons' ? 'bg-gray-100 text-gray-900 font-bold' : 'bg-gray-100 text-gray-500'}`}>
                    {coupons.length}
                  </span>
                </button>
              </div>
            </div>

            {/* المجموعة الرابعة: إعدادات المتجر والتخصيص */}
            <div>
              <div className="px-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                التخصيص والإعدادات
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => { setActiveTab('announcements'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center justify-between px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'announcements' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <i className={`fa-solid fa-bullhorn text-sm ${activeTab === 'announcements' ? 'text-gray-950' : 'text-gray-500'}`}></i>
                    <span>أشرطة الإعلانات</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${activeTab === 'announcements' ? 'bg-gray-100 text-gray-900 font-bold' : 'bg-gray-100 text-gray-500'}`}>
                    {storeConfig.announcements?.length || 1}
                  </span>
                </button>

                <button
                  onClick={() => { setActiveTab('fonts'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'fonts' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <i className={`fa-solid fa-palette text-sm ${activeTab === 'fonts' ? 'text-gray-950' : 'text-gray-500'}`}></i>
                  <span>مظهر المتجر: الخطوط والألوان</span>
                </button>

                <button
                  onClick={() => { setActiveTab('features'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center justify-between px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'features' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <i className={`fa-solid fa-bolt text-sm ${activeTab === 'features' ? 'text-gray-950' : 'text-gray-500'}`}></i>
                    <span>مميزات المنتج</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    storeConfig.productFeatures?.enabled !== false ? 'bg-emerald-100 text-emerald-800 font-bold' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {storeConfig.productFeatures?.enabled !== false ? 'مفعل' : 'معطل'}
                  </span>
                </button>

                <button
                  onClick={() => { setActiveTab('loyalty'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center justify-between px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'loyalty' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <i className={`fa-solid fa-gift text-sm ${activeTab === 'loyalty' ? 'text-gray-950' : 'text-gray-500'}`}></i>
                    <span>نقاط الولاء والمكافآت</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    storeConfig.loyaltyConfig?.enabled !== false ? 'bg-emerald-100 text-emerald-800 font-bold' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {storeConfig.loyaltyConfig?.enabled !== false ? 'مفعل' : 'معطل'}
                  </span>
                </button>

                <button
                  onClick={() => { setActiveTab('payments'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'payments' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <i className={`fa-solid fa-credit-card text-sm ${activeTab === 'payments' ? 'text-gray-950' : 'text-gray-500'}`}></i>
                  <span>وسائل الدفع والباركود</span>
                </button>

                <button
                  onClick={() => { setActiveTab('cloud-backup'); setMobileMenuOpen(false); }}
                  className={`admin-nav-tab-btn w-full flex items-center justify-between px-3 py-2 rounded-xl text-[14px] transition cursor-pointer border-0 ${
                    activeTab === 'cloud-backup' ? 'bg-white text-gray-950 font-bold shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <i className={`fa-solid fa-cloud-arrow-up text-sm ${activeTab === 'cloud-backup' ? 'text-gray-950' : 'text-sky-600'}`}></i>
                    <span>النسخ الاحتياطي والسحابة</span>
                  </div>
                  <span className="bg-sky-100 text-sky-800 text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                    مهم
                  </span>
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* بطاقة معلومات المتجر السريعة أسفل القائمة */}
        <div className="p-3.5 m-2.5 bg-emerald-50/70 border border-emerald-200/60 rounded-xl hidden md:block">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            <span className="text-xs font-semibold text-emerald-950">النظام متصل ونشط</span>
          </div>
          <p className="text-[11px] text-emerald-800 leading-relaxed">
            المنتجات الرقمية جاهزة للتسليم الفوري عند تأكيد الدفع.
          </p>
        </div>
      </aside>

      {/* المحتوى الرئيسي للوحة التحكم المتجاوب تلقائياً بالكامل */}
      <main 
        className="flex-1 p-2 sm:p-4 md:p-6 overflow-y-auto w-full min-w-0 transition-all bg-white border-0 relative"
        style={{
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 40px)'
        }}
      >

        {/* شريط حفظ الإعدادات الثابت أعلى محتوى لوحة التحكم دائماً (Sticky Top Save Bar) */}
        {['store-design', 'announcements', 'fonts', 'features', 'loyalty', 'payments'].includes(activeTab) && (
          <div className="sticky top-0 z-30 mb-4 sm:mb-6 px-3 sm:px-6 py-2.5 sm:py-3 bg-white/95 backdrop-blur-md border-b border-gray-200/80 shadow-xs flex items-center justify-between gap-3 transition-all" dir="rtl">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0"></span>
              <div className="min-w-0">
                <h4 className="text-xs sm:text-sm font-bold text-gray-900 truncate leading-tight">
                  {activeTab === 'store-design' && 'إعدادات تصميم وهوية المتجر'}
                  {activeTab === 'announcements' && 'إعدادات أشرطة الإعلانات الترويجية'}
                  {activeTab === 'fonts' && 'إعدادات خطوط وألوان المتجر'}
                  {activeTab === 'features' && 'إعدادات مميزات المتجر السريعة'}
                  {activeTab === 'loyalty' && 'إعدادات برنامج الولاء والمكافآت'}
                  {activeTab === 'payments' && 'إعدادات وسائل الدفع والباركود'}
                </h4>
                <span className="text-[10px] text-gray-400 font-normal hidden sm:inline leading-none">
                  احفظ تعديلاتك في أي وقت دون الحاجة للتمرير لأسفل الصفحة
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {activeTab === 'store-design' && (
                <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-xl border border-gray-200">
                  <button
                    type="button"
                    onClick={handleUndoConfig}
                    disabled={configHistoryIndex <= 0}
                    className="w-8 h-8 rounded-lg bg-black hover:bg-gray-800 disabled:opacity-25 disabled:hover:bg-black text-white flex items-center justify-center transition active:scale-90 cursor-pointer shadow-xs"
                    title="تراجع (Undo)"
                  >
                    <i className="fa-solid fa-rotate-left text-xs text-white"></i>
                  </button>
                  <button
                    type="button"
                    onClick={handleRedoConfig}
                    disabled={configHistoryIndex >= configHistory.length - 1}
                    className="w-8 h-8 rounded-lg bg-black hover:bg-gray-800 disabled:opacity-25 disabled:hover:bg-black text-white flex items-center justify-center transition active:scale-90 cursor-pointer shadow-xs"
                    title="إعادة التقدم (Redo)"
                  >
                    <i className="fa-solid fa-rotate-right text-xs text-white"></i>
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handleSaveAllSettings}
                disabled={isSavingGlobalSettings}
                className="px-4 sm:px-5 py-2 sm:py-2.5 bg-[#004956] hover:bg-[#00343D] text-white text-xs font-bold rounded-xl shadow-sm hover:shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-75 flex items-center gap-2"
                title="حفظ كافة الإعدادات والتعديلات"
              >
                <i className={`fa-solid ${isSavingGlobalSettings ? 'fa-spinner fa-spin' : 'fa-floppy-disk'} text-xs`}></i>
                <span>{isSavingGlobalSettings ? 'جاري الحفظ...' : 'حفظ الإعدادات'}</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 1. قسم التحليلات والتقارير المتقدمة (Analytics & Reports)  */}
        {/* ========================================================= */}
        {activeTab === 'analytics' && (
          <div className="space-y-6 max-w-7xl mx-auto" dir="rtl">
            {/* 1. الصف العلوي: بطاقات المؤشرات الأربعة بجانب بعضها في صف واحد بدون حدود وبدون خلفية وكل عنصر تحته رقمه */}
            <div className="grid grid-cols-4 gap-2 sm:gap-4 py-2 sm:py-3">
              
              {/* المؤشر 1: إجمالي العملاء */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-users text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">العملاء</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {customers.length.toLocaleString('en-US')}
                </h3>
              </div>

              {/* المؤشر 2: إجمالي المنتجات */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-bag-shopping text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">المنتجات</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {products.length.toLocaleString('en-US')}
                </h3>
              </div>

              {/* المؤشر 3: الطلبات المكتملة */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-check-double text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">المكتملة</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {completedOrdersCount.toLocaleString('en-US')}
                </h3>
              </div>

              {/* المؤشر 4: إجمالي الأرباح */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-arrow-turn-up text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">الأرباح</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </h3>
              </div>

            </div>

            {/* 2. الصف الأوسط: المنتجات الأكثر طلباً */}
            <div>
              {/* بطاقة المنتجات الأكثر طلباً (Top Demanded Products) */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-5 sm:p-6 flex flex-col justify-between">
                {/* الرأس */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
                      <i className="fa-solid fa-fire text-amber-500 text-sm"></i>
                      <span>المنتجات الأكثر طلباً</span>
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('products')}
                    className="text-xs text-[#004956] hover:text-[#00343D] font-semibold flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <span>إدارة المنتجات</span>
                    <i className="fa-solid fa-arrow-left text-[10px]"></i>
                  </button>
                </div>

                {/* قائمة المنتجات الأكثر طلباً */}
                <div className="space-y-3 divide-y divide-gray-50/80">
                  {topDemandedProducts.map((p, idx) => (
                    <div
                      key={p.id || idx}
                      onClick={() => handleOpenEditProduct(p)}
                      className="pt-3 first:pt-0 flex items-center justify-between gap-3 hover:bg-gray-50/70 p-2 rounded-xl transition cursor-pointer group"
                    >
                      {/* معلومات المنتج */}
                      <div className="flex items-center gap-3 min-w-0">
                        {/* الترتيب */}
                        <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold font-mono shrink-0 ${
                          idx === 0 ? 'bg-amber-100 text-amber-800' : idx === 1 ? 'bg-slate-100 text-slate-800' : idx === 2 ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-600'
                        }`}>
                          #{idx + 1}
                        </span>

                        {/* صورة المنتج المصغرة */}
                        <div className="w-8 h-8 rounded-xl bg-gray-100 border border-gray-200/80 overflow-hidden shrink-0 flex items-center justify-center">
                          {p.imageUrl ? (
                            <img src={p.imageUrl} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition" />
                          ) : (
                            <i className="fa-solid fa-box text-gray-400 text-sm"></i>
                          )}
                        </div>

                        {/* اسم وقسم المنتج */}
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-gray-900 truncate group-hover:text-[#004956] transition">{p.title}</h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[8px] sm:text-[9px] text-gray-400 truncate font-medium">
                              {p.category || 'عام'}
                            </span>
                            <span className="text-[10px] sm:text-[11px] font-bold text-emerald-600 font-mono">
                              ${p.price}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* إحصائيات الطلب والمبيعات */}
                      <div className="flex items-center shrink-0 text-left" dir="ltr">
                        <div>
                          <div className="flex items-center justify-end gap-1.5 text-xs font-bold text-gray-900 font-mono">
                            <span>{p.salesCount}</span>
                            <span className="text-[11px] font-normal text-gray-500 font-sans">طلب</span>
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono font-medium mt-0.5">
                            ${p.totalSalesRevenue}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. الصف السفلي: قائمة الطلبات الحقيقية (Order List) */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-xs p-5 sm:p-6">
              {/* ترويسة الجدول */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 tracking-tight">قائمة الطلبات الأخيرة</h3>
                </div>
                
                <div className="relative">
                  <select
                    value={analyticsOrdersFilter}
                    onChange={(e) => setAnalyticsOrdersFilter(e.target.value)}
                    className="appearance-none pr-3 pl-7 py-1.5 rounded-xl border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:border-gray-300 focus:outline-none cursor-pointer"
                  >
                    <option value="الكل">جميع الحالات</option>
                    <option value="مكتمل">المكتملة فقط</option>
                    <option value="قيد المراجعة">قيد المراجعة</option>
                  </select>
                  <i className="fa-solid fa-chevron-down absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 pointer-events-none"></i>
                </div>
              </div>

              {/* الجدول التفاعلي بالترتيب المحدد: رقم الطلب - اسم العميل - السعر - حالة الطلب */}
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs text-gray-600">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 font-medium">
                      <th className="pb-3.5 pr-2 font-semibold w-28 sm:w-36 whitespace-nowrap">رقم الطلب</th>
                      <th className="pb-3.5 font-semibold w-auto">اسم العميل</th>
                      <th className="pb-3.5 font-semibold w-24 sm:w-32 whitespace-nowrap">السعر</th>
                      <th className="pb-3.5 pl-2 font-semibold w-28 sm:w-36 whitespace-nowrap text-left sm:text-right">حالة الطلب</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50/80">
                    {orders
                      .filter(o => {
                        if (analyticsOrdersFilter === 'مكتمل') return o.status === 'مكتمل';
                        if (analyticsOrdersFilter === 'قيد المراجعة') return o.status === 'قيد المراجعة';
                        return true;
                      })
                      .slice(0, 10)
                      .map((o, rIdx) => {
                        const isCompleted = o.status === 'مكتمل';
                        const isPending = o.status === 'قيد المراجعة';

                        return (
                          <tr
                            key={o.id || rIdx}
                            onClick={() => setSelectedOrderDetails(o)}
                            className="hover:bg-gray-50/70 transition-colors cursor-pointer"
                            title="اضغط لعرض تفاصيل الطلب"
                          >
                            <td className="py-4 pr-2 font-semibold text-gray-900 font-mono whitespace-nowrap">{o.id}</td>
                            <td className="py-4 font-medium text-gray-900">{o.customer || 'عميل المتجر'}</td>
                            <td className="py-4 font-bold text-gray-900 font-mono whitespace-nowrap">{o.totalFormatted || `$${o.totalUsd}`}</td>
                            <td className="py-4 pl-2 whitespace-nowrap text-left sm:text-right">
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                                isCompleted
                                  ? 'bg-emerald-50/90 text-emerald-700'
                                  : isPending
                                  ? 'bg-amber-50/90 text-amber-700'
                                  : 'bg-gray-100 text-gray-700'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isCompleted ? 'bg-emerald-500' : isPending ? 'bg-amber-500' : 'bg-gray-400'}`}></span>
                                <span>{o.status || 'قيد المعالجة'}</span>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}


        {/* ========================================================= */}
        {/* 2. قسم إدارة المنتجات والمخزون الرقمي (Digital Products)   */}
        {/* ========================================================= */}
        {activeTab === 'products' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-800">إدارة المنتجات الرقمية والمخزون</h2>
                <p className="text-xs text-gray-500 mt-1">إضافة تراخيص برامج، بطاقات شحن، أو ملفات قابلة للتحميل</p>
              </div>
              <button
                onClick={handleOpenNewProduct}
                className="w-fit px-3 py-1.5 bg-[#004956] text-white text-[13px] font-bold rounded-xl shadow-2xs hover:opacity-95 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shrink-0"
              >
                <span className="text-[14px] leading-none">+</span>
                <span className="leading-none">أضف منتج جديد</span>
              </button>
            </div>

            {/* تخطيط المنتجات: قائمة التصنيفات على اليمين وعرض المنتجات في الجهة المقابلة */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* العمود الأيمن: قائمة التصنيفات مرتبة على شكل صفوف أنيقة */}
              <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-200 p-4 shadow-2xs space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                  <h3 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                    <span>📁</span>
                    <span>أقسام وتصنيفات المتجر</span>
                  </h3>
                  <span className="text-[10px] text-gray-400 font-mono">({categories.length})</span>
                </div>

                {/* صفوف التصنيفات */}
                <div className="space-y-1">
                  {/* زر كل الأقسام */}
                  <button
                    type="button"
                    onClick={() => setProductCatFilter('الكل')}
                    className={`w-full text-right px-3.5 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center justify-between group ${
                      productCatFilter === 'الكل'
                        ? 'bg-[#004956] text-white shadow-xs'
                        : 'text-gray-700 hover:bg-gray-100/80 bg-gray-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">🗂️</span>
                      <span>جميع الأقسام</span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                      productCatFilter === 'الكل'
                        ? 'bg-white/20 text-white font-bold'
                        : 'bg-gray-200/70 text-gray-600'
                    }`}>
                      {products.length}
                    </span>
                  </button>

                  {/* صفوف الأقسام الفردية */}
                  {categories.filter(c => c.name !== 'الكل').map((c) => {
                    const count = products.filter(p => p.category === c.name).length;
                    const isSelected = productCatFilter === c.name;

                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setProductCatFilter(c.name)}
                        className={`w-full text-right px-3.5 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer flex items-center justify-between group ${
                          isSelected
                            ? 'bg-[#004956] text-white font-bold shadow-xs'
                            : 'text-gray-700 hover:bg-gray-100/80 bg-white border border-gray-100'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {c.imageUrl ? (
                            <img src={c.imageUrl} alt="" className="w-5 h-5 rounded-md object-cover shrink-0" />
                          ) : (
                            <span className="text-xs">📁</span>
                          )}
                          <span className="truncate">{c.name}</span>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono shrink-0 mr-1 ${
                          isSelected
                            ? 'bg-white/20 text-white font-bold'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* العمود الأيسر: شريط الفرز والبحث وجدول المنتجات الخاصة بالقسم المختار */}
              <div className="lg:col-span-9 space-y-4">
                
                {/* شريط البحث والفلترة والفرز */}
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-2xs space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* 1. بحث بالاسم */}
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">🔍 البحث في المنتجات:</label>
                      <input
                        type="text"
                        placeholder="ابحث باسم المنتج، الشارة، أو الكود..."
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:border-[#004956]"
                      />
                    </div>

                    {/* 2. خيارات الفرز والترتيب */}
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">🔃 ترتيب وفرز حسب:</label>
                      <select
                        value={productSortBy}
                        onChange={(e) => setProductSortBy(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none cursor-pointer font-medium"
                      >
                        <option value="default">الأحدث إضافة أولاً</option>
                        <option value="price-asc">السعر: من الأقل للأعلى ⬆️</option>
                        <option value="price-desc">السعر: من الأعلى للأقل ⬇️</option>
                        <option value="stock-asc">المخزون: الأقل كمية أولاً (تنبيه النفاذ) ⚠️</option>
                        <option value="stock-desc">المخزون: الأكثر توفراً 📦</option>
                        <option value="name-asc">أبجدياً (أ - ي) 🔤</option>
                      </select>
                    </div>

                    {/* 3. فلترة حالة المخزون */}
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-600 mb-1">📦 حالة المخزون:</label>
                      <select
                        value={productStockFilter}
                        onChange={(e) => setProductStockFilter(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none cursor-pointer"
                      >
                        <option value="all">كل الحالات</option>
                        <option value="in-stock">متوفر في المخزون فقط</option>
                        <option value="low-stock">مخزون منخفض (5 قطع أو أقل) ⚠️</option>
                        <option value="out-of-stock">نفذت الكمية (0 قطعة) ❌</option>
                      </select>
                    </div>
                  </div>

                  {/* شريط الإحصائيات ورأس القسم النشط مع زر إعادة الضبط بجانبه مباشرة */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800">
                        {productCatFilter === 'الكل' ? 'عرض جميع المنتجات' : `منتجات قسم: ${productCatFilter}`}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-[#004956] font-bold">
                        {filteredProducts.length} منتج
                      </span>
                      {(productSearch || productCatFilter !== 'الكل' || productSortBy !== 'default' || productStockFilter !== 'all') && (
                        <button
                          type="button"
                          onClick={() => {
                            setProductSearch('');
                            setProductCatFilter('الكل');
                            setProductSortBy('default');
                            setProductStockFilter('all');
                          }}
                          className="mr-2 text-xs text-red-500 hover:text-red-700 hover:underline cursor-pointer font-medium flex items-center gap-1 bg-red-50 px-2 py-0.5 rounded-lg border border-red-100 transition-colors"
                        >
                          <span>إعادة ضبط الفلاتر</span>
                          <span>↺</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* جدول المنتجات المعروضة في الجهة اليسرى بنمط سلة الاحترافي */}
                {filteredProducts.length === 0 ? (
                  <div className="bg-white p-12 text-center rounded-2xl border border-gray-200/80 shadow-2xs space-y-3">
                    <div className="w-16 h-16 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto text-gray-400">
                      <i className="fa-solid fa-box-open text-2xl text-gray-400"></i>
                    </div>
                    <h3 className="text-sm font-bold text-gray-800">لا توجد منتجات في هذا القسم حالياً</h3>
                    <p className="text-xs text-gray-400 max-w-sm mx-auto">
                      يمكنك اختيار قسم آخر من القائمة أو إضافة منتج جديد يتبع لهذا القسم.
                    </p>
                    <div className="pt-2 flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setProductSearch('');
                          setProductCatFilter('الكل');
                          setProductSortBy('default');
                          setProductStockFilter('all');
                        }}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold cursor-pointer transition"
                      >
                        عرض جميع المنتجات ({products.length})
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenNewProduct}
                        className="w-fit px-2 py-1 bg-[#004956] text-white rounded-lg text-[7px] font-bold cursor-pointer hover:opacity-95 transition flex items-center gap-1 shadow-2xs active:scale-95"
                      >
                        <i className="fa-solid fa-plus text-[7px]"></i>
                        <span className="leading-none">إضافة منتج لهذا القسم</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead className="bg-[#F9FAFB] border-b border-gray-200 text-gray-500 font-semibold text-[11px]">
                          <tr>
                            <th className="py-2 px-3 font-semibold text-gray-600">المنتج</th>
                            <th className="py-2 px-2 font-semibold text-gray-600">نوع المنتج</th>
                            <th className="py-2 px-2 font-semibold text-gray-600">السعر</th>
                            <th className="py-2 px-2 font-semibold text-gray-600">المخزون</th>
                            <th className="py-2 px-3 font-semibold text-gray-600 text-center">إجراءات</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100/90">
                          {filteredProducts.map((p) => {
                            const isLowStock = p.stock > 0 && p.stock <= 5;
                            const isOutOfStock = p.stock <= 0;
                            return (
                              <tr key={p.id} className="hover:bg-gray-50/80 transition-colors group">
                                {/* عمود المنتج: اسم المنتج وتحته القسم بخط صغير ومعرف المنتج */}
                                <td className="py-3 px-4 max-w-[280px]">
                                  <div className="flex items-center gap-2.5">
                                    <div className="relative w-7 h-7 rounded-xl bg-gray-50 border border-gray-200/90 overflow-hidden shrink-0 flex items-center justify-center p-0.5">
                                      <img
                                        src={p.imageUrl}
                                        alt=""
                                        className="w-full h-full object-cover rounded-lg"
                                        loading="lazy"
                                      />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <span
                                        onClick={() => handleOpenEditProduct(p)}
                                        className="font-bold text-gray-900 block text-xs hover:text-[#004956] transition cursor-pointer line-clamp-2 leading-relaxed whitespace-normal break-words"
                                        title={p.title}
                                      >
                                        {p.title}
                                      </span>
                                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500">
                                        <span className="font-medium text-gray-600 truncate">
                                          {p.category}
                                        </span>
                                        {p.sku && (
                                          <>
                                            <span className="text-gray-300">•</span>
                                            <span className="text-gray-400 font-mono truncate">
                                              SKU: {p.sku}
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </td>

                                {/* نوع المنتج والتسليم: نص نقي مع أيقونة سوداء بدون خلفيات ملونة */}
                                <td className="py-2 px-2 whitespace-nowrap">
                                  <div className="flex flex-col gap-1 items-start">
                                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-800 font-medium">
                                      <i className={`fa-solid ${
                                        p.productType === 'physical' ? 'fa-box' :
                                        p.productType === 'file' ? 'fa-file-arrow-down' :
                                        p.productType === 'service' ? 'fa-gear' : 'fa-key'
                                      } text-[11px] text-black`}></i>
                                      <span>
                                        {p.productType === 'physical' ? 'سلعة مادية' :
                                         p.productType === 'file' ? 'ملف تحميل' :
                                         p.productType === 'service' ? 'خدمة' : 'كود / ترخيص'}
                                      </span>
                                    </span>
                                    {p.hasQuantityTiers && p.quantityTiers?.length > 0 && (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 font-medium">
                                        <i className="fa-solid fa-tags text-[9px] text-black"></i>
                                        <span>{p.quantityTiers.length} باقات تسعير</span>
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* السعر والتكلفة */}
                                <td className="py-2 px-2 whitespace-nowrap">
                                  <div className="font-bold text-gray-900 font-mono text-xs">
                                    ${Number(p.price).toFixed(2)}
                                  </div>
                                  {p.costPrice && (
                                    <div className="text-[10px] text-amber-700 font-mono font-medium" title="سعر التكلفة">
                                      تكلفة: ${Number(p.costPrice).toFixed(2)}
                                    </div>
                                  )}
                                  {p.oldPrice && (
                                    <div className="text-[10px] text-gray-400 line-through font-mono">
                                      ${Number(p.oldPrice).toFixed(2)}
                                    </div>
                                  )}
                                </td>

                                {/* المخزون: نص نقي بنقطة ملونة صغيرة بدون خلفيات ملونة للنص */}
                                <td className="py-2 px-2 whitespace-nowrap">
                                  <div className="inline-flex items-center gap-1.5 font-medium text-xs text-gray-800 font-mono">
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                                      isOutOfStock ? 'bg-red-500' : isLowStock ? 'bg-amber-500' : 'bg-emerald-500'
                                    }`}></span>
                                    <span>
                                      {isOutOfStock ? 'نفذت الكمية' : `${p.stock} ${p.productType === 'license' ? 'كود' : 'قطعة'}`}
                                    </span>
                                    {isLowStock && (
                                      <span className="text-[10px] text-amber-600 font-normal font-sans">(متبقي قليل)</span>
                                    )}
                                  </div>
                                </td>

                                {/* إجراءات التعديل والحذف بنمط سلة */}
                                <td className="py-3 px-4 text-center whitespace-nowrap">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEditProduct(p)}
                                      title="تعديل بيانات المنتج"
                                      className="w-8 h-8 rounded-lg text-gray-600 hover:text-black hover:bg-gray-100 transition cursor-pointer flex items-center justify-center"
                                    >
                                      <i className="fa-solid fa-pen-to-square text-sm"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteProduct(p.id)}
                                      title="حذف المنتج من المتجر"
                                      className="w-8 h-8 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer flex items-center justify-center"
                                    >
                                      <i className="fa-solid fa-trash-can text-sm"></i>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 3. قسم إدارة الطلبات والمبيعات (Orders Management)         */}
        {/* ========================================================= */}
        {activeTab === 'orders' && (
          <div className="space-y-6">
            {/* بطاقات المؤشرات الرئيسية للطلبات: بجانب بعضها في صف واحد بدون حدود وبدون خلفية وكل عنصر تحته رقمه */}
            <div className="grid grid-cols-4 gap-2 sm:gap-4 py-2 sm:py-3">
              {/* إجمالي الطلبات */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-cart-shopping text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">إجمالي الطلبات</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {orders.length}
                </h3>
              </div>

              {/* بانتظار المراجعة */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-clock text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">بانتظار المراجعة</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {orders.filter(o => o.status === 'قيد المراجعة').length}
                </h3>
              </div>

              {/* طلبات مكتملة */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-circle-check text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">طلبات مكتملة</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {orders.filter(o => o.status === 'مكتمل').length}
                </h3>
              </div>

              {/* إجمالي المبيعات */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-sack-dollar text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">إجمالي المبيعات</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  ${orders.reduce((sum, o) => sum + (parseFloat(o.totalUsd) || 0), 0).toFixed(0)}
                </h3>
              </div>
            </div>

            {/* أدوات البحث والفلترة السريعة بنمط التبويبات بدون خلفيات ملونة */}
            <div className="bg-white p-4 rounded-2xl border border-gray-200/90 shadow-2xs space-y-3">
              <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                {/* شريط البحث المباشر */}
                <div className="relative w-full sm:w-80">
                  <i className="fa-solid fa-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                  <input
                    type="text"
                    placeholder="ابحث برقم الطلب، اسم العميل، أو وسيلة الدفع..."
                    value={orderSearch}
                    onChange={(e) => setOrderSearch(e.target.value)}
                    className="w-full pr-8 pl-3 py-2 bg-gray-50/70 border border-gray-200 rounded-xl text-xs outline-none focus:border-black focus:bg-white transition"
                  />
                </div>

                {/* أزرار إعادة الضبط وحذف كافة الطلبات */}
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  {(orderSearch || orderStatusFilter !== 'الكل') && (
                    <button
                      type="button"
                      onClick={() => {
                        setOrderSearch('');
                        setOrderStatusFilter('الكل');
                      }}
                      className="px-3 py-2 text-gray-600 hover:text-black text-xs font-medium cursor-pointer transition flex items-center gap-1"
                    >
                      <i className="fa-solid fa-rotate-left text-xs"></i>
                      <span>إعادة ضبط</span>
                    </button>
                  )}
                  {orders.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearAllOrders}
                      className="px-3 py-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-xl text-xs font-medium cursor-pointer transition flex items-center gap-1.5"
                      title="حذف كافة الطلبات الحالية"
                    >
                      <i className="fa-solid fa-trash-can text-xs"></i>
                      <span>حذف كل الطلبات</span>
                    </button>
                  )}
                </div>
              </div>

              {/* تبويبات الحالات السريعة بدون أي ألوان خلفية */}
              <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-gray-100 text-xs">
                {[
                  { id: 'الكل', label: 'كافة الطلبات', count: orders.length },
                  { id: 'قيد المراجعة', label: 'قيد المراجعة', count: orders.filter(o => o.status === 'قيد المراجعة').length },
                  { id: 'قيد التنفيذ', label: 'قيد التنفيذ', count: orders.filter(o => o.status === 'قيد التنفيذ').length },
                  { id: 'مكتمل', label: 'مكتمل', count: orders.filter(o => o.status === 'مكتمل').length },
                  { id: 'ملغي', label: 'ملغي', count: orders.filter(o => o.status === 'ملغي').length }
                ].map(tab => {
                  const isSelected = orderStatusFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setOrderStatusFilter(tab.id)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-2 shrink-0 ${
                        isSelected
                          ? 'bg-black text-white font-bold shadow-2xs'
                          : 'text-gray-600 hover:text-black hover:bg-gray-100 bg-transparent'
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* جدول الطلبات العصري والحيوي بدون أي خلفيات ملونة للنصوص */}
            {filteredOrders.length === 0 ? (
              <div className="bg-white p-12 text-center rounded-2xl border border-gray-200/90 shadow-2xs space-y-3">
                <div className="w-14 h-14 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto text-gray-400">
                  <i className="fa-solid fa-clipboard-list text-2xl text-gray-400"></i>
                </div>
                <h3 className="text-sm font-bold text-gray-800">لا توجد طلبات في هذه الحالة</h3>
                <p className="text-xs text-gray-400 max-w-sm mx-auto">
                  يمكنك مراجعة جميع الطلبات أو تغيير كلمة البحث الحالية.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setOrderSearch('');
                    setOrderStatusFilter('الكل');
                  }}
                  className="px-4 py-2 bg-black text-white rounded-xl text-xs font-semibold cursor-pointer"
                >
                  عرض جميع الطلبات
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-[#F9FAFB] border-b border-gray-200 text-gray-500 font-semibold text-[11px]">
                      <tr>
                        <th className="py-2 px-3 font-semibold text-gray-600">رقم الطلب</th>
                        <th className="py-2 px-3 font-semibold text-gray-600">اسم العميل</th>
                        <th className="py-2 px-2 font-semibold text-gray-600">طريقة الدفع</th>
                        <th className="py-2 px-2 font-semibold text-gray-600">المبلغ</th>
                        <th className="py-2 px-2 font-semibold text-gray-600">إيصال التحويل</th>
                        <th className="py-2 px-2 font-semibold text-gray-600">حالة الطلب</th>
                        <th className="py-2 px-3 font-semibold text-gray-600 text-center">تحديث الحالة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100/90">
                      {filteredOrders.map((ord) => {
                        const isCompleted = ord.status === 'مكتمل';
                        const isPending = ord.status === 'قيد المراجعة';
                        const isCancelled = ord.status === 'ملغي';
                        const cleanCustomerName = (ord.customer || '').replace(/\s*\([^)]*\)/g, '').trim() || ord.customer || 'عميل';
                        return (
                          <tr key={ord.id} className="hover:bg-gray-50/70 transition-colors group">
                            {/* رقم الطلب والتاريخ تحته */}
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span
                                onClick={() => setSelectedOrderDetails(ord)}
                                className="font-bold text-gray-900 font-mono text-xs hover:text-black cursor-pointer hover:underline block"
                              >
                                {ord.id}
                              </span>
                              <span className="text-[10px] text-gray-400 font-mono block mt-0.5">
                                {ord.date || '2026-09-12'}
                              </span>
                            </td>

                            {/* اسم العميل */}
                            <td className="py-2 px-3">
                              <div className="font-semibold text-gray-900 text-xs">
                                {cleanCustomerName}
                              </div>
                              {ord.walletWarning && (
                                <span className="text-[10px] text-red-600 font-bold block mt-0.5" title={ord.walletWarning}>
                                  ⚠️ الرصيد لا يكفي
                                </span>
                              )}
                              {ord.walletDeducted && (
                                <span className="text-[10px] text-emerald-600 font-semibold block mt-0.5">
                                  ✓ تم خصم المحفظة
                                </span>
                              )}
                            </td>

                            {/* طريقة الدفع: نص نقي مع أيقونة سوداء */}
                            <td className="py-2 px-2 whitespace-nowrap">
                              <div className="flex items-center gap-1.5 text-xs text-gray-800 font-medium">
                                <i className="fa-solid fa-credit-card text-black text-[11px]"></i>
                                <span>{ord.method}</span>
                              </div>
                            </td>

                            {/* المبلغ */}
                            <td className="py-2 px-2 whitespace-nowrap">
                              <div className="font-bold text-gray-950 font-mono text-xs">
                                {ord.totalFormatted || `$${ord.totalUsd}`}
                              </div>
                            </td>

                            {/* إيصال التحويل */}
                            <td className="py-2 px-2 whitespace-nowrap">
                              <button
                                onClick={() => setSelectedOrderDetails(ord)}
                                className="inline-flex items-center gap-1.5 text-xs text-gray-800 hover:text-black font-semibold transition cursor-pointer hover:underline"
                              >
                                <i className={`fa-solid ${ord.proof ? 'fa-file-invoice' : 'fa-receipt'} text-black text-xs`}></i>
                                <span>{ord.proof ? 'إيصال التحويل' : 'عرض التفاصيل'}</span>
                              </button>
                            </td>

                            {/* حالة الطلب: نقطة دائرية صغيرة مع نص نقي بدون خلفيات ملونة */}
                            <td className="py-2 px-2 whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-800">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${
                                  isCompleted ? 'bg-emerald-500' :
                                  isPending ? 'bg-amber-500 animate-ping' :
                                  isCancelled ? 'bg-red-500' : 'bg-blue-500'
                                }`}></span>
                                <span>{ord.status}</span>
                              </div>
                            </td>

                            {/* تحديث الحالة وإجراءات الطلب */}
                            <td className="py-2 px-3 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1.5">
                                <select
                                  value={ord.status}
                                  onChange={(e) => handleUpdateOrderStatus(ord.id, e.target.value)}
                                  className="py-1 px-3 bg-white border border-gray-200 hover:border-gray-400 rounded-lg text-xs font-medium outline-none cursor-pointer transition text-gray-800"
                                >
                                  <option value="قيد المراجعة">قيد المراجعة</option>
                                  <option value="قيد التنفيذ">قيد التنفيذ</option>
                                  <option value="مكتمل">مكتمل</option>
                                  <option value="ملغي">ملغي</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteOrder(ord.id)}
                                  title="حذف هذا الطلب"
                                  className="w-7 h-7 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition cursor-pointer flex items-center justify-center"
                                >
                                  <i className="fa-solid fa-trash-can text-xs"></i>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* 4. قسم قاعدة العملاء وفريق الإشراف (Customers & Supervision) */}
        {/* ========================================================= */}
        {activeTab === 'customers' && (
          <div className="space-y-6" dir="rtl">
            {/* أزرار الإجراءات العلوية: إضافة عميل + إرسال إشعار */}
            <div className="flex items-center justify-start gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setShowBroadcastModal(true)}
                className="w-fit px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-bold rounded-xl shadow-2xs flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
              >
                <i className="fa-solid fa-bullhorn text-[12px]"></i>
                <span className="leading-none">إرسال إشعار للعملاء</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingCustomer(null);
                  setNewCustomerForm({
                    name: '',
                    email: '',
                    phone: '',
                    role: 'customer',
                    status: 'نشط',
                    tier: 'bronze',
                    notes: '',
                    permissions: { canManageOrders: false, canManageProducts: false, canViewReports: false, canManageCoupons: false }
                  });
                  setShowAddCustomerModal(true);
                }}
                className="w-fit px-3 py-1.5 bg-[#004956] text-white text-[13px] font-bold rounded-xl shadow-2xs hover:opacity-95 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
              >
                <i className="fa-solid fa-user-plus text-[12px]"></i>
                <span className="leading-none">إضافة عميل / مشرف</span>
              </button>
            </div>

            {/* بطاقات المؤشرات بجانب بعضها في صف واحد بدون حدود وبدون خلفية وكل عنصر تحته رقمه */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 py-2 sm:py-3">
              {/* المؤشر 1: إجمالي الحسابات */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-users text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">إجمالي الحسابات</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {customerStats.total}
                </h3>
              </div>

              {/* المؤشر 2: إجمالي رصيد المحافظ */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-indigo-600 mb-1">
                  <i className="fa-solid fa-wallet text-[11px] sm:text-sm"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">أرصدة المحافظ</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-indigo-600 tracking-tight font-mono">
                  {customerStats.totalWalletBalances.toLocaleString('en-US')} <span className="text-[10px] font-sans font-normal">{activeCurrency === 'IQD' ? 'د.ع' : '$'}</span>
                </h3>
              </div>

              {/* المؤشر 3: طاقم الإشراف */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-user-shield text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">طاقم الإشراف</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {customerStats.supervisors + customerStats.admins}
                </h3>
              </div>

              {/* المؤشر 4: الحسابات النشطة */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-circle-check text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">الحسابات النشطة</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {customerStats.active}
                </h3>
              </div>
            </div>

            {/* قسم طلبات شحن المحفظة (الذاتية من العملاء) */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
              <div className="p-3 bg-gradient-to-r from-emerald-50 to-teal-50/50 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#004956] text-white flex items-center justify-center text-xs">
                    <i className="fa-solid fa-wallet"></i>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-gray-900">طلبات شحن المحفظة من العملاء</h3>
                    <span className="text-[10px] text-gray-500">مراجعة إشعارات التحويل والموافقة على إيداع الرصيد</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200" title="المزامنة الفورية اللحظية مفعلة">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                    <span>متزامن لحظياً</span>
                  </span>

                  <button
                    type="button"
                    onClick={handleManualRefreshTopups}
                    disabled={isRefreshingTopups}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-gray-700 bg-white hover:bg-gray-50 active:bg-gray-100 rounded-lg border border-gray-200 transition shadow-2xs cursor-pointer disabled:opacity-50"
                    title="تحقق فوري من السحابة الآن"
                  >
                    <i className={`fa-solid fa-arrows-rotate text-[10px] text-emerald-600 ${isRefreshingTopups ? 'animate-spin' : ''}`}></i>
                    <span>{isRefreshingTopups ? 'جاري التحقق...' : 'تحقق فوري'}</span>
                  </button>

                  {topupRequests.filter(t => t.status === 'معلق').length > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500 text-white animate-pulse">
                      {topupRequests.filter(t => t.status === 'معلق').length} بانتظار المراجعة
                    </span>
                  )}
                </div>
              </div>

              {topupRequests.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-xs space-y-1">
                  <i className="fa-solid fa-receipt text-2xl text-gray-300"></i>
                  <p>لا توجد طلبات شحن رصيد حتى الآن.</p>
                  <p className="text-[10px] text-gray-400">عندما يقوم العميل برفع إشعار تحويل لشحن محفظته سيظهر هنا للموافقة أو الرفض.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-gray-50 text-gray-500 text-[10px] border-b border-gray-100">
                      <tr>
                        <th className="p-2.5">رقم الطلب</th>
                        <th className="p-2.5">العميل</th>
                        <th className="p-2.5">المبلغ المطلوب</th>
                        <th className="p-2.5">طريقة الدفع</th>
                        <th className="p-2.5">إشعار التحويل</th>
                        <th className="p-2.5">التاريخ</th>
                        <th className="p-2.5">الحالة</th>
                        <th className="p-2.5 text-center">الإجراء</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {topupRequests.map((req) => (
                        <tr key={req.id} className="hover:bg-gray-50/60 transition">
                          <td className="p-2.5 font-mono font-bold text-gray-900">{req.id}</td>
                          <td className="p-2.5">
                            <div className="font-bold text-gray-900">{req.customerName}</div>
                            <div className="text-[10px] text-gray-400 font-mono" dir="ltr">{req.customerIdentifier || req.customerPhone || ''}</div>
                          </td>
                          <td className="p-2.5">
                            <span className="font-bold text-emerald-700 font-mono">${req.amountUsd}</span>
                            {req.amountIqd && (
                              <span className="text-[10px] text-gray-400 block">({req.amountIqd.toLocaleString('en-US')} د.ع)</span>
                            )}
                          </td>
                          <td className="p-2.5 font-medium">
                            {{ zaincash: 'زين كاش', binance: 'Binance Pay', iraqimaster: 'ماستر كارد', okx: 'OKX Pay' }[req.method] || req.method}
                          </td>
                          <td className="p-2.5">
                            {req.proof ? (
                              <button
                                type="button"
                                onClick={() => setSelectedTopupProof(req.proof)}
                                className="flex items-center gap-1 text-[11px] text-indigo-600 hover:underline font-bold"
                              >
                                <img src={req.proof} alt="" className="w-8 h-8 rounded object-cover border border-gray-200" />
                                <span>عرض الإشعار</span>
                              </button>
                            ) : (
                              <span className="text-gray-400 text-[10px]">بدون صورة</span>
                            )}
                          </td>
                          <td className="p-2.5 text-[10px] text-gray-500 font-mono">
                            {req.date ? new Date(req.date).toLocaleDateString('ar-IQ') : ''}
                          </td>
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              req.status === 'مقبول' ? 'bg-emerald-100 text-emerald-800' :
                              req.status === 'مرفوض' ? 'bg-red-100 text-red-800' :
                              'bg-amber-100 text-amber-800 animate-pulse'
                            }`}>
                              {req.status || 'معلق'}
                            </span>
                          </td>
                          <td className="p-2.5 text-center">
                            {req.status === 'معلق' ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleApproveTopup(req)}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold shadow-xs cursor-pointer transition"
                                >
                                  ✓ موافقة وإيداع
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRejectTopup(req)}
                                  className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-[11px] font-bold cursor-pointer transition"
                                >
                                  ✕ رفض
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-gray-400 font-medium">تمت المعالجة</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* جدول العملاء والمشرفين الاحترافي مدمج مع أدوات البحث والفلترة */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
              {/* شريط البحث والفلترة مدمج في رأس الصندوق بجانب بعض */}
              <div className="p-2.5 sm:p-3 border-b border-gray-100 flex items-center gap-2">
                {/* شريط البحث المباشر */}
                <div className="relative flex-1 min-w-0">
                  <i className="fa-solid fa-magnifying-glass absolute top-1/2 -translate-y-1/2 right-2.5 text-gray-400 text-[10px]"></i>
                  <input
                    type="text"
                    placeholder="ابحث..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="w-full pr-7 pl-2 py-1.5 bg-gray-50/70 border border-gray-200 rounded-xl text-[11px] sm:text-xs text-gray-800 outline-none focus:border-black focus:bg-white transition"
                  />
                </div>

                {/* أزرار وفلاتر الأدوار والحالة بجانب شريط البحث */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* فلتر الدور */}
                  <select
                    value={customerRoleFilter}
                    onChange={(e) => setCustomerRoleFilter(e.target.value)}
                    className="py-1.5 px-2 bg-gray-50 border border-gray-200 rounded-xl text-[10px] sm:text-[11px] text-gray-700 outline-none cursor-pointer hover:border-gray-400 transition"
                  >
                    <option value="all">كل الأدوار</option>
                    <option value="customer">عملاء</option>
                    <option value="supervisor">مشرفين</option>
                    <option value="admin">مدراء</option>
                  </select>

                  {/* فلتر الحالة */}
                  <select
                    value={customerStatusFilter}
                    onChange={(e) => setCustomerStatusFilter(e.target.value)}
                    className="py-1.5 px-2 bg-gray-50 border border-gray-200 rounded-xl text-[10px] sm:text-[11px] text-gray-700 outline-none cursor-pointer hover:border-gray-400 transition"
                  >
                    <option value="all">كل الحالات</option>
                    <option value="نشط">نشط</option>
                    <option value="محظور">محظور</option>
                  </select>

                  {(customerSearch || customerRoleFilter !== 'all' || customerStatusFilter !== 'all') && (
                    <button
                      onClick={() => { setCustomerSearch(''); setCustomerRoleFilter('all'); setCustomerStatusFilter('all'); }}
                      className="p-1 text-xs text-gray-400 hover:text-black transition cursor-pointer"
                      title="إعادة ضبط"
                    >
                      <i className="fa-solid fa-rotate-left"></i>
                    </button>
                  )}
                </div>
              </div>

              {/* الجدول بتصميم مدمج يناسب الجوال */}
              <div className="w-full overflow-x-auto">
                <table className="w-full text-right text-[10px] sm:text-xs">
                  <thead className="bg-[#F9FAFB] border-b border-gray-200 text-gray-500 font-semibold text-[9px] sm:text-[11px]">
                    <tr>
                      <th className="py-2.5 px-2.5 sm:px-4 font-semibold text-gray-600">العميل</th>
                      <th className="py-2.5 px-2 sm:px-3 font-semibold text-gray-600">الدور</th>
                      <th className="py-2.5 px-2 sm:px-3 font-semibold text-gray-600 hidden sm:table-cell">بيانات الاتصال</th>
                      <th className="py-2.5 px-1.5 sm:px-3 font-semibold text-gray-600 text-center">الطلبات</th>
                      <th className="py-2.5 px-1.5 sm:px-3 font-semibold text-gray-600 text-center">الحالة</th>
                      <th className="py-2.5 px-2 sm:px-4 font-semibold text-gray-600 text-center">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredCustomers.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="p-6 text-center text-gray-400">
                          <i className="fa-solid fa-user-slash text-2xl block mb-1 text-gray-300"></i>
                          <span>لا توجد نتائج مطابقة</span>
                        </td>
                      </tr>
                    ) : (
                      filteredCustomers.map((c) => {
                        const isAdmin = c.role === 'admin';
                        const isSupervisor = c.role === 'supervisor';
                        const isBlocked = c.status === 'محظور';

                        return (
                          <tr key={c.id} className="hover:bg-gray-50/70 transition-colors">
                            {/* المستخدم / العميل */}
                            <td className="py-2.5 px-2.5 sm:px-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                                  isAdmin ? 'bg-black text-white' :
                                  isSupervisor ? 'bg-amber-100 text-amber-800' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  {c.name ? c.name.charAt(0) : 'U'}
                                </div>
                                <div>
                                  <div className="font-bold text-gray-900 text-[11px] sm:text-xs truncate max-w-[120px] sm:max-w-none">
                                    {c.name}
                                  </div>
                                  <span className="text-[9px] text-gray-400 block font-mono">
                                    {c.phone || c.email}
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* الدور وصلاحية الإشراف */}
                            <td className="py-2.5 px-2 sm:px-3 whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                <span className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold ${
                                  isAdmin ? 'bg-black text-white' :
                                  isSupervisor ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                                  'bg-gray-100 text-gray-700'
                                }`}>
                                  <i className={`fa-solid ${isAdmin ? 'fa-crown' : isSupervisor ? 'fa-user-shield' : 'fa-user'} text-[8px] sm:text-[9px]`}></i>
                                  <span>{isAdmin ? 'مدير' : isSupervisor ? 'مشرف' : 'عميل'}</span>
                                </span>
                              </div>
                            </td>

                            {/* بيانات الاتصال (تظهر على الشاشات الأكبر) */}
                            <td className="py-2.5 px-2 sm:px-3 hidden sm:table-cell whitespace-nowrap">
                              <div className="text-gray-800 font-mono text-[11px] flex items-center gap-1" dir="ltr">
                                <i className="fa-regular fa-envelope text-gray-400 text-[10px]"></i>
                                <span>{c.email}</span>
                              </div>
                              <div className="text-gray-600 font-mono text-[11px] mt-0.5 flex items-center gap-1" dir="ltr">
                                <i className="fa-solid fa-phone text-gray-400 text-[10px]"></i>
                                <span>{c.phone}</span>
                              </div>
                            </td>

                            {/* الطلبات */}
                            <td className="py-2.5 px-1.5 sm:px-3 text-center whitespace-nowrap">
                              <span className="font-bold text-gray-900 font-mono text-[11px] sm:text-xs">
                                {c.ordersCount || 0}
                              </span>
                            </td>

                            {/* حالة الحساب */}
                            <td className="py-2.5 px-1.5 sm:px-3 text-center whitespace-nowrap">
                              <div className="inline-flex items-center justify-center gap-1 text-[10px] font-medium text-gray-800">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isBlocked ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
                                <span className="hidden sm:inline">{c.status}</span>
                              </div>
                            </td>

                            {/* الإجراءات: أيقونات بدون خلفية وبدون حدود */}
                            <td className="py-2.5 px-2 sm:px-4 text-center whitespace-nowrap">
                              <div className="inline-flex items-center justify-center gap-1 sm:gap-2">
                                {/* زر عرض التفاصيل */}
                                <button
                                  type="button"
                                  onClick={() => setSelectedCustomerForView(c)}
                                  className="text-gray-500 hover:text-black transition cursor-pointer p-1"
                                  title="عرض بطاقة الحساب"
                                >
                                  <i className="fa-solid fa-eye text-xs"></i>
                                </button>

                                {/* زر تعديل الحساب */}
                                <button
                                  type="button"
                                  onClick={() => openEditCustomerModal(c)}
                                  className="text-gray-500 hover:text-black transition cursor-pointer p-1"
                                  title="تعديل البيانات والصلاحيات"
                                >
                                  <i className="fa-solid fa-pen-to-square text-xs"></i>
                                </button>

                                {/* زر حظر / إلغاء الحظر */}
                                <button
                                  type="button"
                                  onClick={() => toggleCustomerStatus(c.id)}
                                  className={`transition cursor-pointer p-1 ${
                                    isBlocked 
                                      ? 'text-emerald-600 hover:text-emerald-700' 
                                      : 'text-gray-500 hover:text-red-600'
                                  }`}
                                  title={isBlocked ? 'إلغاء الحظر' : 'حظر الحساب'}
                                >
                                  <i className={`fa-solid ${isBlocked ? 'fa-lock-open' : 'fa-ban'} text-xs`}></i>
                                </button>

                                {/* زر حذف الحساب */}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCustomer(c.id)}
                                  className="text-gray-400 hover:text-red-600 transition cursor-pointer p-1"
                                  title="حذف نهائي"
                                >
                                  <i className="fa-solid fa-trash-can text-xs"></i>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* نافذة منبثقة (Modal) لإضافة أو تعديل عميل / مشرف مع تحديد الصلاحيات */}
            {showAddCustomerModal && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                <div className="bg-[#F9FAFB] rounded-3xl border-0 max-w-xl w-full p-4 shadow-xl space-y-5 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                  
                  <div className="flex items-center justify-between pb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center">
                        <i className={`fa-solid ${editingCustomer ? 'fa-user-pen' : 'fa-user-plus'} text-xs`}></i>
                      </div>
                      <h3 className="font-bold text-gray-900 text-[11px] sm:text-xs">
                        {editingCustomer ? `تعديل الحساب والصلاحيات (${editingCustomer.id})` : 'إضافة حساب عميل / مشرف جديد'}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddCustomerModal(false)}
                      className="text-gray-400 hover:text-black w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition cursor-pointer"
                    >
                      <i className="fa-solid fa-xmark text-sm"></i>
                    </button>
                  </div>

                  <form onSubmit={handleSaveCustomer} className="space-y-4 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block font-bold text-gray-700 mb-1">الاسم الكامل *</label>
                        <input
                          type="text"
                          required
                          value={newCustomerForm.name}
                          onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })}
                          placeholder="مثال: أحمد محمد"
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black transition"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-gray-700 mb-1">رقم الهاتف</label>
                        <input
                          type="text"
                          value={newCustomerForm.phone}
                          onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })}
                          placeholder="مثال: 07801122334"
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black transition font-mono"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block font-bold text-gray-700 mb-1">البريد الإلكتروني</label>
                        <input
                          type="email"
                          value={newCustomerForm.email}
                          onChange={(e) => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })}
                          placeholder="example@mail.com"
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black transition font-mono"
                          dir="ltr"
                        />
                      </div>

                      <div>
                        <label className="block font-bold text-gray-700 mb-1">دور الحساب ومستوى الصلاحية *</label>
                        <select
                          value={newCustomerForm.role}
                          onChange={(e) => {
                            const newR = e.target.value;
                            setNewCustomerForm({
                              ...newCustomerForm,
                              role: newR,
                              permissions: {
                                canManageOrders: newR === 'admin' || newR === 'supervisor',
                                canManageProducts: newR === 'admin',
                                canViewReports: newR === 'admin' || newR === 'supervisor',
                                canManageCoupons: newR === 'admin' || newR === 'supervisor'
                              }
                            });
                          }}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black transition font-semibold"
                        >
                          <option value="customer">عميل عادي (مشتري)</option>
                          <option value="supervisor">مشرف متجر (Supervisor 🛡️)</option>
                          <option value="admin">مدير عام (Administrator 👑)</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block font-bold text-gray-700 mb-1">حالة الحساب</label>
                        <select
                          value={newCustomerForm.status}
                          onChange={(e) => setNewCustomerForm({ ...newCustomerForm, status: e.target.value })}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black transition"
                        >
                          <option value="نشط">نشط ومفعل</option>
                          <option value="محظور">محظور وموقوف</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-bold text-gray-700 mb-1 flex items-center justify-between">
                          <span>رصيد المحفظة ({activeCurrency === 'IQD' ? 'د.ع' : '$'})</span>
                          <span className="text-[10px] text-indigo-600 font-normal">يظهر في محفظة العميل</span>
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={newCustomerForm.balance}
                            onChange={(e) => setNewCustomerForm({ ...newCustomerForm, balance: e.target.value })}
                            placeholder="0"
                            className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black transition font-mono font-bold"
                          />
                          <i className="fa-solid fa-wallet absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 text-xs"></i>
                        </div>
                      </div>
                    </div>

                    {/* قسم صلاحيات الإشراف المتقدمة */}
                    <div className="p-3.5 bg-gray-100/80 rounded-2xl border-0 space-y-2.5">
                      <div className="font-bold text-gray-900 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <i className="fa-solid fa-shield-halved text-black"></i>
                          <span>صلاحيات لوحة التحكم الممنوحة لهذا الحساب:</span>
                        </span>
                        <span className="text-[10px] text-gray-400 font-normal">تخصيص مباشر</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        <label className="flex items-center gap-2 p-2 bg-white rounded-xl border-0 shadow-2xs cursor-pointer hover:bg-gray-50 transition">
                          <input
                            type="checkbox"
                            checked={newCustomerForm.permissions?.canManageOrders || false}
                            onChange={(e) => setNewCustomerForm({
                              ...newCustomerForm,
                              permissions: { ...newCustomerForm.permissions, canManageOrders: e.target.checked }
                            })}
                            className="rounded accent-black w-4 h-4 cursor-pointer"
                          />
                          <span className="font-medium text-gray-800">إدارة ومراجعة الطلبات والإيصالات</span>
                        </label>

                        <label className="flex items-center gap-2 p-2 bg-white rounded-xl border-0 shadow-2xs cursor-pointer hover:bg-gray-50 transition">
                          <input
                            type="checkbox"
                            checked={newCustomerForm.permissions?.canManageProducts || false}
                            onChange={(e) => setNewCustomerForm({
                              ...newCustomerForm,
                              permissions: { ...newCustomerForm.permissions, canManageProducts: e.target.checked }
                            })}
                            className="rounded accent-black w-4 h-4 cursor-pointer"
                          />
                          <span className="font-medium text-gray-800">إضافة وتعديل وحذف المنتجات</span>
                        </label>

                        <label className="flex items-center gap-2 p-2 bg-white rounded-xl border-0 shadow-2xs cursor-pointer hover:bg-gray-50 transition">
                          <input
                            type="checkbox"
                            checked={newCustomerForm.permissions?.canManageCoupons || false}
                            onChange={(e) => setNewCustomerForm({
                              ...newCustomerForm,
                              permissions: { ...newCustomerForm.permissions, canManageCoupons: e.target.checked }
                            })}
                            className="rounded accent-black w-4 h-4 cursor-pointer"
                          />
                          <span className="font-medium text-gray-800">إدارة كوبونات وعروض الخصم</span>
                        </label>

                        <label className="flex items-center gap-2 p-2 bg-white rounded-xl border-0 shadow-2xs cursor-pointer hover:bg-gray-50 transition">
                          <input
                            type="checkbox"
                            checked={newCustomerForm.permissions?.canViewReports || false}
                            onChange={(e) => setNewCustomerForm({
                              ...newCustomerForm,
                              permissions: { ...newCustomerForm.permissions, canViewReports: e.target.checked }
                            })}
                            className="rounded accent-black w-4 h-4 cursor-pointer"
                          />
                          <span className="font-medium text-gray-800">الاطلاع على التقارير المالية</span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">ملاحظات إدارية داخلية (اختياري)</label>
                      <textarea
                        rows="2"
                        value={newCustomerForm.notes}
                        onChange={(e) => setNewCustomerForm({ ...newCustomerForm, notes: e.target.value })}
                        placeholder="سجل أي ملاحظات خاصة بهذا العميل أو المشرف..."
                        className="w-full px-3 py-2 bg-white rounded-xl outline-none focus:ring-1 focus:ring-black transition resize-none border-0"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2.5 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowAddCustomerModal(false)}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl font-bold transition cursor-pointer"
                      >
                        إلغاء
                      </button>
                      <button
                        type="submit"
                        className="px-6 py-2 bg-black hover:bg-gray-800 text-white font-bold rounded-xl shadow-xs transition cursor-pointer flex items-center gap-2"
                      >
                        <i className="fa-solid fa-check text-xs"></i>
                        <span>{editingCustomer ? 'حفظ التعديلات' : 'إضافة الحساب'}</span>
                      </button>
                    </div>
                  </form>

                </div>
              </div>
            )}

            {/* نافذة منبثقة لمعاينة الملف الكامل للعميل / المشرف (Customer Detail Card) */}
            {selectedCustomerForView && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                <div className="bg-[#F9FAFB] rounded-3xl border-0 max-w-md w-full p-4 shadow-xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
                  
                  <div className="flex items-center justify-between pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-xl flex items-center justify-center font-bold text-sm ${
                        selectedCustomerForView.role === 'admin' ? 'bg-black text-white' :
                        selectedCustomerForView.role === 'supervisor' ? 'bg-amber-100 text-amber-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {selectedCustomerForView.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 text-sm">{selectedCustomerForView.name}</h3>
                        <span className="text-[10px] text-gray-400 font-mono">{selectedCustomerForView.id}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedCustomerForView(null)}
                      className="text-gray-400 hover:text-black w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center transition cursor-pointer"
                    >
                      <i className="fa-solid fa-xmark text-sm"></i>
                    </button>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-2 bg-gray-100/80 p-3 rounded-2xl border-0">
                      <div>
                        <span className="text-[10px] text-gray-400 block">الدور الحالي:</span>
                        <span className="font-bold text-gray-900">
                          {selectedCustomerForView.role === 'admin' ? '👑 مدير عام' :
                           selectedCustomerForView.role === 'supervisor' ? '🛡️ مشرف متجر' : '👤 عميل عادي'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-gray-400 block">إجمالي الطلبات:</span>
                        <span className="font-bold text-gray-900 font-mono">{selectedCustomerForView.ordersCount || 0} طلب</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <div className="flex justify-between items-center py-1 border-b border-gray-100">
                        <span className="text-gray-500">البريد الإلكتروني:</span>
                        <span className="font-mono text-gray-800" dir="ltr">{selectedCustomerForView.email}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-gray-100">
                        <span className="text-gray-500">رقم الهاتف:</span>
                        <span className="font-mono text-gray-800" dir="ltr">{selectedCustomerForView.phone}</span>
                      </div>
                      <div className="flex justify-between items-center py-1 border-b border-gray-100">
                        <span className="text-gray-500">تاريخ التسجيل:</span>
                        <span className="font-mono text-gray-800">{selectedCustomerForView.joinDate}</span>
                      </div>
                      {/* رصيد المحفظة الفعلي */}
                      <div className="flex justify-between items-center py-2 border-b border-gray-100 bg-indigo-50/50 -mx-3 px-3 rounded-xl mt-1">
                        <div className="flex items-center gap-1.5 text-indigo-900 font-bold">
                          <i className="fa-solid fa-wallet text-indigo-600"></i>
                          <span>رصيد المحفظة:</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-sm text-indigo-700">
                            {parseFloat(selectedCustomerForView.balance || 0).toLocaleString('en-US')} {activeCurrency === 'IQD' ? 'د.ع' : '$'}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const c = selectedCustomerForView;
                              setWalletModalCustomer(c);
                              setWalletAmountInput('');
                              setWalletActionType('deposit');
                              setWalletNoteInput('');
                            }}
                            className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer"
                          >
                            <i className="fa-solid fa-plus text-[9px]"></i>
                            <span>شحن</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* الصلاحيات الممنوحة */}
                    <div className="pt-2">
                      <span className="font-bold text-gray-900 block mb-1.5">الصلاحيات الإشرافية المتاحة:</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className={`p-1.5 rounded-lg text-[10px] flex items-center gap-1 font-medium ${
                          selectedCustomerForView.permissions?.canManageOrders ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-400 line-through'
                        }`}>
                          <i className={`fa-solid ${selectedCustomerForView.permissions?.canManageOrders ? 'fa-check' : 'fa-xmark'}`}></i>
                          <span>إدارة الطلبات</span>
                        </div>
                        <div className={`p-1.5 rounded-lg text-[10px] flex items-center gap-1 font-medium ${
                          selectedCustomerForView.permissions?.canManageProducts ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-400 line-through'
                        }`}>
                          <i className={`fa-solid ${selectedCustomerForView.permissions?.canManageProducts ? 'fa-check' : 'fa-xmark'}`}></i>
                          <span>إدارة المنتجات</span>
                        </div>
                        <div className={`p-1.5 rounded-lg text-[10px] flex items-center gap-1 font-medium ${
                          selectedCustomerForView.permissions?.canManageCoupons ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-400 line-through'
                        }`}>
                          <i className={`fa-solid ${selectedCustomerForView.permissions?.canManageCoupons ? 'fa-check' : 'fa-xmark'}`}></i>
                          <span>إدارة الكوبونات</span>
                        </div>
                        <div className={`p-1.5 rounded-lg text-[10px] flex items-center gap-1 font-medium ${
                          selectedCustomerForView.permissions?.canViewReports ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-400 line-through'
                        }`}>
                          <i className={`fa-solid ${selectedCustomerForView.permissions?.canViewReports ? 'fa-check' : 'fa-xmark'}`}></i>
                          <span>التقارير المالية</span>
                        </div>
                      </div>
                    </div>

                    {/* سجل حركات المحفظة */}
                    {selectedCustomerForView.walletTransactions && selectedCustomerForView.walletTransactions.length > 0 && (
                      <div className="pt-2 border-t border-gray-100">
                        <span className="font-bold text-gray-900 block mb-1.5 text-[11px]">
                          سجل حركات المحفظة الأخيرة:
                        </span>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {selectedCustomerForView.walletTransactions.slice(0, 5).map((tx, idx) => (
                            <div key={idx} className="flex items-center justify-between p-1.5 bg-gray-50 rounded-lg text-[10px]">
                              <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${tx.type === 'deposit' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                                <span className="text-gray-700 font-medium truncate max-w-[140px]">{tx.title}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className={`font-mono font-bold ${tx.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {tx.type === 'deposit' ? '+' : '-'}{tx.amount}
                                </span>
                                <span className="text-[9px] text-gray-400">{activeCurrency === 'IQD' ? 'د.ع' : '$'}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedCustomerForView.notes && (
                      <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200/60 text-amber-900 text-[11px] mt-2">
                        <span className="font-bold block mb-0.5">ملاحظات الإدارة:</span>
                        <p>{selectedCustomerForView.notes}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => {
                        const c = selectedCustomerForView;
                        setWalletModalCustomer(c);
                        setWalletAmountInput('');
                        setWalletActionType('deposit');
                        setWalletNoteInput('');
                      }}
                      className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                    >
                      <i className="fa-solid fa-wallet text-xs"></i>
                      <span>شحن رصيد المحفظة</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const target = selectedCustomerForView;
                          setSelectedCustomerForView(null);
                          openEditCustomerModal(target);
                        }}
                        className="px-3 py-2 bg-black hover:bg-gray-800 text-white rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                      >
                        <i className="fa-solid fa-pen-to-square text-xs"></i>
                        <span>تعديل</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCustomerForView(null)}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition cursor-pointer"
                      >
                        إغلاق
                      </button>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* نافذة شحن وتعديل رصيد المحفظة المخصصة (Wallet Top-up Modal) */}
            {walletModalCustomer && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
                <div className="bg-white rounded-3xl border border-gray-100 max-w-md w-full p-4 shadow-xl space-y-5 animate-in zoom-in-95 duration-200 text-right" dir="rtl">
                  
                  {/* رأس النافذة */}
                  <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-2xl bg-[#EEF2FF] text-[#4F46E5] flex items-center justify-center text-base shadow-2xs">
                        <i className="fa-solid fa-wallet"></i>
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 text-[11px] sm:text-xs">إضافة وتعديل رصيد المحفظة</h3>
                        <p className="text-[11px] text-gray-500 font-normal">
                          العميل: <span className="font-bold text-gray-800">{walletModalCustomer.name}</span>
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setWalletModalCustomer(null)}
                      className="text-gray-400 hover:text-black w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition cursor-pointer"
                    >
                      <i className="fa-solid fa-xmark text-sm"></i>
                    </button>
                  </div>

                  {/* بطاقة الرصيد الحالي للعميل */}
                  <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-gray-400 block mb-0.5">رصيد المحفظة الحالي:</span>
                      <div className="flex items-baseline gap-1">
                        <span className="text-xl font-black text-gray-900 font-mono">
                          {parseFloat(walletModalCustomer.balance || 0).toLocaleString('en-US')}
                        </span>
                        <span className="text-xs font-bold text-gray-600 font-sans">
                          {activeCurrency === 'IQD' ? 'د.ع' : '$'}
                        </span>
                      </div>
                    </div>
                    <div className="text-left">
                      <span className="text-[10px] text-gray-400 block mb-0.5">معرف الحساب:</span>
                      <span className="text-[11px] font-mono text-gray-700 font-semibold" dir="ltr">
                        {walletModalCustomer.phone || walletModalCustomer.email || walletModalCustomer.id}
                      </span>
                    </div>
                  </div>

                  {/* نموذج شحن الرصيد */}
                  <form onSubmit={handleUpdateCustomerWallet} className="space-y-4 text-xs">
                    
                    {/* نوع العملية: إيداع / خصم / تعيين */}
                    <div>
                      <label className="block font-bold text-gray-700 mb-1.5">نوع العملية</label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setWalletActionType('deposit')}
                          className={`p-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            walletActionType === 'deposit'
                              ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <i className="fa-solid fa-plus-circle text-xs"></i>
                          <span>إيداع رصيد</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setWalletActionType('deduct')}
                          className={`p-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            walletActionType === 'deduct'
                              ? 'bg-red-600 border-red-600 text-white shadow-xs'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <i className="fa-solid fa-minus-circle text-xs"></i>
                          <span>خصم رصيد</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setWalletActionType('set')}
                          className={`p-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            walletActionType === 'set'
                              ? 'bg-black border-black text-white shadow-xs'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <i className="fa-solid fa-pen-ruler text-xs"></i>
                          <span>تحديد مباشر</span>
                        </button>
                      </div>
                    </div>

                    {/* حقل إدخال المبلغ */}
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">
                        المبلغ المطلوب {walletActionType === 'deposit' ? 'إضافته للمحفظة' : walletActionType === 'deduct' ? 'خصمه من المحفظة' : 'تعيينه كرصيد كلي'} *
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          required
                          value={walletAmountInput}
                          onChange={(e) => setWalletAmountInput(e.target.value)}
                          placeholder="أدخل المبلغ هنا..."
                          className="w-full pl-12 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[#4F46E5] focus:bg-white transition text-sm font-mono font-bold"
                          autoFocus
                        />
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500 font-sans">
                          {activeCurrency === 'IQD' ? 'د.ع' : '$'}
                        </span>
                      </div>
                      <div className="flex gap-1.5 mt-2">
                        {[5, 10, 20, 50, 100].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setWalletAmountInput(String(preset))}
                            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[10px] font-mono font-semibold transition cursor-pointer"
                          >
                            +{preset}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* سبب أو بيان العملية في سجل العمليات */}
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">بيان العملية (يظهر في سجل عمليات العميل)</label>
                      <input
                        type="text"
                        value={walletNoteInput}
                        onChange={(e) => setWalletNoteInput(e.target.value)}
                        placeholder="مثال: تعويض، مكافأة مسابقة، شحن يدوي..."
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black focus:bg-white transition text-xs"
                      />
                    </div>

                    {/* أزرار الإجراءات */}
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => setWalletModalCustomer(null)}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-xl font-bold transition cursor-pointer text-xs"
                      >
                        إلغاء
                      </button>
                      <button
                        type="submit"
                        className={`px-5 py-2.5 text-white font-bold rounded-xl shadow-xs transition cursor-pointer flex items-center gap-2 text-xs ${
                          walletActionType === 'deposit'
                            ? 'bg-emerald-600 hover:bg-emerald-700'
                            : walletActionType === 'deduct'
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-black hover:bg-gray-800'
                        }`}
                      >
                        <i className={`fa-solid ${
                          walletActionType === 'deposit' ? 'fa-plus' : walletActionType === 'deduct' ? 'fa-minus' : 'fa-check'
                        } text-xs`}></i>
                        <span>
                          {walletActionType === 'deposit' ? 'تأكيد إضافة الرصيد' : walletActionType === 'deduct' ? 'تأكيد الخصم' : 'تأكيد تعديل الرصيد'}
                        </span>
                      </button>
                    </div>

                  </form>

                </div>
              </div>
            )}

            {/* نافذة تكبير إشعار التحويل الخاص بطلب شحن المحفظة */}
            {selectedTopupProof && (
              <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedTopupProof(null)}>
                <div className="relative max-w-lg max-h-[90vh] bg-white rounded-3xl overflow-hidden p-3 shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-100">
                    <span className="font-bold text-xs text-gray-900">إشعار التحويل البنكي / المحفظة</span>
                    <button
                      type="button"
                      onClick={() => setSelectedTopupProof(null)}
                      className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center text-xs cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                  <img src={selectedTopupProof} alt="إشعار التحويل" className="max-w-full max-h-[75vh] object-contain rounded-2xl mx-auto" />
                </div>
              </div>
            )}

            {/* نافذة إرسال إشعار لحظي للعملاء (Broadcast In-App Notification) */}
            {showBroadcastModal && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-3xl border border-gray-100 max-w-md w-full p-4 shadow-xl space-y-4 text-right" dir="rtl">
                  <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs">
                        <i className="fa-solid fa-bullhorn"></i>
                      </div>
                      <h3 className="font-bold text-gray-900 text-sm">إرسال إشعار فوري للعملاء</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowBroadcastModal(false)}
                      className="text-gray-400 hover:text-black w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs"
                    >
                      ✕
                    </button>
                  </div>

                  <form onSubmit={handleSendBroadcastNotification} className="space-y-3 text-xs">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1">المستلمون:</label>
                      <select
                        value={broadcastTarget}
                        onChange={(e) => setBroadcastTarget(e.target.value)}
                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl outline-none"
                      >
                        <option value="all">📢 جميع العملاء المسجلين ({customers.length})</option>
                        {customers.map(c => (
                          <option key={c.id} value={c.id}>
                            👤 {c.name} ({c.phone || c.email || c.identifier || c.id})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">عنوان الإشعار:</label>
                      <input
                        type="text"
                        required
                        placeholder="مثال: خصومات حصرية لليوم فقط! 🔥"
                        value={broadcastTitle}
                        onChange={(e) => setBroadcastTitle(e.target.value)}
                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1">نص الرسالة / التفاصيل:</label>
                      <textarea
                        rows={3}
                        required
                        placeholder="اكتب تفاصيل الإعلان أو التنبيه الذي سيصل للعميل في تبويب الإشعارات..."
                        value={broadcastMessage}
                        onChange={(e) => setBroadcastMessage(e.target.value)}
                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white resize-none"
                      ></textarea>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => setShowBroadcastModal(false)}
                        className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-xl font-bold"
                      >
                        إلغاء
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-xs flex items-center gap-1.5"
                      >
                        <i className="fa-solid fa-paper-plane text-xs"></i>
                        <span>إرسال الإشعار الآن</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ========================================================= */}
        {/* 5. قسم كوبونات الخصم والتسويق (Coupons & Discounts)       */}
        {/* ========================================================= */}

        {/* ========================================================= */}
        {/* 5. قسم كوبونات الخصم والتسويق (Coupons & Discounts)       */}
        {/* ========================================================= */}
        {/* ========================================================= */}
        {/* 5. قسم كوبونات الخصم والتسويق (Coupons & Discounts)       */}
        {/* ========================================================= */}
        {activeTab === 'coupons' && (
          <div className="space-y-6">
            {/* زر إضافة كوبون */}
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowAddCouponModal(!showAddCouponModal)}
                className="w-fit px-3 py-1.5 bg-[#004956] text-white text-[13px] font-bold rounded-xl shadow-2xs hover:opacity-95 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
              >
                <i className={`fa-solid ${showAddCouponModal ? 'fa-xmark' : 'fa-plus'} text-[12px]`}></i>
                <span className="leading-none">{showAddCouponModal ? 'إلغاء النافذة' : 'إنشاء كوبون جديد'}</span>
              </button>
            </div>

            {/* بطاقات المؤشرات بجانب بعضها في صف واحد بدون حدود وبدون خلفية وكل عنصر تحته رقمه */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4 py-2 sm:py-3">
              {/* المؤشر 1: إجمالي الكوبونات */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-receipt text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">إجمالي الكوبونات</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {couponStats.total}
                </h3>
              </div>

              {/* المؤشر 2: الكوبونات النشطة */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-circle-check text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">الكوبونات النشطة</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {couponStats.active}
                </h3>
              </div>

              {/* المؤشر 3: مرات الاستخدام */}
              <div className="text-center flex flex-col items-center justify-center p-1 sm:p-2">
                <div className="flex items-center justify-center gap-1 sm:gap-1.5 text-gray-500 mb-1">
                  <i className="fa-solid fa-users text-[11px] sm:text-sm text-gray-700"></i>
                  <span className="text-[10px] sm:text-xs font-semibold truncate">مرات الاستخدام</span>
                </div>
                <h3 className="text-base sm:text-xl md:text-2xl font-black text-gray-900 tracking-tight font-mono">
                  {couponStats.totalUsages}
                </h3>
              </div>
            </div>

            {/* نافذة / نموذج إنشاء وتعديل كوبون متقدم */}
            {showAddCouponModal && (
              <form onSubmit={handleAddCoupon} className="bg-white p-5 rounded-2xl border border-black space-y-5 shadow-sm animate-fadeIn">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center gap-2">
                    <i className={`fa-solid ${editingCoupon ? 'fa-pen-to-square' : 'fa-wand-magic-sparkles'} text-black text-sm`}></i>
                    <h3 className="text-sm font-bold text-black">
                      {editingCoupon ? `تعديل كود الخصم (${editingCoupon.code})` : 'تخصيص وإنشاء كود خصم ترويجي متقدم'}
                    </h3>
                  </div>
                  <span className="text-[11px] text-gray-400">جميع الحقول قابلة للتعديل</span>
                </div>

                {/* الصف الأول: الرمز والنسبة والحدود */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1">
                      رمز الكوبون (Coupon Code) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: SUMMER25"
                      value={newCouponCode}
                      onChange={(e) => setNewCouponCode(e.target.value)}
                      className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono uppercase font-bold text-black outline-none focus:border-black"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1">
                      نسبة الخصم (%) *
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        required
                        placeholder="15"
                        value={newCouponDiscount}
                        onChange={(e) => setNewCouponDiscount(e.target.value)}
                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono font-bold text-black outline-none focus:border-black pl-7"
                      />
                      <span className="absolute left-3 top-2.5 text-xs text-gray-400 font-bold">%</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1">
                      الحد الأقصى لعدد مرات الاستخدام
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={newCouponLimit}
                      onChange={(e) => setNewCouponLimit(e.target.value)}
                      className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono text-black outline-none focus:border-black"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1">
                      تاريخ انتهاء الصلاحية
                    </label>
                    <input
                      type="date"
                      value={newCouponExpiry}
                      onChange={(e) => setNewCouponExpiry(e.target.value)}
                      className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono text-black outline-none focus:border-black"
                    />
                  </div>
                </div>

                {/* الصف الثاني: شروط الحد الأدنى للطلب ونطاق التطبيق */}
                <div className="pt-2 border-t border-gray-100">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-4">
                    {editingCoupon ? (
                      <div className="sm:col-span-1">
                        <label className="block text-[11px] font-bold text-gray-700 mb-1">
                          الحد الأدنى لقيمة السلة ($ USD)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          placeholder="0 (بدون حد أدنى)"
                          value={newCouponMinOrder}
                          onChange={(e) => setNewCouponMinOrder(e.target.value)}
                          className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono text-black outline-none focus:border-black"
                        />
                        <span className="text-[10px] text-gray-400 mt-1 block">
                          اتركه فارغاً لتطبيق الخصم على أي مبلغ
                        </span>
                      </div>
                    ) : null}

                    <div className={editingCoupon ? "sm:col-span-2" : "sm:col-span-3"}>
                      <label className="block text-[11px] font-bold text-gray-700 mb-2">
                        نطاق تطبيق كود الخصم على المنتجات:
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setNewCouponTargetType('all')}
                          className={`p-2.5 rounded-xl border text-right transition cursor-pointer flex flex-col justify-between text-xs ${
                            newCouponTargetType === 'all'
                              ? 'border-black bg-gray-50 font-bold text-black'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <i className="fa-solid fa-boxes-stacked text-xs"></i>
                            <span>جميع المنتجات</span>
                          </span>
                          <span className="text-[10px] text-gray-400 font-normal mt-1">يشمل كامل المتجر</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setNewCouponTargetType('specific')}
                          className={`p-2.5 rounded-xl border text-right transition cursor-pointer flex flex-col justify-between text-xs ${
                            newCouponTargetType === 'specific'
                              ? 'border-black bg-gray-50 font-bold text-black'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <i className="fa-solid fa-check-double text-xs"></i>
                            <span>منتجات محددة فقط</span>
                          </span>
                          <span className="text-[10px] text-gray-400 font-normal mt-1">يُطبق على المختار فقط</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setNewCouponTargetType('excluded')}
                          className={`p-2.5 rounded-xl border text-right transition cursor-pointer flex flex-col justify-between text-xs ${
                            newCouponTargetType === 'excluded'
                              ? 'border-black bg-gray-50 font-bold text-black'
                              : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <i className="fa-solid fa-ban text-xs"></i>
                            <span>استثناء منتجات</span>
                          </span>
                          <span className="text-[10px] text-gray-400 font-normal mt-1">يستثني منتجات مختارة</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* قائمة تحديد المنتجات (تظهر فقط عند اختيار محددة أو استثناء) */}
                  {(newCouponTargetType === 'specific' || newCouponTargetType === 'excluded') && (
                    <div className="mt-3 p-3.5 bg-gray-50/70 border border-gray-200 rounded-xl space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <i className="fa-solid fa-list-check text-black text-xs"></i>
                          <span className="text-xs font-bold text-black">
                            {newCouponTargetType === 'specific'
                              ? 'اختر المنتجات التي يسري عليها الكود:'
                              : 'اختر المنتجات المستثناة من الكود:'}
                          </span>
                          <span className="text-[11px] font-mono font-bold text-black border border-gray-300 px-2 py-0.5 rounded-md">
                            {newCouponProductIds.length} محدد
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="بحث في المنتجات..."
                            value={newCouponProductSearch}
                            onChange={(e) => setNewCouponProductSearch(e.target.value)}
                            className="p-1.5 px-2.5 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:border-black"
                          />
                          {newCouponProductIds.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setNewCouponProductIds([])}
                              className="text-[10px] text-gray-500 hover:text-black underline cursor-pointer"
                            >
                              إلغاء التحديد
                            </button>
                          )}
                        </div>
                      </div>

                      {/* شبكة اختيار المنتجات */}
                      <div className="max-h-48 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-1">
                        {products
                          .filter(p => !newCouponProductSearch.trim() || p.title.toLowerCase().includes(newCouponProductSearch.toLowerCase()) || (p.category && p.category.toLowerCase().includes(newCouponProductSearch.toLowerCase())))
                          .map((prod) => {
                            const isSelected = newCouponProductIds.includes(prod.id);
                            return (
                              <div
                                key={prod.id}
                                onClick={() => toggleCouponProductSelection(prod.id)}
                                className={`p-2 rounded-xl border flex items-center gap-2.5 cursor-pointer transition select-none ${
                                  isSelected
                                    ? 'border-black bg-white shadow-2xs font-bold'
                                    : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700'
                                }`}
                              >
                                <div className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                                  isSelected ? 'border-black bg-black text-white' : 'border-gray-300 bg-white'
                                }`}>
                                  {isSelected && '✓'}
                                </div>
                                <img
                                  src={prod.imageUrl}
                                  alt=""
                                  className="w-8 h-8 rounded-lg object-cover border border-gray-100 flex-shrink-0"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] text-black truncate">{prod.title}</div>
                                  <div className="text-[9px] text-gray-400 truncate">{prod.category} · ${prod.price}</div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>

                {/* أزرار الإجراء للنموذج */}
                <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCoupon(null);
                      setShowAddCouponModal(false);
                    }}
                    className="px-4 py-2 border border-gray-200 text-gray-600 hover:text-black text-xs font-medium rounded-xl cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-black hover:bg-gray-800 text-white text-xs font-bold rounded-xl transition shadow-xs cursor-pointer flex items-center gap-1.5"
                  >
                    <i className="fa-solid fa-check text-xs"></i>
                    <span>{editingCoupon ? 'حفظ تعديلات الكوبون' : 'حفظ وتفعيل الكوبون'}</span>
                  </button>
                </div>
              </form>
            )}

            {/* جدول عرض الكوبونات المطور والحيوي مدمج مع شريط الفلترة والبحث في كتلة واحدة موحدة */}
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
              {/* أدوات البحث والفلترة مدمجة في رأس الصندوق */}
              <div className="p-3 sm:p-3.5 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="relative flex-1 max-w-sm">
                  <i className="fa-solid fa-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[11px]"></i>
                  <input
                    type="text"
                    placeholder="ابحث برمز الكوبون..."
                    value={couponSearch}
                    onChange={(e) => setCouponSearch(e.target.value)}
                    className="w-full pr-8 pl-3 py-1.5 bg-gray-50/70 border border-gray-200 rounded-xl text-xs outline-none focus:border-black focus:bg-white text-black font-medium transition"
                  />
                </div>

                <div className="flex items-center gap-1 overflow-x-auto pb-0.5 sm:pb-0">
                  {[
                    { id: 'all', label: 'الكل' },
                    { id: 'active', label: 'النشطة' },
                    { id: 'disabled', label: 'المعطلة' },
                    { id: 'expired', label: 'المنتهية' }
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setCouponFilterStatus(f.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                        couponFilterStatus === f.id
                          ? 'bg-black text-white'
                          : 'text-gray-500 hover:text-black hover:bg-gray-100'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* الجدول مدمج مع نفس الحاوية */}
              <div className="w-full overflow-x-auto">
                <table className="w-full text-right text-[10px] sm:text-xs">
                  <thead className="bg-[#F9FAFB] border-b border-gray-200 text-gray-500 font-semibold text-[9px] sm:text-[11px]">
                    <tr>
                      <th className="py-2.5 px-2 sm:px-3 font-semibold text-gray-600">رمز الكوبون</th>
                      <th className="py-2.5 px-1.5 sm:px-2 font-semibold text-gray-600 text-center">الخصم</th>
                      <th className="py-2.5 px-1.5 sm:px-2 font-semibold text-gray-600">الاستخدام</th>
                      <th className="py-2.5 px-1.5 sm:px-2 font-semibold text-gray-600 hidden xs:table-cell">الانتهاء</th>
                      <th className="py-2.5 px-1.5 sm:px-2 font-semibold text-gray-600 text-center">الحالة</th>
                      <th className="py-2.5 px-1.5 sm:px-2 font-semibold text-gray-600 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredCoupons.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="p-6 text-center text-gray-400">
                          <i className="fa-solid fa-ticket-simple text-xl mb-1 text-gray-300 block"></i>
                          لا توجد كوبونات مطابقة
                        </td>
                      </tr>
                    ) : (
                      filteredCoupons.map((cp) => {
                        const usageRatio = Math.min(100, Math.round((cp.usageCount / cp.maxUsage) * 100));
                        return (
                          <tr key={cp.id} className="hover:bg-gray-50/70 transition group">
                            {/* رمز الكوبون */}
                            <td className="py-2 px-2 sm:px-3 whitespace-nowrap">
                              <span className="font-mono font-bold text-black text-[11px] sm:text-xs tracking-wider block">
                                {cp.code}
                              </span>
                              <span className="text-[8px] sm:text-[9px] text-gray-400 font-mono block">
                                #{cp.id}
                              </span>
                            </td>

                            {/* نسبة الخصم */}
                            <td className="py-2 px-1.5 sm:px-2 text-center whitespace-nowrap">
                              <span className="font-bold text-black text-[11px] sm:text-xs font-mono">
                                {cp.discountPercent}%
                              </span>
                            </td>

                            {/* معدل الاستخدام */}
                            <td className="py-2 px-1.5 sm:px-2 whitespace-nowrap min-w-[60px] sm:min-w-[85px]">
                              <div className="flex items-center justify-between text-[9px] sm:text-[10px] mb-0.5">
                                <span className="font-mono text-black font-semibold">{cp.usageCount}/{cp.maxUsage}</span>
                                <span className="font-mono text-gray-400 text-[8px] hidden sm:inline">{usageRatio}%</span>
                              </div>
                              <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                                <div
                                  className="h-full bg-black rounded-full"
                                  style={{ width: `${usageRatio}%` }}
                                ></div>
                              </div>
                            </td>

                            {/* تاريخ الانتهاء */}
                            <td className="py-2 px-1.5 sm:px-2 whitespace-nowrap font-mono text-gray-600 text-[9px] sm:text-[10px] hidden xs:table-cell">
                              {cp.expiryDate}
                            </td>

                            {/* الحالة */}
                            <td className="py-2 px-1.5 sm:px-2 text-center whitespace-nowrap">
                              <div className="inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-medium text-gray-800">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cp.status === 'نشط' ? 'bg-black' : 'bg-gray-300'}`}></span>
                                <span>{cp.status}</span>
                              </div>
                            </td>

                            {/* أزرار التحكم: أيقونات سوداء أنيقة بدون خلفية وحدود */}
                            <td className="py-2 px-1.5 sm:px-2 text-center whitespace-nowrap">
                              <div className="inline-flex items-center justify-center gap-1.5 sm:gap-2">
                                {/* زر تعديل كأيقونة سوداء بدون خلفية */}
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditCoupon(cp)}
                                  className="text-black hover:text-gray-600 transition cursor-pointer p-1"
                                  title="تعديل الكوبون والحد الأدنى"
                                >
                                  <i className="fa-solid fa-pen-to-square text-xs"></i>
                                </button>

                                {/* زر إيقاف / تفعيل كأيقونة سوداء بدون خلفية */}
                                <button
                                  type="button"
                                  onClick={() => toggleCouponStatus(cp.id)}
                                  className="text-black hover:text-gray-600 transition cursor-pointer p-1"
                                  title={cp.status === 'نشط' ? 'إيقاف الكوبون' : 'تفعيل الكوبون'}
                                >
                                  <i className={`fa-solid ${cp.status === 'نشط' ? 'fa-pause' : 'fa-play'} text-xs`}></i>
                                </button>

                                {/* زر حذف الكوبون */}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCoupon(cp.id)}
                                  className="text-gray-400 hover:text-red-600 transition cursor-pointer p-1"
                                  title="حذف الكوبون نهائياً"
                                >
                                  <i className="fa-solid fa-trash-can text-xs"></i>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 6. قسم إدارة أقسام المتجر (Categories Management)          */}
        {/* ========================================================= */}
        {activeTab === 'categories' && (
          <div className="space-y-4">
            {/* شريط علوي: إحصائية وزر إضافة قسم جديد وزر حفظ الترتيب سحابياً */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                <span>أقسام المتجر</span>
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-[11px] font-mono">
                  {categories.length} أقسام
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      localStorage.setItem('haider_store_categories', JSON.stringify(categories));
                      localStorage.setItem('haider_store_categories_updatedAt', String(Date.now()));
                      const res = await syncCategoriesToCloud(categories);
                      if (res && res.success === false) {
                        showToast('تنبيه: ' + (res.error || 'فشلت المزامنة'));
                      } else {
                        showToast('✅ تم حفظ ترتيب وبيانات الأقسام سحابياً بنجاح!');
                      }
                    } catch (e) {
                      showToast('حدث خطأ أثناء حفظ الأقسام');
                    }
                  }}
                  className="px-2.5 py-1.5 bg-white hover:bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-xl text-[12px] font-bold flex items-center gap-1.5 shadow-2xs transition cursor-pointer active:scale-95"
                  title="حفظ ومزامنة ترتيب الأقسام الحالي مع السحابة فوراً"
                >
                  <i className="fa-solid fa-cloud-arrow-up text-emerald-600 text-xs"></i>
                  <span>حفظ الترتيب سحابياً</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowAddCategoryModal(true)}
                  className="w-fit px-3 py-1.5 bg-[#004956] text-white text-[13px] font-bold rounded-xl shadow-2xs hover:opacity-95 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shrink-0"
                >
                  <span className="text-[14px] leading-none">+</span>
                  <span className="leading-none">إضافة قسم جديد</span>
                </button>
              </div>
            </div>

            {/* نافذة مودال منبثقة لإضافة قسم جديد */}
            {showAddCategoryModal && (
              <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
                <div className="bg-[#F9FAFB] rounded-2xl max-w-lg w-full p-4 shadow-xl space-y-4 border-0 animate-in fade-in zoom-in-95 duration-200" dir="rtl">
                  <div className="flex items-center justify-between pb-3">
                    <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-[#004956]/10 text-[#004956] flex items-center justify-center text-xs">➕</span>
                      <span>إضافة قسم جديد للمتجر</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowAddCategoryModal(false)}
                      className="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-500 flex items-center justify-center cursor-pointer text-xs"
                    >
                      ✕
                    </button>
                  </div>

                  <form onSubmit={handleAddCategory} className="space-y-3.5 text-xs">
                    <div>
                      <label className="block text-[11px] font-medium text-gray-600 mb-1">اسم القسم *</label>
                      <input
                        type="text"
                        required
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        placeholder="مثال: خدمات وحسابات رقمية"
                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:border-[#004956]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-gray-600 mb-1">
                        القسم الرئيسي التابع له (اختياري)
                      </label>
                      <select
                        value={newCatParentId}
                        onChange={(e) => setNewCatParentId(e.target.value)}
                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:border-[#004956] cursor-pointer"
                      >
                        <option value="">-- بدون (قسم رئيسي) --</option>
                        {categories.filter(c => c.name !== 'الكل' && !c.parentId).map(c => (
                          <option key={c.id} value={c.id}>
                            قسم رئيسي: {c.name}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-gray-400 mt-1">إذا اخترت قسماً رئيسياً، سيظهر هذا القسم كقسم فرعي متفرع منه.</p>
                    </div>

                    {/* مظهر وصورة / أيقونة القسم: صور هاي داي جاهزة + رفع من الجهاز + أيقونات الموقع */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-gray-700 flex items-center gap-1.5">
                          <i className="fa-solid fa-image text-[#004956]"></i>
                          <span>شكل وأيقونة القسم:</span>
                        </label>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-gray-400 text-[10px]">المعاينة الحالية:</span>
                          <div className="w-7 h-7 rounded-xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center p-1 shadow-2xs">
                            {newCatImage ? (
                              <img src={newCatImage} alt="" className="w-full h-full object-contain" />
                            ) : (
                              <i className={`${newCatIcon || 'fa-solid fa-folder-tree'} text-[#004956] text-sm`}></i>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 1. صور هاي داي الجاهزة */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold text-gray-700">
                            🌾 صور منتجات وعناصر هاي داي ({hayDayPresetImages.length} عنصر):
                          </span>
                          <span className="text-[9px] text-amber-700 font-medium">اختر للتعيين الفوري</span>
                        </div>
                        {/* شريط بحث سريع بين الـ 370 صورة */}
                        <div className="relative mb-2">
                          <input
                            type="text"
                            value={hayDaySearch}
                            onChange={(e) => setHayDaySearch(e.target.value)}
                            placeholder="🔍 ابحث عن أي منتج أو أداة في هاي داي (مثال: ريش، ذيل، سكر، لوح، فأس، كيك)..."
                            className="w-full px-2.5 py-1.5 pl-7 bg-white border border-amber-200 rounded-lg text-[11px] placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                          {hayDaySearch && (
                            <button
                              type="button"
                              onClick={() => setHayDaySearch('')}
                              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 p-2 bg-amber-50/40 border border-amber-200/60 rounded-xl max-h-56 overflow-y-auto scrollbar-thin">
                          {hayDayPresetImages
                            .filter(hImg => {
                              if (!hayDaySearch.trim()) return true;
                              const q = hayDaySearch.trim().toLowerCase();
                              return hImg.label.toLowerCase().includes(q) || (hImg.nameEn && hImg.nameEn.toLowerCase().includes(q));
                            })
                            .map((hImg, hIdx) => {
                              const isSelected = newCatImage === hImg.url;
                              return (
                                <button
                                  key={hIdx}
                                  type="button"
                                  onClick={() => {
                                    setNewCatImage(hImg.url);
                                    setNewCatIcon('');
                                  }}
                                  className={`flex flex-col items-center justify-center p-1.5 rounded-xl border text-center transition cursor-pointer bg-white ${
                                    isSelected
                                      ? 'border-[#004956] ring-2 ring-[#004956]/20 shadow-xs'
                                      : 'border-gray-200 hover:border-gray-300'
                                  }`}
                                  title={`${hImg.label} (${hImg.nameEn})`}
                                >
                                  <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center p-0.5 mb-1 shrink-0">
                                    <img src={hImg.url} alt={hImg.label} className="w-full h-full object-contain" loading="lazy" />
                                  </div>
                                  <span className="text-[9px] truncate w-full font-bold text-gray-800 leading-tight">
                                    {hImg.label}
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                      </div>

                      {/* 2. خيار رفع صورة مخصصة من الجهاز */}
                      <div>
                        <div className="flex items-center gap-2">
                          <label className="flex-1 py-2 px-3 bg-gray-50 hover:bg-gray-100 border border-dashed border-gray-300 rounded-xl text-xs font-semibold text-gray-700 flex items-center justify-center gap-2 cursor-pointer transition">
                            <i className="fa-solid fa-cloud-arrow-up text-[#004956] text-sm"></i>
                            <span>رفع صورة من جهازك للقسم</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const reader = new FileReader();
                                  reader.onloadend = () => {
                                    setNewCatImage(reader.result);
                                    setNewCatIcon('');
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }}
                              className="hidden"
                            />
                          </label>
                          {newCatImage && (
                            <button
                              type="button"
                              onClick={() => setNewCatImage('')}
                              className="px-2.5 py-2 text-red-500 bg-red-50 border border-red-100 rounded-xl text-xs hover:bg-red-100 cursor-pointer"
                              title="حذف الصورة والرجوع للأيقونات"
                            >
                              إزالة الصورة ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 3. أو اختيار أيقونة من الموقع */}
                      <div>
                        <span className="text-[10px] font-bold text-gray-600 block mb-1">
                          ✨ أو اختر أيقونة رمزية من الموقع:
                        </span>
                        <div className="grid grid-cols-5 gap-1.5 p-2 bg-gray-50 border border-gray-200 rounded-xl max-h-28 overflow-y-auto scrollbar-thin">
                          {categoryPresetIcons.map((pIcon, pIdx) => {
                            const isSelected = !newCatImage && newCatIcon === pIcon.icon;
                            return (
                              <button
                                key={pIdx}
                                type="button"
                                onClick={() => {
                                  setNewCatIcon(pIcon.icon);
                                  setNewCatImage('');
                                }}
                                className={`flex flex-col items-center justify-center p-1.5 rounded-xl border text-center transition cursor-pointer ${
                                  isSelected
                                    ? 'bg-[#004956] text-white border-[#004956] shadow-xs'
                                    : 'bg-white hover:bg-gray-100 border-gray-200 text-gray-700'
                                }`}
                                title={pIcon.label}
                              >
                                <i className={`${pIcon.icon} text-xs mb-0.5`}></i>
                                <span className="text-[8.5px] truncate w-full font-medium">{pIcon.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => setShowAddCategoryModal(false)}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl cursor-pointer font-medium"
                      >
                        إلغاء
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2 bg-[#004956] text-white rounded-xl cursor-pointer font-bold hover:opacity-90 transition shadow-xs"
                      >
                        + إضافة القسم الآن
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* قائمة الأقسام الحالية بطريقة هيكلية شجرية راقية (أقسام رئيسية وتحتها أقسامها الفرعية) */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-2xs divide-y divide-gray-100 overflow-hidden">
              {(() => {
                // استخراج الأقسام الرئيسية أولاً
                const mainCats = categories.filter(c => !c.parentId);
                const orphanSubCats = categories.filter(c => c.parentId && !categories.some(p => p.id === c.parentId));

                const renderCategoryRow = (cat, isSub = false, parentName = '') => {
                  const count = cat.name === 'الكل'
                    ? products.length
                    : products.filter(p => p.category === cat.name).length;

                  return (
                    <div
                      key={cat.id}
                      draggable={cat.name !== 'الكل'}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', cat.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        if (cat.name !== 'الكل') {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const draggedId = e.dataTransfer.getData('text/plain');
                        if (draggedId && draggedId !== cat.id) {
                          handleMoveCategory(draggedId, cat.id);
                        }
                      }}
                      className={`p-2 sm:p-2.5 hover:bg-gray-50/70 transition flex items-center justify-between gap-3 ${
                        isSub ? 'bg-gray-50/40 pr-6 sm:pr-8 border-r-4 border-[#004956]' : ''
                      }`}
                    >
                      {/* الجانب الأيمن: أيقونة السحب للترتيب + الصورة المصغرة واسم القسم وعدد المنتجات */}
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        {/* أيقونة السحب والترتيب (أعلى وأسفل وسحب مباشر) يمين كل قسم */}
                        {cat.name !== 'الكل' ? (
                          <div className="flex flex-col items-center gap-1 shrink-0 px-1">

                            {/* أسهم الترتيب السريع للأعلى والأسفل (مريحة جداً للمس في الجوال) */}
                            <div className="flex flex-col items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleMoveCategoryUp(cat.id)}
                                className="w-5 h-4 flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-200/70 rounded text-[9px] transition cursor-pointer"
                                title="تحريك للأعلى"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveCategoryDown(cat.id)}
                                className="w-5 h-4 flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-200/70 rounded text-[9px] transition cursor-pointer"
                                title="تحريك للأسفل"
                              >
                                ▼
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="w-5 shrink-0"></div>
                        )}

                        {isSub && (
                          <div className="text-gray-400 text-xs pl-1 flex items-center shrink-0" title="قسم فرعي">
                            <i className="fa-solid fa-arrow-turn-down-left -rotate-90"></i>
                          </div>
                        )}

                        {cat.imageUrl ? (
                          <div className={`${isSub ? 'w-7 h-7 sm:w-10 sm:h-10' : 'w-8 h-8'} rounded-xl bg-gray-50 border border-gray-200/80 p-1 flex items-center justify-center shrink-0 shadow-2xs overflow-hidden`}>
                            <img src={cat.imageUrl} alt={cat.name} className="w-full h-full object-contain" />
                          </div>
                        ) : cat.icon ? (
                          <div className={`${isSub ? 'w-7 h-7 sm:w-10 sm:h-10' : 'w-8 h-8'} rounded-xl bg-gray-50 border border-gray-200/80 flex items-center justify-center text-[11px] sm:text-xs text-[#004956] shrink-0 shadow-2xs`}>
                            <i className={cat.icon}></i>
                          </div>
                        ) : (
                          <div className={`${isSub ? 'w-7 h-7 sm:w-10 sm:h-10' : 'w-8 h-8'} rounded-xl bg-gray-100 border border-gray-200/80 flex items-center justify-center text-[11px] sm:text-xs text-gray-500 shrink-0`}>
                            <i className="fa-solid fa-folder-tree"></i>
                          </div>
                        )}

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className={`font-bold text-gray-800 ${isSub ? 'text-[11px]' : 'text-xs'} truncate`}>
                              {cat.name}
                            </h4>
                          </div>
                          <p className="text-[8.5px] text-gray-400 mt-0.5 leading-tight select-none">
                            المنتجات: <span className="text-gray-500 font-normal">{count} منتج</span>
                          </p>
                        </div>
                      </div>

                      {/* الجانب الأيسر: تحرير + حذف */}
                      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">

                        <button
                          type="button"
                          onClick={() => startEditCategory(cat)}
                          className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl text-gray-500 hover:text-[#004956] hover:bg-[#004956]/10 flex items-center justify-center transition cursor-pointer"
                          title="تحرير وتعديل القسم"
                        >
                          <i className="fa-solid fa-pen-to-square text-[11px] sm:text-xs"></i>
                        </button>

                        {cat.name !== 'الكل' ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(cat.id)}
                            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition cursor-pointer"
                            title="حذف هذا القسم"
                          >
                            <i className="fa-solid fa-trash-can text-[11px] sm:text-xs"></i>
                          </button>
                        ) : (
                          <div className="w-8 h-8 sm:w-9 sm:h-9"></div>
                        )}
                      </div>
                    </div>
                  );
                };

                return (
                  <>
                    {mainCats.map(parentCat => {
                      const subCats = categories.filter(c => c.parentId === parentCat.id);
                      return (
                        <div key={parentCat.id} className="divide-y divide-gray-100">
                          {renderCategoryRow(parentCat, false)}
                          {subCats.map(subCat => renderCategoryRow(subCat, true, parentCat.name))}
                        </div>
                      );
                    })}

                    {/* أي أقسام فرعية فُقد قسمها الأب */}
                    {orphanSubCats.length > 0 && (
                      <div className="divide-y divide-gray-100">
                        {orphanSubCats.map(orphan => renderCategoryRow(orphan, false))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* نافذة / بطاقة تعديل صورة واسم القسم */}
            {editingCatId && (
              <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
                <div className="bg-[#F9FAFB] rounded-2xl max-w-lg w-full p-4 shadow-xl space-y-4 border-0" dir="rtl">
                  <div className="flex items-center justify-between pb-3">
                    <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2">
                      <i className="fa-solid fa-pen text-[#004956]"></i>
                      <span>تعديل القسم والصورة المصغرة</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingCatId(null)}
                      className="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-500 flex items-center justify-center cursor-pointer text-xs"
                    >
                      ✕
                    </button>
                  </div>

                  <form onSubmit={handleUpdateCategory} className="space-y-3 text-xs">
                    <div>
                      <label className="block text-[11px] font-medium text-gray-700 mb-1">اسم القسم *</label>
                      <input
                        type="text"
                        required
                        value={editCatName}
                        onChange={(e) => setEditCatName(e.target.value)}
                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:border-[#004956]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-gray-700 mb-1">
                        القسم الرئيسي التابع له (اختياري)
                      </label>
                      <select
                        value={editCatParentId}
                        onChange={(e) => setEditCatParentId(e.target.value)}
                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs outline-none focus:border-[#004956] cursor-pointer"
                      >
                        <option value="">-- بدون (قسم رئيسي) --</option>
                        {categories
                          .filter(c => c.name !== 'الكل' && c.id !== editingCatId && !c.parentId)
                          .map(c => (
                            <option key={c.id} value={c.id}>
                              قسم رئيسي: {c.name}
                            </option>
                          ))}
                      </select>
                      <p className="text-[10px] text-gray-400 mt-1">إذا تم اختياره كقسم رئيسي، سيعمل كقسم فرعي تابع له.</p>
                    </div>

                    {/* مظهر وصورة / أيقونة القسم عند التعديل */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-gray-700 flex items-center gap-1.5">
                          <i className="fa-solid fa-image text-[#004956]"></i>
                          <span>شكل وأيقونة القسم:</span>
                        </label>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-gray-400 text-[10px]">المعاينة:</span>
                          <div className="w-7 h-7 rounded-xl bg-gray-50 border border-gray-200 overflow-hidden flex items-center justify-center p-1 shadow-2xs">
                            {editCatImage ? (
                              <img src={editCatImage} alt="" className="w-full h-full object-contain" />
                            ) : (
                              <i className={`${editCatIcon || 'fa-solid fa-folder-tree'} text-[#004956] text-sm`}></i>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* 1. صور هاي داي الجاهزة */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold text-gray-700">
                            🌾 صور منتجات وعناصر هاي داي ({hayDayPresetImages.length} عنصر):
                          </span>
                          <span className="text-[9px] text-amber-700 font-medium">اختر للتعيين الفوري</span>
                        </div>
                        {/* شريط بحث سريع بين الـ 370 صورة */}
                        <div className="relative mb-2">
                          <input
                            type="text"
                            value={hayDaySearch}
                            onChange={(e) => setHayDaySearch(e.target.value)}
                            placeholder="🔍 ابحث عن أي منتج أو أداة في هاي داي (مثال: ريش، ذيل، سكر، لوح، فأس، كيك)..."
                            className="w-full px-2.5 py-1.5 pl-7 bg-white border border-amber-200 rounded-lg text-[11px] placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
                          />
                          {hayDaySearch && (
                            <button
                              type="button"
                              onClick={() => setHayDaySearch('')}
                              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 p-2 bg-amber-50/40 border border-amber-200/60 rounded-xl max-h-56 overflow-y-auto scrollbar-thin">
                          {hayDayPresetImages
                            .filter(hImg => {
                              if (!hayDaySearch.trim()) return true;
                              const q = hayDaySearch.trim().toLowerCase();
                              return hImg.label.toLowerCase().includes(q) || (hImg.nameEn && hImg.nameEn.toLowerCase().includes(q));
                            })
                            .map((hImg, hIdx) => {
                              const isSelected = editCatImage === hImg.url;
                              return (
                                <button
                                  key={hIdx}
                                  type="button"
                                  onClick={() => {
                                    setEditCatImage(hImg.url);
                                    setEditCatIcon('');
                                  }}
                                  className={`flex flex-col items-center justify-center p-1.5 rounded-xl border text-center transition cursor-pointer bg-white ${
                                    isSelected
                                      ? 'border-[#004956] ring-2 ring-[#004956]/20 shadow-xs'
                                      : 'border-gray-200 hover:border-gray-300'
                                  }`}
                                  title={`${hImg.label} (${hImg.nameEn})`}
                                >
                                  <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center p-0.5 mb-1 shrink-0">
                                    <img src={hImg.url} alt={hImg.label} className="w-full h-full object-contain" loading="lazy" />
                                  </div>
                                  <span className="text-[9px] truncate w-full font-bold text-gray-800 leading-tight">
                                    {hImg.label}
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                      </div>

                      {/* 2. رفع صورة من الجهاز */}
                      <div>
                        <div className="flex items-center gap-2">
                          <label className="flex-1 py-2 px-3 bg-gray-50 hover:bg-gray-100 border border-dashed border-gray-300 rounded-xl text-xs font-semibold text-gray-700 flex items-center justify-center gap-2 cursor-pointer transition">
                            <i className="fa-solid fa-cloud-arrow-up text-[#004956] text-sm"></i>
                            <span>رفع صورة من جهازك للقسم</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const reader = new FileReader();
                                  reader.onloadend = () => {
                                    setEditCatImage(reader.result);
                                    setEditCatIcon('');
                                  };
                                  reader.readAsDataURL(file);
                                }
                              }}
                              className="hidden"
                            />
                          </label>
                          {editCatImage && (
                            <button
                              type="button"
                              onClick={() => setEditCatImage('')}
                              className="px-2.5 py-2 text-red-500 bg-red-50 border border-red-100 rounded-xl text-xs hover:bg-red-100 cursor-pointer"
                              title="إزالة الصورة"
                            >
                              إزالة ✕
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 3. أو أيقونة من الموقع */}
                      <div>
                        <span className="text-[10px] font-bold text-gray-600 block mb-1">
                          ✨ أو اختر أيقونة من الموقع:
                        </span>
                        <div className="grid grid-cols-5 gap-1.5 p-2 bg-gray-50 border border-gray-200 rounded-xl max-h-28 overflow-y-auto scrollbar-thin">
                          {categoryPresetIcons.map((pIcon, pIdx) => {
                            const isSelected = !editCatImage && editCatIcon === pIcon.icon;
                            return (
                              <button
                                key={pIdx}
                                type="button"
                                onClick={() => {
                                  setEditCatIcon(pIcon.icon);
                                  setEditCatImage('');
                                }}
                                className={`flex flex-col items-center justify-center p-1.5 rounded-xl border text-center transition cursor-pointer ${
                                  isSelected
                                    ? 'bg-[#004956] text-white border-[#004956] shadow-xs'
                                    : 'bg-white hover:bg-gray-100 border-gray-200 text-gray-700'
                                }`}
                                title={pIcon.label}
                              >
                                <i className={`${pIcon.icon} text-xs mb-0.5`}></i>
                                <span className="text-[8.5px] truncate w-full font-medium">{pIcon.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => setEditingCatId(null)}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl cursor-pointer font-medium"
                      >
                        إلغاء
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2 bg-[#004956] text-white rounded-xl cursor-pointer font-bold hover:opacity-90 transition shadow-xs"
                      >
                        حفظ التعديلات
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* 7. قسم إدارة أشرطة الإعلانات (ثابتة أو متحركة + إضافة أشرطة متعددة) */}
        {/* ========================================================= */}
        {activeTab === 'announcements' && (
          <div className="space-y-6">
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => {
                  const newBars = [
                    ...(storeConfig.announcements || []),
                    {
                      id: Date.now(),
                      text: '🔥 عرض جديد: خصومات خاصة لفترة محدودة على جميع المنتجات!',
                      bgColor: '#111827',
                      textColor: '#FFFFFF',
                      isMarquee: true,
                      direction: 'ar'
                    }
                  ];
                  setStoreConfig(prev => ({ ...prev, announcements: newBars }));
                }}
                className="w-fit px-3 py-1.5 bg-[#004956] text-white text-[13px] font-bold rounded-xl shadow-2xs hover:opacity-95 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
              >
                <i className="fa-solid fa-plus text-[12px]"></i>
                <span className="leading-none">إضافة شريط إعلاني جديد</span>
              </button>
            </div>

            {/* معاينة حية سريعة للأشرطة */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-2xs space-y-2">
              <div className="text-xs font-bold text-gray-700 mb-2 flex items-center gap-1.5">
                <span>👁️</span>
                <span>معاينة حية لشكل الأشرطة في المتجر:</span>
              </div>
              <div className="rounded-xl overflow-hidden divide-y divide-gray-100">
                {(storeConfig.announcements || []).map((bar) => (
                  <div
                    key={bar.id}
                    className="p-2.5 text-xs overflow-hidden"
                    style={{ backgroundColor: bar.bgColor, color: bar.textColor }}
                  >
                    {bar.isMarquee ? (
                      <div className="overflow-hidden whitespace-nowrap">
                        <div
                          className={`${bar.direction === 'en' ? 'animate-marquee-rtl' : 'animate-marquee-ltr'} font-medium`}
                          style={{ animationDuration: `${bar.speed || 20}s` }}
                        >
                          <span className="mx-4">{bar.text}</span>
                          <span className="mx-4">•</span>
                          <span className="mx-4">{bar.text}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center font-medium">
                        {bar.text}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* قائمة تعديل وإدارة الأشرطة الإعلانية */}
            <div className="space-y-4">
              {(storeConfig.announcements || []).map((bar, idx) => (
                <div key={bar.id} className="bg-white p-5 rounded-2xl shadow-2xs space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-gray-100 text-black font-bold text-xs flex items-center justify-center font-mono">
                        {idx + 1}
                      </span>
                      <h4 className="font-bold text-sm text-gray-800">
                        شريط إعلاني رقم {idx + 1}
                      </h4>
                    </div>

                    {(storeConfig.announcements || []).length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = storeConfig.announcements.filter(b => b.id !== bar.id);
                          setStoreConfig(prev => ({ ...prev, announcements: updated }));
                        }}
                        className="text-red-500 hover:text-red-700 text-xs font-semibold cursor-pointer"
                      >
                        🗑️ حذف الشريط
                      </button>
                    )}
                  </div>

                  <div className="space-y-3 text-xs">
                    {/* نص الإعلان */}
                    <div>
                      <label className="block text-gray-700 font-semibold mb-1">نص الإعلان:</label>
                      <input
                        type="text"
                        value={bar.text}
                        onChange={(e) => {
                          const updated = storeConfig.announcements.map(b =>
                            b.id === bar.id ? { ...b, text: e.target.value } : b
                          );
                          setStoreConfig(prev => ({ ...prev, announcements: updated }));
                        }}
                        placeholder="اكتب الإعلان الترويجي هنا..."
                        className="w-full p-2.5 bg-gray-50/70 rounded-xl text-xs outline-none focus:bg-white focus:ring-1 focus:ring-black transition"
                      />
                    </div>

                    {/* خيارات الحركة والاتجاه والألوان */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-center">
                      {/* خيار الحركة أو الثبات */}
                      <div>
                        <label className="block text-gray-700 font-semibold mb-1">نوع العرض:</label>
                        <div className="grid grid-cols-2 gap-1.5 p-1 bg-gray-100 rounded-xl">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = storeConfig.announcements.map(b =>
                                b.id === bar.id ? { ...b, isMarquee: true } : b
                              );
                              setStoreConfig(prev => ({ ...prev, announcements: updated }));
                            }}
                            className={`py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${
                              bar.isMarquee ? 'bg-white text-black shadow-xs' : 'text-gray-500'
                            }`}
                          >
                            ⚡ متحرك
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = storeConfig.announcements.map(b =>
                                b.id === bar.id ? { ...b, isMarquee: false } : b
                              );
                              setStoreConfig(prev => ({ ...prev, announcements: updated }));
                            }}
                            className={`py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${
                              !bar.isMarquee ? 'bg-white text-black shadow-xs' : 'text-gray-500'
                            }`}
                          >
                            📌 ثابت
                          </button>
                        </div>
                      </div>

                      {/* اتجاه حركة الشريط: عربي أو إنجليزي */}
                      <div>
                        <label className="block text-gray-700 font-semibold mb-1">
                          اتجاه الحركة:
                        </label>
                        <div className="grid grid-cols-2 gap-1.5 p-1 bg-gray-100 rounded-xl">
                          <button
                            type="button"
                            disabled={!bar.isMarquee}
                            onClick={() => {
                              const updated = storeConfig.announcements.map(b =>
                                b.id === bar.id ? { ...b, direction: 'ar' } : b
                              );
                              setStoreConfig(prev => ({ ...prev, announcements: updated }));
                            }}
                            className={`py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${
                              bar.direction !== 'en' ? 'bg-white text-black shadow-xs' : 'text-gray-500'
                            } ${!bar.isMarquee ? 'opacity-40 cursor-not-allowed' : ''}`}
                          >
                            عربي
                          </button>
                          <button
                            type="button"
                            disabled={!bar.isMarquee}
                            onClick={() => {
                              const updated = storeConfig.announcements.map(b =>
                                b.id === bar.id ? { ...b, direction: 'en' } : b
                              );
                              setStoreConfig(prev => ({ ...prev, announcements: updated }));
                            }}
                            className={`py-1.5 rounded-lg font-bold text-xs transition cursor-pointer ${
                              bar.direction === 'en' ? 'bg-white text-black shadow-xs' : 'text-gray-500'
                            } ${!bar.isMarquee ? 'opacity-40 cursor-not-allowed' : ''}`}
                          >
                            انجليزي
                          </button>
                        </div>
                      </div>

                      {/* لون الخلفية */}
                      <div>
                        <label className="block text-gray-700 font-semibold mb-1">لون خلفية الشريط:</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={bar.bgColor || '#00343D'}
                            onChange={(e) => {
                              const updated = storeConfig.announcements.map(b =>
                                b.id === bar.id ? { ...b, bgColor: e.target.value } : b
                              );
                              setStoreConfig(prev => ({ ...prev, announcements: updated }));
                            }}
                            className="w-7 h-7 rounded-lg border-0 cursor-pointer p-0.5 bg-transparent"
                          />
                          <input
                            type="text"
                            value={bar.bgColor || '#00343D'}
                            onChange={(e) => {
                              const updated = storeConfig.announcements.map(b =>
                                b.id === bar.id ? { ...b, bgColor: e.target.value } : b
                              );
                              setStoreConfig(prev => ({ ...prev, announcements: updated }));
                            }}
                            className="w-full p-2 bg-gray-50/70 rounded-xl text-xs font-mono outline-none"
                          />
                        </div>
                      </div>

                      {/* لون النص */}
                      <div>
                        <label className="block text-gray-700 font-semibold mb-1">لون النص:</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={bar.textColor || '#FFFFFF'}
                            onChange={(e) => {
                              const updated = storeConfig.announcements.map(b =>
                                b.id === bar.id ? { ...b, textColor: e.target.value } : b
                              );
                              setStoreConfig(prev => ({ ...prev, announcements: updated }));
                            }}
                            className="w-7 h-7 rounded-lg border-0 cursor-pointer p-0.5 bg-transparent"
                          />
                          <input
                            type="text"
                            value={bar.textColor || '#FFFFFF'}
                            onChange={(e) => {
                              const updated = storeConfig.announcements.map(b =>
                                b.id === bar.id ? { ...b, textColor: e.target.value } : b
                              );
                              setStoreConfig(prev => ({ ...prev, announcements: updated }));
                            }}
                            className="w-full p-2 bg-gray-50/70 rounded-xl text-xs font-mono outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    {/* خيار التحكم في سرعة حركة الشريط (عند تفعيل الوضع المتحرك) */}
                    {bar.isMarquee && (
                      <div className="p-3 bg-gray-50/80 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg bg-black text-white flex items-center justify-center text-xs">
                            <i className="fa-solid fa-gauge-high"></i>
                          </span>
                          <div>
                            <span className="font-bold text-gray-800 block text-xs">سرعة الحركة:</span>
                            <span className="text-[10px] text-gray-500">
                              المدة الحالية للدورة: {bar.speed || 20} ثانية ({bar.speed <= 12 ? 'سريع جداً' : bar.speed <= 18 ? 'سريع' : bar.speed <= 26 ? 'متوسط / متوازن' : 'هادئ وبطيء'})
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {/* خيارات سرعة جاهزة سريعة */}
                          <div className="flex items-center gap-1 bg-white p-1 rounded-lg shadow-2xs">
                            {[
                              { label: 'سريع ⚡', sec: 12 },
                              { label: 'متوسط 🚗', sec: 20 },
                              { label: 'بطيء 🚶', sec: 32 }
                            ].map((spd) => (
                              <button
                                key={spd.sec}
                                type="button"
                                onClick={() => {
                                  const updated = storeConfig.announcements.map(b =>
                                    b.id === bar.id ? { ...b, speed: spd.sec } : b
                                  );
                                  setStoreConfig(prev => ({ ...prev, announcements: updated }));
                                }}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer transition ${
                                  (bar.speed || 20) === spd.sec
                                    ? 'bg-black text-white shadow-2xs'
                                    : 'text-gray-600 hover:bg-gray-100'
                                }`}
                              >
                                {spd.label}
                              </button>
                            ))}
                          </div>

                          {/* شريط تمرير تحكم دقيق */}
                          <div className="flex items-center gap-1.5">
                            <input
                              type="range"
                              min="8"
                              max="45"
                              step="1"
                              value={bar.speed || 20}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                const updated = storeConfig.announcements.map(b =>
                                  b.id === bar.id ? { ...b, speed: val } : b
                                );
                                setStoreConfig(prev => ({ ...prev, announcements: updated }));
                              }}
                              className="w-24 accent-black cursor-pointer"
                            />
                            <span className="text-[11px] font-mono font-bold text-gray-700 bg-white px-2 py-0.5 rounded shadow-2xs">
                              {bar.speed || 20}s
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 8. قسم خطوط المتجر وتخصيص ورفع خط جديد                    */}
        {/* ========================================================= */}
        {activeTab === 'fonts' && (
          <div className="max-w-2xl mx-auto space-y-4">

            {/* قائمة الخطوط المتاحة (الافتراضية + المرفوعة مسبقاً) */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 space-y-4 shadow-2xs">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-list-check text-black text-xs"></i>
                  <h3 className="text-xs font-bold text-black">اختر الخط المعتمد للمتجر:</h3>
                </div>
                <span className="text-[11px] text-gray-500">
                  الخط النشط حالياً: <strong className="text-black font-bold font-mono">{storeConfig.fontFamily}</strong>
                </span>
              </div>

              {/* الخطوط المرفوعة مسبقاً من المستخدم إن وجدت */}
              {customFonts.length > 0 && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                    {customFonts.map((cf) => {
                      const isSelected = storeConfig.fontFamily === cf.name;
                      return (
                        <div
                          key={cf.id}
                          onClick={() => setStoreConfig(prev => ({ ...prev, fontFamily: cf.name }))}
                          className={`py-1.5 px-2.5 rounded-lg border text-center cursor-pointer transition-all flex items-center justify-between gap-1 ${
                            isSelected
                              ? 'border-black bg-black text-white shadow-2xs'
                              : 'border-gray-200 bg-gray-50/70 hover:border-gray-300 text-gray-800'
                          }`}
                        >
                          <span
                            className="font-bold text-[11px] truncate flex-1"
                            style={{ fontFamily: `'${cf.name}', sans-serif` }}
                          >
                            {cf.name}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCustomFont(cf.id, cf.name);
                            }}
                            className={`p-0.5 text-[9px] cursor-pointer shrink-0 transition ${
                              isSelected ? 'text-white/60 hover:text-white' : 'text-gray-400 hover:text-red-600'
                            }`}
                            title="حذف هذا الخط المخصص"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* شبكة أسماء الخطوط فقط كـ Grid مدمج وصغير */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-1.5">
                {[
                  { id: 'DIN Next LT Arabic', name: 'DIN Next LT' },
                  { id: 'Tajawal', name: 'Tajawal' },
                  { id: 'Cairo', name: 'Cairo' },
                  { id: 'Almarai', name: 'Almarai' },
                  { id: 'Alexandria', name: 'Alexandria' }
                ].map((f) => {
                  const isSelected = storeConfig.fontFamily === f.id;
                  return (
                    <div
                      key={f.id}
                      onClick={() => setStoreConfig(prev => ({ ...prev, fontFamily: f.id }))}
                      className={`py-2 px-2 rounded-lg border text-center cursor-pointer transition-all duration-150 flex items-center justify-center ${
                        isSelected
                          ? 'border-black bg-black text-white shadow-2xs font-bold'
                          : 'border-gray-200 bg-gray-50/70 hover:border-gray-300 text-gray-700 font-medium'
                      }`}
                    >
                      <span
                        className="text-[11px] truncate"
                        style={{ fontFamily: `'${f.id}', sans-serif` }}
                      >
                        {f.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* بطاقة رفع ملف خط جديد مدمجة ومصغرة في صف واحد بالأسفل */}
            <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-gray-200 shadow-2xs">
              <form onSubmit={handleSaveCustomFont} className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-black whitespace-nowrap shrink-0">
                  <i className="fa-solid fa-cloud-arrow-up text-black text-xs"></i>
                  <span>رفع خط جديد:</span>
                </div>

                {/* حقل اسم الخط */}
                <input
                  type="text"
                  required
                  placeholder="اسم الخط (مثلاً: ديواني)"
                  value={newFontName}
                  onChange={(e) => setNewFontName(e.target.value)}
                  className="sm:w-48 p-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-black outline-none focus:border-black shrink-0"
                />

                {/* زر اختيار الملف */}
                <label className="flex-1 cursor-pointer border border-dashed border-gray-300 hover:border-black p-2 rounded-xl bg-gray-50 hover:bg-white text-center transition flex items-center justify-between px-3 min-w-0">
                  <span className="text-[11px] text-gray-600 truncate">
                    {newFontFileName ? `✓ ${newFontFileName}` : 'اختر ملف الخط (.ttf, .otf, .woff)'}
                  </span>
                  <span className="text-[10px] text-gray-400 font-mono border border-gray-200 px-1.5 py-0.5 rounded bg-white shrink-0 mr-2">
                    تصفح
                  </span>
                  <input
                    type="file"
                    ref={fontFileInputRef}
                    accept=".ttf,.otf,.woff,.woff2,font/*"
                    onChange={handleUploadFontFile}
                    className="hidden"
                  />
                </label>

                {/* إلغاء إذا تم اختيار ملف */}
                {newFontDataUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewFontDataUrl('');
                      setNewFontFileName('');
                      if (fontFileInputRef.current) fontFileInputRef.current.value = '';
                    }}
                    className="p-2 text-gray-400 hover:text-black text-xs cursor-pointer shrink-0"
                    title="إلغاء الملف"
                  >
                    ✕
                  </button>
                )}

                {/* زر التثبيت */}
                <button
                  type="submit"
                  disabled={!newFontDataUrl || !newFontName.trim()}
                  className={`px-5 py-2 text-xs font-bold rounded-xl transition shrink-0 cursor-pointer ${
                    newFontDataUrl && newFontName.trim()
                      ? 'bg-[#004956] text-white hover:opacity-95 shadow-xs active:scale-95'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200'
                  }`}
                >
                  أضف
                </button>
              </form>
            </div>

            {/* ========================================================= */}
            {/* تخصيص ألوان المتجر بالكامل (Store Color Customization)      */}
            {/* ========================================================= */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 space-y-4 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-palette text-black text-sm"></i>
                  <div>
                    <h3 className="text-xs font-bold text-black">تخصيص ألوان المتجر والهوية البصرية</h3>
                    <p className="text-[10px] text-gray-400 mt-0.5">تحكّم في جميع ألوان عناصر المتجر (الأساسي، الترويجي، الخلفيات، والبانرات)</p>
                  </div>
                </div>

                {/* باقات ألوان جاهزة بضغطة زر واحدة (Color Presets) */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  <span className="text-[10px] text-gray-500 font-bold shrink-0">ثيمات سريعة:</span>
                  {[
                    { name: 'سلة الرسمي (زمردي)', primary: '#004956', accent: '#76e5d0', banner: '#00343D' },
                    { name: 'كلاسيك (أسود)', primary: '#111827', accent: '#374151', banner: '#000000' },
                    { name: 'كحلي فاخر', primary: '#0f172a', accent: '#38bdf8', banner: '#1e293b' },
                    { name: 'عنابي راقي', primary: '#4a0404', accent: '#f87171', banner: '#2b0202' },
                    { name: 'بنفسجي عصري', primary: '#4c1d95', accent: '#c084fc', banner: '#2e1065' }
                  ].map((preset, pIdx) => (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => {
                        setStoreConfig(prev => ({
                          ...prev,
                          primaryColor: preset.primary,
                          accentColor: preset.accent,
                          bannerBgColor: preset.banner
                        }));
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 hover:border-black text-[10px] text-gray-700 bg-white transition cursor-pointer shrink-0"
                    >
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: preset.primary }}></span>
                      <span>{preset.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* شبكة مدخلات الألوان لجميع عناصر المتجر */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                
                {/* 1. اللون الأساسي للهوية */}
                <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-black">اللون الأساسي (Primary)</label>
                    <span className="text-[10px] font-mono text-gray-400 font-bold">{storeConfig.primaryColor}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={storeConfig.primaryColor || '#004956'}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, primaryColor: e.target.value }))}
                      className="w-7 h-7 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white shrink-0"
                    />
                    <input
                      type="text"
                      value={storeConfig.primaryColor || '#004956'}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, primaryColor: e.target.value }))}
                      className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-mono font-bold text-black uppercase outline-none focus:border-black"
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 block">شعار المتجر، الأزرار الرئيسية، وروابط التبويب</span>
                </div>

                {/* 2. اللون الثانوي والتمييز */}
                <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-black">اللون الثانوي (Accent)</label>
                    <span className="text-[10px] font-mono text-gray-400 font-bold">{storeConfig.accentColor || '#76e5d0'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={storeConfig.accentColor || '#76e5d0'}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, accentColor: e.target.value }))}
                      className="w-7 h-7 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white shrink-0"
                    />
                    <input
                      type="text"
                      value={storeConfig.accentColor || '#76e5d0'}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, accentColor: e.target.value }))}
                      className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-mono font-bold text-black uppercase outline-none focus:border-black"
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 block">شارات التمييز، الحواف النشطة، والتأثيرات</span>
                </div>

                {/* 3. لون البانر والترويج */}
                <div className="p-3 bg-gray-50/70 rounded-xl border border-gray-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-black">لون البانر العريض (Banner)</label>
                    <span className="text-[10px] font-mono text-gray-400 font-bold">{storeConfig.bannerBgColor || '#00343D'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={storeConfig.bannerBgColor || '#00343D'}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, bannerBgColor: e.target.value }))}
                      className="w-7 h-7 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white shrink-0"
                    />
                    <input
                      type="text"
                      value={storeConfig.bannerBgColor || '#00343D'}
                      onChange={(e) => setStoreConfig(prev => ({ ...prev, bannerBgColor: e.target.value }))}
                      className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs font-mono font-bold text-black uppercase outline-none focus:border-black"
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 block">شريط الترحيب والبانر الترويجي العلوي</span>
                </div>

              </div>

              {/* معاينة حية لشكل ألوان المتجر المختارة */}
              <div className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
                <span className="text-[10px] text-gray-500 font-bold block">معاينة حية لتطبيق الألوان على بطاقات وأزرار المتجر:</span>
                <div className="flex flex-wrap items-center gap-3 p-3 bg-white rounded-lg border border-gray-100">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-2xs"
                    style={{ backgroundColor: storeConfig.primaryColor }}
                  >
                    {storeConfig.logoText || 'س'}
                  </div>

                  <button
                    type="button"
                    className="px-4 py-1.5 text-white text-xs font-bold rounded-lg shadow-2xs"
                    style={{ backgroundColor: storeConfig.primaryColor }}
                  >
                    زر الشراء الرئيسي
                  </button>

                  <span
                    className="px-2.5 py-0.5 rounded-md text-[10px] font-bold border"
                    style={{ borderColor: storeConfig.accentColor, color: storeConfig.primaryColor }}
                  >
                    شارة ترويجية مميزة
                  </span>

                  <div
                    className="px-4 py-1.5 rounded-lg text-white text-[11px] font-bold"
                    style={{ backgroundColor: storeConfig.bannerBgColor }}
                  >
                    أهلاً بك في المتجر الرسمي
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* قسم تصميم المتجر بنمط منصة سلة الاحترافي (Salla Theme Customizer)          */}
        {/* ========================================================================= */}
        {activeTab === 'store-design' && (
          <div className="max-w-5xl mx-auto space-y-6">
            {/* شبكة الأقسام الرئيسية لتصميم المتجر */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              
              {/* العمود الأيمن (8 أعمدة): خيارات وإعدادات التصميم */}
              <div className="lg:col-span-8 space-y-5">
                
                {/* 1. هوية المتجر الأساسية (الاسم، الوصف المختصر، الشعار) */}
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 space-y-4 shadow-2xs">
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-2.5">
                    <i className="fa-solid fa-store text-black text-sm"></i>
                    <h3 className="text-xs font-bold text-gray-900">1. هوية ومعلومات المتجر الأساسية</h3>
                  </div>

                  <div className="space-y-3.5">
                    {/* صف واحد يجمع: اسم المتجر مصغر + نص وزر رفع لوقو + معاينة اللوقو */}
                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 mb-1">اسم وشعار المتجر</label>
                      <div className="flex flex-wrap items-center gap-2.5">
                        {/* بوكس اسم المتجر مصغر ومتناسق */}
                        <div className="w-48 sm:w-60">
                          <input
                            type="text"
                            value={storeConfig.name || ''}
                            onChange={(e) => setStoreConfig(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full p-2 bg-gray-50/70 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:border-black focus:bg-white transition"
                            placeholder="اسم المتجر..."
                          />
                        </div>

                        {/* زر الرفع: أيقونة سوداء فقط بدون أي نص */}
                        <label
                          className="w-7 h-7 bg-black hover:bg-gray-800 text-white rounded-xl flex items-center justify-center cursor-pointer shadow-xs active:scale-95 transition shrink-0"
                          title={storeConfig.logoUrl ? "تغيير صورة اللوقو" : "رفع صورة اللوقو"}
                        >
                          <i className="fa-solid fa-cloud-arrow-up text-sm text-white"></i>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                if (file.size > 3 * 1024 * 1024) {
                                  alert('حجم صورة الشعار كبير! يرجى اختيار صورة أقل من 3 ميجابايت.');
                                  return;
                                }
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                  setStoreConfig(prev => ({ ...prev, logoUrl: reader.result }));
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                          />
                        </label>

                        {/* معاينة اللوقو في نفس الصف */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {storeConfig.logoUrl ? (
                            <div className="relative group">
                              <img
                                src={storeConfig.logoUrl}
                                alt="معاينة اللوقو"
                                className="w-7 h-7 rounded-xl object-cover border border-gray-200 shadow-2xs"
                                title="معاينة اللوقو الحالي"
                              />
                              <button
                                type="button"
                                onClick={() => setStoreConfig(prev => ({ ...prev, logoUrl: '' }))}
                                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-600 text-white text-[9px] flex items-center justify-center shadow-xs cursor-pointer hover:bg-red-700"
                                title="حذف الشعار"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div className="w-7 h-7 rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-gray-400" title="لا يوجد لوقو مرفوع حالياً">
                              <i className="fa-solid fa-image text-xs"></i>
                            </div>
                          )}
                          <span className="text-[10px] text-gray-400 hidden sm:inline">معاينة اللوقو</span>
                        </div>
                      </div>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-gray-700 mb-1">الوصف الفرعي للمتجر</label>
                      <input
                        type="text"
                        value={storeConfig.subTitle || ''}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, subTitle: e.target.value }))}
                        className="w-full p-2.5 bg-gray-50/70 border border-gray-200 rounded-xl text-xs text-gray-700 outline-none focus:border-black focus:bg-white transition"
                        placeholder="مثلاً: كل ما تحتاجه لمزرعتك بأفضل الأسعار وأسرع تسليم"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. نصوص البانر الترحيبي والفوتر */}
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 space-y-4 shadow-2xs">
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-2.5">
                    <i className="fa-solid fa-rectangle-ad text-black text-sm"></i>
                    <h3 className="text-xs font-bold text-gray-900">2. نصوص البانر الترحيبي والفوتر</h3>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 mb-1">عنوان البانر الترحيبي</label>
                      <input
                        type="text"
                        value={storeConfig.bannerTitle || ''}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, bannerTitle: e.target.value }))}
                        className="w-full p-2.5 bg-gray-50/70 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:border-black focus:bg-white"
                        placeholder="أهلاً بك في المتجر الرسمي"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 mb-1">وصف البانر الترحيبي</label>
                      <input
                        type="text"
                        value={storeConfig.bannerDesc || ''}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, bannerDesc: e.target.value }))}
                        className="w-full p-2.5 bg-gray-50/70 border border-gray-200 rounded-xl text-xs text-gray-700 outline-none focus:border-black focus:bg-white"
                        placeholder="تصفح أفضل البطاقات والمنتجات الرقمية بأعلى جودة وضمان مباشر."
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 mb-1">حقوق الملكية في الفوتر</label>
                      <input
                        type="text"
                        value={storeConfig.footerCopyright || ''}
                        onChange={(e) => setStoreConfig(prev => ({ ...prev, footerCopyright: e.target.value }))}
                        className="w-full p-2.5 bg-gray-50/70 border border-gray-200 rounded-xl text-xs text-gray-700 outline-none focus:border-black focus:bg-white"
                        placeholder="جميع الحقوق محفوظة للمتجر © 2026"
                      />
                    </div>
                  </div>
                </div>

                {/* 3. عناصر ومكونات الصفحة الرئيسية (محرر صفحات سلة المتقدم) */}
                <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 space-y-4 shadow-2xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center text-xs">
                        <i className="fa-solid fa-shapes"></i>
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-gray-900">3. عناصر الصفحة الرئيسية (بنظام سلة)</h3>
                        <p className="text-[10px] text-gray-400">تحكم في تشغيل وتخصيص وإضافة كل عنصر في الواجهة الرئيسية للمتجر</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddSectionModal(true)}
                        className="w-fit px-3 py-1.5 bg-[#004956] hover:bg-[#00343D] text-white rounded-xl text-[13px] font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs transition active:scale-95"
                      >
                        <i className="fa-solid fa-plus text-[12px]"></i>
                        <span className="leading-none">إضافة عنصر للواجهة</span>
                      </button>
                    </div>
                  </div>

                  {/* قائمة عناصر وترتيب واجهة المتجر المطابقة لنمط سلة الرسمي بالصورة المرجعية */}
                  <div className="bg-gray-50/70 p-3.5 rounded-xl border border-gray-200/90 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <i className="fa-solid fa-list-ol text-gray-500 text-xs"></i>
                        <span className="text-xs font-bold text-gray-800">ترتيب عناصر الصفحة الرئيسية (نمط سلة)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              localStorage.setItem('haider_store_config', JSON.stringify(storeConfig));
                              localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                              await syncStoreConfigToCloud(storeConfig);
                              showToast('✅ تم حفظ ترتيب العناصر سحابياً بنجاح!');
                            } catch (e) {
                              showToast('حدث خطأ أثناء حفظ الترتيب');
                            }
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-emerald-50 border border-emerald-300 text-emerald-700 rounded-lg text-[11px] font-bold flex items-center gap-1.5 shadow-2xs transition cursor-pointer active:scale-95"
                          title="حفظ ومزامنة ترتيب العناصر الحالية مع السحابة فوراً"
                        >
                          <i className="fa-solid fa-cloud-arrow-up text-emerald-600 text-xs"></i>
                          <span>حفظ الترتيب سحابياً</span>
                        </button>
                        <span className="text-[10px] text-gray-400 font-medium hidden sm:inline">يحفظ تلقائياً عند أي تحريك</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                      {(storeConfig.homeLayout || [
                        { id: 'sec-moving-1', type: 'movingProducts', title: 'أحدث المنتجات', enabled: true },
                        { id: 'sec-wide-1', type: 'wideBanner', title: 'بانر عريض', enabled: true },
                        { id: 'sec-moving-2', type: 'movingProducts', title: 'منتجات متحركة', enabled: true },
                        { id: 'sec-wide-2', type: 'wideBanner', title: 'بانر عريض', enabled: true },
                        { id: 'sec-moving-3', type: 'movingProducts', title: 'منتجات متحركة', enabled: true },
                        { id: 'sec-wide-3', type: 'wideBanner', title: 'بانر عريض', enabled: true },
                        { id: 'sec-moving-4', type: 'movingProducts', title: 'منتجات متحركة', enabled: true },
                        { id: 'sec-wide-4', type: 'wideBanner', title: 'بانر عريض', enabled: true },
                        { id: 'sec-moving-5', type: 'movingProducts', title: 'منتجات متحركة', enabled: true },
                        { id: 'sec-moving-6', type: 'movingProducts', title: 'منتجات متحركة', enabled: true },
                        { id: 'sec-products-grid', type: 'productsGrid', title: 'منتجات ثابتة', enabled: true },
                        { id: 'sec-store-features', type: 'storeFeatures', title: 'مميزات المتجر', enabled: true },
                        { id: 'sec-customer-reviews', type: 'customerReviews', title: 'آراء العملاء', enabled: true },
                        { id: 'sec-items-list', type: 'itemsList', title: 'قائمة عناصر', enabled: true }
                      ]).map((secItem, idx, arr) => {
                        const iconMap = {
                          movingProducts: 'fa-box-archive text-gray-700',
                          wideBanner: 'fa-rectangle-ad text-gray-700',
                          productsGrid: 'fa-grip text-gray-700',
                          storeFeatures: 'fa-star text-gray-700',
                          customerReviews: 'fa-comments text-gray-700',
                          itemsList: 'fa-list-check text-gray-700',
                          bannerSlider: 'fa-images text-gray-700',
                          squareImages: 'fa-border-all text-gray-700'
                        };

                        const displayName = secItem.title || secItem.data?.title || (secItem.type === 'movingProducts' ? 'منتجات متحركة' : secItem.type === 'wideBanner' ? 'بانر عريض' : secItem.type === 'bannerSlider' ? 'بانر سلايدر' : secItem.type === 'squareImages' ? 'صور مربعة' : secItem.type === 'itemsList' ? 'قائمة تصنيفات' : secItem.type);
                        const typeLabel = secItem.type === 'movingProducts' ? 'سلايدر منتجات متحركة' : secItem.type === 'wideBanner' ? 'بانر عريض' : secItem.type === 'bannerSlider' ? 'بانر سلايدر' : secItem.type === 'squareImages' ? 'كروت صور مربعة' : secItem.type === 'itemsList' ? 'شريط أقسام' : secItem.type;
                        const isMenuOpen = openSectionMenuId === (secItem.id || idx);

                        return (
                          <div
                            key={secItem.id || idx}
                            className={`p-2.5 rounded-xl border transition flex items-center justify-between gap-2 relative ${
                              secItem.enabled !== false ? 'bg-white border-gray-200 shadow-2xs hover:border-gray-300' : 'bg-gray-100/70 border-gray-200 text-gray-400 opacity-60'
                            }`}
                          >
                            {/* عرض اسم العنصر فقط */}
                            <div 
                              onClick={() => setEditingLayoutSection(secItem)}
                              className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                              title="انقر لتعديل وتخصيص هذا العنصر"
                            >
                              <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200">
                                <i className={`fa-solid ${iconMap[secItem.type] || 'fa-layer-group'} text-xs`}></i>
                              </div>
                              <span className="text-xs font-bold text-gray-900 truncate hover:text-[#004956] transition">
                                {displayName}
                              </span>
                              {secItem.enabled === false && (
                                <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-medium">معطل</span>
                              )}
                            </div>

                            {/* أزرار الترتيب السريع + زر 3 نقاط مع قائمة الخيارات المنبثقة */}
                            <div className="flex items-center gap-1 shrink-0">
                              {/* أسهم الترتيب السريع (أعلى / أسفل) مباشرة في السطر مع الحفظ السحابي الفوري */}
                              <div className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (idx === 0) return;
                                    setStoreConfig(prev => {
                                      const list = [...(prev.homeLayout || arr)];
                                      const temp = list[idx - 1];
                                      list[idx - 1] = list[idx];
                                      list[idx] = temp;
                                      const updatedConfig = { ...prev, homeLayout: list };
                                      try {
                                        localStorage.setItem('haider_store_config', JSON.stringify(updatedConfig));
                                        localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                                        syncStoreConfigToCloud(updatedConfig);
                                      } catch {}
                                      return updatedConfig;
                                    });
                                    showToast('تم تحريك العنصر للأعلى وحفظ الترتيب سحابياً');
                                  }}
                                  className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-black hover:bg-white rounded text-[10px] disabled:opacity-20 disabled:cursor-not-allowed transition cursor-pointer"
                                  title="تحريك لأعلى"
                                >
                                  ▲
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === arr.length - 1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (idx === arr.length - 1) return;
                                    setStoreConfig(prev => {
                                      const list = [...(prev.homeLayout || arr)];
                                      const temp = list[idx + 1];
                                      list[idx + 1] = list[idx];
                                      list[idx] = temp;
                                      const updatedConfig = { ...prev, homeLayout: list };
                                      try {
                                        localStorage.setItem('haider_store_config', JSON.stringify(updatedConfig));
                                        localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                                        syncStoreConfigToCloud(updatedConfig);
                                      } catch {}
                                      return updatedConfig;
                                    });
                                    showToast('تم تحريك العنصر للأسفل وحفظ الترتيب سحابياً');
                                  }}
                                  className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-black hover:bg-white rounded text-[10px] disabled:opacity-20 disabled:cursor-not-allowed transition cursor-pointer"
                                  title="تحريك لأسفل"
                                >
                                  ▼
                                </button>
                              </div>

                              {/* زر 3 نقاط مع قائمة الخيارات المنبثقة */}
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenSectionMenuId(isMenuOpen ? null : (secItem.id || idx));
                                  }}
                                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition cursor-pointer border ${
                                    isMenuOpen
                                      ? 'bg-black text-white border-black'
                                      : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200'
                                  }`}
                                  title="خيارات العنصر"
                                >
                                  <i className="fa-solid fa-ellipsis-vertical text-xs"></i>
                                </button>

                                {isMenuOpen && (
                                  <>
                                    <div
                                      className="fixed inset-0 z-40"
                                      onClick={() => setOpenSectionMenuId(null)}
                                    ></div>

                                    <div
                                      className="absolute left-0 top-9 z-50 w-48 bg-white rounded-2xl shadow-xl border border-gray-200 py-1.5 animate-in fade-in zoom-in-95 duration-150"
                                      dir="rtl"
                                    >
                                      {/* خيار تعديل وتخصيص */}
                                      <button
                                      type="button"
                                      onClick={() => {
                                        setOpenSectionMenuId(null);
                                        setEditingLayoutSection(secItem);
                                      }}
                                      className="w-full px-3 py-2 text-right text-xs font-bold text-gray-700 hover:bg-gray-100 flex items-center gap-2 cursor-pointer transition"
                                    >
                                      <i className="fa-solid fa-pen-to-square text-gray-600 text-xs w-4 text-center"></i>
                                      <span>تعديل وتخصيص</span>
                                    </button>

                                    {/* تحريك لأعلى */}
                                    <button
                                      type="button"
                                      disabled={idx === 0}
                                      onClick={() => {
                                        setOpenSectionMenuId(null);
                                        if (idx === 0) return;
                                        setStoreConfig(prev => {
                                          const list = [...(prev.homeLayout || arr)];
                                          const temp = list[idx - 1];
                                          list[idx - 1] = list[idx];
                                          list[idx] = temp;
                                          const updatedConfig = { ...prev, homeLayout: list };
                                          try {
                                            localStorage.setItem('haider_store_config', JSON.stringify(updatedConfig));
                                            localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                                            syncStoreConfigToCloud(updatedConfig);
                                          } catch {}
                                          return updatedConfig;
                                        });
                                        showToast('تم تحريك العنصر لأعلى وحفظ الترتيب سحابياً');
                                      }}
                                      className="w-full px-3 py-2 text-right text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer transition"
                                    >
                                      <i className="fa-solid fa-arrow-up text-gray-600 text-xs w-4 text-center"></i>
                                      <span>تحريك لأعلى</span>
                                    </button>

                                    {/* تحريك لأسفل */}
                                    <button
                                      type="button"
                                      disabled={idx === arr.length - 1}
                                      onClick={() => {
                                        setOpenSectionMenuId(null);
                                        if (idx === arr.length - 1) return;
                                        setStoreConfig(prev => {
                                          const list = [...(prev.homeLayout || arr)];
                                          const temp = list[idx + 1];
                                          list[idx + 1] = list[idx];
                                          list[idx] = temp;
                                          const updatedConfig = { ...prev, homeLayout: list };
                                          try {
                                            localStorage.setItem('haider_store_config', JSON.stringify(updatedConfig));
                                            localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                                            syncStoreConfigToCloud(updatedConfig);
                                          } catch {}
                                          return updatedConfig;
                                        });
                                        showToast('تم تحريك العنصر لأسفل وحفظ الترتيب سحابياً');
                                      }}
                                      className="w-full px-3 py-2 text-right text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer transition"
                                    >
                                      <i className="fa-solid fa-arrow-down text-gray-600 text-xs w-4 text-center"></i>
                                      <span>تحريك لأسفل</span>
                                    </button>

                                    {/* خيار تفعيل / تعطيل */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenSectionMenuId(null);
                                        setStoreConfig(prev => {
                                          const list = [...(prev.homeLayout || arr)];
                                          list[idx] = { ...list[idx], enabled: list[idx].enabled === false ? true : false };
                                          const updatedConfig = { ...prev, homeLayout: list };
                                          try {
                                            localStorage.setItem('haider_store_config', JSON.stringify(updatedConfig));
                                            localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                                            syncStoreConfigToCloud(updatedConfig);
                                          } catch {}
                                          return updatedConfig;
                                        });
                                        showToast(secItem.enabled === false ? 'تم تفعيل العنصر بالمتجر' : 'تم تعطيل العنصر من المتجر');
                                      }}
                                      className="w-full px-3 py-2 text-right text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2 cursor-pointer transition"
                                    >
                                      <i className={`fa-solid ${secItem.enabled !== false ? 'fa-eye-slash text-gray-500' : 'fa-eye text-emerald-600'} text-xs w-4 text-center`}></i>
                                      <span>{secItem.enabled !== false ? 'تعطيل من الواجهة' : 'تفعيل بالواجهة'}</span>
                                    </button>

                                    {/* خيار تكرار العنصر */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenSectionMenuId(null);
                                        const dup = {
                                          ...secItem,
                                          id: `sec-${secItem.type}-${Date.now()}`,
                                          title: `${secItem.title || secItem.type} (نسخة)`,
                                          data: secItem.data ? JSON.parse(JSON.stringify(secItem.data)) : {}
                                        };
                                        setStoreConfig(prev => {
                                          const list = [...(prev.homeLayout || arr)];
                                          list.splice(idx + 1, 0, dup);
                                          const updatedConfig = { ...prev, homeLayout: list };
                                          try {
                                            localStorage.setItem('haider_store_config', JSON.stringify(updatedConfig));
                                            localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                                            syncStoreConfigToCloud(updatedConfig);
                                          } catch {}
                                          return updatedConfig;
                                        });
                                        showToast('تم تكرار ونسخ العنصر وتطبيقه بالمتجر بنجاح!');
                                      }}
                                      className="w-full px-3 py-2 text-right text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2 cursor-pointer transition"
                                    >
                                      <i className="fa-solid fa-clone text-blue-600 text-xs w-4 text-center"></i>
                                      <span>نسخ وتكرار</span>
                                    </button>

                                    <div className="h-px bg-gray-100 my-1"></div>

                                    {/* خيار حذف العنصر */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenSectionMenuId(null);
                                        if (window.confirm(`هل أنت متأكد من حذف "${displayName}" نهائياً من الواجهة؟`)) {
                                          setStoreConfig(prev => {
                                            const list = [...(prev.homeLayout || arr)].filter((_, i) => i !== idx);
                                            const updatedConfig = { ...prev, homeLayout: list };
                                            try {
                                              localStorage.setItem('haider_store_config', JSON.stringify(updatedConfig));
                                              localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                                              syncStoreConfigToCloud(updatedConfig);
                                            } catch {}
                                            return updatedConfig;
                                          });
                                          showToast('تم حذف العنصر بنجاح من المتجر');
                                        }
                                      }}
                                      className="w-full px-3 py-2 text-right text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer transition"
                                    >
                                      <i className="fa-solid fa-trash-can text-red-600 text-xs w-4 text-center"></i>
                                      <span>حذف العنصر</span>
                                    </button>
                                  </div>
                                </>
                              )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>


                </div>
              </div>
            </div>

              {/* العمود الأيسر (4 أعمدة): معاينة حية بنمط الجوال وشاشات سلة */}
              <div className="lg:col-span-4 sticky top-20 space-y-4">
                <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2.5 mb-3">
                    <span className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                      <i className="fa-solid fa-mobile-screen text-xs text-black"></i>
                      <span>معاينة حية حقيقية لشكل المتجر</span>
                    </span>
                    <span className="text-[9px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-bold border border-emerald-200">
                      شاشة الجوال الفعلية
                    </span>
                  </div>

                  {/* إطار محاكي لشاشة الجوال بتصميم واقعي مطابق للمتجر */}
                  <div className="rounded-2xl border-[3px] border-gray-900 overflow-hidden bg-[#F9FAFB] shadow-xl text-right" dir="rtl">
                    {/* 1. شريط الإعلانات الترويجي (Ticker) مطابق للمتجر */}
                    {storeConfig.announcementBars && storeConfig.announcementBars.length > 0 ? (
                      storeConfig.announcementBars.slice(0, 1).map((bar, bIdx) => (
                        <div
                          key={bar.id || bIdx}
                          className="py-1 px-2.5 text-center text-[8.5px] font-medium truncate text-white"
                          style={{ backgroundColor: bar.bgColor || storeConfig.bannerBgColor || '#004956', color: bar.textColor || '#ffffff' }}
                        >
                          {bar.text}
                        </div>
                      ))
                    ) : storeConfig.announcement ? (
                      <div className="py-1 px-2.5 text-center text-[8.5px] font-medium truncate text-white" style={{ backgroundColor: storeConfig.bannerBgColor || '#004956' }}>
                        {storeConfig.announcement}
                      </div>
                    ) : (
                      <div className="py-1 px-2 text-center text-[8.5px] font-medium truncate text-white" style={{ backgroundColor: storeConfig.primaryColor || '#004956' }}>
                        ⚡ تسليم فوري لجميع الطلبات على مدار 24 ساعة
                      </div>
                    )}

                    {/* 2. الشريط العلوي: العربية | USD ومعه حقل البحث الحقيقي */}
                    <div className="bg-[#F9FAFB] border-b border-gray-200/80 px-2.5 py-1.5 flex items-center justify-between gap-1.5">
                      <div className="px-2 py-0.5 rounded-full border border-gray-200 bg-white text-black text-[9px] font-light flex items-center gap-1 shrink-0 shadow-2xs">
                        <span>العربية</span>
                        <span className="text-gray-300">|</span>
                        <span>{activeCurrency || 'USD'}</span>
                      </div>
                      <div className="flex-1 min-w-0 relative">
                        <input
                          type="text"
                          readOnly
                          placeholder="ابحث عن منتج..."
                          className="w-full pr-5 pl-2 h-5 bg-white border border-gray-200 rounded-full text-[8.5px] outline-none placeholder:text-gray-400 font-light"
                        />
                        <i className="fa-solid fa-magnifying-glass absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-[8px]"></i>
                      </div>
                    </div>

                    {/* 3. هيدر المتجر الأساسي: زر القائمة + الشعار واسم المتجر + السلة */}
                    <div className="bg-white px-2.5 py-2 border-b border-gray-100 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button type="button" className="p-1 text-gray-700 hover:text-black">
                          <i className="fa-solid fa-bars text-xs text-gray-900"></i>
                        </button>
                        <div className="flex items-center gap-1.5 min-w-0">
                          {storeConfig.logoUrl ? (
                            <img
                              src={storeConfig.logoUrl}
                              alt=""
                              className="w-6 h-6 rounded-lg object-cover border border-gray-100 shrink-0"
                            />
                          ) : (
                            <div
                              className="w-6 h-6 rounded-lg text-white font-bold flex items-center justify-center text-[10px] shrink-0"
                              style={{ backgroundColor: storeConfig.primaryColor }}
                            >
                              {storeConfig.logoText || storeConfig.name?.charAt(0) || 'م'}
                            </div>
                          )}
                          <div className="min-w-0 flex flex-col">
                            <span className="text-[10px] font-bold text-gray-900 truncate leading-tight">
                              {storeConfig.name || 'متجرنا'}
                            </span>
                            {storeConfig.subTitle && (
                              <span className="text-[7.5px] text-gray-400 truncate leading-tight">
                                {storeConfig.subTitle}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <div className="w-6 h-6 rounded-full border border-gray-200 bg-white flex items-center justify-center text-[9px] text-gray-700 relative">
                          <i className="fa-solid fa-bag-shopping"></i>
                          <span className="absolute -top-1 -right-1 w-3 h-3 bg-[#004956] text-white rounded-full text-[7px] flex items-center justify-center font-bold">
                            0
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 4. عرض عناصر ومكونات الصفحة الرئيسية الحقيقية مع إمكانية الترتيب الحي */}
                    <div className="p-2 space-y-3 max-h-[430px] overflow-y-auto font-normal">
                      {(Array.isArray(storeConfig.homeLayout) ? storeConfig.homeLayout : [
                        { id: 'sec-banner-slider', type: 'bannerSlider', enabled: true },
                        { id: 'sec-items-list', type: 'itemsList', enabled: true },
                        { id: 'sec-square-images', type: 'squareImages', enabled: true },
                        { id: 'sec-moving-products', type: 'movingProducts', enabled: true },
                        { id: 'sec-wide-banner', type: 'wideBanner', enabled: true },
                        { id: 'sec-products-grid', type: 'productsGrid', enabled: true },
                        { id: 'sec-store-features', type: 'storeFeatures', enabled: true }
                      ]).map((sec, sIdx, sArr) => {
                        if (sec.enabled === false) return null;
                        const sTitle = sec.title || sec.data?.title || '';

                        return (
                          <div
                            key={sec.id || sIdx}
                            className="relative group/sec bg-white rounded-xl border border-gray-200/90 shadow-2xs hover:border-[#004956] transition p-1.5"
                          >
                            {/* شريط التحكم بالترتيب الحي في المعاينة */}
                            <div className="absolute top-2 left-2 z-20 flex items-center gap-1 bg-white/95 backdrop-blur-xs px-1 py-0.5 rounded-lg border border-gray-200 shadow-xs">
                              <button
                                type="button"
                                disabled={sIdx === 0}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (sIdx === 0) return;
                                  setStoreConfig(prev => {
                                    const list = [...(prev.homeLayout || sArr)];
                                    const temp = list[sIdx - 1];
                                    list[sIdx - 1] = list[sIdx];
                                    list[sIdx] = temp;
                                    const updatedConfig = { ...prev, homeLayout: list };
                                    try {
                                      localStorage.setItem('haider_store_config', JSON.stringify(updatedConfig));
                                      localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                                      syncStoreConfigToCloud(updatedConfig);
                                    } catch {}
                                    return updatedConfig;
                                  });
                                }}
                                className="w-4 h-4 rounded bg-gray-50 hover:bg-gray-200 disabled:opacity-20 flex items-center justify-center text-[7.5px] text-gray-700 cursor-pointer"
                                title="تحريك لأعلى"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                disabled={sIdx === sArr.length - 1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (sIdx === sArr.length - 1) return;
                                  setStoreConfig(prev => {
                                    const list = [...(prev.homeLayout || sArr)];
                                    const temp = list[sIdx + 1];
                                    list[sIdx + 1] = list[sIdx];
                                    list[sIdx] = temp;
                                    const updatedConfig = { ...prev, homeLayout: list };
                                    try {
                                      localStorage.setItem('haider_store_config', JSON.stringify(updatedConfig));
                                      localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                                      syncStoreConfigToCloud(updatedConfig);
                                    } catch {}
                                    return updatedConfig;
                                  });
                                }}
                                className="w-4 h-4 rounded bg-gray-50 hover:bg-gray-200 disabled:opacity-20 flex items-center justify-center text-[7.5px] text-gray-700 cursor-pointer"
                                title="تحريك لأسفل"
                              >
                                ▼
                              </button>
                            </div>

                            {/* 1. سلايدر البانر الترويجي بنمط سلة الحقيقي */}
                            {sec.type === 'bannerSlider' && (() => {
                              const sliderConfig = storeConfig.homeSections?.bannerSlider || {};
                              const slides = sliderConfig.slides || [];
                              const activeSlide = sec.data || slides[0] || {};
                              return (
                                <div className="relative h-28 w-full rounded-lg overflow-hidden bg-gray-900">
                                  <img
                                    src={activeSlide?.imageUrl || 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop&q=80'}
                                    alt=""
                                    className="w-full h-full object-cover opacity-80"
                                  />
                                  <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/40 to-transparent flex flex-col justify-center px-3 text-white">
                                    {(activeSlide?.badgeText || 'عرض حصري') && (
                                      <span className="text-[7.5px] font-bold text-emerald-400 mb-0.5 flex items-center gap-1">
                                        <span className="w-1 h-1 rounded-full bg-emerald-400"></span>
                                        <span>{activeSlide?.badgeText || 'عرض مميز وحصري'}</span>
                                      </span>
                                    )}
                                    <h4 className="text-[10px] font-extrabold line-clamp-1">
                                      {activeSlide?.title || 'عروض حصرية لمتجرك'}
                                    </h4>
                                    <p className="text-[7.5px] text-gray-200 line-clamp-1 mt-0.5">
                                      {activeSlide?.subtitle || 'خصومات فورية وعروض متجددة'}
                                    </p>
                                    <div className="mt-1.5">
                                      <span
                                        className="px-2 py-0.5 rounded text-[7.5px] font-bold text-white inline-block shadow-xs"
                                        style={{ backgroundColor: storeConfig.primaryColor }}
                                      >
                                        {activeSlide?.buttonText || 'تسوق الآن'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* 2. قائمة التصنيفات الحقيقية */}
                            {sec.type === 'itemsList' && (() => {
                              const ilData = sec.data || storeConfig.homeSections?.itemsList || {};
                              return (
                                <div className="space-y-1.5 py-0.5">
                                  <div className="flex items-center justify-between px-0.5">
                                    <span className="text-[8.5px] font-bold text-gray-900">
                                      {ilData.title || 'تصفح كافة الأقسام'}
                                    </span>
                                    <span className="text-[7.5px] text-gray-400 font-medium">
                                      {categories.length} أقسام
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
                                    {categories.slice(0, 5).map((c, i) => (
                                      <div
                                        key={c.id || i}
                                        className={`px-2 py-1 rounded-lg text-[8px] font-semibold whitespace-nowrap flex items-center gap-1 shrink-0 border ${
                                          i === 0
                                            ? 'bg-[#004956] text-white border-[#004956]'
                                            : 'bg-[#F9FAFB] text-gray-700 border-gray-200'
                                        }`}
                                      >
                                        <i className={`fa-solid ${c.icon || 'fa-tag'} text-[7px]`}></i>
                                        <span>{c.name}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* 3. صور مربعة حقيقية */}
                            {sec.type === 'squareImages' && (() => {
                              const sqConfig = sec.data || storeConfig.homeSections?.squareImages || {};
                              const items = sqConfig.items || [
                                { title: 'فئة مميزة 1', imageUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400&auto=format&fit=crop&q=80' },
                                { title: 'فئة مميزة 2', imageUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=400&auto=format&fit=crop&q=80' }
                              ];
                              return (
                                <div className="space-y-1">
                                  <span className="text-[8.5px] font-bold text-gray-900 block truncate">
                                    {sqConfig.title || 'تسوق حسب الفئات المميزة'}
                                  </span>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    {items.slice(0, 2).map((item, idx) => (
                                      <div key={idx} className="relative h-14 rounded-lg overflow-hidden border border-gray-100 bg-gray-100">
                                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent flex flex-col justify-end p-1 text-white">
                                          <span className="text-[7.5px] font-bold truncate">{item.title}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* 4. منتجات متحركة (سلايدر البطاقات الأنيقة بنمط سلة) */}
                            {sec.type === 'movingProducts' && (() => {
                              const mpConfig = sec.data || storeConfig.homeSections?.movingProducts || {};
                              const dispTitle = mpConfig.title || sTitle || 'أحدث المنتجات';
                              const displayProducts = products.length > 0 ? products.slice(0, 3) : [
                                { id: 'p1', title: 'منتج رقمي تجريبي', price: 25, imageUrl: '' }
                              ];
                              return (
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between px-0.5">
                                    <span className="text-[8.5px] font-bold text-gray-900 truncate">{dispTitle}</span>
                                    <span className="text-[7.5px] text-gray-600 font-bold">عرض الكل</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                                    {displayProducts.map((p, pIdx) => (
                                      <div
                                        key={p.id || pIdx}
                                        className="w-24 shrink-0 bg-white border border-gray-100 rounded-xl overflow-hidden shadow-2xs flex flex-col justify-between"
                                      >
                                        <div className="relative h-16 bg-[#F2F4F7] overflow-hidden flex items-center justify-center">
                                          {p.imageUrl ? (
                                            <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                                          ) : (
                                            <i className="fa-solid fa-box text-gray-400 text-sm"></i>
                                          )}
                                          <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white/90 text-gray-400 flex items-center justify-center text-[7px]">
                                            <i className="fa-regular fa-heart"></i>
                                          </span>
                                        </div>
                                        <div className="p-1 space-y-0.5">
                                          <span className="block text-[7.5px] font-medium text-gray-800 truncate">{p.title}</span>
                                          <div className="flex items-center justify-between">
                                            <span className="text-[8px] font-bold font-price text-red-700">
                                              {formatPrice(p.price, activeCurrency)}
                                            </span>
                                          </div>
                                          <button
                                            type="button"
                                            className="w-full py-0.5 rounded border border-gray-200 bg-white text-gray-800 text-[7px] font-bold flex items-center justify-center gap-1"
                                          >
                                            <i className="fa-solid fa-bag-shopping text-[6.5px]"></i>
                                            <span>إضافة</span>
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* 5. بانر عريض حقيقي */}
                            {sec.type === 'wideBanner' && (() => {
                              const wb = sec.data || storeConfig.homeSections?.wideBanner || {};
                              const hasText = Boolean((wb.title && wb.title.trim()) || (wb.subtitle && wb.subtitle.trim()));
                              return (
                                <div className="relative rounded-lg overflow-hidden bg-gray-900 min-h-[50px] flex items-center justify-center">
                                  {wb.imageUrl && (
                                    <img
                                      src={wb.imageUrl}
                                      alt=""
                                      className={`w-full h-auto object-cover block ${hasText ? 'absolute inset-0 h-full opacity-40' : ''}`}
                                    />
                                  )}
                                  {hasText && (
                                    <div className="relative z-10 p-2 text-center text-white space-y-0.5 w-full">
                                      {wb.badgeText && (
                                        <span className="text-[6.5px] bg-amber-400/20 text-amber-300 px-1.5 py-0.2 rounded-full font-bold inline-block">
                                          {wb.badgeText}
                                        </span>
                                      )}
                                      <h4 className="text-[9px] font-black truncate">{wb.title || 'بانر عريض'}</h4>
                                      <p className="text-[7px] text-gray-200 line-clamp-1">{wb.subtitle}</p>
                                    </div>
                                  )}
                                  {!wb.imageUrl && !hasText && (
                                    <div className="p-2 text-center text-white">
                                      <span className="text-[8.5px] font-bold">{sTitle || 'بانر عريض'}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* 6. شبكة المنتجات الرئيسية الحقيقية */}
                            {sec.type === 'productsGrid' && (() => {
                              const pgData = sec.data || storeConfig.homeSections?.productsGrid || {};
                              const gridTitle = pgData.title || 'أحدث المنتجات';
                              const displayProducts = products.length > 0 ? products.slice(0, 2) : [
                                { id: 'pg1', title: 'منتج أساسي 1', price: 50 },
                                { id: 'pg2', title: 'منتج أساسي 2', price: 90 }
                              ];
                              return (
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between px-0.5 border-b border-gray-100 pb-1">
                                    <span className="text-[8.5px] font-bold text-gray-900">{gridTitle}</span>
                                    <span className="text-[7.5px] text-gray-500 bg-gray-100 px-1.5 py-0.2 rounded-full">
                                      {products.length} منتج
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    {displayProducts.map((item, i) => (
                                      <div
                                        key={item.id || i}
                                        className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-2xs flex flex-col justify-between"
                                      >
                                        <div className="relative h-16 bg-[#F2F4F7] overflow-hidden flex items-center justify-center">
                                          {item.imageUrl ? (
                                            <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                                          ) : (
                                            <i className="fa-solid fa-box text-gray-400 text-sm"></i>
                                          )}
                                          <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white/90 text-gray-400 flex items-center justify-center text-[7px]">
                                            <i className="fa-regular fa-heart"></i>
                                          </span>
                                        </div>
                                        <div className="p-1 space-y-0.5">
                                          <span className="block text-[7.5px] font-medium text-gray-800 truncate">{item.title}</span>
                                          <div className="flex items-center justify-between">
                                            <span className="text-[8px] font-bold font-price text-red-700">
                                              {formatPrice(item.price, activeCurrency)}
                                            </span>
                                          </div>
                                          <button
                                            type="button"
                                            className="w-full py-0.5 rounded border border-gray-200 bg-white text-gray-800 text-[7px] font-bold flex items-center justify-center gap-1"
                                          >
                                            <i className="fa-solid fa-bag-shopping text-[6.5px]"></i>
                                            <span>إضافة</span>
                                          </button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* 7. مميزات المتجر الحقيقية */}
                            {sec.type === 'storeFeatures' && (() => {
                              const activeFeatures = (storeConfig.productFeatures?.items || [
                                { id: 'f1', title: 'تسليم فوري', icon: 'fa-solid fa-bolt' },
                                { id: 'f2', title: 'ضمان أصلي', icon: 'fa-solid fa-shield-halved' },
                                { id: 'f3', title: 'دعم متواصل', icon: 'fa-solid fa-comments' }
                              ]).filter(f => f.enabled !== false).slice(0, 3);
                              return (
                                <div className="space-y-1 pt-1">
                                  <span className="text-[8.5px] font-bold text-gray-900 block">مميزات المتجر</span>
                                  <div className="grid grid-cols-3 gap-1">
                                    {activeFeatures.map((feat, fIdx) => (
                                      <div key={feat.id || fIdx} className="p-1 rounded-lg bg-[#F9FAFB] border border-gray-200/80 text-center">
                                        <i className={`${feat.icon || 'fa-solid fa-bolt'} text-[8px] text-gray-900 mb-0.5 block`}></i>
                                        <span className="text-[6.5px] font-bold text-gray-800 block truncate">{feat.title}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* 8. تقييمات العملاء */}
                            {sec.type === 'customerReviews' && (
                              <div className="p-1.5 bg-[#F9FAFB] rounded-lg border border-gray-100 text-center space-y-0.5">
                                <span className="text-[8px] font-bold text-gray-800 block">⭐ آراء وتقييمات العملاء</span>
                                <span className="text-[7px] text-gray-500">تقييمات موثقة من تجارب المشترين</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* 5. فوتر المعاينة الحقيقي */}
                    <div className="p-2 text-center text-[7.5px] text-gray-400 bg-white border-t border-gray-100">
                      {storeConfig.footerCopyright || 'جميع الحقوق محفوظة'}
                    </div>
                  </div>

                  {/* زر المعاينة السريعة */}
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setViewMode && setViewMode('store')}
                      className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <i className="fa-solid fa-eye text-xs"></i>
                      <span>مشاهدة المتجر كعميل</span>
                    </button>
                  </div>
                </div>
              </div>

            </div>

            {/* نافذة مودال منبثقة: إضافة عنصر جديد للصفحة الرئيسية (سلة) */}
            {/* نافذة مودال منبثقة: إضافة عنصر جديد للصفحة الرئيسية (سلة) */}
            {showAddSectionModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
                <div 
                  onClick={(e) => e.stopPropagation()} 
                  className="bg-white rounded-3xl w-full max-w-lg shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                  dir="rtl"
                >
                  <div className="p-4 sm:p-5 bg-white border-b border-gray-200 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-2xl bg-gray-100 text-gray-800 flex items-center justify-center text-sm">
                        <i className="fa-solid fa-layer-group"></i>
                      </div>
                      <div>
                        <h3 className="text-xs sm:text-sm font-bold text-gray-900">إضافة عنصر جديد للواجهة الرئيسية</h3>
                        <p className="text-[10px] text-gray-500">اختر نوع العنصر بالنقر عليه مباشرة لإضافته وتخصيصه</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddSectionModal(false)}
                      className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-black flex items-center justify-center text-xs transition cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="p-4 sm:p-5 space-y-3">
                    {/* حقل إدخال اسم العنصر الجديد */}
                    <div className="p-3 bg-gray-50 rounded-2xl border border-gray-200 mb-2">
                      <label className="block text-xs font-bold text-gray-800 mb-1.5 flex items-center gap-1.5">
                        <i className="fa-solid fa-pen-nib text-gray-700 text-xs"></i>
                        <span>اسم أو عنوان العنصر المخصص (اختياري):</span>
                      </label>
                      <input
                        type="text"
                        value={newSectionCustomTitle}
                        onChange={(e) => setNewSectionCustomTitle(e.target.value)}
                        placeholder="مثال: عروض نهاية الأسبوع، منتجات مختارة، بانر التخفيضات..."
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:border-black focus:ring-1 focus:ring-black transition"
                      />
                      <span className="text-[10px] text-gray-500 mt-1 block">إذا تركته فارغاً سيتم استخدام الاسم الافتراضي لنوع العنصر</span>
                    </div>

                    {[
                      {
                        key: 'movingProducts',
                        title: 'منتجات متحركة (سلايدر منتجات)',
                        desc: 'شريط متحرك للمنتجات حسب التصنيف أو منتجات مختارة يدوياً',
                        icon: 'fa-arrows-left-right-to-line'
                      },
                      {
                        key: 'wideBanner',
                        title: 'بانر عريض ترويجي',
                        desc: 'بانر إعلاني عريض لكامل الشاشة لتخفيضات ومناسبات خاصة مع رفع صورة ورابط',
                        icon: 'fa-panorama'
                      },
                      {
                        key: 'bannerSlider',
                        title: 'بانر (سلايدر متحرك)',
                        desc: 'سلايدر عروض تفاعلي مع نصوص وشارة وأزرار توجيه ورابط أو تصنيف',
                        icon: 'fa-images'
                      },
                      {
                        key: 'squareImages',
                        title: 'صور مربعة (كروت العروض)',
                        desc: 'كروت مربعة لعرض التصنيفات أو العروض المميزة بروابط خاصة',
                        icon: 'fa-border-all'
                      },
                      {
                        key: 'itemsList',
                        title: 'قائمة عناصر وتصنيفات',
                        desc: 'شريط أيقونات وتصنيفات المتجر لتسهيل تصفح الأقسام',
                        icon: 'fa-list-check'
                      }
                    ].map((sec) => (
                      <div
                        key={sec.key}
                        onClick={() => {
                          const customOrDefTitle = newSectionCustomTitle.trim() || sec.title.split('(')[0].trim();
                          const newId = `sec-${sec.key}-${Date.now()}`;
                          const newSection = {
                            id: newId,
                            type: sec.key,
                            title: customOrDefTitle,
                            enabled: true,
                            data: {
                              title: customOrDefTitle,
                              subtitle: '',
                              badgeText: '',
                              buttonText: 'تسوق الآن',
                              imageUrl: '',
                              linkType: 'none',
                              linkUrl: '',
                              linkCat: '',
                              linkProductId: '',
                              sourceType: 'all',
                              selectedCategory: '',
                              selectedProductIds: [],
                              items: sec.key === 'squareImages' ? [
                                { id: '1', title: 'عرض 1', subtitle: '', imageUrl: '', linkType: 'none', linkUrl: '', linkCat: '' },
                                { id: '2', title: 'عرض 2', subtitle: '', imageUrl: '', linkType: 'none', linkUrl: '', linkCat: '' }
                              ] : []
                            }
                          };
                          setStoreConfig(prev => {
                            const currentLayout = Array.isArray(prev.homeLayout) ? [...prev.homeLayout] : [
                              { id: 'sec-banner-slider', type: 'bannerSlider', title: 'بانر سلايدر', enabled: true },
                              { id: 'sec-items-list', type: 'itemsList', title: 'قائمة عناصر', enabled: true },
                              { id: 'sec-square-images', type: 'squareImages', title: 'صور مربعة', enabled: true },
                              { id: 'sec-moving-products', type: 'movingProducts', title: 'منتجات متحركة', enabled: true },
                              { id: 'sec-wide-banner', type: 'wideBanner', title: 'بانر عريض', enabled: true },
                              { id: 'sec-products-grid', type: 'productsGrid', title: 'منتجات ثابتة', enabled: true },
                              { id: 'sec-store-features', type: 'storeFeatures', title: 'مميزات المتجر', enabled: true },
                              { id: 'sec-customer-reviews', type: 'customerReviews', title: 'آراء العملاء', enabled: true }
                            ];
                            const updatedLayout = [...currentLayout, newSection];
                            const updatedConfig = { ...prev, homeLayout: updatedLayout };
                            try {
                              localStorage.setItem('haider_store_config', JSON.stringify(updatedConfig));
                              localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                              syncStoreConfigToCloud(updatedConfig);
                            } catch {}
                            return updatedConfig;
                          });
                          setNewSectionCustomTitle('');
                          setShowAddSectionModal(false);
                          setEditingLayoutSection(newSection);
                          showToast(`تمت إضافة "${newSection.title}" بنجاح!`);
                        }}
                        className="p-3 bg-white hover:bg-gray-50 rounded-2xl border border-gray-200 hover:border-gray-400 transition flex items-center justify-between gap-3 cursor-pointer shadow-2xs group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-10 h-10 rounded-xl bg-gray-100 group-hover:bg-gray-200 text-gray-700 flex items-center justify-center text-sm shrink-0 transition">
                            <i className={`fa-solid ${sec.icon}`}></i>
                          </span>
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-gray-900 block truncate group-hover:text-black transition">{sec.title}</span>
                            <span className="text-[10px] text-gray-400 block line-clamp-1">{sec.desc}</span>
                          </div>
                        </div>
                        <div className="w-7 h-7 rounded-lg bg-gray-50 group-hover:bg-gray-200 text-gray-400 group-hover:text-gray-800 flex items-center justify-center text-xs shrink-0 transition">
                          <i className="fa-solid fa-chevron-left"></i>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setShowAddSectionModal(false)}
                      className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 rounded-xl text-xs font-semibold cursor-pointer transition"
                    >
                      إغلاق
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* نافذة مودال لتعديل وتخصيص تفاصيل أي عنصر (اسم، صورة، رابط، قسم، أو منتجات محددة) */}
            {editingLayoutSection && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
                <div 
                  onClick={(e) => e.stopPropagation()} 
                  className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl border border-gray-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8"
                  dir="rtl"
                >
                  {/* رأس النافذة */}
                  <div className="p-4 sm:p-5 bg-white border-b border-gray-200 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-2xl bg-gray-100 text-gray-800 flex items-center justify-center text-base shadow-xs">
                        <i className="fa-solid fa-pen-to-square"></i>
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">
                          تعديل تفاصيل العنصر: {editingLayoutSection.title || editingLayoutSection.type}
                        </h3>
                        <p className="text-[10px] text-gray-500">
                          تخصيص الاسم، رفع الصور، الروابط، ربط الأقسام، أو تحديد المنتجات بدقة
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingLayoutSection(null)}
                      className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-black flex items-center justify-center text-xs transition cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>

                  {/* جسم النافذة */}
                  <div className="p-4 sm:p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                    
                    {/* 1. اسم وعنوان العنصر */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-gray-800 mb-1">
                          اسم / عنوان العنصر في الصفحة الرئيسية:
                        </label>
                        <input
                          type="text"
                          value={editingLayoutSection.data?.title ?? editingLayoutSection.title ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingLayoutSection(prev => ({
                              ...prev,
                              title: val,
                              data: { ...(prev.data || {}), title: val }
                            }));
                          }}
                          placeholder="مثال: أحدث العروض، أفضل التخفيضات..."
                          className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:border-[#004956] focus:bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-800 mb-1">
                          الوصف الفرعي (اختياري):
                        </label>
                        <input
                          type="text"
                          value={editingLayoutSection.data?.subtitle || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingLayoutSection(prev => ({
                              ...prev,
                              data: { ...(prev.data || {}), subtitle: val }
                            }));
                          }}
                          placeholder="وصف توضيحي يظهر تحت العنوان"
                          className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-800 outline-none focus:border-[#004956] focus:bg-white"
                        />
                      </div>
                    </div>

                    {/* في حال كان بانر أو سلايدر: نصوص إضافية مثل الشارة ونصف الزر */}
                    {(editingLayoutSection.type === 'bannerSlider' || editingLayoutSection.type === 'wideBanner') && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-gray-50/70 p-3 rounded-2xl border border-gray-200/80">
                        <div>
                          <label className="block text-[11px] font-bold text-gray-700 mb-1">نص الشارة الترويجية (Badge):</label>
                          <input
                            type="text"
                            value={editingLayoutSection.data?.badgeText || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditingLayoutSection(prev => ({
                                ...prev,
                                data: { ...(prev.data || {}), badgeText: val }
                              }));
                            }}
                            placeholder="مثال: عرض مميز وحصري"
                            className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:border-[#004956]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-gray-700 mb-1">نص الزر:</label>
                          <input
                            type="text"
                            value={editingLayoutSection.data?.buttonText || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditingLayoutSection(prev => ({
                                ...prev,
                                data: { ...(prev.data || {}), buttonText: val }
                              }));
                            }}
                            placeholder="تسوق الآن"
                            className="w-full p-2 bg-white border border-gray-200 rounded-lg text-xs outline-none focus:border-[#004956]"
                          />
                        </div>
                      </div>
                    )}

                    {/* 2. رفع صورة أو رابط صورة (للبانرات والكروت) */}
                    {(editingLayoutSection.type === 'wideBanner' || editingLayoutSection.type === 'bannerSlider') && (
                      <div className="bg-white p-3.5 rounded-2xl border border-gray-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                            <i className="fa-solid fa-image text-emerald-700"></i>
                            <span>صورة العنصر / البانر:</span>
                          </label>
                          <div className="flex items-center gap-2">
                            <label className="px-3 py-1.5 rounded-xl bg-[#004956] text-white hover:bg-[#00343D] flex items-center gap-1.5 cursor-pointer text-xs font-bold shadow-2xs transition">
                              <i className="fa-solid fa-arrow-up-from-bracket text-xs"></i>
                              <span>رفع من جهازك</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    const reader = new FileReader();
                                    reader.onload = (re) => {
                                      const b64 = re.target.result;
                                      setEditingLayoutSection(prev => ({
                                        ...prev,
                                        data: { ...(prev.data || {}), imageUrl: b64 }
                                      }));
                                    };
                                    reader.readAsDataURL(file);
                                  }
                                }}
                              />
                            </label>
                            {editingLayoutSection.data?.imageUrl && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingLayoutSection(prev => ({
                                    ...prev,
                                    data: { ...(prev.data || {}), imageUrl: '' }
                                  }));
                                }}
                                className="px-2.5 py-1.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 text-xs font-bold cursor-pointer"
                              >
                                حذف الصورة
                              </button>
                            )}
                          </div>
                        </div>

                        {/* معاينة ورابط الصورة */}
                        <div className="flex items-center gap-3">
                          {editingLayoutSection.data?.imageUrl ? (
                            <img
                              src={editingLayoutSection.data.imageUrl}
                              alt="معاينة"
                              className="w-20 h-14 rounded-xl object-cover border border-gray-200 shadow-2xs shrink-0"
                            />
                          ) : (
                            <div className="w-20 h-14 rounded-xl border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-gray-400 text-sm shrink-0">
                              <i className="fa-solid fa-image"></i>
                            </div>
                          )}
                          <input
                            type="text"
                            value={editingLayoutSection.data?.imageUrl || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditingLayoutSection(prev => ({
                                ...prev,
                                data: { ...(prev.data || {}), imageUrl: val }
                              }));
                            }}
                            placeholder="أو أدخل رابط صورة مباشر (URL)..."
                            className="flex-1 p-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono text-left outline-none focus:bg-white"
                          />
                        </div>
                      </div>
                    )}

                    {/* 3. رابط التوجيه أو الربط بقسم محدد أو منتج محدد */}
                    {(editingLayoutSection.type === 'wideBanner' || editingLayoutSection.type === 'bannerSlider') && (
                      <div className="bg-gray-50 p-3.5 rounded-2xl border border-gray-200/90 space-y-3">
                        <label className="block text-xs font-bold text-gray-800">
                          <i className="fa-solid fa-link text-[#004956] ml-1"></i>
                          إجراء النقر (التوجيه عند الضغط على هذا العنصر):
                        </label>

                        {/* خيارات نوع التوجيه */}
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { id: 'url', label: 'رابط خارجي (URL)', icon: 'fa-globe' },
                            { id: 'category', label: 'ربط بقسم محدد', icon: 'fa-tags' },
                            { id: 'product', label: 'ربط بمنتج محدد', icon: 'fa-box' }
                          ].map((t) => {
                            const currentType = editingLayoutSection.data?.linkType || 'none';
                            const isCurrent = currentType === t.id;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                  setEditingLayoutSection(prev => ({
                                    ...prev,
                                    data: { ...(prev.data || {}), linkType: t.id }
                                  }));
                                }}
                                className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                                  isCurrent
                                    ? 'border-[#004956] bg-emerald-50 text-[#004956] ring-1 ring-[#004956]'
                                    : 'border-gray-200 bg-white hover:bg-gray-100 text-gray-700'
                                }`}
                              >
                                <i className={`fa-solid ${t.icon} text-[11px]`}></i>
                                <span>{t.label}</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* حقول التوجيه حسب النوع */}
                        {editingLayoutSection.data?.linkType === 'url' && (
                          <div>
                            <label className="block text-[11px] font-bold text-gray-700 mb-1">رابط الويب (URL):</label>
                            <input
                              type="text"
                              value={editingLayoutSection.data?.linkUrl || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditingLayoutSection(prev => ({
                                  ...prev,
                                  data: { ...(prev.data || {}), linkUrl: val }
                                }));
                              }}
                              placeholder="https://example.com"
                              className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-mono text-left outline-none focus:border-[#004956]"
                            />
                          </div>
                        )}

                        {editingLayoutSection.data?.linkType === 'category' && (
                          <div>
                            <label className="block text-[11px] font-bold text-gray-700 mb-1">اختر القسم الموجه إليه:</label>
                            <select
                              value={editingLayoutSection.data?.linkCat || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditingLayoutSection(prev => ({
                                  ...prev,
                                  data: { ...(prev.data || {}), linkCat: val }
                                }));
                              }}
                              className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:border-[#004956]"
                            >
                              <option value="">-- اختر القسم --</option>
                              {categories.map((c, i) => (
                                <option key={i} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {editingLayoutSection.data?.linkType === 'product' && (
                          <div>
                            <label className="block text-[11px] font-bold text-gray-700 mb-1">اختر المنتج لفتح صفحته مباشرة:</label>
                            <select
                              value={editingLayoutSection.data?.linkProductId || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditingLayoutSection(prev => ({
                                  ...prev,
                                  data: { ...(prev.data || {}), linkProductId: val }
                                }));
                              }}
                              className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:border-[#004956]"
                            >
                              <option value="">-- اختر المنتج من المتجر --</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>{p.title} ({formatPrice(p.price, activeCurrency)})</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 4. تخصيص خاص بعنصر "منتجات متحركة" (Moving Products): مصدر المنتجات وتحديد قسم أو منتجات محددة */}
                    {editingLayoutSection.type === 'movingProducts' && (
                      <div className="bg-gray-50/70 p-3.5 rounded-2xl border border-gray-200 space-y-3">
                        <label className="block text-xs font-bold text-gray-800">
                          <i className="fa-solid fa-boxes-stacked text-gray-700 ml-1"></i>
                          مصدر المنتجات المعروضة في هذا السلايدر المتحرك:
                        </label>

                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { id: 'all', label: 'كل المنتجات', icon: 'fa-globe' },
                            { id: 'category', label: 'قسم محدد', icon: 'fa-tags' },
                            { id: 'custom', label: 'منتجات مختارة يدوياً', icon: 'fa-check-double' }
                          ].map((src) => {
                            const curSource = editingLayoutSection.data?.sourceType || 'all';
                            const isCurrent = curSource === src.id;
                            return (
                              <button
                                key={src.id}
                                type="button"
                                onClick={() => {
                                  setEditingLayoutSection(prev => ({
                                    ...prev,
                                    data: { ...(prev.data || {}), sourceType: src.id }
                                  }));
                                }}
                                className={`py-2 px-2.5 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                                  isCurrent
                                    ? 'border-black bg-black text-white'
                                    : 'border-gray-200 bg-white hover:bg-gray-100 text-gray-700'
                                }`}
                              >
                                <i className={`fa-solid ${src.icon} text-[11px]`}></i>
                                <span>{src.label}</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* عند اختيار قسم محدد */}
                        {editingLayoutSection.data?.sourceType === 'category' && (
                          <div className="pt-2">
                            <label className="block text-[11px] font-bold text-gray-700 mb-1">اختر القسم لعرض منتجاته:</label>
                            <select
                              value={editingLayoutSection.data?.selectedCategory || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditingLayoutSection(prev => ({
                                  ...prev,
                                  data: { ...(prev.data || {}), selectedCategory: val }
                                }));
                              }}
                              className="w-full p-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:border-black"
                            >
                              <option value="">-- كل الأقسام --</option>
                              {categories.map((c, i) => (
                                <option key={i} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* عند اختيار منتجات محددة يدوياً */}
                        {editingLayoutSection.data?.sourceType === 'custom' && (
                          <div className="pt-2 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-gray-700">حدد المنتجات التي تود ظهورها في السلايدر:</span>
                              <span className="text-[10px] font-bold text-gray-800 bg-gray-200 px-2 py-0.5 rounded-md">
                                تم اختيار {editingLayoutSection.data?.selectedProductIds?.length || 0} منتج
                              </span>
                            </div>

                            <div className="max-h-48 overflow-y-auto space-y-1.5 border border-gray-200 rounded-xl p-2 bg-white">
                              {products.map((p) => {
                                const selIds = editingLayoutSection.data?.selectedProductIds || [];
                                const isSelected = selIds.includes(p.id);
                                return (
                                  <div
                                    key={p.id}
                                    onClick={() => {
                                      const nextIds = isSelected 
                                        ? selIds.filter(id => id !== p.id) 
                                        : [...selIds, p.id];
                                      setEditingLayoutSection(prev => ({
                                        ...prev,
                                        data: { ...(prev.data || {}), selectedProductIds: nextIds }
                                      }));
                                    }}
                                    className={`p-2 rounded-lg border flex items-center justify-between cursor-pointer transition ${
                                      isSelected ? 'border-gray-900 bg-gray-100' : 'border-gray-200 hover:bg-gray-50'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <img src={p.imageUrl} alt="" className="w-8 h-8 rounded object-cover border border-gray-200 shrink-0" />
                                      <div className="min-w-0">
                                        <span className="text-xs font-bold text-gray-900 block truncate">{p.title}</span>
                                        <span className="text-[10px] text-gray-500 block truncate">{p.category} - {formatPrice(p.price, activeCurrency)}</span>
                                      </div>
                                    </div>
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      readOnly
                                      className="w-4 h-4 text-black rounded border-gray-300 pointer-events-none"
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 5. تخصيص خاص بـ "صور مربعة" (Square Images) */}
                    {editingLayoutSection.type === 'squareImages' && (
                      <div className="space-y-3 bg-gray-50/70 p-3.5 rounded-2xl border border-gray-200">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                            <i className="fa-solid fa-border-all text-gray-700"></i>
                            <span>إدارة بطاقات وكروت العروض المربعة:</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              const newCard = {
                                id: String(Date.now()),
                                title: `كارت جديد ${(editingLayoutSection.data?.items || []).length + 1}`,
                                subtitle: '',
                                imageUrl: '',
                                linkType: 'none',
                                linkUrl: '',
                                linkCat: ''
                              };
                              setEditingLayoutSection(prev => ({
                                ...prev,
                                data: {
                                  ...(prev.data || {}),
                                  items: [...(prev.data?.items || []), newCard]
                                }
                              }));
                            }}
                            className="px-2.5 py-1 bg-gray-900 hover:bg-black text-white text-[11px] font-bold rounded-lg cursor-pointer transition shadow-2xs"
                          >
                            + إضافة كارت جديد
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {(editingLayoutSection.data?.items || []).map((card, cIdx) => (
                            <div key={card.id || cIdx} className="bg-white p-2.5 rounded-xl border border-gray-200 space-y-2 shadow-2xs">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-gray-800">كارت #{cIdx + 1}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingLayoutSection(prev => ({
                                      ...prev,
                                      data: {
                                        ...(prev.data || {}),
                                        items: prev.data.items.filter((_, idx) => idx !== cIdx)
                                      }
                                    }));
                                  }}
                                  className="w-6 h-6 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center text-xs cursor-pointer"
                                  title="حذف الكارت"
                                >
                                  ✕
                                </button>
                              </div>

                              <div className="flex items-center gap-2">
                                {card.imageUrl ? (
                                  <img src={card.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover border border-gray-200 shrink-0" />
                                ) : (
                                  <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 text-xs shrink-0">
                                    <i className="fa-solid fa-image"></i>
                                  </div>
                                )}
                                <div className="flex-1 space-y-1">
                                  <input
                                    type="text"
                                    value={card.title || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setEditingLayoutSection(prev => {
                                        const nextItems = [...(prev.data?.items || [])];
                                        nextItems[cIdx] = { ...nextItems[cIdx], title: val };
                                        return { ...prev, data: { ...(prev.data || {}), items: nextItems } };
                                      });
                                    }}
                                    placeholder="عنوان الكارت..."
                                    className="w-full p-1 bg-gray-50 border border-gray-200 rounded text-[11px] font-bold outline-none"
                                  />
                                  <label className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-0.5 rounded cursor-pointer inline-flex items-center gap-1">
                                    <i className="fa-solid fa-arrow-up-from-bracket text-[9px]"></i>
                                    <span>رفع صورة</span>
                                    <input
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) {
                                          const reader = new FileReader();
                                          reader.onload = (re) => {
                                            const b64 = re.target.result;
                                            setEditingLayoutSection(prev => {
                                              const nextItems = [...(prev.data?.items || [])];
                                              nextItems[cIdx] = { ...nextItems[cIdx], imageUrl: b64 };
                                              return { ...prev, data: { ...(prev.data || {}), items: nextItems } };
                                            });
                                          };
                                          reader.readAsDataURL(file);
                                        }
                                      }}
                                    />
                                  </label>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-gray-100">
                                <div>
                                  <label className="block text-[9px] text-gray-500 font-bold mb-0.5">رابط URL:</label>
                                  <input
                                    type="text"
                                    value={card.linkUrl || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setEditingLayoutSection(prev => {
                                        const nextItems = [...(prev.data?.items || [])];
                                        nextItems[cIdx] = { ...nextItems[cIdx], linkUrl: val };
                                        return { ...prev, data: { ...(prev.data || {}), items: nextItems } };
                                      });
                                    }}
                                    placeholder="https://..."
                                    className="w-full p-1 bg-gray-50 border border-gray-200 rounded text-[10px] font-mono text-left outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[9px] text-gray-500 font-bold mb-0.5">أو توجيه لقسم:</label>
                                  <select
                                    value={card.linkCat || ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setEditingLayoutSection(prev => {
                                        const nextItems = [...(prev.data?.items || [])];
                                        nextItems[cIdx] = { ...nextItems[cIdx], linkCat: val };
                                        return { ...prev, data: { ...(prev.data || {}), items: nextItems } };
                                      });
                                    }}
                                    className="w-full p-1 bg-gray-50 border border-gray-200 rounded text-[10px] font-bold outline-none"
                                  >
                                    <option value="">بدون قسم</option>
                                    {categories.map((c, i) => (
                                      <option key={i} value={c.name}>{c.name}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>

                  {/* أسفل النافذة: أزرار الحفظ والإغلاق */}
                  <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setEditingLayoutSection(null)}
                      className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl text-xs font-semibold cursor-pointer"
                    >
                      إلغاء
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        // حفظ التعديلات على العنصر في قائمة homeLayout
                        setStoreConfig(prev => {
                          const currentLayout = Array.isArray(prev.homeLayout) ? [...prev.homeLayout] : [];
                          const updated = currentLayout.map(item => {
                            if (item.id === editingLayoutSection.id) {
                              return {
                                ...item,
                                title: editingLayoutSection.title || item.title,
                                data: {
                                  ...(item.data || {}),
                                  ...(editingLayoutSection.data || {})
                                }
                              };
                            }
                            return item;
                          });
                          const updatedConfig = { ...prev, homeLayout: updated };
                          try {
                            localStorage.setItem('haider_store_config', JSON.stringify(updatedConfig));
                            localStorage.setItem('haider_store_config_updatedAt', String(Date.now()));
                            syncStoreConfigToCloud(updatedConfig);
                          } catch {}
                          return updatedConfig;
                        });
                        setEditingLayoutSection(null);
                        showToast('تم حفظ وتطبيق وتحديث العنصر في المتجر بنجاح!');
                      }}
                      className="px-6 py-2.5 bg-[#004956] hover:bg-[#00343D] text-white rounded-xl text-xs font-bold cursor-pointer shadow-md transition active:scale-95 flex items-center gap-1.5"
                    >
                      <i className="fa-solid fa-check text-xs"></i>
                      <span>حفظ التعديلات</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* ========================================================= */}
        {/* قسم برنامج نقاط الولاء والمكافآت للعملاء                 */}
        {/* ========================================================= */}
        {activeTab === 'loyalty' && (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* رأس قسم الولاء */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-white flex items-center justify-center text-lg shadow-xs">
                  <i className="fa-solid fa-gift"></i>
                </div>
                <div>
                  <h2 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-2">
                    <span>برنامج نقاط الولاء ومكافآت الشراء</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      storeConfig.loyaltyConfig?.enabled !== false
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {storeConfig.loyaltyConfig?.enabled !== false ? 'مفعّل حالياً' : 'معطّل'}
                    </span>
                  </h2>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    امنح عملاء متجرك نقاط مكافأة تلقائية عند كل عملية شراء مكتملة مع إمكانية استبدالها برصيد حقيقي في المحفظة
                  </p>
                </div>
              </div>

              {/* زر الحفظ */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleSaveAllSettings}
                  disabled={isSavingGlobalSettings}
                  className="px-4 py-2 bg-[#004956] hover:bg-[#00343D] text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-75"
                >
                  <i className={`fa-solid ${isSavingGlobalSettings ? 'fa-spinner fa-spin' : 'fa-check'} text-xs`}></i>
                  <span>{isSavingGlobalSettings ? 'جاري الحفظ...' : 'حفظ التعديلات'}</span>
                </button>
              </div>
            </div>

            {/* بطاقات الإحصائيات السريعة للولاء */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-gray-200 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-gray-400 font-bold block mb-0.5">حالة النظام</span>
                  <span className={`text-sm font-bold ${storeConfig.loyaltyConfig?.enabled !== false ? 'text-emerald-700' : 'text-gray-400'}`}>
                    {storeConfig.loyaltyConfig?.enabled !== false ? 'نشط ويعمل' : 'متوقف'}
                  </span>
                </div>
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-sm">
                  <i className="fa-solid fa-circle-check"></i>
                </div>
              </div>

              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-gray-200 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-gray-400 font-bold block mb-0.5">معدل كسب النقاط</span>
                  <span className="text-sm font-bold text-gray-900 font-mono">
                    كل ${storeConfig.loyaltyConfig?.spendUsdPerPoint || 10} = 1 نقطة
                  </span>
                </div>
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center text-sm">
                  <i className="fa-solid fa-star"></i>
                </div>
              </div>

              <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-gray-200 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-gray-400 font-bold block mb-0.5">قيمة استبدال النقاط</span>
                  <span className="text-sm font-bold text-gray-900 font-mono">
                    كل {storeConfig.loyaltyConfig?.pointsPerUsd || 10} نقاط = $1
                  </span>
                </div>
                <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center text-sm">
                  <i className="fa-solid fa-coins"></i>
                </div>
              </div>
            </div>

            {/* بطاقة التحكم الرئيسية بإعدادات الولاء */}
            <div className="bg-white p-4 sm:p-6 rounded-2xl border border-gray-200 shadow-2xs space-y-5">
              {/* مفتاح التفعيل / التعطيل */}
              <div className="flex items-center justify-between p-3.5 bg-gray-50/80 rounded-xl border border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white border border-gray-200 text-[#004956] flex items-center justify-center text-sm shrink-0">
                    <i className="fa-solid fa-toggle-on"></i>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-gray-900">تشغيل برنامج الولاء والمكافآت</h3>
                    <p className="text-[10px] text-gray-500">عند تفعيله، سيتم منح العملاء نقاطاً فور اكتمال طلباتهم ويمكنهم تحويلها لرصيد محفظة</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={storeConfig.loyaltyConfig?.enabled !== false}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setStoreConfig(prev => ({
                        ...prev,
                        loyaltyConfig: {
                          ...(prev.loyaltyConfig || {}),
                          enabled: val
                        }
                      }));
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#004956]"></div>
                </label>
              </div>

              {/* مدخلات الحساب ومعدلات النقاط */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                      <i className="fa-solid fa-cart-shopping text-emerald-600"></i>
                      <span>معدل اكتساب النقاط (الإنفاق)</span>
                    </label>
                    <span className="text-[10px] bg-white px-2 py-0.5 rounded-md border border-gray-200 font-mono font-bold text-gray-600">
                      بالدولار ($)
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    كم دولار ينفق العميل في طلبه ليحصل على (1 نقطة) مكافأة؟
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs font-bold text-gray-600">كل</span>
                    <input
                      type="number"
                      min="0.1"
                      step="0.5"
                      value={storeConfig.loyaltyConfig?.spendUsdPerPoint ?? 10}
                      onChange={(e) => {
                        const val = e.target.value === '' ? '' : Math.max(0.1, parseFloat(e.target.value) || 1);
                        setStoreConfig(prev => ({
                          ...prev,
                          loyaltyConfig: {
                            ...(prev.loyaltyConfig || {}),
                            spendUsdPerPoint: val
                          }
                        }));
                      }}
                      className="w-24 p-2 bg-white border border-gray-300 rounded-xl text-xs font-mono font-bold text-center outline-none focus:border-[#004956]"
                      placeholder="10"
                    />
                    <span className="text-xs font-bold text-gray-800">$ مشتريات = 1 نقطة ولاء ⭐</span>
                  </div>
                </div>

                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                      <i className="fa-solid fa-wallet text-amber-600"></i>
                      <span>معدل استبدال النقاط (القيمة)</span>
                    </label>
                    <span className="text-[10px] bg-white px-2 py-0.5 rounded-md border border-gray-200 font-mono font-bold text-gray-600">
                      نقاط / دولار
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    كم نقطة يحتاج العميل لاستبدالها والحصول على ($1 دولار) في محفظته؟
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs font-bold text-gray-600">كل</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={storeConfig.loyaltyConfig?.pointsPerUsd ?? 10}
                      onChange={(e) => {
                        const val = e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 1);
                        setStoreConfig(prev => ({
                          ...prev,
                          loyaltyConfig: {
                            ...(prev.loyaltyConfig || {}),
                            pointsPerUsd: val
                          }
                        }));
                      }}
                      className="w-24 p-2 bg-white border border-gray-300 rounded-xl text-xs font-mono font-bold text-center outline-none focus:border-[#004956]"
                      placeholder="10"
                    />
                    <span className="text-xs font-bold text-gray-800">نقاط = 1.00 $ رصيد محفظة 💰</span>
                  </div>
                </div>
              </div>

              {/* مثال توضيحي عملي للحسابات */}
              <div className="p-3.5 bg-blue-50/70 border border-blue-200/80 rounded-2xl space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-bold text-blue-950">
                  <i className="fa-solid fa-lightbulb text-amber-500"></i>
                  <span>مثال عملي حي وفق إعداداتك الحالية:</span>
                </div>
                <p className="text-[11px] text-blue-900 leading-relaxed font-normal">
                  • عند شراء عميل طلب بقيمة <strong>$100</strong>، سيحصل فور إكمال طلبه على تلقائياً <strong>{Math.floor(100 / (parseFloat(storeConfig.loyaltyConfig?.spendUsdPerPoint) || 10))} نقطة</strong> في حسابه مع إشعار تهنئة.
                  <br />
                  • إذا كان لدى العميل <strong>50 نقطة</strong>، يمكنه استبدالها بنقرة واحدة من حسابه والحصول على <strong>${(50 / (parseFloat(storeConfig.loyaltyConfig?.pointsPerUsd) || 10)).toFixed(2)} دولار</strong> تضاف فوراً لمحفظته للشراء بها.
                </p>
              </div>

              {/* قائمة العملاء الأكثر ولاءً ونقاطاً */}
              <div className="pt-2 border-t border-gray-100 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-crown text-amber-500 text-xs"></i>
                    <h3 className="text-xs font-bold text-gray-900">أعلى العملاء امتلاكاً لنقاط الولاء</h3>
                  </div>
                  <span className="text-[10px] text-gray-400">تحديث مباشر من قاعدة بيانات العملاء</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {customers
                    .filter(c => (c.points || 0) > 0)
                    .sort((a, b) => (b.points || 0) - (a.points || 0))
                    .slice(0, 6)
                    .map((cust) => (
                      <div key={cust.id} className="p-2.5 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-gray-900 block truncate">{cust.name}</span>
                          <span className="text-[10px] text-gray-500 block truncate">{cust.phone || cust.email}</span>
                        </div>
                        <div className="text-left shrink-0 mr-2">
                          <span className="text-xs font-black text-amber-600 font-mono block">⭐ {cust.points || 0}</span>
                          <span className="text-[9px] text-gray-400 font-mono block">
                            ≈ ${((cust.points || 0) / (parseFloat(storeConfig.loyaltyConfig?.pointsPerUsd) || 10)).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  {customers.filter(c => (c.points || 0) > 0).length === 0 && (
                    <div className="col-span-full p-4 bg-gray-50 rounded-xl text-center text-gray-400 text-xs border border-dashed border-gray-200">
                      لا يوجد عملاء يمتلكون نقاطاً بعد. ستبدأ النقاط بالظهور مع أول طلب مكتمل!
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 9. قسم وسائل الدفع والباركود المخصص (مفصول بالكامل)       */}
        {/* ========================================================= */}
        {activeTab === 'payments' && (
          <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-gray-100 p-6 shadow-xs space-y-6">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-gray-800 flex items-center gap-2">
                <i className="fa-solid fa-credit-card text-black text-sm"></i>
                <span>إدارة وسائل الدفع والباركود الإلكتروني (QR Code)</span>
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                تخصيص أرقام الحسابات، وصور باركود الدفع المباشر، وسعر صرف الدولار مقابل الدينار.
              </p>
            </div>

            <div className="space-y-5">
              {/* 1. إعدادات باركود بينانس باي (Binance Pay) */}
              <div className="p-4 bg-amber-50/70 border border-amber-200/80 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-950">🟡 بينانس باي (Binance Pay)</span>
                  <span className="text-[10px] text-amber-800 bg-amber-100 px-2 py-0.5 rounded">USDT</span>
                </div>

                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">Binance Pay ID</label>
                  <input
                    type="text"
                    value={storeConfig.binancePayId}
                    onChange={(e) => setStoreConfig({ ...storeConfig, binancePayId: e.target.value })}
                    className="w-full p-2 bg-white border border-amber-300 rounded-xl text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">صورة باركود Binance Pay (QR Code)</label>
                  <div className="flex items-center gap-3">
                    <label className="flex-1 cursor-pointer border border-dashed border-amber-300 hover:border-amber-500 p-3 rounded-xl bg-white text-center">
                      <span className="text-xs text-gray-600 block">اضغط لاختيار صورة باركود بينانس من جهازك</span>
                      <input type="file" accept="image/*" onChange={(e) => handleUploadPaymentQr(e, 'binanceQrCode')} className="hidden" />
                    </label>
                    {storeConfig.binanceQrCode && (
                      <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-amber-200">
                        <img src={storeConfig.binanceQrCode} alt="" className="w-full h-full object-contain" />
                        <button
                          type="button"
                          onClick={() => setStoreConfig(prev => ({ ...prev, binanceQrCode: '' }))}
                          className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full w-4 h-4 text-[9px] flex items-center justify-center cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 2. إعدادات باركود زين كاش (ZainCash) */}
              <div className="p-4 bg-purple-50/70 border border-purple-200/80 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-950">📱 محفظة زين كاش العراق</span>
                  <span className="text-[10px] text-purple-800 bg-purple-100 px-2 py-0.5 rounded">IQD</span>
                </div>

                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">رقم محفظة زين كاش</label>
                  <input
                    type="text"
                    value={storeConfig.zainCashNumber}
                    onChange={(e) => setStoreConfig({ ...storeConfig, zainCashNumber: e.target.value })}
                    className="w-full p-2 bg-white border border-purple-300 rounded-xl text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">صورة باركود محفظة زين كاش (QR Code)</label>
                  <div className="flex items-center gap-3">
                    <label className="flex-1 cursor-pointer border border-dashed border-purple-300 hover:border-purple-500 p-3 rounded-xl bg-white text-center">
                      <span className="text-xs text-gray-600 block">اضغط لاختيار باركود زين كاش من تطبيقك</span>
                      <input type="file" accept="image/*" onChange={(e) => handleUploadPaymentQr(e, 'zainCashQrCode')} className="hidden" />
                    </label>
                    {storeConfig.zainCashQrCode && (
                      <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-purple-200">
                        <img src={storeConfig.zainCashQrCode} alt="" className="w-full h-full object-contain" />
                        <button
                          type="button"
                          onClick={() => setStoreConfig(prev => ({ ...prev, zainCashQrCode: '' }))}
                          className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full w-4 h-4 text-[9px] flex items-center justify-center cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. إعدادات باركود ماستر كارد / الحساب البنكي */}
              <div className="p-4 bg-red-50/70 border border-red-200/80 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-red-950">💳 ماستر كارد / مصرف عراقي (FIB / Qi Card)</span>
                  <span className="text-[10px] text-red-800 bg-red-100 px-2 py-0.5 rounded">بنكي</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1">رقم البطاقة / الحساب</label>
                    <input
                      type="text"
                      value={storeConfig.masterCardIraqi}
                      onChange={(e) => setStoreConfig({ ...storeConfig, masterCardIraqi: e.target.value })}
                      className="w-full p-2 bg-white border border-red-300 rounded-xl text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1">اسم المستفيد / المصرف</label>
                    <input
                      type="text"
                      value={storeConfig.masterCardBeneficiary}
                      onChange={(e) => setStoreConfig({ ...storeConfig, masterCardBeneficiary: e.target.value })}
                      className="w-full p-2 bg-white border border-red-300 rounded-xl text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">صورة باركود البطاقة أو الحساب البنكي</label>
                  <div className="flex items-center gap-3">
                    <label className="flex-1 cursor-pointer border border-dashed border-red-300 hover:border-red-500 p-3 rounded-xl bg-white text-center">
                      <span className="text-xs text-gray-600 block">اضغط لاختيار صورة باركود البطاقة (اختياري)</span>
                      <input type="file" accept="image/*" onChange={(e) => handleUploadPaymentQr(e, 'masterCardQrCode')} className="hidden" />
                    </label>
                    {storeConfig.masterCardQrCode && (
                      <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-red-200">
                        <img src={storeConfig.masterCardQrCode} alt="" className="w-full h-full object-contain" />
                        <button
                          type="button"
                          onClick={() => setStoreConfig(prev => ({ ...prev, masterCardQrCode: '' }))}
                          className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full w-4 h-4 text-[9px] flex items-center justify-center cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 4. إعدادات باركود OKX Pay */}
              <div className="p-3 bg-gray-50 border border-gray-300 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-900">⚫ منصة OKX (USDT)</span>
                  <span className="text-[10px] bg-black text-white px-2 py-0.5 rounded">TRC20</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1">OKX UID</label>
                    <input
                      type="text"
                      value={storeConfig.okxUid}
                      onChange={(e) => setStoreConfig({ ...storeConfig, okxUid: e.target.value })}
                      className="w-full p-2 bg-white border border-gray-300 rounded-xl text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-gray-600 mb-1">عنوان USDT (TRC20)</label>
                    <input
                      type="text"
                      value={storeConfig.okxUsdtAddress}
                      onChange={(e) => setStoreConfig({ ...storeConfig, okxUsdtAddress: e.target.value })}
                      className="w-full p-2 bg-white border border-gray-300 rounded-xl text-xs font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-gray-600 mb-1">صورة باركود محفظة OKX (QR Code)</label>
                  <div className="flex items-center gap-3">
                    <label className="flex-1 cursor-pointer border border-dashed border-gray-300 hover:border-black p-3 rounded-xl bg-white text-center">
                      <span className="text-xs text-gray-600 block">اضغط لاختيار صورة باركود محفظة OKX</span>
                      <input type="file" accept="image/*" onChange={(e) => handleUploadPaymentQr(e, 'okxQrCode')} className="hidden" />
                    </label>
                    {storeConfig.okxQrCode && (
                      <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-gray-300">
                        <img src={storeConfig.okxQrCode} alt="" className="w-full h-full object-contain" />
                        <button
                          type="button"
                          onClick={() => setStoreConfig(prev => ({ ...prev, okxQrCode: '' }))}
                          className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full w-4 h-4 text-[9px] flex items-center justify-center cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 5. إعدادات تأكيد الطلبات وتنبيهات بوت تيليجرام التلقائي */}
              <div className="p-4 bg-sky-50/70 border border-sky-200/80 rounded-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-sky-950">✈️ تأكيد الطلبات وتنبيهات تيليجرام الفورية للإدارة</span>
                  <span className="text-[10px] bg-sky-500 text-white px-2 py-0.5 rounded">إشعار فوري</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-700 mb-1 font-medium">
                      معرف تيليجرام للتواصل (Username بدون @)
                    </label>
                    <div className="flex items-center">
                      <span className="bg-sky-100 border border-sky-300 border-l-0 px-2.5 py-2 rounded-r-xl text-xs font-mono text-sky-800">@</span>
                      <input
                        type="text"
                        value={storeConfig.telegram || ''}
                        onChange={(e) => setStoreConfig({ ...storeConfig, telegram: e.target.value.replace('@', '').trim() })}
                        placeholder="my_username"
                        className="w-full p-2 bg-white border border-sky-300 rounded-l-xl text-xs font-mono outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-gray-700 mb-1 font-medium">
                      رقم واتساب للتواصل السريع (مع رمز الدولة)
                    </label>
                    <input
                      type="text"
                      value={storeConfig.whatsapp || ''}
                      onChange={(e) => setStoreConfig({ ...storeConfig, whatsapp: e.target.value.trim() })}
                      placeholder="966500000000"
                      className="w-full p-2 bg-white border border-green-300 rounded-xl text-xs font-mono outline-none"
                    />
                  </div>
                </div>

                {/* إعدادات بوت تيليجرام للإشعارات الفورية */}
                <div className="p-3 bg-white rounded-xl border border-sky-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-sky-900 flex items-center gap-1.5">
                      <i className="fa-brands fa-telegram text-sky-600"></i>
                      <span>ربط بوت تيليجرام (تصلك رسالة فور كل طلب شراء أو شحن محفظة)</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[10px] text-gray-600 mb-1">Bot Token (من BotFather):</label>
                      <input
                        type="text"
                        value={storeConfig.telegramBotToken || ''}
                        onChange={(e) => setStoreConfig({ ...storeConfig, telegramBotToken: e.target.value.trim() })}
                        placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-600 mb-1">Chat ID (آيدي الشات أو القناة):</label>
                      <input
                        type="text"
                        value={storeConfig.telegramChatId || ''}
                        onChange={(e) => setStoreConfig({ ...storeConfig, telegramChatId: e.target.value.trim() })}
                        placeholder="مثال: 987654321"
                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono outline-none"
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-400 block leading-relaxed">
                    💡 بمجرد إدخال التوكن والشات آيدي، سيرسل المتجر إشعاراً آلياً وفورياً لهاتفك عند أي عملية شراء أو شحن محفظة.
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={storeConfig.enableFloatingSupport !== false}
                      onChange={(e) => setStoreConfig({ ...storeConfig, enableFloatingSupport: e.target.checked })}
                      className="w-4 h-4 rounded accent-[#004956] cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-gray-800">إظهار زر الدعم الفني المباشر العائم في واجهة المتجر</span>
                  </label>
                </div>
              </div>

              {/* 6. سعر صرف الدولار مقابل الدينار العراقي */}
              <div className="p-4 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl space-y-3">
                <span className="text-xs font-semibold text-emerald-950">💵 سعر صرف الدولار مقابل الدينار العراقي</span>
                <div>
                  <input
                    type="number"
                    value={storeConfig.usdToIqdRate}
                    onChange={(e) => setStoreConfig({ ...storeConfig, usdToIqdRate: parseFloat(e.target.value) || 1500 })}
                    className="w-full p-2 bg-white border border-emerald-300 rounded-xl text-xs font-mono font-bold"
                  />
                  <span className="text-[10px] text-emerald-700 mt-1 block">
                    يتم تحويل أي سعر بالدولار تلقائياً إلى الدينار بناءً على هذا المعدل ($1 = {storeConfig.usdToIqdRate} د.ع).
                  </span>
                </div>
              </div>

              {/* 7. النسخ الاحتياطي والاستعادة الشاملة (One-Click Backup & Restore) */}
              <div className="p-4 bg-purple-50/70 border border-purple-200/80 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-950">💾 النسخ الاحتياطي واستعادة البيانات بالكامل</span>
                  <span className="text-[10px] bg-purple-600 text-white px-2 py-0.5 rounded">حماية كاملة</span>
                </div>
                <p className="text-[11px] text-purple-900 leading-relaxed">
                  يمكنك تنزيل نسخة احتياطية كاملة لبيانات المتجر (المنتجات، الأقسام، الكوبونات، العملاء، الطلبات، الإعدادات) في ملف واحد واستعادتها بضغطة زر.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const backupData = {
                          version: '1.0',
                          exportedAt: new Date().toISOString(),
                          storeConfig,
                          products,
                          categories,
                          customers,
                          orders,
                          topupRequests
                        };
                        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `store_backup_${Date.now()}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                        showToast('✅ تم تصدير النسخة الاحتياطية بنجاح!');
                      } catch (err) {
                        showToast('حدث خطأ أثناء تصدير البيانات');
                      }
                    }}
                    className="px-3 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <i className="fa-solid fa-download text-xs"></i>
                    <span>تنزيل نسخة احتياطية (JSON)</span>
                  </button>

                  <label className="px-3 py-2 bg-white hover:bg-purple-50 border border-purple-300 text-purple-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs">
                    <i className="fa-solid fa-upload text-xs"></i>
                    <span>استعادة من ملف احتياطي</span>
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (re) => {
                          try {
                            const data = JSON.parse(re.target.result);
                            if (data && typeof data === 'object') {
                              if (data.storeConfig) setStoreConfig(data.storeConfig);
                              if (Array.isArray(data.products)) setProducts(data.products);
                              if (Array.isArray(data.categories)) setCategories(data.categories);
                              if (Array.isArray(data.customers)) setCustomers(data.customers);
                              if (Array.isArray(data.orders)) setOrders(data.orders);
                              if (Array.isArray(data.topupRequests)) setTopupRequests(data.topupRequests);
                              showToast('🎉 تمت استعادة جميع البيانات بنجاح!');
                            }
                          } catch (err) {
                            alert('الملف غير صالح أو تالف');
                          }
                        };
                        reader.readAsText(file);
                      }}
                    />
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSaveAllSettings}
                disabled={isSavingGlobalSettings}
                className="w-full py-3 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer hover:opacity-95 disabled:opacity-75 flex items-center justify-center gap-2"
                style={{ backgroundColor: storeConfig.primaryColor }}
              >
                <i className={`fa-solid ${isSavingGlobalSettings ? 'fa-spinner fa-spin' : 'fa-check'} text-xs`}></i>
                <span>{isSavingGlobalSettings ? 'جاري حفظ البيانات...' : 'حفظ صور الباركود والبيانات'}</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 10. قسم إدارة مميزات المنتج السريعة (تسليم فوري، ضمان...)   */}
        {/* ========================================================= */}
        {activeTab === 'features' && (
          <div className="max-w-4xl mx-auto space-y-6">


            {/* بطاقات تحرير المميزات الفردية */}
            <div className="space-y-4">
              {(storeConfig.productFeatures?.items || [
                { id: 'feat-1', enabled: true, title: 'تسليم فوري', subtitle: 'على مدار 24 ساعة', icon: 'fa-solid fa-bolt', customIconUrl: '' },
                { id: 'feat-2', enabled: true, title: 'ضمان أصلي', subtitle: 'مباشر 100%', icon: 'fa-solid fa-shield-halved', customIconUrl: '' },
                { id: 'feat-3', enabled: true, title: 'دعم متواصل', subtitle: 'واتساب ومباشر', icon: 'fa-solid fa-comments', customIconUrl: '' }
              ]).map((feat, index) => (
                <div key={feat.id || index} className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-black text-white font-bold text-xs flex items-center justify-center font-mono">
                        {index + 1}
                      </span>
                      <h4 className="font-bold text-sm text-gray-800">
                        ميزة رقم {index + 1}: {feat.title}
                      </h4>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <span className="text-xs text-gray-500 font-medium">تفعيل الظهور:</span>
                      <input
                        type="checkbox"
                        checked={feat.enabled !== false}
                        onChange={(e) => {
                          const updated = [...(storeConfig.productFeatures?.items || [])];
                          updated[index] = { ...updated[index], enabled: e.target.checked };
                          setStoreConfig(prev => ({
                            ...prev,
                            productFeatures: { ...(prev.productFeatures || {}), items: updated }
                          }));
                        }}
                        className="rounded accent-black w-4 h-4 cursor-pointer"
                      />
                      <span>تفعيل الميزة</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:gap-3.5 text-xs">
                    <div>
                      <label className="block font-bold text-gray-700 mb-1 text-[11px] sm:text-xs truncate">العنوان الرئيسي</label>
                      <input
                        type="text"
                        value={feat.title}
                        onChange={(e) => {
                          const updated = [...(storeConfig.productFeatures?.items || [])];
                          updated[index] = { ...updated[index], title: e.target.value };
                          setStoreConfig(prev => ({
                            ...prev,
                            productFeatures: { ...(prev.productFeatures || {}), items: updated }
                          }));
                        }}
                        placeholder="مثال: تسليم فوري"
                        className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black font-semibold text-gray-800 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-gray-700 mb-1 text-[11px] sm:text-xs truncate">النص الفرعي</label>
                      <input
                        type="text"
                        value={feat.subtitle}
                        onChange={(e) => {
                          const updated = [...(storeConfig.productFeatures?.items || [])];
                          updated[index] = { ...updated[index], subtitle: e.target.value };
                          setStoreConfig(prev => ({
                            ...prev,
                            productFeatures: { ...(prev.productFeatures || {}), items: updated }
                          }));
                        }}
                        placeholder="مثال: على مدار 24 ساعة"
                        className="w-full px-2.5 sm:px-3 py-1.5 sm:py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black text-gray-800 text-xs"
                      />
                    </div>
                  </div>

                  {/* اختيار أيقونة سريعة بالنقر المباشر بدون حقل كتابة */}
                  <div className="text-xs pt-1">
                    <label className="block font-bold text-gray-700 mb-1.5">اختر أيقونة الميزة</label>
                    <div className="flex items-center flex-wrap gap-1.5">
                      {[
                        { name: 'صاعقة (تسليم فوري)', cls: 'fa-solid fa-bolt' },
                        { name: 'درع (ضمان أصلي)', cls: 'fa-solid fa-shield-halved' },
                        { name: 'دعم ومحادثة', cls: 'fa-solid fa-comments' },
                        { name: 'شاحنة توصيل', cls: 'fa-solid fa-truck-fast' },
                        { name: 'نجمة تميز', cls: 'fa-solid fa-star' },
                        { name: 'ساعة 24/7', cls: 'fa-solid fa-clock' },
                        { name: 'ميدالية ذهبية', cls: 'fa-solid fa-medal' },
                        { name: 'أمان وحماية', cls: 'fa-solid fa-lock' },
                        { name: 'ألماسة فاخرة', cls: 'fa-solid fa-gem' },
                        { name: 'سحابة وسرعة', cls: 'fa-solid fa-cloud-bolt' },
                        { name: 'إرجاع واستبدال', cls: 'fa-solid fa-rotate-left' },
                        { name: 'بطاقة دفع', cls: 'fa-solid fa-credit-card' }
                      ].map((sIcon, sIdx) => {
                        const isSelected = feat.icon === sIcon.cls && !feat.customIconUrl;
                        return (
                          <button
                            key={sIdx}
                            type="button"
                            onClick={() => {
                              const updated = [...(storeConfig.productFeatures?.items || [])];
                              updated[index] = { ...updated[index], icon: sIcon.cls, customIconUrl: '' };
                              setStoreConfig(prev => ({
                                ...prev,
                                productFeatures: { ...(prev.productFeatures || {}), items: updated }
                              }));
                            }}
                            title={sIcon.name}
                            className={`w-8 h-8 rounded-xl flex items-center justify-center transition cursor-pointer text-sm shadow-2xs border ${
                              isSelected
                                ? 'bg-[#004956] text-white border-[#004956] ring-2 ring-[#004956]/20 scale-105'
                                : 'bg-white hover:bg-emerald-50 text-gray-700 hover:text-[#004956] border-gray-200 hover:border-emerald-300'
                            }`}
                          >
                            <i className={sIcon.cls}></i>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* خيار رفع صورة أيقونة مخصصة (SVG, PNG) */}
                  <div className="text-xs pt-1">
                    <label className="block font-bold text-gray-700 mb-1">أيقونة الميزة (رفع SVG / PNG)</label>
                    <div className="flex items-center gap-2">
                      <label className="flex-1 cursor-pointer border border-dashed border-gray-300 hover:border-black px-3 py-2 rounded-xl bg-gray-50 hover:bg-white text-center transition flex items-center justify-between">
                        <span className="text-[11px] text-gray-600 truncate">
                          {feat.customIconUrl ? '✓ تم رفع أيقونة مخصصة' : 'اختر صورة أيقونة من الجهاز (SVG أو PNG)'}
                        </span>
                        <span className="text-[10px] bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-600 shrink-0 mr-2">
                          تصفح
                        </span>
                        <input
                          type="file"
                          accept="image/*,.svg"
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (loadEvt) => {
                                const updated = [...(storeConfig.productFeatures?.items || [])];
                                updated[index] = { ...updated[index], customIconUrl: loadEvt.target.result };
                                setStoreConfig(prev => ({
                                  ...prev,
                                  productFeatures: { ...(prev.productFeatures || {}), items: updated }
                                }));
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                          className="hidden"
                        />
                      </label>

                      {feat.customIconUrl && (
                        <div className="relative w-7 h-7 rounded-xl border border-gray-200 p-1 flex items-center justify-center bg-gray-50 shrink-0">
                          <img src={feat.customIconUrl} alt="" className="w-full h-full object-contain" />
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...(storeConfig.productFeatures?.items || [])];
                              updated[index] = { ...updated[index], customIconUrl: '' };
                              setStoreConfig(prev => ({
                                ...prev,
                                productFeatures: { ...(prev.productFeatures || {}), items: updated }
                              }));
                            }}
                            className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full w-4 h-4 text-[9px] flex items-center justify-center cursor-pointer"
                            title="حذف الأيقونة المرفوعة"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              ))}
            </div>

            {/* معاينة مباشرة في صفحة الإدارة */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-3">
              <span className="font-bold text-xs text-gray-900 block">معاينة شكل بطاقات المميزات في صفحة المنتج:</span>
              <div className="p-2 sm:p-3 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-center">
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-center text-[10px] sm:text-[11px] text-gray-700 w-full max-w-lg">
                  {(storeConfig.productFeatures?.items || []).filter(f => f.enabled !== false).map((feat, fIdx) => (
                    <div key={fIdx} className="py-2 px-1 sm:px-2 bg-white/80 backdrop-blur-md rounded-[5px] border border-black/[0.04] shadow-xs flex flex-col justify-center items-center">
                      {feat.customIconUrl ? (
                        <img src={feat.customIconUrl} alt="" className="w-4 h-4 sm:w-5 sm:h-5 object-contain block mb-1" />
                      ) : (
                        <i className={`${feat.icon || 'fa-solid fa-bolt'} text-black text-xs block mb-1`}></i>
                      )}
                      <span className="font-bold block text-black text-[10px] sm:text-[11px] truncate w-full">{feat.title}</span>
                      <span className="text-[8px] sm:text-[9px] text-gray-400 truncate w-full">{feat.subtitle}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveAllSettings}
              disabled={isSavingGlobalSettings}
              className="w-full py-3 bg-[#004956] hover:bg-[#00343D] text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer disabled:opacity-75 flex items-center justify-center gap-2"
            >
              <i className={`fa-solid ${isSavingGlobalSettings ? 'fa-spinner fa-spin' : 'fa-check'} text-xs`}></i>
              <span>{isSavingGlobalSettings ? 'جاري حفظ المميزات...' : 'حفظ إعدادات المميزات'}</span>
            </button>
          </div>
        )}
      </main>

      {/* ========================================================= */}
      {/* نافذة مودال: إضافة / تعديل منتج (Modal Add / Edit Product) */}
      {/* ========================================================= */}
      {showProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 shadow-xl border border-gray-100" dir="rtl">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  {editingProduct ? '✏️ تعديل بيانات المنتج' : '➕ أضف منتج جديد للمتجر'}
                </h3>
                <span className="text-[11px] text-gray-400">اختر نوع المنتج لتخصيص خيارات التسليم والمخزون</span>
              </div>
              <button
                onClick={() => setShowProductModal(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveProductSubmit} className="space-y-4 mt-4 text-xs">
              
              {/* 1. خيارات اختيار نوع المنتج في البداية بنمط سلة */}
              <div className="p-3.5 bg-gray-50/70 border border-gray-200 rounded-2xl space-y-2">
                <label className="block font-bold text-gray-800 text-xs">
                  أختر نوع المنتج :
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { id: 'digital', label: '⚡ منتج رقمي' },
                    { id: 'license', label: '💳 بطاقات رقمية' },
                    { id: 'custom', label: '✍️ منتج حسب الطلب' },
                    { id: 'exchange', label: '🔄 منتج مبادلة' },
                    { id: 'physical', label: '📦 منتج ملموس' }
                  ].map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setProductForm({ ...productForm, productType: t.id })}
                      className={`p-2.5 sm:p-3 rounded-xl border text-center transition cursor-pointer flex items-center justify-center ${
                        productForm.productType === t.id
                          ? 'border-[#004956] bg-white ring-2 ring-[#004956]/30 text-[#004956] font-bold shadow-xs'
                          : 'border-gray-200 bg-white/70 text-gray-700 hover:bg-white'
                      }`}
                    >
                      <span className="block text-xs font-bold">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* صورة المنتج الرئيسية في البداية بنمط منصة سلة */}
              <div className="p-3.5 bg-gray-50/60 border border-gray-200/80 rounded-2xl">
                <label className="block font-bold text-gray-800 text-xs mb-2">📸 صور وميديا المنتج</label>
                <div className="flex flex-col sm:flex-row gap-3 items-center">
                  {/* صندوق المعاينة / رفع الصورة الرئيسي بنمط سلة */}
                  <div className="relative w-28 h-28 shrink-0 bg-white border-2 border-dashed border-gray-300 hover:border-[#004956] rounded-2xl flex flex-col items-center justify-center p-2 text-center transition group overflow-hidden shadow-2xs">
                    {productForm.imageUrl ? (
                      <>
                        <img src={productForm.imageUrl} alt="صورة المنتج" className="w-full h-full object-cover rounded-xl" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1 rounded-xl">
                          <button
                            type="button"
                            onClick={() => setProductForm(prev => ({ ...prev, imageUrl: '' }))}
                            className="bg-red-500 text-white rounded-lg p-1.5 text-xs hover:bg-red-600 cursor-pointer shadow-sm"
                            title="حذف الصورة"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        </div>
                      </>
                    ) : (
                      <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer">
                        <div className="w-8 h-8 rounded-full bg-emerald-50 text-[#004956] flex items-center justify-center mb-1 text-sm group-hover:scale-110 transition">
                          <i className="fa-solid fa-cloud-arrow-up"></i>
                        </div>
                        <span className="text-[10px] font-bold text-gray-700">رفع صورة</span>
                        <span className="text-[9px] text-gray-400">PNG, JPG</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onloadend = () => setProductForm(prev => ({ ...prev, imageUrl: reader.result }));
                              reader.readAsDataURL(file);
                            }
                          }}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>

                  {/* خيارات إدخال الرابط وشارة المنتج بجانب الصورة */}
                  <div className="flex-1 w-full space-y-2">
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">أو إضافة رابط صورة خارجي:</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="url"
                          value={productForm.imageUrl}
                          onChange={(e) => setProductForm({ ...productForm, imageUrl: e.target.value })}
                          placeholder="https://example.com/image.jpg"
                          className="w-full p-2 bg-white border border-gray-200 rounded-xl outline-none text-xs focus:border-[#004956]"
                        />
                        <label className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold rounded-xl cursor-pointer shrink-0 border border-gray-300 flex items-center gap-1 shadow-2xs">
                          <span>رفع</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onloadend = () => setProductForm(prev => ({ ...prev, imageUrl: reader.result }));
                                reader.readAsDataURL(file);
                              }
                            }}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] text-gray-600 mb-0.5">شارة ترويجية مميزة (Badge):</label>
                      <input
                        type="text"
                        value={productForm.badge}
                        onChange={(e) => setProductForm({ ...productForm, badge: e.target.value })}
                        placeholder="مثال: تسليم فوري / حصري / الأكثر طلباً"
                        className="w-full p-2 bg-white border border-gray-200 rounded-xl outline-none text-xs focus:border-[#004956]"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. اسم المنتج والقسم */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-gray-700 mb-1">اسم المنتج *</label>
                  <input
                    type="text"
                    required
                    value={productForm.title}
                    onChange={(e) => setProductForm({ ...productForm, title: e.target.value })}
                    placeholder="اكتب اسم المنتج بدقة..."
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[#004956]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-gray-700 mb-1">القسم</label>
                  <select
                    value={productForm.category}
                    onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                    className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none cursor-pointer"
                  >
                    {categories.filter(c => c.name !== 'الكل').map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 1. حقول خاصة بـ (بطاقات رقمية): أكواد تسلم للعميل عند اكتمال الطلب */}
              {productForm.productType === 'license' && (
                <div className="p-3 bg-amber-50/60 border border-amber-200/70 rounded-2xl space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-amber-950 flex items-center gap-1.5 text-xs">
                      <span>💳</span>
                      <span>أكواد البطاقات الرقمية (اضف كل كود في سطر جديد):</span>
                    </label>
                    <span className="text-[10px] text-amber-800 font-bold font-price">
                      عدد الأكواد: {productForm.licenseKeys ? productForm.licenseKeys.split('\n').filter(Boolean).length : 0}
                    </span>
                  </div>
                  <textarea
                    rows="3"
                    value={productForm.licenseKeys}
                    onChange={(e) => setProductForm({ ...productForm, licenseKeys: e.target.value })}
                    placeholder="ABCD-1234-EFGH-5678&#10;WXYZ-9876-LMNO-4321"
                    className="w-full p-2.5 bg-white border border-amber-300 rounded-xl font-mono text-xs outline-none"
                  ></textarea>
                  <p className="text-[10px] text-amber-800 leading-relaxed">
                    ⚡ <strong>طريقة التسليم:</strong> يتم حفظ الأكواد، وبمجرد تغيير حالة طلب العميل إلى <strong>"مكتمل"</strong> يتم تسليم الكود تلقائياً في تفاصيل طلبه وحسابه.
                  </p>
                </div>
              )}

              {/* 2. حقول خاصة بـ (منتج رقمي): بدون شحن وتسليم مباشر */}
              {productForm.productType === 'digital' && (
                <div className="p-3 bg-emerald-50/60 border border-emerald-200/70 rounded-2xl space-y-2">
                  <label className="block font-semibold text-emerald-950 text-xs">
                    ⚡ منتج رقمي (بدون شحن - تسليم مباشر للعميل):
                  </label>
                  <div>
                    <label className="block text-[11px] text-emerald-900 mb-1">تعليمات التسليم أو رابط مباشر للعميل (اختياري):</label>
                    <input
                      type="text"
                      value={productForm.deliveryInstructions || ''}
                      onChange={(e) => setProductForm({ ...productForm, deliveryInstructions: e.target.value })}
                      placeholder="مثال: سيتم إرسال رابط التفعيل أو الحساب فوراً عبر الواتساب أو البريد"
                      className="w-full p-2.5 bg-white border border-emerald-300 rounded-xl text-xs outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-emerald-800">
                    * هذا المنتج رقمي خالص لا يتطلب عنوان شحن أو تكلفة توصيل.
                  </p>
                </div>
              )}

              {/* 3. حقول خاصة بـ (منتج حسب الطلب): خانة نصية للعميل */}
              {productForm.productType === 'custom' && (
                <div className="p-3 bg-purple-50/60 border border-purple-200/70 rounded-2xl space-y-2">
                  <label className="block font-semibold text-purple-950 text-xs flex items-center gap-1.5">
                    <span>✍️</span>
                    <span>منتج حسب الطلب (يتطلب إدخال بيانات من العميل):</span>
                  </label>
                  <div>
                    <label className="block text-[11px] text-purple-900 mb-1">عنوان الخانة النصية التي ستظهر للعميل:</label>
                    <input
                      type="text"
                      value={productForm.customFieldLabel || ''}
                      onChange={(e) => setProductForm({ ...productForm, customFieldLabel: e.target.value })}
                      placeholder="مثال: اكتب الآيدي (ID) واسم الحساب، أو الاسم المطلوب طباعته"
                      className="w-full p-2.5 bg-white border border-purple-300 rounded-xl text-xs outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-purple-800 leading-relaxed">
                    💡 سيظهر حقل نصي مخصص في صفحة المنتج يتيح للعميل كتابة بياناته وملاحظاته، وستصلك البيانات مباشرة في تفاصيل الطلب.
                  </p>
                </div>
              )}

              {/* 4. حقول خاصة بـ (منتج ملموس): سلعة مادية تتطلب شحن */}
              {productForm.productType === 'physical' && (
                <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
                    <span>📦</span>
                    <span>بيانات الشحن والمستودع للمنتج الملموس:</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">الوزن التقريبي</label>
                      <input
                        type="text"
                        value={productForm.weight}
                        onChange={(e) => setProductForm({ ...productForm, weight: e.target.value })}
                        placeholder="مثال: 0.5 kg"
                        className="w-full p-2 bg-white border border-amber-300 rounded-xl text-xs outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">رمز التخزين (SKU)</label>
                      <input
                        type="text"
                        value={productForm.sku}
                        onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })}
                        placeholder="ITEM-001"
                        className="w-full p-2 bg-white border border-amber-300 rounded-xl text-xs font-mono outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">تكلفة الشحن ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={productForm.shippingFee}
                        onChange={(e) => setProductForm({ ...productForm, shippingFee: parseFloat(e.target.value) || 0 })}
                        placeholder="0.00"
                        className="w-full p-2 bg-white border border-amber-300 rounded-xl text-xs outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 5. حقول خاصة بـ (منتج مبادلة): إخفاء سعر البيع والتكلفة والسعر المخفض وضبط الحد الأدنى */}
              {productForm.productType === 'exchange' ? (
                <div className="p-3.5 bg-teal-50/70 border border-teal-200 rounded-2xl space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-teal-950">
                    <span>🔄</span>
                    <span>بيانات منتج المبادلة (مبادلة بدون نقود):</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* المنتج/العملة التي نسلمها للعميل */}
                    <div>
                      <label className="block text-[11px] font-bold text-teal-900 mb-1">المنتج اللي نسلمك (الاسم/العملة) *</label>
                      <input
                        type="text"
                        required={productForm.productType === 'exchange'}
                        value={productForm.exchangeCurrencyName || ''}
                        onChange={(e) => setProductForm({ ...productForm, exchangeCurrencyName: e.target.value })}
                        placeholder="مثال: صكوك، قمح، كروت"
                        className="w-full p-2.5 bg-white border border-teal-300 rounded-xl text-xs outline-none focus:border-teal-600"
                      />
                    </div>

                    {/* كمية التسليم المقابلة */}
                    <div>
                      <label className="block text-[11px] font-bold text-teal-900 mb-1">كمية المنتج اللي نسلمك *</label>
                      <input
                        type="number"
                        step="any"
                        required={productForm.productType === 'exchange'}
                        value={productForm.exchangeAmount || ''}
                        onChange={(e) => setProductForm({ ...productForm, exchangeAmount: e.target.value })}
                        placeholder="مثال: 5"
                        className="w-full p-2.5 bg-white border border-teal-300 rounded-xl text-xs outline-none focus:border-teal-600 font-mono font-bold"
                      />
                      <span className="text-[10px] text-teal-700 mt-1 block">تتضاعف تلقائياً للعميل حسب كمية المطلوب (لا يوجد حد أدنى مستقل لها).</span>
                    </div>

                    {/* الحد الأدنى للمنتج المطلوب */}
                    <div>
                      <label className="block text-[11px] font-bold text-teal-900 mb-1">الحد الأدنى لكمية (المنتج المطلوب)</label>
                      <input
                        type="number"
                        min="1"
                        value={productForm.minQuantity || 1}
                        onChange={(e) => setProductForm({ ...productForm, minQuantity: Math.max(1, parseInt(e.target.value) || 1) })}
                        placeholder="1"
                        className="w-full p-2.5 bg-white border border-teal-300 rounded-xl text-xs outline-none focus:border-teal-600 font-mono font-bold"
                      />
                      <span className="text-[10px] text-teal-700 mt-1 block">يحدده الأدمن للمنتج المطلوب فقط.</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-teal-200/60">
                    <div>
                      <label className="block text-[11px] font-medium text-teal-900 mb-1">الكمية المتوفرة بالمخزون</label>
                      <input
                        type="number"
                        value={productForm.stock}
                        onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                        className="w-full p-2 bg-white border border-teal-300 rounded-xl text-xs outline-none"
                      />
                    </div>
                    <div className="flex items-center">
                      <p className="text-[11px] text-teal-800 bg-teal-100/60 p-2 rounded-xl">
                        💡 <strong>ملاحظة:</strong> تم إلغاء أسعار البيع والتكلفة والخصم لهذا المنتج لأنه مخصص للمبادلات فقط ولا يتطلب مبالغ نقدية.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                /* السعر الأساسي وسعر التكلفة والتخفيض والكمية للمنتجات العادية */
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block font-medium text-gray-700 mb-1">سعر البيع ($) *</label>
                    <input
                      type="number"
                      step="0.01"
                      required={productForm.productType !== 'exchange'}
                      value={productForm.price}
                      onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                      placeholder="9.99"
                      className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[#004956]"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-gray-700 mb-1 flex items-center justify-between">
                      <span>سعر التكلفة ($)</span>
                      <span className="text-[10px] text-gray-400">خاص بالإدارة</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={productForm.costPrice}
                      onChange={(e) => setProductForm({ ...productForm, costPrice: e.target.value })}
                      placeholder="مثال: 5.50"
                      className="w-full p-2.5 bg-amber-50/40 border border-amber-200 rounded-xl outline-none focus:border-amber-400"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-gray-700 mb-1">السعر قبل الخصم ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={productForm.oldPrice}
                      onChange={(e) => setProductForm({ ...productForm, oldPrice: e.target.value })}
                      placeholder="15.00"
                      className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[#004956]"
                    />
                  </div>

                  {productForm.productType !== 'license' ? (
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">الكمية بالمخزون</label>
                      <input
                        type="number"
                        value={productForm.stock}
                        onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })}
                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-[#004956]"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block font-medium text-gray-700 mb-1">حالة المخزون</label>
                      <div className="p-2.5 bg-gray-100 rounded-xl text-xs text-gray-600 flex items-center gap-1.5 font-mono">
                        <i className="fa-solid fa-key text-[10px]"></i>
                        <span>حسب عدد الأكواد</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* قسم تسعير الكميات المتعددة (فقط للمنتجات غير المبادلة) */}
              {productForm.productType !== 'exchange' && (
                <div className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={productForm.hasQuantityTiers}
                        onChange={(e) => setProductForm({ ...productForm, hasQuantityTiers: e.target.checked })}
                        className="rounded text-[#004956] w-4 h-4"
                      />
                      <span className="font-bold text-xs text-emerald-950">
                        ⚡ إضافة كميات محددة
                      </span>
                    </label>
                  </div>

                {productForm.hasQuantityTiers && (
                  <div className="space-y-2 pt-2 border-t border-emerald-100">
                    {productForm.quantityTiers.map((tier, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2 items-center bg-white p-2 rounded-xl border border-gray-200">
                        {/* 1. أسم الخيار (مساحة أوسع) */}
                        <div className="col-span-7">
                          <label className="block text-[10px] text-gray-500 font-medium mb-0.5">أسم الخيار:</label>
                          <input
                            type="text"
                            value={tier.label}
                            onChange={(e) => {
                              const updated = [...productForm.quantityTiers];
                              updated[index].label = e.target.value;
                              setProductForm({ ...productForm, quantityTiers: updated });
                            }}
                            placeholder="مثال: باقة 3 حبات"
                            className="w-full px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs outline-none focus:border-[#004956]"
                          />
                        </div>

                        {/* 2. الكمية (مصغرة) */}
                        <div className="col-span-2">
                          <label className="block text-[10px] text-gray-500 font-medium mb-0.5 text-center">الكمية:</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={tier.minQuantity}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, '');
                              const updated = [...productForm.quantityTiers];
                              updated[index].minQuantity = val === '' ? '' : parseInt(val, 10);
                              setProductForm({ ...productForm, quantityTiers: updated });
                            }}
                            placeholder="1"
                            className="w-full px-1.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-center font-mono outline-none focus:border-[#004956]"
                          />
                        </div>

                        {/* 3. السعر (مصغر) */}
                        <div className="col-span-2">
                          <label className="block text-[10px] text-gray-500 font-medium mb-0.5 text-center">السعر:</label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={tier.price}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9.]/g, '');
                              const updated = [...productForm.quantityTiers];
                              updated[index].price = val;
                              setProductForm({ ...productForm, quantityTiers: updated });
                            }}
                            placeholder="0.00"
                            className="w-full px-1.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-center font-bold text-emerald-800 font-mono outline-none focus:border-[#004956]"
                          />
                        </div>

                        {/* زر الحذف */}
                        <div className="col-span-1 text-center pt-3">
                          {productForm.quantityTiers.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const updated = productForm.quantityTiers.filter((_, i) => i !== index);
                                setProductForm({ ...productForm, quantityTiers: updated });
                              }}
                              className="text-red-500 hover:text-red-700 text-sm cursor-pointer p-1"
                              title="حذف هذا الخيار"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => {
                        setProductForm({
                          ...productForm,
                          quantityTiers: [
                            ...productForm.quantityTiers,
                            { minQuantity: productForm.quantityTiers.length * 5 || 5, label: '', price: '' }
                          ]
                        });
                      }}
                      className="text-[11px] text-[#004956] font-bold hover:underline cursor-pointer pt-1 block"
                    >
                      + إضافة خيار جديد
                    </button>
                  </div>
                )}
              </div>
            )}



              {/* ======================================================= */}
              {/* قسم الحقول المخصصة (يضيفها المدير بنفسه لكل أنواع المنتجات) */}
              {/* ======================================================= */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
                    <i className="fa-solid fa-sliders text-gray-500 text-[10px]"></i>
                    <span>حقول مخصصة (اختيارية)</span>
                    <span className="text-[10px] font-normal text-gray-400">— ستظهر للعميل في صفحة المنتج</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const newField = { id: Date.now(), label: '', required: false };
                      setProductForm({ ...productForm, customFields: [...(productForm.customFields || []), newField] });
                    }}
                    className="text-[11px] text-[#004956] font-bold hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <i className="fa-solid fa-plus text-[10px]"></i>
                    إضافة حقل
                  </button>
                </div>

                {(productForm.customFields || []).length > 0 && (
                  <div className="space-y-2">
                    {(productForm.customFields || []).map((field, idx) => (
                      <div key={field.id} className="flex items-center gap-2">
                        {/* checkbox الإجباري/الاختياري */}
                        <label className="flex items-center gap-1 shrink-0 cursor-pointer" title={field.required ? 'إجباري (اضغط لجعله اختياري)' : 'اختياري (اضغط لجعله إجباري)'}>
                          <input
                            type="checkbox"
                            checked={field.required || false}
                            onChange={(e) => {
                              const updated = [...(productForm.customFields || [])];
                              updated[idx] = { ...updated[idx], required: e.target.checked };
                              setProductForm({ ...productForm, customFields: updated });
                            }}
                            className="w-3.5 h-3.5 rounded accent-gray-800 cursor-pointer"
                          />
                          <span className="text-[10px] text-gray-500 select-none">{field.required ? 'إجباري' : 'اختياري'}</span>
                        </label>
                        {/* اسم الحقل */}
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => {
                            const updated = [...(productForm.customFields || [])];
                            updated[idx] = { ...updated[idx], label: e.target.value };
                            setProductForm({ ...productForm, customFields: updated });
                          }}
                          placeholder="اسم الحقل، مثال: آيدي الحساب / اسم الشخصية"
                          className="flex-1 bg-transparent border-b border-gray-300 focus:border-gray-800 outline-none text-xs py-1 text-gray-900 placeholder:text-gray-400 transition"
                        />
                        {/* حذف الحقل */}
                        <button
                          type="button"
                          onClick={() => {
                            const updated = (productForm.customFields || []).filter((_, i) => i !== idx);
                            setProductForm({ ...productForm, customFields: updated });
                          }}
                          className="text-gray-400 hover:text-red-500 transition cursor-pointer shrink-0 p-0.5"
                          title="حذف الحقل"
                        >
                          <i className="fa-solid fa-xmark text-xs"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {(productForm.customFields || []).length === 0 && (
                  <p className="text-[10px] text-gray-400 pr-0.5">لا توجد حقول مخصصة بعد — اضغط &quot;إضافة حقل&quot; لإنشاء خانة يملأها العميل</p>
                )}
              </div>

              {/* محرر الوصف الاحترافي التفاعلي المباشر (WYSIWYG Rich Text Editor) مع وضع التبديل الآمن */}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-gray-800 text-xs flex items-center gap-2">
                    <span>وصف المنتج ومميزاته:</span>
                    <span className="text-[10px] font-normal text-gray-400">
                      {descEditorMode === 'visual' ? '(محرر مرئي مباشر)' : '(محرر نصوص / HTML مباشر)'}
                    </span>
                  </label>
                  <div className="flex items-center gap-1 bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                    <button
                      type="button"
                      onClick={() => {
                        setDescEditorMode('visual');
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                        descEditorMode === 'visual' ? 'bg-white text-black shadow-2xs' : 'text-gray-500 hover:text-black'
                      }`}
                    >
                      ✏️ محرر مباشر
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (richTextEditorRef.current) {
                          setProductForm(prev => ({ ...prev, descriptionHtml: richTextEditorRef.current.innerHTML }));
                        }
                        setDescEditorMode('code');
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                        descEditorMode === 'code' ? 'bg-white text-black shadow-2xs' : 'text-gray-500 hover:text-black'
                      }`}
                    >
                      📝 نص عادي / HTML
                    </button>
                  </div>
                </div>

                {descEditorMode === 'visual' ? (
                  <div>
                    {/* شريط أدوات التنسيق الشامل الاحترافي بنمط المنتديات والمحررات المتقدمة */}
                    <div className="flex flex-wrap items-center gap-1.5 p-2 bg-gray-100 border border-gray-200 rounded-t-xl text-xs select-none">
                      {/* 1. اختيار نوع الخط (Font Family) */}
                      <div className="flex items-center gap-1 bg-white border border-gray-300 rounded px-1.5 h-7 shadow-2xs">
                        <span className="text-[10px] text-gray-500 font-bold">🔤 الخط:</span>
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              execFormat('fontName', e.target.value);
                              e.target.value = '';
                            }
                          }}
                          defaultValue=""
                          className="bg-transparent text-[11px] font-bold text-gray-800 cursor-pointer outline-none"
                          title="اختر نوع الخط للنص المحدد"
                        >
                          <option value="" disabled>نوع الخط</option>
                          <option value="Tajawal">تجوال (Tajawal)</option>
                          <option value="DIN Next LT Arabic">دين نكست (DIN Next Arabic)</option>
                          <option value="Cairo">كايرو (Cairo)</option>
                          <option value="Almarai">المراعي (Almarai)</option>
                          <option value="Alexandria">الإسكندرية (Alexandria)</option>
                          <option value="system-ui">خط النظام البسيط (System UI)</option>
                        </select>
                      </div>

                      {/* 2. اختيار حجم الخط (Font Size) */}
                      <div className="flex items-center gap-1 bg-white border border-gray-300 rounded px-1.5 h-7 shadow-2xs">
                        <span className="text-[10px] text-gray-500 font-bold">📏 الحجم:</span>
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              execFormat('fontSize', e.target.value);
                              e.target.value = '';
                            }
                          }}
                          defaultValue=""
                          className="bg-transparent text-[11px] font-bold text-gray-800 cursor-pointer outline-none"
                          title="اختر حجم الخط للنص المحدد"
                        >
                          <option value="" disabled>حجم الخط</option>
                          <option value="1">10px (صغير جداً)</option>
                          <option value="2">12px (صغير)</option>
                          <option value="3">14px (افتراضي عادي)</option>
                          <option value="4">16px (متوسط)</option>
                          <option value="5">18px (كبير)</option>
                          <option value="6">24px (كبير جداً)</option>
                          <option value="7">32px (عنوان ضخم)</option>
                        </select>
                      </div>

                      {/* 2. اختيار نمط الفقرة والعناوين (H1, H2, H3, H4, Quote) */}
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            execFormat('formatBlock', e.target.value);
                            e.target.value = '';
                          }
                        }}
                        defaultValue=""
                        className="h-7 px-1.5 bg-white border border-gray-300 rounded text-[11px] font-bold text-gray-800 cursor-pointer outline-none hover:border-gray-400"
                        title="نوع الفقرة / العنوان"
                      >
                        <option value="" disabled>الترويسة</option>
                        <option value="<h1>">عنوان رئيسي H1</option>
                        <option value="<h2>">عنوان فرعي H2</option>
                        <option value="<h3>">عنوان H3</option>
                        <option value="<h4>">عنوان H4</option>
                        <option value="<p>">نص عادي فقرة</option>
                        <option value="<blockquote>">اقتباس Blockquote</option>
                        <option value="<pre>">كود برمجى Code</option>
                      </select>

                      <div className="h-5 w-px bg-gray-300 mx-0.5"></div>

                      {/* خط عريض Bold */}
                      <button
                        type="button"
                        title="عريض (Bold) - Ctrl+B"
                        onClick={() => execFormat('bold')}
                        className="w-7 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded font-black text-black flex items-center justify-center cursor-pointer shadow-2xs"
                      >
                        B
                      </button>

                      {/* مائل Italic */}
                      <button
                        type="button"
                        title="مائل (Italic) - Ctrl+I"
                        onClick={() => execFormat('italic')}
                        className="w-7 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded italic font-serif text-black flex items-center justify-center cursor-pointer shadow-2xs"
                      >
                        I
                      </button>

                      {/* تسطير Underline */}
                      <button
                        type="button"
                        title="تسطير (Underline) - Ctrl+U"
                        onClick={() => execFormat('underline')}
                        className="w-7 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded underline text-black flex items-center justify-center cursor-pointer shadow-2xs font-semibold"
                      >
                        U
                      </button>

                      {/* يتوسطه خط Strike */}
                      <button
                        type="button"
                        title="يتوسطه خط (Strike)"
                        onClick={() => execFormat('strikeThrough')}
                        className="w-7 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded line-through text-black flex items-center justify-center cursor-pointer shadow-2xs text-[11px]"
                      >
                        S
                      </button>

                      <div className="h-5 w-px bg-gray-300 mx-0.5"></div>

                      {/* 3. ألوان النص مع Color Picker حر وقائمة ألوان منتدى */}
                      <div className="flex items-center gap-0.5 bg-white p-0.5 border border-gray-300 rounded shadow-2xs" title="لون النص">
                        <span className="text-[10px] font-bold px-1 text-gray-600">🎨 لون:</span>
                        <input
                          type="color"
                          defaultValue="#000000"
                          onChange={(e) => execFormat('foreColor', e.target.value)}
                          className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                          title="اختر أي لون مخصص للنص"
                        />
                        {['#BA3D50', '#059669', '#2563EB', '#D97706', '#7C3AED', '#000000'].map((col, cIdx) => (
                          <button
                            key={cIdx}
                            type="button"
                            onClick={() => execFormat('foreColor', col)}
                            className="w-4 h-4 rounded-full border border-gray-300 hover:scale-110 transition shrink-0"
                            style={{ backgroundColor: col }}
                            title={`تطبيق اللون ${col}`}
                          />
                        ))}
                      </div>

                      {/* 4. تمييز الخلفية / التظليل (Highlight / Background Color) */}
                      <div className="flex items-center gap-0.5 bg-white p-0.5 border border-gray-300 rounded shadow-2xs" title="لون تمييز الخلفية">
                        <span className="text-[10px] font-bold px-1 text-gray-600">🖍️ تظليل:</span>
                        <button
                          type="button"
                          onClick={() => {
                            execFormat('hiliteColor', 'transparent');
                            execFormat('backColor', 'transparent');
                          }}
                          className="px-1 py-0.5 text-[9px] bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-gray-600 font-bold shrink-0 transition"
                          title="بدون خلفية (شفاف)"
                        >
                          بدون خلفية
                        </button>
                        <input
                          type="color"
                          defaultValue="#FEF08A"
                          onChange={(e) => execFormat('hiliteColor', e.target.value)}
                          className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent"
                          title="اختر لون تظليل مخصص"
                        />
                        {['#FEF08A', '#BBF7D0', '#BAE6FD', '#FED7AA', '#FBCFE8'].map((bgCol, bIdx) => (
                          <button
                            key={bIdx}
                            type="button"
                            onClick={() => execFormat('hiliteColor', bgCol)}
                            className="w-4 h-4 rounded border border-gray-300 hover:scale-110 transition shrink-0"
                            style={{ backgroundColor: bgCol }}
                            title={`تظليل بلون ${bgCol}`}
                          />
                        ))}
                      </div>

                      <div className="h-5 w-px bg-gray-300 mx-0.5"></div>

                      {/* محاذاة لليمين */}
                      <button
                        type="button"
                        title="محاذاة لليمين"
                        onClick={() => execFormat('justifyRight')}
                        className="w-7 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded flex items-center justify-center cursor-pointer shadow-2xs text-[11px]"
                      >
                        <i className="fa-solid fa-align-right text-gray-800"></i>
                      </button>

                      {/* محاذاة للوسط */}
                      <button
                        type="button"
                        title="توسيط"
                        onClick={() => execFormat('justifyCenter')}
                        className="w-7 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded flex items-center justify-center cursor-pointer shadow-2xs text-[11px]"
                      >
                        <i className="fa-solid fa-align-center text-gray-800"></i>
                      </button>

                      {/* محاذاة لليسار */}
                      <button
                        type="button"
                        title="محاذاة لليسار"
                        onClick={() => execFormat('justifyLeft')}
                        className="w-7 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded flex items-center justify-center cursor-pointer shadow-2xs text-[11px]"
                      >
                        <i className="fa-solid fa-align-left text-gray-800"></i>
                      </button>

                      {/* ضبط المحاذاة الكاملة (Justify Full) */}
                      <button
                        type="button"
                        title="ضبط ومساواة السطور (Justify)"
                        onClick={() => execFormat('justifyFull')}
                        className="w-7 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded flex items-center justify-center cursor-pointer shadow-2xs text-[11px]"
                      >
                        <i className="fa-solid fa-align-justify text-gray-800"></i>
                      </button>

                      <div className="h-5 w-px bg-gray-300 mx-0.5"></div>

                      {/* قائمة نقطية */}
                      <button
                        type="button"
                        title="قائمة نقطية"
                        onClick={() => execFormat('insertUnorderedList')}
                        className="px-2 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded flex items-center gap-1 cursor-pointer shadow-2xs text-[11px] font-medium"
                      >
                        <i className="fa-solid fa-list-ul text-gray-800 text-[10px]"></i>
                        <span>قائمة</span>
                      </button>

                      {/* قائمة رقمية */}
                      <button
                        type="button"
                        title="قائمة رقمية"
                        onClick={() => execFormat('insertOrderedList')}
                        className="px-2 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded flex items-center gap-1 cursor-pointer shadow-2xs text-[11px] font-medium"
                      >
                        <i className="fa-solid fa-list-ol text-gray-800 text-[10px]"></i>
                        <span>ترقيم</span>
                      </button>

                      {/* خط فاصل أفقي Horizontal Rule */}
                      <button
                        type="button"
                        title="إدراج خط فاصل أفقي"
                        onClick={() => execFormat('insertHorizontalRule')}
                        className="px-2 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded flex items-center gap-1 cursor-pointer shadow-2xs text-[11px] font-medium"
                      >
                        <span>— فاصل</span>
                      </button>

                      {/* إدراج رابط */}
                      <button
                        type="button"
                        title="إدراج رابط URL"
                        onClick={() => {
                          const url = prompt('أدخل رابط الموقع الإلكتروني (URL):', 'https://');
                          if (url) execFormat('createLink', url);
                        }}
                        className="px-2 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded flex items-center gap-1 cursor-pointer shadow-2xs text-[11px] font-medium text-blue-700"
                      >
                        <i className="fa-solid fa-link text-[10px]"></i>
                        <span>رابط</span>
                      </button>

                      {/* إدراج جدول بسيط مثل المنتديات */}
                      <button
                        type="button"
                        title="إدراج جدول مقارنة / مواصفات"
                        onClick={() => {
                          const tableHtml = `
                            <table style="width:100%; border-collapse:collapse; margin:10px 0; border:1px solid #e5e7eb;">
                              <thead>
                                <tr style="background-color:#f9fafb;">
                                  <th style="border:1px solid #e5e7eb; padding:8px; text-align:right; font-weight:bold;">المواصفة / الميزة</th>
                                  <th style="border:1px solid #e5e7eb; padding:8px; text-align:right; font-weight:bold;">التفاصيل</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td style="border:1px solid #e5e7eb; padding:8px;">طريقة التسليم</td>
                                  <td style="border:1px solid #e5e7eb; padding:8px;">فوري وتلقائي ⚡</td>
                                </tr>
                                <tr>
                                  <td style="border:1px solid #e5e7eb; padding:8px;">الضمان</td>
                                  <td style="border:1px solid #e5e7eb; padding:8px;">ضمان ذهبي كامل 🛡️</td>
                                </tr>
                              </tbody>
                            </table><p><br></p>
                          `;
                          execFormat('insertHTML', tableHtml);
                        }}
                        className="px-2 h-7 bg-white hover:bg-gray-200 border border-gray-300 rounded flex items-center gap-1 cursor-pointer shadow-2xs text-[11px] font-medium text-emerald-700"
                      >
                        <i className="fa-solid fa-table text-[10px]"></i>
                        <span>جدول</span>
                      </button>

                      {/* مسح التنسيق */}
                      <button
                        type="button"
                        title="إزالة كافة التنسيقات عن النص المحدد"
                        onClick={() => execFormat('removeFormat')}
                        className="px-2 h-7 bg-white hover:bg-red-50 border border-gray-300 hover:border-red-200 rounded text-gray-500 hover:text-red-600 cursor-pointer shadow-2xs text-[10px] mr-auto transition"
                      >
                        🧹 مسح التنسيق
                      </button>
                    </div>

                    {/* صندوق الكتابة والتعديل الحي المباشر (contentEditable) */}
                    <div
                      ref={richTextEditorRef}
                      contentEditable
                      suppressContentEditableWarning
                      onInput={(e) => {
                        const html = e.currentTarget.innerHTML;
                        setProductForm(prev => ({
                          ...prev,
                          descriptionHtml: html
                        }));
                      }}
                      className="w-full min-h-[160px] max-h-[300px] overflow-y-auto p-3.5 bg-white border border-t-0 border-gray-200 rounded-b-xl outline-none focus:ring-1 focus:ring-black text-xs leading-relaxed text-black font-['Tajawal'] product__description-content"
                      style={{ direction: 'rtl', textAlign: 'right' }}
                    />
                  </div>
                ) : (
                  <div>
                    <textarea
                      rows="7"
                      value={productForm.descriptionHtml || ''}
                      onChange={(e) => setProductForm(prev => ({ ...prev, descriptionHtml: e.target.value }))}
                      placeholder="اكتب وصف المنتج هنا أو الصق كود HTML..."
                      className="w-full p-3.5 bg-white border border-gray-200 rounded-xl outline-none focus:ring-1 focus:ring-black text-xs leading-relaxed font-mono text-gray-800"
                      style={{ direction: 'rtl', textAlign: 'right' }}
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowProductModal(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-[#004956] text-white rounded-xl font-semibold shadow-xs hover:opacity-90 cursor-pointer"
                >
                  {editingProduct ? 'تحديث المنتج' : 'نشر المنتج الآن'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* نافذة مودال: تفاصيل الطلب وإيصال التحويل (Order Details)   */}
      {/* ========================================================= */}
      {selectedOrderDetails && (
        <div
          onClick={() => setSelectedOrderDetails(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#F9FAFB] rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl border-0 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            dir="rtl"
          >
            {/* رأس النافذة (ثابت دائماً في الأعلى) */}
            <div className="p-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-base">🛍️</span>
                <div>
                  <h3 className="text-sm font-bold text-gray-800">تفاصيل الطلب #{selectedOrderDetails.id}</h3>
                  <span className="text-[10px] text-gray-400">{selectedOrderDetails.date || '2026-09-12'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderDetails(null)}
                className="w-8 h-8 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 flex items-center justify-center text-sm font-bold transition cursor-pointer shadow-2xs"
                title="إغلاق النافذة (Esc)"
              >
                ✕
              </button>
            </div>

            {/* محتوى النافذة القابل للتمرير عمودياً مهما كان حجم الشاشة أو حجم صورة الإيصال */}
            <div className="p-3 space-y-3 text-xs overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <span className="text-[10px] text-gray-400 block">العميل:</span>
                  <span className="font-bold text-gray-800">{(selectedOrderDetails.customer || '').replace(/\s*\([^)]*\)/g, '').trim() || selectedOrderDetails.customer}</span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block">طريقة الدفع:</span>
                  <span className="font-bold text-gray-800">{selectedOrderDetails.method}</span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block">المبلغ:</span>
                  <span className="font-bold text-emerald-800">{selectedOrderDetails.totalFormatted || `$${selectedOrderDetails.totalUsd}`}</span>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block">معرف المعاملة (TxID):</span>
                  <span className="font-mono text-gray-800">{selectedOrderDetails.txId || 'غير متوفر'}</span>
                </div>
              </div>

              {/* تنبيه أو حالة رصيد المحفظة */}
              {selectedOrderDetails.walletWarning && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-800 text-xs font-medium">
                  <i className="fa-solid fa-triangle-exclamation text-red-600 mt-0.5 shrink-0 text-sm"></i>
                  <div>
                    <span className="font-bold block">ملاحظة رصيد المحفظة:</span>
                    <span>{selectedOrderDetails.walletWarning}</span>
                  </div>
                </div>
              )}

              {selectedOrderDetails.walletDeducted && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-emerald-800 text-xs font-semibold">
                  <i className="fa-solid fa-circle-check text-emerald-600 text-sm"></i>
                  <span>تم خصم مبلغ الطلب ({selectedOrderDetails.walletDeductedAmount || selectedOrderDetails.totalUsd} $) من محفظة العميل بنجاح.</span>
                </div>
              )}

              {/* قائمة بنود المنتجات في الطلب */}
              {Array.isArray(selectedOrderDetails.items) && selectedOrderDetails.items.length > 0 && (
                <div>
                  <label className="block font-bold text-gray-700 mb-1.5 flex items-center gap-1.5">
                    <span>📦</span>
                    <span>المنتجات المطلوبة ({selectedOrderDetails.items.length}):</span>
                  </label>
                  <div className="space-y-2 border border-gray-100 rounded-xl p-2.5 bg-gray-50/70">
                    {selectedOrderDetails.items.map((it, idx) => (
                      <div key={idx} className="p-2 bg-white rounded-lg border border-gray-200/80 flex items-start gap-2.5">
                        {it.imageUrl && (
                          <img src={it.imageUrl} alt="" className="w-7 h-7 rounded-md object-cover border border-gray-100 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <h4 className="font-bold text-gray-900 truncate">{it.title}</h4>
                            <span className="font-bold font-price text-gray-800 text-[11px] shrink-0">
                              ×{it.quantity} (${(it.priceUsd * it.quantity).toFixed(2)})
                            </span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-gray-100 text-gray-600 font-medium">
                              {it.productType === 'physical' ? '📦 ملموس' : it.productType === 'license' ? '💳 بطاقة رقمية' : it.productType === 'custom' ? '✍️ حسب الطلب' : '⚡ رقمي'}
                            </span>
                            {it.tierLabel && (
                              <span className="text-[9px] text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded font-medium">
                                {it.tierLabel}
                              </span>
                            )}
                          </div>
                          {it.userNote && (
                            <div className="mt-1.5 p-1.5 bg-purple-50 border border-purple-200 rounded text-[10px] text-purple-950 leading-relaxed">
                              <span className="font-bold">✍️ بيانات العميل: </span>
                              <span className="font-medium select-all">{it.userNote}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* قسم الأكواد المسلمة للعميل إن وجدت */}
              {Array.isArray(selectedOrderDetails.fulfilledKeys) && selectedOrderDetails.fulfilledKeys.length > 0 && (
                <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between text-emerald-950 font-bold text-xs">
                    <span className="flex items-center gap-1">
                      <span>✅</span>
                      <span>الأكواد المسلمة للعميل (تم التسليم بعد الإكمال):</span>
                    </span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                      {selectedOrderDetails.fulfilledKeys.length} كود
                    </span>
                  </div>
                  <div className="space-y-1 pt-1">
                    {selectedOrderDetails.fulfilledKeys.map((kObj, kIdx) => (
                      <div key={kIdx} className="p-2 bg-white rounded-lg border border-emerald-300 font-mono text-[11px] font-bold text-gray-900 select-all flex items-center justify-between">
                        <span>{kObj.key || kObj}</span>
                        <span className="text-[9px] text-gray-400 font-sans">{kObj.productTitle || 'كود بطاقة'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* إيصال التحويل المرفق */}
              <div>
                <label className="block font-bold text-gray-700 mb-1.5">صورة إيصال التحويل المرفق من المشتري:</label>
                {selectedOrderDetails.proof ? (
                  <div className="rounded-xl overflow-hidden border border-gray-200 bg-black/5 p-1">
                    <img
                      src={selectedOrderDetails.proof}
                      alt="إشعار التحويل"
                      className="w-full max-h-56 object-contain rounded-lg bg-white"
                    />
                    <a
                      href={selectedOrderDetails.proof}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-center text-[11px] text-blue-600 font-medium py-1.5 hover:underline"
                    >
                      فتح الصورة بالحجم الكامل 🔍
                    </a>
                  </div>
                ) : (
                  <div className="p-3 bg-gray-50 rounded-xl text-center text-gray-400 border border-dashed border-gray-200">
                    لم يرفق العميل صورة إيصال لهذا الطلب.
                  </div>
                )}
              </div>

              {/* تغيير حالة الطلب */}
              <div>
                <label className="block font-bold text-gray-700 mb-1">تحديث حالة الطلب:</label>
                <div className="grid grid-cols-3 gap-2">
                  {['قيد المراجعة', 'قيد التنفيذ', 'مكتمل'].map(st => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => handleUpdateOrderStatus(selectedOrderDetails.id, st)}
                      className={`py-2 rounded-xl border text-center transition font-semibold cursor-pointer ${
                        selectedOrderDetails.status === st
                          ? 'bg-[#004956] text-white border-[#004956]'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* أسفل النافذة (ثابت دائماً في الأسفل مع زر إغلاق واضح وكبير) */}
            <div className="p-3.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-gray-400">يمكنك النقر خارج النافذة للإغلاق أيضاً</span>
              <button
                type="button"
                onClick={() => setSelectedOrderDetails(null)}
                className="px-6 py-2 bg-gray-900 hover:bg-black text-white rounded-xl text-xs font-bold cursor-pointer shadow-xs transition"
              >
                إغلاق النافذة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

