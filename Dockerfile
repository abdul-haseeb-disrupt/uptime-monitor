FROM node:20-alpine

RUN apk add --no-cache iputils

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY src/ ./src/
COPY views/ ./views/
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "src/server.js"]
