import re

def fix():
    with open('src/supabase.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the mapping in fetchAllInitial
    old_map1 = """const fullList = resProdsLight.value.data.map(r => ({
          ...r.data,
          ...r,
          id: r.id
        }));"""
        
    new_map1 = """const fullList = resProdsLight.value.data.map(r => {
          const img = r.image || r.data?.image || r.data?.imageUrl || '';
          return {
            ...r.data,
            ...r,
            id: r.id,
            image: img,
            imageUrl: img
          };
        });"""
        
    content = content.replace(old_map1, new_map1)
    
    # Find the mapping in Realtime Subscription
    old_map2 = """const list = data.map(r => ({
            ...r.data,
            ...r,
            id: r.id
          }));"""
          
    new_map2 = """const list = data.map(r => {
            const img = r.image || r.data?.image || r.data?.imageUrl || '';
            return {
              ...r.data,
              ...r,
              id: r.id,
              image: img,
              imageUrl: img
            };
          });"""
          
    content = content.replace(old_map2, new_map2)
    
    with open('src/supabase.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Success")

if __name__ == '__main__':
    fix()
