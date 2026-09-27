const XLSX = require('xlsx-js-style');

const catList = ['بطاقات','ألعاب','متفرقات'];
const typeList = ['منتج رقمي','بطاقات رقمية','منتج حسب الطلب','منتج مبادلة','منتج ملموس'];

const wb = XLSX.utils.book_new();

const maxLen = Math.max(catList.length, typeList.length);
const hiddenData = [];
for(let i=0; i<maxLen; i++) {
  hiddenData.push([ catList[i] || '', typeList[i] || '' ]);
}
const wsHidden = XLSX.utils.aoa_to_sheet(hiddenData);
XLSX.utils.book_append_sheet(wb, wsHidden, 'HiddenLists');

const wsData = [
  ['Test']
];
for(let i=1; i<20; i++) wsData.push(['']);
const ws = XLSX.utils.aoa_to_sheet(wsData);

if (!ws['!dataValidations']) ws['!dataValidations'] = [];

ws['!dataValidations'].push({
  type: 'list', 
  formula1: `HiddenLists!$A$1:$A$${catList.length}`,
  allowBlank: true,
  showErrorMessage: true,
  sqref: 'A2:A10'
});

XLSX.utils.book_append_sheet(wb, ws, 'Main');

XLSX.writeFile(wb, 'test_dropdown.xlsx');
console.log('done');
