const logger = require('./logger');

function decodeModbusValue(data, sensorType) {
    try {
        // Подробное логирование входных данных
        logger.debug(`Получены данные для декодирования (тип датчика: ${sensorType}): ${JSON.stringify(data)}`);

        // Расширенная проверка входных данных
        if (!data) {
            throw new Error('Входные данные отсутствуют');
        }

        if (!data.data) {
            throw new Error('Отсутствует поле data в входных данных');
        }

        if (!Array.isArray(data.data)) {
            throw new Error('Поле data не является массивом');
        }

        if (data.data.length < 2) {
            throw new Error(`Недостаточно регистров для декодирования (получено: ${data.data.length}, требуется: 2)`);
        }

        // Проверка значений регистров
        if (!Number.isInteger(data.data[0]) || !Number.isInteger(data.data[1])) {
            throw new Error('Значения регистров должны быть целыми числами');
        }

        const buffer = new ArrayBuffer(4);
        const parseData = new DataView(buffer);

        // Логируем значения регистров перед декодированием
        logger.debug(`Значения регистров перед декодированием: R1=${data.data[0]} (0x${data.data[0].toString(16)}), R2=${data.data[1]} (0x${data.data[1].toString(16)})`);

        parseData.setUint16(0, data.data[1], false); // false для big-endian
        parseData.setUint16(2, data.data[0], false);
        
        const result = parseData.getFloat32(0, false); // false для big-endian
        
        // Проверка результата
        if (!Number.isFinite(result)) {
            throw new Error(`Результат декодирования не является корректным числом: ${result}`);
        }

        if (Math.abs(result) > 100) {
            throw new Error(`Подозрительно большое значение после декодирования: ${result}`);
        }
        
        logger.debug(`Успешно декодировано значение: ${result} (тип: ${sensorType})`);
        return result;
    } catch (error) {
        logger.error(`Ошибка декодирования данных Modbus: ${error.message}`);
        // Добавляем stack trace для отладки
        logger.debug(`Stack trace: ${error.stack}`);
        return null;
    }
}

module.exports = {
    decodeModbusValue
}; 