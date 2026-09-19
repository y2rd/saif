import { useState, useEffect } from 'react';

export default function ProductDetailPage({
  product,
  onBack,
  storeConfig,
  formatPrice,
  activeCurrency,
  onAddToCart,
  relatedProducts,
  onSelectProduct,
  onSelectCategory
}) {
  // الشريحة المحددة للكمية والتسعير
  const defaultTier = product.hasQuantityTiers && product.quantityTiers && product.quantityTiers.length > 0
    ? product.quantityTiers[0]
    : null;

  const minQty = Math.max(1, parseInt(product.minQuantity) || 1);
  const [selectedTier, setSelectedTier] = useState(defaultTier);
  const [quantity, setQuantity] = useState(minQty); // الكمية تبدأ بالحد الأدنى المحدد للمنتج
  const [isCopied, setIsCopied] = useState(false);
  const [customUserNote, setCustomUserNote] = useState('');
  const [customFieldValues, setCustomFieldValues] = useState({});
  const [selectedReviewImage, setSelectedReviewImage] = useState(null);

  // العد التنازلي للعرض المؤقت (Flash Sale)
  const isFlashSaleActive = Boolean(
    product.flashSaleEnabled &&
    product.flashSaleEndsAt &&
    new Date(product.flashSaleEndsAt).getTime() > Date.now()
  );

  const [timeLeft, setTimeLeft] = useState(() => {
    if (!isFlashSaleActive) return 0;
    return Math.max(0, new Date(product.flashSaleEndsAt).getTime() - Date.now());
  });

  useEffect(() => {
    if (!isFlashSaleActive) return;
    const timer = setInterval(() => {
      const diff = Math.max(0, new Date(product.flashSaleEndsAt).getTime() - Date.now());
      setTimeLeft(diff);
      if (diff <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [product.flashSaleEndsAt, isFlashSaleActive]);

  const formatCountdown = (ms) => {
    if (!ms || ms <= 0) return null;
    const totalSecs = Math.floor(ms / 1000);
    const days = Math.floor(totalSecs / (3600 * 24));
    const hours = Math.floor((totalSecs % (3600 * 24)) / 3600);
    const minutes = Math.floor((totalSecs % (3600 * 24)) / 60);
    const seconds = totalSecs % 60;
    return { days, hours, minutes, seconds };
  };

  const countdown = isFlashSaleActive && timeLeft > 0 ? formatCountdown(timeLeft) : null;

  // حالات المبادلة القابلة للتعديل بحرية (المنتج المطلوب وكميته، والمنتج اللي نسلمك وكميته)
  const isExchange = product.productType === 'exchange' || Boolean(product.exchangeCurrencyName && String(product.exchangeCurrencyName).trim());
  const isCustom = !isExchange && (product.productType === 'custom' || Boolean(product.customFieldLabel && String(product.customFieldLabel).trim()));

  // بوكسات مخصصة يدوية للمبادلة (اسم البوكس وبجانبه خانته الفارغة)
  // تهيئة خانات المبادلة المخصصة المحددة من قبل المدير (من المنتج أو من الإعدادات العامة للمتجر)
  const initialFields = Array.isArray(product.exchangeCustomFields) && product.exchangeCustomFields.length > 0
    ? product.exchangeCustomFields
    : (Array.isArray(storeConfig?.exchangeCustomFields) && storeConfig.exchangeCustomFields.length > 0
        ? storeConfig.exchangeCustomFields
        : ['آيدي المزرعة']);

  const [customBoxes, setCustomBoxes] = useState(
    initialFields.map((fieldLabel, idx) => ({ id: idx + 1, name: fieldLabel, value: '' }))
  );

  // تحديث الشريحة عند اختيار باقة: لا نغير الكمية إطلاقاً بل تظل كما حددها العميل (أو 1)
  const handleSelectTier = (tier) => {
    setSelectedTier(tier);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const rawUnitPrice = selectedTier ? selectedTier.price : (isFlashSaleActive && product.flashSalePrice ? product.flashSalePrice : product.price);
  const currentUnitPrice = Number.isFinite(parseFloat(rawUnitPrice)) ? parseFloat(rawUnitPrice) : 0;

  const handleUpdateCustomBox = (id, field, val) => {
    setCustomBoxes(prev => prev.map(b => b.id === id ? { ...b, [field]: val } : b));
  };

  return (
    <div
      key={product.id}
      className="min-h-screen bg-[#F9FAFB] pb-16 animate-product-page"
      dir="rtl"
      style={{
        fontFamily: `'${storeConfig?.fontFamily || 'DIN Next LT Arabic'}', 'Tajawal', sans-serif`
      }}
    >
      {/* شريط مسار التنقل (Breadcrumbs) مثل منصة سلة وموقع y2rd */}
      <div className="bg-[#F9FAFB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3.5 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
            <button
              onClick={onBack}
              className="text-gray-500 hover:text-black transition flex items-center gap-1.5 cursor-pointer font-medium"
            >
              <i className="fa-solid fa-house text-black text-xs"></i>
              <span>الرئيسية</span>
            </button>
            <span className="text-gray-300">/</span>
            <button
              type="button"
              onClick={() => {
                if (onSelectCategory && product.category) {
                  onSelectCategory(product.category);
                } else if (onBack) {
                  onBack();
                }
              }}
              className="text-gray-600 hover:text-black transition cursor-pointer font-medium hover:bg-gray-100/70 px-1.5 py-0.5 rounded-md"
              title={`عرض قسم ${product.category}`}
            >
              {product.category}
            </button>
            <span className="text-gray-300">/</span>
            <span className="text-black font-bold truncate max-w-[200px] sm:max-w-md">{product.title}</span>
          </div>
        </div>
      </div>

      {/* المحتوى الرئيسي لصفحة تفاصيل المنتج بطراز موقع y2rd / سلة */}
      <main className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 pt-4 sm:pt-6">
        <div className="bg-[#F9FAFB] rounded-2xl sm:rounded-3xl p-3 sm:p-8">
          
          {/* تخطيط مرن: في الجوال الصورة فوق والوصف تحت بالكامل | وفي الكمبيوتر والشاشات الأكبر تخطيط جانبي متناسق */}
          <div className="flex flex-col md:grid md:grid-cols-12 gap-4 sm:gap-8 lg:gap-10 items-start">
            
            {/* ========================================================================= */}
            {/* الصورة الرئيسية (في الجوال فوق بعرض كامل | في الكمبيوتر في العمود الأيمن) */}
            {/* ========================================================================= */}
            <div 
              className="w-full md:col-span-5 flex flex-col gap-2 sm:gap-3 md:sticky md:top-16 z-10 self-start shrink-0"
            >
              {/* صورة المنتج */}
              <div className="relative rounded-xl sm:rounded-2xl overflow-hidden bg-transparent aspect-square w-full max-w-sm sm:max-w-md md:max-w-none mx-auto group flex items-center justify-center p-1.5 sm:p-4">
                <img
                  src={product.imageUrl || 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=800&auto=format&fit=crop&q=80'}
                  alt={product.title}
                  className="w-full h-full object-contain transition duration-500 group-hover:scale-105"
                />
                {product.badge && !['تسليم فوري', 'فوري', 'أصلي', 'ضمان أصلي', '24/7'].includes(product.badge.trim()) && (
                  <span className="absolute top-2 right-0 bg-[#5C1420] text-white text-[8.5px] sm:text-[9.5px] pr-2 pl-3 py-0.5 rounded-l-full rounded-r-none font-medium shadow-sm tracking-wide">
                    {product.badge}
                  </span>
                )}
                {product.productType === 'physical' && (
                  <span className="absolute top-2 left-2 bg-amber-600 text-white text-[9px] sm:text-[11px] px-1.5 py-0.5 rounded-md font-bold shadow-sm flex items-center gap-1">
                    <i className="fa-solid fa-box text-white text-[9px]"></i>
                    <span className="hidden sm:inline">سلعة مادية</span>
                  </span>
                )}
              </div>
            </div>

            {/* ========================================================================= */}
            {/* العنوان + الوصف + الباقات + الشراء (في الجوال تحت الصورة مباشرة | في الكمبيوتر في العمود الأيسر) */}
            {/* ========================================================================= */}
            <div className="w-full md:col-span-7 flex flex-col justify-between pr-0 md:pr-1 pl-0 md:pl-1">
              <div className="w-full pr-0.5">
                {/* أزرار المشاركة والرجوع */}
                <div className="flex items-center justify-between text-[11px] sm:text-xs text-gray-500 mb-1.5 pb-1">
                  <button
                    onClick={onBack}
                    className="text-gray-600 hover:text-black font-medium flex items-center gap-1 cursor-pointer transition px-1.5 py-1 rounded-lg hover:bg-gray-100/80 text-[10px] sm:text-xs"
                    title="الرجوع"
                  >
                    <i className="fa-solid fa-arrow-right text-[10px] sm:text-xs"></i>
                    <span>رجوع</span>
                  </button>
                  <button
                    onClick={handleCopyLink}
                    className="text-gray-500 hover:text-black font-medium flex items-center gap-1 cursor-pointer transition p-1 rounded-lg hover:bg-gray-100 text-[10px] sm:text-xs"
                    title="مشاركة المنتج"
                  >
                    <i className="fa-solid fa-share-nodes text-black text-[10px] sm:text-xs"></i>
                    <span>{isCopied ? 'تم النسخ!' : 'مشاركة'}</span>
                  </button>
                </div>

                {/* شريط العد التنازلي للعرض المؤقت */}
                {isFlashSaleActive && countdown && (
                  <div className="mb-3 p-2.5 sm:p-3 bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 rounded-2xl text-white shadow-sm flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <span className="text-base animate-bounce">🔥</span>
                      <span>عرض مؤقت ينتهي خلال:</span>
                    </div>
                    <div className="flex items-center gap-1 font-mono font-bold text-xs" dir="ltr">
                      {countdown.days > 0 && <span className="bg-black/30 px-1.5 py-0.5 rounded">{countdown.days}d</span>}
                      <span className="bg-black/30 px-1.5 py-0.5 rounded">{String(countdown.hours).padStart(2, '0')}h</span>
                      <span>:</span>
                      <span className="bg-black/30 px-1.5 py-0.5 rounded">{String(countdown.minutes).padStart(2, '0')}m</span>
                      <span>:</span>
                      <span className="bg-black/30 px-1.5 py-0.5 rounded">{String(countdown.seconds).padStart(2, '0')}s</span>
                    </div>
                  </div>
                )}

                {/* 1. عنوان المنتج بخط مريح وواضح */}
                <h1 className="text-sm sm:text-base lg:text-lg leading-snug font-bold mb-1.5 text-black">
                  {product.title}
                </h1>

                {/* 2. السعر أو مقابل المبادلة تحت العنوان مباشرة */}
                {isExchange ? (
                  <div className="mb-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-center">
                      {/* خانة: المنتج المطلوب (الاسم ثابت من الإعدادات والكمية قابلة للكتابة) */}
                      <div className="p-2.5 bg-gray-50/80 rounded-xl border border-gray-200 flex flex-col items-center justify-center gap-1 shadow-2xs">
                        <span className="text-[10px] text-gray-500 font-bold">المنتج المطلوب</span>
                        <span className="text-xs sm:text-sm font-bold text-gray-900 line-clamp-1" title={product.title}>
                          {product.title}
                        </span>
                        <div className="w-full flex flex-col items-center justify-center gap-1 pt-1 border-t border-gray-200/60 text-xs font-price">
                          <div className="flex items-center justify-center gap-1.5">
                            <span className="text-gray-500 text-[10px] font-sans">الكمية:</span>
                            <input
                              type="number"
                              min={minQty}
                              value={quantity}
                              dir="ltr"
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '') {
                                  setQuantity('');
                                } else {
                                  const parsed = parseInt(val);
                                  setQuantity(isNaN(parsed) ? minQty : Math.max(1, parsed));
                                }
                              }}
                              onBlur={() => {
                                if (!quantity || quantity < minQty) setQuantity(minQty);
                              }}
                              className="w-16 text-center py-0.5 px-1 bg-white border border-gray-300 focus:border-black rounded text-xs font-bold text-black font-english-num outline-none"
                              placeholder={String(minQty)}
                            />
                          </div>
                          {minQty > 1 && (parseInt(quantity) || 0) <= minQty && (
                            <span className="text-[9px] text-amber-700 font-sans">الحد الأدنى: <span dir="ltr" className="font-english-num font-bold">{(minQty).toLocaleString('en-US')}</span></span>
                          )}
                        </div>
                      </div>

                      {/* خانة: المنتج اللي نسلمك (الاسم من الإعدادات والكمية تُحسب تلقائياً حسب كمية المطلوب) */}
                      <div className="p-2.5 bg-teal-50/80 rounded-xl border border-teal-200 flex flex-col items-center justify-center gap-1 shadow-2xs">
                        <span className="text-[10px] text-teal-800 font-bold">المنتج اللي نسلمك</span>
                        <span className="text-xs sm:text-sm font-black text-teal-950 line-clamp-1" title={product.exchangeCurrencyName || 'مبادلة'}>
                          {product.exchangeCurrencyName || 'مبادلة'}
                        </span>
                        <div className="w-full flex items-center justify-center gap-1.5 pt-1 border-t border-teal-200/60 text-xs">
                          <span className="text-teal-700 text-[10px] font-sans">الكمية:</span>
                          <span dir="ltr" className="text-xs sm:text-sm font-black text-teal-950 font-english-num">
                            {((parseFloat(product.exchangeAmount) || 1) * (parseInt(quantity) || 1)).toLocaleString('en-US')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : isFlashSaleActive && product.flashSalePrice ? (
                  <div className="flex items-center gap-2 mb-2 whitespace-nowrap">
                    <span className="text-sm sm:text-lg font-bold font-price tracking-tight text-red-600">
                      {formatPrice(currentUnitPrice, activeCurrency)}
                    </span>
                    <span className="text-[11px] sm:text-xs text-gray-400 line-through font-price">
                      {formatPrice(product.price, activeCurrency)}
                    </span>
                    <span className="text-[10px] bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded-md">
                      خصم مؤقت
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mb-2 whitespace-nowrap">
                    <span className={`text-sm sm:text-lg font-bold font-price tracking-tight ${
                      product.oldPrice && product.oldPrice > currentUnitPrice ? 'text-red-700' : 'text-black'
                    }`}>
                      {formatPrice(currentUnitPrice, activeCurrency)}
                    </span>
                    {product.oldPrice && product.oldPrice > currentUnitPrice && (
                      <span className="text-[11px] sm:text-xs text-gray-400 line-through font-price">
                        {formatPrice(product.oldPrice, activeCurrency)}
                      </span>
                    )}
                  </div>
                )}

                {/* 3. قسم الوصف: عرض منسق ومرن يعرض وصف المنتج الذي كتبته فقط */}
                {(product.descriptionHtml || product.description) && (() => {
                  let cleanDesc = typeof product.descriptionHtml === 'string' && product.descriptionHtml.trim()
                    ? product.descriptionHtml
                    : (product.description || '');

                  if (!cleanDesc.includes('<p') && !cleanDesc.includes('<br') && !cleanDesc.includes('<div')) {
                    cleanDesc = cleanDesc.replace(/\n/g, '<br />');
                  }

                  // تطهير HTML لمنع حقن السكربتات (XSS)
                  const sanitizedDesc = cleanDesc
                    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
                    .replace(/\son\w+\s*=\s*[^>\s]+/gi, '')
                    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*?\1/gi, 'href="#"');

                  return (
                    <div className="text-gray-700 text-xs mb-3 leading-relaxed product__description-content bg-transparent [&_table]:border-collapse [&_table]:w-full [&_table]:my-2 [&_th]:border [&_th]:border-gray-200 [&_th]:p-1.5 [&_td]:border [&_td]:border-gray-200 [&_td]:p-1.5 [&_blockquote]:border-r-4 [&_blockquote]:border-gray-300 [&_blockquote]:pr-2 [&_blockquote]:my-1.5 [&_blockquote]:text-gray-500 [&_h1]:text-base sm:[&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-black [&_h1]:my-1 [&_h2]:text-sm sm:[&_h2]:text-base [&_h2]:font-bold [&_h2]:text-black [&_h2]:my-1 [&_h3]:text-xs sm:[&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-black [&_h3]:my-0.5">
                      <div className="bg-transparent" dangerouslySetInnerHTML={{ __html: sanitizedDesc }} />
                    </div>
                  );
                })()}

                {/* د. الحقول المخصصة التي يضيفها المدير (لجميع أنواع المنتجات) */}
                {Array.isArray(product.customFields) && product.customFields.filter(f => f.label?.trim()).length > 0 && (
                  <div className="mb-3 space-y-2 text-right">
                    {product.customFields.filter(f => f.label?.trim()).map((field) => (
                      <div key={field.id} className="flex items-center gap-2">
                        {/* اسم الحقل ثابت */}
                        <span className="text-xs font-bold text-gray-800 shrink-0">
                          {field.label}
                          {field.required && <span className="text-red-500 font-normal text-[10px] mr-0.5">*</span>}
                        </span>
                        <span className="text-gray-400 text-xs font-medium">:</span>
                        {/* خانة الكتابة */}
                        <input
                          type="text"
                          value={customFieldValues?.[field.id] || ''}
                          onChange={(e) => {
                            setCustomFieldValues(prev => ({ ...(prev || {}), [field.id]: e.target.value }));
                          }}
                          placeholder="اكتب هنا..."
                          className="flex-1 bg-transparent text-xs text-gray-900 outline-none border-b border-gray-300 focus:border-black py-0.5 transition"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* هـ. منتج مبادلة: بوكسات مخصصة (اسم الخانة ثابت محدد من قبل المدير والعميل يكتب في الخانة الفارغة فقط) */}
                {isExchange && (
                  <div className="mb-3 space-y-2 text-right">
                    {customBoxes.map((box) => (
                      <div key={box.id} className="flex items-center gap-2">
                        {/* اسم البوكس ثابت غير قابل للتعديل من قبل العميل */}
                        <span className="text-xs font-bold text-gray-800 shrink-0">
                          {box.name}
                        </span>
                        <span className="text-gray-400 text-xs font-medium">:</span>
                        {/* الخانة الفارغة بجانبه ليكتب العميل بياناته */}
                        <input
                          type="text"
                          value={box.value}
                          onChange={(e) => handleUpdateCustomBox(box.id, 'value', e.target.value)}
                          placeholder="اكتب هنا..."
                          className="flex-1 bg-transparent text-xs text-gray-900 outline-none border-b border-gray-300 focus:border-black py-0.5 transition"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* 4. خيارات باقات الكميات المتعددة فائقة الصغر */}
                {!isExchange && product.hasQuantityTiers && product.quantityTiers && product.quantityTiers.length > 0 && (
                  <div className="mb-2.5 space-y-1">
                    <label className="text-[9px] sm:text-[10px] font-normal text-gray-800 flex items-center gap-1">
                      <i className="fa-solid fa-tags text-black text-[8px]"></i>
                      <span>الباقات:</span>
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1 sm:gap-1.5">
                      {product.quantityTiers.map((tier, idx) => (
                        <div
                          key={idx}
                          onClick={() => handleSelectTier(tier)}
                          className={`p-1.5 rounded-lg border text-right cursor-pointer transition-all duration-200 active:scale-97 relative flex items-center justify-between ${
                            selectedTier?.minQuantity === tier.minQuantity
                              ? 'border-gray-800 bg-gray-50/80 shadow-2xs'
                              : 'border-gray-200 bg-white hover:bg-gray-50/80 hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0 pr-0.5">
                            {selectedTier?.minQuantity === tier.minQuantity ? (
                              <span className="text-black text-[9px] font-normal shrink-0">✓</span>
                            ) : (
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0"></span>
                            )}
                            <div className="truncate">
                              <span className="block text-[9px] sm:text-[11px] font-normal text-black truncate leading-tight">{tier.label}</span>
                            </div>
                          </div>
                          <div className="text-[9px] sm:text-[10px] font-bold text-red-700 font-price shrink-0 pl-1">
                            {formatPrice(tier.price, activeCurrency)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 5. شريط الشراء: عداد الكمية بكامل العرض فوق زر الإضافة للسلة */}
              <div className="pt-2 border-t border-gray-100 flex flex-col gap-2 mt-1">
                {/* عداد الكمية فوق الزر بكامل العرض وبنفس طوله مع إمكانية الكتابة اليدوية المباشرة */}
                <div className="w-full flex items-center justify-between border border-gray-200 rounded-lg overflow-hidden bg-white shadow-2xs h-8 sm:h-9 px-1">
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.max(minQty, (parseInt(quantity) || minQty) - 1))}
                    className="w-8 sm:w-10 h-full flex items-center justify-center text-gray-700 hover:bg-gray-100 font-bold cursor-pointer text-sm sm:text-base transition rounded"
                    title="تقليل الكمية"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={minQty}
                    value={quantity}
                    dir="ltr"
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setQuantity('');
                      } else {
                        const parsed = parseInt(val);
                        setQuantity(isNaN(parsed) ? minQty : Math.max(minQty, parsed));
                      }
                    }}
                    onBlur={() => {
                      if (!quantity || quantity < minQty) setQuantity(minQty);
                    }}
                    className="text-center font-bold text-xs sm:text-sm text-black font-english-num w-20 py-1 outline-none bg-transparent"
                    placeholder={String(minQty)}
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity((parseInt(quantity) || minQty) + 1)}
                    className="w-8 sm:w-10 h-full flex items-center justify-center text-gray-700 hover:bg-gray-100 font-bold cursor-pointer text-sm sm:text-base transition rounded"
                    title="زيادة الكمية"
                  >
                    +
                  </button>
                </div>

                {/* زر الإضافة للسلة */}
                <button
                  onClick={() => {
                     const finalQty = Math.max(minQty, parseInt(quantity) || minQty);

                     // التحقق من الحقول المخصصة الإجبارية
                     const requiredFields = Array.isArray(product.customFields)
                       ? product.customFields.filter(f => f.label?.trim() && f.required)
                       : [];
                     const missingRequired = requiredFields.find(f => !(customFieldValues?.[f.id] || '').trim());
                     if (missingRequired) {
                       alert(`يرجى ملء حقل "${missingRequired.label}" قبل الإضافة للسلة.`);
                       return;
                     }

                     if (isExchange) {
                       const validBoxes = customBoxes.filter(b => b.value && b.value.trim());
                       if (validBoxes.length === 0) {
                         alert('يرجى ملء خانة واحدة على الأقل من البيانات قبل الإضافة للسلة.');
                         return;
                       }

                       const finalNote = validBoxes.map(b => `${b.name || 'بيانات'}: ${b.value.trim()}`).join(' | ');
                       onAddToCart(product, null, finalNote, finalQty);
                       return;
                     }

                     // بناء الملاحظة النهائية من الحقول المخصصة + أي ملاحظة نصية
                     const customFieldsNote = Array.isArray(product.customFields)
                       ? product.customFields
                           .filter(f => f.label?.trim() && (customFieldValues?.[f.id] || '').trim())
                           .map(f => `${f.label}: ${customFieldValues[f.id].trim()}`)
                           .join(' | ')
                       : '';
                     const finalNote = [customFieldsNote, customUserNote.trim()].filter(Boolean).join(' | ');
                     onAddToCart(product, selectedTier, finalNote, finalQty);
                  }}
                  className="w-full h-8 sm:h-9 px-3 sm:px-5 bg-black hover:bg-gray-800 text-white font-bold rounded-lg transition duration-200 flex items-center justify-center gap-2 cursor-pointer text-xs sm:text-[13px] shadow-sm active:scale-98"
                >
                  <i className="fa-solid fa-cart-shopping text-white text-xs"></i>
                  <span>أضف للسلة</span>
                </button>
              </div>

              {/* 6. بطاقات مميزات المتجر الحقيقية داخل صفحة المنتج */}
              {storeConfig?.productFeatures?.enabled !== false && (() => {
                const activeFeatures = (storeConfig?.productFeatures?.items || [
                  { id: 'feat-1', enabled: true, title: 'سرعة التنفيذ', subtitle: 'خدمة آلية فورية', icon: 'fa-solid fa-bolt' },
                  { id: 'feat-2', enabled: true, title: 'ضمان كامل', subtitle: 'مباشر 100%', icon: 'fa-solid fa-shield-halved' },
                  { id: 'feat-3', enabled: true, title: 'دعم متواصل', subtitle: 'واتساب ومباشر', icon: 'fa-solid fa-comments' }
                ]).filter(f => f.enabled !== false);

                if (activeFeatures.length === 0) return null;

                return (
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    <div className="grid grid-cols-3 gap-1.5 sm:gap-2 max-w-sm mx-auto">
                      {activeFeatures.map((feat, fIndex) => (
                        <div
                          key={feat.id || fIndex}
                          className="store-feature-card relative overflow-hidden p-2 rounded-[2px] bg-white border border-gray-100 shadow-2xs flex flex-col items-center text-center group hover:border-gray-200 transition"
                        >
                          <div className="store-feature-icon-wrapper w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-black text-white flex items-center justify-center text-xs mb-1.5 shadow-sm">
                            {feat.customIconUrl ? (
                              <img src={feat.customIconUrl} alt="" className="w-4 h-4 object-contain brightness-0 invert" />
                            ) : (
                              <i className={`${feat.icon || 'fa-solid fa-bolt'} text-white text-[11px]`}></i>
                            )}
                          </div>
                          <h4 className="font-medium text-black text-[10px] sm:text-[11px] tracking-tight truncate w-full">
                            {feat.title}
                          </h4>
                          <p className="text-[8px] sm:text-[9px] text-gray-400 font-light mt-0.5 leading-tight line-clamp-1 w-full">
                            {feat.subtitle}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

            </div>

          </div>
        </div>

        {/* قسم تقييمات وآراء العملاء مع إرفاق الصور بنمط سلة الاحترافي */}
        <div className="mt-10 bg-white rounded-2xl p-4 sm:p-6 border border-gray-200/90 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-5 bg-[#004956] rounded-full"></span>
              <h3 className="text-sm sm:text-base font-bold text-black">آراء وتقييمات العملاء</h3>
              <span className="text-xs text-gray-400 font-mono">({(product.reviews || []).length})</span>
            </div>
            {/* متوسط التقييم: إذا لا يوجد تقييم لا نكتب شيء، وإذا وجد نحسب التقييم الكلي */}
            {product.reviews && product.reviews.length > 0 && (
              <div className="flex items-center gap-1.5 bg-amber-50 px-2.5 py-1 rounded-xl border border-amber-200/60">
                <span className="text-amber-500 text-xs">⭐</span>
                <span className="font-bold text-amber-900 text-xs font-mono font-english-num">
                  {(product.reviews.reduce((sum, r) => sum + (parseFloat(r.rating) || 5), 0) / product.reviews.length).toFixed(1)}
                </span>
                <span className="text-[10px] text-amber-700">/ 5</span>
              </div>
            )}
          </div>

          {product.reviews && product.reviews.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {product.reviews.map((rev, idx) => (
                <div key={rev.id || idx} className="p-3 bg-gray-50/70 rounded-xl border border-gray-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center">
                        {(rev.customerName || rev.name || 'ع').charAt(0)}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
                          <span>{rev.customerName || rev.name || 'عميل معتمد'}</span>
                          <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1 py-0.2 rounded border border-emerald-200">
                            ✓ مشتري حقيقي
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-400 font-mono">{rev.date || ''}</span>
                      </div>
                    </div>
                    {/* النجوم */}
                    <div className="flex items-center text-amber-400 text-xs">
                      {'★'.repeat(Math.round(rev.rating || 5))}
                      {'☆'.repeat(Math.max(0, 5 - Math.round(rev.rating || 5)))}
                    </div>
                  </div>
                  {rev.comment && (
                    <p className="text-xs text-gray-700 leading-relaxed pr-9">{rev.comment}</p>
                  )}
                  {/* الصورة المرفقة إن وجدت (لقطة شاشة أو إثبات استلام) */}
                  {(rev.photoUrl || rev.image) && (
                    <div className="pr-9 pt-1">
                      <img
                        src={rev.photoUrl || rev.image}
                        alt="صورة استلام العميل"
                        onClick={() => setSelectedReviewImage(rev.photoUrl || rev.image)}
                        className="w-20 h-20 rounded-lg object-cover border border-gray-200 cursor-pointer hover:opacity-90 transition shadow-2xs hover:scale-105"
                      />
                      <span className="text-[9px] text-gray-400 block mt-0.5">اضغط لتكبير لقطة الشاشة</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400 text-xs space-y-1">
              <i className="fa-regular fa-comment-dots text-2xl text-gray-300"></i>
              <p>لا توجد تقييمات لهذا المنتج حتى الآن.</p>
              <p className="text-[10px] text-gray-400">يمكنك تقييم هذا المنتج وإرفاق صورة فور استلام طلبك من تبويب "الطلبات" بحسابك.</p>
            </div>
          )}
        </div>

        {/* نافذة تكبير صورة التقييم */}
        {selectedReviewImage && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSelectedReviewImage(null)}>
            <div className="relative max-w-xl max-h-[90vh] bg-white rounded-2xl overflow-hidden p-2" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setSelectedReviewImage(null)}
                className="absolute top-3 left-3 z-10 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center text-sm"
              >
                ✕
              </button>
              <img src={selectedReviewImage} alt="صورة مكبرة" className="max-w-full max-h-[80vh] object-contain rounded-xl" />
            </div>
          </div>
        )}

        {/* قسم منتجات ذات صلة (قد تعجبك أيضاً) بنمط سلة وموقع y2rd */}
        {relatedProducts && relatedProducts.length > 0 && (
          <div className="mt-12">
            <div className="flex items-center gap-2 mb-5">
              <span className="w-1.5 h-5 bg-black rounded-full"></span>
              <h3 className="text-base sm:text-lg font-bold text-black">منتجات ذات صلة قد تعجبك</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {relatedProducts.filter(p => p.id !== product.id).slice(0, 4).map((rel) => (
                <div
                  key={rel.id}
                  onClick={() => {
                    onSelectProduct(rel);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="bg-white rounded-2xl border border-gray-200/90 hover:border-black/30 shadow-xs hover:shadow-md transition cursor-pointer flex flex-col justify-between overflow-hidden group"
                >
                  <div>
                    <div className="relative pt-[70%] sm:pt-[72%] bg-white overflow-hidden">
                      <img src={rel.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover transition duration-300 group-hover:scale-105" />
                    </div>
                    <div className="p-3 sm:p-4 text-right">
                      <span className="text-[10px] text-gray-400 block font-medium mb-1">{rel.category}</span>
                      <h4 className="text-xs sm:text-[13px] font-bold text-black line-clamp-1 group-hover:text-gray-700 transition">{rel.title}</h4>
                    </div>
                  </div>
                  <div className="p-3 sm:p-4 pt-0 border-t border-gray-50 flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-bold text-black font-price">
                      {formatPrice(rel.price, activeCurrency)}
                    </span>
                    <span className="text-[11px] text-black font-bold">التفاصيل ←</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
