browser.runtime.onMessage.addListener(async (message) => {
    if (message.action !== "downloadFiles") return;

    // Accept the new {url, filename} format, and keep support for plain URL arrays.
    const files = Array.isArray(message.files)
        ? message.files
        : (Array.isArray(message.urls) ? message.urls : []).map((url) => ({ url: url }));

    for (const file of files) {
        try {
            const options = {
                url: file.url,
                conflictAction: "uniquify"
            };

            if (file.filename) {
                options.filename = file.filename;
            }

            await browser.downloads.download(options);
        } catch (error) {
            console.error(`Download failed for ${file.url}: ${error.message}`);
        }
    }
});
