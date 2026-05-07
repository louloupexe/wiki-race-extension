chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_HELPER" });
  } catch (error) {
    console.error("Impossible d'envoyer TOGGLE_HELPER :", error);
  }
});