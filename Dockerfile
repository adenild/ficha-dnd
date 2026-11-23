FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_FILE=/data/db.json \
    IN_DOCKER=1

WORKDIR /app
COPY package.json server.js mcp.js ./
COPY public ./public

# os dados ficam num volume, fora da imagem; o usuário node não roda como root
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["node", "server.js"]
