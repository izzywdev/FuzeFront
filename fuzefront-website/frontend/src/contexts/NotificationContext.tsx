import React, { createContext, useContext, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'

interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

interface NotificationContextType {
  notifications: Notification[]
  addNotification: (notification: Omit<Notification, 'id'>) => void
  removeNotification: (id: string) => void
  clearNotifications: () => void
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined)

const NotificationIcon: React.FC<{ type: Notification['type'] }> = ({ type }) => {
  const iconProps = { size: 20 }
  
  switch (type) {
    case 'success':
      return <CheckCircle {...iconProps} className="text-success-500" />
    case 'error':
      return <XCircle {...iconProps} className="text-error-500" />
    case 'warning':
      return <AlertCircle {...iconProps} className="text-warning-500" />
    case 'info':
      return <Info {...iconProps} className="text-primary-500" />
    default:
      return <Info {...iconProps} className="text-primary-500" />
  }
}

const NotificationComponent: React.FC<{ 
  notification: Notification
  onRemove: (id: string) => void
}> = ({ notification, onRemove }) => {
  const { id, type, title, message, action } = notification

  React.useEffect(() => {
    if (notification.duration !== 0) {
      const timer = setTimeout(() => {
        onRemove(id)
      }, notification.duration || 5000)

      return () => clearTimeout(timer)
    }
  }, [id, notification.duration, onRemove])

  const bgColor = {
    success: 'bg-success-50 border-success-200',
    error: 'bg-error-50 border-error-200',
    warning: 'bg-warning-50 border-warning-200',
    info: 'bg-primary-50 border-primary-200'
  }[type]

  return (
    <motion.div
      initial={{ opacity: 0, y: -50, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -50, scale: 0.8 }}
      transition={{ duration: 0.3 }}
      className={`${bgColor} border rounded-lg p-4 shadow-lg max-w-md w-full`}
    >
      <div className="flex items-start gap-3">
        <NotificationIcon type={type} />
        <div className="flex-1">
          <h4 className="font-medium text-gray-900">{title}</h4>
          {message && (
            <p className="mt-1 text-sm text-gray-600">{message}</p>
          )}
          {action && (
            <button
              onClick={action.onClick}
              className="mt-2 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              {action.label}
            </button>
          )}
        </div>
        <button
          onClick={() => onRemove(id)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={18} />
        </button>
      </div>
    </motion.div>
  )
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([])

  const addNotification = useCallback((notification: Omit<Notification, 'id'>) => {
    const id = crypto.randomUUID()
    setNotifications(prev => [...prev, { ...notification, id }])
  }, [])

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  const clearNotifications = useCallback(() => {
    setNotifications([])
  }, [])

  const value: NotificationContextType = {
    notifications,
    addNotification,
    removeNotification,
    clearNotifications
  }

  return (
    <NotificationContext.Provider value={value}>
      {children}
      
      {/* Notification Container */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        <AnimatePresence>
          {notifications.map(notification => (
            <NotificationComponent
              key={notification.id}
              notification={notification}
              onRemove={removeNotification}
            />
          ))}
        </AnimatePresence>
      </div>
    </NotificationContext.Provider>
  )
}

export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider')
  }
  return context
}