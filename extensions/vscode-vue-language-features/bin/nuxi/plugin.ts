// @ts-nocheck
export default defineNuxtPlugin(app => {

    if (process.server)
        return;

    const ws = new WebSocket('ws://localhost:56789');
    const finderApis = installGoToCode();
    const highlightApis = installSelectionHighlight();

    let href = '';

    setInterval(function () {
        if (href !== location.href) {
            href = location.href;
            parent.postMessage({ command: 'urlChanged', data: href }, '*');
        }
    }, 200);

    return {
        provide: {
            volar: {
                ...finderApis,
                ...highlightApis,
            },
        },
    };

    function installSelectionHighlight() {

        let selection: {
            fileName: string,
            ranges: {
                start,
                end,
            }[],
            isDirty: boolean,
        } | undefined;
        const nodes = new Map<Element, {
            fileName: string,
            range: [number, number],
        }>();
        const cursorInOverlays = new Map<Element, HTMLElement>();
        const rangeCoverOverlays = new Map<Element, HTMLElement>();

        window.addEventListener('message', event => {
            if (event.data?.command === 'highlightSelections') {
                selection = event.data.data;
                updateHighlights();
            }
        });
        window.addEventListener('scroll', updateHighlights);

        ws.addEventListener('message', event => {
            const data = JSON.parse(event.data);
            if (data?.command === 'highlightSelections') {
                selection = data.data;
                updateHighlights();
            }
        });

        return {
            vnodeMounted,
            vnodeUnmounted,
        };

        function vnodeMounted(node: unknown, fileName: string, range: [number, number]) {
            if (node instanceof Element) {
                nodes.set(node, {
                    fileName,
                    range,
                });
            }
        }
        function vnodeUnmounted(node: unknown) {
            if (node instanceof Element) {
                nodes.delete(node);
            }
        }
        function updateHighlights() {

            if (selection.isDirty) {
                for (const [_, overlay] of cursorInOverlays) {
                    overlay.style.opacity = '0.5';
                }
                for (const [_, overlay] of rangeCoverOverlays) {
                    overlay.style.opacity = '0.5';
                }
                return;
            }
            else {
                for (const [_, overlay] of cursorInOverlays) {
                    overlay.style.opacity = '1';
                }
                for (const [_, overlay] of rangeCoverOverlays) {
                    overlay.style.opacity = '1';
                }
            }

            const cursorIn = new Set<Element>();
            const rangeConver = new Set<Element>();

            if (selection) {
                for (const range of selection.ranges) {
                    for (const [el, loc] of nodes) {
                        if (loc.fileName === selection.fileName) {
                            if (range.start <= loc.range[0] && range.end >= loc.range[1]) {
                                rangeConver.add(el);
                            }
                            else if (
                                range.start >= loc.range[0] && range.start <= loc.range[1]
                                || range.end >= loc.range[0] && range.end <= loc.range[1]
                            ) {
                                cursorIn.add(el);
                            }
                        }
                    }
                }
            }

            for (const [el, overlay] of [...cursorInOverlays]) {
                if (!cursorIn.has(el)) {
                    overlay.remove();
                    cursorInOverlays.delete(el);
                }
            }
            for (const [el, overlay] of [...rangeCoverOverlays]) {
                if (!rangeConver.has(el)) {
                    overlay.remove();
                    rangeCoverOverlays.delete(el);
                }
            }

            for (const el of cursorIn) {
                let overlay = cursorInOverlays.get(el);
                if (!overlay) {
                    overlay = createCursorInOverlay();
                    cursorInOverlays.set(el, overlay);
                }
                const rect = el.getBoundingClientRect();
                overlay.style.width = ~~rect.width + 'px';
                overlay.style.height = ~~rect.height + 'px';
                overlay.style.top = ~~rect.top + 'px';
                overlay.style.left = ~~rect.left + 'px';
            }
            for (const el of rangeConver) {
                let overlay = rangeCoverOverlays.get(el);
                if (!overlay) {
                    overlay = createRangeCoverOverlay();
                    rangeCoverOverlays.set(el, overlay);
                }
                const rect = el.getBoundingClientRect();
                overlay.style.width = ~~rect.width + 'px';
                overlay.style.height = ~~rect.height + 'px';
                overlay.style.top = ~~rect.top + 'px';
                overlay.style.left = ~~rect.left + 'px';
            }
        }
        function createCursorInOverlay() {
            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.zIndex = '99999999999999';
            overlay.style.pointerEvents = 'none';
            overlay.style.borderRadius = '3px';
            overlay.style.borderStyle = 'dashed';
            overlay.style.borderColor = 'rgb(196, 105, 183)';
            overlay.style.borderWidth = '1px';
            overlay.style.boxSizing = 'border-box';
            document.body.appendChild(overlay);
            return overlay;
        }
        function createRangeCoverOverlay() {
            const overlay = createCursorInOverlay();
            overlay.style.backgroundColor = 'rgba(196, 105, 183, 0.1)';
            return overlay;
        }
    }

    function installGoToCode() {

        window.addEventListener('scroll', updateOverlay);
        window.addEventListener('message', event => {
            if (event.data?.command === 'selectElement') {
                enable();
            }
        });
        window.addEventListener('pointerdown', event => {
            disable(true);
        });
        window.addEventListener('keydown', event => {
            if (event.key === 'Alt') {
                enable();
            }
        });
        window.addEventListener('keyup', event => {
            if (event.key === 'Alt') {
                disable(false);
            }
        });

        const overlay = createOverlay();
        const clickMask = createClickMask();

        let highlightNodes: [Element, string, [number, number]][] = [];
        let enabled = false;
        let lastCodeLoc: any | undefined;

        return {
            highlight,
            unHighlight,
        };

        function enable() {
            enabled = true;
            clickMask.style.pointerEvents = 'none';
            document.body.appendChild(clickMask);
            updateOverlay();
        }
        function disable(openVscode: boolean) {
            if (enabled) {
                enabled = false;
                clickMask.style.pointerEvents = '';
                highlightNodes = [];
                updateOverlay();
                if (lastCodeLoc) {
                    ws.send(JSON.stringify(lastCodeLoc));
                    if (openVscode) {
                        window.open('vscode://files:/' + lastCodeLoc.fileName);
                    }
                    lastCodeLoc = undefined;
                }
            }
        }
        function goToTemplate(fileName: string, range: [number, number]) {
            if (!enabled) return;
            lastCodeLoc = {
                command: 'goToTemplate',
                data: {
                    fileName,
                    range,
                },
            };
            ws.send(JSON.stringify(lastCodeLoc));
        }
        function highlight(node: unknown, fileName: string, range: [number, number]) {
            if (node instanceof Element) {
                highlightNodes.push([node, fileName, range]);
            }
            updateOverlay();
        }
        function unHighlight(node: Element) {
            highlightNodes = highlightNodes.filter(hNode => hNode[0] !== node);
            updateOverlay();
        }
        function createOverlay() {
            const overlay = document.createElement('div');
            overlay.style.backgroundColor = 'rgba(65, 184, 131, 0.35)';
            overlay.style.position = 'fixed';
            overlay.style.zIndex = '99999999999999';
            overlay.style.pointerEvents = 'none';
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.borderRadius = '3px';
            return overlay;
        }
        function createClickMask() {
            const overlay = document.createElement('div');
            overlay.style.position = 'fixed';
            overlay.style.zIndex = '99999999999999';
            overlay.style.pointerEvents = 'none';
            overlay.style.display = 'flex';
            overlay.style.left = '0';
            overlay.style.right = '0';
            overlay.style.top = '0';
            overlay.style.bottom = '0';
            overlay.addEventListener('pointerup', () => {
                if (overlay.parentNode) {
                    overlay.parentNode?.removeChild(overlay)
                }
            });
            return overlay;
        }
        function updateOverlay() {
            if (enabled && highlightNodes.length) {
                document.body.appendChild(overlay);
                const highlight = highlightNodes[highlightNodes.length - 1];
                const highlightNode = highlight[0];
                const rect = highlightNode.getBoundingClientRect();
                overlay.style.width = ~~rect.width + 'px';
                overlay.style.height = ~~rect.height + 'px';
                overlay.style.top = ~~rect.top + 'px';
                overlay.style.left = ~~rect.left + 'px';
                goToTemplate(highlight[1], highlight[2]);
            }
            else if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay)
            }
        }
    }

    // function installPreview() {
    //     if (location.pathname === '/__preview') {
    //         const preview = defineComponent({
    //             setup() {
    //                 window.addEventListener('message', event => {
    //                     if (event.data?.command === 'updateUrl') {
    //                         url.value = new URL(event.data.data);
    //                         _file.value = url.value.hash.slice(1);
    //                     }
    //                 });
    //                 const url = ref(new URL(location.href));
    //                 const _file = ref(url.value.hash.slice(1));
    //                 const file = computed(() => {
    //                     // fix windows path for vite
    //                     let path = _file.value.replace(/\\/g, '/');
    //                     if (path.indexOf(':') >= 0) {
    //                         path = path.split(':')[1];
    //                     }
    //                     return path;
    //                 });
    //                 const target = computed(() => defineAsyncComponent(() => import(file.value))); // TODO: responsive not working
    //                 const props = computed(() => {
    //                     const _props: Record<string, any> = {};
    //                     url.value.searchParams.forEach((value, key) => {
    //                         eval('_props[key] = ' + value);
    //                     });
    //                     return _props;
    //                 });
    //                 return () => h(Suspense, undefined, [
    //                     h(target.value, props.value)
    //                 ]);
    //             },
    //         });
    //         // TODO: fix preview not working if preview component is root component
    //         (app._component as any).setup = preview.setup;

    //         app.config.warnHandler = (msg) => {
    //             window.parent.postMessage({
    //                 command: 'warn',
    //                 data: msg,
    //             }, '*');
    //             console.warn(msg);
    //         };
    //         app.config.errorHandler = (msg) => {
    //             window.parent.postMessage({
    //                 command: 'error',
    //                 data: msg,
    //             }, '*');
    //             console.error(msg);
    //         };
    //         // TODO: post emit
    //     }
    // }
});
