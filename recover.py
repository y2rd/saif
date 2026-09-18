import json
import re

transcript_path = r"C:\Users\johar\.gemini\antigravity-cli\brain\b354990f-d740-4c01-8eba-29eb6fd5a7fc\.system_generated\logs\transcript_full.jsonl"

file_content = ""

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
                
                if "AdminDashboard.jsx" in target_file:
                    if name == "write_to_file" and args.get("Overwrite"):
                        file_content = args.get("CodeContent", "")
                    elif name == "replace_file_content":
                        target = args.get("TargetContent", "")
                        replacement = args.get("ReplacementContent", "")
                        if target in file_content:
                            file_content = file_content.replace(target, replacement)

with open(r"C:\Users\johar\Documents\haider\my-store\src\AdminDashboard.jsx", "w", encoding="utf-8") as out:
    out.write(file_content)

print(f"Reconstructed AdminDashboard.jsx successfully! Size: {len(file_content)}")
