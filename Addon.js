/**
 * @fileoverviec This file contains the UI-building logic for the GeMail Companion Add-on.
 */

const ADDON_LOGO_URL = "[https://drive.google.com/file/d/1ahnvgljeacHRvEsdpP_KRieN4Tnb1iIa/view?usp=sharing](https://drive.google.com/file/d/1ahnvgljeacHRvEsdpP_KRieN4Tnb1iIa/view?usp=sharing)";

/**
 * The entry point for the Gmail Add-on. Determines whether to show the homepage or email view.
 * @param {Object} e The event object from Gmail.
 * @return {Card[]} An array of Card objects to display in the sidebar.
 */
function buildAddonCard(e) {
  // Check if the add-on was opened from the suggestions navigation
  const isSuggestionsView = e && e.parameters && e.parameters.view === 'suggestions';

  if (isSuggestionsView) {
    return buildSuggestionsViewCard();
  } else if (e && e.gmail && e.gmail.messageId) {
    return buildEmailViewCard(e);
  } else {
    return buildHomepageViewCard();
  }
}

/**
 * Builds the card for the Homepage (inbox) view.
 */
function buildHomepageViewCard() {
  const card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle("GeMail Mission Control").setImageUrl(ADDON_LOGO_URL));

  // Panel 1: Last Run Summary
  const summarySection = CardService.newCardSection().setHeader("Last Automated Run");
  const lastRunData = getLastRunSummary();
  summarySection.addWidget(CardService.newKeyValue().setTopLabel("Status").setContent(lastRunData.status));
  summarySection.addWidget(CardService.newKeyValue().setTopLabel("Emails Processed").setContent(lastRunData.processed));
  card.addSection(summarySection);

  // Panel 2: Inbox Zero-Down Progress Bar
  const inboxStatusSection = CardService.newCardSection().setHeader("Inbox Status");
  const stats = getInboxStats();
  const percentage = stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 100;
  const progressBar = `[${'█'.repeat(Math.round(percentage / 10))}${'░'.repeat(10 - Math.round(percentage / 10))}]`;
  inboxStatusSection.addWidget(CardService.newKeyValue()
    .setTopLabel(`Inbox Processed: ${percentage}%`)
    .setContent(progressBar));
  inboxStatusSection.addWidget(CardService.newTextParagraph()
    .setText(`<i>${stats.processed} / ${stats.total} categorized (${stats.remaining} remaining)</i>`));
  card.addSection(inboxStatusSection);

  // Panel 3: System Health
  const healthSection = CardService.newCardSection().setHeader("System Health");
  const healthStats = getSystemHealthStats();
  healthSection.addWidget(CardService.newKeyValue().setTopLabel("Daily API Calls").setContent(`${healthStats.apiCalls} / ${API_CALL_SAFETY_LIMIT}`));
  healthSection.addWidget(CardService.newKeyValue().setTopLabel("Defined Rules").setContent(healthStats.rulesCount));
  card.addSection(healthSection);
  
  // NEW: Panel for Rule Suggestions
  const suggestionCount = getSuggestionCount();
  if (suggestionCount > 0) {
    const suggestionsSection = CardService.newCardSection().setHeader("Training Assistant");
    const suggestionsNavAction = CardService.newAction().setFunctionName('navigateToSuggestionsView');
    suggestionsSection.addWidget(CardService.newButtonSet().addButton(
      CardService.newTextButton().setText(`Review Rule Suggestions (${suggestionCount})`).setOnClickAction(suggestionsNavAction)
    ));
    card.addSection(suggestionsSection);
  }

  // Panel 4: Manual Control
  const controlSection = CardService.newCardSection().setHeader("Manual Control");
  const runAction = CardService.newAction().setFunctionName('runManualCleanupAction');
  controlSection.addWidget(CardService.newButtonSet().addButton(
    CardService.newTextButton().setText("RUN MANUAL CLEANUP").setOnClickAction(runAction)
  ));
  card.addSection(controlSection);


  return [card.build()];
}

/**
 * Builds the card for the contextual (single email) view.
 */
function buildEmailViewCard(e) {
  const messageId = e.gmail.messageId;
  const message = GmailApp.getMessageById(messageId);
  const thread = message.getThread();
  const sender = message.getFrom();
  const cleanSender = (sender.match(/<(.+)>/) || [])[1] || sender;

  const card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader()
    .setTitle("GeMail Companion")
    .setImageUrl(ADDON_LOGO_URL)
    .setSubtitle("Contextual Email View"));

  // --- "Why" Engine & Current Status Section ---
  const analysisSection = CardService.newCardSection().setHeader("Email Analysis");
  const labels = thread.getLabels().map(label => label.getName());
  const masterLabelsApplied = labels.filter(l => MASTER_LABELS.includes(l));
  const cachedInfo = getCache(cleanSender, message.getSubject());

  if (masterLabelsApplied.length > 0) {
    analysisSection.addWidget(CardService.newKeyValue()
      .setTopLabel("Current GeMail Category")
      .setContent(masterLabelsApplied.join(', ')));
    if (cachedInfo && cachedInfo.reasoning) {
        analysisSection.addWidget(CardService.newTextParagraph().setText(`<i><b>Reasoning:</b> ${cachedInfo.reasoning}</i>`));
    }
  } else {
    analysisSection.addWidget(CardService.newKeyValue().setTopLabel("Status").setContent("Not yet categorized."));
  }
  card.addSection(analysisSection);

  // --- Sender Dossier Section ---
  const dossierSection = CardService.newCardSection().setHeader("Sender Dossier");
  const history = getSenderHistory(cleanSender);
  let dossierText = `Found **${history.total}** previous emails from this sender.\n`;
  for (const label in history.counts) {
      dossierText += ` • ${label}: **${history.counts[label]}**\n`;
  }
  dossierSection.addWidget(CardService.newTextParagraph().setText(dossierText));
  card.addSection(dossierSection);

  // --- Actions Section ---
  const actionsSection = CardService.newCardSection().setHeader("Actions");
  // ... (Buttons for recategorize, create rule, etc. would go here)
  card.addSection(actionsSection);

  return [card.build()];
}

/**
 * Builds the interactive card for reviewing rule suggestions.
 */
function buildSuggestionsViewCard() {
  const card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader()
    .setTitle("Rule Suggestions")
    .setSubtitle("Train your assistant"));

  const suggestions = getSuggestionsFromSheet();

  if (suggestions.length === 0) {
    const section = CardService.newCardSection();
    section.addWidget(CardService.newTextParagraph().setText("No suggestions to review. Good job!"));
    card.addSection(section);
  } else {
    // Display one suggestion at a time
    const suggestion = suggestions[0]; // suggestion object is {sender, label, evidence, row}
    const section = CardService.newCardSection()
      .setHeader(`Suggestion ${suggestion.row -1}/${suggestions.length + suggestion.row - 2 }`); // A bit of math to show progress

    const suggestionText = `Should emails from **${suggestion.sender}** always be labeled as **${suggestion.label}**?`;
    section.addWidget(CardService.newTextParagraph().setText(suggestionText));
    section.addWidget(CardService.newTextParagraph().setText(`<i>(Evidence: ${suggestion.evidence})</i>`));

    // Approve Button
    const approveAction = CardService.newAction()
      .setFunctionName('approveRuleAction')
      .setParameters({
        sender: suggestion.sender,
        label: suggestion.label,
        row: suggestion.row.toString()
      });
    const approveButton = CardService.newTextButton().setText("Approve").setOnClickAction(approveAction);

    // Reject Button
    const rejectAction = CardService.newAction()
      .setFunctionName('rejectRuleAction')
      .setParameters({
        row: suggestion.row.toString(),
        sender: suggestion.sender, // Pass sender to cache rejection
        label: suggestion.label
      });
    const rejectButton = CardService.newTextButton().setText("Reject").setOnClickAction(rejectAction);

    section.addWidget(CardService.newButtonSet().addButton(approveButton).addButton(rejectButton));
    card.addSection(section);
  }
  
  // Add a back button
  const backAction = CardService.newAction().setFunctionName('navigateToHomepage');
  const backButton = CardService.newTextButton().setText("Back to Dashboard").setOnClickAction(backAction);
  card.setFixedFooter(CardService.newFixedFooter().setPrimaryButton(backButton));

  return [card.build()];
}
