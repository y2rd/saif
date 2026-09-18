const babel = require('@babel/core');
const fs = require('fs');

const code = fs.readFileSync('original.jsx', 'utf8');

try {
  babel.transformSync(code, {
    presets: ['@babel/preset-react']
  });
  console.log("No syntax errors!");
} catch (e) {
  console.log("Syntax Error!");
  console.log(e.message);
}
