path = r"C:\Users\johar\Documents\haider\my-store\src\AdminDashboard.jsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

def check_balance():
    stack = []
    lines = content.splitlines()
    for i, line in enumerate(lines):
        for j, char in enumerate(line):
            if char in "{[(":
                stack.append((char, i, j))
            elif char in "}])":
                if not stack:
                    return f"Unmatched {char} at line {i+1}:{j+1}"
                top, ti, tj = stack.pop()
                pairs = {"}":"{", "]":"[", ")":"("}
                if pairs[char] != top:
                    return f"Mismatched {char} at line {i+1}:{j+1} (expected {pairs[char]} but got {top} from line {ti+1}:{tj+1})"
    if stack:
        top, ti, tj = stack.pop()
        return f"Unclosed {top} from line {ti+1}:{tj+1}"
    return "Balanced!"

print(check_balance())
