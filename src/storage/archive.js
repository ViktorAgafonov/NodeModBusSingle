const fs = require('fs'); // Стандартный модуль fs для потоков
const fsPromises = require('fs').promises; // Промис-версия для асинхронных операций
const path = require('path');
const logger = require(path.join(__dirname, '../utils/logger'));
const archiver = require('archiver');
const { formatDate, formatTimestamp } = require('../utils/date');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const EventEmitter = require('events');
dayjs.extend(customParseFormat);

// Создаем эмиттер для уведомления о новых данных
const archiveEvents = new EventEmitter();

const ARCHIVE_DIR = path.join(__dirname, '../../archive');
const OLD_ARCHIVE_DIR = path.join(__dirname, '../../archive/OLD');

async function ensureArchiveDir(DIR) {
    try {
        await fsPromises.access(DIR);
    } catch {
        await fsPromises.mkdir(DIR, { recursive: true });
    }
}

let isSavingToArchive = false;

async function saveToArchive(sensorData) {
    // Проверяем, не выполняется ли уже операция сохранения
    if (isSavingToArchive) {
        logger.warn('Операция сохранения в архив уже выполняется, пропускаем текущий вызов');
        return;
    }
    try {
        isSavingToArchive = true; // Устанавливаем флаг выполнения

        const sensors = Object.values(sensorData);
        if (sensors.length === 0) return;

        const validSensors = sensors.filter(sensor => !sensor.error && sensor.value !== null);
        if (validSensors.length === 0) return;

        await ensureArchiveDir(ARCHIVE_DIR);
        
        const filename = `${formatDate(new Date())}.json`;
        const filepath = path.join(ARCHIVE_DIR, filename);
        
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
                // Валидация значений в зависимости от типа датчика
                let value = sensor.value;
                if (sensor.type === 'humidity' && value < 0) {
                    value = 0;
                }
                return {
                    sensor_id: sensor.id, // Используем полный ID датчика из currentSensorData
                    type: sensor.type,
                    value: parseFloat(value.toFixed(3))
                };
            })
        };
        
        archiveData.push(entry);
        await fsPromises.writeFile(filepath, JSON.stringify(archiveData, null, 2));
        logger.info(`Архивация: ${filename} (${entry.sensors.length} датчиков)`);

        // Генерируем событие о сохранении новых данных для инвалидации кэша
        archiveEvents.emit('dataArchived', { filename, timestamp: entry.timestamp });

    } catch (error) {
        logger.error(`Ошибка сохранения в архив: ${error.message}`);
    } finally {
        isSavingToArchive = false; // Сбрасываем флаг в любом случае
    }
}

let isZippingOldArchive = false;

// Функция для сжатия архивов старше 2 месяцев
async function zipOldArchive() {
    // Проверяем, не выполняется ли уже операция архивирования
    if (isZippingOldArchive) {
        logger.warn('Операция сжатия архива уже выполняется, пропускаем текущий вызов');
        return;
    }
    try {
        isZippingOldArchive = true; // Устанавливаем флаг выполнения

        const files = await fsPromises.readdir(ARCHIVE_DIR);
        const twoMonthsAgo = dayjs().subtract(2, 'months').startOf('day').toDate();
        const oldFiles = files.filter(file => {
            const fileDate = dayjs(file.replace('.json', ''), 'YYYY-MM-DD');
            return fileDate.isValid() && fileDate.toDate() < twoMonthsAgo;
        });
        
        if (oldFiles.length === 0) return;
        
        await ensureArchiveDir(ARCHIVE_DIR);
        await ensureArchiveDir(OLD_ARCHIVE_DIR);
        
        logger.info(`Начало архивирования ${oldFiles.length} старых файлов`);
        // Обрабатываем файлы параллельно, до CONCURRENT_LIMIT файлов, уровень сжатия "level: 6" для ускорения
        const CONCURRENT_LIMIT = 3;
        for (let i = 0; i < oldFiles.length; i += CONCURRENT_LIMIT) {
            const batch = oldFiles.slice(i, i + CONCURRENT_LIMIT);
        
            await Promise.all(batch.map(async (file) => {
                const sourcePath = path.join(ARCHIVE_DIR, file);
                const targetPath = path.join(OLD_ARCHIVE_DIR, `${file}.zip`);
        
                try {
                    await new Promise((resolve, reject) => {
                        const archive = archiver('zip', { zlib: { level: 6 }});
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
    } finally {
        isZippingOldArchive = false; // Сбрасываем флаг в любом случае
    }
}

module.exports = {
    saveToArchive,
    zipOldArchive,
    archiveEvents
};