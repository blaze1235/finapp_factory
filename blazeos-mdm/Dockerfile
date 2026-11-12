# BlazeOS MDM — single-image build: Express serves the API + the built React app.
FROM node:24-slim

WORKDIR /app

# OpenSSL + CA certs are required by Prisma's query engine at build and runtime.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install deps first (better layer caching). Force dev deps so the build
# toolchain (tsc, vite, tsx, typescript) is present even when the platform
# injects NODE_ENV=production into the build environment.
COPY package.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json

RUN npm --prefix server install --include=dev --no-audit --no-fund \
  && npm --prefix web install --include=dev --no-audit --no-fund

# Copy the rest of the source and build:
#   web  -> web/dist (static React app)
#   server -> server/dist (compiled Express) + generated Prisma client
COPY . .
RUN npm run build

# Runtime: start:prod runs `prisma db push`, seeds demo data only if the DB is
# empty, then starts the server (which also serves web/dist).
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["npm", "start"]
