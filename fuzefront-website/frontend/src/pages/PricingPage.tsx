import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import { Check, Star, ArrowRight } from 'lucide-react'

const plans = [
  {
    name: 'Starter',
    price: { monthly: 29, yearly: 290 },
    description: 'Perfect for small teams and MVPs',
    features: [
      'Up to 5 team members',
      'Basic authentication',
      'Community support',
      'Basic analytics',
      '99.9% uptime SLA'
    ],
    popular: false
  },
  {
    name: 'Professional',
    price: { monthly: 99, yearly: 990 },
    description: 'For growing businesses',
    features: [
      'Up to 25 team members',
      'Advanced authentication',
      'Priority support',
      'Advanced analytics',
      'Custom integrations',
      'API access'
    ],
    popular: true
  },
  {
    name: 'Enterprise',
    price: { monthly: 299, yearly: 2990 },
    description: 'For large organizations',
    features: [
      'Unlimited team members',
      'Enterprise SSO',
      'Dedicated support',
      'Custom features',
      'On-premise deployment',
      'SLA guarantees'
    ],
    popular: false
  }
]

export const PricingPage: React.FC = () => {
  const [isYearly, setIsYearly] = useState(false)
  const [heroRef, heroInView] = useInView({ triggerOnce: true })
  const [pricingRef, pricingInView] = useInView({ triggerOnce: true })

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
              Simple, <span className="gradient-text">Transparent</span> Pricing
            </h1>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
              Choose the plan that's right for your team. All plans include our core features.
            </p>
            
            <div className="flex items-center justify-center space-x-4 mb-8">
              <span className={`font-medium ${!isYearly ? 'text-primary-600' : 'text-gray-600'}`}>
                Monthly
              </span>
              <button
                onClick={() => setIsYearly(!isYearly)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                  isYearly ? 'bg-primary-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isYearly ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className={`font-medium ${isYearly ? 'text-primary-600' : 'text-gray-600'}`}>
                Yearly
              </span>
              <span className="text-sm text-green-600 font-medium">Save 20%</span>
            </div>
          </motion.div>
        </div>
      </section>

      <section ref={pricingRef} className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {plans.map((plan, index) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 30 }}
                animate={pricingInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className={`relative bg-white rounded-2xl p-8 shadow-soft hover:shadow-medium transition-shadow duration-300 ${
                  plan.popular ? 'ring-2 ring-primary-500' : ''
                }`}
              >
                {plan.popular && (
                  <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                    <div className="bg-primary-500 text-white px-4 py-1 rounded-full text-sm font-medium flex items-center">
                      <Star size={16} className="mr-1" />
                      Most Popular
                    </div>
                  </div>
                )}
                
                <div className="text-center">
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">
                    {plan.name}
                  </h3>
                  
                  <div className="mb-6">
                    <span className="text-4xl font-bold text-gray-900">
                      ${isYearly ? plan.price.yearly : plan.price.monthly}
                    </span>
                    <span className="text-gray-600">
                      /{isYearly ? 'year' : 'month'}
                    </span>
                  </div>
                  
                  <p className="text-gray-600 mb-8">
                    {plan.description}
                  </p>
                  
                  <ul className="space-y-4 mb-8">
                    {plan.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-center">
                        <Check size={20} className="text-green-500 mr-3 flex-shrink-0" />
                        <span className="text-gray-700">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <button className={`w-full py-3 px-6 rounded-lg font-medium transition-all duration-300 ${
                    plan.popular 
                      ? 'bg-primary-600 hover:bg-primary-700 text-white' 
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                  }`}>
                    Get Started <ArrowRight size={20} className="ml-2 inline" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}