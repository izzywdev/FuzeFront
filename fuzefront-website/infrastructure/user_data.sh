#!/bin/bash

# Simple user data script for FuzeFront Website deployment
# This script sets up the basic environment and a deployment mechanism

# Update system
apt-get update -y

# Configure passwordless sudo for ubuntu user
echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' | tee /etc/sudoers.d/99-ubuntu-nopasswd
chmod 440 /etc/sudoers.d/99-ubuntu-nopasswd

# Install Docker
apt-get install -y docker.io
systemctl start docker
systemctl enable docker
usermod -a -G docker ubuntu

# Install AWS CLI
apt-get install -y awscli

# Install and start SSM agent (already installed on Ubuntu AMIs)
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

# Create Docker network for container communication
docker network create fuzefront-network || true

# Start backend first
echo "Starting backend container..."
docker run -d \
  --name fuzefront-backend \
  --network fuzefront-network \
  --restart unless-stopped \
  -e NODE_ENV=production \
  -e PORT=3001 \
  ${BACKEND_IMAGE}

# Wait for backend to be ready
echo "Waiting for backend to start..."
sleep 10

# Start frontend (includes built-in nginx with API proxying)
echo "Starting frontend container with built-in nginx..."
docker run -d \
  --name fuzefront-frontend \
  --network fuzefront-network \
  --restart unless-stopped \
  -p 80:80 \
  ${FRONTEND_IMAGE}

# Verify containers are running and networked
echo "Verifying container network connectivity..."
docker exec fuzefront-frontend sh -c "ping -c 1 fuzefront-backend" || echo "Warning: Backend ping failed"

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