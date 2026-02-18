/**
 * Мок-сервер Modbus TCP для тестового окружения
 * 
 * Эмулирует Modbus TCP устройства для участков ШОР.
 * Порты берутся из config.sections[].device.port.
 * Регистры: 2200-2201 (влажность), 2250-2251 (температура).
 * 
 * Запуск: node mock-modbus-server.js
 * Или через npm test (автоматически)
 */

const net = require('net');
const logger = require('./src/utils/logger');
const config = require('config');

// Настройки эмулятора из конфигурации
const emulatorConfig = config.emulator || {};
const valueChanges = emulatorConfig.valueChanges || {};
const updateInterval = emulatorConfig.updateInterval || 5000;

// Вычисляем базовые значения как среднее между min и max из конфигурации
const calculateBaseValues = () => {
    const baseTemp = valueChanges.temperature ? 
        (valueChanges.temperature.min_value + valueChanges.temperature.max_value) / 2 : 20.0;
    const baseHumidity = valueChanges.humidity ? 
        (valueChanges.humidity.min_value + valueChanges.humidity.max_value) / 2 : 50.0;
    
    return {
        temperature: baseTemp,
        humidity: baseHumidity
    };
};

const calculatedBase = calculateBaseValues();

// Порты из конфигурации sections
const sectionPorts = (config.sections || []).map(s => s.device.port);
const sectionNames = {};
(config.sections || []).forEach(s => { sectionNames[s.device.port] = s.name; });

// Базовые значения для каждого участка
const baseValues = {};
sectionPorts.forEach(port => {
    baseValues[port] = {
        humidity: calculatedBase.humidity,
        temperature: calculatedBase.temperature
    };
});

// Текущие значения (копия базовых)
let deviceValues = JSON.parse(JSON.stringify(baseValues));

// Функция для плавного изменения значений согласно конфигурации
function updateValues() {
    Object.keys(deviceValues).forEach(port => {
        // Применяем изменения относительно базовых значений
        if (valueChanges.humidity) {
            const humidityChange = valueChanges.humidity.change || 2.2;
            // Генерируем максимальное разовое отклонение: базовое ± случайное_от_0_до_change
            const baseHumidity = baseValues[port].humidity;
            deviceValues[port].humidity = baseHumidity + (Math.random() - 0.5) * 2 * humidityChange;
            
            // Ограничиваем значения согласно конфигурации
            const minHumidity = valueChanges.humidity.min_value || 0;
            const maxHumidity = valueChanges.humidity.max_value || 100;
            deviceValues[port].humidity = Math.max(minHumidity, Math.min(maxHumidity, deviceValues[port].humidity));
        }
        
        if (valueChanges.temperature) {
            const tempChange = valueChanges.temperature.change || 5.3;
            // Генерируем максимальное разовое отклонение: базовое ± случайное_от_0_до_change
            const baseTemp = baseValues[port].temperature;
            deviceValues[port].temperature = baseTemp + (Math.random() - 0.5) * 2 * tempChange;
            
            // Ограничиваем значения согласно конфигурации
            const minTemp = valueChanges.temperature.min_value || -20;
            const maxTemp = valueChanges.temperature.max_value || 40;
            deviceValues[port].temperature = Math.max(minTemp, Math.min(maxTemp, deviceValues[port].temperature));
        }
    });
    
    const summary = Object.keys(deviceValues).map(p => `${sectionNames[p] || p} (${deviceValues[p].temperature.toFixed(1)}°C, ${deviceValues[p].humidity.toFixed(1)}%)`).join(', ');
    logger.debug(`[Мок-сервер] Обновлены значения: ${summary}`);
}

// Обновляем значения согласно интервалу из конфигурации
setInterval(updateValues, updateInterval);

// Функция кодирования float32 в два регистра (как в эмуляторе)
function encodeFloat32ToRegisters(value) {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setFloat32(0, value, false); // false = big-endian

    return {
        register1: view.getUint16(2, false), // Младшие байты
        register2: view.getUint16(0, false)  // Старшие байты
    };
}

// Парсинг Modbus TCP запроса
function parseModbusRequest(buffer) {
    if (buffer.length < 12) return null;
    
    const transactionId = buffer.readUInt16BE(0);
    const protocolId = buffer.readUInt16BE(2);
    const length = buffer.readUInt16BE(4);
    const unitId = buffer.readUInt8(6);
    const functionCode = buffer.readUInt8(7);
    const startAddress = buffer.readUInt16BE(8);
    const quantity = buffer.readUInt16BE(10);
    
    return {
        transactionId,
        protocolId,
        length,
        unitId,
        functionCode,
        startAddress,
        quantity
    };
}

// Создание Modbus TCP ответа
function createModbusResponse(request, data) {
    const responseLength = 3 + data.length * 2; // unit + function + byteCount + data
    const buffer = Buffer.alloc(6 + responseLength);
    
    // MBAP Header
    buffer.writeUInt16BE(request.transactionId, 0); // Transaction ID
    buffer.writeUInt16BE(0, 2); // Protocol ID
    buffer.writeUInt16BE(responseLength, 4); // Length
    buffer.writeUInt8(request.unitId, 6); // Unit ID
    
    // PDU
    buffer.writeUInt8(request.functionCode, 7); // Function Code
    buffer.writeUInt8(data.length * 2, 8); // Byte Count
    
    // Data
    for (let i = 0; i < data.length; i++) {
        buffer.writeUInt16BE(data[i], 9 + i * 2);
    }
    
    return buffer;
}

// Функция создания сервера для конкретного порта
function createServerForPort(port) {
    const server = net.createServer((socket) => {
        logger.info(`[Мок-сервер :${port}] Новое подключение от`, socket.remoteAddress);
        
        socket.on('data', (buffer) => {
            const request = parseModbusRequest(buffer);
            if (!request) {
                logger.info(`[Мок-сервер :${port}] Некорректный запрос`);
                return;
            }
            
            logger.info(`[Мок-сервер :${port}] Получен запрос: start=${request.startAddress}, quantity=${request.quantity}, unit=${request.unitId}, function=${request.functionCode}`);
            
            // Обрабатываем только функцию 3 (Read Holding Registers)
            if (request.functionCode === 3) {
                const responseData = [];
                const values = deviceValues[port];
                
                if (!values) {
                    logger.error(`[Мок-сервер :${port}] Значения для устройства не найдены`);
                    return;
                }
                
                // Формируем ответ для каждого регистра
                for (let i = 0; i < request.quantity; i += 2) {
                    const regAddr = request.startAddress + i;
                    
                    if (regAddr === 2200) {
                        // Влажность
                        const registers = encodeFloat32ToRegisters(values.humidity);
                        responseData.push(registers.register1, registers.register2);
                        logger.info(`[Мок-сервер :${port}] Влажность ${values.humidity.toFixed(1)}% для регистра ${regAddr}`);
                    } else if (regAddr === 2250) {
                        // Температура
                        const registers = encodeFloat32ToRegisters(values.temperature);
                        responseData.push(registers.register1, registers.register2);
                        logger.info(`[Мок-сервер :${port}] Температура ${values.temperature.toFixed(1)}°C для регистра ${regAddr}`);
                    } else {
                        // Неизвестный регистр - возвращаем нули
                        responseData.push(0, 0);
                        logger.info(`[Мок-сервер :${port}] Возвращаем нули для неизвестного регистра ${regAddr}`);
                    }
                }
                
                // Обрезаем данные до запрошенного количества регистров
                const finalData = responseData.slice(0, request.quantity);
                
                const response = createModbusResponse(request, finalData);
                socket.write(response);
                
                logger.info(`[Мок-сервер :${port}] Отправлен ответ: ${finalData.length} регистров: [${finalData.map(v => `0x${v.toString(16).padStart(4, '0')}`).join(', ')}]`);
            } else {
                logger.info(`[Мок-сервер :${port}] Неподдерживаемая функция: ${request.functionCode}`);
            }
        });
        
        socket.on('close', () => {
            logger.info(`[Мок-сервер :${port}] Соединение закрыто`);
        });
        
        socket.on('error', (err) => {
            logger.error(`[Мок-сервер :${port}] Ошибка соединения:`, err.message);
        });
    });

    server.listen(port, '127.0.0.1', () => {
        const name = sectionNames[port] || `Порт ${port}`;
        logger.info(`[Мок-сервер :${port}] ${name} — запущен на 127.0.0.1:${port}`);
    });

    server.on('error', (err) => {
        logger.error(`[Мок-сервер :${port}] Ошибка сервера:`, err.message);
        if (err.code === 'EADDRINUSE') {
            logger.error(`[Мок-сервер :${port}] Порт ${port} уже занят.`);
        }
    });

    return server;
}

// Создаем серверы для всех участков
const servers = [];
const ports = sectionPorts;

ports.forEach(port => {
    try {
        const server = createServerForPort(port);
        servers.push(server);
    } catch (error) {
        logger.error(`Ошибка создания сервера для порта ${port}:`, error.message);
    }
});

logger.info('[Мок-сервер] Все серверы запущены');
logger.info(`[Мок-сервер] Значения обновляются каждые ${updateInterval}мс`);
logger.info(`[Мок-сервер] Базовые значения (среднее между min и max):`);
logger.info(`[Мок-сервер]   - Температура: ${calculatedBase.temperature}°C`);
logger.info(`[Мок-сервер]   - Влажность: ${calculatedBase.humidity}%`);
logger.info(`[Мок-сервер] Настройки изменений из конфигурации:`);
if (valueChanges.temperature) {
    logger.info(`[Мок-сервер]   - Температура: диапазон ${valueChanges.temperature.min_value}°C - ${valueChanges.temperature.max_value}°C, максимальное отклонение ±${valueChanges.temperature.change}°C`);
}
if (valueChanges.humidity) {
    logger.info(`[Мок-сервер]   - Влажность: диапазон ${valueChanges.humidity.min_value}% - ${valueChanges.humidity.max_value}%, максимальное отклонение ±${valueChanges.humidity.change}%`);
}

process.on('SIGINT', () => {
    logger.info('\n[Мок-сервер] Завершение работы...');
    servers.forEach(server => server.close());
    process.exit();
}); 
