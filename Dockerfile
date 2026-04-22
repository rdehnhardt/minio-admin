FROM node:22-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY server.js ./
COPY public ./public

EXPOSE 3000

CMD ["node", "server.js"]
