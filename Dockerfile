FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
RUN mkdir -p data && chown node:node data

USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
