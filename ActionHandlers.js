/**
 * @fileoverview Contains functions that are executed when a user clicks a button in the Add-on UI.
 */

// =======================================================================
// Navigation Actions
// =======================================================================

/**
 * Creates a navigation object to rebuild the UI and show the homepage.
 */
function navigateToHomepage() {
  const card = buildHomepageViewCard();
  const navigation = CardService.newNavigation().updateCard(card[0]);
  return CardService.newActionResponseBuilder().setNavigation(navigation).build();
}

/**
 * Creates a navigation object to switch to the suggestions view.
 */
function navigateToSuggestionsView() {
  const card = buildSuggestionsViewCard();
  const navigation = CardService.newNavigation().updateCard(card[0]);
  return CardService.newActionResponseBuilder().setNavigation(navigation).build();
}


// =======================================================================
// Homepage Actions
// =======================================================================

/**
 * Action handler for the "RUN MANUAL CLEANUP" button on the homepage.
 * It creates a trigger to run the main function in the near future.
 */
function runManualCleanupAction() {
  ScriptApp.newTrigger('archiveAndCategorizeEmails')
    .timeBased()
    .after(10 * 1000) // 10 seconds from now
    .create();
    
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText("Manual cleanup scheduled to run shortly!"))
    .build();
}

// =======================================================================
// Suggestion View Actions
// =======================================================================

/**
 * Approves a rule suggestion, adding it to the main Rules sheet.
 * @param {Object} e The action event object.
 */
function approveRuleAction(e) {
  const params = e.parameters;
  const sender = params.sender;
  const label = params.label;
  const row = parseInt(params.row, 10);

  addRuleToSheet(sender, label);
  deleteSuggestion(row);

  // Rebuild the card to show the next suggestion
  const card = buildSuggestionsViewCard();
  const navigation = CardService.newNavigation().updateCard(card[0]);
  return CardService.newActionResponseBuilder()
    .setNavigation(navigation)
    .setNotification(CardService.newNotification().setText(`Rule for ${sender} approved!`))
    .build();
}

/**
 * Rejects a rule suggestion, removing it from the suggestions sheet.
 * @param {Object} e The action event object.
 */
function rejectRuleAction(e) {
  const params = e.parameters;
  const row = parseInt(params.row, 10);
  const sender = params.sender;
  const label = params.label;

  deleteSuggestion(row);
  
  // Cache the rejection so it's not suggested again soon
  const cache = CacheService.getScriptCache();
  cache.put(`rejected_${sender}_${label}`, 'true', 60 * 60 * 24 * 7); // Cache rejection for 7 days

  // Rebuild the card to show the next suggestion
  const card = buildSuggestionsViewCard();
  const navigation = CardService.newNavigation().updateCard(card[0]);
  return CardService.newActionResponseBuilder()
    .setNavigation(navigation)
    .setNotification(CardService.newNotification().setText(`Suggestion for ${sender} rejected.`))
    .build();
}