import React, { createContext, useContext, useReducer, ReactNode } from 'react'
import { ChatMessage, ChatState, ChatContextType } from '../types/chat'

// Chat reducer actions
type ChatAction =
  | { type: 'TOGGLE_CHAT' }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'ADD_MESSAGE'; payload: ChatMessage }
  | {
      type: 'UPDATE_FEEDBACK'
      payload: { messageId: string; feedback: 'positive' | 'negative' }
    }
  | { type: 'CLEAR_MESSAGES' }

const initialState: ChatState = {
  messages: [],
  isLoading: false,
  isOpen: false,
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'TOGGLE_CHAT':
      return { ...state, isOpen: !state.isOpen }

    case 'SET_LOADING':
      return { ...state, isLoading: action.payload }

    case 'ADD_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.payload],
        isLoading: false,
      }

    case 'UPDATE_FEEDBACK':
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.id === action.payload.messageId
            ? { ...msg, feedback: action.payload.feedback }
            : msg
        ),
      }

    case 'CLEAR_MESSAGES':
      return { ...state, messages: [] }

    default:
      return state
  }
}

const ChatContext = createContext<ChatContextType | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialState)

  // Simulate AI response (replace with actual API call)
  const simulateAIResponse = async (userMessage: string): Promise<string> => {
    // Simulate API delay
    await new Promise(resolve =>
      setTimeout(resolve, 1000 + Math.random() * 2000)
    )

    // Simple response logic based on keywords
    const message = userMessage.toLowerCase()

    if (
      message.includes('module federation') ||
      message.includes('microfrontend')
    ) {
      return `Great question about Module Federation! 🚀

FrontFuse uses runtime Module Federation, which means:

• **Zero build-time dependencies** - The hub doesn't know about apps at compile time
• **Dynamic loading** - Apps register themselves and are loaded on-demand
• **Shared dependencies** - React and React-DOM are shared as singletons
• **Self-registration** - Apps automatically register via REST API

Would you like me to explain any specific aspect in more detail?`
    }

    if (message.includes('docker') || message.includes('container')) {
      return `Docker support in FrontFuse includes:

🐳 **Multi-stage builds** for optimal image sizes
📦 **Docker Compose** for full system deployment  
🔄 **Auto-registration** when containers start
🏥 **Health checks** for all services
🌐 **CORS configuration** for module federation

You can start the demo with \`npm run docker:up\`!`
    }

    if (
      message.includes('how') ||
      message.includes('setup') ||
      message.includes('start')
    ) {
      return `To get started with FrontFuse:

**Development Mode:**
\`\`\`bash
npm run install:all
npm run db:init
npm run demo
\`\`\`

**Docker Mode:**
\`\`\`bash
npm run docker:build
npm run docker:up
\`\`\`

**Creating New Apps:**
1. Follow the MODULE_FEDERATION_GUIDE.md
2. Configure Module Federation in vite.config.ts
3. Add self-registration code
4. Start and watch it auto-register! ✨`
    }

    if (message.includes('help') || message.includes('what')) {
      return `I can help you with:

🔗 **Module Federation** - Runtime loading, configuration, best practices
🐳 **Docker & Deployment** - Containerization, Docker Compose, production setup
🚀 **Getting Started** - Setup, demos, creating new apps
📚 **Documentation** - Guides, examples, troubleshooting
💡 **Architecture** - How FrontFuse works, design decisions

What specific topic would you like to explore?`
    }

    return `Thanks for your question! 🤔

I'm here to help with FrontFuse - the microfrontend platform with runtime Module Federation. 

Some things I can help with:
• Setting up new micro-frontends
• Module Federation configuration
• Docker deployment
• Platform architecture
• Troubleshooting

Could you be more specific about what you'd like to know?`
  }

  const sendMessage = async (content: string) => {
    // Add user message immediately
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      content,
      timestamp: new Date(),
    }

    dispatch({ type: 'ADD_MESSAGE', payload: userMessage })
    dispatch({ type: 'SET_LOADING', payload: true })

    try {
      // Get AI response
      const aiResponse = await simulateAIResponse(content)

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        content: aiResponse,
        timestamp: new Date(),
      }

      dispatch({ type: 'ADD_MESSAGE', payload: assistantMessage })
    } catch (error) {
      console.error('Failed to get AI response:', error)

      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        sender: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }

      dispatch({ type: 'ADD_MESSAGE', payload: errorMessage })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }

  const toggleChat = () => {
    dispatch({ type: 'TOGGLE_CHAT' })
  }

  const addFeedback = (messageId: string, type: 'positive' | 'negative') => {
    dispatch({
      type: 'UPDATE_FEEDBACK',
      payload: { messageId, feedback: type },
    })

    // You could send feedback to analytics service here
    console.log(`Feedback for message ${messageId}: ${type}`)
  }

  const contextValue: ChatContextType = {
    state,
    sendMessage,
    toggleChat,
    addFeedback,
  }

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  )
}

export function useChat() {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
}
