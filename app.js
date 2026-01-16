console.log("app.js loaded");
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM ready");

  const recBtn = document.getElementById("recBtn");
  const stopBtn = document.getElementById("stopBtn");

  if (recBtn) {
    recBtn.onclick = () => console.log("REC clicked");
  }

  if (stopBtn) {
    stopBtn.onclick = () => console.log("STOP clicked");
  }
});
