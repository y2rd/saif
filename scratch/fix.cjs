const fs = require('fs');
let css = fs.readFileSync('C:/Users/johar/Documents/haider/my-store/src/index.css', 'utf-8');
css = css.replace(/body\.dark-theme \.bg-\\\\\\[\\\\#FCFCFC\\\\\\]/g, 'body.dark-theme .bg-\\[\\#FCFCFC\\]');
css = css.replace(/body\.dark-theme \.bg-\\\\\\[\\\\#f8fafc\\\\\\]/g, 'body.dark-theme .bg-\\[\\#f8fafc\\]');
css = css.replace(/body\.dark-theme \.bg-\\\\\\[\\\\#004956\\\\\\]/g, 'body.dark-theme .bg-\\[\\#004956\\]');
css = css.replace(/body\.dark-theme \.text-\\\\\\[\\\\#004956\\\\\\]/g, 'body.dark-theme .text-\\[\\#004956\\]');
// Actually, let's just do a clean replacement by finding the block and replacing it
css = css.replace(/body\.dark-theme \.bg-\\[\\#FCFCFC\\]/g, 'body.dark-theme .bg-\\[\\#FCFCFC\\]'); // To be safe
fs.writeFileSync('C:/Users/johar/Documents/haider/my-store/src/index.css', css);
