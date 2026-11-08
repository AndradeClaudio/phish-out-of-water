# Disposable detonation sandbox: one container per link, destroyed right after.
FROM mcr.microsoft.com/playwright:v1.64.1-noble AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npx tsc

FROM mcr.microsoft.com/playwright:v1.64.1-noble
ENV NODE_ENV=production
WORKDIR /detonator
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /build/dist ./dist
USER pwuser
ENTRYPOINT ["node", "/detonator/dist/detonate.js"]
