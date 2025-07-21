#!/bin/bash

# AI Workflow Agent Setup Script
# This script helps set up the AI Workflow Agent system

set -e

echo "🤖 AI Workflow Agent Setup"
echo "========================="

# Check if running in correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the ai-workflow-agent directory"
    exit 1
fi

# Check Node.js version
echo "📋 Checking Node.js version..."
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt "18" ]; then
    echo "❌ Error: Node.js 18 or higher is required (current: $(node --version))"
    exit 1
fi
echo "✅ Node.js version: $(node --version)"

# Check required tools
echo "📋 Checking required tools..."
command -v git >/dev/null 2>&1 || { echo "❌ Error: git is required but not installed"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "❌ Error: curl is required but not installed"; exit 1; }
echo "✅ Required tools available"

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p logs
mkdir -p ../docs/chats
echo "✅ Directories created"

# Copy environment template
echo "⚙️  Setting up environment..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "✅ Environment template copied to .env"
    echo "📝 Please edit .env with your configuration"
else
    echo "✅ .env file already exists"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "✅ Dependencies installed"

# Build the application
echo "🔨 Building application..."
npm run build
echo "✅ Application built"

# Check environment variables
echo "🔍 Checking environment configuration..."
if [ -f ".env" ]; then
    source .env
    
    # Check required variables
    MISSING_VARS=()
    
    [ -z "$ANTHROPIC_API_KEY" ] && MISSING_VARS+=("ANTHROPIC_API_KEY")
    [ -z "$GITHUB_TOKEN" ] && MISSING_VARS+=("GITHUB_TOKEN")
    [ -z "$WEBHOOK_SECRET" ] && MISSING_VARS+=("WEBHOOK_SECRET")
    
    if [ ${#MISSING_VARS[@]} -gt 0 ]; then
        echo "⚠️  Missing required environment variables:"
        for var in "${MISSING_VARS[@]}"; do
            echo "   - $var"
        done
        echo "📝 Please update your .env file with the missing variables"
    else
        echo "✅ All required environment variables are set"
    fi
fi

# Test the application
echo "🧪 Testing application..."
if npm test 2>/dev/null; then
    echo "✅ Tests passed"
else
    echo "⚠️  Tests not configured or failed"
fi

# Setup instructions
echo ""
echo "🚀 Setup Complete!"
echo "=================="
echo ""
echo "Next steps:"
echo "1. Configure your .env file with:"
echo "   - ANTHROPIC_API_KEY (get from https://console.anthropic.com/)"
echo "   - GITHUB_TOKEN (create at https://github.com/settings/tokens)"
echo "   - WEBHOOK_SECRET (generate a secure random string)"
echo ""
echo "2. Start the development server:"
echo "   npm run dev"
echo ""
echo "3. For production deployment:"
echo "   docker-compose up -d"
echo ""
echo "4. Configure GitHub webhook:"
echo "   - Go to your repository Settings → Webhooks"
echo "   - Add webhook URL: https://your-domain.com/webhook/workflow-failure"
echo "   - Content type: application/json"
echo "   - Secret: your WEBHOOK_SECRET"
echo "   - Events: Workflow runs"
echo ""
echo "5. Add GitHub secrets:"
echo "   - AI_AGENT_WEBHOOK_URL=https://your-domain.com/webhook/workflow-failure"
echo "   - AI_AGENT_WEBHOOK_SECRET=your-webhook-secret"
echo ""
echo "📚 For detailed instructions, see README.md"
echo "🐛 For troubleshooting, check logs/ directory"
echo ""
echo "🎉 AI Workflow Agent is ready to handle your workflow failures!"