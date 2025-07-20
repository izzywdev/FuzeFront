import React from 'react'

function App() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-8">
          FuzeFront Website
        </h1>
        <p className="text-lg text-gray-600 mb-8">
          Welcome to the FuzeFront corporate website. This is a test version to isolate rendering issues.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-blue-50 p-6 rounded-lg">
            <h2 className="text-2xl font-semibold text-blue-900 mb-4">Frontend Status</h2>
            <p className="text-blue-700">React application is running successfully!</p>
          </div>
          
          <div className="bg-green-50 p-6 rounded-lg">
            <h2 className="text-2xl font-semibold text-green-900 mb-4">Backend Status</h2>
            <p className="text-green-700">API endpoints are accessible.</p>
            <button 
              className="mt-4 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
              onClick={() => {
                fetch('/api/health')
                  .then(res => res.json())
                  .then(data => alert(JSON.stringify(data, null, 2)))
                  .catch(err => alert('Error: ' + err.message))
              }}
            >
              Test API Health
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App