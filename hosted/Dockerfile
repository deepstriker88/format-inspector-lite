FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./package.json
COPY hosted/package.json ./hosted/package.json
COPY src ./src
COPY hosted/src ./hosted/src
COPY hosted/public ./hosted/public
COPY hosted/scripts/backup.js ./hosted/scripts/backup.js
RUN mkdir -p /data && chown -R node:node /app /data
ENV NODE_ENV=production
ENV PORT=8787
ENV DB_PATH=/data/commerce.sqlite
ENV NODE_NO_WARNINGS=1
USER node
EXPOSE 8787
CMD ["node","hosted/src/server.js"]
