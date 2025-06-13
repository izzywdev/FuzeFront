import React, { useState, useEffect } from 'react'
import { PlatformProvider, useCurrentUser, useGlobalMenu } from './lib/sdk'
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
  userId?: string // Add userId to associate tasks with users
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

function TaskManagerApp() {
  const { user, isAuthenticated } = useCurrentUser()
  const { addAppMenuItems, removeAppMenuItems } = useGlobalMenu()
  const [tasks, setTasks] = useState<Task[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all')
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
    dueDate: '',
  })

  // Task Manager App ID from the database
  const APP_ID = 'f0e9b957-5e89-456e-a768-f2166932a725'

  // Register app-specific menu items when component mounts
  useEffect(() => {
    const menuItems = [
      {
        id: 'tasks-all',
        label: 'All Tasks',
        icon: '📋',
        action: () => setFilter('all'),
        order: 1,
      },
      {
        id: 'tasks-pending',
        label: 'Pending Tasks',
        icon: '⏳',
        action: () => setFilter('pending'),
        order: 2,
      },
      {
        id: 'tasks-completed',
        label: 'Completed Tasks',
        icon: '✅',
        action: () => setFilter('completed'),
        order: 3,
      },
      {
        id: 'tasks-add',
        label: 'Add Task',
        icon: '➕',
        action: () => setShowAddForm(true),
        order: 4,
      },
    ]

    // Register menu items
    if (addAppMenuItems) {
      addAppMenuItems(APP_ID, menuItems)
      console.log('📋 Task Manager menu items registered')
    }

    // Cleanup function to remove menu items when component unmounts
    return () => {
      if (removeAppMenuItems) {
        removeAppMenuItems(APP_ID)
        console.log('📋 Task Manager menu items removed')
      }
    }
  }, [addAppMenuItems, removeAppMenuItems])

  // Listen for cleanup events from platform
  useEffect(() => {
    const handleMenuCleanup = (event: CustomEvent) => {
      if (event.detail.appId === APP_ID && removeAppMenuItems) {
        removeAppMenuItems(APP_ID)
        console.log('📋 Task Manager menu items cleaned up via event')
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener(
        'app-menu-cleanup',
        handleMenuCleanup as EventListener
      )

      return () => {
        window.removeEventListener(
          'app-menu-cleanup',
          handleMenuCleanup as EventListener
        )
      }
    }
  }, [removeAppMenuItems])

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

  // Load user-specific tasks from localStorage
  useEffect(() => {
    if (user) {
      const storageKey = `taskManager_tasks_${user.id}`
      const savedTasks = localStorage.getItem(storageKey)
      if (savedTasks) {
        setTasks(JSON.parse(savedTasks))
      }
    }
  }, [user])

  // Save tasks to localStorage whenever tasks change
  useEffect(() => {
    if (user) {
      const storageKey = `taskManager_tasks_${user.id}`
      localStorage.setItem(storageKey, JSON.stringify(tasks))
    }
  }, [tasks, user])

  const addTask = () => {
    if (!newTask.title.trim() || !user) return

    const task: Task = {
      id: Date.now().toString(),
      title: newTask.title,
      description: newTask.description,
      completed: false,
      priority: newTask.priority,
      dueDate: newTask.dueDate,
      createdAt: new Date().toISOString(),
      userId: user.id,
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

  const getUserDisplayName = () => {
    if (!user) return 'Guest User'
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`
    }
    if (user.firstName) {
      return user.firstName
    }
    return user.email
  }

  return (
    <div className="task-manager">
      <header className="header">
        <div>
          <h1>📋 Task Manager</h1>
          {isAuthenticated && user ? (
            <div className="user-info">
              <span className="welcome-text">
                Welcome back, <strong>{getUserDisplayName()}</strong>! 👋
              </span>
              <div className="user-details">
                <small>
                  📧 {user.email} |
                  {user.roles.includes('admin') ? ' 👑 Admin' : ' 👤 User'} | 📊{' '}
                  {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
                </small>
              </div>
            </div>
          ) : (
            <div className="user-info">
              <span className="welcome-text">
                👤 Not authenticated - running in standalone mode
              </span>
            </div>
          )}
        </div>
        <div className="header-actions">
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
      </header>

      {showAddForm && (
        <div className="add-form">
          <h3>Add New Task</h3>
          <input
            type="text"
            placeholder="Task title"
            value={newTask.title}
            onChange={e => setNewTask({ ...newTask, title: e.target.value })}
          />
          <textarea
            placeholder="Task description"
            value={newTask.description}
            onChange={e =>
              setNewTask({ ...newTask, description: e.target.value })
            }
          />
          <div className="form-row">
            <select
              value={newTask.priority}
              onChange={e =>
                setNewTask({
                  ...newTask,
                  priority: e.target.value as 'low' | 'medium' | 'high',
                })
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
                setNewTask({ ...newTask, dueDate: e.target.value })
              }
            />
          </div>
          <div className="form-actions">
            <button onClick={addTask}>Add Task</button>
            <button onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="task-list">
        {filteredTasks.length === 0 ? (
          <div className="empty-state">
            <p>
              {filter === 'all'
                ? isAuthenticated && user
                  ? `No tasks yet, ${user.firstName || 'there'}! Add one above. 📝`
                  : 'No tasks yet! Add one above. 📝'
                : filter === 'pending'
                  ? 'No pending tasks! 🎉'
                  : 'No completed tasks yet! 📋'}
            </p>
          </div>
        ) : (
          filteredTasks.map(task => (
            <div
              key={task.id}
              className={`task ${task.completed ? 'completed' : ''}`}
            >
              <div className="task-content">
                <div className="task-header">
                  <h4 onClick={() => toggleTask(task.id)}>{task.title}</h4>
                  <div className="task-meta">
                    <span
                      className="priority"
                      style={{ color: getPriorityColor(task.priority) }}
                    >
                      {task.priority.toUpperCase()}
                    </span>
                    {task.dueDate && (
                      <span className="due-date">Due: {task.dueDate}</span>
                    )}
                  </div>
                </div>
                {task.description && (
                  <p className="task-description">{task.description}</p>
                )}
                <div className="task-footer">
                  <small>
                    Created: {new Date(task.createdAt).toLocaleDateString()}
                  </small>
                  {user && task.userId === user.id && (
                    <small className="task-owner">Your task</small>
                  )}
                </div>
              </div>
              <div className="task-actions">
                <button
                  className={`toggle-btn ${task.completed ? 'completed' : 'pending'}`}
                  onClick={() => toggleTask(task.id)}
                >
                  {task.completed ? '✅' : '⭕'}
                </button>
                <button
                  className="delete-btn"
                  onClick={() => deleteTask(task.id)}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// Main App component with PlatformProvider wrapper
function App() {
  // Check if we're on the health check route
  if (window.location.pathname === '/healthy') {
    return <HealthCheck />
  }

  // App configuration for the SDK
  const appConfig = {
    id: 'f0e9b957-5e89-456e-a768-f2166932a725',
    name: 'Task Manager',
    version: '1.0.0',
    description: 'A personal task management application',
  }

  return (
    <PlatformProvider config={appConfig} fallbackMode={true}>
      <TaskManagerApp />
    </PlatformProvider>
  )
}

export default App
