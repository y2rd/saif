const fs = require("fs");
let code = fs.readFileSync("C:\\Users\\johar\\Documents\\haider\\my-store\\src\\AdminDashboard.jsx", "utf8");

// 1. Add loyalty to array
code = code.replace("{ id: 'features', label: 'المميزات السريعة', icon: 'fa-bolt' },", "{ id: 'features', label: 'المميزات السريعة', icon: 'fa-bolt' },\n          { id: 'loyalty', label: 'الولاء والمكافآت', icon: 'fa-gift' },");

// 2. Add loyalty content
const loyalty_content = `
        {/* ========================================================= */}
        {/* قسم الولاء والمكافآت (Loyalty) */}
        {/* ========================================================= */}
        {activeTab === 'loyalty' && (
          <div className="space-y-6 max-w-2xl mx-auto">
            <div>
              <h2 className="text-lg font-bold text-black flex items-center gap-2 mb-1">
                <i className="fa-solid fa-gift text-[#004956] text-lg"></i>
                <span>نظام الولاء والمكافآت</span>
              </h2>
              <p className="text-xs text-gray-500">تحكم في تشغيل أو إيقاف نقاط الولاء وقيمة النقاط الممنوحة للعملاء.</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                <div>
                  <label className="font-bold text-gray-800 block text-sm">تفعيل نظام الولاء</label>
                  <span className="text-[11px] text-gray-500">عند التفعيل سيحصل العملاء على نقاط عند الشراء يمكنهم استبدالها برصيد</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={storeConfig.loyaltyConfig?.enabled !== false}
                    onChange={(e) => setStoreConfig({ ...storeConfig, loyaltyConfig: { ...(storeConfig.loyaltyConfig || {}), enabled: e.target.checked } })}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#004956]"></div>
                </label>
              </div>

              {storeConfig.loyaltyConfig?.enabled !== false && (
                <div className="space-y-4 pt-2">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">كم دولار يجب أن ينفقه العميل للحصول على نقطة واحدة؟</label>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-sm">$</span>
                      <input
                        type="number"
                        min="1"
                        value={storeConfig.loyaltyConfig?.spendUsdPerPoint || 10}
                        onChange={(e) => setStoreConfig({ ...storeConfig, loyaltyConfig: { ...(storeConfig.loyaltyConfig || {}), spendUsdPerPoint: Number(e.target.value) } })}
                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">كم دولار تساوي كل (100) نقطة عند الاستبدال؟</label>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 text-sm">$</span>
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={((storeConfig.loyaltyConfig?.pointsPerUsd || 10) === 0 ? 0 : 100 / (storeConfig.loyaltyConfig?.pointsPerUsd || 10)).toFixed(2)}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value);
                          const pointsPerUsd = value > 0 ? 100 / value : 10;
                          setStoreConfig({ ...storeConfig, loyaltyConfig: { ...(storeConfig.loyaltyConfig || {}), pointsPerUsd: pointsPerUsd } });
                        }}
                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => showToast('تم حفظ إعدادات الولاء بنجاح')}
              className="w-full py-3 bg-black hover:bg-gray-800 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer"
            >
              حفظ التعديلات
            </button>
          </div>
        )}
`;
code = code.replace("      {/* ========================================================= */}\n      {/* نافذة مودال: إضافة / تعديل منتج", loyalty_content + "\n      {/* ========================================================= */}\n      {/* نافذة مودال: إضافة / تعديل منتج");

// 3. Add Exchange boxes to the Add/Edit Product Modal
const exchange_modal_fields = `
              {productForm.type === 'مبادلة' && (
                <div className="border border-gray-200 rounded-xl p-3 bg-gray-50 space-y-3 col-span-2">
                  <h4 className="font-bold text-xs text-gray-800">بيانات منتج المبادلة</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-gray-700 mb-1 text-[11px]">ما هي المادة/العملة المطلوبة للمبادلة؟</label>
                      <input
                        type="text"
                        value={productForm.exchangeCurrencyName || ''}
                        onChange={(e) => setProductForm({ ...productForm, exchangeCurrencyName: e.target.value })}
                        placeholder="مثال: صكوك، ذهب، قمح..."
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg outline-none text-xs"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-gray-700 mb-1 text-[11px]">الكمية المطلوبة:</label>
                      <input
                        type="number"
                        value={productForm.exchangeAmount || ''}
                        onChange={(e) => setProductForm({ ...productForm, exchangeAmount: e.target.value })}
                        placeholder="أدخل الكمية..."
                        className="w-full p-2 bg-white border border-gray-200 rounded-lg outline-none text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}
`;

code = code.replace(/              <div>\r?\n                <label className="block font-medium text-gray-700 mb-1">القسم<\/label>/, exchange_modal_fields + '              <div>\n                <label className="block font-medium text-gray-700 mb-1">القسم</label>');

fs.writeFileSync("C:\\Users\\johar\\Documents\\haider\\my-store\\src\\AdminDashboard.jsx", code);
