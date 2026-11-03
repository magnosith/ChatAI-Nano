// Ao clicar no ícone da extensão, abre o chat numa aba. Em páginas da extensão
// o Chrome libera LanguageModel.params(), temperature e topK.
chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })
})
