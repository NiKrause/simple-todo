FROM node:22-alpine

WORKDIR /app

COPY . .
RUN npm install --omit=dev


# Expose ports
# 4001: WebSocket
# 4002: TCP
# 4003: WebRTC 
# 4006: WebRTC Direct
# 3000: HTTP API
EXPOSE 4001 4002 4003 4006 3000

# Set default environment variables
ENV NODE_ENV=production

# Run the enhanced relay server
CMD ["node", "relay-enhanced.js"]