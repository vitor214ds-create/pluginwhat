(() => {
  import(chrome.runtime.getURL('content-main.js')).then(module => module.start()).catch(console.error);
})();
