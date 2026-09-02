(() => {
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const DISMISS_KEY = 'atokorePwaInstallDismissedAt';
  let deferredPrompt = null;

  function installCardRecentlyDismissed() {
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return dismissedAt && Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000;
  }

  function hideInstallCard() {
    document.getElementById('pwaInstallCard')?.remove();
  }

  function dismissInstallCard() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    hideInstallCard();
  }

  function showIOSGuide() {
    const html = `
      <button class="close" onclick="closeM()">閉じる</button>
      <h2>あとこれをアプリにする</h2>
      <div class="row"><b>1</b><div class="grow">Safari下部の共有ボタン<br><span class="muted">四角から上向き矢印のマーク</span></div></div>
      <div class="row"><b>2</b><div class="grow">「ホーム画面に追加」を選ぶ</div></div>
      <div class="row"><b>3</b><div class="grow">右上の「追加」を押す</div></div>
      <p class="muted">次回からホーム画面の「あとこれ」を押すだけで、アプリのように開けます。</p>`;
    if (typeof window.openM === 'function') window.openM(html);
    else alert('Safariの共有ボタンから「ホーム画面に追加」を選び、右上の「追加」を押してください。');
  }

  async function startInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (result.outcome === 'accepted') hideInstallCard();
      return;
    }
    showIOSGuide();
  }

  function renderInstallCard() {
    if (isStandalone() || installCardRecentlyDismissed() || document.getElementById('pwaInstallCard')) return;
    if (!isIOS && !deferredPrompt) return;
    const home = document.getElementById('pg-home');
    const hero = document.getElementById('homeHero');
    if (!home || !hero) return;

    const card = document.createElement('div');
    card.id = 'pwaInstallCard';
    card.className = 'row';
    card.style.cssText = 'border-color:#c9dcff;background:#f4f8ff;margin:10px 0 14px';
    card.innerHTML = `
      <img src="./icons/icon-192.png" alt="" width="44" height="44" style="border-radius:11px;flex:0 0 auto">
      <div class="grow"><div class="name">アプリとして使えます</div><div class="meta">ホーム画面からすぐ開けます</div></div>
      <button class="btn" id="pwaInstallButton" type="button" style="white-space:nowrap">追加方法</button>
      <button class="icon ghost" id="pwaInstallDismiss" type="button" aria-label="あとで表示" style="width:32px;height:32px">×</button>`;
    hero.insertAdjacentElement('afterend', card);
    card.querySelector('#pwaInstallButton')?.addEventListener('click', startInstall);
    card.querySelector('#pwaInstallDismiss')?.addEventListener('click', dismissInstallCard);
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    renderInstallCard();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    localStorage.removeItem(DISMISS_KEY);
    hideInstallCard();
  });

  window.addEventListener('DOMContentLoaded', renderInstallCard);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' }).then(registration => {
        registration.update().catch(() => {});
      }).catch(() => {});
    });
  }
})();
