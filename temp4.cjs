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
      { key: 'L', title: 'عملة الاستبدال', width: 20, bg: NORMAL_BG, note: 'للمبادلة فقط' },
      { key: 'M', title: 'منتج الاستبدال المطلوب', width: 30, bg: NORMAL_BG, note: 'للمبادلة فقط' },
      { key: 'N', title: 'كمية الاستبدال', width: 18, bg: NORMAL_BG, note: 'للمبادلة فقط' }
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

    // ── إنشاء ورقة مخفية للبيانات المرجعية (القوائم المنسدلة) ──
    const maxLen = Math.max(catList.length, typeList.length);
    const hiddenData = [];
    for(let i=0; i<maxLen; i++) {
      hiddenData.push([ catList[i] || '', typeList[i] || '' ]);
    }
    const wsHidden = XLSX.utils.aoa_to_sheet(hiddenData);
    XLSX.utils.book_append_sheet(wb, wsHidden, 'HiddenLists');
    // إخفاء الورقة تماماً حتى لا تزعج المستخدم
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.Views = wb.Workbook.Views || [];
    wb.Workbook.Views.push({});
    wb.Workbook.Sheets = wb.Workbook.Sheets || [];
    wb.Workbook.Sheets[0] = { Hidden: 1 }; // Hide the HiddenLists sheet (index will be fixed when added)

    // إضافة القوائم المنسدلة المرجعية (Data Validation) - تعمل في كل نسخ وإعدادات Excel
    if (!ws['!dataValidations']) ws['!dataValidations'] = [];
    
    ws['!dataValidations'].push({
      type: 'list', 
      formula1: \`HiddenLists!$A$1:$A$\${catList.length}\`,
      allowBlank: true,
      showDropDown: true,
      showErrorMessage: true,
      sqref: 'D5:D104'
    });
    
    ws['!dataValidations'].push({
      type: 'list', 
      formula1: \`HiddenLists!$B$1:$B$\${typeList.length}\`,
      allowBlank: true,
      showDropDown: true,
      showErrorMessage: true,
      sqref: 'E5:E104'
    });

    XLSX.utils.book_append_sheet(wb, ws, 'نموذج المنتجات');

    // إخفاء الورقة الأولى (HiddenLists) لتكون نظيفة
    if(!wb.Workbook.Sheets[0]) wb.Workbook.Sheets[0] = { Hidden: 1 };

    // دليل الاستخدام
    const guideData = [
      ['📖  دليل استخدام نموذج استيراد المنتجات'],
      ['العمود', 'الوصف', 'مثال'],
      ['اسم المنتج ★', 'اسم المنتج', 'بطاقة iTunes'],
      ['نوع المنتج ★', \`مهم جداً: اختر أحد هذه الأنواع من القائمة المنسدلة: \${typeList.join(' أو ')}\`, 'بطاقات رقمية'],
      ['ملاحظة مهمة', 'لا تعدّل صف العناوين أو تحذفه!', '']
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(guideData);
    ws2['!cols'] = [{wch:25}, {wch:65}, {wch:25}];
    ws2['!merges'] = [{s:{r:0,c:0}, e:{r:0,c:2}}];
    
    if(ws2['A1']) ws2['A1'].s = getStyle('003845', 'FFFFFF', true, 'center');
    for(let i=0; i<3; i++) {
       const cell = ws2[XLSX.utils.encode_col(i) + '2'];
       if(cell) cell.s = getStyle(HEADER_BG, 'FFFFFF', true, 'center');
    }

    XLSX.utils.book_append_sheet(wb, ws2, 'دليل الاستخدام');

    XLSX.writeFile(wb, 'نموذج_استيراد_المنتجات.xlsx');
    showToast(\`✅ تم تحميل النموذج الملون مع \${realCategories.length} قسم حقيقي والقوائم المنسدلة تعمل\`);
  };`;

const finalLines = [...lines.slice(0, start), newFunc, ...lines.slice(end)];
fs.writeFileSync('src/AdminDashboard.jsx', finalLines.join('\n'), 'utf8');
