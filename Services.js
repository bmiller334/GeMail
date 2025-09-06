/**
 * @fileoverview Contains high-level service functions that perform the core "thinking" of the script.
 * This includes the main processing waterfall, API calls, and dashboard data retrieval.
 */

// =======================================================================
// Main Processing Waterfall & AI
// =======================================================================

function processSingleEmail(thread, messageData, state, rules) {
  const headers = messageData.payload.headers;
  const fromHeader = headers.find(h => h.name === 'From');
  const subjectHeader = headers.find(h => h.name === 'Subject');

  const sender = fromHeader ? fromHeader.value : 'Unknown Sender';
  const cleanSender = (sender.match(/<(.+)>/) || [])[1] || sender;
  const subject = subjectHeader ? subjectHeader.value : 'No Subject';

  if (applyRuleIfFound(thread, cleanSender, rules, state)) {
    state.totalProcessedCount++;
    return;
  }
  if (applyCacheIfFound(thread, cleanSender, state)) {
    state.totalProcessedCount++;
    return;
  }

  state.apiCallCounts.gemini++;
  const result = categorizeEmailWithGemini(messageData, thread);

  result.applied.forEach(label => { if (state.labelCounts[label] !== undefined) state.labelCounts[label]++; });

  thread.moveToArchive();
  state.apiCallCounts.gmail++;
  state.totalProcessedCount++;
  state.processedInBatch++;
}

function categorizeEmailWithGemini(messageData, thread) {
  let outcome = { applied: [], reasoning: "N/A" };
  const GEMINI_API_KEY = getGeminiApiKey();

  const headers = messageData.payload.headers;
  const fromHeader = headers.find(h => h.name === 'From');
  const subjectHeader = headers.find(h => h.name === 'Subject');

  const sender = fromHeader ? fromHeader.value : 'Unknown Sender';
  const cleanSender = (sender.match(/<(.+)>/) || [])[1] || sender;
  const subject = subjectHeader ? subjectHeader.value : 'No Subject';
  const body = messageData.snippet;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const prompt = getGeminiPrompt(MASTER_LABELS, sender, subject, body);
  const requestBody = { contents: [{ parts: [{ text: prompt }] }] };
  const options = { method: 'post', contentType: 'application/json', payload: JSON.stringify(requestBody), muteHttpExceptions: true };

  try {
    const response = UrlFetchApp.fetch(endpoint, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode !== 200) {
      logApiError(responseCode, responseText);
      return outcome;
    }

    const geminiData = JSON.parse(responseText);
    const rawText = geminiData.candidates[0].content.parts[0].text;
    const jsonText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const { primaryLabel, reasoning } = JSON.parse(jsonText);

    outcome.reasoning = reasoning;

    if (primaryLabel && MASTER_LABELS.includes(primaryLabel)) {
      const labelObj = GmailApp.getUserLabelByName(primaryLabel);
      if (labelObj) {
        thread.addLabel(labelObj);
        outcome.applied.push(primaryLabel);
        setCache(cleanSender, subject, primaryLabel, reasoning);
      }
    }
  } catch (e) {
    logError(`Critical Error processing Gemini response: ${e.toString()}`);
  }

  return outcome;
}


// =======================================================================
// Rule & Cache Services
// =======================================================================

function applyRuleIfFound(thread, sender, rules, state) {
  const ruleAction = rules[sender.toLowerCase()];
  if (ruleAction) {
    logInfo(`Applying rule for ${sender}: ${ruleAction}`);
    const label = GmailApp.getUserLabelByName(ruleAction);
    if (label) {
      thread.addLabel(label);
      state.apiCallCounts.gmail++;
      state.labelCounts['Via Rule']++;
      if (state.labelCounts[ruleAction] !== undefined) state.labelCounts[ruleAction]++;
    }
    thread.moveToArchive();
    state.apiCallCounts.gmail++;
    return true;
  }
  return false;
}

function getRulesFromSheet(state) {
  const cache = CacheService.getScriptCache();
  const cachedRules = cache.get('rules_cache');
  if (cachedRules) {
    return JSON.parse(cachedRules);
  }

  const rules = {};
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Rules");
    state.apiCallCounts.sheets++;
    if (!sheet || sheet.getLastRow() <= 1) { 
      return rules; 
    }
    
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    state.apiCallCounts.sheets++;
    for (const row of data) {
      const email = row[0];
      const action = row[1];
      if (email && action) {
        rules[email.toLowerCase()] = action;
      }
    }
    cache.put('rules_cache', JSON.stringify(rules), 3600); 
  } catch (e) {
    logError("Could not read rules from sheet.", e);
  }
  return rules;
}

function addRuleToSheet(sender, label) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Rules");
    sheet.appendRow([sender, label]);
    CacheService.getScriptCache().remove('rules_cache');
    logInfo(`New rule added for ${sender}.`);
  } catch (e) {
    logError(`Could not add rule for ${sender}.`, e);
  }
}

function applyCacheIfFound(thread, sender, state) {
  const cachedInfo = getCache(sender, thread.getFirstMessageSubject());
  if (cachedInfo && cachedInfo.label) {
    logInfo(`Applying cached label for ${sender}: ${cachedInfo.label}`);
    const label = GmailApp.getUserLabelByName(cachedInfo.label);
    if (label) {
      thread.addLabel(label);
      state.apiCallCounts.gmail++;
      state.labelCounts['Via Cache']++;
       if (state.labelCounts[cachedInfo.label] !== undefined) state.labelCounts[cachedInfo.label]++;
    }
    thread.moveToArchive();
    state.apiCallCounts.gmail++;
    return true;
  }
  return false;
}

function getCache(sender, subject) {
  const cache = CacheService.getScriptCache();
  const key = `${sender.toLowerCase()}|${subject.toLowerCase().substring(0,20)}`;
  const cachedValue = cache.get(key);
  return cachedValue ? JSON.parse(cachedValue) : null;
}

function setCache(sender, subject, label, reasoning) {
  const cache = CacheService.getScriptCache();
  const key = `${sender.toLowerCase()}|${subject.toLowerCase().substring(0,20)}`;
  const value = JSON.stringify({ label: label, reasoning: reasoning });
  cache.put(key, value, 21600);
}

// =======================================================================
// Add-on Dashboard & Dossier Services
// =======================================================================

function getLastRunSummary() {
  const summaryJson = PropertiesService.getScriptProperties().getProperty('lastRunSummary');
  if (summaryJson) {
    const data = JSON.parse(summaryJson);
    return {
      status: data.status,
      processed: data.processed
    };
  }
  return { status: "N/A", processed: "N/A" };
}

function getInboxStats() {
  const totalThreads = GmailApp.getInboxThreads();
  const unlabeledThreads = GmailApp.search("in:inbox -has:userlabels");
  const total = totalThreads.length;
  const remaining = unlabeledThreads.length;
  return {
    total: total,
    remaining: remaining,
    processed: total - remaining
  };
}

function getSystemHealthStats() {
  const properties = PropertiesService.getScriptProperties();
  const apiCalls = properties.getProperty('dailyApiCallCount') || '0';
  const rules = getRulesFromSheet({});
  const rulesCount = Object.keys(rules).length;
  return {
    apiCalls: parseInt(apiCalls),
    rulesCount: rulesCount
  };
}

function getSenderHistory(sender) {
  const history = { total: 0, counts: {} };
  try {
    const search = `from:"${sender}"`;
    const threads = GmailApp.search(search, 0, 100);
    history.total = threads.length;

    for (const thread of threads) {
      const labels = thread.getLabels();
      for (const label of labels) {
        const labelName = label.getName();
        if (MASTER_LABELS.includes(labelName)) {
          history.counts[labelName] = (history.counts[labelName] || 0) + 1;
        }
      }
    }
  } catch (e) {
    logError("Could not retrieve sender history.", e)
  }
  return history;
}


// =======================================================================
// Rule Suggestion Services
// =======================================================================

function generateRuleSuggestions(state) {
  const reviewLabel = '[GeMail] Needs Review';
  const threads = GmailApp.search(`label:${reviewLabel}`);
  state.apiCallCounts.gmail++;
  const correctionTallies = {};

  for (const thread of threads) {
    const message = thread.getMessages()[0];
    if (!message) continue;

    const sender = message.getFrom();
    const cleanSender = (sender.match(/<(.+)>/) || [])[1] || sender;
    const labels = thread.getLabels().map(l => l.getName());
    
    const correctedLabel = labels.find(l => l !== reviewLabel && MASTER_LABELS.includes(l));

    if (correctedLabel) {
      if (!correctionTallies[cleanSender]) {
        correctionTallies[cleanSender] = {};
      }
      correctionTallies[cleanSender][correctedLabel] = (correctionTallies[cleanSender][correctedLabel] || 0) + 1;
    }
  }

  const SUGGESTION_THRESHOLD = 3;
  for (const sender in correctionTallies) {
    for (const label in correctionTallies[sender]) {
      if (correctionTallies[sender][label] >= SUGGESTION_THRESHOLD) {
        createSuggestionInSheet(sender, label, `You've made this correction ${correctionTallies[sender][label]} times.`, state);
      }
    }
  }
}

function createSuggestionInSheet(sender, label, evidence, state) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Rule Suggestions");
    state.apiCallCounts.sheets++;
    const data = sheet.getRange("A:B").getValues();
    state.apiCallCounts.sheets++;

    const alreadyExists = data.some(row => row[0] === sender && row[1] === label);
    if (alreadyExists) return;

    const cache = CacheService.getScriptCache();
    if (cache.get(`rejected_${sender}_${label}`)) return;

    sheet.appendRow([sender, label, evidence, new Date()]);
    state.apiCallCounts.sheets++;
    logInfo(`New rule suggestion created for ${sender}.`);
  } catch(e) {
    logError("Could not create suggestion in sheet.", e);
  }
}

function getSuggestionsFromSheet() {
  const suggestions = [];
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Rule Suggestions");
    if (!sheet || sheet.getLastRow() <= 1) return suggestions;

    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    let rowNum = 2;
    for (const row of data) {
      suggestions.push({
        sender: row[0],
        label: row[1],
        evidence: row[2],
        row: rowNum++
      });
    }
  } catch(e) {
    logError("Could not read suggestions from sheet.", e);
  }
  return suggestions;
}

function getSuggestionCount() {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Rule Suggestions");
    if (!sheet) return 0;
    return sheet.getLastRow() - 1;
  } catch(e) {
    return 0;
  }
}

function deleteSuggestion(rowNumber) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName("Rule Suggestions");
    sheet.deleteRow(rowNumber);
  } catch(e) {
    logError(`Could not delete suggestion at row ${rowNumber}.`, e);
  }
}

// =======================================================================
// NEW: Historical Logging Service
// =======================================================================

/**
 * Logs a summary of a completed run to the "Historical Logs" sheet.
 * @param {Object} summary The final summary object from finalizeRun.
 */
function logHistoricalDataToSheet(summary) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Historical Logs");
    if (!sheet) {
      logError("Historical Logs sheet not found. Please create it.", null);
      return;
    }

    const staticHeaders = ["Date", "Total Processed", "Runtime (s)", "Batches", "Stop Reason"];
    const dynamicHeaders = [...MASTER_LABELS, 'Via Rule', 'Via Cache', ...Object.keys(summary.apiCallBreakdown)];
    const fullHeaders = [...staticHeaders, ...[...new Set(dynamicHeaders)]]; // Remove duplicates

    // Ensure headers exist
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(fullHeaders);
    }
    
    // Use the existing headers in the sheet to ensure data alignment
    const sheetHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    const newRow = sheetHeaders.map(header => {
      switch(header) {
        case "Date": return summary.date;
        case "Total Processed": return summary.totalProcessedCount;
        case "Runtime (s)": return summary.totalRuntimeSeconds.toFixed(2);
        case "Batches": return summary.batchNumber;
        case "Stop Reason": return summary.stopReason;
        default:
          // Check if it's a label count or an API count
          if (summary.labelCounts[header] !== undefined) {
            return summary.labelCounts[header] || 0;
          }
          if (summary.apiCallBreakdown[header] !== undefined) {
            return summary.apiCallBreakdown[header] || 0;
          }
          return ""; // Return empty for any headers not in the summary
      }
    });

    sheet.appendRow(newRow);
    logInfo("Successfully logged historical data to the sheet.");

  } catch (e) {
    logError("Could not log historical data to sheet.", e);
  }
}