import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fortawesome/fontawesome-free/css/all.min.css'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Critical App Error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '24px', textAlign: 'center', fontFamily: 'sans-serif', direction: 'rtl' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>حدث خطأ أثناء تحميل التطبيق</h2>
          <p style={{ fontSize: '13px', color: '#666', marginBottom: '16px' }}>يرجى إعادة تشغيل التطبيق أو مسح الذاكرة المؤقتة.</p>
          <button 
            onClick={() => {
              try { localStorage.clear(); } catch(e){}
              window.location.reload();
            }}
            style={{ padding: '10px 20px', background: '#004956', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            إعادة المحاولة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
