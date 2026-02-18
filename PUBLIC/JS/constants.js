// Константы для приложения

// Лимиты для датчиков
export const SENSOR_LIMITS = {
    temperature: {
        min: -20,
        max: 30,
        warningMessage: 'Температура вне допустимого диапазона'
    },
    humidity: {
        min: 30,
        max: 50,
        warningMessage: 'Влажность вне допустимого диапазона'
    }
};

// Хранилище для графиков
export const charts = new Map();

// Кэш для исторических данных
export const historyCache = new Map();

// Константы для API
export const API_ENDPOINTS = {
    CURRENT_DATA: '/api/current',
    HISTORICAL_DATA: '/api/history',
    CONFIG: '/api/config',
    STORAGE_HISTORY: (storageId) => `/api/storage/${storageId}/history`
}; 