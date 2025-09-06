/**
 * @fileoverview Contains low-level, reusable utility functions.
 */

function createFollowUpTrigger() {
  try {
    ScriptApp.newTrigger('workerTriggerHandler')
      .timeBased()
      .after(1 * 60 * 1000)
      .create();
    logInfo("Time limit reached. Creating a new trigger to continue.");
  } catch(e) {
    logError("Could not create follow-up trigger.", e);
  }
}

function deleteTemporaryTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'workerTriggerHandler') {
       ScriptApp.deleteTrigger(trigger);
    }
  }
}

function checkSafetyLimits(state, lastBatchStartTime) {
  const currentTime = new Date();
  if ((currentTime - state.startTime) / 1000 / 60 >= MAX_RUNTIME_MINUTES) {
    state.stopReason = "Stopping: Time limit reached.";
    return true;
  }
  if (state.totalProcessedCount >= MAX_THREADS_PER_RUN) {
    state.stopReason = "Stopping: Processed thread limit reached.";
    return true;
  }
  
  const totalCallsThisRun = Object.values(state.apiCallCounts).reduce((sum, count) => sum + count, 0);
  if ((state.dailyApiCallCount + totalCallsThisRun) >= API_CALL_SAFETY_LIMIT) {
    state.stopReason = "Stopping: Daily API call safety limit reached.";
    return true;
  }
  
  if (state.batchNumber > 0) {
    state.batchTimings.push((new Date() - lastBatchStartTime) / 1000);
  }
  state.batchNumber++;
  return false;
}

function ensureLabelsExist(labelNames) {
  const existingLabels = GmailApp.getUserLabels().map(label => label.getName());
  for (const name of labelNames) {
    if (name && !existingLabels.includes(name)) {
      GmailApp.createLabel(name);
    }
  }
}

/**
 * Ensures all required tabs exist in the target spreadsheet, creating them if they don't.
 */
function ensureSheetTabsExist() {
  const requiredTabs = {
    "Dashboard": [],
    "Rules": ["Sender Email", "Action"],
    "Extracted Data": [],
    "Rule Suggestions": ["Sender", "Suggested Label", "Evidence", "Date Created"],
    "Historical Logs": [] // This will be populated dynamically by the logger
  };
  
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const existingSheets = ss.getSheets().map(s => s.getName());

    for (const tabName in requiredTabs) {
      if (!existingSheets.includes(tabName)) {
        const newSheet = ss.insertSheet(tabName);
        const headers = requiredTabs[tabName];
        if (headers.length > 0) {
          newSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        }
        logInfo(`Created missing spreadsheet tab: "${tabName}"`);
      }
    }
  } catch (e) {
    logError("Could not ensure spreadsheet tabs exist. Please check SPREADSHEET_ID.", e);
  }
}