// Настройки графиков
export const CHARTS_SETTINGS = {
    // Общие настройки
    common: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: 0
        },
        interaction: {
            mode: 'nearest',
            intersect: false,
            axis: 'x'
        },
        elements: {
            point: {
                radius: 3,
                hoverRadius: 5,
                borderWidth: 2,
                backgroundColor: 'white'
            },
            line: {
                borderWidth: 2,
                tension: 0.1
            }
        },
        plugins: {
            tooltip: {
                enabled: true,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleFont: {
                    size: 12
                },
                bodyFont: {
                    size: 16
                },
                padding: 10,
                cornerRadius: 4,
                callbacks: {
                    title: function(tooltipItems) {
                        return window.dayjs(tooltipItems[0].parsed.x).format('DD.MM.YYYY HH:mm');
                    },
                    labell: function(context) {
                        return `${context.parsed.y.toFixed(1)} = `;
                    }
                }
            },
            legend: {
                labels: {
                    filter: function(legendItem, data) {
                        // Проверяем, нужно ли скрыть элемент легенды
                        const dataset = data.datasets[legendItem.datasetIndex];
                        return !dataset.hideInLegend;
                    }
                }
            }
        },
        maxColors: 5 // Максимальное количество цветов для датчиков
    },
    // Настройки для температуры
    temperature: {
        min: -25,
        max: 45,
        step: 5,
        unit: '°C',
        title: 'Температура',
        icon: '🌡️'
    },
    // Настройки для влажности
    humidity: {
        min: 0,
        max: 60,
        step: 5,
        unit: '%',
        title: 'Влажность',
        icon: '💧'
    },
    // Настройки временных диапазонов
    timeRanges: {
        '1h': {
            unit: 'minute',
            stepSize: 5,
            displayFormat: 'HH:mm',
            maxTicksLimit: 12,
            title: '1 час'
        },
        '24h': {
            unit: 'hour',
            stepSize: 1,
            displayFormat: 'HH:mm',
            maxTicksLimit: 24,
            title: '24 часа'
        },
        '14d': {
            unit: 'hour',
            stepSize: 12,
            displayFormat: 'DD.MM-HH:mm',
            maxTicksLimit: 28,
            title: '2 недели'
        },
        '60d': {
            unit: 'day',
            stepSize: 1,
            displayFormat: 'DD.MM.YY',
            maxTicksLimit: 12,
            title: '2 месяца'
        }
    }
};

import { charts } from './constants.js';

// Фабрика для создания графиков
export function createChart(ctx, options = {}, plugins = []) {
    // Проверяем, что Chart доступен
    if (typeof Chart === 'undefined') {
        console.error('Chart.js не загружен!');
        return null;
    }

    const defaultOptions = {
        type: 'line',
        data: {
            datasets: []
        },
        options: {
            ...CHARTS_SETTINGS.common,
            maintainAspectRatio: false,
            responsive: true,
            animation: {
                duration: 0
            },
            plugins: {
                title: {
                    display: false // Отключаем заголовок по умолчанию
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'minute',
                        stepSize: 5,
                        displayFormats: {
                            minute: 'HH:mm',
                            hour: 'DD.MM HH:mm',
                            day: 'DD.MM.YY'
                        },
                        tooltipFormat: 'DD.MM.YYYY HH:mm:ss'
                    },
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxTicksLimit: 12,
                        autoSkip: true,
                        maxRotation: 45,
                        minRotation: 45,
                        font: {
                            size: 10
                        }
                    }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    min: CHARTS_SETTINGS.temperature.min,
                    max: CHARTS_SETTINGS.temperature.max,
                    title: {
                        display: true,
                        text: `${CHARTS_SETTINGS.temperature.title} (${CHARTS_SETTINGS.temperature.unit})`,
                        font: {
                            size: 16
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        stepSize: CHARTS_SETTINGS.temperature.step,
                        callback: value => value + CHARTS_SETTINGS.temperature.unit
                    }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    min: CHARTS_SETTINGS.humidity.min,
                    max: CHARTS_SETTINGS.humidity.max,
                    title: {
                        display: true,
                        text: `${CHARTS_SETTINGS.humidity.title} (${CHARTS_SETTINGS.humidity.unit})`,
                        font: {
                            size: 16
                        }
                    },
                    grid: {
                        display: false
                    },
                    ticks: {
                        stepSize: CHARTS_SETTINGS.humidity.step,
                        callback: value => value + CHARTS_SETTINGS.humidity.unit
                    }
                }
            }
        },
        plugins: plugins
    };
    
    // Объединяем настройки по умолчанию с пользовательскими
    const mergedOptions = mergeDeep(defaultOptions, options);
    
    return new Chart(ctx, mergedOptions);
}

// Утилиты для работы с графиками
export function configureChartForRange(chart, range, step) {
    const rangeSettings = CHARTS_SETTINGS.timeRanges[range];
    if (!rangeSettings) return;
    
    // Определяем единицу измерения времени из шага
    const timeUnit = step.endsWith('m') ? 'minute' : 
                    step.endsWith('h') ? 'hour' : 'day';
    
    // Устанавливаем базовые настройки временной шкалы
    chart.options.scales.x.time.unit = timeUnit;
    chart.options.scales.x.time.stepSize = parseInt(step);
    
    // Применяем настройки из конфигурации диапазона
    if (rangeSettings) {
        chart.options.scales.x.time.unit = rangeSettings.unit;
        chart.options.scales.x.time.stepSize = rangeSettings.stepSize;
        
        // Устанавливаем форматы отображения дат
        chart.options.scales.x.time.displayFormats = { 
            minute: 'HH:mm',
            hour: 'DD.MM HH:mm',
            day: 'DD.MM.YY'
        };
        
        // Устанавливаем максимальное количество делений на оси
        chart.options.scales.x.ticks.maxTicksLimit = rangeSettings.maxTicksLimit;
    }
    
    // Обновляем настройки для пунктирных линий
    const stepUnit = step.replace(/[0-9]/g, '') === 'm' ? 'minute' : 
                     step.replace(/[0-9]/g, '') === 'h' ? 'hour' : 'day';
    const stepValue = parseInt(step);
    const stepMs = getStepInMilliseconds(stepValue, stepUnit);
    
    // Определяем ожидаемый интервал между точками
    const expectedInterval = stepMs;
    // Определяем максимально допустимый интервал (в 2 раза больше ожидаемого)
    const maxAllowedInterval = expectedInterval * 2;
    
    // Обновляем настройки сегментов для всех датасетов
    chart.data.datasets.forEach(dataset => {
        dataset.segment = {
            borderDash: ctx => {
                // Получаем временной интервал между точками
                const gap = ctx.p1.parsed.x - ctx.p0.parsed.x;
                
                // Если интервал больше максимально допустимого, значит данных нет
                if (gap > maxAllowedInterval) {
                    return [5, 5]; // Пунктирная линия
                }
                
                return undefined; // Сплошная линия
            }
        };
    });
}

export function initChart(storageId, initialRange = '1h', initialStep = '5m') {
    const ctx = document.getElementById(`chart_${storageId}`);
    if (!ctx) {
        console.error(`Canvas not found for storage ${storageId}`);
        return null;
    }

    const chart = createChart(ctx.getContext('2d'), {
        options: {
            maintainAspectRatio: false,
            responsive: true,
            plugins: {
                legend: {
                    display: false // Отключаем встроенную легенду
                },
                title: {
                    display: false // Отключаем заголовок
                }
            }
        }
    }, [mainLegendPlugin]);
    
    configureChartForRange(chart, initialRange, initialStep);
    charts.set(storageId, chart);
    return chart;
}

// Вспомогательная функция для глубокого объединения объектов
function mergeDeep(target, source) {
    const isObject = obj => obj && typeof obj === 'object' && !Array.isArray(obj);
    
    if (!isObject(target) || !isObject(source)) {
        return source;
    }
    
    Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
            if (!target[key]) Object.assign(target, { [key]: {} });
            mergeDeep(target[key], source[key]);
        } else {
            Object.assign(target, { [key]: source[key] });
        }
    });
    
    return target;
}

// Вспомогательная функция для конвертации шага в миллисекунды
export function getStepInMilliseconds(stepSize, unit) {
    const msInMinute = 60 * 1000;
    const msInHour = 60 * msInMinute;
    const msInDay = 24 * msInHour;
    
    switch(unit) {
        case 'minute':
            return stepSize * msInMinute;
        case 'hour':
            return stepSize * msInHour;
        case 'day':
            return stepSize * msInDay;
        default:
            return msInMinute; // По умолчанию 1 минута
    }
}

// Функция масштабирования значений для отображения
export function scaleValueForDisplay(value, sensorType) {
    if (!value || !Number.isFinite(value)) return null;

    // Для влажности просто ограничиваем значение в диапазоне 0-100
    if (sensorType === 'humidity') {
        return Math.max(0, Math.min(100, value));
    }
    
    // Для температуры ограничиваем значение в диапазоне min-max
    if (sensorType === 'temperature') {
        return Math.max(CHARTS_SETTINGS.temperature.min, Math.min(CHARTS_SETTINGS.temperature.max, value));
    }
    
    return value;
}

// Плагин для создания пользовательской легенды
export const mainLegendPlugin = {
    id: 'mainLegend',
    afterDraw: function(chart) {
        const legendId = `legend-${chart.canvas.id}`;
        let legendContainer = document.getElementById(legendId);
        
        if (!legendContainer) {
            legendContainer = document.createElement('div');
            legendContainer.id = legendId;
            legendContainer.className = 'custom-legend main-legend';
            chart.canvas.parentNode.insertBefore(legendContainer, chart.canvas);
        }
        
        // Очищаем контейнер
        legendContainer.innerHTML = '';
        
        // Создаем единую группу для всех датчиков
        const legendGroup = document.createElement('div');
        legendGroup.className = 'legend-group single-row';
        legendGroup.style.textAlign = 'center';
        
        // Создаем элементы легенды
        chart.data.datasets.forEach((dataset, i) => {
            const meta = chart.getDatasetMeta(i);
            const isHidden = meta.hidden === true || (meta.hidden === null && dataset.hidden === true);
            
            const legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            if (isHidden) {
                legendItem.classList.add('hidden');
            }
            
            const colorBox = document.createElement('span');
            colorBox.className = 'legend-color';
            colorBox.style.backgroundColor = dataset.borderColor;
            
            const text = document.createElement('span');
            text.textContent = dataset.label;
            
            legendItem.appendChild(colorBox);
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
            
            // Добавляем элемент в группу
            legendGroup.appendChild(legendItem);
        });
        
        // Добавляем группу в контейнер легенды
        legendContainer.appendChild(legendGroup);
    }
};