// Импортируем необходимые функции
import { createChart, CHARTS_SETTINGS } from './chart-utils.js';
import { fetchSectionHistory } from './data-service.js';

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
export function createHistoryModal(sectionId, sectionName) {
    // Создаем модальное окно
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>История датчиков участка "${sectionName}"</h3>
                <button class="modal-close-btn">&times;</button>
            </div>
            <div class="modal-body">
                <div id="legend-section_history_chart_${sectionId}" class="custom-legend"></div>
                <canvas id="section_history_chart_${sectionId}"></canvas>
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

    try {
        // Инициализация графика с использованием фабрики
        const ctx = modal.querySelector(`#section_history_chart_${sectionId}`).getContext('2d');
        const chart = createChart(ctx, {
            options: {
                plugins: {
                    title: {
                        display: true,
                        text: 'Показания датчиков участка за последний час. Максимальные значения.'
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

        updateHistoryChart(chart, sectionId);

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

// Функция обновления графика для всех датчиков участка (всегда за 1 час)
export async function updateHistoryChart(chart, sectionId) {
    try {
        const storageData = await fetchSectionHistory(sectionId);

        const datasets = [];
        
        const getColor = (type) => getComputedStyle(document.documentElement).getPropertyValue(`--${type}-color`).trim();
        const MAX_GAP_MS = 10 * 60 * 1000;

        const createDataset = (series, type) => ({
            label: `${CHARTS_SETTINGS[type].icon} ${series.name}`,
            data: series.data.map(point => ({
                x: window.dayjs(point.x, 'YYYY-MM-DD HH:mm:ss').valueOf(),
                y: point.y
            })),
            borderColor: getColor(type),
            backgroundColor: 'transparent',
            segment: {
                borderDash: ctx => (ctx.p1.parsed.x - ctx.p0.parsed.x > MAX_GAP_MS) ? [5, 5] : undefined
            },
            yAxisID: type === 'humidity' ? 'y1' : 'y'
        });

        storageData.temperature.forEach(series => datasets.push(createDataset(series, 'temperature')));
        storageData.humidity.forEach(series => datasets.push(createDataset(series, 'humidity')));

        chart.data.datasets = datasets;
        
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
            const sectionId = btn.dataset.sectionId;
            const sectionName = btn.closest('.card-header').querySelector('h2').textContent;
            createHistoryModal(sectionId, sectionName);
        };
    });
} 
