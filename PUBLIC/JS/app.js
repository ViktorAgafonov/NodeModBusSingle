// Основной файл приложения
import { SENSOR_LIMITS, charts, historyCache } from './constants.js';
import { configureChartForRange, initChart, getStepInMilliseconds, scaleValueForDisplay, CHARTS_SETTINGS, mainLegendPlugin } from './chart-utils.js';
import { fetchCurrentData, fetchHistoricalData, fetchConfig, isValueOutOfLimits } from './data-service.js';
import { createStorageCard, updateWarningIndicators, updateStatusIndicators } from './ui-components.js';
import { createHistoryModal, updateHistoryChart, initHistoryButtons } from './modal-history.js';
import { debounce, createLazyObserver } from './utils.js';
import { showConnectionError, hideConnectionError, retryConnection, markSensorsOffline, markStoragesOffline } from './error-handler.js';

const SETTINGS = {
    timeRefresh: 5000,
    debounceDelay: 300
};

// Отслеживание загруженных графиков для lazy loading
const loadedCharts = new Set();

// Общая функция для обработки данных датчиков
function processSensorData(data, type) {
    if (!data || !Number.isFinite(data)) return null;

    return {
        value: data,
        displayValue: data.toFixed(1),
        unit: type === 'temperature' ? CHARTS_SETTINGS.temperature.unit : CHARTS_SETTINGS.humidity.unit,
        yAxisID: type === 'humidity' ? 'y1' : 'y'
    };
}

// Обновление данных
async function updateData() {
    try {
        const data = await fetchCurrentData();
        const storageWarnings = new Map();
        const storageStatuses = new Map();

        // Инициализируем все склады как оффлайн изначально
        data.temperature.forEach(sensor => {
            const storageId = sensor.sensor_id.split('.')[0];
            if (!storageStatuses.has(storageId)) {
                storageStatuses.set(storageId, false);
            }
        });

        [...data.temperature, ...data.humidity].forEach(sensor => {
            const element = document.getElementById(sensor.sensor_id);
            const storageId = sensor.sensor_id.split('.')[0];

            // Инициализируем состояния для склада
            if (!storageWarnings.has(storageId)) {
                storageWarnings.set(storageId, {
                    hasWarning: false,
                    messages: new Set()
                });
            }

            if (element) {
                const sensorItem = element.closest('.sensor-item');

                // Проверяем статус датчика
                if (sensor.error || sensor.value === null || sensor.status === 'offline') {
                    element.textContent = 'Ошибка';
                    sensorItem.classList.add('error');
                    sensorItem.classList.remove('warning');

                    // Если датчик offline, добавляем соответствующий класс
                    if (sensor.status === 'offline') {
                        sensorItem.classList.add('offline');
                    } else {
                        sensorItem.classList.remove('offline');
                    }
                } else {
                    const value = sensor.value;
                    element.textContent = value.toFixed(1);
                    sensorItem.classList.remove('error', 'offline');

                    // Если есть валидные данные - помечаем склад как онлайн
                    storageStatuses.set(storageId, true);

                    if (isValueOutOfLimits(value, sensor.type)) {
                        const warningState = storageWarnings.get(storageId);
                        warningState.hasWarning = true;
                        warningState.messages.add(SENSOR_LIMITS[sensor.type].warningMessage + ' (' + SENSOR_LIMITS[sensor.type].min + ' .. ' + SENSOR_LIMITS[sensor.type].max + ')');
                        sensorItem.classList.add('warning');
                    } else {
                        sensorItem.classList.remove('warning');
                    }
                }
            }
        });

        updateStatusIndicators(storageStatuses);
        updateWarningIndicators(storageWarnings);

        return true; // Успешное обновление
    } catch (error) {
        console.error('Ошибка получения данных:', error);

        markSensorsOffline();

        // Помечаем все склады как оффлайн
        const storageStatuses = new Map();
        markStoragesOffline(storageStatuses);
        updateStatusIndicators(storageStatuses);

        // Показываем уведомление об ошибке соединения
        showConnectionError(updateData);

        return false; // Ошибка обновления
    }
}

// Основная функция обновления графиков (без debounce для периодических обновлений)
async function updateChartsCore(range) {
    try {
        // Очищаем кэш для обеспечения получения свежих данных
        historyCache.clear();

        const data = await fetchHistoricalData(range);
        const activeButton = document.querySelector(`.time-range button[data-range="${range}"]`);
        const step = activeButton ? activeButton.dataset.step : '5m';

        for (const [storageId, chart] of charts.entries()) {
            // Если график ещё не инициализирован (lazy loading), инициализируем его сейчас
            let currentChart = chart;
            if (!currentChart) {
                const canvas = document.getElementById(`chart_${storageId}`);
                if (canvas && !loadedCharts.has(storageId)) {
                    console.log(`Автоинициализация графика для склада ${storageId}`);
                    currentChart = initChart(storageId, range, step);
                    loadedCharts.add(storageId);
                }

                // Если график всё ещё не инициализирован, пропускаем
                if (!currentChart) {
                    console.warn(`График для склада ${storageId} не может быть инициализирован`);
                    continue;
                }
            }

            try {
                const datasets = [];

                // Функция создания конфигурации для набора данных
                const createDataset = (series, type, index) => {
                    // Получаем цвет в зависимости от индекса датчика
                    const getColorByIndex = (type, index) => {
                        const maxIndex = CHARTS_SETTINGS.common.maxColors;
                        const colorIndex = (index % maxIndex) + 1;
                        const colorVar = `--${type}-color-${colorIndex}`;
                        return getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim();
                    };

                    const processedData = series.data.map(point => {
                        const processed = processSensorData(point.y, type);
                        return {
                            x: window.dayjs(point.x, 'YYYY-MM-DD HH:mm:ss').valueOf(),
                            y: processed ? processed.value : null
                        };
                    }).filter(point => point.y !== null);

                    const color = getColorByIndex(type, index);

                    // Определяем шаг в миллисекундах
                    const stepUnit = step.replace(/[0-9]/g, '') === 'm' ? 'minute' :
                        step.replace(/[0-9]/g, '') === 'h' ? 'hour' : 'day';
                    const stepValue = parseInt(step);
                    const stepMs = getStepInMilliseconds(stepValue, stepUnit);

                    // Определяем ожидаемый интервал между точками
                    const expectedInterval = stepMs;
                    // Определяем максимально допустимый интервал (в 2 раза больше ожидаемого)
                    const maxAllowedInterval = expectedInterval * 2;

                    return {
                        label: `${series.name}`,
                        tooltipLabel: type === 'temperature' ? 'Температура' : 'Влажность',
                        data: processedData,
                        borderColor: color,
                        backgroundColor: color.replace('rgb', 'rgba').replace(')', ', 0.1)'),
                        segment: {
                            borderDash: ctx => {
                                const gap = ctx.p1.parsed.x - ctx.p0.parsed.x;

                                if (gap > maxAllowedInterval) {
                                    return [5, 5]; // Пунктирная линия
                                }

                                return undefined; // Сплошная линия
                            }
                        },
                        yAxisID: type === 'humidity' ? 'y1' : 'y',
                        showLine: true,
                        hidden: false
                    };
                };

                // Фильтруем данные только для текущего склада
                data.temperature.forEach((series, index) => {
                    if (series.storageId === storageId) {
                        datasets.push(createDataset(series, 'temperature', index));
                    }
                });

                data.humidity.forEach((series, index) => {
                    if (series.storageId === storageId) {
                        datasets.push(createDataset(series, 'humidity', index));
                    }
                });

                currentChart.data.datasets = datasets;

                if (currentChart.options.plugins.title) {
                    currentChart.options.plugins.title.display = false;
                }

                configureChartForRange(currentChart, range, step);
                currentChart.update('none'); // Оптимизация: без анимации для быстрых обновлений

                // Обновляем пользовательскую легенду
                const legendContainer = document.getElementById(`legend-${currentChart.canvas.id}`);
                if (legendContainer) {
                    mainLegendPlugin.afterDraw(currentChart);
                }
            } catch (error) {
                console.error(`Ошибка обновления графика для склада ${storageId}:`, error);
                const chartContainer = document.getElementById(`chart_container_${storageId}`);
                if (chartContainer) {
                    chartContainer.innerHTML = `<div class="error-message"><p>Ошибка обновления графика: ${error.message}</p></div>`;
                }
            }
        }

        // Обновляем график в модальном окне, если оно открыто
        const modalCanvas = document.querySelector('.modal canvas');
        if (modalCanvas) {
            // Извлекаем storageId из id canvas'а, удаляя префикс 'storage_history_chart_'
            const storageId = modalCanvas.id.replace('storage_history_chart_', '');
            const chart = Chart.getChart(modalCanvas);
            if (chart) {
                try {
                    updateHistoryChart(chart, storageId, range, step);
                } catch (error) {
                    console.error(`Ошибка обновления графика в модальном окне для склада ${storageId}:`, error);
                    const modalBody = modalCanvas.closest('.modal-body');
                    if (modalBody) {
                        modalBody.innerHTML = `<div class="error-message"><p>Ошибка обновления графика: ${error.message}</p></div>`;
                    }
                }
            }
        }
    } catch (error) {
        console.error('Ошибка получения исторических данных:', error);
        // Отображаем ошибку во всех контейнерах графиков
        document.querySelectorAll('.chart-container').forEach(container => {
            container.innerHTML = `<div class="error-message"><p>Ошибка получения данных: ${error.message}</p></div>`;
        });
    }
}

// Debounced версия для кнопок переключения диапазона
const updateCharts = debounce(updateChartsCore, SETTINGS.debounceDelay);

// Lazy loading для графиков
function initLazyChartLoading(config) {
    const chartObserver = createLazyObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const container = entry.target;
                const canvas = container.querySelector('canvas');
                if (canvas) {
                    const storageId = canvas.id.replace('chart_', '');

                    // Проверяем, не загружен ли уже график
                    if (!loadedCharts.has(storageId)) {
                        console.log(`Lazy loading chart for ${storageId}`);
                        try {
                            initChart(storageId, '1h', '5m');
                            loadedCharts.add(storageId);
                        } catch (error) {
                            console.error(`Ошибка lazy loading графика для ${storageId}:`, error);
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
                    <p>Система мониторинга климата холодных складов</p>
                    <p>Версия: 0.4</p>
                    <p>Разработано: 2025 г.</p>
                </div>
                <div class="modal-body">
                    <p style="font-weight: bold; font-size: 15px;">Функциональность:</p>
                    <ul>
                        <li>Мониторинг температуры и влажности в реальном времени.</li>
                        <li>Отображение исторических данных.</li>
                        <li>Настраиваемые временные диапазоны.</li>
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

// Инициализация приложения
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const config = await fetchConfig();
        const container = document.getElementById('storagesContainer');

        // Создаем карточки
        const cardsHTML = config.storages.map(storage => createStorageCard(storage)).join('');
        container.innerHTML = cardsHTML;

        // Регистрируем все склады в charts Map (даже если графики ещё не инициализированы)
        config.storages.forEach(storage => {
            if (!charts.has(storage.id)) {
                charts.set(storage.id, null); // null означает, что график ещё не инициализирован
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

        // Получаем активный диапазон
        const activeButton = document.querySelector('.time-range button.active');
        const range = activeButton.dataset.range;

        // Обновляем графики только если данные успешно обновлены
        if (success) {
            await updateChartsCore(range);
        }

        // Настраиваем обработчики для кнопок временного диапазона с debounce
        const debouncedButtonClick = debounce(async (button) => {
            // Убираем активный класс у всех кнопок
            document.querySelectorAll('.time-range button').forEach(btn => {
                btn.classList.remove('active');
            });

            // Добавляем активный класс текущей кнопке
            button.classList.add('active');

            // Получаем диапазон из атрибута
            const newRange = button.dataset.range;

            // Обновляем графики для нового диапазона
            await updateCharts(newRange);
        }, SETTINGS.debounceDelay);

        document.querySelectorAll('.time-range button').forEach(button => {
            button.addEventListener('click', () => {
                debouncedButtonClick(button);
            });
        });

        // Настраиваем периодическое обновление данных
        setInterval(async () => {
            const success = await updateData();
            if (!success) {
                retryConnection(updateData);
            } else {
                // Обновляем графики после успешного обновления данных
                // Используем updateChartsCore напрямую, чтобы обойти debounce
                const activeButton = document.querySelector('.time-range button.active');
                if (activeButton) {
                    const currentRange = activeButton.dataset.range;
                    await updateChartsCore(currentRange);
                }
            }
        }, SETTINGS.timeRefresh);

    } catch (error) {
        console.error('Ошибка инициализации приложения:', error);
        document.getElementById('storagesContainer').innerHTML = `
            <div class="error-message">
                <p>Ошибка инициализации приложения: ${error.message}</p>
                <p>Пожалуйста, обновите страницу или попробуйте позже.</p>
            </div>
        `;
        showConnectionError(updateData);
    }
});
