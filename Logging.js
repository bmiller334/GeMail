/**
 * @fileoverview This file contains all logging and console output functions.
 */

function logTitleCard() {
  const titleArt = `
********************************************************************************
* GGGG  EEEE  M   M   AAA   II  L                                              *
* G     E     MM MM  A   A  II  L                                              *
* G GGG EEEE  M M M  AAAAA  II  L                                              *
* G   G E     M   M  A   A  II  L                                              *
* GGGG  EEEE  M   M  A   A  II  LLLLL                                          *
* *
* CCCC   OOO   M   M  PPPP   AAA   N   N  II  OOO   N   N                      *
* C     O   O  MM MM  P   P A   A  NN  N  II O   O  NN  N                      *
* C     O   O  M M M  PPPP  AAAAA  N N N  II O   O  N N N                      *
* C     O   O  M   M  P     A   A  N  NN  II O   O  N  NN                      *
* CCCC   OOO   M   M  P     A   A  N   N  II  OOO   N   N                      *
* *
* Powered (And Written) by The Janitor                                *
********************************************************************************`;
  Logger.log(titleArt);
}

function logStartRun(dailyApiCallCount) {
    Logger.log(`Starting run. Daily API calls used so far: ${dailyApiCallCount}`);
}

function logSummaryBox(summary) {
    const formatRow = (label, value) => ` ${label.padEnd(25)}: ${value}`;
    let summaryBox = "\n";
    summaryBox += "********************** EXECUTION SUMMARY **********************\n";
    summaryBox += `*${formatRow("Stop Reason", summary.stopReason).padEnd(58)}*\n`;
    summaryBox += `*${formatRow("Total Emails Processed", summary.totalProcessedCount).padEnd(58)}*\n`;
    summaryBox += `*${formatRow("Total Batches Run", summary.batchNumber).padEnd(58)}*\n`;
    summaryBox += `*${formatRow("Most Frequent Sender", summary.mostFrequentSender).padEnd(58)}*\n`;
    summaryBox += `*${formatRow("Average Batch Time", `${summary.averageBatchTime.toFixed(2)}s`).padEnd(58)}*\n`;
    summaryBox += `*${formatRow("Total Runtime", `${summary.totalRuntimeSeconds.toFixed(2)}s`).padEnd(58)}*\n`;
    summaryBox += `*${formatRow("Est. Daily API Quota", `~${summary.finalDailyCount} / ${API_CALL_SAFETY_LIMIT}`).padEnd(58)}*\n`;
    summaryBox += "***************************************************************\n";
    summaryBox += "* API CALL BREAKDOWN (THIS RUN)                             *\n";
    summaryBox += "***************************************************************\n";
    // THE FIX IS HERE: Loop through the new breakdown object
    for (const service in summary.apiCallBreakdown) {
      if (summary.apiCallBreakdown[service] > 0) {
        summaryBox += `*${formatRow(`- ${service}`, summary.apiCallBreakdown[service]).padEnd(58)}*\n`;
      }
    }
    summaryBox += "***************************************************************\n";
    summaryBox += "* LABEL BREAKDOWN                                           *\n";
    summaryBox += "***************************************************************\n";
    for (const label in summary.labelCounts) {
      if (summary.labelCounts[label] > 0) {
        summaryBox += `*${formatRow(label, summary.labelCounts[label]).padEnd(58)}*\n`;
      }
    }
    summaryBox += "***************************************************************";
    Logger.log(summaryBox);
}

function logInfo(message) {
    Logger.log(`--> INFO: ${message}`);
}

function logError(message, e) {
    Logger.log(`--> ERROR: ${message}. Details: ${e.toString()}`);
}

function logApiError(responseCode, responseText) {
    Logger.log(`API Error (Code: ${responseCode}): ${responseText}`);
}

function logCriticalError(e) {
    Logger.log(`CRITICAL ERROR: ${e.toString()}\n${e.stack}`);
}