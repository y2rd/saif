import json
import re

transcript_path = r"C:\Users\johar\.gemini\antigravity-cli\brain\b354990f-d740-4c01-8eba-29eb6fd5a7fc\.system_generated\logs\transcript_full.jsonl"

file_content = ""
writes = 0
replaces = 0

with open(transcript_path, "r", encoding="utf-8") as f:
    for line in f:
        if not line.strip(): continue
        try:
            step = json.loads(line)
        except: continue
        
        if step.get("source") == "MODEL" and "tool_calls" in step:
            for tc in step["tool_calls"]:
                name = tc.get("name")
                args = tc.get("args", {})
                target_file = args.get("TargetFile", "")
                
                # EXACT match for AdminDashboard.jsx
                if target_file.endswith("AdminDashboard.jsx"):
                    if name == "write_to_file":
                        file_content = args.get("CodeContent", "")
                        writes += 1
                    elif name == "replace_file_content":
                        target = args.get("TargetContent", "")
                        replacement = args.get("ReplacementContent", "")
                        
                        start = args.get("StartLine", 1) - 1
                        end = args.get("EndLine", len(file_content.splitlines()))
                        
                        lines = file_content.splitlines()
                        
                        if target in file_content:
                            file_content = file_content.replace(target, replacement, 1)
                            replaces += 1

with open(r"C:\Users\johar\Documents\haider\my-store\src\AdminDashboard.jsx", "w", encoding="utf-8") as out:
    out.write(file_content)

print(f"Reconstructed exactly. Writes: {writes}, Replaces: {replaces}. Size: {len(file_content)}")
