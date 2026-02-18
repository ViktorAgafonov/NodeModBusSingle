// Импортируем необходимые функции
import { configureChartForRange, createChart, CHARTS_SETTINGS, getStepInMilliseconds } from './chart-utils.js';
import { fetchStorageHistory } from './data-service.js';

// Плагин для создания пользовательской легенды
const customLegendPlugin = {
    id: 'customLegend',
    afterDraw: function(chart) {
        const legendId = `legend-${chart.canvas.id}`;
        let legendContainer = document.getElementById(legendId);
        
        if (!legendContainer) {
            legendContainer = document.createElement('div');
            legendContainer.id = legendId;
            legendContainer.className = 'custom-legend';
            chart.canvas.parentNode.insertBefore(legendContainer, chart.canvas);
            
            // Добавляем стили для легенды, если их еще нет
            if (!document.getElementById('legend-styles')) {
                const style = document.createElement('style');
                style.id = 'legend-styles';
                style.textContent = `
                    .custom-legend {
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        margin-bottom: 10px;
                        padding: 5px;
                    }
                    .legend-group {
                        display: flex;
                        flex-wrap: wrap;
                        justify-content: center;
                        padding: 3px;
                        border-radius: 4px;
                        margin-bottom: 3px;
                    }
                    .legend-item {
                        margin: 0 10px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                    }
                    .legend-item.hidden {
                        opacity: 0.5;
                        text-decoration: line-through;
                    }
                `;
                document.head.appendChild(style);
            }
        }
        
        // Очищаем контейнер
        legendContainer.innerHTML = '';
        
        // Создаем группы для температуры и влажности
        const tempGroup = document.createElement('div');
        tempGroup.className = 'legend-group';
        
        const humGroup = document.createElement('div');
        humGroup.className = 'legend-group';
        
        // Создаем элементы легенды и распределяем их по группам
        chart.data.datasets.forEach((dataset, i) => {
            const meta = chart.getDatasetMeta(i);
            const isHidden = meta.hidden === true || (meta.hidden === null && dataset.hidden === true);
            
            const legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            if (isHidden) {
                legendItem.classList.add('hidden');
            }
            
            const text = document.createElement('span');
            text.textContent = dataset.label;
            text.style.color = dataset.borderColor; // Устанавливаем цвет текста
            
            legendItem.appendChild(text);
            
            // Обработчик клика для скрытия/показа серии
            legendItem.onclick = function() {
                meta.hidden = meta.hidden === null ? !dataset.hidden : !meta.hidden;
                
                // Обновляем стиль элемента легенды
                if (meta.hidden) {
                    legendItem.classList.add('hidden');
                } else {
                    legendItem.classList.remove('hidden');
                }
                
                chart.update();
            };
            
            // Распределяем по группам в зависимости от типа датчика
            if (dataset.yAxisID === 'y') {
                tempGroup.appendChild(legendItem);
            } else {
                humGroup.appendChild(legendItem);
            }
        });
        
        // Добавляем группы в контейнер легенды
        legendContainer.appendChild(tempGroup);
        legendContainer.appendChild(humGroup);
    }
};

// Функция создания модального окна с историей
export function createHistoryModal(storageId, storageName) {
    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>История датчиков склада "${storageName}"</h3>
                <button class="modal-close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div id="legend-storage_history_chart_${storageId}" class="custom-legend"></div>
                <canvas id="storage_history_chart_${storageId}"></canvas>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Закрытие модального окна
    const closeBtn = modal.querySelector('.modal-close-btn');
    closeBtn.onclick = () => {
        modal.remove();
    };

    // Закрытие по клику вне модального окна
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    };

    // Получаем текущий активный диапазон из основного окна
    const activeButton = document.querySelector('.time-range button.active');
    const range = activeButton.dataset.range;
    const step = activeButton.dataset.step;

    // Настройки временной шкалы в зависимости от диапазона
    const timeUnit = CHARTS_SETTINGS.timeRanges[range]?.unit || 'hour';

    try {
        // Инициализация графика с использованием фабрики
        const ctx = modal.querySelector(`#storage_history_chart_${storageId}`).getContext('2d');
        const chart = createChart(ctx, {
            options: {
                plugins: {
                    title: {
                        display: true,
                        text: `Показания всех отслеживаемых датчиков склада (за ${getTimeRangeTitle(range)}). Максимальные значения.`
                    },
                    legend: {
                        display: false // Отключаем встроенную легенду
                    },
                    customLegend: {} // Активируем наш плагин
                }
            }
        }, [customLegendPlugin]);

        // Проверяем, что график успешно создан
        if (!chart) {
            throw new Error('Не удалось создать график. Возможно, не загружена библиотека Chart.js');
        }

        // Загружаем данные для текущего диапазона
        updateHistoryChart(chart, storageId, range, step);

        return modal;
    } catch (error) {
        console.error('Ошибка при создании графика:', error);
        // Добавляем сообщение об ошибке в модальное окно
        const modalBody = modal.querySelector('.modal-body');
        modalBody.innerHTML = `
            <div class="error-message">
                <p>Ошибка при загрузке графика: ${error.message}</p>
                <p>Пожалуйста, обновите страницу или попробуйте позже.</p>
            </div>
        `;
        return modal;
    }
}

// Функция получения заголовка для временного диапазона
function getTimeRangeTitle(range) {
    return CHARTS_SETTINGS.timeRanges[range]?.title || CHARTS_SETTINGS.timeRanges['24h'].title;
}

// Функция обновления графика для всех датчиков склада
export async function updateHistoryChart(chart, storageId, range, step) {
    try {
        const apiRange = range || '24h';
        
        const storageData = await fetchStorageHistory(storageId, apiRange);

        const datasets = [];
        
        // Получаем цвет в зависимости от индекса датчика
        const getColorByIndex = (type, index) => {
            const maxIndex = CHARTS_SETTINGS.common.maxColors;
            const colorIndex = (index % maxIndex) + 1;
            const colorVar = `--${type}-color-${colorIndex}`;
            return getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim();
        };
        
        // Получаем шаг в миллисекундах
        const stepUnit = step.replace(/[0-9]/g, '') === 'm' ? 'minute' : 
                         step.replace(/[0-9]/g, '') === 'h' ? 'hour' : 'day';
        const stepValue = parseInt(step);
        const stepMs = getStepInMilliseconds(stepValue, stepUnit);
        
        // Определяем ожидаемый интервал между точками
        const expectedInterval = stepMs;
        // Определяем максимально допустимый интервал (в 2 раза больше ожидаемого)
        const maxAllowedInterval = expectedInterval * 2;
        
        // Добавляем датчики температуры
        storageData.temperature.forEach((series, index) => {
            datasets.push({
                label: `${CHARTS_SETTINGS.temperature.icon} ${series.name}`,
                data: series.data.map(point => {
                    // Правильно преобразуем строку даты в timestamp
                    const timestamp = window.dayjs(point.x, 'YYYY-MM-DD HH:mm:ss').valueOf();
                    return {
                        x: timestamp,
                        y: point.y
                    };
                }),
                borderColor: getColorByIndex('temperature', index),
                backgroundColor: 'transparent',
                segment: {
                    borderDash: ctx => {
                        // Получаем временной интервал между точками
                        const gap = ctx.p1.parsed.x - ctx.p0.parsed.x;
                        
                        // Если интервал больше максимально допустимого, значит данных нет
                        if (gap > maxAllowedInterval) {
                            return [5, 5]; // Пунктирная линия
                        }
                        
                        return undefined; // Сплошная линия
                    }
                },
                yAxisID: 'y'
            });
        });

        // Добавляем датчики влажности
        storageData.humidity.forEach((series, index) => {
            datasets.push({
                label: `${CHARTS_SETTINGS.humidity.icon} ${series.name}`,
                data: series.data.map(point => {
                    // Правильно преобразуем строку даты в timestamp
                    const timestamp = window.dayjs(point.x, 'YYYY-MM-DD HH:mm:ss').valueOf();
                    return {
                        x: timestamp,
                        y: point.y
                    };
                }),
                borderColor: getColorByIndex('humidity', index),
                backgroundColor: 'transparent',
                segment: {
                    borderDash: ctx => {
                        // Получаем временной интервал между точками
                        const gap = ctx.p1.parsed.x - ctx.p0.parsed.x;
                        
                        // Если интервал больше максимально допустимого, значит данных нет
                        if (gap > maxAllowedInterval) {
                            return [5, 5]; // Пунктирная линия
                        }
                        
                        return undefined; // Сплошная линия
                    }
                },
                yAxisID: 'y1'
            });
        });

        chart.data.datasets = datasets;
        
        // Настраиваем отображение в зависимости от диапазона
        if (step) {
            configureChartForRange(chart, range, step);
        }
        
        // Убеждаемся, что шкалы имеют правильные настройки
        chart.options.scales.y.ticks.stepSize = CHARTS_SETTINGS.temperature.step;
        chart.options.scales.y1.ticks.stepSize = CHARTS_SETTINGS.humidity.step;
        
        chart.update();
        
        // Обновляем пользовательскую легенду
        customLegendPlugin.afterDraw(chart);
    } catch (error) {
        console.error('Ошибка обновления графика:', error);
    }
}

// Инициализация обработчиков кнопок истории
export function initHistoryButtons() {
    document.querySelectorAll('.history-btn').forEach(btn => {
        btn.onclick = () => {
            const storageId = btn.dataset.storageId;
            const storageName = btn.closest('.card-header').querySelector('h2').textContent;
            createHistoryModal(storageId, storageName);
        };
    });
} 