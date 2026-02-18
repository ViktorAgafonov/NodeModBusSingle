const logger = require('../src/utils/logger');
const { spawn } = require('child_process');
const path = require('path');

// Устанавливаем NODE_ENV=test для текущего процесса
process.env.NODE_ENV = 'test';

// Храним ссылки на процессы
let mockServer = null;
let server = null;

// Функция для запуска процесса с выводом логов
function runProcess(command, args, name, options = {}) {
    const process = spawn(command, args, options);
    
    process.stdout.on('data', (data) => {
        logger.debug(`[${name}] ${data.toString().trim()}`);
    });
    
    process.stderr.on('data', (data) => {
        logger.error(`[${name}] Error: ${data.toString().trim()}`);
    });
    
    process.on('close', (code) => {
        if (code !== null) {
            logger.debug(`[${name}] Process exited with code ${code}`);
        }
    });
    
    return process;
}

// Функция корректного завершения
function gracefulShutdown() {
    logger.info('\nЗавершение работы...');
    if (server) {
        server.kill();
        server = null;
    }
    if (mockServer) {
        mockServer.kill();
        mockServer = null;
    }
    process.exit(0);
}

// Пути к файлам
const serverPath = path.join(__dirname, '..', 'src', 'server.js');
const mockServerPath = path.join(__dirname, '..', 'mock-modbus-server.js');

logger.info('Запуск тестового окружения с мок-сервером...');

// Запуск мок-сервера
mockServer = runProcess('node', [mockServerPath], 'Мок-сервер', {
    env: { 
        ...process.env
    }
});

// Даем мок-серверу время на запуск
setTimeout(() => {
    // Запуск основного сервера
    server = runProcess('node', [serverPath], 'Сервер', {
        env: { 
            ...process.env
        }
    });
}, 2000); // Ждем 2 секунды перед запуском сервера

// Обработка сигналов завершения
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('exit', gracefulShutdown); 