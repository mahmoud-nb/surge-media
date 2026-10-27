---
question: "How do users sign in?"
order: 2
status: available
keywords: ["authentication","login","password","argon2","session","sudo","invitation"]
related:
  - label: "Roles & responsibilities"
    href: "/guides/roles/"
---
With an email address and a password, on accounts created by invitation: there is no public sign-up. Passwords are hashed with argon2id, and sessions are stored server-side and can be revoked at any time.

Sensitive actions, such as creating a secret key or changing the members of a project, ask for the password again, and sign-in attempts are rate-limited.
