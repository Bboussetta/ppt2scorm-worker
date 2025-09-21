FROM node:20-slim

# Install LibreOffice (Impress) + Poppler (pdftoppm) + common fonts
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libreoffice-impress \
      poppler-utils \
      fonts-dejavu fonts-liberation && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY server.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
