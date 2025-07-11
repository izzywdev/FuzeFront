# 🛡️ Getting Your Permit.io API Key

## Quick Setup (5 minutes)

### 1. Create Free Account

1. Go to **https://app.permit.io**
2. Click **"Sign Up"** (it's free!)
3. Use your email or sign up with GitHub/Google

### 2. Create Project

1. Once logged in, you'll see the dashboard
2. Click **"Create Project"** or use the default project
3. Name it: **"FuzeFront"**
4. Choose **"RBAC"** as the starting model (you can add ABAC/ReBAC later)

### 3. Get API Key

1. In the left sidebar, click **"Settings"** → **"API Keys"**
2. You'll see your **Environment API Key**
3. Copy the key (starts with `permit_key_`)

### 4. Initialize FuzeFront

```powershell
# Run the empire initialization with your API key
.\scripts\initialize-empire.ps1 -PermitApiKey "permit_key_xxxxxxxxxxxxxxxxx"
```

## What You Get

- **RBAC Policies**: Role-based access control out of the box
- **Multi-Tenant Support**: Automatic tenant isolation
- **Policy Dashboard**: Visual policy management
- **Real-time Updates**: Policies update without restarts
- **Analytics**: Authorization decision monitoring

## Example Roles & Resources

The script will help you set up:

```yaml
Roles:
  - viewer: Read-only access
  - member: Basic operations
  - admin: Management access
  - owner: Full control

Resources:
  - organization: Multi-tenant organizations
  - app: Federated applications
  - api_key: API key management

Actions:
  - read: View resources
  - write: Modify resources
  - delete: Remove resources
  - manage: Full administrative access
```

## Need Help?

- 📚 **Permit.io Docs**: https://docs.permit.io
- 💬 **Support**: support@permit.io
- 🐛 **FuzeFront Issues**: Create GitHub issue in this repo

## Next Steps

After getting your API key:

1. Run `.\scripts\initialize-empire.ps1` with your key
2. The script will set up the complete multi-tenant platform
3. Configure policies in the Permit.io dashboard
4. Test authorization in FuzeFront!
