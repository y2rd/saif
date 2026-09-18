import re
import subprocess

path = r"C:\Users\johar\Documents\haider\my-store\src\AdminDashboard.jsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's try to remove tabs one by one and run prettier to see which tab has the syntax error!
# Tabs usually look like: {activeTab === 'analytics' && ( ... )}
tabs = re.findall(r"(\s*\{activeTab === '[^']+' && \([\s\S]*?\}\)\})", content)

print(f"Found {len(tabs)} tabs!")
for i, tab in enumerate(tabs):
    test_content = content.replace(tab, "")
    with open("test_admin.jsx", "w", encoding="utf-8") as f:
        f.write(test_content)
    
    result = subprocess.run("cmd.exe /c npx prettier test_admin.jsx", capture_output=True, text=True)
    if "SyntaxError" not in result.stderr:
        print(f"Tab {i} is the culprit! (Length: {len(tab)})")
        break
    else:
        print(f"Tab {i} is NOT the only culprit.")
