FROM node:lts-alpine
WORKDIR /usr/src/app

COPY package.json package-lock.json* ./
RUN npm ci
RUN npm install
# RUN npm install nodemon -g
RUN export NODE_TLS_REJECT_UNAUTHORIZED=0   
COPY . .
ENV NODE_ENV=development
EXPOSE 3001
CMD ["npm","run","dev"]


