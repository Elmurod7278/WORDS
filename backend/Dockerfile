FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY admin ./admin

EXPOSE 3000

CMD ["sh", "-c", "npm run migrate -- up && node src/server.js"]
