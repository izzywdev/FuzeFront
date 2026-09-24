import React from 'react'
import { motion } from 'framer-motion'
import { useInView } from 'react-intersection-observer'
import { useForm } from 'react-hook-form'
import { Mail, Phone, MapPin, Send } from 'lucide-react'
import { IconTile, Container, FieldLabel } from '@fuzefront/design-system'
import { useNotifications } from '../contexts/NotificationContext'
import { useAnalytics } from '../contexts/AnalyticsContext'

const FORMSPREE_FORM_ID = import.meta.env.VITE_FORMSPREE_FORM_ID as string | undefined

interface ContactFormData {
  name: string
  email: string
  company?: string
  phone?: string
  subject: string
  message: string
  interest?: string
}

export const ContactPage: React.FC = () => {
  const [heroRef, heroInView] = useInView({ triggerOnce: true })
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const { addNotification } = useNotifications()
  const { trackEvent } = useAnalytics()

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset
  } = useForm<ContactFormData>()

  const onSubmit = async (data: ContactFormData) => {
    if (!FORMSPREE_FORM_ID) {
      addNotification({
        type: 'error',
        title: 'Form not configured',
        message: 'Set VITE_FORMSPREE_FORM_ID to enable the contact form.',
      })
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch(`https://formspree.io/f/${FORMSPREE_FORM_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) throw new Error('Formspree submission failed')

      addNotification({
        type: 'success',
        title: 'Message Sent!',
        message: 'Thank you for your message. We\'ll get back to you soon.'
      })

      trackEvent('contact_form_submit', {
        subject: data.subject,
        interest: data.interest
      })

      reset()
    } catch {
      addNotification({
        type: 'error',
        title: 'Error',
        message: 'Failed to send message. Please try again.'
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="bg-white pt-16">
      <section ref={heroRef} className="py-24 bg-gradient-to-br from-primary-50 to-secondary-50">
        <Container size="7xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={heroInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
              Get in <span className="gradient-text">Touch</span>
            </h1>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Ready to build something amazing? Let's discuss how FuzeFront can help.
            </p>
          </motion.div>
        </Container>
      </section>

      <section className="py-24">
        <Container size="7xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Contact Info */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={heroInView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              <h2 className="text-3xl font-bold text-gray-900 mb-8">
                Let's Start a Conversation
              </h2>
              
              <div className="space-y-6">
                <div className="flex items-center space-x-4">
                  <IconTile tone="accent" size="md">
                    <Mail size={24} />
                  </IconTile>
                  <div>
                    <h3 className="font-medium text-gray-900">Email</h3>
                    <p className="text-gray-600">contact@fuzefront.com</p>
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <IconTile tone="accent" size="md">
                    <Phone size={24} />
                  </IconTile>
                  <div>
                    <h3 className="font-medium text-gray-900">Phone</h3>
                    <a href="tel:+16502763313" className="text-gray-600 hover:text-primary-600 transition-colors">
                      (650) 276-3313
                    </a>
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <IconTile tone="accent" size="md">
                    <MapPin size={24} />
                  </IconTile>
                  <div>
                    <h3 className="font-medium text-gray-900">Office</h3>
                    <p className="text-gray-600">San Francisco, CA</p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Contact Form */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={heroInView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.8, delay: 0.4 }}
            >
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <FieldLabel htmlFor="contact-name" required>
                      Name
                    </FieldLabel>
                    <input
                      id="contact-name"
                      {...register('name', { required: 'Name is required' })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Your name"
                    />
                    {errors.name && (
                      <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
                    )}
                  </div>

                  <div>
                    <FieldLabel htmlFor="contact-email" required>
                      Email
                    </FieldLabel>
                    <input
                      id="contact-email"
                      {...register('email', {
                        required: 'Email is required',
                        pattern: {
                          value: /^\S+@\S+$/i,
                          message: 'Invalid email address'
                        }
                      })}
                      type="email"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="your@email.com"
                    />
                    {errors.email && (
                      <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <FieldLabel htmlFor="contact-company">
                      Company
                    </FieldLabel>
                    <input
                      id="contact-company"
                      {...register('company')}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Your company"
                    />
                  </div>

                  <div>
                    <FieldLabel htmlFor="contact-phone">
                      Phone
                    </FieldLabel>
                    <input
                      id="contact-phone"
                      {...register('phone')}
                      type="tel"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Your phone number"
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel htmlFor="contact-interest">
                    Interest
                  </FieldLabel>
                  <select
                    id="contact-interest"
                    {...register('interest')}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">Select your interest</option>
                    <option value="platform">FuzeFront Platform</option>
                    <option value="infrastructure">FuzeInfra</option>
                    <option value="consultation">Consultation</option>
                    <option value="partnership">Partnership</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <FieldLabel htmlFor="contact-subject" required>
                    Subject
                  </FieldLabel>
                  <input
                    id="contact-subject"
                    {...register('subject', { required: 'Subject is required' })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="What's this about?"
                  />
                  {errors.subject && (
                    <p className="mt-1 text-sm text-red-600">{errors.subject.message}</p>
                  )}
                </div>

                <div>
                  <FieldLabel htmlFor="contact-message" required>
                    Message
                  </FieldLabel>
                  <textarea
                    id="contact-message"
                    {...register('message', { required: 'Message is required' })}
                    rows={6}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Tell us about your project..."
                  />
                  {errors.message && (
                    <p className="mt-1 text-sm text-red-600">{errors.message.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full btn-primary py-4 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <div className="flex items-center justify-center">
                      <div className="spinner mr-2"></div>
                      Sending...
                    </div>
                  ) : (
                    <div className="flex items-center justify-center">
                      <Send size={20} className="mr-2" />
                      Send Message
                    </div>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        </Container>
      </section>
    </div>
  )
}