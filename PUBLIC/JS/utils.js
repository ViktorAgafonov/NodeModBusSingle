// Утилиты фронтенда

// Intersection Observer для lazy loading графиков
export function createLazyObserver(callback, options = {}) {
    const defaultOptions = {
        root: null,
        rootMargin: '50px',
        threshold: 0.01
    };
    return new IntersectionObserver(callback, { ...defaultOptions, ...options });
}
