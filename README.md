# Pulsedesk

An independent workspace for Deriv traders: live synthetic index prices and sign-in with your own Deriv account.
Not affiliated with or endorsed by Deriv.

## Run locally

```bash
cp .env.example .env     # add your Deriv app ID
npm install
npm start                # http://localhost:3000
```

- `server.js` – Express backend (Deriv OAuth login, live tick stream)
- `public/` – the website (`index.html`, `script.js`)

Never commit your real `.env` file.
