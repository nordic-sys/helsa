# helsa-web — a static build, behind nginx.
# Caddy proxies :8443 here (docs/07 §4); this container does NOT face outwards.

# ⚠️ `--platform=$BUILDPLATFORM`: the bundle is JavaScript and CSS, which is the same file on
# every architecture. Building it once on the build machine and copying it into each per-arch
# nginx image is not an optimisation with a caveat — running npm under QEMU would produce the
# identical `dist`, only slowly.
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /src
COPY package.json package-lock.json* ./
# npm 11 does not run dependencies' install scripts by default; esbuild does need
# one (the allowScripts field in package.json permits it).
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
