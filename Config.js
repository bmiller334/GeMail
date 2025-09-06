/**
 * @fileoverview This is the central configuration file for the GeMail script.
 * All user-configurable settings, IDs, and prompts live here.
 */

// --- SECRET KEYS & IDS ---
// This section contains your private keys and unique identifiers.
const GEMINI_API_KEY = "AIzaSyAxjMBn169oZQJ2MxLI3G9HO7LYFrU6Iac";
const SPREADSHEET_ID = "1tywu3sGDICGxyPxHivwVPCt2bpHyJIhtYPUQKuWITO8";
const DRIVE_FOLDER_ID = "1IGClI04xLf7WFiZM6ojzmuNBG7erlP2r";
const LOGO_DRIVE_LOCATION_ID = "1FYbk0LF7g1Cowp86WheyyJe0MyS87M-Q";

// --- CORE LABELING SYSTEM ---
const MASTER_LABELS = [
  '[Action Required]',
  'Finance',
  'Purchases',
  'Subscriptions',
  'Promotions',
  'Social',
  'Personal',
  '[GeMail] Needs Review'
];

// --- QUOTA & PERFORMANCE SETTINGS ---
const MAX_RUNTIME_MINUTES = 5;
const MAX_THREADS_PER_RUN = 1000;
const API_CALL_SAFETY_LIMIT = 15000;
const BATCH_SIZE = 25;
const PROCESS_RECENT_MAIL = true;

// --- GEMINI AI PROMPT ---
function getGeminiPrompt(allowedLabels, sender, subjectLine, emailBody) {
  return `
You are an intelligent email assistant for a busy professional. Your goal is to categorize emails with extreme accuracy based on their true intent.

ALLOWED LABELS:
[${allowedLabels.join(', ')}]

RULES:
1.  ANALYZE INTENT: Is this email informing the user about something they already did ('Purchases')? Is it providing information they requested ('Subscriptions')? Or is it trying to get them to do something new for the sender's benefit ('Promotions')?
2.  '[Action Required]': Only for emails requiring an immediate, personal action from the user.
3.  'Promotions': This is the default for most unsolicited commercial email, including recruiter emails.
4.  '[GeMail] Needs Review': Use this label if, and ONLY IF, an email is genuinely ambiguous and does not fit any other category.

RESPONSE FORMAT:
Your response MUST be a valid JSON object with FIVE keys: "primaryLabel", "suggestedLabel", "hasImportantAttachment", "canUnsubscribe", and "reasoning".
- "primaryLabel": Your final choice from the ALLOWED LABELS.
- "suggestedLabel": Your ideal label name if none of the allowed labels fit perfectly.
- "reasoning": A brief, one-sentence explanation for your "primaryLabel" choice.

Email to Analyze:
Sender: "${sender}"
Subject: "${subjectLine}"
Body (preview): "${emailBody.substring(0, 1500)}"
`;
}