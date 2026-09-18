import re

path = r"C:\Users\johar\Documents\haider\my-store\src\AdminDashboard.jsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Compact Aside/Nav
content = content.replace('px-3 py-1.5 rounded-xl', 'px-2 py-1 rounded-lg')
content = content.replace('w-full flex items-center justify-between px-3 py-1.5 md:py-2', 'w-full flex items-center justify-between px-2 py-1 md:py-1.5')

# Make modals more compact
content = content.replace('p-6 shadow-2xl', 'p-4 shadow-xl')
content = content.replace('p-5 shadow-2xl', 'p-4 shadow-xl')
content = content.replace('p-5 space-y-4 text-xs', 'p-3 space-y-3 text-xs')
content = content.replace('p-4 border-b border-gray-100', 'p-3 border-b border-gray-100')
content = content.replace('p-4 bg-gray-50', 'p-3 bg-gray-50')
content = content.replace('py-3.5 px-4', 'py-2 px-3')
content = content.replace('py-3.5 px-3', 'py-2 px-2')
content = content.replace('py-3 px-3', 'py-2 px-2')

# Shrink all h-12 to h-10, h-11 to h-9
content = content.replace('h-12', 'h-10').replace('w-12', 'w-10')
content = content.replace('h-11', 'h-9').replace('w-11', 'w-9')

# Specifically for the categories list (which was reduced already, but just in case)
content = content.replace('w-6 h-8 flex', 'w-4 h-6 flex')

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Scaling done")
