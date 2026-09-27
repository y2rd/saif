import re

def fix():
    with open('src/supabase.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Replace the select clause
    content = content.replace(
        ".select('id, title, price, old_price, category, product_type, stock, badge, description, is_deleted, updated_at, created_at, data')",
        ".select('*')"
    )
    
    # 2. Extract everything between "// المرحلة 1: عرض المنتجات الخفيفة مع إضافة الصور من الكاش المحلي" and "if (resCusts.status === 'fulfilled'"
    start_phrase = "// المرحلة 1: عرض المنتجات الخفيفة مع إضافة الصور من الكاش المحلي"
    end_phrase = "if (resCusts.status === 'fulfilled'"
    
    start_idx = content.find(start_phrase)
    end_idx = content.find(end_phrase, start_idx)

    if start_idx != -1 and end_idx != -1:
        new_block = """// عرض المنتجات مباشرة ببيانات كاملة والصور (بدون مرحلتين)
      if (resProdsLight.status === 'fulfilled' && Array.isArray(resProdsLight.value?.data) && onProductsUpdate) {
        const fullList = resProdsLight.value.data.map(r => ({
          ...r.data,
          ...r,
          id: r.id
        }));
        onProductsUpdate(fullList, Date.now());
      }

      """
        content = content[:start_idx] + new_block + content[end_idx:]
        
        with open('src/supabase.js', 'w', encoding='utf-8') as f:
            f.write(content)
        print("Success")
    else:
        print("Failed to find boundaries")

if __name__ == '__main__':
    fix()
