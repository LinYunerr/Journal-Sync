(function initGlobalInputTraits(globalWindow) {
    const GlobalInputTraits = globalWindow.GlobalInputTraits || {};
    globalWindow.GlobalInputTraits = GlobalInputTraits;

    if (!GlobalInputTraits.autoGrowTextarea) {
        GlobalInputTraits.autoGrowTextarea = function autoGrowTextarea(textarea, options = {}) {
            if (!textarea) return null;

            const reserveLines = Number.isFinite(options.reserveLines) ? options.reserveLines : 2;
            const computed = globalWindow.getComputedStyle(textarea);
            const parsedLineHeight = Number.parseFloat(computed.lineHeight);
            const lineHeight = Number.isFinite(parsedLineHeight)
                ? parsedLineHeight
                : (Number.parseFloat(computed.fontSize) || 16) * 1.4;

            const borderTop = Number.parseFloat(computed.borderTopWidth) || 0;
            const borderBottom = Number.parseFloat(computed.borderBottomWidth) || 0;
            const savedBaseHeight = Number.parseFloat(textarea.dataset.baseHeightPx || '');
            const baseHeight = Number.isFinite(savedBaseHeight)
                ? savedBaseHeight
                : Math.max(textarea.offsetHeight, Number.parseFloat(computed.minHeight) || 0);

            textarea.dataset.baseHeightPx = String(baseHeight);

            const updateHeight = () => {
                textarea.style.height = 'auto';
                const reserveHeight = reserveLines * lineHeight;
                const targetHeight = Math.max(baseHeight, textarea.scrollHeight + reserveHeight + borderTop + borderBottom);
                textarea.style.height = `${Math.ceil(targetHeight)}px`;
            };

            const handleInput = () => updateHeight();
            textarea.addEventListener('input', handleInput);
            updateHeight();

            return {
                refresh: updateHeight,
                destroy: ({ resetToBaseHeight = true } = {}) => {
                    textarea.removeEventListener('input', handleInput);
                    if (resetToBaseHeight) {
                        textarea.style.height = `${Math.ceil(baseHeight)}px`;
                    } else {
                        textarea.style.height = '';
                    }
                }
            };
        };
    }

    if (!GlobalInputTraits.autoGrowRegistry) {
        GlobalInputTraits.autoGrowRegistry = new Map();
    }

    if (!GlobalInputTraits.mountAutoGrowTextarea) {
        GlobalInputTraits.mountAutoGrowTextarea = function mountAutoGrowTextarea(key, textarea, options = {}) {
            if (!key || !textarea) return null;

            const registry = GlobalInputTraits.autoGrowRegistry;
            const current = registry.get(key);

            if (current?.textarea && current.textarea !== textarea && current.trait?.destroy) {
                current.trait.destroy({ resetToBaseHeight: true });
                registry.delete(key);
            }

            if (!registry.has(key)) {
                const trait = GlobalInputTraits.autoGrowTextarea(textarea, options);
                if (trait) {
                    registry.set(key, { textarea, trait });
                }
            }

            const mounted = registry.get(key)?.trait || null;
            mounted?.refresh?.();
            return mounted;
        };
    }

    if (!GlobalInputTraits.unmountAutoGrowTextarea) {
        GlobalInputTraits.unmountAutoGrowTextarea = function unmountAutoGrowTextarea(key, options = {}) {
            const registry = GlobalInputTraits.autoGrowRegistry;
            const current = registry.get(key);
            if (!current?.trait?.destroy) return;

            const resetToBaseHeight = options.resetToBaseHeight !== false;
            current.trait.destroy({ resetToBaseHeight });
            registry.delete(key);
        };
    }

    if (!GlobalInputTraits.refreshAutoGrowTextarea) {
        GlobalInputTraits.refreshAutoGrowTextarea = function refreshAutoGrowTextarea(key) {
            GlobalInputTraits.autoGrowRegistry.get(key)?.trait?.refresh?.();
        };
    }
}(window));
