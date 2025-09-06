/**
 * @fileoverview This file contains the main orchestration logic for the automated,
 * background email processing.
 */

function archiveAndCategorizeEmails() {
  deleteTemporaryTriggers();
  logTitleCard();
  const state = initializeState();
  
  try {
    processEmailBatches(state);
  } catch (e) {
    state.stopReason = `*!*!*! Stopped due to an error: ${e.toString()} *!*!*!`;
    logCriticalError(e);
  } finally {
    finalizeRun(state);
  }
}

function workerTriggerHandler() {
  archiveAndCategorizeEmails();
}

function initializeState() {
  const properties = PropertiesService.getScriptProperties();
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Denver" });
  const lastRunDate = properties.getProperty('lastRunDate');
  let dailyApiCallCount = (today === lastRunDate) ? parseInt(properties.getProperty('dailyApiCallCount') || '0', 10) : 0;
  // If it's a new day, reset the dailyApiCallCount
  if (today !== lastRunDate) {
    properties.setProperty('lastRunDate', today);
    properties.setProperty('dailyApiCallCount', '0');
  }
  
  ensureSheetTabsExist();

  const state = {
    startTime: new Date(),
    properties: properties,
    today: today,
    dailyApiCallCount: dailyApiCallCount,
    totalProcessedCount: 0,
    labelCounts: MASTER_LABELS.reduce((acc, label) => ({ ...acc, [label]: 0 }), { 'Via Rule': 0, 'Via Cache': 0 }),
    senderCounts: {},
    apiCallCounts: {
      gemini: 0,
      gmail: 0,
      sheets: 0,
      other: 0
    },
    batchNumber: 0,
    stopReason: "Completed: No more emails to process.",
    batchTimings: [],
    lastProgressLogTime: new Date(),
    processedInBatch: 0
  };

  ensureLabelsExist(MASTER_LABELS);
  state.apiCallCounts.gmail += MASTER_LABELS.length; // Approximate cost for label checks
  logStartRun(state.dailyApiCallCount);
  return state;
}

function processEmailBatches(state) {
  let lastBatchStartTime = state.startTime;
  const rules = getRulesFromSheet(state);

  while (true) {
    if (checkSafetyLimits(state, lastBatchStartTime)) break;

    lastBatchStartTime = new Date();

    let searchQuery = "in:inbox -has:userlabels";
    if (!PROCESS_RECENT_MAIL) {
      searchQuery += " older_than:2d";
    }
    const threads = GmailApp.search(searchQuery, 0, BATCH_SIZE);
    state.apiCallCounts.gmail++;

    if (threads.length === 0) {
      state.batchNumber--;
      break;
    }

    // --- OPTIMIZATION START ---
    const messages = threads.map(thread => thread.getMessages()[0]);
    const messageIds = messages.map(message => message.getId());

    // Batch fetch all message details in one API call
    const requests = messageIds.map(id => ({
      method: "GET",
      endpoint: `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata`,
      requestBody: {}
    }));
    const responses = Gmail.Users.Messages.batchGet({ ids: messageIds, format: "full" });
    state.apiCallCounts.gmail++;
    // --- OPTIMIZATION END ---

    state.processedInBatch = 0;
    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i];
      const messageData = responses.messages[i];
      processSingleEmail(thread, messageData, state, rules);
    }
    if (threads.length < BATCH_SIZE) break;
  }
}


function finalizeRun(state) {
  const totalCallsThisRun = Object.values(state.apiCallCounts).reduce((sum, count) => sum + count, 0);
  const finalDailyCount = state.dailyApiCallCount + totalCallsThisRun;
  state.properties.setProperty('dailyApiCallCount', finalDailyCount.toString());
  
  const averageBatchTime = (state.batchTimings.length > 0) ? state.batchTimings.reduce((a, b) => a + b, 0) / state.batchTimings.length : 0;
  
  let mostFrequentSender = "N/A";
  if (Object.keys(state.senderCounts).length > 0) {
    mostFrequentSender = Object.keys(state.senderCounts).reduce((a, b) => state.senderCounts[a] > state.senderCounts[b] ? a : b);
    const count = state.senderCounts[mostFrequentSender];
    mostFrequentSender = `${mostFrequentSender} (${count} times)`;
  }
  
  const summary = {
    date: state.today, // Add date to summary for logging
    stopReason: state.stopReason,
    totalProcessedCount: state.totalProcessedCount,
    batchNumber: state.batchNumber,
    mostFrequentSender: mostFrequentSender,
    averageBatchTime: averageBatchTime,
    totalRuntimeSeconds: (new Date() - state.startTime) / 1000,
    finalDailyCount: finalDailyCount,
    labelCounts: state.labelCounts,
    apiCallBreakdown: state.apiCallCounts
  };
  
  logSummaryBox(summary);
  logHistoricalDataToSheet(summary); // <-- THE NEW FUNCTION CALL
  
  PropertiesService.getScriptProperties().setProperty('lastRunSummary', JSON.stringify({
    status: summary.stopReason,
    processed: summary.totalProcessedCount.toString(),
    timestamp: new Date().toLocaleString("en-US", { timeZone: "America/Denver" })
  }));

  generateRuleSuggestions(state);

  if (state.stopReason.includes("Time limit reached")) {
    createFollowUpTrigger();
  }
}