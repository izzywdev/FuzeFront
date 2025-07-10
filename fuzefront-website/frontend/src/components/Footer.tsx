import React from 'react'
import { Link } from 'react-router-dom'
import { Mail, Phone, MapPin, Github, Twitter, Linkedin, Youtube } from 'lucide-react'
import { useAnalytics } from '../contexts/AnalyticsContext'

const footerNavigation = {
  products: [
    { name: 'FuzeFront Platform', href: '/products#platform' },
    { name: 'FuzeInfra', href: '/products#infrastructure' },
    { name: 'Authentication & Authorization', href: '/products#auth' },
    { name: 'AI Chat Assistant', href: '/products#ai-chat' },
    { name: 'Billing & Payments', href: '/products#billing' },
  ],
  solutions: [
    { name: 'Enterprise SaaS', href: '/solutions#enterprise' },
    { name: 'Startup MVP', href: '/solutions#startup' },
    { name: 'Migration Services', href: '/solutions#migration' },
    { name: 'Custom Development', href: '/solutions#custom' },
  ],
  company: [
    { name: 'About Us', href: '/about' },
    { name: 'Careers', href: '/careers' },
    { name: 'Blog', href: '/blog' },
    { name: 'Press', href: '/press' },
    { name: 'Contact', href: '/contact' },
  ],
  support: [
    { name: 'Documentation', href: '/docs' },
    { name: 'API Reference', href: '/api-docs' },
    { name: 'Community Forum', href: '/community' },
    { name: 'Status Page', href: '/status' },
    { name: 'Support Center', href: '/support' },
  ],
  legal: [
    { name: 'Privacy Policy', href: '/privacy' },
    { name: 'Terms of Service', href: '/terms' },
    { name: 'Cookie Policy', href: '/cookies' },
    { name: 'Security', href: '/security' },
    { name: 'Compliance', href: '/compliance' },
  ],
}

const socialLinks = [
  { name: 'GitHub', href: 'https://github.com/fuzefront', icon: Github },
  { name: 'Twitter', href: 'https://twitter.com/fuzefront', icon: Twitter },
  { name: 'LinkedIn', href: 'https://linkedin.com/company/fuzefront', icon: Linkedin },
  { name: 'YouTube', href: 'https://youtube.com/fuzefront', icon: Youtube },
]

export const Footer: React.FC = () => {
  const { trackEvent } = useAnalytics()

  const handleFooterClick = (section: string, item: string) => {
    trackEvent('footer_click', { section, item })
  }

  const handleSocialClick = (platform: string) => {
    trackEvent('social_click', { platform, location: 'footer' })
  }

  return (
    <footer className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-8">
          {/* Company Info */}
          <div className="lg:col-span-2">
            <Link to="/" className="flex items-center space-x-2 mb-4">
              <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">F</span>
              </div>
              <span className="font-heading font-bold text-xl">FuzeFront</span>
            </Link>
            <p className="text-gray-400 mb-6 max-w-md">
              The complete platform for building modern SaaS applications with built-in authentication, 
              billing, AI chat, and infrastructure management.
            </p>
            
            {/* Contact Info */}
            <div className="space-y-3">
              <div className="flex items-center space-x-3">
                <Mail size={16} className="text-primary-400" />
                <a 
                  href="mailto:hello@fuzefront.com" 
                  className="text-gray-400 hover:text-white transition-colors"
                  onClick={() => handleFooterClick('contact', 'email')}
                >
                  hello@fuzefront.com
                </a>
              </div>
              <div className="flex items-center space-x-3">
                <Phone size={16} className="text-primary-400" />
                <a 
                  href="tel:+1-555-123-4567" 
                  className="text-gray-400 hover:text-white transition-colors"
                  onClick={() => handleFooterClick('contact', 'phone')}
                >
                  +1 (555) 123-4567
                </a>
              </div>
              <div className="flex items-center space-x-3">
                <MapPin size={16} className="text-primary-400" />
                <span className="text-gray-400">San Francisco, CA</span>
              </div>
            </div>
          </div>

          {/* Products */}
          <div>
            <h3 className="font-semibold text-white mb-4">Products</h3>
            <ul className="space-y-2">
              {footerNavigation.products.map((item) => (
                <li key={item.name}>
                  <Link 
                    to={item.href}
                    className="text-gray-400 hover:text-white transition-colors"
                    onClick={() => handleFooterClick('products', item.name)}
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Solutions */}
          <div>
            <h3 className="font-semibold text-white mb-4">Solutions</h3>
            <ul className="space-y-2">
              {footerNavigation.solutions.map((item) => (
                <li key={item.name}>
                  <Link 
                    to={item.href}
                    className="text-gray-400 hover:text-white transition-colors"
                    onClick={() => handleFooterClick('solutions', item.name)}
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="font-semibold text-white mb-4">Company</h3>
            <ul className="space-y-2">
              {footerNavigation.company.map((item) => (
                <li key={item.name}>
                  <Link 
                    to={item.href}
                    className="text-gray-400 hover:text-white transition-colors"
                    onClick={() => handleFooterClick('company', item.name)}
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support */}
          <div>
            <h3 className="font-semibold text-white mb-4">Support</h3>
            <ul className="space-y-2">
              {footerNavigation.support.map((item) => (
                <li key={item.name}>
                  <Link 
                    to={item.href}
                    className="text-gray-400 hover:text-white transition-colors"
                    onClick={() => handleFooterClick('support', item.name)}
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Newsletter Signup */}
        <div className="mt-12 pt-8 border-t border-gray-800">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="mb-4 md:mb-0">
              <h3 className="font-semibold text-white mb-2">Stay Updated</h3>
              <p className="text-gray-400">Get the latest updates and insights from FuzeFront</p>
            </div>
            <div className="flex space-x-3">
              <input
                type="email"
                placeholder="Enter your email"
                className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <button 
                className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
                onClick={() => handleFooterClick('newsletter', 'subscribe')}
              >
                Subscribe
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="mt-12 pt-8 border-t border-gray-800">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex flex-wrap items-center space-x-6 mb-4 md:mb-0">
              {footerNavigation.legal.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  className="text-gray-400 hover:text-white transition-colors text-sm"
                  onClick={() => handleFooterClick('legal', item.name)}
                >
                  {item.name}
                </Link>
              ))}
            </div>
            
            {/* Social Links */}
            <div className="flex space-x-4">
              {socialLinks.map((item) => {
                const Icon = item.icon
                return (
                  <a
                    key={item.name}
                    href={item.href}
                    className="text-gray-400 hover:text-white transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleSocialClick(item.name)}
                  >
                    <Icon size={20} />
                  </a>
                )
              })}
            </div>
          </div>
          
          <div className="mt-8 text-center text-gray-400 text-sm">
            <p>&copy; {new Date().getFullYear()} FuzeFront. All rights reserved.</p>
          </div>
        </div>
      </div>
    </footer>
  )
}