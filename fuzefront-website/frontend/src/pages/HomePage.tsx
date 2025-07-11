import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import { 
  ArrowRight, 
  Shield, 
  Zap, 
  Users, 
  CreditCard, 
  MessageCircle, 
  Code, 
  Database,
  Cloud,
  Lock,
  Puzzle,
  Bot,
  CheckCircle,
  Star,
  Play,
  Github,
  Workflow
} from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

const features = [
  {
    icon: Shield,
    title: 'Authentication & Authorization',
    description: 'Enterprise-grade OAuth2, RBAC, and multi-tenant security built-in.',
    gradient: 'from-blue-500 to-cyan-500'
  },
  {
    icon: CreditCard,
    title: 'Billing & Payments',
    description: 'Stripe integration, subscription management, and revenue analytics.',
    gradient: 'from-green-500 to-emerald-500'
  },
  {
    icon: Bot,
    title: 'AI Chat Assistant',
    description: 'GPT-powered chat, context-aware responses, and custom knowledge bases.',
    gradient: 'from-purple-500 to-pink-500'
  },
  {
    icon: Puzzle,
    title: 'Plugin System',
    description: 'Extensible architecture with frontend and backend plugin support.',
    gradient: 'from-orange-500 to-red-500'
  },
  {
    icon: Database,
    title: 'FuzeInfra',
    description: 'Shared infrastructure with PostgreSQL, Redis, MongoDB, and more.',
    gradient: 'from-indigo-500 to-purple-500'
  },
  {
    icon: Workflow,
    title: 'Module Federation',
    description: 'Runtime microfrontend loading with zero build-time dependencies.',
    gradient: 'from-teal-500 to-blue-500'
  }
]

const benefits = [
  {
    title: 'Faster Time to Market',
    description: 'Launch your SaaS 10x faster with pre-built core components',
    metric: '90% faster'
  },
  {
    title: 'Reduced Development Costs',
    description: 'No need to rebuild common SaaS infrastructure from scratch',
    metric: '70% cost reduction'
  },
  {
    title: 'Enterprise Ready',
    description: 'Built-in security, compliance, and scalability features',
    metric: '100% compliant'
  },
  {
    title: 'Developer Experience',
    description: 'Modern tooling, comprehensive docs, and active community',
    metric: '5-star rating'
  }
]

const testimonials = [
  {
    name: 'Sarah Johnson',
    role: 'CTO, TechStart Inc.',
    content: 'FuzeFront cut our development time by 80%. The built-in auth and billing saved us months of work.',
    avatar: '/api/placeholder/60/60'
  },
  {
    name: 'Michael Chen',
    role: 'Lead Developer, DataFlow',
    content: 'The module federation approach is brilliant. We can deploy features independently without rebuilds.',
    avatar: '/api/placeholder/60/60'
  },
  {
    name: 'Emily Rodriguez',
    role: 'Product Manager, CloudSync',
    content: 'The AI chat integration works seamlessly. Our customers love the intelligent support system.',
    avatar: '/api/placeholder/60/60'
  }
]

const stats = [
  { value: '10,000+', label: 'Developers' },
  { value: '500+', label: 'Companies' },
  { value: '99.9%', label: 'Uptime' },
  { value: '24/7', label: 'Support' }
]

export const HomePage: React.FC = () => {
  const { trackEvent } = useAnalytics()
  const [heroRef, heroInView] = useInView({ triggerOnce: true })
  const [featuresRef, featuresInView] = useInView({ triggerOnce: true })
  const [benefitsRef, benefitsInView] = useInView({ triggerOnce: true })
  const [testimonialsRef, testimonialsInView] = useInView({ triggerOnce: true })

  const handleCTAClick = (location: string) => {
    trackEvent('cta_click', { location, page: 'home' })
  }

  const handleFeatureClick = (feature: string) => {
    trackEvent('feature_click', { feature, page: 'home' })
  }

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <section ref={heroRef} className="relative overflow-hidden bg-gradient-to-br from-primary-50 to-secondary-50 pt-20">
        <div className="hero-pattern absolute inset-0 opacity-40"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="text-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={heroInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8 }}
            >
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-6">
                Build SaaS Products{' '}
                <span className="gradient-text">10x Faster</span>
              </h1>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
                The complete platform for modern SaaS development. Get authentication, billing, 
                AI chat, infrastructure, and more - all integrated and ready to deploy.
              </p>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={heroInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="flex flex-col sm:flex-row justify-center items-center space-y-4 sm:space-y-0 sm:space-x-4 mb-12"
            >
              <Link
                to="/contact"
                className="btn-primary text-lg px-8 py-4"
                onClick={() => handleCTAClick('hero-primary')}
              >
                Start Building <ArrowRight size={20} className="ml-2" />
              </Link>
              <button
                className="btn-secondary text-lg px-8 py-4 flex items-center"
                onClick={() => handleCTAClick('hero-demo')}
              >
                <Play size={20} className="mr-2" />
                Watch Demo
              </button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={heroInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="flex justify-center items-center space-x-8 text-gray-500"
            >
              <div className="flex items-center space-x-2">
                <Github size={20} />
                <span>Open Source</span>
              </div>
              <div className="flex items-center space-x-2">
                <Shield size={20} />
                <span>Enterprise Ready</span>
              </div>
              <div className="flex items-center space-x-2">
                <Zap size={20} />
                <span>Production Ready</span>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={heroInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: index * 0.1 }}
              >
                <div className="text-3xl sm:text-4xl font-bold text-primary-600 mb-2">
                  {stat.value}
                </div>
                <div className="text-gray-600">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section ref={featuresRef} className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={featuresInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Everything You Need to Build SaaS
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Stop rebuilding the same features. Focus on your unique value proposition 
              while we handle the infrastructure.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, index) => {
              const Icon = feature.icon
              return (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 30 }}
                  animate={featuresInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className="bg-white rounded-xl p-8 shadow-soft hover:shadow-medium transition-shadow duration-300 cursor-pointer"
                  onClick={() => handleFeatureClick(feature.title)}
                >
                  <div className={`w-12 h-12 rounded-lg bg-gradient-to-r ${feature.gradient} flex items-center justify-center mb-6`}>
                    <Icon size={24} className="text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3">
                    {feature.title}
                  </h3>
                  <p className="text-gray-600 leading-relaxed">
                    {feature.description}
                  </p>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section ref={benefitsRef} className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={benefitsInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Why Choose FuzeFront?
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Join thousands of developers who've accelerated their SaaS development
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {benefits.map((benefit, index) => (
              <motion.div
                key={benefit.title}
                initial={{ opacity: 0, y: 30 }}
                animate={benefitsInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="text-center"
              >
                <div className="text-3xl font-bold text-primary-600 mb-2">
                  {benefit.metric}
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  {benefit.title}
                </h3>
                <p className="text-gray-600">
                  {benefit.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section ref={testimonialsRef} className="py-24 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={testimonialsInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
              Loved by Developers
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              See what our community has to say about FuzeFront
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={testimonial.name}
                initial={{ opacity: 0, y: 30 }}
                animate={testimonialsInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="bg-white rounded-xl p-8 shadow-soft"
              >
                <div className="flex items-center mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={16} className="text-yellow-400 fill-current" />
                  ))}
                </div>
                <p className="text-gray-600 mb-6 italic">
                  "{testimonial.content}"
                </p>
                <div className="flex items-center">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-r from-primary-500 to-secondary-500 flex items-center justify-center text-white font-semibold mr-4">
                    {testimonial.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{testimonial.name}</div>
                    <div className="text-sm text-gray-600">{testimonial.role}</div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-gradient-to-br from-primary-600 to-secondary-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={testimonialsInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8 }}
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">
              Ready to Build Your SaaS?
            </h2>
            <p className="text-xl text-white/90 max-w-2xl mx-auto mb-8">
              Join thousands of developers who've chosen FuzeFront to accelerate their SaaS development.
            </p>
            <div className="flex flex-col sm:flex-row justify-center items-center space-y-4 sm:space-y-0 sm:space-x-4">
              <Link
                to="/contact"
                className="btn-ghost text-lg px-8 py-4"
                onClick={() => handleCTAClick('bottom-cta')}
              >
                Get Started Free
              </Link>
              <Link
                to="/pricing"
                className="text-white hover:text-white/80 transition-colors text-lg underline"
                onClick={() => handleCTAClick('pricing-link')}
              >
                View Pricing
              </Link>
            </div>
          </motion.div>
        </div>
      </section>
    </div>
  )
}