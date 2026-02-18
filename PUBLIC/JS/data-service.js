import { API_ENDPOINTS, historyCache, getSensorLimits, getSectionLimits } from './constants.js';

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

// Проверка корректности показаний датчика (общие лимиты по типу)
function isSensorOutOfLimits(value, type) {
    if (value === null || value === undefined) return false;
    const limits = getSensorLimits(type);
    if (!limits) return false;
    return value < limits.min || value > limits.max;
}

// Проверка выхода за нормы участка (индивидуальные лимиты секции)
function isSectionOutOfLimits(value, sectionId, type) {
    if (value === null || value === undefined) return false;
    const limits = getSectionLimits(sectionId, type);
    if (!limits) return false;
    return value < limits.min || value > limits.max;
}

// Проверка попадания в зону предупреждения участка (warning_min/warning_max)
function isSectionWarning(value, sectionId, type) {
    if (value === null || value === undefined) return false;
    const limits = getSectionLimits(sectionId, type);
    if (!limits) return false;
    if (limits.warning_min != null && value < limits.warning_min) return true;
    if (limits.warning_max != null && value > limits.warning_max) return true;
    return false;
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

// Получение исторических данных (всегда за 1 час)
async function fetchHistoricalData() {
    try {
        return await fetchAPI(API_ENDPOINTS.HISTORICAL_DATA);
    } catch (error) {
        console.error('Ошибка при получении исторических данных:', error);
        throw error;
    }
}

// Получение исторических данных для конкретного участка (всегда за 1 час)
async function fetchSectionHistory(sectionId) {
    const cacheKey = sectionId;
    
    // Проверяем кэш
    if (historyCache.has(cacheKey)) {
        const cachedData = historyCache.get(cacheKey);
        const now = Date.now();

        if (now - cachedData.timestamp < 30 * 1000) {
            return cachedData.data;
        }
    }
    
    try {
        const data = await fetchAPI(API_ENDPOINTS.SECTION_HISTORY(sectionId));
        
        historyCache.set(cacheKey, {
            data,
            timestamp: Date.now()
        });
        
        return data;
    } catch (error) {
        console.error(`Ошибка при получении истории для участка ${sectionId}:`, error);
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

export { isSensorOutOfLimits, isSectionOutOfLimits, isSectionWarning, fetchCurrentData, fetchHistoricalData, fetchSectionHistory, fetchConfig, fetchAPI };