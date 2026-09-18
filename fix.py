import re

path = r"C:\Users\johar\Documents\haider\my-store\src\AdminDashboard.jsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# The misplaced cloud-backup block starts with:
#             {/* ========================================================= */}
#         {/* قسم النسخ الاحتياطي والمزامنة السحابية (حل مشكلة الرفع للاستضافة) */}
# and ends right before:
#       {/* خلفية معتمة (Backdrop) عند فتح القائمة على الجوال */}

pattern = re.compile(r"(\s*\{/\* ========================================================= \*/\}\s*\{/\* قسم النسخ الاحتياطي والمزامنة السحابية.*?</div>\s*</div>\s*\)\})", re.DOTALL)
match = pattern.search(content)

if match:
    cloud_block = match.group(1)
    content = content.replace(cloud_block, "")
    
    # insert it right before </main>
    main_end = content.find("</main>")
    if main_end != -1:
        content = content[:main_end] + cloud_block + "\n      " + content[main_end:]
    
    with open(path, "w", encoding="utf-8") as out:
        out.write(content)
    print("Fixed cloud-backup block!")
else:
    print("Could not find cloud-backup block")
