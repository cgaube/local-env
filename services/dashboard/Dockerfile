FROM oven/bun:1.4.4-alpine

WORKDIR /app
COPY server.ts ./
# Built by `bun run compile` from apps/web
COPY public ./public

EXPOSE 80
CMD ["bun", "server.ts"]
