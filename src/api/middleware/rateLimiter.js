const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 360,
    message: 'Превышен лимит запросов к API'
});

const historyLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 180,
    message: 'Превышен лимит запросов к историческим данным'
});

module.exports = { apiLimiter, historyLimiter };
