# Используем официальный Node.js образ
FROM node:20-slim

# Устанавливаем зависимости для Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    libasound2 \
    libxshmfence1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get autoremove -y

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости (без dev)
RUN npm ci --only=production

# Копируем весь проект
COPY . .

# Билдим проект
RUN npm run build

# Переменные окружения для Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Переменные для экономии памяти в контейнере
ENV NODE_OPTIONS="--max-old-space-size=512"

# Открываем порт
EXPOSE 1337

# Запускаем Strapi
CMD ["npm", "run", "start"]
