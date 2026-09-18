import re

path = r"C:\Users\johar\Documents\haider\my-store\src\AdminDashboard.jsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Remove Grip icon
#                             {/* مقبض السحب (Grip) */}
#                             <div 
#                               className="w-6 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 cursor-grab active:cursor-grabbing select-none"
#                               title="اسحب القسم للأعلى أو الأسفل لإعادة الترتيب"
#                             >
#                               <i className="fa-solid fa-grip-vertical text-xs sm:text-sm"></i>
#                             </div>
pattern_grip = r"\s*\{\/\* مقبض السحب \(Grip\) \*\/\}.*?<\/div>"
content = re.sub(pattern_grip, "", content, flags=re.DOTALL)


# 2. Resize category row layout
# <div className="flex items-center gap-1 shrink-0">  =>  <div className="flex items-center shrink-0">
content = content.replace('className="flex items-center gap-1 shrink-0"', 'className="flex flex-col items-center gap-1 shrink-0 px-1"')

# أسهم الترتيب السريع للأعلى والأسفل
content = content.replace('className="flex flex-col items-center justify-center gap-0.5"', 'className="flex flex-col items-center justify-center gap-1"')

# Resize image/icon container: w-11 h-11 -> w-8 h-8, w-9 h-9 -> w-7 h-7
content = content.replace("w-11 h-11", "w-8 h-8").replace("w-9 h-9", "w-7 h-7").replace("w-10 h-10", "w-7 h-7").replace("w-6 sm:w-8 shrink-0", "w-5 shrink-0")
content = content.replace("text-sm sm:text-base", "text-[11px] sm:text-xs")
content = content.replace("p-3 sm:p-4 hover:bg-gray-50/70", "p-2 sm:p-2.5 hover:bg-gray-50/70")
content = content.replace("bg-gray-50/40 pr-8 sm:pr-12", "bg-gray-50/40 pr-6 sm:pr-8")

# Reduce font sizes of category name
content = content.replace("text-xs sm:text-[13px]", "text-[11px]").replace("text-xs sm:text-sm", "text-xs")

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Categories resized successfully")
