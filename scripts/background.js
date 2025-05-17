// In background.js

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: "" });
  chrome.storage.local.get('allClassesData', (result) => {
    if (!result.allClassesData) {
      chrome.storage.local.set({ allClassesData: {} });
    }
  });
  chrome.storage.session.clear(() => {
    console.log("Session storage cleared on install/update.");
  });
});

const canvasGradesRegex = /:\/\/([^\/]+\.)*instructure\.com\/courses\/\d+\/grades/;
let pendingScrapedData = null;

async function updatePopup(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && canvasGradesRegex.test(tab.url)) {
      // Check session storage to see if this tab was already saved_and_opened
      const sessionKeyStatus = `tabStatus_${tabId}`;
      // No need to fetch className here, processing_popup.js handles it
      chrome.storage.session.get([sessionKeyStatus], async (result) => {
        // Always set to processing.html if it's a grades page.
        // processing_popup.js will determine the exact UI state.
        await chrome.action.setPopup({ tabId: tabId, popup: '../src/processing.html' });
      });
    } else {
      await chrome.action.setPopup({ tabId: tabId, popup: '../src/nograde.html' });
      if (pendingScrapedData && pendingScrapedData.tabId === tabId) {
        pendingScrapedData = null;
      }
      // Clear status and saved class name if not a grades page
      chrome.storage.session.remove([`tabStatus_${tabId}`, `savedClassNameForTab_${tabId}`], () => {
        // console.log(`Cleared session status and class name for tab ${tabId} (not a grades page).`);
      });
    }
  } catch (error) {
    if (error.message && !error.message.includes("No tab with id") && !error.message.includes("Cannot access a chrome:// URL")) {
        console.error("Error updating popup:", error, tabId);
    }
  }
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (activeInfo.tabId && activeInfo.tabId !== chrome.tabs.TAB_ID_NONE) {
    await updatePopup(activeInfo.tabId);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.status === 'complete' || changeInfo.url)) {
    await updatePopup(tabId);
  }
});

chrome.action.onClicked.addListener(async (tab) => {
   if (tab.id && tab.id !== chrome.tabs.TAB_ID_NONE) {
      await updatePopup(tab.id);
   }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scrapedDataAvailable") {
    console.log(`Background: Received scrapedDataAvailable for class "${request.className}" from tab ${sender.tab?.id}`);
    pendingScrapedData = {
        tabId: sender.tab?.id,
        className: request.className,
        data: request.data,
        categoryWeights: request.categoryWeights
    };
    if (sender.tab && sender.tab.id) {
        // Only set to "processed" if not already "saved_and_opened"
        const sessionKey = `tabStatus_${sender.tab.id}`;
        chrome.storage.session.get(sessionKey, (result) => {
            if (result[sessionKey] !== "saved_and_opened") {
                chrome.storage.session.set({ [sessionKey]: "processed" }, () => {
                    // console.log(`Background: Tab ${sender.tab.id} status set to 'processed'.`);
                });
            } else {
                // console.log(`Background: Tab ${sender.tab.id} already 'saved_and_opened', not changing status to 'processed'.`);
            }
        });
    }
    console.log("Background: Data is pending user confirmation.", pendingScrapedData);
    sendResponse({ status: "pending data held" }); // Acknowledge

  } else if (request.action === "userConfirmedSaveAndOpen") {
      console.log("Background: Received userConfirmedSaveAndOpen.");
      chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
          const currentActiveTabId = activeTabs[0]?.id;

          if (pendingScrapedData && pendingScrapedData.tabId === currentActiveTabId) {
              console.log("Background: Committing pending data for class:", pendingScrapedData.className);
              const { className, data: newAssignments, categoryWeights: newCategoryWeights } = pendingScrapedData;
              const tabIdToUpdate = pendingScrapedData.tabId; // Capture tabId

              chrome.storage.local.get('allClassesData', (result) => {
                  let allClasses = result.allClassesData || {};
                  
                  allClasses[className] = newAssignments || [];

                  const validCategoriesFromAssignments = new Set((newAssignments || []).map(a => a.category || 'Uncategorized'));
                  const validCategoriesFromScrapedWeights = new Set(newCategoryWeights ? Object.keys(newCategoryWeights) : []);
                  const allValidCategoriesFromScrape = new Set([...validCategoriesFromAssignments, ...validCategoriesFromScrapedWeights]);

                  const weightsKey = className + '_weights';
                  if (newCategoryWeights && Object.keys(newCategoryWeights).length > 0) {
                      allClasses[weightsKey] = newCategoryWeights;
                  } else if (allClasses[weightsKey]) {
                      const existingWeights = allClasses[weightsKey];
                      const prunedWeights = {};
                      allValidCategoriesFromScrape.forEach(cat => {
                          if (existingWeights.hasOwnProperty(cat)) {
                              prunedWeights[cat] = existingWeights[cat];
                          }
                      });
                      if (Object.keys(prunedWeights).length > 0) {
                          allClasses[weightsKey] = prunedWeights;
                      } else {
                          delete allClasses[weightsKey];
                      }
                  } else {
                      delete allClasses[weightsKey];
                  }

                  const settingsKey = className + '_settings';
                  // Preserve existing categoryDrops and gradeCutoffs if they exist
                  const existingFullSettings = allClasses[settingsKey] || {};
                  const newSettings = { 
                      categoryCalcMethods: {},
                      categoryDrops: existingFullSettings.categoryDrops || {},
                      gradeCutoffs: existingFullSettings.gradeCutoffs || {}
                  };
                  
                  allValidCategoriesFromScrape.forEach(cat => {
                      if (existingFullSettings.categoryCalcMethods && existingFullSettings.categoryCalcMethods.hasOwnProperty(cat)) {
                          newSettings.categoryCalcMethods[cat] = existingFullSettings.categoryCalcMethods[cat];
                      } else {
                          newSettings.categoryCalcMethods[cat] = 'totalPoints';
                      }
                  });

                  // Ensure categoryDrops only contains valid categories
                  const prunedDrops = {};
                  allValidCategoriesFromScrape.forEach(cat => {
                      if (newSettings.categoryDrops.hasOwnProperty(cat)) {
                          prunedDrops[cat] = newSettings.categoryDrops[cat];
                      }
                  });
                  newSettings.categoryDrops = prunedDrops;

                  if (Object.keys(newSettings.categoryCalcMethods).length > 0 || Object.keys(newSettings.categoryDrops).length > 0 || Object.keys(newSettings.gradeCutoffs).length > 0 ) {
                      allClasses[settingsKey] = newSettings;
                  } else {
                      delete allClasses[settingsKey];
                  }
                  
                  chrome.storage.local.set({ 'allClassesData': allClasses }, () => {
                      console.log(`Background: Data for "${className}" committed and cleaned in storage.`);
                      if (tabIdToUpdate) {
                          const sessionUpdate = {};
                          sessionUpdate[`tabStatus_${tabIdToUpdate}`] = "saved_and_opened";
                          sessionUpdate[`savedClassNameForTab_${tabIdToUpdate}`] = className; // Store the class name
                          chrome.storage.session.set(sessionUpdate, () => {
                              console.log(`Background: Tab ${tabIdToUpdate} status set to 'saved_and_opened' for class ${className}.`);
                          });
                      }
                      pendingScrapedData = null; 
                      const gradesPageUrl = chrome.runtime.getURL('../src/grades.html') + '?className=' + encodeURIComponent(className);
                      chrome.tabs.create({ url: gradesPageUrl });
                  });
              });
          } else {
              console.warn("Background: userConfirmedSaveAndOpen - Mismatch or no pending data for current tab.", {pendingTabId: pendingScrapedData?.tabId, currentActiveTabId});
              chrome.tabs.create({ url: chrome.runtime.getURL('../src/grades.html') }); 
              if(pendingScrapedData) pendingScrapedData = null;
          }
    });
  } else if (request.action === "processingDone") {
    console.log("Background: processingDone signal received. Tab ID:", sender.tab?.id);
  }
});