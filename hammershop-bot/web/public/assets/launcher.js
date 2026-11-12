/* The launcher page: the download button, the news the admin panel published, and Hammer+ bought by card. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') node.className = props[k];
      else if (k === 'text') node.textContent = props[k];
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  };
  var api = function (path, options) {
    return fetch(path, Object.assign({ credentials: 'same-origin', headers: { accept: 'application/json' } }, options || {})).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw Object.assign(new Error(body.error || 'Coś poszło nie tak. Spróbuj ponownie.'), { status: res.status });
        return body;
      });
    });
  };
  var post = function (path, body) { return api(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }); };
  var toastTimer = null;
  function toast(text, bad) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (bad ? ' bad' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 5000);
  }
  var money = function (amount, currency) {
    try { return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: String(currency || 'eur').toUpperCase() }).format(amount / 100); } catch (e) { return (amount / 100).toFixed(2) + ' ' + currency; }
  };
  var megabytes = function (bytes) { return Math.round(bytes / 1024 / 1024) + ' MB'; };
  var httpsOnly = function (url) { return typeof url === 'string' && /^https:\/\//.test(url) ? url : null; };
  var params = new URLSearchParams(location.search);
  var session = { user: null };
  var plus = { ready: false, plans: [], currency: 'eur', authReady: false };
  var chosen = null;

  // ── The download button and the news ──
  function showRelease(release) {
    var button = $('download');
    var meta = $('download-meta');
    if (!release) {
      button.textContent = 'Już wkrótce';
      button.setAttribute('aria-disabled', 'true');
      meta.textContent = 'Launcher jest w przygotowaniu – wersja beta pojawi się tutaj. Zajrzyj na naszego Discorda, damy znać.';
      return;
    }
    button.removeAttribute('aria-disabled');
    button.textContent = 'Pobierz na Windows';
    meta.textContent = 'Wersja ' + release.version + ' (beta) · ' + megabytes(release.size) + ' · ' + new Date(release.date).toLocaleDateString('pl-PL');
  }
  function showNews(news) {
    var box = $('news');
    box.textContent = '';
    (news || []).slice(0, 6).forEach(function (n) {
      var title = el('h3', { text: n.title });
      var link = httpsOnly(n.url);
      var image = httpsOnly(n.image);
      box.appendChild(el('article', { class: 'card' + (n.pinned ? ' pinned' : '') }, [
        image ? el('img', { src: image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
        el('div', { class: 'row' }, [n.tag ? el('span', { class: 'pill', text: n.tag }) : null, n.pinned ? el('span', { class: 'pill gold', text: 'Przypięte' }) : null, el('span', { class: 'when right', text: n.date || '' })]),
        title,
        n.body ? el('p', { text: n.body }) : null,
        link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Czytaj więcej →' }) : null,
      ]));
    });
    $('aktualnosci').hidden = !box.children.length;
  }

  // ── Hammer+ ──
  function showPlans() {
    var box = $('plans');
    box.textContent = '';
    if (!plus.ready) {
      box.appendChild(el('p', { class: 'notice', text: 'Hammer+ nie jest jeszcze w sprzedaży na stronie. Kod możesz dostać od zespołu HammerShop na Discordzie.' }));
      return;
    }
    plus.plans.forEach(function (plan) {
      var buy = el('button', { class: 'btn gold', type: 'button', text: 'Kup' });
      buy.addEventListener('click', function () { choose(plan); });
      box.appendChild(el('div', { class: 'plan' }, [
        el('div', {}, [el('b', { text: plan.name }), el('div', { class: 'sub', text: plan.days ? plan.days + ' dni od zakupu' : 'Bez limitu czasu' })]),
        el('span', { class: 'price', text: money(plan.price, plus.currency) }),
        buy,
      ]));
    });
  }
  function choose(plan) {
    if (!session.user) {
      try { sessionStorage.setItem('hs_plan', plan.id); } catch (e) { /* private mode */ }
      location.href = '/api/shop/auth/start?next=launcher';
      return;
    }
    chosen = plan;
    $('nick-plan').textContent = plan.name + ' – ' + money(plan.price, plus.currency);
    $('nick-error').hidden = true;
    $('nick-dialog').showModal();
    $('nick').focus();
  }
  $('nick-cancel').addEventListener('click', function () { $('nick-dialog').close(); });
  $('nick-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!chosen) return;
    var pay = $('nick-pay');
    var error = $('nick-error');
    pay.disabled = true;
    pay.textContent = 'Sprawdzam nick…';
    error.hidden = true;
    var requestId = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    post('/api/shop/checkout', { kind: 'plus', plan: chosen.id, nick: $('nick').value.trim(), requestId: requestId })
      .then(function (r) { location.href = r.url; })
      .catch(function (err) {
        error.textContent = err.message;
        error.hidden = false;
        pay.disabled = false;
        pay.textContent = 'Przejdź do płatności';
      });
  });

  function codeCard(order, fresh) {
    var p = order.plus || {};
    var until = p.until === 0 ? 'na zawsze' : p.until ? 'do ' + new Date(p.until).toLocaleDateString('pl-PL') : '';
    var copy = el('button', { class: 'btn small', type: 'button', text: 'Kopiuj kod' });
    copy.addEventListener('click', function () {
      navigator.clipboard.writeText(p.code).then(function () { toast('Kod skopiowany. Wklej go w launcherze: Hammer+ → „Mam kod”.'); }, function () { toast('Zaznacz kod i skopiuj go ręcznie (Ctrl+C).', true); });
    });
    return el('div', { class: 'code-card' }, [
      el('div', { class: 'row' }, [el('b', { text: (fresh ? 'Gotowe! ' : '') + 'Konto ' + (p.nick || '') }), until ? el('span', { class: 'pill gold', text: until }) : null, p.code ? copy : null]),
      p.code ? el('code', { class: 'code', text: p.code }) : el('p', { class: 'muted small', text: order.delivery || 'Kod wystawi zespół HammerShop – napisz do nas na Discordzie.' }),
      fresh ? el('p', { class: 'small soft', text: 'Otwórz Hammer Launcher → Hammer+ → „Mam kod” i wklej kod. Wysłaliśmy go też w wiadomości prywatnej na Discordzie.' }) : null,
    ]);
  }
  function showCodes(freshId) {
    if (!session.user) return Promise.resolve();
    return api('/api/shop/orders').then(function (r) {
      var mine = (r.orders || []).filter(function (o) { return o.kind === 'plus' && o.status === 'paid'; });
      var list = $('my-codes-list');
      list.textContent = '';
      mine.forEach(function (o) { if (o.id !== freshId) list.appendChild(codeCard(o, false)); });
      $('my-codes').hidden = !list.children.length;
      var fresh = mine.filter(function (o) { return o.id === freshId; })[0];
      if (fresh) {
        var box = $('plus-result');
        box.textContent = '';
        box.appendChild(codeCard(fresh, true));
        box.hidden = false;
      }
    }).catch(function () { /* the list is a convenience */ });
  }

  /** Back from Stripe: is it paid? (Stripe can take a moment – asked a few times.) */
  function afterPayment() {
    var sessionId = params.get('session_id');
    if (params.get('payment') === 'cancelled') toast('Płatność anulowana – nic nie zostało pobrane.');
    if (params.get('payment') !== 'return' || !sessionId) return;
    var box = $('plus-result');
    box.textContent = '';
    box.appendChild(el('p', { class: 'notice', text: 'Sprawdzam płatność…' }));
    box.hidden = false;
    location.hash = '#plus';
    var tries = 0;
    (function check() {
      post('/api/shop/verify', { sessionId: sessionId }).then(function (r) {
        if (r.paid) return showCodes(r.order);
        if (r.status === 'pending' && ++tries < 8) return setTimeout(check, 2000);
        box.textContent = '';
        box.appendChild(el('p', { class: 'notice warn', text: 'Płatność nie została jeszcze potwierdzona. Jeśli zapłaciłeś, odśwież stronę za chwilę – kod pojawi się tutaj i na Discordzie.' }));
      }).catch(function (err) {
        box.textContent = '';
        box.appendChild(el('p', { class: 'notice bad', text: err.message }));
      });
    })();
    history.replaceState(null, '', '/launcher#plus');
  }

  // ── Start ──
  function showUser() {
    var who = $('who');
    if (!session.user) {
      $('login').hidden = !plus.authReady;
      return;
    }
    who.textContent = '';
    if (session.user.avatar) who.appendChild(el('img', { src: session.user.avatar, alt: '', referrerpolicy: 'no-referrer' }));
    who.appendChild(el('span', { text: session.user.name || session.user.username || '' }));
  }
  if (params.get('auth') === 'failed') toast('Logowanie przez Discord nie powiodło się. Spróbuj ponownie.', true);
  if (params.get('auth') === 'unavailable') toast('Logowanie przez Discord nie jest jeszcze uruchomione.', true);
  if (params.get('download') === 'none') toast('Launcher nie jest jeszcze dostępny do pobrania – już wkrótce!');

  api('/api/launcher/news').then(function (feed) { showRelease(feed.release); showNews(feed.news); }).catch(function () { showRelease(null); });
  api('/api/shop/store').then(function (store) {
    var invite = httpsOnly(store.discordUrl);
    if (invite) { $('nav-discord').href = invite; $('nav-discord').hidden = false; }
  }).catch(function () {});
  Promise.all([api('/api/shop/session').catch(function () { return { user: null }; }), api('/api/shop/plus').catch(function () { return plus; })]).then(function (r) {
    session = r[0];
    plus = r[1];
    showUser();
    showPlans();
    afterPayment();
    showCodes(null);
    // Signed in because of a "Kup" click → carry on with that plan.
    var wanted = null;
    try { wanted = sessionStorage.getItem('hs_plan'); sessionStorage.removeItem('hs_plan'); } catch (e) { /* private mode */ }
    var plan = wanted && session.user && plus.plans.filter(function (p) { return p.id === wanted; })[0];
    if (plan && params.get('connected')) { location.hash = '#plus'; choose(plan); }
  });
})();
