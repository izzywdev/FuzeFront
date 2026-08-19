import React from 'react'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import { Shield, CreditCard, Bot, Puzzle, Database, Workflow, CheckCircle, ArrowRight } from 'lucide-react'

const products = [
  {
    id: 'platform',
    name: 'FuzeFront Platform',
    icon: Workflow,
    description: 'Complete microfrontend platform with runtime Module Federation',
    features: [
      'Runtime app discovery and loading',
      'Zero build-time dependencies',
      'Shared React components',
      'Dynamic plugin system',
      'Health monitoring',
      'WebSocket communication'
    ],
    gradient: 'from-blue-500 to-cyan-500'
  },
  {
    id: 'infrastructure',
    name: 'FuzeInfra',
    icon: Database,
    description: 'Shared infrastructure with production-ready services',
    features: [
      'PostgreSQL, MongoDB, Redis',
      'Nginx reverse proxy',
      'Prometheus monitoring',
      'Grafana dashboards',
      'Docker orchestration',
      'Service discovery'
    ],
    gradient: 'from-indigo-500 to-purple-500'
  },
  {
    id: 'auth',
    name: 'Authentication & Authorization',
    icon: Shield,
    description: 'Enterprise-grade security with OAuth2 and RBAC',
    features: [
      'OAuth2/OpenID Connect',
      'Multi-tenant RBAC',
      'Permit.io integration',
      'Session management',
      'JWT tokens',
      'Organization context'
    ],
    gradient: 'from-green-500 to-emerald-500'
  },
  {
    id: 'billing',
    name: 'Billing & Payments',
    icon: CreditCard,
    description: 'Complete billing solution with subscription management',
    features: [
      'Stripe integration',
      'Subscription management',
      'Usage-based billing',
      'Invoice generation',
      'Revenue analytics',
      'Tax compliance'
    ],
    gradient: 'from-yellow-500 to-orange-500'
  },
  {
    id: 'ai-chat',
    name: 'AI Chat Assistant',
    icon: Bot,
    description: 'Intelligent chat with context-aware responses',
    features: [
      'GPT-4 integration',
      'Context awareness',
      'Custom knowledge bases',
      'Multi-language support',
      'Conversation history',
      'Analytics dashboard'
    ],
    gradient: 'from-purple-500 to-pink-500'
  },
  {
    id: 'plugins',
    name: 'Plugin System',
    icon: Puzzle,
    description: 'Extensible architecture for custom functionality',
    features: [
      'Frontend plugins',
      'Backend middleware',
      'Plugin marketplace',
      'Version management',
      'Hot reloading',
      'Dependency injection'
    ],
    gradient: 'from-red-500 to-rose-500'
  }
]

export const ProductsPage: React.FC = () => {
  const [heroRef, heroInView] = useInView({ triggerOnce: true })
  const [productsRef, productsInView] = useInView({ triggerOnce: true })

  return (
    <div className="bg-white pt-16">
      {/* Hero Section */}
      <section ref={heroRef} className="py-24 bg-gradient-to-br from-primary-50 to-secondary-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
              Complete SaaS <span className="gradient-text">Product Suite</span>
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Everything you need to build, deploy, and scale modern SaaS applications. 
              From infrastructure to AI, we've got you covered.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Products Grid */}
      <section ref={productsRef} className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {products.map((product, index) => {
              const Icon = product.icon
              return (
                <motion.div
                  key={product.id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={productsInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className="bg-white rounded-2xl p-8 shadow-soft hover:shadow-medium transition-shadow duration-300"
                >
                  <div className={`w-16 h-16 rounded-xl bg-gradient-to-r ${product.gradient} flex items-center justify-center mb-6`}>
                    <Icon size={32} className="text-white" />
                  </div>
                  
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">
                    {product.name}
                  </h3>
                  
                  <p className="text-gray-600 mb-6 text-lg">
                    {product.description}
                  </p>
                  
                  <div className="space-y-3 mb-8">
                    {product.features.map((feature, featureIndex) => (
                      <div key={featureIndex} className="flex items-center space-x-3">
                        <CheckCircle size={20} className="text-green-500 flex-shrink-0" />
                        <span className="text-gray-700">{feature}</span>
                      </div>
                    ))}
                  </div>
                  
                  <button className="btn-primary w-full">
                    Learn More <ArrowRight size={20} className="ml-2" />
                  </button>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Integration Section */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-6">
            Seamless Integration
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-12">
            All products work together seamlessly, providing a unified development experience.
          </p>
          
          <div className="bg-white rounded-2xl p-8 shadow-soft">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8">
              {products.map((product, index) => {
                const Icon = product.icon
                return (
                  <motion.div
                    key={product.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={productsInView ? { opacity: 1, scale: 1 } : {}}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className="flex flex-col items-center"
                  >
                    <div className={`w-12 h-12 rounded-lg bg-gradient-to-r ${product.gradient} flex items-center justify-center mb-3`}>
                      <Icon size={24} className="text-white" />
                    </div>
                    <span className="text-sm font-medium text-gray-900 text-center">
                      {product.name}
                    </span>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}