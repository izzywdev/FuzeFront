import React from 'react'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import { Building, Rocket, RefreshCw, Code, ArrowRight } from 'lucide-react'

const solutions = [
  {
    id: 'enterprise',
    name: 'Enterprise SaaS',
    icon: Building,
    description: 'Scale your enterprise application with robust infrastructure and security',
    features: ['Multi-tenant architecture', 'Enterprise SSO', 'Compliance ready', 'Advanced analytics']
  },
  {
    id: 'startup',
    name: 'Startup MVP',
    icon: Rocket,
    description: 'Launch your MVP quickly with essential SaaS features built-in',
    features: ['Rapid deployment', 'Essential features', 'Cost-effective', 'Growth ready']
  },
  {
    id: 'migration',
    name: 'Migration Services',
    icon: RefreshCw,
    description: 'Migrate your existing application to modern SaaS architecture',
    features: ['Zero downtime', 'Data migration', 'Feature parity', 'Training included']
  },
  {
    id: 'custom',
    name: 'Custom Development',
    icon: Code,
    description: 'Tailored solutions for your specific business requirements',
    features: ['Custom features', 'Dedicated team', 'Flexible timeline', 'Ongoing support']
  }
]

export const SolutionsPage: React.FC = () => {
  const [heroRef, heroInView] = useInView({ triggerOnce: true })
  const [solutionsRef, solutionsInView] = useInView({ triggerOnce: true })

  return (
    <div className="bg-white pt-16">
      <section ref={heroRef} className="py-24 bg-gradient-to-br from-primary-50 to-secondary-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
              Solutions for Every <span className="gradient-text">Business</span>
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Whether you're a startup building an MVP or an enterprise scaling globally, 
              we have the right solution for you.
            </p>
          </motion.div>
        </div>
      </section>

      <section ref={solutionsRef} className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {solutions.map((solution, index) => {
              const Icon = solution.icon
              return (
                <motion.div
                  key={solution.id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={solutionsInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className="bg-white rounded-2xl p-8 shadow-soft hover:shadow-medium transition-shadow duration-300"
                >
                  <div className="w-16 h-16 rounded-xl bg-gradient-to-r from-primary-500 to-secondary-500 flex items-center justify-center mb-6">
                    <Icon size={32} className="text-white" />
                  </div>
                  
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">
                    {solution.name}
                  </h3>
                  
                  <p className="text-gray-600 mb-6">
                    {solution.description}
                  </p>
                  
                  <ul className="space-y-2 mb-8">
                    {solution.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-primary-500 rounded-full"></div>
                        <span className="text-gray-700">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <button className="btn-primary w-full">
                    Learn More <ArrowRight size={20} className="ml-2" />
                  </button>
                </motion.div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}