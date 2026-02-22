# Taquería El Cerebro - POS

## Quick Start (Local)
```bash
# Terminal 1 - Backend
cd server
npm install
node index.js

# Terminal 2 - Frontend
cd client
npm install
npm run dev
```

## Deploy to Render (Production)
1. Push to GitHub
2. Create a [Neon](https://neon.tech) free PostgreSQL database
3. Copy the DATABASE_URL connection string
4. Create a Web Service on [Render](https://render.com)
5. Connect your GitHub repo
6. Set environment variables:
   - `DATABASE_URL` = your Neon connection string
   - `NODE_ENV` = production

## Environment Variables
| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (only for production) |
| `NODE_ENV` | Set to `production` for deployment |
| `PORT` | Server port (default: 3001) |
