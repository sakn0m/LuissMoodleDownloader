// 1. Attach Listeners
document.getElementById('btnAll').addEventListener('click', () => startDownload('all'));
document.getElementById('btnPdf').addEventListener('click', () => startDownload('pdf'));
document.getElementById('btnPpt').addEventListener('click', () => startDownload('ppt'));
document.getElementById('btnIpynb').addEventListener('click', () => startDownload('ipynb'));
document.getElementById('btnPy').addEventListener('click', () => startDownload('py'));

// 2. Main Logic
async function startDownload(fileType) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = `Scanning for ${fileType.toUpperCase()}...`;

    try {
        let [tab] = await browser.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.url || !tab.url.includes("my.luiss.it")) {
            statusDiv.textContent = "Error: Not a my.luiss.it page.";
            return;
        }

        const results = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: scrapeLinks,
            args: [fileType]
        });

        if (!results || !results[0] || !Array.isArray(results[0].result)) {
            statusDiv.textContent = "Error: Scraper failed.";
            return;
        }

        const files = results[0].result;

        if (files.length === 0) {
            statusDiv.textContent = `No files found for: ${fileType}`;
            return;
        }

        statusDiv.textContent = `Found ${files.length} files. Downloading...`;
        await browser.runtime.sendMessage({ action: "downloadFiles", files: files });
    } catch (error) {
        statusDiv.textContent = "Error: " + error.message;
    }
}

// 3. Scraper Function (Runs inside the page)
// Everything must stay inside this function: it is serialized and injected
// into the Moodle page, so it cannot reference helpers defined outside it.
async function scrapeLinks(filterType) {
    function sanitizeFilename(name, fallbackExtension) {
        let base = (name || 'moodle-file')
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^\.+/, '')
            .replace(/[. ]+$/, '');

        // Moodle appends labels such as "File" or "PDF" to the activity name.
        base = base.replace(/\s+(file|pdf|ppt|pptx|powerpoint|document|word|spreadsheet|archive)\s*$/i, '');
        if (!base) base = 'moodle-file';

        const hasExtension = /\.[a-z0-9]{1,5}$/i.test(base);
        return hasExtension || !fallbackExtension ? base : `${base}.${fallbackExtension}`;
    }

    function filenameFromUrl(url) {
        try {
            const path = new URL(url).pathname;
            return decodeURIComponent(path.split('/').pop() || '');
        } catch (error) {
            return '';
        }
    }

    function filenameFromDisposition(header) {
        if (!header) return '';

        const encoded = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
        if (encoded) {
            try {
                return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ''));
            } catch (error) {
                // Fall through to the plain filename parameter.
            }
        }

        const plain = header.match(/filename\s*=\s*"([^"]+)"/i) || header.match(/filename\s*=\s*([^;]+)/i);
        return plain ? plain[1].trim() : '';
    }

    function extensionFor(badgeText, iconSrc, linkText) {
        const haystack = `${badgeText} ${iconSrc} ${linkText}`;
        const match = haystack.match(/(pptx|ppt|pdf|ipynb|docx|doc|xlsx|xls|zip|csv|txt)/);
        if (match) return match[1];
        if (haystack.includes('powerpoint')) return 'pptx';
        if (haystack.includes('word')) return 'docx';
        if (haystack.includes('excel')) return 'xlsx';

        const byFilter = { pdf: 'pdf', ppt: 'pptx', ipynb: 'ipynb', py: 'py' };
        return byFilter[filterType] || '';
    }

    async function resolveFile(url, displayName, fallbackExtension) {
        const fallback = sanitizeFilename(displayName, fallbackExtension);

        // Moodle's view.php redirects to pluginfile.php/.../real-name.ext.
        // Resolve that final URL so the download is not saved as "view.php".
        const attempts = [
            { method: 'HEAD' },
            { method: 'GET', headers: { Range: 'bytes=0-0' } }
        ];

        for (const options of attempts) {
            try {
                const response = await fetch(url, {
                    ...options,
                    credentials: 'same-origin',
                    redirect: 'follow'
                });

                const dispositionName = filenameFromDisposition(response.headers.get('content-disposition'));
                const finalUrl = response.url || url;
                const urlName = filenameFromUrl(finalUrl);

                if (options.method === 'GET' && response.body) {
                    try {
                        await response.body.cancel();
                    } catch (error) {
                        // The body may already be closed; nothing to do.
                    }
                }

                if (response.ok || response.status === 206) {
                    const stillViewPhp = finalUrl.includes('/mod/resource/view.php');
                    const resolvedName = dispositionName || (urlName && urlName !== 'view.php' ? urlName : '');

                    if (resolvedName || !stillViewPhp) {
                        return {
                            url: finalUrl,
                            filename: sanitizeFilename(resolvedName || fallback, fallbackExtension)
                        };
                    }
                }
            } catch (error) {
                // Try the next method, then fall back to the original URL.
            }
        }

        return { url: url, filename: fallback };
    }

    // --- Get all Resource Links ---
    const anchors = document.querySelectorAll('a[href*="/mod/resource/view.php"]');
    const files = new Map();

    anchors.forEach(a => {
        // Find the "Activity Item" container that holds the link + icons + badges
        const container = a.closest('.activity-item');

        // Safety check: if we can't find the container, just check the link text
        const linkText = (a.innerText || a.textContent || '').toLowerCase();

        // --- DETECTION LOGIC ---
        let badgeText = "";
        let iconSrc = "";

        if (container) {
            // Check for the "Badge" (The little box that says PDF or PPTX)
            const badge = container.querySelector('.activitybadge');
            if (badge) badgeText = badge.innerText.toLowerCase();

            // Check the Icon Image URL
            const img = container.querySelector('img.activityicon');
            if (img) iconSrc = img.src.toLowerCase();
        }

        // --- FILTERING ---
        let isMatch = false;

        // PDF Check: Look for "pdf" in badge, icon, or link text
        const isPdf = badgeText.includes('pdf') || iconSrc.includes('pdf') || linkText.endsWith('.pdf');

        // PPT Check: Look for "ppt", "pptx", or "powerpoint"
        const isPpt = badgeText.includes('ppt') || badgeText.includes('pptx') || iconSrc.includes('powerpoint') || linkText.endsWith('.ppt') || linkText.endsWith('.pptx');

        // Code Check: Look for extensions in the link text (Moodle rarely has badges for these)
        const isIpynb = linkText.endsWith('.ipynb') || linkText.includes('.ipynb');
        const isPy = linkText.endsWith('.py') || linkText.includes('.py ');

        // Decide based on filterType
        if (filterType === 'all') {
            isMatch = true;
        } else if (filterType === 'pdf' && isPdf) {
            isMatch = true;
        } else if (filterType === 'ppt' && isPpt) {
            isMatch = true;
        } else if (filterType === 'ipynb' && isIpynb) {
            isMatch = true;
        } else if (filterType === 'py' && isPy) {
            isMatch = true;
        }

        // Add to list if matched
        if (isMatch) {
            let url = a.href;
            if (!url.includes('redirect=1')) {
                url += (url.includes('?') ? '&' : '?') + 'redirect=1';
            }

            if (!files.has(url)) {
                files.set(url, {
                    url: url,
                    name: (a.textContent || '').replace(/\s+/g, ' ').trim(),
                    extension: extensionFor(badgeText, iconSrc, linkText)
                });
            }
        }
    });

    // Resolve several files at once instead of waiting for each HEAD request
    // in sequence. Keep the concurrency modest to avoid hammering Moodle.
    const pending = Array.from(files.values());
    const resolved = new Array(pending.length);
    const concurrency = Math.min(6, pending.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const index = nextIndex++;
            if (index >= pending.length) return;

            const file = pending[index];
            resolved[index] = await resolveFile(file.url, file.name, file.extension);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return resolved;
}
