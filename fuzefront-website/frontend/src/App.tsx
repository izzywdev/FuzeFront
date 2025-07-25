import React from 'react'

function App() {
  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#f0f0f0', 
      padding: '40px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h1 style={{ 
        fontSize: '48px', 
        color: '#333', 
        marginBottom: '20px',
        textAlign: 'center'
      }}>
        🎉 React is Working! 🎉
      </h1>
      <p style={{ 
        fontSize: '24px', 
        color: '#666',
        textAlign: 'center',
        marginBottom: '30px'
      }}>
        This is a minimal React app to test if React mounting works correctly.
      </p>
      <div style={{ 
        backgroundColor: '#4CAF50', 
        color: 'white', 
        padding: '20px',
        borderRadius: '8px',
        textAlign: 'center',
        maxWidth: '600px',
        margin: '0 auto'
      }}>
        <h2 style={{ margin: '0 0 10px 0' }}>Success!</h2>
        <p style={{ margin: '0' }}>
          If you can see this green box, React is mounting and rendering correctly.
          The issue was likely with complex components or dependencies.
        </p>
      </div>
      <div style={{ 
        marginTop: '30px',
        textAlign: 'center',
        fontSize: '18px',
        color: '#888'
      }}>
        <p>Date: {new Date().toLocaleString()}</p>
        <p>React version: {React.version}</p>
      </div>
    </div>
  )
}

export default App
