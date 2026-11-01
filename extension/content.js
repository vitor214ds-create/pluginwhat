// Capture the initial navigation before WhatsApp's router can change the URL.
(() => {
  const initialUrl = location.href;
  import(chrome.runtime.getURL('content-main.js')).then(module => module.start(initialUrl)).catch(console.error);
})();
