// Константы для настройки опроса датчиков
const MODBUS_SETTINGS = {
    // Таймауты
    CONNECT_TIMEOUT: 1000,      // Таймаут на подключение (мс)
    MIN_POLL_DELAY: 500,      // Минимальная задержка между опросами складов (мс)
    READ_TIMEOUT: 250,          // Таймаут на чтение (мс)
    READ_RETRIES: 2,           // Количество повторных попыток чтения
    RETRY_DELAY: 100,          // Задержка между повторными попытками (мс)

    // Пороговые значения
    SIGNIFICANT_CHANGE: 0.001,  // Порог для логирования изменений значений, в абсолютных единицах значения
    DEFAULT_SENSOR_ADDRESS: 2,  // Адрес датчика по умолчанию
    DEFAULT_REGISTER_COUNT: 2  // Количество регистров по умолчанию
};

const API_LOG_TIMEOUT = 6000; // Таймаут для логирования API запросов с одного IP (6 секунд) 
const DISK_USAGE_CACHE_TIMEOUT = 60000 * 10; // Таймаут кэширования размера файлов (10 минут в миллисекундах)

// Кэш для хранения информации о размере файлов
let diskUsageCache = {
    data: null,
    lastUpdate: 0
};

// Флаг для предотвращения параллельного подсчета размера директории
let isCalculatingDirectorySize = false;

const LIMIT_SETTINGS = {
    DIFFERENT_LIMIT: 0.001,     // Разница между значениями для определения старых данных
    FIXED_VALUE: 3              // округлить значение датчика после получения
}
// Форматы времени и даты
const TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

const express = require('express');
const path = require('path');
const compression = require('compression');
const ModbusRTU = require('modbus-serial');
const config = require('config');
const { saveToArchive } = require('./storage/archive');
const { zipOldArchive } = require('./storage/archive');
const logger = require(path.join(__dirname, 'utils', 'logger'));
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
const EventEmitter = require('events');
const { decodeModbusValue } = require('./utils/dataConverter');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

// Добавляем gzip компрессию
app.use(compression());

// Ограничение размера запросов
const requestLimit = config.settings?.api?.requestLimit || '5mb';
app.use(express.json({ limit: requestLimit }));
app.use(express.urlencoded({ extended: true, limit: requestLimit }));

// Делаем currentSensorData глобальным
global.currentSensorData = {};

// Генерируем ID для складов и датчиков
config.storages.forEach((storage, index) => {
    // Генерируем ID склада
    storage.id = `storage_${index + 1}`;

    // Счетчики для каждого типа датчиков
    const sensorCounters = {
        temperature: 0,
        humidity: 0
    };

    // Генерируем ID для каждого датчика
    storage.device.sensors.forEach(sensor => {
        sensorCounters[sensor.type]++;
        sensor.id = `${storage.id}.${sensor.type}_${sensorCounters[sensor.type]}`;
    });
});

// Сохраняем конфигурацию в глобальную переменную
global.config = config;

// Инициализация Modbus клиентов для каждого склада
const modbusClients = config.storages.map(storage => {
    const client = new ModbusRTU();
    return {
        storage: storage.name,
        client,
        connected: false
    };
});

// Создаем эмиттер для управления опросом
const pollManager = new EventEmitter();
let isPolling = false;
let pollTimeout = null;

// Обновляем метрики
global.metrics = {
    errors: {
        connection: 0,
        sensor: 0,
        timeout: 0,
        decode: 0
    },
    performance: {
        lastPollDuration: 0,
        avgPollDuration: 0,
        pollHistory: [], // Массив для хранения истории опросов за последний час
        lastHourPolls: 0, // Общее количество опросов за последний час
        lastHourFailedPolls: 0 // Количество неудачных опросов за последний час
    },
    lastErrorTime: null,
    staleData: {
        count: 0,
        lastTimestamp: null,
        repeatedTimestamp: null,
        affectedSensors: {}
    },
    system: {
        memoryUsage: 0,
        cpuLoad: 0,
        uptime: 0,
        diskUsage: {
            total: 0,
            archived: 0
        }
    },
    activeClients: {
        count: 0,
        clients: {}
    }
};

// Функция для подсчета размера файлов в директории с кэшированием
async function calculateDirectorySize(directory) {
    const now = Date.now();

    // Проверяем наличие актуального кэша
    if (diskUsageCache.data && (now - diskUsageCache.lastUpdate) < DISK_USAGE_CACHE_TIMEOUT) {
        logger.debug('Возвращаем размер файлов из кэша');
        return diskUsageCache.data;
    }

    // Проверяем, не выполняется ли уже подсчет размера директории
    if (isCalculatingDirectorySize) {
        logger.warn('Операция подсчета размера директории уже выполняется, возвращаем последние данные из кэша');
        // Возвращаем последние данные из кэша, даже если они устарели
        return diskUsageCache.data || { totalSize: 0, archivedSize: 0, activeSize: 0 };
    }

    try {
        isCalculatingDirectorySize = true; // Устанавливаем флаг выполнения
        
        logger.debug('Подсчитываем размер файлов...');
        let totalSize = 0;
        let archivedSize = 0;
        let activeSize = 0;

        // Сначала обрабатываем основную директорию archive для активных данных
        logger.debug(`Чтение директории ${directory}`);
        const mainFiles = await fs.readdir(directory);
        logger.debug(`Найдено ${mainFiles.length} файлов в основной директории`);
        
        for (const file of mainFiles) {
            const filePath = path.join(directory, file);
            logger.debug(`Обработка файла ${filePath}`);
            const stats = await fs.stat(filePath);
            
            if (stats.isFile() && file.endsWith('.json')) {
                const size = stats.size;
                activeSize += size;
                totalSize += size;
            }
        }

        // Затем обрабатываем папку OLD для архивных данных (унифицировано с archive.js)
        const oldDir = path.join(directory, 'OLD');
        try {
            logger.debug(`Чтение директории ${oldDir}`);
            const oldFiles = await fs.readdir(oldDir);
            logger.debug(`Найдено ${oldFiles.length} файлов в директории OLD`);
            
            for (const file of oldFiles) {
                const filePath = path.join(oldDir, file);
                logger.debug(`Обработка архивного файла ${filePath}`);
                const stats = await fs.stat(filePath);
                
                if (stats.isFile()) {
                    const size = stats.size;
                    archivedSize += size;
                    totalSize += size;
                }
            }
        } catch (error) {
            logger.debug(`Папка OLD не найдена или недоступна: ${error.message}`);
        }

        // Обновляем кэш
        diskUsageCache = {
            data: { totalSize, archivedSize, activeSize },
            lastUpdate: now
        };

        logger.debug(`Размер файлов обновлен в кэше: total=${totalSize}, archived=${archivedSize}, active=${activeSize}`);
        return diskUsageCache.data;
    } catch (error) {
        logger.error(`Ошибка при подсчете размера директории ${directory}: ${error.message}`);
        return { totalSize: 0, archivedSize: 0, activeSize: 0 };
    } finally {
        isCalculatingDirectorySize = false; // Сбрасываем флаг в любом случае
    }
}

// Обновляем функцию updateSystemMetrics
async function updateSystemMetrics() {
    logger.debug('Начало updateSystemMetrics');
    
    // Проверяем, что metrics.system существует
    if (!metrics.system) {
        metrics.system = {
            memoryUsage: 0,
            cpuLoad: 0,
            uptime: 0,
            diskUsage: {
                total: 0,
                archived: 0,
                active: 0,
                archivedPercent: 0,
                activePercent: 0
            }
        };
    }
    
    const used = process.memoryUsage();
    metrics.system.memoryUsage = Math.round(used.heapUsed / 1024 / 1024 * 100) / 100;
    metrics.system.uptime = process.uptime();
    
    logger.debug('Старт замера CPU');
    // Добавляем информацию о нагрузке CPU
    const startUsage = process.cpuUsage();
    const cpuPromise = new Promise(resolve => {
        setTimeout(() => {
            const endUsage = process.cpuUsage(startUsage);
            metrics.system.cpuLoad = Math.round((endUsage.user + endUsage.system) / 1000000 * 100) / 100;
            logger.debug('CPU замер завершен');
            resolve();
        }, 100);
    });

    // Добавляем информацию о размере файлов
    try {
        logger.debug('Начало подсчета размера файлов');
        const archiveDir = path.join(__dirname, '..', 'archive');
        const { totalSize, archivedSize, activeSize } = await calculateDirectorySize(archiveDir);
        logger.debug('Размер файлов подсчитан');
        
        const totalMB = Math.round(totalSize / (1024 * 1024) * 100) / 100;
        const archivedMB = Math.round(archivedSize / (1024 * 1024) * 100) / 100;
        const activeMB = Math.round(activeSize / (1024 * 1024) * 100) / 100;
        
        const archivedPercent = totalMB > 0 ? Math.round((archivedMB / totalMB) * 100) : 0;
        const activePercent = totalMB > 0 ? Math.round((activeMB / totalMB) * 100) : 0;

        metrics.system.diskUsage = {
            total: totalMB,
            archived: archivedMB,
            active: activeMB,
            archivedPercent: archivedPercent,
            activePercent: activePercent
        };
    } catch (error) {
        logger.error(`Ошибка при обновлении метрик диска: ${error.message}`);
        metrics.system.diskUsage = { 
            total: 0, 
            archived: 0, 
            active: 0,
            archivedPercent: 0,
            activePercent: 0 
        };
    }

    await cpuPromise;
    logger.debug('updateSystemMetrics завершен');
}

// Обновляем системные метрики каждые 5 минут (300000ms) для снижения нагрузки на I/O
const METRICS_UPDATE_INTERVAL = config.settings?.cache?.diskUsageTimeout || 300000;
setInterval(updateSystemMetrics, METRICS_UPDATE_INTERVAL);

// Функция запуска опроса всех складов
async function pollStorages() {
    if (!isPolling) return;

    logger.debug('Начало цикла опроса складов');
    let hasErrors = false;

    try {
        // Опрашиваем каждый склад последовательно, чтобы избежать проблем с параллельным опросом
        for (const client of modbusClients) {
            if (!isPolling) break;
            
            const storage = config.storages.find(s => s.name === client.storage);
            if (!storage) continue;

            try {
                await pollStorageSensors(storage, client);
            } catch (error) {
                hasErrors = true;
                logger.error(`Ошибка при опросе склада ${storage.name}: ${error.message}`);
                // Продолжаем опрос других складов
            }
            
            // Добавляем небольшую задержку между опросами складов для стабильности Modbus (кроме последнего)
            if (isPolling && modbusClients.indexOf(client) < modbusClients.length - 1) {
                await new Promise(resolve => setTimeout(resolve, MODBUS_SETTINGS.MIN_POLL_DELAY));
            }
        }
    } catch (error) {
        hasErrors = true;
        logger.error(`Ошибка в цикле опроса: ${error.message}`);
    }

    // Планируем следующий опрос только если все еще активны
    if (isPolling) {
        pollTimeout = setTimeout(() => {
            if (isPolling) {
                pollManager.emit('poll');
            }
        }, config.settings.polling.modbus);
    }
    
    if (hasErrors) {
        logger.warn('Цикл опроса завершен с ошибками');
    } else {
        logger.debug('Цикл опроса успешно завершен');
    }
}

// Запуск системы опроса
function startPolling() {
    if (isPolling) return;

    isPolling = true;
    logger.info('Запуск системы опроса складов');
    pollManager.emit('poll');
}

// Остановка системы опроса
async function stopPolling() {
    if (!isPolling) return;

    logger.info('Остановка системы опроса складов');
    isPolling = false;

    // Отменяем запланированный опрос
    if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
    }

    // Запускаем опрос складов параллельно
    await Promise.all(modbusClients.map(async (client) => {
        const storage = config.storages.find(s => s.name === client.storage);
        if (!storage) return;

        const storageStartTime = process.hrtime();
        try {
            await pollStorageSensors(storage, client);
            const storageTime = process.hrtime(storageStartTime);
            logger.debug(`Завершен опрос склада ${storage.name} за ${storageTime[0]}s ${storageTime[1] / 1000000}ms`);
        } catch (error) {
            logger.error(`Ошибка при опросе склада ${storage.name}: ${error.message}`);
        }
    }));

    logger.info('Система опроса остановлена');
}

// Обработчик опроса
pollManager.on('poll', pollStorages);

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('Получен сигнал SIGTERM');
    await stopPolling();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('Получен сигнал SIGINT');
    await stopPolling();
    process.exit(0);
});

// Функция для обновления метрик производительности
function updatePerformanceMetrics(duration, isSuccess) {
    const now = Date.now();
    const oneHourAgo = now - 3600000; // 1 час в миллисекундах

    // Проверяем, что metrics.performance существует
    if (!metrics.performance) {
        metrics.performance = {
            lastPollDuration: 0,
            avgPollDuration: 0,
            pollHistory: [],
            lastHourPolls: 0,
            lastHourFailedPolls: 0
        };
    }

    // Добавляем новый опрос в историю
    metrics.performance.pollHistory.push({
        timestamp: now,
        duration: duration,
        success: isSuccess
    });

    // Удаляем старые записи (старше часа)
    metrics.performance.pollHistory = metrics.performance.pollHistory.filter(poll => poll.timestamp > oneHourAgo);

    // Обновляем метрики за последний час
    metrics.performance.lastPollDuration = duration;
    metrics.performance.lastHourPolls = metrics.performance.pollHistory.length;
    metrics.performance.lastHourFailedPolls = metrics.performance.pollHistory.filter(poll => !poll.success).length;

    // Вычисляем среднюю длительность
    const totalDuration = metrics.performance.pollHistory.reduce((sum, poll) => sum + poll.duration, 0);
    metrics.performance.avgPollDuration = totalDuration / metrics.performance.pollHistory.length;
}

// Оптимизированная функция опроса датчиков одного склада
async function pollStorageSensors(storage, client) {
    const deviceInfo = `${storage.name} (${storage.device.ip}:${storage.device.port})`;
    let isStorageOnline = false;
    const pollStartTime = process.hrtime();

    if (!isPolling) return;

    try {
        // Пытаемся подключиться к устройству
        try {
            await connectWithRetry(client, storage, deviceInfo);
            isStorageOnline = true;
        } catch (error) {
            // Если не удалось подключиться, обрабатываем ошибку и выходим
            handleConnectionError(deviceInfo, client, 'Connection');
            throw error;
        }

        // Если подключение успешно, опрашиваем группы датчиков
        const optimizedSensorGroups = optimizeSensorGroups(storage.device.sensors);
        let hasErrors = false;

        for (const group of optimizedSensorGroups) {
            if (!isPolling) break;

            try {
                client.client.setID(group.address);
                logger.debug(`${deviceInfo} - Начало опроса группы регистров ${group.startRegister}-${group.endRegister}`);
                
                const data = await readRegistersWithTimeout(client, group);
                processSensorGroupData(group, data, deviceInfo);

                await new Promise(resolve => setTimeout(resolve, MODBUS_SETTINGS.MIN_POLL_DELAY)); 

            } catch (error) {
                hasErrors = true;
                handleConnectionError(deviceInfo, client, error.message.includes('Timeout') ? 'Timeout' : 'Sensor');
                // Не пробрасываем ошибку дальше, чтобы продолжить опрос других групп
            }
        }

        // Если были ошибки при опросе групп, но подключение было успешным,
        // устанавливаем isStorageOnline в false, чтобы обновить статус датчиков
        if (hasErrors) {
            isStorageOnline = false;
        }

        const pollDuration = process.hrtime(pollStartTime);
        const durationMs = pollDuration[0] * 1000 + pollDuration[1] / 1000000;
        updatePerformanceMetrics(durationMs, !hasErrors);

    } catch (error) {
        const pollDuration = process.hrtime(pollStartTime);
        const durationMs = pollDuration[0] * 1000 + pollDuration[1] / 1000000;
        updatePerformanceMetrics(durationMs, false);
        // Не пробрасываем ошибку дальше, чтобы не прерывать цикл опроса
    } finally {
        await cleanupConnection(client, deviceInfo, isStorageOnline, storage);
    }
}

// Вспомогательные функции для оптимизации опроса
async function connectWithRetry(client, storage, deviceInfo) {
    const maxRetries = 2;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            await client.client.connectTCP(storage.device.ip, {
                port: storage.device.port,
                timeout: MODBUS_SETTINGS.CONNECT_TIMEOUT
            });
            client.client.setTimeout(MODBUS_SETTINGS.READ_TIMEOUT);
            client.connected = true;
            return;
        } catch (error) {
            retries++;
            if (retries === maxRetries) throw error;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}

function optimizeSensorGroups(sensors) {
    // Сначала сортируем датчики по адресам
    const sensorsByAddress = {};
    
    sensors.forEach(sensor => {
        const address = sensor.address || MODBUS_SETTINGS.DEFAULT_SENSOR_ADDRESS;
        if (!sensorsByAddress[address]) {
            sensorsByAddress[address] = [];
        }
        sensorsByAddress[address].push(sensor);
    });

    // Теперь создаем оптимальные группы для каждого адреса
    const groups = [];
    
    for (const [address, addressSensors] of Object.entries(sensorsByAddress)) {
        // Сортируем датчики по номерам регистров
        addressSensors.sort((a, b) => a.register - b.register);
        
        let currentGroup = {
            address: parseInt(address),
            sensors: [],
            startRegister: addressSensors[0].register,
            endRegister: addressSensors[0].register + (addressSensors[0].length || MODBUS_SETTINGS.DEFAULT_REGISTER_COUNT) - 1
        };

        addressSensors.forEach(sensor => {
            const sensorEnd = sensor.register + (sensor.length || MODBUS_SETTINGS.DEFAULT_REGISTER_COUNT) - 1;
            
            // Если датчик слишком далеко от текущей группы, создаем новую группу
            if (sensor.register > currentGroup.endRegister + 10) { // Максимальный разрыв в 10 регистров
                groups.push(currentGroup);
                currentGroup = {
                    address: parseInt(address),
                    sensors: [],
                    startRegister: sensor.register,
                    endRegister: sensorEnd
                };
            } else {
                // Расширяем текущую группу если нужно
                currentGroup.endRegister = Math.max(currentGroup.endRegister, sensorEnd);
            }
            
            currentGroup.sensors.push(sensor);
        });
        
        groups.push(currentGroup);
    }

    // Логируем информацию о группах
    groups.forEach(group => {
        logger.debug(`Сформирована группа датчиков: адрес=${group.address}, регистры ${group.startRegister}-${group.endRegister}, количество датчиков: ${group.sensors.length}`);
        group.sensors.forEach(sensor => {
            logger.debug(`  - Датчик ${sensor.id}: регистр=${sensor.register}, тип=${sensor.type}`);
        });
    });

    return groups;
}

async function readRegistersWithTimeout(client, group) {
    let lastError = null;
    
    for (let attempt = 0; attempt <= MODBUS_SETTINGS.READ_RETRIES; attempt++) {
        try {
            if (attempt > 0) {
                logger.debug(`Повторная попытка чтения регистров (${attempt}/${MODBUS_SETTINGS.READ_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, MODBUS_SETTINGS.RETRY_DELAY));
            }

            const readPromise = client.client.readHoldingRegisters(
                group.startRegister,
                group.endRegister - group.startRegister + 1
            );

            const result = await Promise.race([
                readPromise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout')),
                        MODBUS_SETTINGS.READ_TIMEOUT)
                )
            ]);

            // Проверяем результат
            if (!result || !result.data || !Array.isArray(result.data)) {
                throw new Error('Некорректный формат данных');
            }

            return result;
        } catch (error) {
            lastError = error;
            logger.warn(`Попытка ${attempt + 1} чтения не удалась: ${error.message}`);
            
            // Если это последняя попытка, выбрасываем ошибку
            if (attempt === MODBUS_SETTINGS.READ_RETRIES) {
                throw new Error(`Ошибка чтения после ${MODBUS_SETTINGS.READ_RETRIES + 1} попыток: ${lastError.message}`);
            }
        }
    }
}

function processSensorGroupData(group, data, deviceInfo) {
    if (!data || !data.data || !Array.isArray(data.data)) {
        logger.error(`${deviceInfo} - Получены некорректные данные от устройства: ${JSON.stringify(data)}`);
        return;
    }

    logger.debug(`${deviceInfo} - Получены данные для группы датчиков: ${JSON.stringify(data)}`);
    logger.debug(`${deviceInfo} - Диапазон регистров группы: ${group.startRegister}-${group.endRegister}`);

    group.sensors.forEach(sensor => {
        try {
            const offset = sensor.register - group.startRegister;
            
            // Проверяем корректность смещения
            if (offset < 0) {
                throw new Error(`Некорректное смещение регистра: ${offset} (регистр датчика: ${sensor.register}, начальный регистр группы: ${group.startRegister})`);
            }

            const registerCount = sensor.length || MODBUS_SETTINGS.DEFAULT_REGISTER_COUNT;
            
            // Проверяем достаточно ли данных
            if (offset + registerCount > data.data.length) {
                throw new Error(`Недостаточно данных для чтения регистров (требуется: ${registerCount}, доступно: ${data.data.length - offset}, смещение: ${offset})`);
            }

            const sensorData = {
                data: data.data.slice(offset, offset + registerCount)
            };

            logger.debug(`${deviceInfo} - Подготовлены данные для датчика ${sensor.id} (тип: ${sensor.type}, регистр: ${sensor.register}): ${JSON.stringify(sensorData)}`);
            
            const value = decodeModbusValue(sensorData, sensor.type);
            if (value !== null) {
                updateSensorData(sensor, value, deviceInfo);
            } else {
                metrics.errors.decode++;
                logger.error(`${deviceInfo} - Ошибка декодирования данных для датчика ${sensor.id} (тип: ${sensor.type}, регистр: ${sensor.register})`);
            }
        } catch (error) {
            metrics.errors.decode++;
            logger.error(`${deviceInfo} - Ошибка обработки данных датчика ${sensor.id} (тип: ${sensor.type}, регистр: ${sensor.register}): ${error.message}`);
            
            // Обновляем статус датчика при ошибке
            if (global.currentSensorData[sensor.id]) {
                global.currentSensorData[sensor.id] = {
                    ...global.currentSensorData[sensor.id],
                    status: 'error',
                    error: true,
                    errorType: 'DecodeError',
                    errorMessage: error.message,
                    timestamp: dayjs().format(TIME_FORMAT)
                };
            }
        }
    });
}

async function cleanupConnection(client, deviceInfo, isStorageOnline, storage) {
    // Закрываем соединение, если оно было открыто
    if (client.connected) {
        try {
            await client.client.close();
            client.connected = false;
        } catch (error) {
            logger.error(`${deviceInfo} - Ошибка при закрытии соединения: ${error}`);
        }
    }

    // Если склад не в сети, обновляем статусы всех его датчиков
    if (!isStorageOnline) {
        // Получаем ID склада из имени датчика (первая часть до точки)
        const storageId = storage.id;
        
        // Обновляем статусы всех датчиков этого склада
        storage.device.sensors.forEach(sensor => {
            const sensorId = sensor.id;
            
            // Если датчик существует в текущих данных, обновляем его статус
            if (global.currentSensorData[sensorId]) {
                global.currentSensorData[sensorId] = {
                    ...global.currentSensorData[sensorId],
                    status: 'offline',
                    error: true,
                    errorType: 'Connection',
                    timestamp: dayjs().format(TIME_FORMAT)
                };
            } else {
                // Если датчика нет в текущих данных, создаем новую запись
                global.currentSensorData[sensorId] = {
                    id: sensorId,
                    value: null,
                    type: sensor.type,
                    status: 'offline',
                    error: true,
                    errorType: 'Connection',
                    timestamp: dayjs().format(TIME_FORMAT)
                };
            }
            
            // Удаляем датчик из списка зависших, если он там есть
            if (metrics.staleData.affectedSensors[sensorId]) {
                delete metrics.staleData.affectedSensors[sensorId];
                metrics.staleData.count = Object.keys(metrics.staleData.affectedSensors).length;
            }
        });
        
        logger.warn(`${deviceInfo} - Все датчики помечены как offline`);
    }
}

// Функция обновления данных датчика
function updateSensorData(sensor, value, deviceInfo) {
    const sensorId = sensor.id;
    const sensorStartTime = process.hrtime();

    // Валидация значения
    const validatedValue = Number.isFinite(value) ? Number(value.toFixed(LIMIT_SETTINGS.FIXED_VALUE)) : null;

    if (validatedValue === null) {
        logger.error(`${deviceInfo} - Некорректное значение датчика ${sensor.type} ${sensorId}`);
        return;
    }

    // Проверяем предыдущее значение и логируем существенные изменения
    const prevValue = global.currentSensorData[sensorId]?.value;
    if (prevValue !== undefined &&
        Math.abs(prevValue - validatedValue) >= MODBUS_SETTINGS.SIGNIFICANT_CHANGE) {
        const sensorTime = process.hrtime(sensorStartTime);
        logger.debug(`${deviceInfo} - ${sensor.type} ${sensorId}: ${validatedValue} (время чтения: ${sensorTime[0]}s ${sensorTime[1] / 1000000}ms)`);
    }
    if (prevValue === undefined) {
        // Первичное чтение данных
        const sensorTime = process.hrtime(sensorStartTime);
        logger.debug(`${deviceInfo} - Первичное чтение данных: ${sensor.type} ${sensorId}: ${validatedValue} (время чтения: ${sensorTime[0]}s ${sensorTime[1] / 1000000}ms)`);
    }

    // Обновляем данные датчика
    global.currentSensorData[sensorId] = {
        id: sensorId,
        value: validatedValue,
        type: sensor.type,
        timestamp: dayjs().format(TIME_FORMAT),
        status: 'ok'
    };

    // Проверка на зависшие данные только если есть предыдущее значение
    if (prevValue !== undefined) {
        const lastTimestamp = global.currentSensorData[sensorId].timestamp;
        const difference = Math.abs(prevValue - validatedValue);
        logger.debug(`Разница ${sensorId} c предыдущим значением: ${difference.toFixed(3)}`);
        const isValueRepeated = difference < LIMIT_SETTINGS.DIFFERENT_LIMIT;
        if (isValueRepeated) {
            metrics.staleData.count++;
            if (!metrics.staleData.affectedSensors[sensorId]) {
                metrics.staleData.affectedSensors[sensorId] = {
                    firstOccurrence: lastTimestamp,
                    count: 1,
                    value: validatedValue
                };
            } else {
                metrics.staleData.affectedSensors[sensorId].count++;
            }
            metrics.staleData.lastTimestamp = lastTimestamp;
        } else {
            // Если данные обновились, удаляем датчик из списка зависших
            if (metrics.staleData.affectedSensors[sensorId]) {
                delete metrics.staleData.affectedSensors[sensorId];
            }
        }
    }
}

// Вспомогательная функция для обработки ошибок подключения
function handleConnectionError(deviceInfo, errorSource, errorType) {
    logger.debug(`Источник ошибки: ${JSON.stringify(errorSource)}`);

    metrics.lastErrorTime = dayjs().format(TIME_FORMAT);

    switch (errorType) {
        case 'Timeout':
            metrics.errors.timeout++;
            logger.error(`Ошибка превышения лимита времени ${deviceInfo} - ${errorType}`);
            break;
        case 'Sensor':
            metrics.errors.sensor++;
            logger.error(`Ошибка датчика на ${deviceInfo} - ${errorType}`);
            break;
        case 'Connection':
            metrics.errors.connection++;
            logger.error(`Ошибка подключения к ${deviceInfo} (всего ошибок: ${metrics.errors.connection})`);
            if (errorSource && typeof errorSource === 'object' && 'connected' in errorSource) {
                errorSource.connected = false;
            }
            break;
        default:
            logger.error(`Неизвестный тип ошибки в ${deviceInfo} - ${errorType}`);
            break;
    }
    
// Определяем префикс склада (storage.id), чтобы корректно помечать датчики
let storageIdPrefix = null;
if (typeof errorSource === 'string') {
    storageIdPrefix = errorSource; // уже передан id
} else if (errorSource && typeof errorSource === 'object' && errorSource.storage) {
    // errorSource.storage — это имя склада; находим его id в конфиге
    try {
        const matched = (global.config?.storages || []).find(s => s.name === errorSource.storage);
        const storageIdCandidate = matched?.id;
        storageIdPrefix = storageIdCandidate || errorSource.storage; // fallback на имя, если id не найден
    } catch (_) {}
}

// Помечаем датчики, относящиеся к складу, как offline
if (global.currentSensorData && storageIdPrefix) {
    Object.keys(global.currentSensorData).forEach(sensorId => {
        if (sensorId.startsWith(storageIdPrefix)) {
                global.currentSensorData[sensorId] = {
                    ...global.currentSensorData[sensorId],
                    value: null,
                    error: true,
                    errorType: errorType,
                    status: 'offline',
                    timestamp: dayjs().format(TIME_FORMAT)
                };
            }
            // Drop sensor from stale data:
            if (metrics.staleData.affectedSensors[sensorId]){
                delete metrics.staleData.affectedSensors[sensorId];
                metrics.staleData.count = Object.keys(metrics.staleData.affectedSensors).length;
            }
        });
    }
}

// Запуск периодической архивации
let isArchiving = false;
setInterval(async () => {
    if (isArchiving) {
        logger.warn('Предыдущая архивация еще выполняется, пропуск');
        return;
    }

    try {
        isArchiving = true;
        await saveToArchive(global.currentSensorData);
        await zipOldArchive();
    } catch (error) {
        logger.error(`Ошибка при выполнении архивации: ${error.message}`);
    } finally {
        isArchiving = false;
    }
}, config.settings.polling.archive);

// Настройка статических маршрутов
app.use(express.static(path.join(__dirname, '../PUBLIC')));
app.use('/js/lib', express.static(path.join(__dirname, '../PUBLIC/js/lib')));

// Добавляем CSP middleware
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "connect-src 'self'"
    );
    next();
});

// Настройка MIME-типов
app.use((req, res, next) => {
    res.type(((path) => {
        if (path.endsWith('.js')) return 'application/javascript';
        if (path.endsWith('.css')) return 'text/css';
        if (path.endsWith('.svg')) return 'image/svg+xml';
        if (path.endsWith('.map')) return 'application/json';
        return 'text/html';
    })(req.path));
    next();
});

// Логгер для API запросов
const apiRequestCache = new Map();

// Функция очистки неактивных клиентов
function cleanupInactiveClients() {
    const now = Date.now();
    let activeCount = 0;
    
    // Проверяем, что metrics.activeClients и metrics.activeClients.clients существуют
    if (!metrics.activeClients || !metrics.activeClients.clients) {
        // Инициализируем, если не существуют
        metrics.activeClients = {
            count: 0,
            clients: {}
        };
        return;
    }
    
    // Проверяем все клиенты
    Object.entries(metrics.activeClients.clients).forEach(([clientId, clientData]) => {
        if (now - clientData.lastSeen > API_LOG_TIMEOUT) {
            // Клиент неактивен, удаляем его
            delete metrics.activeClients.clients[clientId];
            logger.debug(`Клиент ${clientId} удален из-за неактивности`);
        } else {
            activeCount++;
        }
    });
    
    metrics.activeClients.count = activeCount;
}

app.use((req, res, next) => {
    try {
        if (req.path.startsWith('/api/')) {
            const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
            const userAgent = req.headers['user-agent'] || 'unknown';
            const clientId = `${clientIp}_${userAgent}`;
            const now = Date.now();
            
            // Обновляем информацию о клиенте
            metrics.activeClients.clients[clientId] = {
                ip: clientIp,
                userAgent: userAgent,
                lastSeen: now,
                lastPath: req.path,
                requestCount: (metrics.activeClients.clients[clientId]?.requestCount || 0) + 1
            };
            
            // Обновляем общее количество активных клиентов
            metrics.activeClients.count = Object.keys(metrics.activeClients.clients).length;
            
            // Проверяем, нужно ли логировать
            const cacheKey = `${clientId}_${req.path}`;
            const lastLog = apiRequestCache.get(cacheKey);
            if (!lastLog || (now - lastLog) > API_LOG_TIMEOUT) {
                logger.debug(`${req.method} ${req.path} от ${clientIp} (${userAgent})`);
                apiRequestCache.set(cacheKey, now);
                
                // Очищаем старые записи из кэша и неактивных клиентов
                cleanupInactiveClients();
                for (const [key, timestamp] of apiRequestCache.entries()) {
                    if (now - timestamp > API_LOG_TIMEOUT) {
                        apiRequestCache.delete(key);
                    }
                }
            }
        }
        next();
    } catch (error) {
        logger.error(`Ошибка в middleware логирования API: ${error.message}`);
        next();
    }
});

// API маршруты
app.use('/api', require('./api/routes'));

// Обновляем API эндпоинт для мониторинга
app.get('/api/metrics', async (req, res) => {
    try {
        cleanupInactiveClients();
        await updateSystemMetrics();
        
        // Проверяем, что все необходимые поля метрик существуют
        if (!metrics.errors) {
            metrics.errors = {
                connection: 0,
                sensor: 0,
                timeout: 0,
                decode: 0
            };
        }
        
        if (!metrics.performance) {
            metrics.performance = {
                lastPollDuration: 0,
                avgPollDuration: 0,
                pollHistory: [],
                lastHourPolls: 0,
                lastHourFailedPolls: 0
            };
        }
        
        if (!metrics.staleData) {
            metrics.staleData = {
                count: 0,
                lastTimestamp: null,
                repeatedTimestamp: null,
                affectedSensors: {}
            };
        }
        
        if (!metrics.system) {
            metrics.system = {
                memoryUsage: 0,
                cpuLoad: 0,
                uptime: 0,
                diskUsage: {
                    total: 0,
                    archived: 0,
                    active: 0,
                    archivedPercent: 0,
                    activePercent: 0
                }
            };
        }
        
        if (!metrics.activeClients) {
            metrics.activeClients = {
                count: 0,
                clients: {}
            };
        }
        
        res.json({
            errors: metrics.errors,
            performance: {
                lastPollDuration: metrics.performance.lastPollDuration,
                avgPollDuration: metrics.performance.avgPollDuration,
                totalPolls: metrics.performance.lastHourPolls,
                failedPolls: metrics.performance.lastHourFailedPolls
            },
            lastErrorTime: metrics.lastErrorTime,
            uptime: process.uptime(),
            staleData: metrics.staleData,
            system: metrics.system,
            activeClients: {
                count: metrics.activeClients.count,
                clients: Object.entries(metrics.activeClients.clients).map(([id, data]) => ({
                    ip: data.ip,
                    lastSeen: new Date(data.lastSeen).toISOString(),
                    lastPath: data.lastPath,
                    requestCount: data.requestCount
                }))
            }
        });
    } catch (error) {
        logger.error(`Ошибка при получении метрик: ${error.message}`);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Страница метрик
app.get('/metrics', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'PUBLIC', 'metrics.html'));
});

// Запускаем начальный опрос сразу после старта сервера
app.listen(PORT, () => {
    logger.info(`Сервер запущен на порту ${PORT}`);
    // Запускаем первичный опрос
    startPolling();
});