const fs = require('fs');
const content = fs.readFileSync('src/AdminDashboard.jsx', 'utf8');
const lines = content.split(/\r?\n/);
const newFunc = `  const handleDownloadProductTemplate = async () => {
    // ─── الأقسام الحقيقية من المتجر ───────────────────────────────────────
    const realCategories = categories
      .filter(c => c.name !== 'الكل')
      .map(c => c.name);
    const catList  = realCategories.length ? realCategories : ['بطاقات', 'ألعاب', 'متفرقات'];
    const typeList = ['رقمي', 'مادي', 'استبدال'];

    // ── تعريف الأعمدة ──────────────────────────────────────────────────────
    const COLS = [
      { title: 'اسم المنتج ★',            width: 38, bg: 'FFFDE7', note: 'مطلوب — اسم المنتج كما سيظهر للعميل' },
      { title: 'السعر (USD) ★',           width: 15, bg: 'FFFDE7', note: 'مطلوب — رقم مثل: 9.99' },
      { title: 'السعر القديم (USD)',       width: 18, bg: 'FFFFFF', note: 'اختياري — يُعرض مشطوباً لإظهار الخصم' },
      { title: 'القسم ★',                 width: 22, bg: 'FFFDE7', note: \`مطلوب — اختر: \${catList.join(' | ')}\` },
      { title: 'نوع المنتج ★',            width: 16, bg: 'FFFDE7', note: 'رقمي | مادي | استبدال' },
      { title: 'الكمية في المخزن',        width: 18, bg: 'FFFFFF', note: 'رقم صحيح ≥ 0' },
      { title: 'الشارة (Badge)',           width: 18, bg: 'FFFFFF', note: 'نص قصير: جديد، خصم، الأفضل' },
      { title: 'وصف المنتج',             width: 48, bg: 'FFFFFF', note: 'نص وصفي للمنتج' },
      { title: 'أكواد البطاقات',          width: 42, bg: 'EEF2FF', note: 'للمنتجات الرقمية — كود في كل سطر (Alt+Enter)' },
      { title: 'شرائح الكميات',          width: 36, bg: 'FFF5F0', note: 'مثال: 1-4:27 | 5-9:25 | 10-∞:23' },
      { title: 'الحد الأدنى للطلب',      width: 18, bg: 'FFFFFF', note: 'رقم صحيح — افتراضي 1' },
      { title: 'عملة الاستبدال',         width: 20, bg: 'FFFFFF', note: 'للاستبدال فقط' },
      { title: 'منتج الاستبدال المطلوب', width: 30, bg: 'FFFFFF', note: 'للاستبدال فقط' },
      { title: 'كمية الاستبدال',         width: 18, bg: 'FFFFFF', note: 'للاستبدال فقط' },
    ];

    const wb = new ExcelJS.Workbook();
    wb.creator = 'My Store';

    // ══════════════════════════════════════════════════════════════════════
    // الورقة 1: نموذج المنتجات
    // ══════════════════════════════════════════════════════════════════════
    const ws = wb.addWorksheet('نموذج المنتجات', {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }],
    });

    ws.columns = COLS.map(c => ({ width: c.width }));

    const thinBorder = (color = 'CCCCCC') => ({
      top:    { style: 'thin', color: { argb: \`FF\${color}\` } },
      bottom: { style: 'thin', color: { argb: \`FF\${color}\` } },
      left:   { style: 'thin', color: { argb: \`FF\${color}\` } },
      right:  { style: 'thin', color: { argb: \`FF\${color}\` } },
    });

    const applyCell = (cell, {
      value = '', bg = 'FFFFFF', fg = '000000',
      bold = false, italic = false, sz = 11,
      hAlign = 'right', wrap = true, border = true
    }) => {
      cell.value = value;
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: \`FF\${bg}\` } };
      cell.font  = { name: 'Calibri', size: sz, bold, italic, color: { argb: \`FF\${fg}\` } };
      cell.alignment = { horizontal: hAlign, vertical: 'middle', wrapText: wrap, readingOrder: 2 };
      if (border) cell.border = thinBorder();
    };

    // الصف 1
    ws.mergeCells(1, 1, 1, COLS.length);
    applyCell(ws.getCell(1, 1), {
      value: '📦  نموذج استيراد المنتجات',
      bg: '003845', fg: 'FFFFFF', bold: true, sz: 16,
      hAlign: 'center', border: false, wrap: false
    });
    ws.getRow(1).height = 42;

    // الصف 2
    ws.getRow(2).height = 38;
    COLS.forEach((col, i) => {
      applyCell(ws.getCell(2, i + 1), {
        value: col.title, bg: '004956', fg: 'FFFFFF', bold: true, sz: 12, hAlign: 'center',
      });
    });

    // الصف 3
    ws.getRow(3).height = 28;
    COLS.forEach((col, i) => {
      applyCell(ws.getCell(3, i + 1), { value: col.note, bg: 'F5F5F5', fg: '777777', italic: true, sz: 9 });
    });

    // الصف 4: مثال
    ws.getRow(4).height = 44;
    const exValues = [
      'بطاقة iTunes 25$', 27, 30, catList[0], 'رقمي', 50, 'جديد',
      'بطاقة iTunes أمريكية بقيمة 25 دولار', 'XXXX-XXXX-XXXX\\nYYYY-YYYY-YYYY',
      '1-4:27 | 5-9:25 | 10-∞:23', 1, '', '', ''
    ];
    exValues.forEach((val, i) => {
      applyCell(ws.getCell(4, i + 1), { value: val, bg: 'E8F6F0', fg: '1A6550', sz: 11 });
    });

    // الصفوف 5-104
    for (let r = 5; r <= 104; r++) {
      ws.getRow(r).height = 26;
      COLS.forEach((col, i) => {
        applyCell(ws.getCell(r, i + 1), { value: '', bg: col.bg, fg: '111111' });
      });
    }

    // Data validation
    ws.getColumn(4).eachCell({ includeEmpty: false }, () => {});
    for (let r = 5; r <= 104; r++) {
      ws.getCell(r, 4).dataValidation = {
        type: 'list', allowBlank: true, formulae: [\`"\${catList.join(',')}"\`],
        showErrorMessage: true, errorTitle: 'قسم غير صحيح', error: \`الأقسام المتاحة: \${catList.join(' | ')}\`
      };
      ws.getCell(r, 5).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['"رقمي,مادي,استبدال"'],
        showErrorMessage: true, errorTitle: 'نوع غير صحيح', error: 'رقمي | مادي | استبدال'
      };
    }

    // ══════════════════════════════════════════════════════════════════════
    // الورقة 2: دليل الاستخدام
    // ══════════════════════════════════════════════════════════════════════
    const ws2 = wb.addWorksheet('دليل الاستخدام', { views: [{ rightToLeft: true }] });
    ws2.columns = [{ width: 28 }, { width: 55 }, { width: 45 }];

    ws2.mergeCells('A1:C1');
    applyCell(ws2.getCell('A1'), {
      value: '📖  دليل استخدام نموذج استيراد المنتجات', bg: '003845', fg: 'FFFFFF', bold: true, sz: 14, hAlign: 'center', wrap: false
    });
    ws2.getRow(1).height = 36;

    ['العمود', 'الوصف', 'قيم مقبولة / مثال'].forEach((h, i) => {
      applyCell(ws2.getCell(2, i + 1), { value: h, bg: '004956', fg: 'FFFFFF', bold: true, sz: 12, hAlign: 'center' });
    });
    ws2.getRow(2).height = 30;

    const guide = [
      ['اسم المنتج ★', 'اسم المنتج كما سيظهر للعميل في المتجر', 'بطاقة iTunes 25$'],
      ['السعر (USD) ★', 'سعر البيع بالدولار — رقم عشري مقبول', '27 أو 9.99'],
      ['السعر القديم (USD)', 'السعر قبل الخصم — اتركه فارغاً إن لم يكن هناك خصم', '30.00'],
      ['القسم ★', 'يطابق اسم قسم موجود في المتجر', catList.join(' | ')],
      ['نوع المنتج ★', 'اختر من القائمة المنسدلة في الخلية', 'رقمي | مادي | استبدال'],
      ['الكمية في المخزن', 'عدد صحيح ≥ 0', '50'],
      ['الشارة (Badge)', 'نص قصير يظهر فوق صورة المنتج', 'جديد | خصم | الأفضل'],
      ['وصف المنتج', 'نص وصفي للمنتج يظهر في صفحة التفاصيل', 'بطاقة iTunes أمريكية...'],
      ['أكواد البطاقات', 'للمنتجات الرقمية — كود في كل سطر (Alt+Enter)', 'XXXX-XXXX-XXXX'],
      ['شرائح الكميات', 'لتسعير الجملة — افصل الشرائح بـ |', '1-4:27 | 5-9:25 | 10-∞:23'],
      ['الحد الأدنى للطلب', 'أقل كمية يمكن للعميل طلبها', '1'],
      ['عملة الاستبدال', 'للاستبدال فقط', 'نقاط'],
      ['منتج الاستبدال المطلوب', 'للاستبدال فقط', 'بطاقة مكافآت'],
      ['كمية الاستبدال', 'للاستبدال فقط', '5']
    ];
    guide.forEach(([col, desc, ex], idx) => {
      const r = idx + 3;
      const bg = idx % 2 === 0 ? 'F0F9F7' : 'FFFFFF';
      ws2.getRow(r).height = 28;
      [col, desc, ex].forEach((v, ci) => {
        applyCell(ws2.getCell(r, ci + 1), { value: v, bg, fg: '111111', bold: ci === 0, sz: 11 });
      });
    });

    const noteR = guide.length + 3;
    ws2.mergeCells(noteR, 1, noteR + 2, 3);
    applyCell(ws2.getCell(noteR, 1), {
      value: '⚠️  ملاحظات مهمة:\\n1. لا تحذف أو تعدّل صف العناوين.\\n2. الأعمدة ذات العلامة ★ إلزامية.\\n3. احفظ بصيغة .xlsx قبل الرفع.',
      bg: 'FFF8E1', fg: '7B5800', bold: false, sz: 11, hAlign: 'right', wrap: true, border: true
    });
    ws2.getRow(noteR).height = 80;

    // تحميل
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'نموذج_استيراد_المنتجات.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(\`✅ تم تحميل النموذج مع \${catList.length} قسم حقيقي\`);
  };`;
  
const newLines = [...lines.slice(0, 1118), newFunc, ...lines.slice(1295)];
fs.writeFileSync('src/AdminDashboard.jsx', newLines.join('\n'), 'utf8');
