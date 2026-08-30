# Stage 1: Frontend build
# Build context = repo root, so frontend/, deploy/nginx/ and docs/ are available.
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

# Stage 2: MkDocs build
# The operator-private docs tree may exist only on the deployment host.
# If mkdocs config or requirements are missing, this stage leaves /out/site empty.
FROM python:3.12-alpine AS docs-build

WORKDIR /repo

COPY . ./

RUN mkdir -p /out/site \
 && if [ -f mkdocs.yml ] && [ -f requirements-docs.txt ] && [ -d docs ]; then \
      python -m pip install --no-cache-dir -r requirements-docs.txt \
      && python -m mkdocs build --clean --site-dir /out/site; \
    fi

# Stage 3: nginx web image
FROM nginx:1.27-alpine AS web

COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=docs-build /out/site /usr/share/nginx/html/docs

EXPOSE 80 443
