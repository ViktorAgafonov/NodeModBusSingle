// Компоненты интерфейса
export function createSectionCard(section) {
    if (!section.id) {
        console.error('Объект участка без ID:', section);
        return '';
    }

    const temperatureSensors = section.device.sensors.filter(sensor => sensor.type === 'temperature');
    const humiditySensors = section.device.sensors.filter(sensor => sensor.type === 'humidity');

    return `
        <div class="section-card" data-section="${section.id}">
            <div class="card-header">
                <h2>«${section.name}»</h2>
                <div class="header-right">
                    <div class="status-badge online">Онлайн</div>
                    <button class="history-btn" data-section-id="${section.id}" title="Показать историю">📊</button>
                </div>
            </div>
            <div class="card-body">
                <div class="temp-bars-vertical">
                    ${temperatureSensors.map(sensor => `
                        <div class="temp-bar-wrapper">
                            <span class="bar-limit bar-limit-max">${section.limits?.temperature?.max ?? ''}</span>
                            <div class="temp-bar-track">
                                <div class="temp-bar-fill" data-sensor="${sensor.id}"></div>
                            </div>
                            <span class="bar-limit bar-limit-min">${section.limits?.temperature?.min ?? ''}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="card-content">
                    <div class="sensors-area">
                        ${temperatureSensors.length > 0 ? `
                            <div class="temp-block">
                                <div class="temp-label">🌡️ Температура</div>
                                ${temperatureSensors.map((sensor, index) => `
                                    <div class="temp-value-row">
                                        <span class="temp-value" id="${sensor.id}">--</span>
                                        <span class="temp-unit">°C</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                        ${humiditySensors.length > 0 ? `
                            <div class="humidity-block">
                                <div class="humidity-label">💧 Влажность</div>
                                ${humiditySensors.map((sensor, index) => `
                                    <div class="humidity-value-row">
                                        <span class="humidity-value" id="${sensor.id}">--</span>
                                        <span class="humidity-unit">%</span>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                    <div class="chart-area" id="chart_container_${section.id}">
                        <canvas id="chart_${section.id}"></canvas>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function updateWarningIndicators(sectionWarnings) {
    sectionWarnings.forEach((warning, sectionId) => {
        const card = document.querySelector(`[data-section="${sectionId}"]`);
        if (!card) return;

        card.classList.remove('warning-active', 'temperature-warning', 'humidity-warning');
        if (warning.hasWarning) {
            card.classList.add('warning-active');
            if (warning.warningTypes.has('temperature')) card.classList.add('temperature-warning');
            if (warning.warningTypes.has('humidity')) card.classList.add('humidity-warning');
        }
    });
}

export function updateStatusIndicators(sectionStatuses) {
    sectionStatuses.forEach((isOnline, sectionId) => {
        const badge = document.querySelector(`[data-section="${sectionId}"] .status-badge`);
        if (badge) {
            if (!isOnline) {
                badge.classList.remove('online');
                badge.classList.add('offline');
                badge.textContent = 'Офлайн';
            } else {
                badge.classList.remove('offline');
                badge.classList.add('online');
                badge.textContent = 'Онлайн';
            }
        }
    });
}
