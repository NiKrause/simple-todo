# Use Node.js 22 Alpine for smaller image size
FROM node:22-alpine AS base

# Install pnpm globally
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Production stage
FROM node:22-alpine AS production

# Install pnpm globally and curl for health checks
RUN npm install -g pnpm && apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (needed for server-side OrbitDB)
RUN pnpm install --frozen-lockfile

# Copy built application from build stage
COPY --from=base /app/build ./build
COPY --from=base /app/static ./static
COPY --from=base /app/src ./src

# Create data directories for persistent storage
RUN mkdir -p /app/server-orbitdb /app/server-helia-blocks /app/server-helia-data

# Expose port 3000
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Start the SSR Node.js server
CMD ["node", "build/index.js"]
