document.addEventListener('DOMContentLoaded', () => {
    const openGradesButton = document.getElementById('open-grades-button');
    if (openGradesButton) {
        openGradesButton.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('src/grades.html') });
            window.close();
        });
    }
});
