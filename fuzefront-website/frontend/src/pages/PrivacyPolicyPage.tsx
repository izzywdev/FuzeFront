import React from 'react'
import { Link } from 'react-router-dom'
import { Shield } from 'lucide-react'

export const PrivacyPolicyPage: React.FC = () => {
  return (
    <div className="pt-24 pb-20 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="w-14 h-14 bg-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Shield size={28} className="text-primary-600" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-heading font-bold text-gray-900 mb-3">
            Privacy Policy
          </h1>
          <p className="text-gray-500">Last updated: September 2026</p>
          <p className="text-gray-500 text-sm mt-1">
            FuzeOne, Inc. &bull; A Delaware Corporation &bull;{' '}
            <a href="mailto:privacy@fuzefront.com" className="text-primary-600 hover:underline">
              privacy@fuzefront.com
            </a>
          </p>
        </div>

        {/* Content */}
        <div className="prose prose-gray max-w-none">
          <div className="space-y-10 text-gray-700 leading-relaxed">

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">1. Introduction</h2>
              <p>
                FuzeOne, Inc. ("FuzeOne," "we," "our," or "us") is a Delaware corporation operating the FuzeFront platform and the FuzeOne family of software products available at fuzefront.com and related domains. We are committed to protecting your personal information and your right to privacy.
              </p>
              <p className="mt-3">
                This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website, use our platform, or engage with our services. Please read this policy carefully. If you disagree with its terms, please discontinue use of our services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">2. Information We Collect</h2>
              <h3 className="text-base font-semibold text-gray-800 mb-2">2.1 Information You Provide</h3>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Account registration details (name, email, password hash)</li>
                <li>Organization and billing information</li>
                <li>Communications you send us (support requests, contact forms)</li>
                <li>Profile information and preferences</li>
                <li>Payment information (processed by Stripe; we do not store raw card numbers)</li>
              </ul>
              <h3 className="text-base font-semibold text-gray-800 mb-2 mt-5">2.2 Information Collected Automatically</h3>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>Log data (IP address, browser type, pages visited, timestamps)</li>
                <li>Device identifiers and usage statistics</li>
                <li>Cookies and similar tracking technologies (see Section 8)</li>
                <li>Analytics data about how you interact with our platform</li>
              </ul>
              <h3 className="text-base font-semibold text-gray-800 mb-2 mt-5">2.3 Information from Third Parties</h3>
              <ul className="list-disc pl-6 space-y-1.5">
                <li>SSO providers (when you log in via Google, Microsoft, or your organization's identity provider)</li>
                <li>Payment processors (Stripe)</li>
                <li>Analytics and monitoring services</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">3. How We Use Your Information</h2>
              <p>We use the information we collect to:</p>
              <ul className="list-disc pl-6 space-y-1.5 mt-3">
                <li>Provide, operate, and maintain our platform and services</li>
                <li>Process transactions and send related information (receipts, invoices)</li>
                <li>Send transactional communications (account notifications, security alerts)</li>
                <li>Respond to your inquiries and provide customer support</li>
                <li>Send marketing and promotional communications (where you have consented)</li>
                <li>Analyze usage patterns to improve our products</li>
                <li>Protect against fraud, unauthorized access, and other security threats</li>
                <li>Comply with legal obligations</li>
                <li>Enforce our Terms of Service</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">4. Sharing Your Information</h2>
              <p>We do not sell your personal information. We may share your information in the following circumstances:</p>
              <ul className="list-disc pl-6 space-y-1.5 mt-3">
                <li><strong>Service Providers:</strong> We share information with vendors who assist in delivering our services (hosting, analytics, payment processing, customer support).</li>
                <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets, your information may be transferred to the acquiring entity.</li>
                <li><strong>Legal Requirements:</strong> We may disclose information if required by law, court order, or governmental authority.</li>
                <li><strong>Protection of Rights:</strong> To protect the rights, property, and safety of FuzeOne, our users, or others.</li>
                <li><strong>With Your Consent:</strong> In any other circumstances where you have given explicit consent.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">5. Data Retention</h2>
              <p>
                We retain your personal information for as long as your account is active or as needed to provide our services. When you delete your account, we will delete or anonymize your personal information within 90 days, except where we are required to retain it for legal, regulatory, or legitimate business purposes (e.g., fraud prevention, accounting records).
              </p>
              <p className="mt-3">
                Aggregated, anonymized data derived from your use may be retained indefinitely for product improvement and analytics.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">6. Your Rights</h2>
              <h3 className="text-base font-semibold text-gray-800 mb-2">6.1 GDPR Rights (EEA Residents)</h3>
              <p>If you are located in the European Economic Area, you have the following rights:</p>
              <ul className="list-disc pl-6 space-y-1.5 mt-3">
                <li><strong>Access:</strong> Request a copy of your personal data</li>
                <li><strong>Rectification:</strong> Correct inaccurate or incomplete data</li>
                <li><strong>Erasure:</strong> Request deletion of your personal data ("right to be forgotten")</li>
                <li><strong>Restriction:</strong> Request that we restrict processing of your data</li>
                <li><strong>Portability:</strong> Receive your data in a machine-readable format</li>
                <li><strong>Object:</strong> Object to processing based on legitimate interests</li>
                <li><strong>Withdraw Consent:</strong> Withdraw consent where processing is based on consent</li>
              </ul>
              <h3 className="text-base font-semibold text-gray-800 mb-2 mt-5">6.2 CCPA Rights (California Residents)</h3>
              <p>California residents have the right to:</p>
              <ul className="list-disc pl-6 space-y-1.5 mt-3">
                <li>Know what personal information we collect and how it is used</li>
                <li>Delete personal information (subject to exceptions)</li>
                <li>Opt out of the sale of personal information (we do not sell personal information)</li>
                <li>Non-discrimination for exercising your rights</li>
              </ul>
              <p className="mt-3">To exercise any of these rights, contact us at <a href="mailto:privacy@fuzefront.com" className="text-primary-600 hover:underline">privacy@fuzefront.com</a>.</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">7. Security</h2>
              <p>
                We implement administrative, technical, and physical security measures to protect your personal information from unauthorized access, disclosure, alteration, or destruction. These measures include:
              </p>
              <ul className="list-disc pl-6 space-y-1.5 mt-3">
                <li>Encryption in transit (TLS) and at rest (AES-256)</li>
                <li>Role-based access controls and least-privilege principles</li>
                <li>Automated secrets rotation and credential management via FuzeKeys</li>
                <li>Regular security audits and penetration testing</li>
                <li>Multi-factor authentication for all staff with system access</li>
              </ul>
              <p className="mt-3">
                While we take reasonable precautions, no security system is impenetrable. In the event of a data breach, we will notify affected users and relevant authorities as required by applicable law.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">8. Cookies</h2>
              <p>We use cookies and similar technologies for:</p>
              <ul className="list-disc pl-6 space-y-1.5 mt-3">
                <li><strong>Essential cookies:</strong> Required for the platform to function (authentication sessions, security tokens)</li>
                <li><strong>Analytics cookies:</strong> To understand how users interact with our website</li>
                <li><strong>Preference cookies:</strong> To remember your settings and preferences</li>
                <li><strong>Marketing cookies:</strong> Only with your explicit consent</li>
              </ul>
              <p className="mt-3">You can control cookie settings through your browser. Disabling essential cookies may affect platform functionality.</p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">9. International Transfers</h2>
              <p>
                FuzeOne is headquartered in the United States. If you are accessing our services from outside the US, your information may be transferred to, stored, and processed in the US or other countries where we or our service providers operate. We ensure appropriate safeguards are in place for international transfers, including Standard Contractual Clauses (SCCs) where required by GDPR.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">10. Children's Privacy</h2>
              <p>
                Our services are not directed to individuals under 16 years of age. We do not knowingly collect personal information from children under 16. If you become aware that a child has provided us with personal information, please contact us at <a href="mailto:privacy@fuzefront.com" className="text-primary-600 hover:underline">privacy@fuzefront.com</a> and we will take steps to delete such information.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">11. Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify you of material changes by email or a prominent notice on our platform at least 30 days before the changes take effect. The "Last updated" date at the top of this page reflects the most recent revision.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-gray-900 mb-4">12. Contact Us</h2>
              <p>For privacy-related inquiries, requests, or concerns, contact us at:</p>
              <div className="mt-4 p-5 bg-secondary-50 rounded-xl border border-secondary-200">
                <p className="font-semibold text-gray-900">FuzeOne, Inc.</p>
                <p className="text-gray-600 mt-1">Attention: Privacy Team</p>
                <p className="text-gray-600">Delaware Corporation</p>
                <p className="mt-2">
                  <a href="mailto:privacy@fuzefront.com" className="text-primary-600 hover:underline">
                    privacy@fuzefront.com
                  </a>
                </p>
              </div>
            </section>

          </div>
        </div>

        {/* Footer nav */}
        <div className="mt-16 pt-8 border-t border-gray-200 flex flex-wrap gap-4">
          <Link to="/terms" className="text-primary-600 hover:text-primary-700 text-sm font-medium">
            Terms of Service
          </Link>
          <Link to="/contact" className="text-primary-600 hover:text-primary-700 text-sm font-medium">
            Contact Us
          </Link>
          <Link to="/" className="text-primary-600 hover:text-primary-700 text-sm font-medium">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
