import os
import shutil
import subprocess

src_dir = r"C:\Users\johar\Documents\haider\my-store\mobile"
dst_dir = r"D:\my-store-mobile"

print("Copying files to D drive...")
if not os.path.exists(dst_dir):
    os.makedirs(dst_dir)

for root, dirs, files in os.walk(src_dir):
    if "node_modules" in dirs:
        dirs.remove("node_modules")
    if "android" in dirs:
        dirs.remove("android")
    if ".expo" in dirs:
        dirs.remove(".expo")
    if ".git" in dirs:
        dirs.remove(".git")
        
    rel_path = os.path.relpath(root, src_dir)
    dest_path = os.path.join(dst_dir, rel_path)
    if not os.path.exists(dest_path):
        os.makedirs(dest_path)
        
    for file in files:
        src_file = os.path.join(root, file)
        dst_file = os.path.join(dest_path, file)
        shutil.copy2(src_file, dst_file)

print("Running npm install...")
subprocess.run(["npm", "install", "--legacy-peer-deps"], cwd=dst_dir, shell=True)

print("Building and installing on Android...")
subprocess.run(["npx", "expo", "run:android"], cwd=dst_dir, shell=True)
