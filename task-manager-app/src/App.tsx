import React, { useState, useEffect } from 'react'
import './App.css'

// Simple heartbeat implementation for the task manager
const sendHeartbeat = async (
  appId: string,
  status: 'online' | 'offline' = 'online'
) => {
  try {
    const response = await fetch(
      `http://localhost:3001/api/apps/${appId}/heartbeat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status,
          metadata: {
            version: '1.0.0',
            port: 3002,
            timestamp: new Date().toISOString(),
          },
        }),
      }
    )

    if (response.ok) {
      const result = await response.json()
      console.log(`💓 Task Manager heartbeat sent: ${status}`, result)
    } else {
      console.warn(`❌ Failed to send heartbeat: ${response.status}`)
    }
  } catch (error) {
    console.warn('❌ Heartbeat failed:', error)
  }
}

interface Task {
  id: string
  title: string
  description: string
  completed: boolean
  priority: 'low' | 'medium' | 'high'
  dueDate: string
  createdAt: string
}

// Health check component for the /healthy route
function HealthCheck() {
  useEffect(() => {
    // Return JSON response for health check
    const sendHealthResponse = () => {
      if (window.location.pathname === '/healthy') {
        // For iframe integration, we can use postMessage to communicate health status
        window.parent.postMessage(
          { type: 'HEALTH_CHECK', status: 'healthy' },
          '*'
        )

        // Also update the document to show health status
        document.body.innerHTML = `
          <div style="
            display: flex; 
            justify-content: center; 
            align-items: center; 
            height: 100vh; 
            background: #0f0f23; 
            color: #6bcf7f; 
            font-family: monospace;
            font-size: 18px;
          ">
            <div style="text-align: center;">
              <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
              <div>Task Manager is healthy</div>
              <div style="font-size: 14px; color: #888; margin-top: 8px;">
                Status: OK | Port: 3002
              </div>
            </div>
          </div>
        `
      }
    }

    sendHealthResponse()
  }, [])

  return null
}

function App() {
  // Check if we're on the health check route
  if (window.location.pathname === '/healthy') {
    return <HealthCheck />
  }

  const [tasks, setTasks] = useState<Task[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all')
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium' as const,
    dueDate: '',
  })

  // Task Manager App ID from the database
  const APP_ID = 'f0e9b957-5e89-456e-a768-f2166932a725'

  // Initialize heartbeat when app loads
  useEffect(() => {
    // Send initial heartbeat
    sendHeartbeat(APP_ID, 'online')

    // Set up periodic heartbeats every 30 seconds
    const heartbeatInterval = setInterval(() => {
      sendHeartbeat(APP_ID, 'online')
    }, 30000)

    // Send offline status when app unloads
    const handleBeforeUnload = () => {
      sendHeartbeat(APP_ID, 'offline')
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    // Cleanup
    return () => {
      clearInterval(heartbeatInterval)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      sendHeartbeat(APP_ID, 'offline')
    }
  }, [])

  // Load tasks from localStorage on mount
  useEffect(() => {
    const savedTasks = localStorage.getItem('taskManager_tasks')
    if (savedTasks) {
      setTasks(JSON.parse(savedTasks))
    }
  }, [])

  // Save tasks to localStorage whenever tasks change
  useEffect(() => {
    localStorage.setItem('taskManager_tasks', JSON.stringify(tasks))
  }, [tasks])

  const addTask = () => {
    if (!newTask.title.trim()) return

    const task: Task = {
      id: Date.now().toString(),
      title: newTask.title,
      description: newTask.description,
      completed: false,
      priority: newTask.priority,
      dueDate: newTask.dueDate,
      createdAt: new Date().toISOString(),
    }

    setTasks(prev => [task, ...prev])
    setNewTask({ title: '', description: '', priority: 'medium', dueDate: '' })
    setShowAddForm(false)
  }

  const toggleTask = (id: string) => {
    setTasks(prev =>
      prev.map(task =>
        task.id === id ? { ...task, completed: !task.completed } : task
      )
    )
  }

  const deleteTask = (id: string) => {
    setTasks(prev => prev.filter(task => task.id !== id))
  }

  const filteredTasks = tasks.filter(task => {
    if (filter === 'pending') return !task.completed
    if (filter === 'completed') return task.completed
    return true
  })

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return '#ff6b6b'
      case 'medium':
        return '#ffd93d'
      case 'low':
        return '#6bcf7f'
      default:
        return '#888'
    }
  }

  return (
    <div className="task-manager">
      <header className="header">
        <h1>�� Task Manager</h1>
        <p>Manage your tasks efficiently</p>
      </header>

      <div className="controls">
        <div className="filter-buttons">
          <button
            className={filter === 'all' ? 'active' : ''}
            onClick={() => setFilter('all')}
          >
            All ({tasks.length})
          </button>
          <button
            className={filter === 'pending' ? 'active' : ''}
            onClick={() => setFilter('pending')}
          >
            Pending ({tasks.filter(t => !t.completed).length})
          </button>
          <button
            className={filter === 'completed' ? 'active' : ''}
            onClick={() => setFilter('completed')}
          >
            Completed ({tasks.filter(t => t.completed).length})
          </button>
        </div>

        <button
          className="add-button"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          ➕ Add Task
        </button>
      </div>

      {showAddForm && (
        <div className="add-form">
          <h3>Add New Task</h3>
          <input
            type="text"
            placeholder="Task title..."
            value={newTask.title}
            onChange={e =>
              setNewTask(prev => ({ ...prev, title: e.target.value }))
            }
          />
          <textarea
            placeholder="Task description..."
            value={newTask.description}
            onChange={e =>
              setNewTask(prev => ({ ...prev, description: e.target.value }))
            }
          />
          <div className="form-row">
            <select
              value={newTask.priority}
              onChange={e =>
                setNewTask(prev => ({
                  ...prev,
                  priority: e.target.value as any,
                }))
              }
            >
              <option value="low">Low Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="high">High Priority</option>
            </select>
            <input
              type="date"
              value={newTask.dueDate}
              onChange={e =>
                setNewTask(prev => ({ ...prev, dueDate: e.target.value }))
              }
            />
          </div>
          <div className="form-actions">
            <button onClick={addTask} className="save-button">
              Save Task
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="cancel-button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="tasks-container">
        {filteredTasks.length === 0 ? (
          <div className="empty-state">
            <h3>No tasks found</h3>
            <p>
              {filter === 'all'
                ? 'Add your first task to get started!'
                : `No ${filter} tasks at the moment.`}
            </p>
          </div>
        ) : (
          <div className="tasks-list">
            {filteredTasks.map(task => (
              <div
                key={task.id}
                className={`task-card ${task.completed ? 'completed' : ''}`}
              >
                <div className="task-header">
                  <div className="task-title-section">
                    <input
                      type="checkbox"
                      checked={task.completed}
                      onChange={() => toggleTask(task.id)}
                    />
                    <h4 className={task.completed ? 'strikethrough' : ''}>
                      {task.title}
                    </h4>
                  </div>
                  <div className="task-actions">
                    <span
                      className="priority-badge"
                      style={{
                        backgroundColor: getPriorityColor(task.priority),
                      }}
                    >
                      {task.priority}
                    </span>
                    <button
                      className="delete-button"
                      onClick={() => deleteTask(task.id)}
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                {task.description && (
                  <p className="task-description">{task.description}</p>
                )}

                <div className="task-meta">
                  {task.dueDate && (
                    <span className="due-date">
                      📅 Due: {new Date(task.dueDate).toLocaleDateString()}
                    </span>
                  )}
                  <span className="created-date">
                    Created: {new Date(task.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
