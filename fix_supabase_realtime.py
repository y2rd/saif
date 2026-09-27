import re

def fix():
    with open('src/supabase.js', 'r', encoding='utf-8') as f:
        content = f.read()

    start_phrase = "// جلب الصور من الكاش المحلي لمنع إعادة التحميل الضخمة"
    end_phrase = ".catch(() => {});\n          }"
    
    start_idx = content.find(start_phrase)
    if start_idx == -1:
        print("start phrase not found")
        return
        
    end_idx = content.find(end_phrase, start_idx)
    if end_idx == -1:
        print("end phrase not found")
        return
        
    end_idx += len(end_phrase)
    
    new_block = """const list = data.map(r => ({
            ...r.data,
            ...r,
            id: r.id
          }));
          onProductsUpdate(list, Date.now());"""
          
    content = content[:start_idx] + new_block + content[end_idx:]
    
    with open('src/supabase.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Success")

if __name__ == '__main__':
    fix()
