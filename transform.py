import re

path = "AdminDashboard_extracted.js"
with open(path, "r", encoding="utf-8") as f:
    c = f.read()

# Replace React hooks
c = re.sub(r"\(0, l\.(use[A-Za-z]+)\)", r"\1", c)

# Replace JSX
c = c.replace("(0, $.jsxs)", "jsxs")
c = c.replace("(0, $.jsx)", "jsx")
c = c.replace("$.Fragment", "Fragment")

# Add imports
imports = '''import React, { useState, useEffect, useMemo, useRef } from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
'''

c = imports + "\nexport default " + c

with open(r"C:\Users\johar\Documents\haider\my-store\src\AdminDashboard.jsx", "w", encoding="utf-8") as out:
    out.write(c)
print("Saved transformed component to AdminDashboard.jsx")
