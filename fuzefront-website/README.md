# FuzeFront Corporate Website

The official corporate website for FuzeFront, built with React, Node.js, and deployed on AWS.

## 🚀 Features

- **Modern React Frontend** with TypeScript and Tailwind CSS
- **Node.js Backend** with Express and comprehensive API
- **Responsive Design** optimized for all devices
- **SEO Optimized** with meta tags and structured data
- **Performance Optimized** with lazy loading and code splitting
- **Analytics Integration** with custom analytics tracking
- **Contact Forms** with email notifications
- **Newsletter Subscription** with validation
- **Cookie Consent** with GDPR compliance
- **Security Headers** and rate limiting
- **AWS Deployment** with auto-scaling and SSL

## 🛠️ Tech Stack

### Frontend
- React 18 with TypeScript
- Vite for fast development and building
- Tailwind CSS for styling
- Framer Motion for animations
- React Router for navigation
- React Hook Form for form handling
- Axios for API requests

### Backend
- Node.js with Express
- TypeScript for type safety
- Zod for validation
- Nodemailer for email sending
- Rate limiting and security middleware
- Health check endpoints

### Infrastructure
- AWS EC2 with Auto Scaling Groups
- Application Load Balancer with SSL
- Route53 for DNS management
- ACM for SSL certificates
- CloudWatch for monitoring
- Docker for containerization

## 🏗️ Development Setup

### Prerequisites
- Node.js 18+
- Docker and Docker Compose
- AWS CLI (for deployment)
- Terraform (for infrastructure)

### Local Development

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd fuzefront-website
   ```

2. **Install dependencies**
   ```bash
   # Backend
   cd backend
   npm install
   
   # Frontend
   cd ../frontend
   npm install
   ```

3. **Set up environment variables**
   ```bash
   # Copy example files
   cp .env.example .env
   cp backend/.env.example backend/.env
   
   # Edit the .env files with your configuration
   ```

4. **Start development servers**
   ```bash
   # Backend (from backend directory)
   npm run dev
   
   # Frontend (from frontend directory)
   npm run dev
   ```

5. **Or use Docker Compose**
   ```bash
   docker-compose up -d
   ```

### Building for Production

```bash
# Build backend
cd backend
npm run build

# Build frontend
cd frontend
npm run build
```

## 🚀 Deployment

### AWS Infrastructure Setup

1. **Configure AWS credentials**
   ```bash
   aws configure
   ```

2. **Deploy infrastructure with Terraform**
   ```bash
   cd infrastructure
   terraform init
   terraform plan -var="domain_name=fuzefront.com" -var="ssl_email=admin@fuzefront.com"
   terraform apply
   ```

3. **Update your domain's nameservers**
   Update your domain registrar to use the Route53 nameservers output by Terraform.

### Automated Deployment

The project includes GitHub Actions workflows for automated deployment:

1. **Set up GitHub Secrets**
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `DOMAIN_NAME`
   - `SSL_EMAIL`
   - `SSH_PUBLIC_KEY`

2. **Push to main branch**
   ```bash
   git push origin main
   ```

The workflow will:
- Run tests and linting
- Build and push Docker images to ECR
- Deploy infrastructure with Terraform
- Update the Auto Scaling Group
- Verify deployment health

## 🔧 Configuration

### Environment Variables

#### Backend
- `NODE_ENV` - Environment (development/production)
- `PORT` - Server port (default: 3001)
- `FRONTEND_URL` - Frontend URL for CORS
- `EMAIL_USER` - SMTP username
- `EMAIL_PASS` - SMTP password
- `EMAIL_FROM` - From email address
- `EMAIL_TO` - Contact form recipient

#### Frontend
- `VITE_API_URL` - Backend API URL

### Infrastructure Variables

#### Terraform
- `domain_name` - Your domain name
- `ssl_email` - Email for SSL certificates
- `aws_region` - AWS region (default: us-east-1)
- `instance_type` - EC2 instance type (default: t3.micro)
- `min_size` - Minimum instances (default: 1)
- `max_size` - Maximum instances (default: 3)
- `desired_capacity` - Desired instances (default: 2)

## 📊 Monitoring

The deployment includes:
- **Application Load Balancer** health checks
- **CloudWatch** metrics and logs
- **Auto Scaling** based on CPU utilization
- **SSL certificate** auto-renewal
- **Log rotation** for nginx logs

## 🔒 Security

Security features include:
- **HTTPS** with automatic certificate management
- **Security headers** (HSTS, CSP, etc.)
- **Rate limiting** on API endpoints
- **Input validation** and sanitization
- **CORS** configuration
- **Non-root** Docker containers

## 🧪 Testing

```bash
# Backend tests
cd backend
npm test
npm run test:watch
npm run test:coverage

# Frontend tests
cd frontend
npm test
npm run test:coverage

# Linting
npm run lint
npm run type-check
```

## 📝 API Documentation

The backend includes the following endpoints:

### Health Check
- `GET /health` - Health check endpoint

### Contact Form
- `POST /api/contact/submit` - Submit contact form

### Newsletter
- `POST /api/newsletter/subscribe` - Subscribe to newsletter
- `POST /api/newsletter/unsubscribe` - Unsubscribe from newsletter

### Analytics
- `POST /api/analytics/page-view` - Track page views
- `POST /api/analytics/event` - Track custom events

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run linting and tests
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support, please contact:
- Email: contact@fuzefront.com
- Website: https://fuzefront.com

## 🗺️ Architecture

```
Internet
    ↓
Application Load Balancer (HTTPS)
    ↓
Auto Scaling Group (EC2 Instances)
    ↓
Docker Containers
    ├── Nginx (Reverse Proxy)
    ├── Frontend (React)
    └── Backend (Node.js)
```

The infrastructure is designed for high availability and scalability with automatic SSL certificate management and monitoring.

---
🚀 **Ready for deployment!** - Last updated: July 11, 2025