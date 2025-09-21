FROM node:20-slim

# Install LibreOffice (Impress) + Poppler (pdftoppm) + fonts
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libreoffice-impress \
      poppler-utils \
      fonts-dejavu fonts-liberation && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package.json only first (better cache)
COPY package.json ./

# Install dependencies (no lockfile needed)
RUN npm install --omit=dev --no-audit --no-fund

# Copy app code
COPY server.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
