# Этап сборки
FROM node:20-alpine AS builder

# Метки с информацией о проекте
LABEL org.opencontainers.image.title="Storage Monitoring System"
LABEL org.opencontainers.image.description="Система мониторинга температуры и влажности на складах"
LABEL org.opencontainers.image.version="0.4.0"
LABEL org.opencontainers.image.authors="Viktor Agafonov"
LABEL org.opencontainers.image.source="https://github.com/ViktorAgafonov/NodeModBus"

# Устанавливаем все зависимости, включая devDependencies
WORKDIR /app
COPY package*.json ./
RUN npm install

# Копируем исходники
COPY . .

# Финальный этап - минимальный образ
FROM node:20-alpine

# Копируем метки из этапа сборки
LABEL org.opencontainers.image.title="Storage Monitoring System"
LABEL org.opencontainers.image.description="Система мониторинга температуры и влажности на складах"
LABEL org.opencontainers.image.version="0.4.0"
LABEL org.opencontainers.image.authors="Viktor Agafonov"
LABEL org.opencontainers.image.source="https://github.com/ViktorAgafonov/NodeModBus"

# Устанавливаем временную зону
ENV TZ=Europe/Moscow

# Аргументы для UID и GID пользователя
ARG PUID=1001
ARG PGID=1001

# Создаем пользователя для безопасности
RUN addgroup -g $PGID -S nodegroup && adduser -u $PUID -S nodeuser -G nodegroup

WORKDIR /app

# Копируем только необходимые файлы из этапа сборки
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/PUBLIC ./PUBLIC
COPY --from=builder /app/config/ ./config/
COPY --from=builder /app/test ./test
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/mock-modbus-server.js ./mock-modbus-server.js

# Меняем владельца файлов
RUN chown -R nodeuser:nodegroup /app

RUN apk add nano mc

# Переключаемся на непривилегированного пользователя
USER nodeuser

# Создаем директорию для архива
RUN mkdir -p /app/archive && chown -R nodeuser:nodegroup /app/archive

# Открываем порты
EXPOSE 3000 502

# Команда запуска по умолчанию (может быть переопределена в docker-compose)
CMD ["npm", "test"]