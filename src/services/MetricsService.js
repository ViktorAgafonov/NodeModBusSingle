const logger = require('../utils/logger');

/**
 * Сервис для управления метриками приложения
 */
class MetricsService {
    constructor() {
        this.metrics = {
            errors: {
                connection: 0,
                sensor: 0,
                timeout: 0,
                decode: 0
            },
            performance: {
                lastPollDuration: 0,
                avgPollDuration: 0,
                pollHistory: [],
                lastHourPolls: 0,
                lastHourFailedPolls: 0
            },
            lastErrorTime: null,
            staleData: {
                count: 0,
                lastTimestamp: null,
                repeatedTimestamp: null,
                affectedSensors: {}
            },
            system: {
                memoryUsage: 0,
                cpuLoad: 0,
                uptime: 0,
                diskUsage: {
                    total: 0,
                    archived: 0,
                    active: 0,
                    archivedPercent: 0,
                    activePercent: 0
                }
            },
            activeClients: {
                count: 0,
                clients: {}
            }
        };
    }

    /**
     * Получение всех метрик
     */
    getMetrics() {
        return this.metrics;
    }

    /**
     * Сброс метрик
     */
    reset() {
        this.metrics = {
            errors: {
                connection: 0,
                sensor: 0,
                timeout: 0,
                decode: 0
            },
            performance: {
                lastPollDuration: 0,
                avgPollDuration: 0,
                pollHistory: [],
                lastHourPolls: 0,
                lastHourFailedPolls: 0
            },
            lastErrorTime: null,
            staleData: {
                count: 0,
                lastTimestamp: null,
                repeatedTimestamp: null,
                affectedSensors: {}
            },
            system: {
                memoryUsage: 0,
                cpuLoad: 0,
                uptime: 0,
                diskUsage: {
                    total: 0,
                    archived: 0,
                    active: 0,
                    archivedPercent: 0,
                    activePercent: 0
                }
            },
            activeClients: {
                count: 0,
                clients: {}
            }
        };
        logger.info('Метрики сброшены');
    }

    /**
     * Обновление метрик производительности
     */
    updatePerformanceMetrics(duration, isSuccess) {
        const now = Date.now();
        const oneHourAgo = now - 3600000;

        this.metrics.performance.pollHistory.push({
            timestamp: now,
            duration: duration,
            success: isSuccess
        });

        this.metrics.performance.pollHistory = this.metrics.performance.pollHistory.filter(
            poll => poll.timestamp > oneHourAgo
        );

        this.metrics.performance.lastPollDuration = duration;
        this.metrics.performance.lastHourPolls = this.metrics.performance.pollHistory.length;
        this.metrics.performance.lastHourFailedPolls = this.metrics.performance.pollHistory.filter(
            poll => !poll.success
        ).length;

        const totalDuration = this.metrics.performance.pollHistory.reduce((sum, poll) => sum + poll.duration, 0);
        this.metrics.performance.avgPollDuration = totalDuration / this.metrics.performance.pollHistory.length;
    }

    /**
     * Обновление системных метрик
     */
    async updateSystemMetrics(fileStorage) {
        logger.debug('Начало updateSystemMetrics');

        const used = process.memoryUsage();
        this.metrics.system.memoryUsage = Math.round(used.heapUsed / 1024 / 1024 * 100) / 100;
        this.metrics.system.uptime = process.uptime();

        logger.debug('Старт замера CPU');
        const startUsage = process.cpuUsage();
        await new Promise(resolve => {
            setTimeout(() => {
                const endUsage = process.cpuUsage(startUsage);
                this.metrics.system.cpuLoad = Math.round((endUsage.user + endUsage.system) / 1000000 * 100) / 100;
                logger.debug('CPU замер завершен');
                resolve();
            }, 100);
        });

        try {
            logger.debug('Начало подсчета размера файлов');
            const { totalSize, archivedSize, activeSize } = await fileStorage.getSize();
            logger.debug('Размер файлов подсчитан');

            const totalMB = Math.round(totalSize / (1024 * 1024) * 100) / 100;
            const archivedMB = Math.round(archivedSize / (1024 * 1024) * 100) / 100;
            const activeMB = Math.round(activeSize / (1024 * 1024) * 100) / 100;

            const archivedPercent = totalMB > 0 ? Math.round((archivedMB / totalMB) * 100) : 0;
            const activePercent = totalMB > 0 ? Math.round((activeMB / totalMB) * 100) : 0;

            this.metrics.system.diskUsage = {
                total: totalMB,
                archived: archivedMB,
                active: activeMB,
                archivedPercent: archivedPercent,
                activePercent: activePercent
            };
        } catch (error) {
            logger.error(`Ошибка при обновлении метрик диска: ${error.message}`);
            this.metrics.system.diskUsage = {
                total: 0,
                archived: 0,
                active: 0,
                archivedPercent: 0,
                activePercent: 0
            };
        }

        logger.debug('updateSystemMetrics завершен');
    }

    /**
     * Очистка неактивных клиентов
     */
    cleanupInactiveClients(timeout = 6000) {
        const now = Date.now();
        let activeCount = 0;

        Object.entries(this.metrics.activeClients.clients).forEach(([clientId, clientData]) => {
            if (now - clientData.lastSeen > timeout) {
                delete this.metrics.activeClients.clients[clientId];
                logger.debug(`Клиент ${clientId} удален из-за неактивности`);
            } else {
                activeCount++;
            }
        });

        this.metrics.activeClients.count = activeCount;
    }

    /**
     * Регистрация клиента
     */
    registerClient(clientId, clientIp, userAgent, path) {
        const now = Date.now();

        this.metrics.activeClients.clients[clientId] = {
            ip: clientIp,
            userAgent: userAgent,
            lastSeen: now,
            lastPath: path,
            requestCount: (this.metrics.activeClients.clients[clientId]?.requestCount || 0) + 1
        };

        this.metrics.activeClients.count = Object.keys(this.metrics.activeClients.clients).length;
    }
}

module.exports = MetricsService;
