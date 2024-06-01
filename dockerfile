FROM node:20-alpine AS builder
WORKDIR /usr/src/app

COPY . .

RUN npm install
RUN npm run prod:build

FROM node:20-alpine
WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/dist ./dist
COPY package*.json ./

COPY entrypoint.sh ./
RUN ["chmod", "+x", "./entrypoint.sh"]

EXPOSE 5000
EXPOSE 5001

ENTRYPOINT [ "./entrypoint.sh" ]
