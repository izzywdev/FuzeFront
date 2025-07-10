import React from 'react'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'

export const AboutPage: React.FC = () => {
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
              About <span className="gradient-text">FuzeFront</span>
            </h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              We're building the future of SaaS development with integrated platforms 
              that eliminate the need to rebuild common infrastructure.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            <h2>Our Mission</h2>
            <p>
              At FuzeFront, we believe developers should focus on what makes their product unique, 
              not on rebuilding the same authentication, billing, and infrastructure components 
              over and over again.
            </p>
            
            <h2>Our Story</h2>
            <p>
              Founded by experienced developers who were tired of reinventing the wheel, 
              FuzeFront emerged from the frustration of building the same SaaS components 
              across multiple projects.
            </p>
            
            <h2>What We Offer</h2>
            <ul>
              <li>Complete SaaS platform with all essential components</li>
              <li>Shared infrastructure that scales with your business</li>
              <li>Modern development tools and practices</li>
              <li>Enterprise-grade security and compliance</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )
}