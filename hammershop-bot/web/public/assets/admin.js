/* The admin panel: news, the alert bar, launcher releases, Hammer+, featured servers, orders – over /api/admin/. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') node.className = props[k];
      else if (k === 'text') node.textContent = props[k];
      else if (k === 'onclick') node.addEventListener('click', props[k]);
      else node.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  function api(method, route, body) {
    var options = { method: method, credentials: 'same-origin', headers: { accept: 'application/json' } };
    if (body !== undefined) { options.headers['content-type'] = 'application/json'; options.body = JSON.stringify(body); }
    return fetch('/api/admin/' + route, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw Object.assign(new Error(data.error || 'Coś poszło nie tak. Spróbuj ponownie.'), { status: res.status });
        return data;
      });
    });
  }
  var toastTimer = null;
  function toast(text, bad) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (bad ? ' bad' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, bad ? 8000 : 4000);
  }
  var oops = function (err) { toast(err.message, true); };
  function confirmBox(title, text, yes) {
    return new Promise(function (resolve) {
      $('confirm-title').textContent = title;
      $('confirm-text').textContent = text;
      $('confirm-yes').textContent = yes || 'Usuń';
      var box = $('confirm');
      var done = function (answer) { box.close(); $('confirm-yes').onclick = null; $('confirm-no').onclick = null; resolve(answer); };
      $('confirm-yes').onclick = function () { done(true); };
      $('confirm-no').onclick = function () { done(false); };
      box.showModal();
    });
  }
  /** While the request runs the form's button is off (no double clicks). */
  function busy(form, promise) {
    var buttons = form.querySelectorAll('button');
    buttons.forEach(function (b) { b.disabled = true; });
    return promise.then(function (v) { buttons.forEach(function (b) { b.disabled = false; }); return v; }, function (err) { buttons.forEach(function (b) { b.disabled = false; }); throw err; });
  }
  var money = function (amount, currency) {
    try { return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: String(currency || 'eur').toUpperCase() }).format(amount / 100); } catch (e) { return (amount / 100).toFixed(2) + ' ' + currency; }
  };
  var when = function (ms) { return new Date(ms).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  var megabytes = function (bytes) { return (bytes / 1024 / 1024).toFixed(bytes > 10485760 ? 0 : 1) + ' MB'; };
  var validity = function (exp) { return exp === 0 ? 'na zawsze' : (exp * 1000 < Date.now() ? 'wygasł ' : 'do ') + new Date(exp * 1000).toLocaleDateString('pl-PL'); };
  var me = { level: null };
  var currency = 'eur';

  // ── Tabs ──
  var loaders = {};
  function show(tab) {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    document.querySelectorAll('.tab').forEach(function (s) { s.hidden = s.id !== 'tab-' + tab; });
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* fine */ }
    if (loaders[tab]) loaders[tab]().catch(oops);
  }
  document.querySelectorAll('.tabs button').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.tab); }); });

  // ── Pulpit ──
  function chart(id, days) {
    var box = $(id);
    box.textContent = '';
    var max = Math.max.apply(null, days.map(function (d) { return d.value; }).concat([1]));
    days.forEach(function (d) {
      var bar = el('i');
      bar.style.height = Math.round((d.value / max) * 100) + '%';
      box.appendChild(el('div', { class: 'bar', title: d.day + ': ' + d.value }, [el('em', { text: d.value ? String(d.value) : '' }), el('div', { class: 'col' }, [bar]), el('span', { text: d.day.slice(8) })]));
    });
  }
  loaders.pulpit = function () {
    return api('GET', 'overview').then(function (o) {
      currency = o.orders.currency;
      var stats = $('stats');
      stats.textContent = '';
      var stat = function (value, label, note) { stats.appendChild(el('div', { class: 'stat' }, [el('b', { text: String(value) }), el('span', { text: label }), note ? el('small', { text: note }) : null])); };
      stat(o.launches.today, 'launcherów dzisiaj', 'różne komputery, które dziś go uruchomiły');
      stat(o.playing || 0, 'gra teraz na Hammer Client', 'gracze na serwerach, z ostatnich 5 minut');
      stat(o.downloads.total30, 'pobrań w 30 dni', o.release ? 'aktualna wersja ' + o.release.version : 'brak opublikowanej wersji');
      stat(o.plus.active, 'aktywnych kont Hammer+', o.plus.plans ? 'planów w sprzedaży: ' + o.plus.plans : 'sprzedaż na stronie wyłączona');
      stat(money(o.orders.revenue30, currency), 'ze strony w 30 dni', o.orders.paid30 + ' zamówień · 7 dni: ' + money(o.orders.revenue7, currency));
      stat(o.accounts.users, 'kont na stronie', 'chmura: ' + o.accounts.cloud + ' · peleryny: ' + o.accounts.capes);
      stat(o.news, 'aktualności', o.alert ? 'komunikat: włączony' : 'komunikat: brak');
      chart('chart-launches', o.launches.days);
      chart('chart-downloads', o.downloads.days);
      var versions = $('versions');
      versions.textContent = '';
      var names = Object.keys(o.launches.versions).sort().reverse();
      names.forEach(function (v) { versions.appendChild(el('span', { class: 'pill' + (o.release && v === o.release.version ? ' ok' : ''), text: v + ' · ' + o.launches.versions[v] })); });
      if (!names.length) versions.appendChild(el('span', { class: 'muted small', text: 'Dzisiaj nikt jeszcze nie uruchomił launchera.' }));
      var missing = [];
      if (!o.setup.publicUrl) missing.push('PUBLIC_URL (adres strony)');
      if (!o.setup.auth) missing.push('DISCORD_CLIENT_SECRET (logowanie przez Discorda)');
      if (!o.setup.payments) missing.push('STRIPE_SECRET_KEY (płatności)');
      else if (!o.setup.webhook) missing.push('STRIPE_WEBHOOK_SECRET (potwierdzanie płatności także wtedy, gdy kupujący zamknie kartę)');
      if (!o.plus.ready) missing.push('HAMMER_PLUS_PRIVATE_KEY (kody Hammer+)');
      var problems = [];
      if (o.setup.invitesPaused) problems.push('Zaproszenia na serwer Discord są wstrzymane – nikt nie może dołączyć, a karta Discorda na stronie i w launcherze nie działa. Wznów je w Discordzie: Ustawienia serwera → Zaproszenia → „Wznów zaproszenia”.');
      else if (o.setup.inviteFailing) problems.push('Zaproszenie z DISCORD_INVITE_URL w pliku .env nie działa – Discord mówi, że wygasło albo zostało usunięte. Utwórz nowe (Wygasa po: Nigdy) i wpisz je w .env – albo usuń tę linię, a bot sam utworzy stałe zaproszenie.');
      if (missing.length) problems.push('Do uzupełnienia w pliku .env na serwerze: ' + missing.join(' · '));
      $('setup').hidden = !problems.length;
      $('setup').textContent = problems.join(' ');
    });
  };

  // ── Aktualności ──
  var editing = null;
  function resetNews() {
    editing = null;
    $('news-form').reset();
    $('news-count').textContent = '0';
    $('news-form-title').textContent = 'Nowa aktualność';
    $('news-save').textContent = 'Opublikuj';
    $('news-cancel').hidden = true;
    $('news-discord-row').hidden = false;
  }
  $('news-cancel').addEventListener('click', resetNews);
  $('news-body').addEventListener('input', function () { $('news-count').textContent = String($('news-body').value.length); });
  loaders.aktualnosci = function () {
    return api('GET', 'news').then(function (r) {
      var list = $('news-list');
      list.textContent = '';
      r.news.forEach(function (n) {
        list.appendChild(el('div', { class: 'item' }, [
          el('div', { class: 'row' }, [n.pinned ? el('span', { class: 'pill gold', text: 'Przypięte' }) : null, n.tag ? el('span', { class: 'pill', text: n.tag }) : null, el('span', { class: 'muted small right', text: n.date })]),
          el('div', { class: 'title', text: n.title }),
          n.body ? el('div', { class: 'body', text: n.body }) : null,
          el('div', { class: 'row' }, [
            el('button', { class: 'btn small', type: 'button', text: 'Edytuj', onclick: function () {
              editing = n.id;
              $('news-title').value = n.title; $('news-body').value = n.body; $('news-tag').value = n.tag || ''; $('news-url').value = n.url || ''; $('news-image').value = n.image || ''; $('news-pinned').checked = n.pinned;
              $('news-count').textContent = String(n.body.length);
              $('news-form-title').textContent = 'Edycja aktualności'; $('news-save').textContent = 'Zapisz zmiany'; $('news-cancel').hidden = false; $('news-discord-row').hidden = true;
              $('news-title').focus();
            } }),
            el('button', { class: 'btn small', type: 'button', text: n.pinned ? 'Odepnij' : 'Przypnij', onclick: function () { api('PUT', 'news/' + n.id, { pinned: !n.pinned }).then(loaders.aktualnosci).catch(oops); } }),
            el('button', { class: 'btn small danger', type: 'button', text: 'Usuń', onclick: function () {
              confirmBox('Usunąć aktualność?', '„' + n.title + '” zniknie z launchera i ze strony.').then(function (yes) { if (yes) api('DELETE', 'news/' + n.id).then(function () { toast('Usunięto.'); if (editing === n.id) resetNews(); return loaders.aktualnosci(); }).catch(oops); });
            } }),
            n.discord ? el('a', { class: 'small right', href: n.discord, target: '_blank', rel: 'noopener', text: 'Wiadomość na Discordzie' }) : null,
          ]),
        ]));
      });
      if (!r.news.length) list.appendChild(el('p', { class: 'empty', text: 'Nie ma jeszcze żadnej aktualności – launcher pokazuje wbudowane porady.' }));
    });
  };
  $('news-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var fields = { title: $('news-title').value, body: $('news-body').value, tag: $('news-tag').value, url: $('news-url').value, image: $('news-image').value, pinned: $('news-pinned').checked };
    var request = editing ? api('PUT', 'news/' + editing, fields) : api('POST', 'news', Object.assign(fields, { discord: $('news-discord').checked }));
    busy(event.target, request).then(function (r) {
      toast(editing ? 'Zapisano.' : r.discord ? 'Opublikowano w launcherze i na Discordzie.' : 'Opublikowano w launcherze.');
      resetNews();
      return loaders.aktualnosci();
    }).catch(oops);
  });

  // ── Komunikat ──
  var LEVEL = { info: 'Informacja', warning: 'Ostrzeżenie', critical: 'Ważne' };
  loaders.komunikat = function () {
    return api('GET', 'alert').then(function (r) {
      var box = $('alert-now');
      box.textContent = '';
      if (!r.alert) { box.appendChild(el('p', { class: 'empty', text: 'Brak komunikatu.' })); return; }
      box.appendChild(el('div', { class: 'alert-preview ' + r.alert.level, text: r.alert.text }));
      box.appendChild(el('p', { class: 'muted small', text: LEVEL[r.alert.level] + ' · ' + (r.alert.until ? 'do ' + when(r.alert.until) : 'do odwołania') + (r.alert.url ? ' · link: ' + r.alert.url : '') }));
    });
  };
  $('alert-form').addEventListener('submit', function (event) {
    event.preventDefault();
    busy(event.target, api('PUT', 'alert', { text: $('alert-text').value, level: $('alert-level').value, hours: $('alert-hours').value, url: $('alert-url').value }))
      .then(function () { toast('Komunikat jest w launcherze (u graczy najpóźniej po 10 minutach).'); return loaders.komunikat(); }).catch(oops);
  });
  $('alert-off').addEventListener('click', function () { api('DELETE', 'alert').then(function () { toast('Komunikat wyłączony.'); return loaders.komunikat(); }).catch(oops); });

  // ── Wersje launchera ──
  function option(value, label) { return el('option', { value: value, text: label }); }
  loaders.wersje = function () {
    return api('GET', 'releases').then(function (r) {
      $('releases-readonly').hidden = r.canEdit;
      $('releases-edit').hidden = !r.canEdit;
      $('max-mb').textContent = String(r.maxMb);
      diskFree = typeof r.diskFree === 'number' ? r.diskFree : null;
      $('disk-free').textContent = diskFree === null ? '' : ' Wolne miejsce na serwerze: ' + sizeText(diskFree) + '.';
      var files = $('files-list');
      var exe = $('release-file');
      var map = $('release-blockmap');
      var keepExe = exe.value;
      files.textContent = ''; exe.textContent = ''; map.textContent = '';
      map.appendChild(option('', '— brak —'));
      r.files.forEach(function (f) {
        files.appendChild(el('div', { class: 'item' }, [el('div', { class: 'row' }, [
          el('span', { class: 'mono small grow', text: f.name }), el('span', { class: 'muted small', text: megabytes(f.size) }),
          el('button', { class: 'btn small danger', type: 'button', text: 'Usuń plik', onclick: function () { api('DELETE', 'releases/file?name=' + encodeURIComponent(f.name)).then(loaders.wersje).catch(oops); } }),
        ])]));
        if (/\.exe$/.test(f.name)) exe.appendChild(option(f.name, f.name));
        else map.appendChild(option(f.name, f.name));
      });
      if (!exe.children.length) exe.appendChild(option('', '— najpierw wgraj plik .exe —'));
      if (keepExe) exe.value = keepExe;
      if (exe.selectedIndex < 0) exe.selectedIndex = 0; // the file that was chosen is published now – it left the list
      guessVersion();
      var list = $('releases-list');
      list.textContent = '';
      r.list.forEach(function (rel) {
        var actions = el('td', { class: 'nowrap' });
        if (r.canEdit && !rel.current) actions.appendChild(el('button', { class: 'btn small', type: 'button', text: 'Ustaw jako aktualną', onclick: function () {
          confirmBox('Ustawić ' + rel.version + ' jako aktualną?', 'Strona zacznie dawać do pobrania wersję ' + rel.version + '. Launchery z nowszą wersją nie cofną się same.', 'Ustaw').then(function (yes) { if (yes) api('POST', 'releases/current', { version: rel.version }).then(loaders.wersje).catch(oops); });
        } }));
        if (r.canEdit && rel.current) actions.appendChild(el('button', { class: 'btn small', type: 'button', text: 'Ukryj pobieranie', onclick: function () {
          confirmBox('Ukryć pobieranie?', 'Strona przestanie dawać launcher do pobrania, a aktualizacje się zatrzymają – do czasu ustawienia aktualnej wersji.', 'Ukryj').then(function (yes) { if (yes) api('POST', 'releases/current', { version: null }).then(loaders.wersje).catch(oops); });
        } }));
        if (r.canEdit) actions.appendChild(el('button', { class: 'btn small danger', type: 'button', text: 'Usuń', onclick: function () {
          confirmBox('Usunąć wersję ' + rel.version + '?', 'Instalator tej wersji zostanie skasowany z serwera.').then(function (yes) { if (yes) api('DELETE', 'releases/' + encodeURIComponent(rel.version)).then(function () { toast('Usunięto.'); return loaders.wersje(); }).catch(oops); });
        } }));
        list.appendChild(el('tr', {}, [
          el('td', {}, [el('b', { text: rel.version }), rel.current ? el('span', { class: 'pill ok', text: 'aktualna' }) : null, rel.signed ? el('span', { class: 'pill gold', text: 'podpisana' }) : null, rel.minVersion ? el('div', { class: 'muted small', text: 'wymaga co najmniej ' + rel.minVersion }) : null]),
          el('td', { class: 'mono small' }, [rel.file, rel.blockmap ? el('div', { class: 'muted', text: '+ blockmap' }) : null]),
          el('td', { class: 'nowrap', text: megabytes(rel.size) }), el('td', { text: String(rel.downloads) }), el('td', { class: 'nowrap', text: when(rel.at) }), actions,
        ]));
        if (rel.notes) list.appendChild(el('tr', {}, [el('td', { colspan: '6', class: 'muted small' }, [el('div', { class: 'body', text: rel.notes })])]));
      });
      if (!r.list.length) list.appendChild(el('tr', {}, [el('td', { colspan: '6', class: 'empty', text: 'Nie opublikowano jeszcze żadnej wersji – przycisk „Pobierz” na stronie jest wyłączony.' })]));
    });
  };
  function guessVersion() {
    var m = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+?)?)\.exe$/.exec($('release-file').value || '');
    if (m && !$('release-version').value) $('release-version').value = m[1];
    var map = $('release-file').value + '.blockmap';
    Array.prototype.forEach.call($('release-blockmap').options, function (o) { if (o.value === map) $('release-blockmap').value = map; });
  }
  $('release-file').addEventListener('change', function () { $('release-version').value = ''; guessVersion(); });
  // ── Uploading an installer ──
  // A file goes up in pieces, each its own request: a proxy in front of the site never sees the whole installer
  // (Cloudflare refuses a request over 100 MB – and the browser then just stops, with no error), and a broken
  // connection costs one piece. The pieces fit the line: they start small, grow while they go through quickly and
  // shrink when one is slow or fails. A piece that stalls is sent again; the server says where it really is. An upload
  // that broke off for good goes on from that place when the same file is chosen again.
  var FIRST_PIECE = 1024 * 1024;
  var MIN_PIECE = 256 * 1024;
  var MAX_PIECE = 8 * 1024 * 1024;
  var STALL_MS = 45000; // nothing leaves the browser for this long → the piece is given up on
  var ANSWER_MS = 60000; // the piece is out, the server has this long to say it has it
  var TRIES = 8;
  var diskFree = null;
  function sizeText(bytes) { return bytes >= 2048 * 1048576 ? (bytes / 1073741824).toFixed(1).replace('.', ',') + ' GB' : megabytes(bytes); }
  function speedText(perSecond) { return perSecond >= 1048576 ? (perSecond / 1048576).toFixed(1).replace('.', ',') + ' MB/s' : Math.max(1, Math.round(perSecond / 1024)) + ' KB/s'; }
  function leftText(seconds) { return seconds < 90 ? 'jeszcze ok. ' + Math.max(1, Math.round(seconds)) + ' s' : 'jeszcze ok. ' + Math.round(seconds / 60) + ' min'; }
  function uploadNote(text) { $('upload-note').textContent = text || ''; $('upload-note').hidden = !text; }
  function uploadError(text) { $('upload-error').textContent = text || ''; $('upload-error').hidden = !text; }

  function sendPiece(file, offset, length, key, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var watchdog = null;
      var sent = false;
      var over = false;
      var loaded = 0;
      var moved = Date.now();
      // Once a second the bar is told how long nothing has moved – and whether the browser or the server is waited for.
      var ticker = setInterval(function () { onProgress(offset + loaded, Math.floor((Date.now() - moved) / 1000), sent); }, 1000);
      function watch(ms) { clearTimeout(watchdog); watchdog = setTimeout(function () { xhr.abort(); }, ms); }
      function fail(message, status, serverOffset) {
        if (over) return;
        over = true;
        clearTimeout(watchdog);
        clearInterval(ticker);
        var err = new Error(message);
        err.status = status || 0;
        err.offset = serverOffset;
        reject(err);
      }
      xhr.open('PUT', '/api/admin/releases/file?name=' + encodeURIComponent(file.name) + '&offset=' + offset + '&total=' + file.size + '&key=' + encodeURIComponent(key));
      xhr.setRequestHeader('content-type', 'application/octet-stream');
      xhr.upload.onprogress = function (e) { if (!sent) watch(STALL_MS); loaded = e.loaded; moved = Date.now(); onProgress(offset + loaded, 0, sent); };
      xhr.upload.onload = function () { sent = true; moved = Date.now(); watch(ANSWER_MS); };
      xhr.onload = function () {
        var body = {};
        try { body = JSON.parse(xhr.responseText); } catch (e) { /* not JSON: a proxy's own error page */ }
        if (xhr.status >= 200 && xhr.status < 300 && (body.done || typeof body.offset === 'number')) { over = true; clearTimeout(watchdog); clearInterval(ticker); return resolve(body); }
        return fail(body.error || (xhr.status === 413 ? 'Serwer albo proxy przed nim nie przyjmuje nawet małych kawałków pliku (limit rozmiaru wysyłki).' : 'Serwer odpowiedział błędem ' + xhr.status + '.'), xhr.status || 500, body.offset);
      };
      xhr.onerror = function () { fail('Połączenie zostało zerwane w trakcie wysyłania.'); };
      xhr.onabort = function () {
        fail(sent ? 'Kawałek wyszedł z przeglądarki, ale serwer nie potwierdził go przez ' + ANSWER_MS / 1000 + ' s.' : 'Przez ' + STALL_MS / 1000 + ' s żadne dane nie wyszły z przeglądarki – połączenie stoi.');
      };
      watch(STALL_MS);
      xhr.send(file.slice(offset, offset + length));
    });
  }

  function upload(file) {
    if (!file.size) return Promise.reject(new Error('Plik jest pusty.'));
    var key = file.size + '-' + (file.lastModified || 0);
    var offset = 0;
    var piece = FIRST_PIECE;
    var failures = 0;
    var marks = []; // [time, bytes on their way or there] – the speed is read off the last ten seconds
    function show(bytes, idle, sent) {
      var now = Date.now();
      marks.push([now, bytes]);
      while (marks.length > 2 && now - marks[0][0] > 10000) marks.shift();
      var span = (now - marks[0][0]) / 1000;
      var speed = span >= 1 && bytes > marks[0][1] ? (bytes - marks[0][1]) / span : 0;
      var pct = Math.min(100, Math.floor((bytes / file.size) * 100));
      $('upload-bar').style.width = pct + '%';
      var more = '';
      if (idle >= 4) more = ' · ' + (sent ? 'czekam na potwierdzenie serwera' : 'dane nie wychodzą z przeglądarki') + ' (' + idle + ' s)';
      else if (speed && bytes < file.size) more = ' · ' + speedText(speed) + ' · ' + leftText((file.size - bytes) / speed);
      $('upload-text').textContent = file.name + ' – ' + pct + '% (' + megabytes(bytes) + ' z ' + megabytes(file.size) + ')' + more;
    }
    function next() {
      var length = Math.min(piece, file.size - offset);
      var started = Date.now();
      show(offset);
      return sendPiece(file, offset, length, key, show).then(function (r) {
        var took = Date.now() - started;
        if (failures) uploadNote('');
        failures = 0;
        if (took < 4000) piece = Math.min(piece * 2, MAX_PIECE);
        else if (took > 20000) piece = Math.max(Math.floor(piece / 2), MIN_PIECE);
        if (r.done) { show(file.size); return r; }
        offset = r.offset;
        return next();
      }, function (err) {
        // Worth another try: no answer at all, a server or proxy hiccup, or the server being somewhere else in the file.
        var again = !err.status || (err.status >= 500 && err.status !== 507) || err.status === 408 || err.status === 429 || (err.status === 409 && typeof err.offset === 'number');
        failures += 1;
        if (typeof err.offset === 'number') offset = Math.min(err.offset, file.size);
        if (!again || failures >= TRIES) { err.at = offset; throw err; }
        piece = Math.max(Math.floor(piece / 2), MIN_PIECE);
        marks = [];
        uploadNote(err.message + ' Ponawiam mniejszym kawałkiem – próba ' + (failures + 1) + ' z ' + TRIES + '…');
        return new Promise(function (go) { setTimeout(go, Math.min(1000 * Math.pow(2, failures - 1), 15000)); }).then(next);
      });
    }
    // The same file chosen again after an upload that broke off: the server still has its beginning.
    return api('GET', 'releases/file?name=' + encodeURIComponent(file.name) + '&total=' + file.size + '&key=' + encodeURIComponent(key))
      .catch(function () { return { offset: 0 }; })
      .then(function (r) {
        offset = Math.min(Number(r.offset) || 0, file.size);
        if (offset) uploadNote('Serwer ma już ' + megabytes(offset) + ' tego pliku z poprzedniej próby – wysyłam resztę.');
        return next();
      });
  }

  $('release-files').addEventListener('change', function () {
    var files = Array.prototype.slice.call($('release-files').files);
    if (!files.length) return;
    uploadError('');
    uploadNote('');
    var all = files.reduce(function (sum, f) { return sum + f.size; }, 0);
    if (diskFree !== null && all > diskFree) {
      uploadError('Na dysku serwera jest za mało miejsca: wolne ' + sizeText(diskFree) + ', a wybrane pliki mają ' + sizeText(all) + '. Usuń stare pliki albo zwiększ dysk.');
      $('release-files').value = '';
      return;
    }
    $('upload-progress').hidden = false;
    $('release-files').disabled = true;
    files.reduce(function (chain, file) {
      return chain.then(function () {
        $('upload-bar').style.width = '0';
        return upload(file).catch(function (err) { err.file = file; throw err; });
      });
    }, Promise.resolve())
      .then(function () { uploadNote(''); toast(files.length > 1 ? 'Pliki wgrane.' : 'Plik wgrany.'); })
      .catch(function (err) {
        // What went wrong stays on the screen (a toast is gone in a few seconds) – with where it stopped and why.
        var file = err.file || files[0];
        uploadNote('');
        uploadError('Nie udało się wgrać pliku ' + file.name + ' – stanęło na ' + megabytes(err.at || 0) + ' z ' + megabytes(file.size) + '. ' + err.message + (err.status && err.message.indexOf(String(err.status)) < 0 ? ' (kod ' + err.status + ')' : '')
          + (err.at ? ' Wybierz ten sam plik jeszcze raz – wysyłanie ruszy od miejsca, w którym stanęło.' : ''));
        toast('Wgrywanie nie powiodło się – szczegóły pod paskiem.', true);
      })
      .then(function () { $('upload-progress').hidden = true; $('release-files').disabled = false; $('release-files').value = ''; return loaders.wersje(); });
  });
  $('release-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var version = $('release-version').value.trim();
    confirmBox('Opublikować wersję ' + version + '?', 'Wszystkie zainstalowane launchery pobiorą ten plik i zaktualizują się do niego. Upewnij się, że to właściwy, przetestowany instalator.', 'Opublikuj').then(function (yes) {
      if (!yes) return null;
      return busy(event.target, api('POST', 'releases', {
        version: version, file: $('release-file').value, blockmap: $('release-blockmap').value, notes: $('release-notes').value,
        minVersion: $('release-min').value.trim(), signature: $('release-signature').value.trim(), discord: $('release-discord').checked,
      })).then(function () { toast('Wersja ' + version + ' jest opublikowana.'); event.target.reset(); return loaders.wersje(); });
    }).catch(oops);
  });

  // ── Hammer+ ──
  function planRow(plan) {
    var row = el('div', { class: 'plan-row' }, [
      el('label', {}, ['Nazwa', el('input', { type: 'text', maxlength: '60', required: '', value: plan.name || '', 'data-k': 'name', placeholder: 'np. Hammer+ na 30 dni' })]),
      el('label', {}, ['Dni (0 = na zawsze)', el('input', { type: 'number', min: '0', max: '3650', step: '1', required: '', value: String(plan.days == null ? 30 : plan.days), 'data-k': 'days' })]),
      el('label', {}, ['Cena (' + currency.toUpperCase() + ')', el('input', { type: 'number', min: '0.5', step: '0.01', required: '', value: plan.price ? (plan.price / 100).toFixed(2) : '', 'data-k': 'price', placeholder: '15.00' })]),
      el('button', { class: 'btn small danger', type: 'button', text: 'Usuń', onclick: function () { row.remove(); } }),
    ]);
    row.dataset.id = plan.id || '';
    return row;
  }
  loaders.plus = function () {
    return api('GET', 'plus').then(function (r) {
      currency = r.currency;
      $('plus-setup').hidden = r.ready;
      $('plus-setup').textContent = r.ready ? '' : 'Hammer+ nie jest jeszcze skonfigurowany: na serwerze uruchom „npm run plus-key”, wklej wypisaną linię HAMMER_PLUS_PRIVATE_KEY=… do pliku .env i uruchom bota ponownie.';
      var rows = $('plans-rows');
      rows.textContent = '';
      r.plans.forEach(function (p) { rows.appendChild(planRow(p)); });
      $('plans-form').querySelectorAll('input,button').forEach(function (n) { n.disabled = !r.canEdit; });
      $('plans-note').textContent = r.canEdit ? (r.plans.length ? '' : 'Sprzedaż na stronie jest wyłączona – dodaj pierwszy plan.') : 'Cennik zmienia tylko właściciel serwera.';
      var list = $('grants-list');
      list.textContent = '';
      r.grants.forEach(function (g) {
        list.appendChild(el('tr', {}, [el('td', { class: 'mono', text: g.nick }), el('td', { text: validity(g.exp) }), el('td', { class: 'muted', text: g.source === 'website' ? 'kupiony na stronie' : g.source === 'referral' ? 'nagroda za polecenie' : 'wystawiony ręcznie' }), el('td', { class: 'nowrap muted', text: when(g.at) })]));
      });
      if (!r.grants.length) list.appendChild(el('tr', {}, [el('td', { colspan: '4', class: 'empty', text: 'Nie wystawiono jeszcze żadnego kodu.' })]));
      return loadReferrals();
    });
  };
  // „Zaproś znajomego”: the totals and who brought the most people.
  function loadReferrals() {
    return api('GET', 'referrals').then(function (r) {
      var totals = $('ref-totals');
      totals.textContent = '';
      [[r.links, 'linków polecających'], [r.invited, 'poleconych osób'], [r.downloaded, 'z nich pobrało launcher'], [r.bought, 'z nich kupiło Hammer+'], [r.earned, 'dni Hammer+ w nagrodach', r.balance ? 'czeka na odebranie: ' + r.balance : null]].forEach(function (x) {
        totals.appendChild(el('div', { class: 'stat' }, [el('b', { text: String(x[0]) }), el('span', { text: x[1] }), x[2] ? el('small', { text: x[2] }) : null]));
      });
      var top = $('ref-top');
      top.textContent = '';
      r.top.forEach(function (t) {
        top.appendChild(el('tr', {}, [el('td', {}, [t.name || '—', el('div', { class: 'muted small mono', text: t.id })]), el('td', { text: String(t.invited) }), el('td', { text: String(t.downloaded) }), el('td', { text: String(t.bought) }), el('td', { text: String(t.earned) }), el('td', { text: String(t.balance) })]));
      });
      if (!r.top.length) top.appendChild(el('tr', {}, [el('td', { colspan: '6', class: 'empty', text: 'Nikt jeszcze nie przyszedł z linku polecającego.' })]));
    });
  }
  $('plan-add').addEventListener('click', function () { $('plans-rows').appendChild(planRow({})); });
  $('plans-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var plans = Array.prototype.map.call($('plans-rows').children, function (row) {
      var get = function (k) { return row.querySelector('[data-k="' + k + '"]').value; };
      return { id: row.dataset.id || undefined, name: get('name'), days: Number(get('days')), price: Math.round(Number(get('price').replace(',', '.')) * 100) };
    });
    busy(event.target, api('PUT', 'plus/plans', { plans: plans })).then(function () { toast(plans.length ? 'Cennik zapisany – plany są na stronie launchera.' : 'Sprzedaż Hammer+ na stronie wyłączona.'); return loaders.plus(); }).catch(oops);
  });
  $('grant-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var box = $('grant-result');
    box.hidden = true;
    busy(event.target, api('POST', 'plus/grant', { nick: $('grant-nick').value.trim(), days: Number($('grant-days').value) })).then(function (r) {
      box.textContent = '';
      box.appendChild(el('p', { class: 'notice ok', text: 'Kod dla konta ' + r.record.nick + ' – ważny ' + validity(r.record.exp) + '. Wyślij go graczowi: wpisuje się go w launcherze, Hammer+ → „Mam kod”.' }));
      box.appendChild(el('code', { class: 'code', text: r.code }));
      box.appendChild(el('div', { class: 'row' }, [el('button', { class: 'btn small', type: 'button', text: 'Kopiuj kod', onclick: function () { navigator.clipboard.writeText(r.code).then(function () { toast('Skopiowano.'); }, function () { toast('Zaznacz kod i skopiuj ręcznie.', true); }); } })]));
      box.hidden = false;
      return loaders.plus();
    }).catch(oops);
  });
  $('check-form').addEventListener('submit', function (event) {
    event.preventDefault();
    busy(event.target, api('POST', 'plus/check', { code: $('check-code').value })).then(function (r) {
      var box = $('check-result');
      box.textContent = '';
      box.appendChild(el('p', { class: 'notice ' + (r.valid ? 'ok' : 'bad'), text: r.valid ? 'Kod działa' + (r.nick ? ' – konto ' + r.nick : '') + ', ważny ' + validity(r.exp) + '.' : (r.message || 'Ten kod nie działa.') + (r.nick ? ' (konto ' + r.nick + ')' : '') }));
      box.hidden = false;
    }).catch(oops);
  });

  // ── Polecane serwery ──
  loaders.serwery = function () {
    return api('GET', 'featured').then(function (r) {
      var list = $('servers-list');
      list.textContent = '';
      r.servers.forEach(function (s) {
        list.appendChild(el('div', { class: 'item' }, [
          el('div', { class: 'row' }, [el('span', { class: 'title grow', text: s.name }), el('span', { class: 'mono small soft', text: s.address })]),
          el('div', { class: 'body', text: s.description }),
          el('div', { class: 'row' }, [].concat(
            [s.mc ? el('span', { class: 'pill', text: s.mc }) : null, s.loader ? el('span', { class: 'pill', text: s.loader }) : null],
            (s.tags || []).map(function (t) { return el('span', { class: 'pill', text: t }); }),
            [el('button', { class: 'btn small danger right', type: 'button', text: 'Usuń', onclick: function () {
              confirmBox('Usunąć serwer z polecanych?', s.name + ' (' + s.address + ') zniknie z launchera.').then(function (yes) { if (yes) api('DELETE', 'featured/' + encodeURIComponent(s.id)).then(loaders.serwery).catch(oops); });
            } })]
          )),
        ]));
      });
      if (!r.servers.length) list.appendChild(el('p', { class: 'empty', text: 'Lista jest pusta – w launcherze nie ma karty „Polecane serwery”.' }));
    });
  };
  $('server-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var v = function (id) { return $(id).value.trim(); };
    busy(event.target, api('POST', 'featured', { name: v('server-name'), address: v('server-address'), description: v('server-description'), mc: v('server-mc'), loader: v('server-loader'), tags: v('server-tags'), icon: v('server-icon'), pack: v('server-pack') }))
      .then(function () { toast('Serwer dodany do polecanych.'); event.target.reset(); return loaders.serwery(); }).catch(oops);
  });

  // ── Zamówienia ──
  var STATUS = { paid: ['Opłacone', 'ok'], pending: ['Czeka na płatność', 'warn'], expired: ['Wygasło', ''], failed: ['Nieudane', 'bad'] };
  loaders.zamowienia = function () {
    return api('GET', 'orders').then(function (r) {
      var list = $('orders-list');
      list.textContent = '';
      r.orders.forEach(function (o) {
        var st = STATUS[o.status] || [o.status, ''];
        list.appendChild(el('tr', {}, [
          el('td', { class: 'mono small', text: o.id }),
          el('td', {}, [o.user.name || '—', el('div', { class: 'muted small mono', text: o.user.id })]),
          el('td', {}, o.items.map(function (i) { return el('div', { text: (i.quantity > 1 ? i.quantity + '× ' : '') + i.name }); })),
          el('td', { class: 'nowrap', text: money(o.amount, o.currency) }),
          el('td', {}, [el('span', { class: 'pill ' + st[1], text: st[0] }), o.status === 'paid' ? el('div', { class: 'muted small', text: o.delivered ? 'dostarczone' : 'czeka na dostawę' }) : null]),
          el('td', { class: 'nowrap muted small', text: when(o.paidAt || o.created) }),
          el('td', {}, [o.ticketUrl ? el('a', { class: 'btn small', href: o.ticketUrl, target: '_blank', rel: 'noopener', text: 'Ticket' }) : null]),
        ]));
      });
      if (!r.orders.length) list.appendChild(el('tr', {}, [el('td', { colspan: '7', class: 'empty', text: 'Nie ma jeszcze zamówień ze strony.' })]));
    });
  };

  // ── Start: who is this? ──
  api('GET', 'me').then(function (r) {
    me = r;
    var who = $('who');
    if (r.user.avatar) who.appendChild(el('img', { src: r.user.avatar, alt: '', referrerpolicy: 'no-referrer' }));
    who.appendChild(el('span', { text: r.user.name }));
    who.appendChild(el('span', { class: 'pill ' + (r.level === 'owner' ? 'gold' : ''), text: r.level === 'owner' ? 'Właściciel' : 'Administrator' }));
    $('gate').hidden = true;
    $('panel').hidden = false;
    var wanted = location.hash.slice(1);
    show(loaders[wanted] ? wanted : 'pulpit');
  }).catch(function (err) {
    $('gate-text').textContent = err.status === 401 ? 'Zaloguj się kontem Discord, które jest właścicielem albo administratorem naszego serwera Discord.' : err.message;
    $('gate-login').hidden = err.status !== 401;
    if (new URLSearchParams(location.search).get('auth') === 'unavailable') $('gate-text').textContent = 'Logowanie przez Discorda nie jest jeszcze uruchomione: ustaw PUBLIC_URL i DISCORD_CLIENT_SECRET w pliku .env.';
  });
})();
