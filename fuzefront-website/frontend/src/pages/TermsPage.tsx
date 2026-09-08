import React from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'

export const TermsPage: React.FC = () => {
  return (
    <div className="pt-24 pb-20 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="w-14 h-14 bg-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <FileText size={28} className="text-primary-700" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-heading font-bold text-gray-900 mb-3">
            Terms of Service
          </h1>
          <p className="text-gray-500">Last updated: September 2026</p>
          <p className="text-gray-500 text-sm mt-1">
            FuzeOne, Inc. &bull; A Delaware Corporation &bull;{' '}
            <a href="mailto:legal@fuzefront.com" className="text-primary-700 hover:underline">
              legal@fuzefront.com
            </a>
          </p>
        </div>

        <div className="space-y-10 text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">1. Acceptance of Terms</h2>
            <p>
              These Terms of Service ("Terms") constitute a legally binding agreement between you ("Customer," "you," or "your") and FuzeOne, Inc., a Delaware corporation ("FuzeOne," "Company," "we," "our," or "us"), governing your access to and use of the FuzeFront platform, the FuzeOne family of products, and related services (collectively, the "Services").
            </p>
            <p className="mt-3">
              By accessing or using our Services, you acknowledge that you have read, understood, and agree to be bound by these Terms. If you are accepting these Terms on behalf of an organization, you represent and warrant that you have the authority to bind that organization.
            </p>
            <p className="mt-3">
              If you do not agree to these Terms, do not access or use our Services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">2. Description of Services</h2>
            <p>
              FuzeOne provides a suite of software-as-a-service products including, but not limited to: FuzeFront Platform (Module-Federation host shell), FuzeAgent (AI orchestration), FuzeSocial (social media management), FuzeFinance (financial management), FuzeKeys (credential management), FuzeMarket (marketing intelligence), FuzeQuality (quality engineering), FuzeBI (business intelligence), FuzeX (design-engineering workflow), and FuzeHub (operations hub).
            </p>
            <p className="mt-3">
              We reserve the right to modify, suspend, or discontinue any aspect of our Services at any time. We will provide reasonable notice of material changes that affect your use of the Services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">3. Accounts</h2>
            <p>To use our Services, you must create an account. You agree to:</p>
            <ul className="list-disc pl-6 space-y-1.5 mt-3">
              <li>Provide accurate, current, and complete registration information</li>
              <li>Maintain the security of your account credentials</li>
              <li>Promptly notify us of any unauthorized use of your account</li>
              <li>Not share your account credentials with others outside your organization</li>
              <li>Be responsible for all activity that occurs under your account</li>
            </ul>
            <p className="mt-3">
              We reserve the right to terminate accounts, remove content, or cancel subscriptions at our sole discretion if we determine that Terms have been violated.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">4. Payment and Billing</h2>
            <h3 className="text-base font-semibold text-gray-800 mb-2">4.1 Subscription Fees</h3>
            <p>
              Paid plans are billed in advance on a monthly or annual basis. All fees are non-refundable except as expressly set forth in these Terms or required by applicable law.
            </p>
            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">4.2 Price Changes</h3>
            <p>
              We may change prices for our Services upon 30 days' written notice. Your continued use of the Services after a price change constitutes acceptance of the new pricing.
            </p>
            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">4.3 Taxes</h3>
            <p>
              You are responsible for all applicable taxes associated with your use of our Services, except for taxes on FuzeOne's income.
            </p>
            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">4.4 Payment Processing</h3>
            <p>
              Payments are processed by Stripe, Inc. By providing payment information, you authorize us to charge your payment method for all fees. All payment data is governed by Stripe's privacy policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">5. Intellectual Property</h2>
            <h3 className="text-base font-semibold text-gray-800 mb-2">5.1 FuzeOne IP</h3>
            <p>
              FuzeOne and its licensors retain all right, title, and interest in and to the Services, including all intellectual property rights therein. These Terms do not grant you any ownership rights in the Services.
            </p>
            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">5.2 Your Content</h3>
            <p>
              You retain all rights in and to the data, content, and materials you submit to our Services ("Customer Data"). You grant FuzeOne a non-exclusive, worldwide license to use, process, and store Customer Data solely to provide and improve the Services.
            </p>
            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">5.3 Feedback</h3>
            <p>
              Any feedback, suggestions, or ideas you provide to FuzeOne may be used by us without restriction or compensation to you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">6. Confidentiality</h2>
            <p>
              Each party agrees to keep confidential any non-public information of the other party that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information ("Confidential Information"). Neither party shall use the other's Confidential Information except as necessary to fulfill obligations under these Terms.
            </p>
            <p className="mt-3">
              Confidential Information does not include information that: (a) is or becomes publicly known through no wrongful act; (b) was known before receipt; (c) is independently developed without use of Confidential Information; or (d) is required to be disclosed by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">7. Acceptable Use</h2>
            <p>You agree not to use our Services to:</p>
            <ul className="list-disc pl-6 space-y-1.5 mt-3">
              <li>Violate any applicable law or regulation</li>
              <li>Infringe on the intellectual property rights of others</li>
              <li>Transmit malware, viruses, or other malicious code</li>
              <li>Engage in unauthorized access or security attacks</li>
              <li>Distribute spam or unsolicited communications</li>
              <li>Conduct activities that harm minors</li>
              <li>Interfere with the proper functioning of our Services</li>
              <li>Resell or sublicense the Services without authorization</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">8. Disclaimers and Warranties</h2>
            <p className="uppercase text-sm font-medium text-gray-600">
              THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND. TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, FUZEONE EXPRESSLY DISCLAIMS ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.
            </p>
            <p className="mt-3">
              FuzeOne does not warrant that the Services will be uninterrupted, error-free, or secure, or that any defects will be corrected. You use the Services at your sole risk.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">9. Limitation of Liability</h2>
            <p className="uppercase text-sm font-medium text-gray-600">
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, FUZEONE AND ITS AFFILIATES, OFFICERS, EMPLOYEES, AGENTS, PARTNERS, AND LICENSORS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, LOST REVENUE, LOSS OF DATA, OR BUSINESS INTERRUPTION.
            </p>
            <p className="mt-3 uppercase text-sm font-medium text-gray-600">
              IN NO EVENT SHALL FUZEONE'S TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING UNDER THESE TERMS EXCEED THE AMOUNTS PAID BY YOU TO FUZEONE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">10. Indemnification</h2>
            <p>
              You agree to indemnify, defend, and hold harmless FuzeOne and its officers, directors, employees, agents, and successors from and against any claims, liabilities, damages, losses, and expenses (including reasonable attorneys' fees) arising from: (a) your use of the Services; (b) your violation of these Terms; (c) your violation of any third-party rights; or (d) your Customer Data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">11. Termination</h2>
            <h3 className="text-base font-semibold text-gray-800 mb-2">11.1 Termination by You</h3>
            <p>
              You may cancel your account at any time through the account settings page. Cancellation takes effect at the end of your current billing period.
            </p>
            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">11.2 Termination by FuzeOne</h3>
            <p>
              We may suspend or terminate your access to the Services immediately, with or without notice, if: (a) you breach these Terms; (b) we are required to do so by law; or (c) you fail to pay fees when due.
            </p>
            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">11.3 Effect of Termination</h3>
            <p>
              Upon termination, your right to use the Services immediately ceases. Sections that by their nature should survive termination will survive, including Sections 5, 6, 8, 9, 10, and 13.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">12. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of law provisions. You consent to the personal jurisdiction of the federal and state courts located in Delaware for any disputes arising under these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">13. Dispute Resolution</h2>
            <p>
              Any dispute arising from or relating to these Terms or the Services shall first be attempted to be resolved through good-faith negotiation between the parties. If negotiation fails after 30 days, disputes shall be submitted to binding arbitration administered by the American Arbitration Association ("AAA") under its Commercial Arbitration Rules, with proceedings conducted in Delaware.
            </p>
            <p className="mt-3">
              <strong>Class Action Waiver:</strong> You agree that any arbitration or legal proceeding shall be limited to the dispute between you and FuzeOne individually. You waive any right to participate in a class action lawsuit or class-wide arbitration.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">14. Miscellaneous</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Entire Agreement:</strong> These Terms constitute the entire agreement between you and FuzeOne regarding the Services and supersede all prior agreements.</li>
              <li><strong>Severability:</strong> If any provision of these Terms is held invalid, the remaining provisions remain in full force.</li>
              <li><strong>Waiver:</strong> Failure to enforce any right or provision does not constitute a waiver of that right.</li>
              <li><strong>Assignment:</strong> You may not assign these Terms without our prior written consent. We may assign our rights without restriction.</li>
              <li><strong>Force Majeure:</strong> Neither party is liable for delays caused by circumstances beyond their reasonable control.</li>
              <li><strong>Notices:</strong> Legal notices to FuzeOne should be sent to <a href="mailto:legal@fuzefront.com" className="text-primary-700 hover:underline">legal@fuzefront.com</a>.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-4">15. Contact</h2>
            <p>For legal inquiries related to these Terms, contact us at:</p>
            <div className="mt-4 p-5 bg-secondary-50 rounded-xl border border-secondary-200">
              <p className="font-semibold text-gray-900">FuzeOne, Inc.</p>
              <p className="text-gray-600 mt-1">Attention: Legal Team</p>
              <p className="text-gray-600">Delaware Corporation</p>
              <p className="mt-2">
                <a href="mailto:legal@fuzefront.com" className="text-primary-700 hover:underline">
                  legal@fuzefront.com
                </a>
              </p>
            </div>
          </section>

        </div>

        {/* Footer nav */}
        <div className="mt-16 pt-8 border-t border-gray-200 flex flex-wrap gap-4">
          <Link to="/privacy" className="text-primary-700 hover:text-primary-800 text-sm font-medium">
            Privacy Policy
          </Link>
          <Link to="/contact" className="text-primary-700 hover:text-primary-800 text-sm font-medium">
            Contact Us
          </Link>
          <Link to="/" className="text-primary-700 hover:text-primary-800 text-sm font-medium">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
