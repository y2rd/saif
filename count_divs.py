import re
import subprocess

path = r"C:\Users\johar\Documents\haider\my-store\src\AdminDashboard.jsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

tabs = re.findall(r"(\s*\{activeTab === '[^']+' && \([\s\S]*?\}\)\})", content)

for i, tab in enumerate(tabs):
    div_open = len(re.findall(r"<div[^>]*>", tab))
    div_close = len(re.findall(r"</div>", tab))
    print(f"Tab {i}: {div_open} opens, {div_close} closes. Diff: {div_open - div_close}")

