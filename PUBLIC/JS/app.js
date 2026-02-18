// Основной файл приложения
import { charts, historyCache, getSensorLimits, getSectionLimits, initLimits } from './constants.js';
import { initChart, CHARTS_SETTINGS, mainLegendPlugin, initChartLimits } from './chart-utils.js';
import { fetchCurrentData, fetchHistoricalData, fetchConfig, isSensorOutOfLimits, isSectionOutOfLimits, isSectionWarning } from './data-service.js';
import { createSectionCard, updateWarningIndicators, updateStatusIndicators } from './ui-components.js';
import { createHistoryModal, updateHistoryChart, initHistoryButtons } from './modal-history.js';
import { createLazyObserver } from './utils.js';
import { showConnectionError, retryConnection, markSensorsOffline, markSectionsOffline } from './error-handler.js';

const SETTINGS = {
    timeRefresh: 5000
};

// Отслеживание загруженных графиков для lazy loading
const loadedCharts = new Set();

// Проверка валидности значения датчика
function isValidSensorValue(value) {
    return value != null && Number.isFinite(value);
}

// Обновление данных
async function updateData() {
    try {
        const data = await fetchCurrentData();
        const sectionWarnings = new Map();
        const sectionStatuses = new Map();

        // Инициализируем все участки как оффлайн изначально
        data.temperature.forEach(sensor => {
            const sectionId = sensor.sensor_id.split('.')[0];
            if (!sectionStatuses.has(sectionId)) {
                sectionStatuses.set(sectionId, false);
            }
        });

        [...data.temperature, ...data.humidity].forEach(sensor => {
            const element = document.getElementById(sensor.sensor_id);
            const sectionId = sensor.sensor_id.split('.')[0];

            // Инициализируем состояния для участка
            if (!sectionWarnings.has(sectionId)) {
                sectionWarnings.set(sectionId, {
                    hasWarning: false,
                    warningTypes: new Set(),
                    messages: new Set()
                });
            }

            if (element) {
                const valueRow = element.closest('.temp-value-row, .humidity-value-row');

                // Проверяем статус датчика
                if (sensor.error || sensor.value === null || sensor.status === 'offline') {
                    element.textContent = 'Err';
                    if (valueRow) valueRow.classList.add('error');

                    // Обновляем прогресс-бар при ошибке
                    const bar = document.querySelector(`.temp-bar-fill[data-sensor="${sensor.sensor_id}"]`);
                    if (bar) {
                        bar.style.height = '0%';
                        bar.className = 'temp-bar-fill';
                    }
                } else {
                    const value = sensor.value;
                    element.textContent = value.toFixed(1);
                    if (valueRow) valueRow.classList.remove('error');

                    // Если есть валидные данные - помечаем участок как онлайн
                    sectionStatuses.set(sectionId, true);

                    // Обновляем прогресс-бар температуры (по лимитам участка)
                    if (sensor.type === 'temperature') {
                        const bar = document.querySelector(`.temp-bar-fill[data-sensor="${sensor.sensor_id}"]`);
                        const secLimits = getSectionLimits(sectionId, 'temperature');
                        if (bar && secLimits) {
                            const pct = Math.max(0, Math.min(100, ((value - secLimits.min) / (secLimits.max - secLimits.min)) * 100));
                            bar.style.height = pct + '%';
                            bar.className = 'temp-bar-fill';
                            if (value < secLimits.min || value > secLimits.max) bar.classList.add('critical');
                            else if ((secLimits.warning_min != null && value < secLimits.warning_min) ||
                                     (secLimits.warning_max != null && value > secLimits.warning_max)) bar.classList.add('warning');
                        }
                    }

                    const warningState = sectionWarnings.get(sectionId);

                    // Проверка корректности датчика
                    if (isSensorOutOfLimits(value, sensor.type)) {
                        const sensLimits = getSensorLimits(sensor.type);
                        warningState.hasWarning = true;
                        warningState.warningTypes.add(sensor.type);
                        warningState.messages.add((sensLimits?.warningMessage || 'Некорректные показания датчика') + ' (' + sensLimits?.min + ' .. ' + sensLimits?.max + ')');
                    }

                    // Проверка норм участка (выход за min/max)
                    if (isSectionOutOfLimits(value, sectionId, sensor.type)) {
                        const secLimits = getSectionLimits(sectionId, sensor.type);
                        warningState.hasWarning = true;
                        warningState.warningTypes.add(sensor.type);
                        warningState.messages.add((secLimits?.warningMessage || 'Значение вне нормы участка') + ' (' + secLimits?.min + ' .. ' + secLimits?.max + ')');
                    }

                    // Проверка зоны предупреждения участка (warning_min/warning_max)
                    if (isSectionWarning(value, sectionId, sensor.type)) {
                        const secLimits = getSectionLimits(sectionId, sensor.type);
                        warningState.hasWarning = true;
                        warningState.warningTypes.add(sensor.type);
                        warningState.messages.add('Внимание: значение в зоне предупреждения (' + secLimits?.warning_min + ' .. ' + secLimits?.warning_max + ')');
                    }
                }
            }
        });

        updateStatusIndicators(sectionStatuses);
        updateWarningIndicators(sectionWarnings);

        return true; // Успешное обновление
    } catch (error) {
        console.error('Ошибка получения данных:', error);

        markSensorsOffline();

        // Помечаем все участки как оффлайн
        const sectionStatuses = new Map();
        markSectionsOffline(sectionStatuses);
        updateStatusIndicators(sectionStatuses);

        // Показываем уведомление об ошибке соединения
        showConnectionError(updateData);

        return false; // Ошибка обновления
    }
}

// Фиксированный интервал агрегации — 5 минут
const STEP_MS = 5 * 60 * 1000;
const MAX_GAP_MS = STEP_MS * 2;

// Основная функция обновления графиков (всегда за 1 час)
async function updateCharts() {
    try {
        historyCache.clear();

        const data = await fetchHistoricalData();

        for (const [sectionId, chart] of charts.entries()) {
            let currentChart = chart;
            if (!currentChart) {
                const canvas = document.getElementById(`chart_${sectionId}`);
                if (canvas && !loadedCharts.has(sectionId)) {
                    currentChart = initChart(sectionId);
                    loadedCharts.add(sectionId);
                }
                if (!currentChart) continue;
            }

            try {
                const datasets = [];

                const createDataset = (series, type, index) => {
                    const color = getComputedStyle(document.documentElement).getPropertyValue(`--${type}-color`).trim();

                    const processedData = series.data
                        .filter(point => isValidSensorValue(point.y))
                        .map(point => ({
                            x: window.dayjs(point.x, 'YYYY-MM-DD HH:mm:ss').valueOf(),
                            y: point.y
                        }));

                    return {
                        label: `${series.name}`,
                        tooltipLabel: type === 'temperature' ? 'Температура' : 'Влажность',
                        data: processedData,
                        borderColor: color,
                        backgroundColor: color.replace('rgb', 'rgba').replace(')', ', 0.1)'),
                        segment: {
                            borderDash: ctx => {
                                const gap = ctx.p1.parsed.x - ctx.p0.parsed.x;
                                return gap > MAX_GAP_MS ? [5, 5] : undefined;
                            }
                        },
                        yAxisID: type === 'humidity' ? 'y1' : 'y',
                        showLine: true,
                        hidden: false
                    };
                };

                data.temperature.forEach((series, index) => {
                    if (series.sectionId === sectionId) {
                        datasets.push(createDataset(series, 'temperature', index));
                    }
                });

                data.humidity.forEach((series, index) => {
                    if (series.sectionId === sectionId) {
                        datasets.push(createDataset(series, 'humidity', index));
                    }
                });

                currentChart.data.datasets = datasets;

                if (currentChart.options.plugins.title) {
                    currentChart.options.plugins.title.display = false;
                }

                currentChart.update('none');

                const legendContainer = document.getElementById(`legend-${currentChart.canvas.id}`);
                if (legendContainer) {
                    mainLegendPlugin.afterDraw(currentChart);
                }
            } catch (error) {
                console.error(`Ошибка обновления графика для участка ${sectionId}:`, error);
                const chartContainer = document.getElementById(`chart_container_${sectionId}`);
                if (chartContainer) {
                    chartContainer.innerHTML = `<div class="error-message"><p>Ошибка обновления графика: ${error.message}</p></div>`;
                }
            }
        }

        // Обновляем график в модальном окне, если оно открыто
        const modalCanvas = document.querySelector('.modal canvas');
        if (modalCanvas) {
            const sectionId = modalCanvas.id.replace('section_history_chart_', '');
            const chart = Chart.getChart(modalCanvas);
            if (chart) {
                try {
                    updateHistoryChart(chart, sectionId);
                } catch (error) {
                    console.error(`Ошибка обновления графика в модальном окне для участка ${sectionId}:`, error);
                }
            }
        }
    } catch (error) {
        console.error('Ошибка получения исторических данных:', error);
        document.querySelectorAll('.chart-container').forEach(container => {
            container.innerHTML = `<div class="error-message"><p>Ошибка получения данных: ${error.message}</p></div>`;
        });
    }
}

// Lazy loading для графиков
function initLazyChartLoading(config) {
    const chartObserver = createLazyObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const container = entry.target;
                const canvas = container.querySelector('canvas');
                if (canvas) {
                    const sectionId = canvas.id.replace('chart_', '');

                    // Проверяем, не загружен ли уже график
                    if (!loadedCharts.has(sectionId)) {
                        try {
                            initChart(sectionId);
                            loadedCharts.add(sectionId);
                        } catch (error) {
                            console.error(`Ошибка lazy loading графика для ${sectionId}:`, error);
                        }
                    }

                    // Прекращаем наблюдение после загрузки
                    chartObserver.unobserve(container);
                }
            }
        });
    }, { rootMargin: '100px' }); // Загружаем график за 100px до видимости

    // Применяем наблюдение ко всем контейнерам графиков
    document.querySelectorAll('.chart-container').forEach(container => {
        chartObserver.observe(container);
    });

    return chartObserver;
}

// Инициализация обработчика для кнопки "О программе"
function initAboutButton() {
    const aboutButton = document.getElementById('about');
    if (!aboutButton) return;

    aboutButton.addEventListener('click', () => {
        // Создаем модальное окно
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content about">
                <div class="modal-header">
                    <h3>О программе</h3>
                    <button class="modal-close-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <p>Система мониторинга участков пекарни</p>
                    <p>Версия: 1.0</p>
                    <p>Разработано: 2026 г.</p>
                </div>
                <div class="modal-body">
                    <p style="font-weight: bold; font-size: 15px;">Функциональность:</p>
                    <ul>
                        <li>Мониторинг температуры и влажности в реальном времени.</li>
                        <li>Отображение исторических данных.</li>
                        <li>Отображение графиков за последний час.</li>
                        <li>Оповещения о выходе параметров за допустимые пределы.</li>
                    </ul>
                </div>
            </div>
        `;

        // Добавляем модальное окно в DOM
        document.body.appendChild(modal);

        // Обработчик закрытия модального окна
        const closeBtn = modal.querySelector('.modal-close-btn');
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        // Закрытие по клику вне модального окна
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                document.body.removeChild(modal);
            }
        });
    });
}

// Часы в шапке — дата слева, время справа
function initHeaderClock() {
    const dateEl = document.getElementById('headerDate');
    const timeEl = document.getElementById('headerTime');
    if (!dateEl || !timeEl) return;

    function tick() {
        const now = new Date();
        dateEl.textContent = now.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        timeEl.textContent = now.toLocaleTimeString('ru-RU');
    }
    tick();
    setInterval(tick, 1000);
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const config = await fetchConfig();
        initLimits(config);
        initChartLimits(config);
        const container = document.getElementById('sectionsContainer');

        // Создаем карточки
        const cardsHTML = config.sections.map(section => createSectionCard(section)).join('');
        container.innerHTML = cardsHTML;

        // Регистрируем все участки в charts Map (даже если графики ещё не инициализированы)
        config.sections.forEach(section => {
            if (!charts.has(section.id)) {
                charts.set(section.id, null); // null означает, что график ещё не инициализирован
            }
        });

        // Проверяем, что Chart.js загружен
        if (typeof Chart === 'undefined') {
            console.error('Chart.js не загружен! Графики не будут отображаться.');
            document.querySelectorAll('.chart-container').forEach(container => {
                container.innerHTML = '<div class="error-message"><p>Ошибка загрузки графика: библиотека Chart.js не найдена</p></div>';
            });
        } else {
            // Инициализируем lazy loading для графиков
            initLazyChartLoading(config);
        }

        // Инициализируем обработчики кнопок истории
        initHistoryButtons();

        // Инициализируем кнопку "О программе"
        initAboutButton();

        // Запускаем обновление данных
        const success = await updateData();

        // Если первое обновление не удалось, пытаемся восстановить соединение
        if (!success) {
            retryConnection(updateData);
        }

        // Обновляем графики только если данные успешно обновлены
        if (success) {
            await updateCharts();
        }

        // Запускаем часы в шапке
        initHeaderClock();

        // Периодическое обновление данных и графиков
        setInterval(async () => {
            const success = await updateData();
            if (!success) {
                retryConnection(updateData);
            } else {
                await updateCharts();
            }
        }, SETTINGS.timeRefresh);

    } catch (error) {
        console.error('Ошибка инициализации приложения:', error);
        document.getElementById('sectionsContainer').innerHTML = `
            <div class="error-message">
                <p>Ошибка инициализации приложения: ${error.message}</p>
                <p>Пожалуйста, обновите страницу или попробуйте позже.</p>
            </div>
        `;
        showConnectionError(updateData);
    }
});
