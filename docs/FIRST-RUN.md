# Opening the app for the first time

Truefit is not signed by Apple yet, so macOS stops it the first time with a message like "Truefit cannot be opened because Apple cannot check it for malicious software". That is expected. To open it once:

1. Drag **Truefit** into your **Applications** folder.
2. Double-click it. When macOS warns you, click **Done** (do not move it to the Bin).
3. Open **System Settings → Privacy & Security**. Scroll down to the message about Truefit and click **Open Anyway**.
4. Enter your Mac password if asked, then click **Open** in the next box.

From then on it opens normally. If the app says it is damaged, open **Terminal** and run `xattr -dr com.apple.quarantine /Applications/Truefit.app`, then try again.

Only do this for a copy you got from the person or place you trust.

When you first connect your Claude subscription, your browser opens so you can approve it. If you use an API key instead, paste it on the same screen; it is checked with one tiny request and stored encrypted. To use OpenAI instead, choose OpenAI on the same screen: "Continue with ChatGPT" opens your browser to approve using your ChatGPT plan, or paste an OpenAI API key.
