const fs = require('fs');
let content = fs.readFileSync('src/AdminDashboard.jsx', 'utf8');

const lines = content.split(/\r?\n/);
const start = lines.findIndex(l => l.includes('const handleDownloadProductTemplate = () => {'));
const end = lines.findIndex(l => l.includes('const excelImportRef = useRef(null);'));

const newFunc = `  const handleDownloadProductTemplate = () => {
    // الأقسام من المتجر
    const realCategories = categories.filter(c => c.name !== 'الكل').map(c => c.name);
    const catList = realCategories.length ? realCategories : ['بطاقات','ألعاب','متفرقات'];
    
    // أنواع المنتجات الصحيحة
    const typeList = ['منتج رقمي','بطاقات رقمية','منتج حسب الطلب','منتج مبادلة','منتج ملموس'];

    const HEADER_BG = "004956";
    const NOTES_BG = "F4F4F4";
    const EXAMPLE_BG = "E8F6F0";
    const REQUIRED_BG = "FFF9E6";
    const NORMAL_BG = "FFFFFF";

    const cols = [
      { key: 'A', title: 'اسم المنتج ★', width: 40, bg: REQUIRED_BG, note: 'مطلوب — اسم المنتج كما سيظهر' },
      { key: 'B', title: 'السعر (USD) ★', width: 16, bg: REQUIRED_BG, note: 'مطلوب — رقم مثل: 9.99' },
      { key: 'C', title: 'السعر القديم (USD)', width: 18, bg: NORMAL_BG, note: 'اختياري — يُعرض مشطوباً' },
      { key: 'D', title: 'القسم ★', width: 22, bg: REQUIRED_BG, note: \`اختر من القائمة المنسدلة\` },
      { key: 'E', title: 'نوع المنتج ★', width: 20, bg: REQUIRED_BG, note: \`اختر من القائمة المنسدلة\` },
      { key: 'F', title: 'الكمية في المخزن', width: 18, bg: NORMAL_BG, note: 'رقم صحيح ≥ 0' },
      { key: 'G', title: 'الشارة (Badge)', width: 18, bg: NORMAL_BG, note: 'جديد، خصم، الأفضل' },
      { key: 'H', title: 'وصف المنتج', width: 50, bg: NORMAL_BG, note: 'نص حر للوصف' },
      { key: 'I', title: 'أكواد البطاقات', width: 45, bg: NORMAL_BG, note: 'كود في كل سطر (لنوع بطاقات رقمية)' },
      { key: 'J', title: 'شرائح الكميات', width: 38, bg: NORMAL_BG, note: '1-4:27 | 5-9:25 | 10-∞:23' },
      { key: 'K', title: 'الحد الأدنى للطلب', width: 18, bg: NORMAL_BG, note: 'افتراضي 1' },
      { key: 'L', title: 'اسم المنتج اللي نسلمك', width: 20, bg: NORMAL_BG, note: 'للمبادلة فقط' },
      { key: 'M', title: 'اسم المنتج المطلوب من العميل', width: 30, bg: NORMAL_BG, note: 'للمبادلة فقط' },
      { key: 'N', title: 'الكمية التي نسلمها لكل وحدة', width: 18, bg: NORMAL_BG, note: 'للمبادلة فقط' }
    ];

    const wsData = [
      ['📦  نموذج استيراد المنتجات — المتجر'], // 1
      cols.map(c => c.title), // 2
      cols.map(c => c.note),  // 3
      [ // 4
        'بطاقة iTunes 25$', 27, 30,
        catList[0],
        'بطاقات رقمية', 50, 'جديد',
        'بطاقة أمريكية', 'XXXX-XXXX-XXXX',
        '', 1, '', '', ''
      ]
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws['!cols'] = cols.map(c => ({ wch: c.width }));
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 } }];
    ws['!rows'] = [{ hpt: 36 }, { hpt: 30 }, { hpt: 25 }, { hpt: 30 }];

    const getStyle = (bg, fg = '000000', bold = false, align = 'center') => ({
      fill: { fgColor: { rgb: bg } },
      font: { name: 'Calibri', sz: 11, bold: bold, color: { rgb: fg } },
      alignment: { horizontal: align, vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: 'CCCCCC' } },
        bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
        left: { style: 'thin', color: { rgb: 'CCCCCC' } },
        right: { style: 'thin', color: { rgb: 'CCCCCC' } }
      }
    });

    // ستايل العنوان
    if(ws['A1']) ws['A1'].s = getStyle('003845', 'FFFFFF', true, 'center');
    ws['A1'].s.font.sz = 14;

    for (let c = 0; c < cols.length; c++) {
      const colLetter = XLSX.utils.encode_col(c);
      const headCell = ws[colLetter + '2'];
      if(headCell) headCell.s = getStyle(HEADER_BG, 'FFFFFF', true, 'center');
      const noteCell = ws[colLetter + '3'];
      if(noteCell) noteCell.s = getStyle(NOTES_BG, '777777', false, 'right');
      const exCell = ws[colLetter + '4'];
      if(exCell) exCell.s = getStyle(EXAMPLE_BG, '1A6550', false, 'right');
      
      for(let r = 5; r <= 104; r++) {
        const addr = colLetter + r;
        if(!ws[addr]) ws[addr] = { v: '', t: 's' };
        ws[addr].s = getStyle(cols[c].bg, '000000', false, 'right');
      }
    }

    const wb = XLSX.utils.book_new();

    // ── إنشاء ورقة مرئية للبيانات المرجعية (القوائم المنسدلة) بدلاً من المخفية لتجنب تلف الملف ──
    const maxLen = Math.max(catList.length, typeList.length);
    const hiddenData = [
      ['الأقسام', 'أنواع المنتجات']
    ];
    for(let i=0; i<maxLen; i++) {
      hiddenData.push([ catList[i] || '', typeList[i] || '' ]);
    }
    const wsHidden = XLSX.utils.aoa_to_sheet(hiddenData);
    wsHidden['!cols'] = [{wch:30}, {wch:30}];
    if(wsHidden['A1']) wsHidden['A1'].s = getStyle(HEADER_BG, 'FFFFFF', true, 'center');
    if(wsHidden['B1']) wsHidden['B1'].s = getStyle(HEADER_BG, 'FFFFFF', true, 'center');

    XLSX.utils.book_append_sheet(wb, wsHidden, 'بيانات_مرجعية');

    // إضافة القوائم المنسدلة المرجعية (Data Validation) - تعمل في كل نسخ وإعدادات Excel
    if (!ws['!dataValidations']) ws['!dataValidations'] = [];
    
    ws['!dataValidations'].push({
      type: 'list', 
      formula1: \`بيانات_مرجعية!$A$2:$A$\${catList.length + 1}\`,
      allowBlank: true,
      showErrorMessage: true,
      sqref: 'D5:D104'
    });
    
    ws['!dataValidations'].push({
      type: 'list', 
      formula1: \`بيانات_مرجعية!$B$2:$B$\${typeList.length + 1}\`,
      allowBlank: true,
      showErrorMessage: true,
      sqref: 'E5:E104'
    });

    XLSX.utils.book_append_sheet(wb, ws, 'نموذج المنتجات');

    // دليل الاستخدام
    const guideData = [
      ['📖  دليل استخدام نموذج استيراد المنتجات'],
      ['العمود', 'الوصف', 'مثال'],
      ['اسم المنتج ★', 'اسم المنتج كما سيظهر للعميل في المتجر', 'بطاقة iTunes 25$'],
      ['السعر (USD) ★', 'سعر البيع بالدولار — رقم عشري', '27 أو 9.99'],
      ['السعر القديم (USD)', 'السعر قبل الخصم (لإظهاره مشطوباً) — اتركه فارغاً إن لم يكن هناك خصم', '30.00'],
      ['القسم ★', 'يطابق اسم قسم موجود في المتجر (يُرجى الاختيار من القائمة المنسدلة)', 'بطاقات'],
      ['نوع المنتج ★', 'يجب اختيار أحد الأنواع الصحيحة من القائمة المنسدلة للخلية', 'بطاقات رقمية'],
      ['الكمية في المخزن', 'عدد صحيح للمخزون (للمنتجات غير الرقمية عادة)', '50'],
      ['الشارة (Badge)', 'نص قصير يظهر فوق صورة المنتج', 'جديد | خصم | الأفضل'],
      ['وصف المنتج', 'نص وصفي للمنتج يظهر للعميل', 'بطاقة iTunes أمريكية...'],
      ['أكواد البطاقات', 'للمنتجات (بطاقات رقمية) — ادخل الكود، ولإضافة كود آخر بنفس الخلية اضغط Alt+Enter', 'XXXX-XXXX'],
      ['شرائح الكميات', 'لتسعير الجملة — التنسيق: (الكمية:السعر) وافصل بينها بـ |', '1-4:27 | 5-9:25 | 10-∞:23'],
      ['الحد الأدنى للطلب', 'أقل كمية يمكن للعميل طلبها', '1'],
      ['اسم المنتج اللي نسلمك', 'خاص بمنتجات (منتج مبادلة) - اسم المنتج أو العملة التي تعطيها للعميل', 'نقاط'],
      ['اسم المنتج المطلوب من العميل', 'خاص بمنتجات (منتج مبادلة) - اسم المنتج أو المورد الذي يدفعه العميل لك', 'بطاقة مكافآت'],
      ['الكمية التي نسلمها لكل وحدة', 'خاص بمنتجات (منتج مبادلة) - الكمية التي سيحصل عليها العميل مقابل وحدة واحدة', '5'],
      [],
      ['⚠️ ملاحظات هامة:', '1. الأعمدة التي بجانبها (★) هي أعمدة إلزامية ولا يمكن تركها فارغة.', ''],
      ['', '2. لا تقم بتعديل أسماء الأعمدة في الصف الأول حتى لا تفشل عملية الاستيراد.', ''],
      ['', '3. يرجى عدم حذف ورقة "بيانات_مرجعية" لأنها تشغل القوائم المنسدلة.', '']
    ];
    
    const ws2 = XLSX.utils.aoa_to_sheet(guideData);
    ws2['!cols'] = [{wch:25}, {wch:65}, {wch:25}];
    ws2['!merges'] = [
      {s:{r:0,c:0}, e:{r:0,c:2}},
      {s:{r:17,c:1}, e:{r:17,c:2}},
      {s:{r:18,c:1}, e:{r:18,c:2}},
      {s:{r:19,c:1}, e:{r:19,c:2}}
    ];
    
    if(ws2['A1']) ws2['A1'].s = getStyle('003845', 'FFFFFF', true, 'center');
    for(let i=0; i<3; i++) {
       const cell = ws2[XLSX.utils.encode_col(i) + '2'];
       if(cell) cell.s = getStyle(HEADER_BG, 'FFFFFF', true, 'center');
    }

    // تلوين الجدول
    for(let r=3; r<=16; r++) {
      const isAlt = r % 2 === 0;
      const rowBg = isAlt ? 'F0F9F7' : 'FFFFFF';
      for(let c=0; c<3; c++) {
        const addr = XLSX.utils.encode_col(c) + r;
        if(ws2[addr]) ws2[addr].s = getStyle(rowBg, '111111', c===0, 'right');
      }
    }
    
    // تلوين الملاحظات
    for(let r=18; r<=20; r++) {
      for(let c=0; c<3; c++) {
        const addr = XLSX.utils.encode_col(c) + r;
        if(ws2[addr]) ws2[addr].s = getStyle('FFF8E1', '7B5800', r===18 && c===0, 'right');
      }
    }

    XLSX.utils.book_append_sheet(wb, ws2, 'دليل الاستخدام');

    XLSX.writeFile(wb, 'نموذج_استيراد_المنتجات.xlsx');
    showToast(\`✅ تم تحميل النموذج الملون مع \${realCategories.length} قسم والقوائم المنسدلة تعمل\`);
  };`;

const finalLines = [...lines.slice(0, start), newFunc, ...lines.slice(end)];
fs.writeFileSync('src/AdminDashboard.jsx', finalLines.join('\n'), 'utf8');
