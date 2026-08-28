FROM node:20-bookworm-slim

# Strumenti di build per eventuali moduli nativi (fallback se non c'e' un prebuild
# disponibile per la piattaforma su cui gira il container, es. better-sqlite3)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public

RUN mkdir -p /app/data /app/uploads

# Commit da cui e' stata costruita l'immagine: mostrato nell'app (sidebar,
# /api/health) cosi' si vede a colpo d'occhio se si sta girando sull'ultima
# build o su una vecchia rimasta in cache/non aggiornata. "dev" quando si fa
# una build locale senza passare questo argomento.
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "server/index.js"]
