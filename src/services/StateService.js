/**
 * Сервис для управления состоянием приложения
 * Заменяет глобальные переменные на централизованное хранилище
 */
class StateService {
    constructor() {
        this.currentSensorData = {};
        this.config = null;
    }

    /**
     * Установка конфигурации
     */
    setConfig(config) {
        this.config = config;
    }

    /**
     * Получение конфигурации
     */
    getConfig() {
        return this.config;
    }

    /**
     * Обновление данных датчика
     */
    updateSensorData(sensorId, data) {
        this.currentSensorData[sensorId] = data;
    }

    /**
     * Получение данных всех датчиков
     */
    getAllSensorData() {
        return this.currentSensorData;
    }

    /**
     * Получение данных конкретного датчика
     */
    getSensorData(sensorId) {
        return this.currentSensorData[sensorId];
    }

    /**
     * Очистка данных датчиков
     */
    clearSensorData() {
        this.currentSensorData = {};
    }
}

module.exports = StateService;
