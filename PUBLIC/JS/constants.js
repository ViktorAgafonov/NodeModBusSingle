// Константы для приложения

// Лимиты корректности датчиков (общие, заполняется из конфига)
let sensorLimits = {};

// Лимиты участков (ключ — sectionId)
const sectionLimitsMap = new Map();

// Инициализация обоих типов лимитов из конфига
export function initLimits(config) {
    sensorLimits = config?.sensorLimits || {};
    sectionLimitsMap.clear();
    if (!config?.sections) return;
    config.sections.forEach(section => {
        if (section.limits) {
            sectionLimitsMap.set(section.id, section.limits);
        }
    });
}

// Лимиты корректности датчика по типу
export function getSensorLimits(type) {
    return sensorLimits[type] || null;
}

// Лимиты участка по sectionId и типу датчика
export function getSectionLimits(sectionId, type) {
    const limits = sectionLimitsMap.get(sectionId);
    return limits?.[type] || null;
}

// Хранилище для графиков
export const charts = new Map();

// Кэш для исторических данных
export const historyCache = new Map();

// Константы для API
export const API_ENDPOINTS = {
    CURRENT_DATA: '/api/current',
    HISTORICAL_DATA: '/api/history',
    CONFIG: '/api/config',
    SECTION_HISTORY: (sectionId) => `/api/section/${sectionId}/history`
}; 