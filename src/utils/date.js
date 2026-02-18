const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);

// Форматирование даты для имени файла (локальное время)
function formatDate(date) {
    return dayjs(date).format('YYYY-MM-DD');
}

// Парсинг временного диапазона (локальное время)
function parseTimeRange(range) {
    const endTime = dayjs();
    const value = parseInt(range);
    const unit = range.slice(-1);

    let startTime;
    switch(unit) {
        case 'h':
            startTime = dayjs(endTime).subtract(value, 'hours');
            break;
        case 'd':
            startTime = dayjs(endTime).subtract(value, 'days');
            break;
        default:
            startTime = dayjs(endTime).subtract(1, 'hour');
    }

    return {
        startTime: startTime.toDate(),
        endTime: endTime.toDate()
    };
}

// Форматирование timestamp для записи в архив (локальное время)
function formatTimestamp(date) {
    return dayjs(date).format('YYYY-MM-DD HH:mm:ss');
}

module.exports = {
    formatDate,
    parseTimeRange,
    formatTimestamp
};