const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

// Получаем уровень логирования из переменной окружения или используем INFO по умолчанию
let currentLogLevel = LOG_LEVELS.DEBUG;

// Проверяем переменную окружения
if (process.env.LOG_LEVEL) {
    const envLevel = process.env.LOG_LEVEL.toUpperCase();
    if (LOG_LEVELS[envLevel] !== undefined) {
        currentLogLevel = LOG_LEVELS[envLevel];
    } else {
        console.warn(`Неизвестный уровень логирования: ${process.env.LOG_LEVEL}. Используется INFO.`);
    }
}

// Выводим информацию о текущем уровне логирования при запуске
const logLevelName = Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === currentLogLevel);
console.log(`Текущий уровень логирования: ${logLevelName} (${currentLogLevel})`);

function formatMessage(level, message) {
    const date = new Date();
    const timestamp = date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).replace(',', '');
    
    return `[${level}] ${timestamp} ${message}`;
}

function shouldLog(level) {
    const levelValue = LOG_LEVELS[level] ?? LOG_LEVELS.ERROR;
    return levelValue <= currentLogLevel;
}

function log(level, message) {
    if (!shouldLog(level)) return;
    const formattedMessage = formatMessage(level, message);
    process.stdout.write(formattedMessage + '\n');
    // Принудительная очистка буфера
    process.stdout.write('');
}

// Создаем и сразу экспортируем объект логгера
module.exports = {
    error: (message) => log('ERROR', '\x1b[31m' + message + '\x1b[0m'), // Красный цвет для ошибок
    warn: (message) => log('WARN', '\x1b[33m' + message + '\x1b[0m'),   // Желтый цвет для предупреждений
    info: (message) => log('INFO', '\x1b[37m' + message + '\x1b[0m'),   // Белый цвет для информации
    debug: (message) => log('DEBUG', '\x1b[32m' + message + '\x1b[0m')  // Зеленый цвет для отладки
};