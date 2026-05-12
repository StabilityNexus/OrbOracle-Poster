FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Build typescript project
RUN npx tsc

CMD [ "node", "dist/index.js" ]
