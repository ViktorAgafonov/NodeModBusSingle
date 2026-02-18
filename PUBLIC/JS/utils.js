/**
 * Утилиты для фронтенда
 */

/**
 * Debounce функция для ограничения частоты вызовов
 * @param {Function} func - Функция для debounce
 * @param {number} wait - Время ожидания в мс
 * @returns {Function} - Debounced функция
 */
export function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle функция для ограничения частоты вызовов
 * @param {Function} func - Функция для throttle
 * @param {number} limit - Минимальный интервал между вызовами в мс
 * @returns {Function} - Throttled функция
 */
export function throttle(func, limit = 300) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Intersection Observer для lazy loading
 * @param {Function} callback - Функция обратного вызова
 * @param {Object} options - Опции для IntersectionObserver
 * @returns {IntersectionObserver} - Observer instance
 */
export function createLazyObserver(callback, options = {}) {
    const defaultOptions = {
        root: null,
        rootMargin: '50px',
        threshold: 0.01
    };

    return new IntersectionObserver(callback, { ...defaultOptions, ...options });
}

/**
 * Проверка видимости элемента
 * @param {HTMLElement} element - Элемент для проверки
 * @returns {boolean} - Виден ли элемент
 */
export function isElementVisible(element) {
    const rect = element.getBoundingClientRect();
    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
}

/**
 * Форматирование даты
 * @param {Date|string|number} date - Дата для форматирования
 * @param {string} format - Формат вывода
 * @returns {string} - Отформатированная дата
 */
export function formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
    if (typeof window.dayjs !== 'undefined') {
        return window.dayjs(date).format(format);
    }
    return new Date(date).toLocaleString('ru-RU');
}

/**
 * Безопасный парсинг JSON
 * @param {string} jsonString - JSON строка
 * @param {*} defaultValue - Значение по умолчанию при ошибке
 * @returns {*} - Распарсенный объект или значение по умолчанию
 */
export function safeJSONParse(jsonString, defaultValue = null) {
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.error('JSON parse error:', e);
        return defaultValue;
    }
}

/**
 * Создание уникального ID
 * @returns {string} - Уникальный ID
 */
export function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
