FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Krasnoyarsk

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

RUN mkdir -p logs data

CMD ["node", "src/index.js"]
