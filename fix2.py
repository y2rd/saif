import re

path = "original.jsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# The start is:
start_str = "              </span>\n            {/* ========================================================= */}\n        {/* قسم النسخ الاحتياطي"
start_idx = content.find(start_str)

if start_idx == -1:
    print("Could not find start")
    exit(1)

# Find the end of the cloud-backup tab.
# The cloud-backup tab ends right before {/* خلفية معتمة
end_str = "      {/* خلفية معتمة"
end_idx = content.find(end_str, start_idx)

if end_idx == -1:
    print("Could not find end")
    exit(1)

# Extract the cloud-backup block (without the </span> part)
cloud_block = content[start_idx + len("              </span>\n"):end_idx]

# Replace the whole broken part with the correct tabs closing
correct_tabs_closing = "              </span>\n            )}\n          </button>\n        ))}\n      </div>\n\n"

# Remove the cloud-backup block from its current place
content = content[:start_idx + len("              </span>\n")] + correct_tabs_closing + content[end_idx:]

# Now insert the cloud-backup block inside <main>
# We find </main>
main_end_idx = content.rfind("</main>")
content = content[:main_end_idx] + cloud_block + "      " + content[main_end_idx:]

with open(r"C:\Users\johar\Documents\haider\my-store\src\AdminDashboard.jsx", "w", encoding="utf-8") as out:
    out.write(content)
print("Fixed successfully!")
