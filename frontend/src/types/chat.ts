export interface ChatMessage {
  id: string
  sender: 'user' | 'assistant'
  content: string
  timestamp: Date
  feedback?: 'positive' | 'negative'
}

export interface ChatPanelProps {
  isOpen: boolean
  onToggle: () => void
  messages: ChatMessage[]
  onSendMessage: (message: string) => void
  onFeedback?: (messageId: string, type: 'positive' | 'negative') => void
  isLoading?: boolean
}

export interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  isOpen: boolean
}

export interface ChatContextType {
  state: ChatState
  sendMessage: (content: string) => Promise<void>
  toggleChat: () => void
  addFeedback: (messageId: string, type: 'positive' | 'negative') => void
}
