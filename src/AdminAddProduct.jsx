import { useState } from 'react';

export default function AdminAddProduct({ onAddProduct }) {
  const [formData, setFormData] = useState({
    title: '',
    price: '',
    category: '',
    imageUrl: '',
    description: ''
  });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.title || !formData.price) return;
    
    onAddProduct({
      id: Date.now(),
      ...formData,
      price: parseFloat(formData.price)
    });

    setFormData({ title: '', price: '', category: '', imageUrl: '', description: '' });
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-xl shadow-md border border-gray-100 mt-6" dir="rtl">
      <h2 className="text-xl font-bold text-gray-800 mb-4">إضافة منتج جديد للمتجر</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">اسم المنتج</label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            required
            className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="مثال: بطاقة شحن / منتج رقمي"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">السعر ($)</label>
            <input
              type="number"
              name="price"
              value={formData.price}
              onChange={handleChange}
              required
              className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">القسم</label>
            <input
              type="text"
              name="category"
              value={formData.category}
              onChange={handleChange}
              className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="رقمي، حسابات، سلع..."
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">صورة المنتج</label>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="url"
              name="imageUrl"
              value={formData.imageUrl}
              onChange={handleChange}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
              placeholder="رابط الصورة أو ارفع من جهازك..."
            />
            <label className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold rounded-lg cursor-pointer shrink-0 border border-gray-300 flex items-center gap-1">
              <span>📸 رفع من الجهاز</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => setFormData(prev => ({ ...prev, imageUrl: reader.result }));
                    reader.readAsDataURL(file);
                  }
                }}
                className="hidden"
              />
            </label>
          </div>
          {formData.imageUrl && (
            <div className="flex items-center gap-2 mt-2 p-1.5 bg-gray-50 rounded border border-gray-200">
              <img src={formData.imageUrl} alt="" className="w-9 h-9 rounded object-cover" />
              <span className="text-xs text-gray-500 truncate flex-1">تم تحديد صورة المنتج</span>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, imageUrl: '' }))}
                className="text-xs text-red-500 hover:underline"
              >
                ✕ إزالة
              </button>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">الوصف</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows="3"
            className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="تفاصيل المنتج أو طريقة التسليم..."
          ></textarea>
        </div>

        <button
          type="submit"
          className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow transition duration-200"
        >
          نشر المنتج في المتجر
        </button>
      </form>
    </div>
  );
}