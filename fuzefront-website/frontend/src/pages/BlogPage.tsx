import React from 'react'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'

export const BlogPage: React.FC = () => {
  const [heroRef, heroInView] = useInView({ triggerOnce: true })

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
              <span className="gradient-text">Blog</span> & Insights
            </h1>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Stay updated with the latest in SaaS development, best practices, and FuzeFront updates.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Blog Coming Soon
            </h2>
            <p className="text-gray-600">
              We're working on bringing you the latest insights and updates. 
              Subscribe to our newsletter to be notified when we launch.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}