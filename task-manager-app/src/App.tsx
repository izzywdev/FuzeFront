import { useState, useEffect } from 'react'
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

  // Sample tasks data
  useEffect(() => {
    const sampleTasks: Task[] = [
      {
        id: '1',
        title: 'Setup FuzeFront Platform',
        description: 'Configure the platform with all necessary components',
        completed: false,
        priority: 'high',
        dueDate: '2024-12-30',
        createdAt: new Date().toISOString(),
        userId: user?.id,
      },
      {
        id: '2',
        title: 'Test Task Manager',
        description: 'Verify all task management features work correctly',
        completed: true,
        priority: 'medium',
        dueDate: '2024-12-25',
        createdAt: new Date().toISOString(),
        userId: user?.id,
      },
    ]

    setTasks(sampleTasks)
  }, [user?.id])

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
      userId: user?.id,
    }

    setTasks([...tasks, task])
    setNewTask({ title: '', description: '', priority: 'medium', dueDate: '' })
    setShowAddForm(false)
  }

  const toggleTask = (id: string) => {
    setTasks(
      tasks.map(task =>
        task.id === id ? { ...task, completed: !task.completed } : task
      )
    )
  }

  const deleteTask = (id: string) => {
    setTasks(tasks.filter(task => task.id !== id))
  }

  const filteredTasks = tasks.filter(task => {
    if (filter === 'pending') return !task.completed
    if (filter === 'completed') return task.completed
    return true
  })

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return '#dc3545'
      case 'medium':
        return '#ffc107'
      case 'low':
        return '#28a745'
      default:
        return '#6c757d'
    }
  }

  const getUserDisplayName = () => {
    if (!user) return 'Guest User'

    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`
    } else if (user.firstName) {
      return user.firstName
    } else {
      return user.email
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="task-manager">
        <div className="auth-required">
          <h2>🔒 Authentication Required</h2>
          <p>Please login to access the Task Manager</p>
          <div className="auth-info">
            <p>
              <strong>Email:</strong> {user?.email || 'Not logged in'}
            </p>
            <p>
              <strong>Roles:</strong> {user?.roles?.join(', ') || 'None'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="task-manager">
      {/* Header */}
      <div className="app-header">
        <div className="header-content">
          <div className="app-info">
            <h1>📋 Task Manager</h1>
            <p>Manage your tasks efficiently</p>
          </div>
          <div className="user-info">
            <div className="user-avatar">
              {getUserDisplayName().charAt(0).toUpperCase()}
            </div>
            <div className="user-details">
              <div className="user-name">{getUserDisplayName()}</div>
              <div className="user-email">{user?.email}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
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

        <button className="add-task-btn" onClick={() => setShowAddForm(true)}>
          ➕ Add Task
        </button>
      </div>

      {/* Add Task Form */}
      {showAddForm && (
        <div className="add-task-form">
          <h3>Add New Task</h3>
          <div className="form-group">
            <label>Title</label>
            <input
              type="text"
              value={newTask.title}
              onChange={e => setNewTask({ ...newTask, title: e.target.value })}
              placeholder="Enter task title"
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              value={newTask.description}
              onChange={e =>
                setNewTask({ ...newTask, description: e.target.value })
              }
              placeholder="Enter task description"
              rows={3}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Priority</label>
              <select
                value={newTask.priority}
                onChange={e =>
                  setNewTask({
                    ...newTask,
                    priority: e.target.value as 'low' | 'medium' | 'high',
                  })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div className="form-group">
              <label>Due Date</label>
              <input
                type="date"
                value={newTask.dueDate}
                onChange={e =>
                  setNewTask({ ...newTask, dueDate: e.target.value })
                }
              />
            </div>
          </div>

          <div className="form-actions">
            <button
              className="cancel-btn"
              onClick={() => setShowAddForm(false)}
            >
              Cancel
            </button>
            <button className="add-btn" onClick={addTask}>
              Add Task
            </button>
          </div>
        </div>
      )}

      {/* Tasks List */}
      <div className="tasks-list">
        {filteredTasks.length === 0 ? (
          <div className="no-tasks">
            <p>No tasks found</p>
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')}>Show All Tasks</button>
            )}
          </div>
        ) : (
          filteredTasks.map(task => (
            <div
              key={task.id}
              className={`task-item ${task.completed ? 'completed' : ''}`}
            >
              <div className="task-content">
                <div className="task-header">
                  <div className="task-title-row">
                    <input
                      type="checkbox"
                      checked={task.completed}
                      onChange={() => toggleTask(task.id)}
                    />
                    <h3 className="task-title">{task.title}</h3>
                    <div
                      className="priority-badge"
                      style={{
                        backgroundColor: getPriorityColor(task.priority),
                      }}
                    >
                      {task.priority}
                    </div>
                  </div>

                  {task.description && (
                    <p className="task-description">{task.description}</p>
                  )}

                  <div className="task-meta">
                    {task.dueDate && (
                      <span className="due-date">📅 Due: {task.dueDate}</span>
                    )}
                    <span className="created-date">
                      ⏰ Created:{' '}
                      {new Date(task.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="task-actions">
                  <button
                    className="delete-btn"
                    onClick={() => deleteTask(task.id)}
                    title="Delete task"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="app-footer">
        <p>Task Manager v1.0.0 | Part of FuzeFront Platform</p>
      </div>
    </div>
  )
}

function App() {
  // Health check route
  if (window.location.pathname === '/healthy') {
    return <HealthCheck />
  }

  return (
    <PlatformProvider>
      <TaskManagerApp />
    </PlatformProvider>
  )
}

export default App
