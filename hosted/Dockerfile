FROM node:22-bookworm-slim
WORKDIR /app
COPY src ./src
COPY hosted ./hosted
RUN mkdir -p /data && chown -R node:node /app /data
ENV NODE_ENV=production
ENV PORT=8787
ENV DB_PATH=/data/commerce.sqlite
ENV NODE_NO_WARNINGS=1
USER node
EXPOSE 8787
CMD ["node","hosted/src/server.js"]
