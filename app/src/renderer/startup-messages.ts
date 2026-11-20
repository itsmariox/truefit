// The words for start-up problems (phase 4e). STATUS: APPROVED by the owner (2026-11-17), together with the small Connect-screen labels. Any later change needs approval again. Rules every message follows:
// a short title, one to three plain sentences saying what happened and what to do next, no jargon, UK English, never an error code, a path or a file name.
export type StartupCopy = { title: string; body: string; restoreHeading?: string; noBackups?: string; freshButton?: string; freshWarningTitle?: string; freshWarning?: string; freshConfirm?: string; freshCancel?: string; restoreButton?: string };

export const STARTUP_COPY: Record<"damaged" | "too-new" | "upgrade-failed" | "failed", StartupCopy> = {
  damaged: {
    title: "Your saved data can't be opened",
    body: "The file that holds your profile and settings is damaged. Your jobs and CVs are not affected. You can go back to a saved copy, or start again with an empty profile.",
    restoreHeading: "Go back to a saved copy",
    restoreButton: "Restore this copy",
    noBackups: "There are no saved copies to go back to yet.",
    freshButton: "Start again with an empty profile",
    freshWarningTitle: "Start again?",
    freshWarning: "Your profile and settings will be empty. The damaged file is kept aside, not deleted, and your jobs and CVs stay where they are.",
    freshConfirm: "Yes, start again",
    freshCancel: "Not now",
  },
  "upgrade-failed": {
    title: "Your saved data couldn't be updated",
    body: "This version of the app tried to update your saved data and stopped before changing anything. A copy was saved first. Quit and open the app again. If it keeps happening, you can go back to a saved copy.",
    restoreHeading: "Go back to a saved copy",
    restoreButton: "Restore this copy",
    noBackups: "There are no saved copies to go back to yet.",
  },
  "too-new": {
    title: "This data was saved by a newer version",
    body: "Your saved data was made by a newer version of this app, so this version won't open it. That keeps it safe. Install the newest version of the app, then open it again.",
  },
  failed: {
    title: "The app couldn't start",
    body: "Quit and open the app again. If it keeps happening, ask for help.",
  },
};
