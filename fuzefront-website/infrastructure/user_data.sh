#!/bin/bash

# Simple user data script for FuzeFront Website deployment
# This script sets up the basic environment and a deployment mechanism

# Update system
yum update -y

# Install Docker
yum install -y docker
systemctl start docker
systemctl enable docker
usermod -a -G docker ec2-user

# Install AWS CLI
yum install -y aws-cli

# Install and start SSM agent
yum install -y amazon-ssm-agent
systemctl enable amazon-ssm-agent
systemctl start amazon-ssm-agent

# Create application directory
mkdir -p /opt/fuzefront-website
cd /opt/fuzefront-website

# Create deployment script that will be called by CI/CD
cat > /opt/fuzefront-website/deploy.sh << 'EOF'
#!/bin/bash

# This script will be executed by the deployment process
# It pulls latest images from ECR and restarts services

set -e

echo "Starting deployment at $(date)"

# Get AWS account ID and region
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-east-1}

# ECR repository URIs
BACKEND_IMAGE="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/fuzefront-website-backend:latest"
FRONTEND_IMAGE="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/fuzefront-website-frontend:latest"

# Login to ECR
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Pull latest images
echo "Pulling latest Docker images..."
docker pull ${BACKEND_IMAGE}
docker pull ${FRONTEND_IMAGE}

# Stop existing containers
echo "Stopping existing containers..."
docker stop fuzefront-backend fuzefront-frontend fuzefront-nginx || true
docker rm fuzefront-backend fuzefront-frontend fuzefront-nginx || true

# Start backend
echo "Starting backend container..."
docker run -d \
  --name fuzefront-backend \
  --restart unless-stopped \
  -p 3001:3001 \
  -e NODE_ENV=production \
  -e PORT=3001 \
  ${BACKEND_IMAGE}

# Start frontend  
echo "Starting frontend container..."
docker run -d \
  --name fuzefront-frontend \
  --restart unless-stopped \
  -p 3000:80 \
  ${FRONTEND_IMAGE}

# Wait for services to be ready
echo "Waiting for services to start..."
sleep 10

# Start nginx reverse proxy
echo "Starting nginx reverse proxy..."
docker run -d \
  --name fuzefront-nginx \
  --restart unless-stopped \
  -p 80:80 \
  --link fuzefront-backend:backend \
  --link fuzefront-frontend:frontend \
  nginx:alpine

# Configure nginx
docker exec fuzefront-nginx sh -c 'cat > /etc/nginx/nginx.conf << "NGINX_EOF"
events {
    worker_connections 1024;
}

http {
    upstream backend {
        server backend:3001;
    }
    
    upstream frontend {
        server frontend:80;
    }
    
    server {
        listen 80;
        
        # Health check endpoint
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
        
        # API proxy to backend
        location /api/ {
            proxy_pass http://backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
        
        # Frontend proxy
        location / {
            proxy_pass http://frontend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
NGINX_EOF'

# Reload nginx with new config
docker exec fuzefront-nginx nginx -s reload

echo "Deployment completed successfully at $(date)"
EOF

# Make deploy script executable
chmod +x /opt/fuzefront-website/deploy.sh

# Create a simple initial setup
cat > /opt/fuzefront-website/initial-setup.sh << 'EOF'
#!/bin/bash

# Initial setup - just serve a simple page until deployment runs
echo "Setting up initial web server..."

# Create a simple nginx container for health checks
docker run -d \
  --name fuzefront-nginx \
  --restart unless-stopped \
  -p 80:80 \
  nginx:alpine

# Configure nginx for health checks
docker exec fuzefront-nginx sh -c 'cat > /etc/nginx/nginx.conf << "NGINX_EOF"
events {
    worker_connections 1024;
}

http {
    server {
        listen 80;
        
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
        
        location / {
            access_log off;
            return 200 "FuzeFront Website - Deployment in Progress\n";
            add_header Content-Type text/plain;
        }
    }
}
NGINX_EOF'

docker exec fuzefront-nginx nginx -s reload

echo "Initial setup completed"
EOF

# Make initial setup executable
chmod +x /opt/fuzefront-website/initial-setup.sh

# Run initial setup
/opt/fuzefront-website/initial-setup.sh

echo "User data script completed!"