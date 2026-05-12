# ZenPass 禪流 — Production Docker Image
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --only=production

# Copy backend source
COPY backend/src ./backend/src
COPY backend/.env.example ./backend/.env

# Copy frontend static files
COPY frontend ./frontend

EXPOSE 3001

WORKDIR /app/backend
CMD ["node", "src/index.js"]
