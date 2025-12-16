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

    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes("my.luiss.it")) {
        statusDiv.textContent = "Error: Not a my.luiss.it page.";
        return;
    }

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeLinks,
        args: [fileType]
    }, (results) => {
        if (chrome.runtime.lastError) {
            statusDiv.textContent = "Error: " + chrome.runtime.lastError.message;
            return;
        }

        if (!results || !results[0]) {
            statusDiv.textContent = "Error: Scraper failed.";
            return;
        }

        const links = results[0].result;
        
        if (links.length === 0) {
            statusDiv.textContent = `No files found for: ${fileType}`;
            return;
        }

        statusDiv.textContent = `Found ${links.length} files. Downloading...`;
        chrome.runtime.sendMessage({ action: "downloadFiles", urls: links });
    });
}

// 3. Scraper Function (Runs inside the page)
function scrapeLinks(filterType) {
    // 1. Get all Resource Links
    const anchors = document.querySelectorAll('a[href*="/mod/resource/view.php"]');
    const urls = new Set();

    anchors.forEach(a => {
        // Find the "Activity Item" container that holds the link + icons + badges
        const container = a.closest('.activity-item');
        
        // Safety check: if we can't find the container, just check the link text
        const linkText = a.innerText.toLowerCase(); 
        
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
                url += '&redirect=1';
            }
            urls.add(url);
        }
    });

    return Array.from(urls);
}