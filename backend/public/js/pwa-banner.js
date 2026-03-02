(function () {
  var banner = document.getElementById("installBanner");
  if (!banner) return;

  var installBtn = document.getElementById("installBtn");
  var dismissBtn = document.getElementById("installDismiss");
  var deferredPrompt = null;

  var isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  if (isStandalone) return;

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    banner.style.display = "flex";
  });

  if (installBtn) {
    installBtn.addEventListener("click", function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === "accepted") {
          localStorage.setItem("pwaInstalled", "true");
        }
      }).finally(function () {
        deferredPrompt = null;
        banner.style.display = "none";
      });
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener("click", function () {
      banner.style.display = "none";
    });
  }
})();
