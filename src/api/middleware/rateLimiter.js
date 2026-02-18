const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 360, // Максимум 180 запросов в минуту
    message: 'Превышен лимит запросов к API',
    type: "error",
    standardHeaders: true,
    legacyHeaders: false,
});

const historyLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 180, // Максимум 60 запросов в минуту
    message: 'Превышен лимит запросов к историческим данным',
    type: "error",
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = { apiLimiter, historyLimiter };
