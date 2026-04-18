import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppProvider } from './contexts/AppContext'
import { AppLayout } from './components/layout/AppLayout'
import './index.css'

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: string|null}> {
  constructor(props: any) {
    super(props)
    this.state = { error: null }
  }
  componentDidCatch(error: any, info: any) {
    this.setState({ error: JSON.stringify({
      message: error?.message,
      stack: error?.stack?.slice(0, 500),
      cause: String(error?.cause),
      component: info?.componentStack?.slice(0, 300)
    }, null, 2)})
  }
  render() {
    if (this.state.error) {
      return <pre style={{padding:20,fontSize:11,color:'red',whiteSpace:'pre-wrap'}}>{this.state.error}</pre>
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <BrowserRouter>
      <AppProvider>
        <AppLayout />
      </AppProvider>
    </BrowserRouter>
  </ErrorBoundary>
)
