import React from 'react'
import { useParams, Link } from 'react-router-dom'

export const ProductDetailPage: React.FC = () => {
  const { productSlug } = useParams<{ productSlug: string }>()

  return (
    <div className="bg-white pt-16">
      <section className="py-24 bg-gradient-to-br from-gray-900 to-blue-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-6 capitalize">
            {productSlug?.replace(/-/g, ' ')}
          </h1>
          <Link to="/products" className="text-blue-300 hover:text-white transition-colors">
            ← Back to Products
          </Link>
        </div>
      </section>
    </div>
  )
}

export default ProductDetailPage
