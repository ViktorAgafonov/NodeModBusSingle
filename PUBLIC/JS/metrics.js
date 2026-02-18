// Функция форматирования времени
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${days}д ${hours}ч ${minutes}м ${secs}с`;
}

// Функция форматирования даты
function formatDate(isoString) {
    if (!isoString) return 'нет';
    const date = new Date(isoString);
    return date.toLocaleString('ru-RU');
}

// Функция обновления метрик
async function updateMetrics() {
    try {
        const response = await fetch('/api/metrics');
        const metrics = await response.json();

        // Проверяем наличие полей метрик
        const errors = metrics.errors || { connection: 0, sensor: 0, timeout: 0, decode: 0 };
        const performance = metrics.performance || { lastPollDuration: 0, avgPollDuration: 0, totalPolls: 0, failedPolls: 0 };
        const staleData = metrics.staleData || { count: 0, lastTimestamp: null, affectedSensors: {} };
        const system = metrics.system || { 
            memoryUsage: 0, 
            cpuLoad: 0, 
            uptime: 0, 
            diskUsage: { total: 0, archived: 0, active: 0, archivedPercent: 0, activePercent: 0 } 
        };
        const activeClients = metrics.activeClients || { count: 0, clients: [] };

        // Обновление ошибок
        document.getElementById('connection-errors').textContent = errors.connection;
        document.getElementById('sensor-errors').textContent = errors.sensor;
        document.getElementById('timeout-errors').textContent = errors.timeout;
        document.getElementById('decode-errors').textContent = errors.decode;
        document.getElementById('last-error-time').textContent = formatDate(metrics.lastErrorTime);

        // Обновление производительности
        document.getElementById('last-poll-duration').textContent = performance.lastPollDuration.toFixed(2);
        document.getElementById('avg-poll-duration').textContent = performance.avgPollDuration.toFixed(2);
        document.getElementById('total-polls').textContent = performance.totalPolls;
        document.getElementById('failed-polls').textContent = performance.failedPolls;

        // Обновление качества данных
        document.getElementById('repeated-count').textContent = staleData.count;
        document.getElementById('last-repeated-time').textContent = formatDate(staleData.lastTimestamp);

        // Обновление списка затронутых датчиков
        const affectedSensorsList = document.getElementById('affected-sensors');
        affectedSensorsList.innerHTML = '';
        
        if (Object.keys(staleData.affectedSensors || {}).length === 0) {
            affectedSensorsList.innerHTML = '<li>Нет затронутых датчиков</li>';
        } else {
            Object.entries(staleData.affectedSensors).forEach(([sensorId, data]) => {
                const li = document.createElement('li');
                li.textContent = `${sensorId}: ${data.value} (${data.count} повторов, первое появление: ${formatDate(data.firstOccurrence)})`;
                affectedSensorsList.appendChild(li);
            });
        }

        // Обновление системных метрик
        document.getElementById('memory-usage').textContent = system.memoryUsage;
        document.getElementById('cpu-load').textContent = system.cpuLoad;
        document.getElementById('uptime').textContent = formatUptime(system.uptime);

        // Обновление метрик дискового пространства
        document.getElementById('total-disk-usage').textContent = system.diskUsage.total;
        document.getElementById('archived-disk-usage').textContent = system.diskUsage.archived;
        document.getElementById('archived-percentage').textContent = system.diskUsage.archivedPercent;
        document.getElementById('active-disk-usage').textContent = system.diskUsage.active;
        document.getElementById('active-percentage').textContent = system.diskUsage.activePercent;

        // Обновление активных клиентов
        document.getElementById('active-clients-count').textContent = activeClients.count;
        const clientsTable = document.getElementById('clients-tbody');
        clientsTable.innerHTML = '';

        if (activeClients.count === 0) {
            clientsTable.innerHTML = '<tr><td colspan="4">Нет активных клиентов</td></tr>';
        } else {
            (activeClients.clients || []).forEach(client => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${client.ip}</td>
                    <td>${formatDate(client.lastSeen)}</td>
                    <td>${client.lastPath}</td>
                    <td>${client.requestCount}</td>
                `;
                clientsTable.appendChild(row);
            });
        }
    } catch (error) {
        console.error('Ошибка при обновлении метрик:', error);
    }
}

// Обработчик кнопки сброса метрик
document.getElementById('reset-metrics').addEventListener('click', async () => {
    try {
        await fetch('/api/metrics/reset', { method: 'POST' });
        updateMetrics();
    } catch (error) {
        console.error('Ошибка при сбросе метрик:', error);
    }
});

// Обработчик кнопки обновления
document.getElementById('refresh-metrics').addEventListener('click', () => {
    updateMetrics();
});

// Автоматическое обновление каждые 5 секунд
setInterval(updateMetrics, 5000);

// Первоначальное обновление при загрузке страницы
updateMetrics();