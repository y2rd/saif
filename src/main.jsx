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
          {this.state.error && (
            <pre style={{ fontSize: '11px', color: '#c00', background: '#fff0f0', padding: '8px', borderRadius: '6px', direction: 'ltr', textAlign: 'left', overflow: 'auto', maxWidth: '600px', margin: '0 auto 16px auto' }}>
              {this.state.error.toString()}
            </pre>
          )}
          <button 
            onClick={() => {
              try { localStorage.clear(); } catch(e){}
              window.location.reload();
            }}
            style={{ padding: '10px 20px', background: '#004956', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            إعادة المحاولة ومسح الكاش
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
);
if (typeof window !== 'undefined') {
  window.__appLoaded = true;
}

