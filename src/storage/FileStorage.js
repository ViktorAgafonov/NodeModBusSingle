const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const { formatDate, formatTimestamp } = require('../utils/date');
const JSONStream = require('JSONStream');
const { pipeline } = require('stream/promises');

/**
 * Абстрактный класс для работы с хранилищем данных
 */
class IStorage {
    async save(data) {
        throw new Error('Method save() must be implemented');
    }

    async load(range, startTime, endTime) {
        throw new Error('Method load() must be implemented');
    }

    async archive(olderThan) {
        throw new Error('Method archive() must be implemented');
    }

    async getSize() {
        throw new Error('Method getSize() must be implemented');
    }
}

/**
 * Реализация файлового хранилища с поддержкой streaming для больших файлов
 */
class FileStorage extends IStorage {
    constructor(archiveDir, oldArchiveDir) {
        super();
        this.archiveDir = archiveDir || path.join(__dirname, '../../archive');
        this.oldArchiveDir = oldArchiveDir || path.join(this.archiveDir, 'OLD');
        this.isSaving = false;
        this.isArchiving = false;
        this.sizeCache = {
            data: null,
            lastUpdate: 0
        };
    }

    /**
     * Создание директории если не существует
     */
    async ensureDir(dir) {
        try {
            await fsPromises.access(dir);
        } catch {
            await fsPromises.mkdir(dir, { recursive: true });
        }
    }

    /**
     * Сохранение данных в архив
     */
    async save(sensorData) {
        if (this.isSaving) {
            logger.warn('Операция сохранения в архив уже выполняется, пропускаем текущий вызов');
            return;
        }

        try {
            this.isSaving = true;

            const sensors = Object.values(sensorData);
            if (sensors.length === 0) return;

            const validSensors = sensors.filter(sensor => !sensor.error && sensor.value !== null);
            if (validSensors.length === 0) return;

            await this.ensureDir(this.archiveDir);

            const filename = `${formatDate(new Date())}.json`;
            const filepath = path.join(this.archiveDir, filename);

            let archiveData = [];
            try {
                const fileContent = await fsPromises.readFile(filepath, 'utf-8');
                archiveData = JSON.parse(fileContent);
            } catch (error) {
                // Создаем новый файл если не существует
            }

            const entry = {
                timestamp: formatTimestamp(new Date()),
                sensors: validSensors.map(sensor => {
                    let value = sensor.value;
                    if (sensor.type === 'humidity' && value < 0) {
                        value = 0;
                    }
                    return {
                        sensorId: sensor.id,
                        type: sensor.type,
                        value: parseFloat(value.toFixed(3))
                    };
                })
            };

            archiveData.push(entry);
            await fsPromises.writeFile(filepath, JSON.stringify(archiveData, null, 2));
            logger.info(`Архивация: ${filename} (${entry.sensors.length} датчиков)`);

        } catch (error) {
            logger.error(`Ошибка сохранения в архив: ${error.message}`);
            throw error;
        } finally {
            this.isSaving = false;
        }
    }

    /**
     * Загрузка данных из архива с использованием streaming для больших файлов
     */
    async load(range, startTime, endTime) {
        try {
            await fsPromises.access(this.archiveDir);
        } catch {
            return { temperature: new Map(), humidity: new Map() };
        }

        const files = await fsPromises.readdir(this.archiveDir);
        const rawData = { temperature: new Map(), humidity: new Map() };

        const dayjs = require('dayjs');

        for (const file of files) {
            if (!file.endsWith('.json')) continue;

            const fileDate = dayjs(file.replace('.json', ''), 'YYYY-MM-DD');
            if (!fileDate.isValid()) {
                logger.error(`Некорректное имя файла архива: ${file}`);
                continue;
            }

            const isCurrentDayData = range === '1h' || range === '24h';
            const isFileInRange = fileDate.toDate() >= dayjs(startTime).startOf('day').toDate();

            if (isCurrentDayData || isFileInRange) {
                const filePath = path.join(this.archiveDir, file);

                // Проверяем размер файла
                const stats = await fsPromises.stat(filePath);
                const MAX_SIZE_FOR_SYNC = 5 * 1024 * 1024; // 5MB

                if (stats.size > MAX_SIZE_FOR_SYNC) {
                    // Используем streaming для больших файлов
                    await this._loadFileWithStreaming(filePath, file, startTime, endTime, rawData);
                } else {
                    // Обычное чтение для небольших файлов
                    await this._loadFileSync(filePath, file, startTime, endTime, rawData);
                }
            }
        }

        return rawData;
    }

    /**
     * Загрузка файла с использованием streaming
     */
    async _loadFileWithStreaming(filePath, fileName, startTime, endTime, rawData) {
        return new Promise((resolve, reject) => {
            const dayjs = require('dayjs');
            const customParseFormat = require('dayjs/plugin/customParseFormat');
            dayjs.extend(customParseFormat);

            const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
            const jsonStream = JSONStream.parse('*');

            let processedCount = 0;

            jsonStream.on('data', (entry) => {
                if (!entry || !entry.timestamp || !Array.isArray(entry.sensors)) {
                    return;
                }

                const entryTime = dayjs(entry.timestamp, 'YYYY-MM-DD HH:mm:ss');
                if (!entryTime.isValid()) {
                    return;
                }

                const timestamp = entryTime.valueOf();
                if (timestamp >= startTime.getTime() && timestamp <= endTime.getTime()) {
                    this._processSensorsData(entry.sensors, timestamp, rawData);
                    processedCount++;
                }
            });

            jsonStream.on('end', () => {
                logger.debug(`Обработано ${processedCount} записей из ${fileName} (streaming)`);
                resolve();
            });

            jsonStream.on('error', (error) => {
                logger.error(`Ошибка при streaming парсинге ${fileName}: ${error.message}`);
                reject(error);
            });

            stream.pipe(jsonStream);
        });
    }

    /**
     * Обычная загрузка файла
     */
    async _loadFileSync(filePath, fileName, startTime, endTime, rawData) {
        const content = await fsPromises.readFile(filePath, 'utf-8');

        let data;
        try {
            data = JSON.parse(content);
            if (!Array.isArray(data)) {
                logger.error(`Некорректная структура данных в файле ${fileName}: ожидался массив`);
                return;
            }
        } catch (error) {
            logger.error(`Ошибка при парсинге JSON из файла ${fileName}: ${error.message}`);
            return;
        }

        const dayjs = require('dayjs');
        const customParseFormat = require('dayjs/plugin/customParseFormat');
        dayjs.extend(customParseFormat);

        data.forEach(entry => {
            if (!entry || !entry.timestamp || !Array.isArray(entry.sensors)) {
                return;
            }

            const entryTime = dayjs(entry.timestamp, 'YYYY-MM-DD HH:mm:ss');
            if (!entryTime.isValid()) {
                return;
            }

            const timestamp = entryTime.valueOf();
            if (timestamp >= startTime.getTime() && timestamp <= endTime.getTime()) {
                this._processSensorsData(entry.sensors, timestamp, rawData);
            }
        });
    }

    /**
     * Обработка данных датчиков
     */
    _processSensorsData(sensors, timestamp, rawData, storageFilter = null) {
        sensors.forEach(sensor => {
            // Поддержка как старого (sensor_id), так и нового (sensorId) формата
            const sensorId = sensor.sensorId || sensor.sensor_id;

            if (!sensor || !sensorId || !sensor.type) {
                return;
            }

            if (!['temperature', 'humidity'].includes(sensor.type)) {
                return;
            }

            if (sensor.value === null || sensor.value === undefined) return;

            if (sensor.type === 'temperature' && (sensor.value < -50 || sensor.value > 100)) {
                return;
            }

            if (sensor.type === 'humidity' && (sensor.value < 0 || sensor.value > 100)) {
                return;
            }

            if (storageFilter && !sensorId.startsWith(storageFilter)) {
                return;
            }

            const type = sensor.type;

            if (!rawData[type]) return;

            if (!rawData[type].has(sensorId)) {
                rawData[type].set(sensorId, []);
            }

            rawData[type].get(sensorId).push({
                timestamp: timestamp,
                value: sensor.value
            });
        });
    }

    /**
     * Архивирование старых файлов
     */
    async archive(olderThan) {
        if (this.isArchiving) {
            logger.warn('Операция сжатия архива уже выполняется, пропускаем текущий вызов');
            return;
        }

        try {
            this.isArchiving = true;

            const dayjs = require('dayjs');
            const archiver = require('archiver');

            const files = await fsPromises.readdir(this.archiveDir);
            const oldFiles = files.filter(file => {
                const fileDate = dayjs(file.replace('.json', ''), 'YYYY-MM-DD');
                return fileDate.isValid() && fileDate.toDate() < olderThan;
            });

            if (oldFiles.length === 0) return;

            await this.ensureDir(this.oldArchiveDir);

            logger.info(`Начало архивирования ${oldFiles.length} старых файлов`);

            const CONCURRENT_LIMIT = 3;
            for (let i = 0; i < oldFiles.length; i += CONCURRENT_LIMIT) {
                const batch = oldFiles.slice(i, i + CONCURRENT_LIMIT);

                await Promise.all(batch.map(async (file) => {
                    const sourcePath = path.join(this.archiveDir, file);
                    const targetPath = path.join(this.oldArchiveDir, `${file}.zip`);

                    try {
                        await new Promise((resolve, reject) => {
                            const archive = archiver('zip', { zlib: { level: 6 } });
                            const stream = fs.createWriteStream(targetPath);

                            stream.on('close', resolve);
                            stream.on('error', reject);
                            archive.on('error', reject);

                            archive.pipe(stream);
                            archive.file(sourcePath, { name: file });
                            archive.finalize();
                        });

                        await fsPromises.unlink(sourcePath);
                        logger.info(`Сжатие архива: ${file} выполнено`);
                    } catch (error) {
                        logger.error(`Ошибка при сжатии ${file}: ${error.message}`);
                    }
                }));
            }

            logger.info(`Завершено архивирование ${oldFiles.length} старых файлов`);

        } catch (error) {
            logger.error(`Ошибка сжатия архива: ${error.message}`);
            throw error;
        } finally {
            this.isArchiving = false;
        }
    }

    /**
     * Получение размера хранилища с инкрементальным кэшированием
     */
    async getSize(cacheTimeout = 300000) {
        const now = Date.now();

        if (this.sizeCache.data && (now - this.sizeCache.lastUpdate) < cacheTimeout) {
            logger.debug('Возвращаем размер файлов из кэша');
            return this.sizeCache.data;
        }

        try {
            logger.debug('Подсчитываем размер файлов...');
            let totalSize = 0;
            let archivedSize = 0;
            let activeSize = 0;

            const mainFiles = await fsPromises.readdir(this.archiveDir);

            for (const file of mainFiles) {
                const filePath = path.join(this.archiveDir, file);
                const stats = await fsPromises.stat(filePath);

                if (stats.isFile() && file.endsWith('.json')) {
                    const size = stats.size;
                    activeSize += size;
                    totalSize += size;
                }
            }

            try {
                const oldFiles = await fsPromises.readdir(this.oldArchiveDir);

                for (const file of oldFiles) {
                    const filePath = path.join(this.oldArchiveDir, file);
                    const stats = await fsPromises.stat(filePath);

                    if (stats.isFile()) {
                        const size = stats.size;
                        archivedSize += size;
                        totalSize += size;
                    }
                }
            } catch (error) {
                logger.debug(`Папка OLD не найдена или недоступна: ${error.message}`);
            }

            this.sizeCache = {
                data: { totalSize, archivedSize, activeSize },
                lastUpdate: now
            };

            logger.debug(`Размер файлов обновлен в кэше: total=${totalSize}, archived=${archivedSize}, active=${activeSize}`);
            return this.sizeCache.data;

        } catch (error) {
            logger.error(`Ошибка при подсчете размера: ${error.message}`);
            return { totalSize: 0, archivedSize: 0, activeSize: 0 };
        }
    }
}

module.exports = { IStorage, FileStorage };
