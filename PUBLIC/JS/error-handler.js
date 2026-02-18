// Обработка ошибок UI

// Показать ошибку соединения
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

// Скрыть ошибку соединения
export function hideConnectionError() {
    const errorDiv = document.getElementById('connection-error');
    if (errorDiv) {
        document.body.removeChild(errorDiv);
    }
}

// Автоматические повторные попытки соединения
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

// Пометить датчики как оффлайн
export function markSensorsOffline() {
    document.querySelectorAll('.temp-value, .humidity-value').forEach(el => {
        el.textContent = 'Err';
        const row = el.closest('.temp-value-row, .humidity-value-row');
        if (row) row.classList.add('error');
    });
    document.querySelectorAll('.temp-bar-fill').forEach(bar => {
        bar.style.height = '0%';
        bar.className = 'temp-bar-fill';
    });
}

// Пометить участки как оффлайн
export function markSectionsOffline(sectionStatuses) {
    document.querySelectorAll('.section-card').forEach(card => {
        const sectionId = card.dataset.section;
        if (sectionId) {
            sectionStatuses.set(sectionId, false);
        }
    });
}
