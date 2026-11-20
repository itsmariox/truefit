// The drift corpus for the light-rewording mode (phase 1 step 7c). Every case is labelled with what SHOULD catch it:
//   "accept"       a good rewording: the code layer must let it through (a guard that rejects good rewrites makes the mode worthless)
//   "code"         drift the mechanical layer must catch
//   "checker-only" drift the mechanical layer CANNOT see (meaning, attribution, an implied result, a dropped qualifier); only the Checker can
// Step 8 runs the same corpus through the REAL Checker to measure how much of "checker-only" it catches, and the accept cases for false alarms.
export type RewordCase = { name: string; id: string; original: string; reworded: string; expect: "accept" | "code" | "checker-only"; why?: RegExp };
export const ORIGINALS: Record<string, string> = {
  pn1: "Grew the monthly newsletter list from 1,200 to 3,600 subscribers in 12 months by adding a gift-card sign-up offer.",
  pn2: "Built a weekly Google Analytics report for 4 store managers, replacing a manual 3-hour spreadsheet task.",
  pn3: "Planned 6 in-store promotion events a year with a £15,000 budget, finishing every one within 5% of budget.",
  pn4: "Wrote and scheduled 12 social posts a week across Instagram & Facebook, lifting engagement by 22%.",
  pb1: "Designed 30+ customer flyers and email templates in Canva, cutting turnaround from 3 days to 1.",
  pb2: "Kept the customer contact database for 800 accounts accurate and ready for quarterly campaigns.",
  pb3: "Handled customers’ questions by phone and email, resolving most without escalation.",
  syn1: "Cut report production time 4x using Excel macros.", // synthetic: a multiplier
};
const c = (name: string, id: string, reworded: string, expect: RewordCase["expect"], why?: RegExp): RewordCase => ({ name, id, original: ORIGINALS[id], reworded, expect, why });
export const CASES: RewordCase[] = [
  // ---- acceptable rewordings (22)
  c("synonym and reorder", "pn1", "Increased the monthly newsletter list from 1,200 to 3,600 subscribers over 12 months with a gift-card sign-up offer.", "accept"),
  c("an ordinary word added", "pn1", "Grew the monthly email newsletter list from 1,200 to 3,600 subscribers in 12 months by adding a gift-card sign-up offer.", "accept"),
  c("clauses reordered", "pn1", "Added a gift-card sign-up offer and grew the monthly newsletter list from 1,200 to 3,600 subscribers in 12 months.", "accept"),
  c("verb swapped to the ad's wording", "pn2", "Created a weekly Google Analytics report for 4 store managers, replacing a manual 3-hour spreadsheet task.", "accept"),
  c("ad vocabulary (reporting pack)", "pn2", "Produced a weekly Google Analytics reporting pack for 4 store managers, replacing a manual 3-hour spreadsheet task.", "accept"),
  c("result first", "pn2", "Replaced a manual 3-hour spreadsheet task with a weekly Google Analytics report for 4 store managers.", "accept"),
  c("preposition changed", "pn3", "Planned 6 in-store promotion events a year on a £15,000 budget, finishing every one within 5% of budget.", "accept"),
  c("verb phrase swapped", "pn3", "Ran planning for 6 in-store promotion events a year with a £15,000 budget, finishing every one within 5% of budget.", "accept"),
  c("two clauses joined", "pn3", "Planned 6 in-store promotion events a year with a £15,000 budget and finished every one within 5% of budget.", "accept"),
  c("preposition and order", "pn4", "Scheduled and wrote 12 social posts a week for Instagram & Facebook, lifting engagement by 22%.", "accept"),
  c("weekly for a week", "pn4", "Wrote and scheduled 12 weekly social posts across Instagram & Facebook, lifting engagement by 22%.", "accept"),
  c("result first", "pn4", "Lifted engagement by 22% by writing and scheduling 12 social posts a week across Instagram & Facebook.", "accept"),
  c("identical (nothing to reword)", "pb1", ORIGINALS.pb1, "accept"),
  c("synonyms", "pb1", "Created 30+ customer flyers and email templates in Canva, reducing turnaround from 3 days to 1.", "accept"),
  c("result first", "pb1", "Cut turnaround from 3 days to 1 by designing 30+ customer flyers and email templates in Canva.", "accept"),
  c("tightened", "pb2", "Maintained an accurate customer contact database of 800 accounts, ready for quarterly campaigns.", "accept"),
  c("records for database", "pb2", "Kept customer contact records for 800 accounts accurate and ready for quarterly campaigns.", "accept"),
  c("verb and conjunction", "pb3", "Answered customers’ questions by phone and email and resolved most without escalation.", "accept"),
  c("plain synonym", "pb3", "Handled customer questions by phone and email, resolving most without escalation.", "accept"),
  c("verb first", "pb3", "Resolved most customers’ questions by phone and email without escalation.", "accept"),
  c("multiplier kept (reduced)", "syn1", "Reduced report production time 4x using Excel macros.", "accept"),
  c("multiplier kept (with)", "syn1", "Cut report production time 4x with Excel macros.", "accept"),
  // ---- drift the code layer must catch
  c("a number changed", "pn1", "Grew the monthly newsletter list from 1,200 to 4,600 subscribers in 12 months by adding a gift-card sign-up offer.", "code", /number/),
  c("a number added", "pn2", "Built a weekly Google Analytics report for 4 store managers, replacing a manual 3-hour spreadsheet task and saving 10 hours a week.", "code", /number/),
  c("a number dropped", "pn3", "Planned 6 in-store promotion events a year, finishing every one within 5% of budget.", "code", /number/),
  c("the currency symbol changed", "pn3", "Planned 6 in-store promotion events a year with a $15,000 budget, finishing every one within 5% of budget.", "code", /number/),
  c("the percent sign lost", "pn4", "Wrote and scheduled 12 social posts a week across Instagram & Facebook, lifting engagement by 22.", "code", /number/),
  c("the plus lost (30+ became 30)", "pb1", "Designed 30 customer flyers and email templates in Canva, cutting turnaround from 3 days to 1.", "code", /number/),
  c("the multiplier lost (4x became 4)", "syn1", "Cut report production time 4 using Excel macros.", "code", /number/),
  c("the unit changed (3-hour became 3-day)", "pn2", "Built a weekly Google Analytics report for 4 store managers, replacing a manual 3-day spreadsheet task.", "code", /number/),
  c("a spelled-out number added", "pb3", "Handled customers’ questions by phone and email, resolving most without escalation within two days.", "code", /number/),
  c("a tool added (Excel)", "pn2", "Built a weekly Google Analytics and Excel report for 4 store managers, replacing a manual 3-hour spreadsheet task.", "code", /named term/),
  c("a tool dropped (Canva)", "pb1", "Designed 30+ customer flyers and email templates, cutting turnaround from 3 days to 1.", "code", /named term|word|short/),
  c("a tool from the ad added (Mailchimp)", "pb2", "Kept the customer contact database for 800 accounts accurate in Mailchimp and ready for quarterly campaigns.", "code", /named term/),
  c("an employer added", "pn1", "Grew the monthly newsletter list at Brightside Print from 1,200 to 3,600 subscribers in 12 months by adding a gift-card sign-up offer.", "code", /employer|named term/),
  c("a job title added", "pn1", "As Marketing Coordinator, grew the monthly newsletter list from 1,200 to 3,600 subscribers in 12 months by adding a gift-card sign-up offer.", "code", /role or employer|named term/),
  c("scope word: led", "pn2", "Led a weekly Google Analytics report for 4 store managers, replacing a manual 3-hour spreadsheet task.", "code", /bigger/),
  c("scope word: all", "pn3", "Planned all 6 in-store promotion events a year with a £15,000 budget, finishing every one within 5% of budget.", "code", /bigger/),
  c("scope word: end-to-end", "pn4", "Wrote and scheduled 12 social posts a week end-to-end across Instagram & Facebook, lifting engagement by 22%.", "code", /bigger/),
  c("scope word: managed", "pb2", "Managed the customer contact database for 800 accounts accurate and ready for quarterly campaigns.", "code", /bigger/),
  c("scope word: company-wide", "pb2", "Kept the customer contact database for 800 accounts accurate company-wide and ready for quarterly campaigns.", "code", /bigger/),
  c("far longer than the original", "pb3", "Handled customers’ questions by phone and email, resolving most without escalation, working carefully with colleagues and keeping notes so that the team could follow up later and improve things.", "code", /longer/),
  c("far shorter than the original (content dropped)", "pb3", "Handled questions.", "code", /shorter/),
  c("a do-not-use phrase", "pn3", "Acted as Head of Marketing and planned 6 in-store promotion events a year with a £15,000 budget, finishing every one within 5% of budget.", "code", /do-not-use/),
  c("a removed skill (Photoshop)", "pb1", "Designed 30+ customer flyers and email templates in Canva and Photoshop, cutting turnaround from 3 days to 1.", "code", /Photoshop/),
  c("a known gap claimed", "pn4", "Wrote and scheduled 12 social posts a week across Instagram & Facebook plus paid social advertising, lifting engagement by 22%.", "code", /paid social/),
  c("a residence claim", "pb3", "Manchester-based advisor who handled customers’ questions by phone and email, resolving most without escalation.", "code", /residence/),
  c("a pronoun", "pb3", "I handled customers’ questions by phone and email, resolving most without escalation.", "code", /pronoun/),
  c("a buzzword", "pb3", "Passionate about handling customers’ questions by phone and email, resolving most without escalation.", "code", /buzzword/),
  c("a forbidden character", "pb3", "<b>Handled</b> customers’ questions by phone and email, resolving most without escalation.", "code", /character/),
  c("self-praise", "pb3", "Detail-oriented in handling customers’ questions by phone and email, resolving most without escalation.", "code", /self-praise/),
  // ---- drift the code layer cannot see (only the Checker can)
  c("a larger scope without a tripwire word (across the region)", "pn2", "Built a weekly Google Analytics report for 4 store managers across the region, replacing a manual 3-hour spreadsheet task.", "checker-only"),
  c("a stronger verb without a tripwire word (mastered)", "pb3", "Mastered customers’ questions by phone and email, resolving most without escalation.", "checker-only"),
  c("a different doer (the agency)", "pn3", "Coordinated the agency’s 6 in-store promotion events a year with a £15,000 budget, finishing every one within 5% of budget.", "checker-only"),
  c("an implied result added", "pb2", "Kept the customer contact database for 800 accounts accurate and ready for quarterly campaigns, improving campaign response.", "checker-only"),
  c("a qualifier dropped (most)", "pb3", "Handled customers’ questions by phone and email, resolving questions without escalation.", "checker-only"),
];
