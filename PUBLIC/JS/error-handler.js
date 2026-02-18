/**
 * Модуль для обработки ошибок в UI
 */

/**
 * Показать ошибку соединения
 * @param {Function} retryCallback - Функция для повторной попытки
 */
export function showConnectionError(retryCallback) {
    // Проверяем, есть ли уже уведомление об ошибке
    if (document.getElementById('connection-error')) return;

    const errorDiv = document.createElement('div');
    errorDiv.id = 'connection-error';
    errorDiv.className = 'connection-error';
    errorDiv.innerHTML = `
        <div class="error-content">
            <h3>Ошибка соединения</h3>
            <p>Не удалось получить данные с сервера. Пытаемся восстановить соединение...</p>
            <button id="retry-connection">Повторить сейчас</button>
        </div>
    `;

    document.body.appendChild(errorDiv);

    // Добавляем обработчик для кнопки повторной попытки
    document.getElementById('retry-connection').addEventListener('click', async () => {
        errorDiv.querySelector('.error-content').innerHTML = '<p>Попытка соединения...</p>';

        const success = await retryCallback();

        if (success) {
            hideConnectionError();
        } else {
            errorDiv.querySelector('.error-content').innerHTML = `
                <h3>Ошибка соединения</h3>
                <p>Не удалось получить данные с сервера. Пытаемся восстановить соединение...</p>
                <button id="retry-connection">Повторить сейчас</button>
            `;
            // Переназначаем обработчик
            document.getElementById('retry-connection').addEventListener('click', () => {
                location.reload();
            });
        }
    });
}

/**
 * Скрыть ошибку соединения
 */
export function hideConnectionError() {
    const errorDiv = document.getElementById('connection-error');
    if (errorDiv) {
        document.body.removeChild(errorDiv);
    }
}

/**
 * Функция для автоматических повторных попыток при ошибке соединения
 * @param {Function} callback - Функция для повторной попытки
 * @param {number} maxRetries - Максимальное количество попыток
 * @param {number} delay - Задержка между попытками в мс
 * @returns {Promise<boolean>} - Успешность восстановления
 */
export async function retryConnection(callback, maxRetries = 3, delay = 5000) {
    let retries = 0;
    let success = false;

    while (retries < maxRetries && !success) {
        await new Promise(resolve => setTimeout(resolve, delay));
        console.log(`Попытка восстановления соединения ${retries + 1}/${maxRetries}...`);

        try {
            success = await callback();
            if (success) {
                console.log('Соединение восстановлено!');
                hideConnectionError();
                break;
            }
        } catch (error) {
            console.error('Ошибка при попытке восстановления соединения:', error);
        }

        retries++;
    }

    if (!success) {
        console.error(`Не удалось восстановить соединение после ${maxRetries} попыток.`);
    }

    return success;
}

/**
 * Показать ошибку в элементе
 * @param {HTMLElement} element - Элемент для отображения ошибки
 * @param {string} message - Сообщение об ошибке
 */
export function showElementError(element, message) {
    if (!element) return;

    element.innerHTML = `
        <div class="error-message">
            <p>${message}</p>
        </div>
    `;
}

/**
 * Обработка ошибок fetch запросов
 * @param {Error} error - Ошибка
 * @param {string} context - Контекст ошибки
 */
export function handleFetchError(error, context = '') {
    console.error(`Ошибка ${context}:`, error);

    if (error.message === 'Failed to fetch' || error instanceof TypeError) {
        showConnectionError(async () => {
            // Попытка повторного подключения
            try {
                const response = await fetch('/api/config');
                return response.ok;
            } catch (e) {
                return false;
            }
        });
    }
}

/**
 * Пометить датчики как оффлайн
 */
export function markSensorsOffline() {
    document.querySelectorAll('.sensor-item').forEach(sensor => {
        sensor.classList.add('error', 'offline');
        const valueElement = sensor.querySelector('.value');
        if (valueElement) {
            valueElement.textContent = 'Ошибка';
        }
    });
}

/**
 * Пометить склады как оффлайн
 * @param {Map} storageStatuses - Map со статусами складов
 */
export function markStoragesOffline(storageStatuses) {
    document.querySelectorAll('.storage-card').forEach(card => {
        const storageId = card.dataset.storage;
        if (storageId) {
            storageStatuses.set(storageId, false);
        }
    });
}
