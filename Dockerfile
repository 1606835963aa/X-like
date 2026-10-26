FROM node:24.22.0-bookworm-slim
WORKDIR /app
COPY dist/server /app/server
COPY dist/ui /app/ui
COPY dist/legal /app/legal
ENV NODE_ENV=production SHIZANG_DATA_DIR=/data PORT=5368 HOST=0.0.0.0
EXPOSE 5368
CMD ["node", "/app/server/entry.cjs"]
