document.addEventListener('DOMContentLoaded', () => {
    //console.log("Popup: DOMContentLoaded.");

    const actionButton = document.getElementById('calculate-button'); 
    const loadingSpinner = document.querySelector('.loading-spinner');
    const processingTextElement = document.getElementById('processing-text');

    let currentTabId = null;
    let currentAction = null; // To store what the button should do: 'save', 'reopen'
    let classNameForReopen = null;

    function updateUI(state, className = null) {
        if (!actionButton || !loadingSpinner || !processingTextElement) {
            console.error("Popup: UI elements not found!");
            return;
        }
        switch (state) {
            case "processing":
                loadingSpinner.style.display = 'block';
                processingTextElement.textContent = "Processing grades from current page...";
                actionButton.style.display = 'none';
                actionButton.textContent = "Process"; // Default text, though hidden
                currentAction = null;
                classNameForReopen = null;
                break;
            case "processed":
                loadingSpinner.style.display = 'none';
                processingTextElement.textContent = "Grades processed! Click to save and view.";
                actionButton.textContent = "Save & View Grades";
                actionButton.style.display = 'block';
                currentAction = "save";
                classNameForReopen = null;
                break;
            case "saved_and_opened":
                loadingSpinner.style.display = 'none';
                classNameForReopen = className; // Store for the button click
                processingTextElement.textContent = `Grades for "${className || 'this class'}" are saved.`;
                actionButton.textContent = `Reopen Grades for ${className || 'Class'}`;
                actionButton.style.display = 'block';
                currentAction = "reopen";
                break;
            default:
                console.warn("Popup: Unknown UI state requested:", state);
                updateUI("processing"); // Default to processing
                break;
        }
        //console.log(`Popup: UI updated to state: ${state}, Action: ${currentAction}, Class for reopen: ${classNameForReopen}`);
    }

    if (actionButton) {
        actionButton.addEventListener('click', () => {
            if (currentAction === "save") {
                //console.log("Popup: 'Save & View Grades' clicked. Sending userConfirmedSaveAndOpen.");
                // Temporarily update UI to give feedback
                processingTextElement.textContent = "Saving and opening...";
                actionButton.disabled = true;

                chrome.runtime.sendMessage({ action: "userConfirmedSaveAndOpen" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Popup: Error sending 'userConfirmedSaveAndOpen':", chrome.runtime.lastError.message);
                        // Revert UI or show error if message fails
                        actionButton.disabled = false;
                        // checkTabStatus(currentTabId) might be good here to refresh based on actual state
                    } else {
                        //console.log("Popup: 'userConfirmedSaveAndOpen' sent. Background will handle opening.");
                        // The popup might close before storage.onChanged updates it, or background opens new tab.
                        // No specific UI change needed here post-send, rely on storage change or window close.
                    }
                });
            } else if (currentAction === "reopen" && classNameForReopen) {
                //console.log(`Popup: 'Reopen Grades' clicked for class ${classNameForReopen}.`);
                const gradesPageUrl = chrome.runtime.getURL('../src/grades.html') + '?className=' + encodeURIComponent(classNameForReopen);
                chrome.tabs.create({ url: gradesPageUrl });
                window.close(); // Close popup after action
            } else {
                 console.warn("Popup: Action button clicked with no defined action or missing class name for reopen.", { action: currentAction, class: classNameForReopen });
            }
        });
    } else {
        console.error("Popup: Action button (ID 'calculate-button') not found!");
    }

    function checkTabStatus(tabId) {
        const statusKey = `tabStatus_${tabId}`;
        const classKey = `savedClassNameForTab_${tabId}`;
        
        chrome.storage.session.get([statusKey, classKey], (result) => {
            if (chrome.runtime.lastError) {
                console.error("Popup: Error getting session storage:", chrome.runtime.lastError.message);
                updateUI("processing"); // Default on error
                return;
            }

            const status = result[statusKey];
            const savedClass = result[classKey];

            if (status === "saved_and_opened") {
                //console.log(`Popup (initial check): Tab ${tabId} status is 'saved_and_opened' for class '${savedClass}'.`);
                updateUI("saved_and_opened", savedClass);
            } else if (status === "processed") {
                //console.log(`Popup (initial check): Tab ${tabId} status is 'processed'.`);
                updateUI("processed");
            } else {
                //console.log(`Popup (initial check): Tab ${tabId} has no specific status ('${status}'). Defaulting to 'processing'.`);
                updateUI("processing");
            }
        });
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].id) {
            currentTabId = tabs[0].id;
            checkTabStatus(currentTabId); // Initial check for the current tab
        } else {
            console.warn("Popup: Could not get current active tab ID on load.");
            updateUI("processing"); // Default if tab ID is not found
        }
    });

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'session' && currentTabId) {
            const statusKey = `tabStatus_${currentTabId}`;
            const classKey = `savedClassNameForTab_${currentTabId}`;
            
            // Check if the status for the current tab has changed
            if (changes[statusKey]) {
                const newStatus = changes[statusKey].newValue;
                //console.log(`Popup (storage change): Tab ${currentTabId} status changed to '${newStatus}'.`);
                if (newStatus === "saved_and_opened") {
                    // Status changed to saved_and_opened, need to get the class name
                    chrome.storage.session.get(classKey, (result) => {
                        if (chrome.runtime.lastError) {
                            console.error("Popup: Error getting class name on status change:", chrome.runtime.lastError.message);
                            updateUI("saved_and_opened", null); // Show generic reopen if class name fetch fails
                        } else {
                            //console.log(`Popup (storage change): Class name for 'saved_and_opened' is '${result[classKey]}'.`);
                            updateUI("saved_and_opened", result[classKey]);
                        }
                    });
                } else if (newStatus === "processed") {
                    updateUI("processed");
                } else if (newStatus === undefined) { // Status was cleared (e.g., navigated away)
                    updateUI("processing");
                } else {
                     updateUI("processing"); // Default for any other undefined status
                }
            } 
            // If only the class name changed, but status remains 'saved_and_opened' (less common)
            else if (changes[classKey] && currentAction === "reopen") {
                 const newClassName = changes[classKey].newValue;
                 //console.log(`Popup (storage change): ClassName for tab ${currentTabId} updated to ${newClassName} while status is 'saved_and_opened'.`);
                 updateUI("saved_and_opened", newClassName);
            }
        }
    });
});