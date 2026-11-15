FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3456 \
    HOST=0.0.0.0 \
    NOVA_DATA_DIR=/data \
    AGENT_WORKSPACE=/workspace

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY public ./public

RUN mkdir -p /data /workspace \
    && chown -R node:node /app /data /workspace

USER node
EXPOSE 3456

CMD ["node", "server.js"]
