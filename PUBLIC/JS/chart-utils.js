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
                    label: function(context) {
                        return `${context.parsed.y.toFixed(1)}`;
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
        }
    },
    // Настройки для температуры (min/max обновляются из конфига через initChartLimits)
    temperature: {
        min: null,
        max: null,
        step: 5,
        unit: '°C',
        title: 'Температура',
        icon: '🌡️'
    },
    // Настройки для влажности (min/max обновляются из конфига через initChartLimits)
    humidity: {
        min: null,
        max: null,
        step: 5,
        unit: '%',
        title: 'Влажность',
        icon: '💧'
    }
};

import { charts } from './constants.js';

// Инициализация шкал графиков из sensorLimits конфига
export function initChartLimits(config) {
    const sl = config?.sensorLimits;
    if (!sl) return;
    if (sl.temperature) {
        CHARTS_SETTINGS.temperature.min = sl.temperature.min;
        CHARTS_SETTINGS.temperature.max = sl.temperature.max;
    }
    if (sl.humidity) {
        CHARTS_SETTINGS.humidity.min = sl.humidity.min;
        CHARTS_SETTINGS.humidity.max = sl.humidity.max;
    }
}

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
                        display: false
                    }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    min: CHARTS_SETTINGS.temperature.min,
                    max: CHARTS_SETTINGS.temperature.max,
                    title: {
                        display: false
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        stepSize: CHARTS_SETTINGS.temperature.step,
                        callback: value => value + CHARTS_SETTINGS.temperature.unit,
                        font: { size: 8 }
                    }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    min: CHARTS_SETTINGS.humidity.min,
                    max: CHARTS_SETTINGS.humidity.max,
                    title: {
                        display: false
                    },
                    grid: {
                        display: false
                    },
                    ticks: {
                        stepSize: CHARTS_SETTINGS.humidity.step,
                        callback: value => value + CHARTS_SETTINGS.humidity.unit,
                        font: { size: 8 }
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

export function initChart(sectionId) {
    const ctx = document.getElementById(`chart_${sectionId}`);
    if (!ctx) {
        console.error(`Canvas not found for section ${sectionId}`);
        return null;
    }

    const chart = createChart(ctx.getContext('2d'), {
        options: {
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: false
                }
            }
        }
    }, [mainLegendPlugin]);
    
    charts.set(sectionId, chart);
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