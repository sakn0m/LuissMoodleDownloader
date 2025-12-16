chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "downloadFiles" && message.urls) {
        message.urls.forEach((url) => {
            chrome.downloads.download({
                url: url,
                conflictAction: 'uniquify'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error(`Download failed: ${chrome.runtime.lastError.message}`);
                }
            });
        });
    }
});