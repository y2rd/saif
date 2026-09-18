export default function StoreFront({ products }) {
  return (
    <div className="max-w-6xl mx-auto p-6" dir="rtl">
      <h1 className="text-2xl font-black text-gray-900 mb-6">المنتجات المعروضة</h1>
      
      {products.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-500 text-lg">لا توجد منتجات معروضة حالياً.</p>
          <p className="text-sm text-gray-400 mt-1">اضغطي على "لوحة التحكم" بالأعلى لإضافة أول منتج.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {products.map((item) => (
            <div key={item.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col justify-between hover:shadow-md transition">
              <div>
                <img
                  src={item.imageUrl || 'https://via.placeholder.com/300x200?text=No+Image'}
                  alt={item.title}
                  className="w-full h-44 object-cover"
                />
                <div className="p-4">
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{item.category || 'عام'}</span>
                  <h3 className="text-lg font-bold text-gray-800 mt-2">{item.title}</h3>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{item.description}</p>
                </div>
              </div>
              
              <div className="p-4 border-t border-gray-100 flex items-center justify-between">
                <span className="text-lg font-black text-emerald-600">${item.price}</span>
                <button className="px-3 py-1.5 bg-gray-900 hover:bg-black text-white text-sm font-medium rounded-lg">
                  شراء الآن
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}