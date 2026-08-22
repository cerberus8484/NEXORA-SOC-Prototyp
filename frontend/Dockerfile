# Stage 1: Frontend build
# Build context = repo root, so frontend/ and deploy/nginx/ are available.
FROM node:20-alpine AS build

WORKDIR /app

# Internal wiki base for tooltip "more" links. Empty = no link rendered.
ARG VITE_WIKI_BASE_URL=
ENV VITE_WIKI_BASE_URL=$VITE_WIKI_BASE_URL

# Install dependencies first for better layer caching.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy frontend sources and build the SPA.
COPY frontend/ ./
RUN npm run build

# Stage 2: nginx web image
FROM nginx:1.27-alpine AS web

COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
