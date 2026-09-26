const fs = require('fs');
const css = `
/* ========================================================================= */
/* الوضع الليلي (Dark Mode) - تجاوز شامل للعناصر في الموقع                     */
/* ========================================================================= */
body.dark-theme {
  background-color: #0b1220 !important;
  color: #e2e8f0 !important;
}
body.dark-theme .bg-white,
body.dark-theme .bg-[#FCFCFC],
body.dark-theme .bg-gray-50,
body.dark-theme .bg-[#f8fafc] {
  background-color: #111827 !important;
  color: #e2e8f0 !important;
}
body.dark-theme .text-gray-900,
body.dark-theme .text-gray-800,
body.dark-theme .text-gray-700,
body.dark-theme .text-black,
body.dark-theme h1, body.dark-theme h2, body.dark-theme h3, body.dark-theme h4, 
body.dark-theme span:not(.text-white):not(.text-red-700):not(.text-teal-700):not(.text-teal-900):not(.text-yellow-500):not(.text-red-500) {
  color: #e2e8f0 !important;
}
body.dark-theme .text-gray-600,
body.dark-theme .text-gray-500,
body.dark-theme .text-gray-400 {
  color: #94a3b8 !important;
}
body.dark-theme .border-gray-100,
body.dark-theme .border-gray-200,
body.dark-theme .border-gray-300,
body.dark-theme .border-gray-100\\/80,
body.dark-theme .border-gray-200\\/80,
body.dark-theme .border-gray-200\\/60,
body.dark-theme .border-t,
body.dark-theme .border-b,
body.dark-theme .border {
  border-color: #1f2937 !important;
}
body.dark-theme .card-soft-blur,
body.dark-theme .s-product-card-entry {
  background-color: #111827 !important;
  border-color: #1f2937 !important;
}
body.dark-theme .header-soft-blur,
body.dark-theme .topbar-soft-blur {
  background-color: rgba(17, 24, 39, 0.95) !important;
}
body.dark-theme .search-soft-blur {
  background-color: #1f2937 !important;
  color: #e2e8f0 !important;
}
body.dark-theme .search-soft-blur:focus-within {
  background-color: #374151 !important;
}
body.dark-theme .btn-soft-blur {
  background-color: #1f2937 !important;
  color: #e2e8f0 !important;
}
body.dark-theme .btn-soft-blur:hover {
  background-color: #374151 !important;
}
body.dark-theme .btn-add-to-cart {
  background-color: #1f2937 !important;
  color: #e2e8f0 !important;
  border-color: #374151 !important;
}
body.dark-theme .btn-add-to-cart:hover {
  background-color: #374151 !important;
}
body.dark-theme .btn-add-to-cart * {
  color: #e2e8f0 !important;
}
body.dark-theme .text-teal-900 {
  color: #5eead4 !important;
}
body.dark-theme .text-teal-700 {
  color: #2dd4bf !important;
}
body.dark-theme .bg-teal-50\\/60,
body.dark-theme .bg-teal-100\\/60 {
  background-color: rgba(17, 94, 89, 0.25) !important;
  border-color: #134e4a !important;
}
body.dark-theme .bg-[#004956] {
  background-color: #007a8f !important;
}
body.dark-theme .text-[#004956] {
  color: #00b5d8 !important;
}
body.dark-theme .store-feature-icon-wrapper i,
body.dark-theme .store-feature-icon-wrapper {
  color: #e2e8f0 !important;
}
body.dark-theme input, body.dark-theme textarea, body.dark-theme select {
  background-color: #111827 !important;
  color: #e2e8f0 !important;
  border-color: #374151 !important;
}
`;
fs.appendFileSync('C:/Users/johar/Documents/haider/my-store/src/index.css', css);
