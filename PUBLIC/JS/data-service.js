import { SENSOR_LIMITS, API_ENDPOINTS, historyCache } from './constants.js';

// Базовая функция для выполнения HTTP-запросов
async function fetchAPI(url, options = {}, retries = 2) {
    try {
        const response = await fetch(url, options);
        
        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('Превышен лимит запросов. Пожалуйста, подождите.');
            }
            
            const error = await response.json().catch(() => ({ error: 'Неизвестная ошибка' }));
            throw new Error(error.error || `Ошибка запроса: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error(`Ошибка запроса к ${url}:`, error);
        
        // Если это ошибка сети и остались попытки, пробуем снова
        if ((error instanceof TypeError || error.message === 'Failed to fetch') && retries > 0) {
            console.log(`Повторная попытка запроса к ${url}, осталось попыток: ${retries}`);
            // Ждем перед повторной попыткой
            await new Promise(resolve => setTimeout(resolve, 1000));
            return fetchAPI(url, options, retries - 1);
        }
        
        throw error;
    }
}

// Функция проверки значения на выход за границы
function isValueOutOfLimits(value, type) {
    if (value === null || value === undefined) return false;
    
    const limits = SENSOR_LIMITS[type];
    if (!limits) return false;

    return value < limits.min || value > limits.max;
}

// Получение текущих данных
async function fetchCurrentData() {
    try {
        return await fetchAPI(API_ENDPOINTS.CURRENT_DATA);
    } catch (error) {
        console.error('Ошибка при получении текущих данных:', error);
        throw error;
    }
}

// Получение исторических данных
async function fetchHistoricalData(range) {
    try {
        return await fetchAPI(`${API_ENDPOINTS.HISTORICAL_DATA}?range=${range}`);
    } catch (error) {
        console.error('Ошибка при получении исторических данных:', error);
        throw error;
    }
}

// Получение исторических данных для конкретного склада
async function fetchStorageHistory(storageId, range) {
    const cacheKey = `${storageId}_${range}`;
    
    // Проверяем кэш
    if (historyCache.has(cacheKey)) {
        const cachedData = historyCache.get(cacheKey);
        const now = Date.now();

        // Используем кэш, если данные не старше 30 секунд (уменьшено с 5 минут для более быстрого обновления)
        if (now - cachedData.timestamp < 30* 1000) {
            return cachedData.data;
        }
    }
    
    try {
        const data = await fetchAPI(`${API_ENDPOINTS.STORAGE_HISTORY(storageId)}?range=${range}`);
        
        // Сохраняем в кэш
        historyCache.set(cacheKey, {
            data,
            timestamp: Date.now()
        });
        
        return data;
    } catch (error) {
        console.error(`Ошибка при получении истории для склада ${storageId}:`, error);
        throw error;
    }
}

// Получение конфигурации
async function fetchConfig() {
    try {
        return await fetchAPI(API_ENDPOINTS.CONFIG);
    } catch (error) {
        console.error('Ошибка при получении конфигурации:', error);
        throw error;
    }
}

export { isValueOutOfLimits, fetchCurrentData, fetchHistoricalData, fetchStorageHistory, fetchConfig, fetchAPI };