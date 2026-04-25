(function () {
    const DEFAULT_MAX_IMAGES = 9;

    function noop() {}

    function createPreviewUrl(filename) {
        return filename ? `/api/image-cache/${encodeURIComponent(filename)}` : '';
    }

    function createInputMediaBridge(options = {}) {
        const textarea = options.textarea || null;
        const previewGrid = options.previewGrid || null;
        const statusEl = options.statusEl || null;
        const storageKey = options.storageKey || 'journal-sync-home-v2-pending-images';
        const enableStorage = options.enableStorage === true;
        const maxImages = Number.isFinite(options.maxImages) ? options.maxImages : DEFAULT_MAX_IMAGES;
        const previewModal = options.previewModal || null;
        const previewImage = options.previewImage || null;
        const previewCloseBtn = options.previewCloseBtn || null;
        const onChange = typeof options.onChange === 'function' ? options.onChange : noop;

        let images = [];
        let isInitialized = false;
        let dragIndex = -1;
        let suppressNextPreviewOpen = false;

        function normalizeImages(nextImages = []) {
            const normalized = [];
            const seen = new Set();

            for (const item of Array.isArray(nextImages) ? nextImages : []) {
                const filename = typeof item === 'string'
                    ? item.trim()
                    : String(item?.filename || '').trim();
                if (!filename || seen.has(filename)) continue;
                seen.add(filename);
                normalized.push({
                    filename,
                    previewUrl: (typeof item === 'object' && item?.previewUrl)
                        ? String(item.previewUrl)
                        : createPreviewUrl(filename)
                });
            }

            return normalized.slice(0, maxImages);
        }

        function notifyChange() {
            onChange(getState());
        }

        function getState() {
            return {
                images: images.map(item => ({ ...item })),
                count: images.length,
                maxImages
            };
        }

        function getImageFilenames() {
            return images.map(item => item.filename);
        }

        function hasImages() {
            return images.length > 0;
        }

        function saveImages() {
            if (!enableStorage) return;
            try {
                localStorage.setItem(storageKey, JSON.stringify(images));
            } catch {}
        }

        function setStatus(text) {
            if (statusEl) {
                statusEl.textContent = text || '';
            }
        }

        function closePreview() {
            if (!previewModal || !previewImage) return;
            previewModal.classList.remove('active');
            previewModal.setAttribute('aria-hidden', 'true');
            previewImage.src = '';
        }

        function openPreview(src) {
            if (!previewModal || !previewImage || !src) return;
            previewImage.src = src;
            previewModal.classList.add('active');
            previewModal.setAttribute('aria-hidden', 'false');
        }

        function setImages(nextImages, { notify = true } = {}) {
            images = normalizeImages(nextImages);
            saveImages();
            renderPreview();
            if (notify) {
                notifyChange();
            }
        }

        function removeImage(index) {
            if (index < 0 || index >= images.length) return;
            images.splice(index, 1);
            saveImages();
            renderPreview();
            notifyChange();
        }

        function reorderImages(fromIndex, toIndex) {
            if (fromIndex < 0 || toIndex < 0) return;
            if (fromIndex >= images.length || toIndex >= images.length) return;
            if (fromIndex === toIndex) return;

            const [moved] = images.splice(fromIndex, 1);
            images.splice(toIndex, 0, moved);
            saveImages();
            renderPreview();
            notifyChange();
        }

        function renderPreview() {
            if (!previewGrid) return;
            previewGrid.innerHTML = '';

            images.forEach((image, index) => {
                const item = document.createElement('div');
                item.className = 'media-thumb';
                item.title = `拖动调整顺序，点击查看图片 ${index + 1}`;
                item.setAttribute('role', 'button');
                item.setAttribute('tabindex', '0');
                item.setAttribute('draggable', 'true');
                item.dataset.index = String(index);

                const imgEl = document.createElement('img');
                imgEl.src = image.previewUrl;
                imgEl.alt = `图片 ${index + 1}`;

                const orderEl = document.createElement('span');
                orderEl.className = 'media-thumb-order';
                orderEl.textContent = String(index + 1);

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'media-thumb-remove';
                deleteBtn.setAttribute('aria-label', `移除图片 ${index + 1}`);
                deleteBtn.textContent = '×';
                deleteBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    removeImage(index);
                });

                item.addEventListener('click', () => {
                    if (suppressNextPreviewOpen) {
                        suppressNextPreviewOpen = false;
                        return;
                    }
                    openPreview(image.previewUrl);
                });
                item.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openPreview(image.previewUrl);
                    }
                });
                item.addEventListener('dragstart', (event) => {
                    dragIndex = index;
                    suppressNextPreviewOpen = true;
                    item.classList.add('dragging');
                    if (event.dataTransfer) {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', String(index));
                    }
                });
                item.addEventListener('dragover', (event) => {
                    if (dragIndex < 0) return;
                    event.preventDefault();
                    if (event.dataTransfer) {
                        event.dataTransfer.dropEffect = 'move';
                    }
                    item.classList.add('drag-over');
                });
                item.addEventListener('dragleave', () => {
                    item.classList.remove('drag-over');
                });
                item.addEventListener('drop', (event) => {
                    if (dragIndex < 0) return;
                    event.preventDefault();
                    item.classList.remove('drag-over');
                    const targetIndex = Number(item.dataset.index);
                    reorderImages(dragIndex, targetIndex);
                    dragIndex = -1;
                    setTimeout(() => {
                        suppressNextPreviewOpen = false;
                    }, 0);
                });
                item.addEventListener('dragend', () => {
                    dragIndex = -1;
                    item.classList.remove('dragging');
                    previewGrid.querySelectorAll('.media-thumb.drag-over').forEach(el => {
                        el.classList.remove('drag-over');
                    });
                    setTimeout(() => {
                        suppressNextPreviewOpen = false;
                    }, 0);
                });
                item.appendChild(orderEl);
                item.appendChild(imgEl);
                item.appendChild(deleteBtn);
                previewGrid.appendChild(item);
            });
        }

        async function uploadImageToCache(file) {
            if (!file || !String(file.type || '').startsWith('image/')) return;

            if (images.length >= maxImages) {
                window.alert(`最多只能上传 ${maxImages} 张图片`);
                return;
            }

            setStatus(`正在上传 ${file.name || '图片'}...`);

            try {
                const formData = new FormData();
                formData.append('image', file);

                const response = await fetch('/api/upload-image', {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json().catch(() => ({}));

                if (!response.ok || !data.success) {
                    throw new Error(data.error || `HTTP ${response.status}`);
                }

                images.push({
                    filename: data.filename,
                    previewUrl: data.previewUrl || createPreviewUrl(data.filename)
                });
                saveImages();
                renderPreview();
                setStatus('');
                notifyChange();
            } catch (error) {
                console.error('[InputMediaBridge] 上传失败:', error);
                setStatus(`上传失败：${error.message}`);
            }
        }

        async function handleFiles(fileList) {
            const fileArray = Array.from(fileList || []).filter(file => String(file.type || '').startsWith('image/'));
            if (fileArray.length === 0) return;

            const remaining = maxImages - images.length;
            if (remaining <= 0) {
                window.alert(`最多只能上传 ${maxImages} 张图片`);
                return;
            }

            const uploadQueue = fileArray.slice(0, remaining);
            if (uploadQueue.length < fileArray.length) {
                window.alert(`已达上限，仅上传前 ${uploadQueue.length} 张图片`);
            }

            for (const file of uploadQueue) {
                await uploadImageToCache(file);
            }
        }

        function restoreImages() {
            if (!enableStorage) return;
            try {
                const saved = localStorage.getItem(storageKey);
                if (!saved) return;
                const parsed = JSON.parse(saved);
                setImages(parsed, { notify: true });
            } catch {}
        }

        function bindTextareaEvents() {
            if (!textarea) return;

            textarea.addEventListener('paste', async (event) => {
                const items = Array.from(event.clipboardData?.items || []);
                const imageItems = items.filter(item => String(item.type || '').startsWith('image/'));
                if (imageItems.length === 0) return;

                event.preventDefault();
                const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
                await handleFiles(files);
            });

            textarea.addEventListener('dragover', (event) => {
                const hasImage = Array.from(event.dataTransfer?.items || [])
                    .some(item => String(item.type || '').startsWith('image/'));
                if (!hasImage) return;
                event.preventDefault();
                textarea.classList.add('drag-over');
            });

            textarea.addEventListener('dragleave', (event) => {
                if (!textarea.contains(event.relatedTarget)) {
                    textarea.classList.remove('drag-over');
                }
            });

            textarea.addEventListener('drop', async (event) => {
                textarea.classList.remove('drag-over');
                const files = event.dataTransfer?.files;
                if (!files || files.length === 0) return;

                const hasImage = Array.from(files).some(file => String(file.type || '').startsWith('image/'));
                if (!hasImage) return;

                event.preventDefault();
                await handleFiles(files);
            });
        }

        function bindPreviewEvents() {
            if (previewModal) {
                previewModal.addEventListener('click', (event) => {
                    if (event.target === previewModal) {
                        closePreview();
                    }
                });
            }

            if (previewCloseBtn) {
                previewCloseBtn.addEventListener('click', closePreview);
            }

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && previewModal?.classList.contains('active')) {
                    closePreview();
                }
            });
        }

        function clear() {
            setImages([], { notify: true });
            setStatus('');
        }

        function init() {
            if (isInitialized) return api;
            isInitialized = true;
            bindTextareaEvents();
            bindPreviewEvents();
            restoreImages();
            renderPreview();
            return api;
        }

        const api = {
            init,
            clear,
            setImages,
            getState,
            getImageFilenames,
            hasImages
        };

        return api;
    }

    window.createInputMediaBridge = createInputMediaBridge;
})();
