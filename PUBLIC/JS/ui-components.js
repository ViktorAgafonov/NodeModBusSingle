// Компоненты интерфейса
export function createStorageCard(storage) {
    if (!storage.id) {
        console.error('Объект склада без ID:', storage);
        return '';
    }

    const temperatureSensors = storage.device.sensors.filter(sensor => sensor.type === 'temperature');
    const humiditySensors = storage.device.sensors.filter(sensor => sensor.type === 'humidity');

    // Функция для получения индекса цвета
    const getColorIndex = (index) => {
        const maxIndex = 5;
        return (index % maxIndex) + 1;
    };

    return `
        <div class="storage-card" data-storage="${storage.id}">
            <div class="card-header">
                <div class="header-content">
                    <h2>${storage.name}</h2>
                    <button class="history-btn" data-storage-id="${storage.id}" title="Показать историю всех датчиков">📊</button>
                </div>
                <div class="warning-indicator" title="Есть датчики со значениями вне допустимого диапазона">
                    <span class="warning-icon">⚠️</span>
                </div>
                <div class="status-indicator online"></div>
            </div>
            <div class="card-content">
                <div class="current-data">
                    ${temperatureSensors.length > 0 ? `
                        <div class="data-group temperature-group">
                            <h3>Температура</h3>
                            ${temperatureSensors.map((sensor, index) => `
                                <div class="sensor-item">
                                    <div class="group-icon temperature" style="background-color: var(--temperature-color-${getColorIndex(index)})"></div>
                                    <span class="label">${sensor.name}:</span>
                                    <span class="value-wrapper">
                                        <span class="value" id="${sensor.id}" style="color: var(--temperature-color-${getColorIndex(index)})">--</span>
                                        <span class="unit">°C</span>
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    ${humiditySensors.length > 0 ? `
                        <div class="data-group humidity-group">
                            <h3>Влажность</h3>
                            ${humiditySensors.map((sensor, index) => `
                                <div class="sensor-item">
                                    <div class="group-icon humidity" style="background-color: var(--humidity-color-${getColorIndex(index)})"></div>
                                    <span class="label">${sensor.name}:</span>
                                    <span class="value-wrapper">
                                        <span class="value" id="${sensor.id}" style="color: var(--humidity-color-${getColorIndex(index)})">--</span>
                                        <span class="unit">%</span>
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
                <div class="chart-container" id="chart_container_${storage.id}">
                    <canvas id="chart_${storage.id}"></canvas>
                </div>
            </div>
        </div>
    `;
}

export function updateWarningIndicators(storageWarnings) {
    storageWarnings.forEach((warning, storageId) => {
        const warningIndicator = document.querySelector(`[data-storage="${storageId}"] .warning-indicator`);
        if (warningIndicator) {
            if (warning.hasWarning) {
                warningIndicator.classList.add('active');
                warningIndicator.title = Array.from(warning.messages).join('\n');
            } else {
                warningIndicator.classList.remove('active');
            }
        }
    });
}

export function updateStatusIndicators(storageStatuses) {
    storageStatuses.forEach((isOnline, storageId) => {
        const statusIndicator = document.querySelector(`[data-storage="${storageId}"] .status-indicator`);
        if (statusIndicator) {
            if (!isOnline) {
                statusIndicator.classList.remove('online');
                statusIndicator.classList.add('offline');
            } else {
                statusIndicator.classList.remove('offline');
                statusIndicator.classList.add('online');
            }
        }
    });
}