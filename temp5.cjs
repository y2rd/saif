const fs = require('fs');
let content = fs.readFileSync('src/AdminDashboard.jsx', 'utf8');

// Export mapping
content = content.replace(/'عملة الاستبدال'/g, "'اسم المنتج اللي نسلمك'");
content = content.replace(/'منتج الاستبدال المطلوب'/g, "'اسم المنتج المطلوب من العميل'");
content = content.replace(/'كمية الاستبدال'/g, "'الكمية التي نسلمها لكل وحدة'");

// Template columns
content = content.replace(/title: 'عملة الاستبدال'/g, "title: 'اسم المنتج اللي نسلمك'");
content = content.replace(/title: 'منتج الاستبدال المطلوب'/g, "title: 'اسم المنتج المطلوب من العميل'");
content = content.replace(/title: 'كمية الاستبدال'/g, "title: 'الكمية التي نسلمها لكل وحدة'");

// Guide data
content = content.replace(/\['عملة الاستبدال',/g, "['اسم المنتج اللي نسلمك',");
content = content.replace(/\['منتج الاستبدال المطلوب',/g, "['اسم المنتج المطلوب من العميل',");
content = content.replace(/\['كمية الاستبدال',/g, "['الكمية التي نسلمها لكل وحدة',");

// Optional: fix guide text
content = content.replace(/اسم عملة الموقع/g, "اسم المنتج أو العملة التي تعطيها للعميل");
content = content.replace(/اسم المنتج المطلوب للتبديل/g, "اسم المنتج أو المورد الذي يدفعه العميل لك");
content = content.replace(/كمية المنتج المطلوب/g, "الكمية التي سيحصل عليها العميل مقابل وحدة واحدة");

fs.writeFileSync('src/AdminDashboard.jsx', content, 'utf8');
