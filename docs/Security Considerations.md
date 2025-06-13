# 🔐 Open Source Authentication (AuthN) Solutions for Node.js, Python & React

## ✅ Requirements

- Google Sign-In
- SSO (SAML / OpenID Connect)
- OAuth2 (Provider + Client)
- MFA (TOTP, SMS, Email)
- LDAP integration
- Email verification
- SMS verification

---

## 🔝 Top 3 AuthN Solutions

| Name            | Language         | Frontend SDK   | Highlights                                                       | Downsides                       |
| --------------- | ---------------- | -------------- | ---------------------------------------------------------------- | ------------------------------- |
| **Authentik**   | Python (Django)  | OIDC-compliant | Lightweight SSO & IdP, modern UI, LDAP, MFA, email/SMS support   | Needs separate service instance |
| **Keycloak**    | Java             | OIDC, SAML     | Very complete, supports all features including role-based access | Heavy, complex to customize     |
| **SuperTokens** | Node.js / Python | React, others  | Easy integration, MFA, email/passwordless, social login          | LDAP/SMS require workarounds    |

---

## 💡 Recommendation Breakdown

### 1. **Authentik**

- ✅ Google, SAML, OAuth2, LDAP, MFA, Email, SMS
- ✅ OpenID Connect, SSO portal, native email/social login
- 🔧 Easy to deploy with Docker
- 🌍 [https://goauthentik.io/](https://goauthentik.io/)

### 2. **Keycloak**

- ✅ Covers everything: Google, Facebook, SSO, OAuth, SAML, LDAP, MFA, SMS
- ✅ Full role-based access control, user federation
- 🧱 Heavyweight, best with Docker or K8s
- 🌍 [https://www.keycloak.org/](https://www.keycloak.org/)

### 3. **SuperTokens**

- ✅ Social login, email/password, passwordless
- ✅ Email verification, JWT sessions, TOTP MFA
- ⚠️ SMS & LDAP not native; commercial tier may help
- 🌍 [https://supertokens.com/](https://supertokens.com/)

---

## 📦 Feature Comparison

| Feature                | Keycloak | Authentik | SuperTokens    |
| ---------------------- | -------- | --------- | -------------- |
| Google Sign-In         | ✅       | ✅        | ✅             |
| SSO (SAML/OIDC)        | ✅       | ✅        | ✅ (OIDC only) |
| OAuth2 Provider/Client | ✅ / ✅  | ✅ / ✅   | Client only    |
| MFA (TOTP/WebAuthn)    | ✅       | ✅        | ✅ (TOTP only) |
| SMS MFA                | ✅       | ✅        | 🔧 custom      |
| LDAP Integration       | ✅       | ✅        | ❌             |
| Email Verification     | ✅       | ✅        | ✅             |
| Passwordless           | ✅       | ✅        | ✅             |
| React SDK              | OIDC     | OIDC      | ✅ Native      |
| Admin UI               | ✅       | ✅        | Partial        |
| Deployment Complexity  | High     | Moderate  | Low            |

---

## 🔧 Deployment Notes

- **Keycloak**: Use Docker + PostgreSQL or Helm chart for Kubernetes.
- **Authentik**: Python-based, lightweight and Docker-friendly.
- **SuperTokens**: Plug directly into Node.js/Python backend, easy frontend SDK.

---

## ✅ Summary

- Use **SuperTokens** for quick, developer-friendly integration.
- Use **Authentik** for lightweight, modern full-featured identity provider.
- Use **Keycloak** for enterprise-grade identity management if you can manage the complexity.

Need boilerplate setup with React + Node/Python backend? Ask for a starter pack.
