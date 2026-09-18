const fs = require('fs');
const babel = require('@babel/core');

let code = fs.readFileSync('test1.jsx', 'utf8');

// Insert a missing </div> right before the end of the products tab
code = code.replace(/              <\/div>\r?\n          <\/div>\r?\n        \)\}\r?\n\r?\n        \{\/\* ========================================================= \*\/\}\r?\n        \{\/\* 3. قسم إدارة الطلبات/, '              </div>\n            </div>\n          </div>\n        )}\n\n        {/* ========================================================= */}\n        {/* 3. قسم إدارة الطلبات');

fs.writeFileSync('test1.jsx', code);

try {
  babel.transformSync(code, {
    presets: ['@babel/preset-react']
  });
  console.log("No syntax errors!");
} catch (e) {
  console.log("Syntax Error!");
  console.log(e.message);
}
