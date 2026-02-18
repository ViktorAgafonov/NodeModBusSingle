const express = require('express');
const router = express.Router();
const { apiLimiter, historyLimiter } = require('../middleware/rateLimiter');
const fs = require('fs').promises;
const path = require('path');
const logger = require(path.join(__dirname, '../../utils/logger'));
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
const { parseTimeRange } = require('../../utils/date');
const { archiveEvents } = require('../../storage/archive');

// Делаем currentSensorData доступным через глобальный объект
global.currentSensorData = global.currentSensorData || {};

// Кэш последнего успешного ответа для /current
let lastCurrentPayload = null;
let lastCurrentTs = 0;
const CURRENT_TTL_MS = 15000; // 15 секунд

// Применяем общий лимит на все API endpoints
router.use('/', apiLimiter);

// Получение текущих данных
router.get('/current', (req, res) => {
    try {
        const sensorData = global.currentSensorData;
		const now = Date.now();

		// Сформировать payload из текущих данных (даже если часть датчиков с ошибками)
		const result = {
			temperature: [],
			humidity: [],
			stale: false
		};

        // Получаем конфигурацию для определения типа датчика
        const sensors = global.config.storages.reduce((acc, storage) => {
            storage.device.sensors.forEach(sensor => {
                acc[sensor.id] = sensor;
            });
            return acc;
        }, {});

		Object.entries(sensorData || {}).forEach(([id, data]) => {
            const sensorConfig = sensors[id];
            if (!sensorConfig) {
                logger.debug(`Датчик ${id} не найден в конфигурации. Доступные ID: ${Object.keys(sensors).join(', ')}`);
                return;
            }

            const item = {
                sensor_id: id,
                type: sensorConfig.type,
                value: data.status === 'ok' ? data.value : null,
                error: data.status !== 'ok',
                timestamp: data.timestamp,
                name: sensorConfig.name
            };

            if (sensorConfig.type === 'temperature') {
                result.temperature.push(item);
            } else if (sensorConfig.type === 'humidity') {
                result.humidity.push(item);
            }
        });

		const hasOk = result.temperature.some(x => !x.error && x.value !== null) ||
			result.humidity.some(x => !x.error && x.value !== null);

		if (hasOk) {
			lastCurrentPayload = result;
			lastCurrentTs = now;
			return res.json(result);
		}

		// Нет «ok» значений сейчас — вернуть последний успешный ответ, если он свежий
		if (lastCurrentPayload && (now - lastCurrentTs) <= CURRENT_TTL_MS) {
			return res.json({ ...lastCurrentPayload, stale: true });
		}

		// Иначе 503 как раньше
		return res.status(503).json({ error: 'Данные датчиков недоступны' });

    } catch (error) {
        logger.error(`Ошибка при получении текущих данных: ${error.message}`);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Валидация запроса на получение исторических данных
function validateHistoryRequest(req, res, storageId = null) {
    const range = req.query.range;
    const validRanges = ['1h', '24h', '14d', '60d'];
    
    if (!range || !validRanges.includes(range)) {
        return { 
            isValid: false, 
            response: res.status(400).json({ 
                error: 'Некорректный параметр range',
                validRanges: validRanges
            })
        };
    }

    // Если указан storageId, проверяем существование склада
    if (storageId) {
        const storage = global.config.storages.find(s => s.id === storageId);
        if (!storage) {
            return { 
                isValid: false, 
                response: res.status(404).json({ error: 'Склад не найден' })
            };
        }
    }

    return { isValid: true, range };
}

// Определение интервала агрегации на основе временного диапазона
function getAggregationInterval(range) {
    switch(range) {
        case '1h':
            return 5 * 60 * 1000; // 5 минут
        case '24h':
            return 60 * 60 * 1000; // 1 час
        case '14d':
            return 12 * 60 * 60 * 1000; // 12 часов
        case '60d':
            return 24 * 60 * 60 * 1000; // 24 часа
        default:
            return 5 * 60 * 1000;
    }
}

// Кэш для хранения результатов агрегации с использованием LRU
const { LRUCache } = require('lru-cache');
const historyCache = new LRUCache({
    max: 100, // Максимум 100 элементов
    ttl: 10 * 1000, // 10 секунд TTL (уменьшено с 60 секунд для более быстрого обновления)
    updateAgeOnGet: false,
    updateAgeOnHas: false
});

// Подписываемся на событие сохранения данных в архив для инвалидации кэша
archiveEvents.on('dataArchived', (data) => {
    logger.info(`Получено событие архивации данных: ${data.filename}, очищаем кэш истории`);
    historyCache.clear();
    logger.debug(`Кэш истории очищен. Новые данные будут загружены при следующем запросе`);
});

// Функция получения данных из кэша
function getFromCache(key) {
    return historyCache.get(key) || null;
}

// Функция сохранения данных в кэш
function saveToCache(key, data) {
    historyCache.set(key, data);
}

// Загрузка исторических данных из файлов
async function loadHistoricalData(range, startTime, endTime) {
    const archiveDir = path.join(__dirname, '../../../archive');
    
    try {
        await fs.access(archiveDir);
    } catch {
        return { temperature: new Map(), humidity: new Map() };
    }
    
    const files = await fs.readdir(archiveDir);
    const rawData = { temperature: new Map(), humidity: new Map() };

    // Собираем все данные
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const fileDate = dayjs(file.replace('.json', ''), 'YYYY-MM-DD');
        if (!fileDate.isValid()) {
            logger.error(`Некорректное имя файла архива: ${file}`);
            continue;
        }

        // Проверяем, что файл содержит данные нужного диапазона
        const isCurrentDayData = range === '1h' || range === '24h';
        const isFileInRange = fileDate.toDate() >= dayjs(startTime).startOf('day').toDate();
        
        if (isCurrentDayData || isFileInRange) {
            const filePath = path.join(archiveDir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            
            // Проверка валидности JSON
            let data;
            try {
                data = JSON.parse(content);
                
                // Проверка структуры данных
                if (!Array.isArray(data)) {
                    logger.error(`Некорректная структура данных в файле ${file}: ожидался массив`);
                    continue;
                }
            } catch (error) {
                logger.error(`Ошибка при парсинге JSON из файла ${file}: ${error.message}`);
                continue;
            }
            
            processFileData(data, file, startTime, endTime, rawData);
        }
    }

    return rawData;
}

// Обработка данных из файла
function processFileData(data, fileName, startTime, endTime, rawData) {
    data.forEach(entry => {
        // Проверка обязательных полей
        if (!entry || !entry.timestamp || !Array.isArray(entry.sensors)) {
            logger.debug(`Пропущена запись с некорректной структурой в файле ${fileName}`);
            return;
        }
        
        const entryTime = dayjs(entry.timestamp, 'YYYY-MM-DD HH:mm:ss');
        
        // Проверка валидности временной метки
        if (!entryTime.isValid()) {
            logger.debug(`Пропущена запись с некорректной временной меткой: ${entry.timestamp}`);
            return;
        }
        
        const timestamp = entryTime.valueOf();
        
        // Проверяем, что запись входит в запрошенный диапазон
        if (timestamp >= startTime.getTime() && timestamp <= endTime.getTime()) {
            processSensorsData(entry.sensors, timestamp, rawData);
        }
    });
}

// Обработка данных датчиков
function processSensorsData(sensors, timestamp, rawData, storageFilter = null) {
    sensors.forEach(sensor => {
        // Проверка валидности данных датчика
        if (!sensor || !sensor.sensor_id || !sensor.type) {
            logger.debug(`Пропущен датчик с некорректной структурой: ${JSON.stringify(sensor)}`);
            return;
        }
        
        // Проверка типа датчика
        if (!['temperature', 'humidity'].includes(sensor.type)) {
            logger.debug(`Пропущен датчик с неизвестным типом: ${sensor.type}`);
            return;
        }
        
        // Проверка значения датчика
        if (sensor.value === null || sensor.value === undefined) return;
        
        // Проверка диапазона значений
        if (sensor.type === 'temperature' && (sensor.value < -50 || sensor.value > 100)) {
            logger.debug(`Пропущено некорректное значение температуры: ${sensor.value}`);
            return;
        }
        
        if (sensor.type === 'humidity' && (sensor.value < 0 || sensor.value > 100)) {
            logger.debug(`Пропущено некорректное значение влажности: ${sensor.value}`);
            return;
        }
        
        // Если указан storageFilter, фильтруем только датчики этого склада
        if (storageFilter && !sensor.sensor_id.startsWith(storageFilter)) {
            return;
        }
        
        const sensorKey = sensor.sensor_id;
        const type = sensor.type;
        
        if (!rawData[type]) return;
        
        if (!rawData[type].has(sensorKey)) {
            rawData[type].set(sensorKey, []);
        }
        
        rawData[type].get(sensorKey).push({
            timestamp: timestamp,
            value: sensor.value
        });
    });
}

// Агрегация данных для конкретного датчика
function aggregateSensorData(sensorId, data, aggregationInterval, sensorConfig) {
    // Группируем данные по интервалам
    const groupedData = new Map();
    data.forEach(point => {
        // Проверка валидности точки данных
        if (!point || point.value === undefined || point.value === null || !point.timestamp) {
            logger.debug(`Пропущена некорректная точка данных: ${JSON.stringify(point)}`);
            return;
        }
        
        // Проверка типа значения
        if (typeof point.value !== 'number' || isNaN(point.value)) {
            logger.debug(`Пропущено не числовое значение: ${point.value}`);
            return;
        }
        
        const interval = Math.floor(point.timestamp / aggregationInterval) * aggregationInterval;
        if (!groupedData.has(interval)) {
            groupedData.set(interval, []);
        }
        groupedData.get(interval).push(point.value);
    });

    // Функция для вычисления максимального значения в массиве
    const getMax = (values) => {
        if (!values || values.length === 0) return null;
        const maxValue = Math.max(...values);
        return isNaN(maxValue) ? null : maxValue;
    };

    // Формируем временной ряд для датчика
    return {
        id: sensorId,
        name: sensorConfig.name,
        storageId: sensorConfig.storageId,
        storageName: sensorConfig.storageName,
        data: Array.from(groupedData).map(([timestamp, values]) => {
            // Проверка наличия значений
            if (!values || values.length === 0) {
                logger.debug(`Пропущен интервал без значений: ${timestamp}`);
                return null;
            }
            
            // Вычисление максимального значения
            const result = getMax(values);
            
            // Проверка результата
            if (result === null || isNaN(result)) {
                logger.debug(`Получено некорректное значение при вычислении для ${sensorId} в ${timestamp}`);
                return null;
            }
            
            return {
                x: dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss'),
                y: parseFloat(result.toFixed(3))
            };
        })
        .filter(item => item !== null) // Удаляем null-значения
        .sort((a, b) => dayjs(a.x).valueOf() - dayjs(b.x).valueOf())
    };
}

// Агрегация данных по типу датчика для общего запроса
function aggregateDataByType(rawData, aggregationInterval) {
    const result = {
        temperature: [],
        humidity: []
    };
    
    // Создаем индекс датчиков один раз для оптимизации
    const sensorToStorageMap = new Map();
    const storageNames = new Map();

    global.config.storages.forEach(storage => {
        storageNames.set(storage.id, storage.name);
        storage.device.sensors.forEach(sensor => {
            sensorToStorageMap.set(sensor.id, storage.id);
        });
    });
    
    // Создаем временные ряды для каждого типа датчика, сгруппированные по складам
    for (const type of ['temperature', 'humidity']) {
        // Группируем точки данных по складам
        const storageData = new Map(); // Map: storageId -> allPoints[]
        
        for (const [sensorId, data] of rawData[type]) {
            // Получаем информацию о складе для этого датчика
            const storageId = sensorToStorageMap.get(sensorId);
            if (!storageId) continue;
            
            // Инициализируем массив точек для склада, если его еще нет
            if (!storageData.has(storageId)) {
                storageData.set(storageId, []);
            }
            
            // Добавляем точки данных в соответствующий склад
            storageData.get(storageId).push(...data);
        }
        
        // Для каждого склада создаем серию с максимальными значениями
        for (const [storageId, allPoints] of storageData.entries()) {
            // Находим информацию о складе
            const storageName = storageNames.get(storageId) || 'Неизвестный склад';
            
            // Группируем точки по интервалам для текущего склада
            const groupedPoints = new Map();
            allPoints.forEach(point => {
                const interval = Math.floor(point.timestamp / aggregationInterval) * aggregationInterval;
                if (!groupedPoints.has(interval)) {
                    groupedPoints.set(interval, []);
                }
                groupedPoints.get(interval).push(point.value);
            });
            
            // Создаем серию с максимальными значениями для каждого интервала
            const maxSeries = {
                id: `${type}_${storageId}_max`,
                name: `${storageName}: ${type === 'temperature' ? 'Макс.темпер.' : 'Макс.влаж.'}`,
                storageId: storageId,
                data: Array.from(groupedPoints).map(([timestamp, values]) => {
                    if (!values || values.length === 0) return null;
                    
                    // Находим максимальное значение
                    const maxValue = Math.max(...values);
                    
                    if (isNaN(maxValue)) return null;
                    
                    return {
                        x: dayjs(timestamp).format('YYYY-MM-DD HH:mm:ss'),
                        y: parseFloat(maxValue.toFixed(3))
                    };
                }).filter(point => point !== null)
                .sort((a, b) => dayjs(a.x).valueOf() - dayjs(b.x).valueOf())
            };
            
            if (maxSeries.data.length > 0) {
                result[type].push(maxSeries);
            }
        }
    }
    
    return result;
}

// Проверка результата перед отправкой
function validateResult(result) {
    for (const type of ['temperature', 'humidity']) {
        // Проверяем, что все серии имеют данные
        result[type] = result[type].filter(series => {
            if (!series.data || series.data.length === 0) {
                logger.debug(`Удалена пустая серия данных: ${series.id}`);
                return false;
            }
            return true;
        });
        
        // Проверяем, что все точки данных валидны
        result[type].forEach(series => {
            series.data = series.data.filter(point => {
                if (!point || point.y === undefined || point.y === null || !point.x) {
                    logger.debug(`Удалена некорректная точка данных в серии ${series.id}`);
                    return false;
                }
                
                // Проверка валидности даты
                if (!dayjs(point.x, 'YYYY-MM-DD HH:mm:ss').isValid()) {
                    logger.debug(`Удалена точка с некорректной датой в серии ${series.id}: ${point.x}`);
                    return false;
                }
                
                return true;
            });
        });
    }
    
    return result;
}

// Универсальная функция для получения исторических данных
async function getHistoricalData(req, res, storageId = null) {
    try {
        // Валидация запроса
        const validation = validateHistoryRequest(req, res, storageId);
        if (!validation.isValid) {
            return validation.response;
        }
        
        const range = validation.range;
        
        // Проверяем кэш
        const cacheKey = `${storageId || 'all'}_${range}`;
        const cachedResult = getFromCache(cacheKey);
        
        if (cachedResult) {
            logger.debug(`Данные получены из кэша: ${cacheKey}`);
            return res.json(cachedResult);
        }
        
        const { startTime, endTime } = parseTimeRange(range);
        
        logger.debug(`Запрошен диапазон: ${range}, начальное время: ${startTime.toISOString()}, склад: ${storageId || 'все'}`);
        
        // Определение интервала агрегации
        const aggregationInterval = getAggregationInterval(range);
        
        // Загрузка исторических данных
        const rawData = await loadHistoricalData(range, startTime, endTime);
        
        // Формируем результат
        let result;
        
        if (storageId) {
            // Для запроса конкретного склада
            result = {
                temperature: [],
                humidity: []
            };
            
            // Получаем конфигурацию датчиков
            const allSensors = global.config.storages.reduce((acc, storage) => {
                // Если указан storageId, фильтруем только датчики этого склада
                if (storageId && storage.id !== storageId) return acc;
                
                storage.device.sensors.forEach(sensor => {
                    acc[sensor.id] = {
                        ...sensor,
                        storageId: storage.id,
                        storageName: storage.name
                    };
                });
                return acc;
            }, {});
            
            // Обрабатываем данные для каждого типа датчиков
            for (const type of ['temperature', 'humidity']) {
                for (const [sensorId, data] of rawData[type]) {
                    // Находим конфигурацию датчика
                    const sensorConfig = allSensors[sensorId];
                    if (!sensorConfig) continue;
                    
                    // Агрегируем данные для датчика
                    const series = aggregateSensorData(sensorId, data, aggregationInterval, sensorConfig);
                    
                    if (series.data.length > 0) {
                        result[type].push(series);
                    }
                }
            }
            
            // Проверка результата перед отправкой
            result = validateResult(result);
            
            // Сохраняем результат в кэш
            saveToCache(cacheKey, result);
            
            // Формат для /storage/:storageId/history
            return res.json(result);
        } else {
            // Для общего запроса
            result = aggregateDataByType(rawData, aggregationInterval);
            
            // Сохраняем результат в кэш
            saveToCache(cacheKey, result);
            
            // Формат для /history
            return res.json(result);
        }
    } catch (error) {
        logger.error(`Ошибка при получении исторических данных: ${error.message}`);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
}

// Получение исторических данных с дополнительным лимитером
router.get('/history', historyLimiter, (req, res) => {
    getHistoricalData(req, res);
});

// Получение исторических данных для конкретного склада
router.get('/storage/:storageId/history', historyLimiter, (req, res) => {
    const { storageId } = req.params;
    getHistoricalData(req, res, storageId);
});

// Сброс метрик
router.post('/metrics/reset', (req, res) => {
    // Сбрасываем метрики
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
            pollHistory: [],
            lastHourPolls: 0,
            lastHourFailedPolls: 0
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

    // Очищаем текущие данные датчиков
    global.currentSensorData = {};
    
    logger.info('Метрики и данные датчиков сброшены');
    res.json({ success: true });
});

// Получение конфигурации
router.get('/config', (req, res) => {
    try {
        if (!global.config) {
            throw new Error('Конфигурация не инициализирована');
        }
        res.json(global.config);
    } catch (error) {
        logger.error(`Ошибка при получении конфигурации: ${error.message}`);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Health check endpoint
router.get('/health', (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
    };

    // Проверяем доступность данных
    const hasSensorData = global.currentSensorData && Object.keys(global.currentSensorData).length > 0;
    const hasConfig = global.config && global.config.storages;

    if (!hasSensorData || !hasConfig) {
        health.status = 'degraded';
        health.warnings = [];
        if (!hasSensorData) health.warnings.push('No sensor data available');
        if (!hasConfig) health.warnings.push('Configuration not loaded');
    }

    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);
});

module.exports = router;