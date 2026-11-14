/* The admin panel: news, Discord announcements, the alert bar, launcher releases, Hammer+, featured servers, orders – over /api/admin/. */
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

  // ── Ogłoszenia: a card on #📢 ogłoszenia, with a preview that looks like Discord ──
  var ann = { info: null, limits: { title: 120, text: 3500, label: 80, url: 500 }, imageTimer: null, brand: $('ann-bot').textContent };
  var annKind = function (id) { return ((ann.info && ann.info.kinds) || []).filter(function (k) { return k.id === id; })[0] || null; };
  var annPing = function () { var c = document.querySelector('input[name="ann-ping"]:checked'); return c ? c.value : 'none'; };
  var annChosenKind = function () { var c = document.querySelector('input[name="ann-kind"]:checked'); return c ? c.value : 'ogloszenie'; };
  var isHttps = function (v) { return /^https:\/\/[^\s/]+\.[^\s]+$/i.test(v); };
  function people(n) { var last = n % 10, tens = n % 100; return n + ' ' + (n === 1 ? 'osoba' : last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? 'osoby' : 'osób'); }

  // Discord's markdown, as much as an announcement uses – built as elements, the text never becomes HTML.
  // (_kursywa_ needs no letter right before it – matched as a group, not a lookbehind, which older Safari can't parse)
  var INLINE = /(`+)([^`][\s\S]*?)\1|\|\|([\s\S]+?)\|\||\*\*([\s\S]+?)\*\*(?!\*)|__([\s\S]+?)__(?!_)|\*(?=\S)([\s\S]*?\S)\*(?!\*)|(^|[^A-Za-z0-9_])_(?=[^\s_])([\s\S]*?\S)_(?![A-Za-z0-9_])|~~([\s\S]+?)~~|\[([^\]\n]+)\]\(<?(https?:\/\/[^\s<>()]+)>?\)|(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/;
  function inline(text, parent) {
    while (text) {
      var m = INLINE.exec(text);
      if (!m) { parent.appendChild(document.createTextNode(text)); return; }
      var before = text.slice(0, m.index) + (m[8] != null ? m[7] : '');
      if (before) parent.appendChild(document.createTextNode(before));
      var node;
      var link = function (href) { return el('a', { href: href, target: '_blank', rel: 'noopener noreferrer' }); };
      if (m[1]) node = el('code', { class: 'dc-code', text: m[2] });
      else if (m[3] != null) { node = el('span', { class: 'dc-spoiler' }); inline(m[3], node); }
      else if (m[4] != null) { node = el('strong'); inline(m[4], node); }
      else if (m[5] != null) { node = el('u'); inline(m[5], node); }
      else if (m[6] != null || m[8] != null) { node = el('em'); inline(m[6] != null ? m[6] : m[8], node); }
      else if (m[9] != null) { node = el('s'); inline(m[9], node); }
      else if (m[10] != null) { node = link(m[11]); inline(m[10], node); }
      else { node = link(m[12]); node.textContent = m[12]; }
      parent.appendChild(node);
      text = text.slice(m.index + m[0].length);
    }
  }
  /** One line: a heading, small text, a list item or plain text – into box (lists continue across lines). */
  function mdLine(line, box, state) {
    var h = /^(#{1,3}) +(\S.*)$/.exec(line);
    var item = /^( *)(?:[-*]|(\d{1,3})\.) +(\S.*)$/.exec(line);
    if (!item) state.list = null;
    if (h) { var head = el('h' + h[1].length); inline(h[2], head); box.appendChild(head); return; }
    if (/^-# +\S/.test(line)) { var sub = el('div', { class: 'dc-sub' }); inline(line.replace(/^-# +/, ''), sub); box.appendChild(sub); return; }
    if (item) {
      var tag = item[2] ? 'ol' : 'ul';
      if (!state.list || state.list.tagName.toLowerCase() !== tag || state.list.parentNode !== box) {
        state.list = el(tag, item[2] && item[2] !== '1' ? { start: item[2] } : {});
        box.appendChild(state.list);
      }
      var li = el('li', { class: item[1].length >= 2 ? 'dc-li2' : '' });
      inline(item[3], li);
      state.list.appendChild(li);
      return;
    }
    if (!line.trim()) { box.appendChild(el('div', { class: 'dc-blank' })); return; }
    var p = el('div', { class: 'dc-line' });
    inline(line, p);
    box.appendChild(p);
  }
  function markdown(text, box) {
    var lines = text.split('\n');
    var state = { list: null };
    var quote = null;
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      if (/^```/.test(line)) {
        var code = [];
        for (i += 1; i < lines.length && !/^```/.test(lines[i]); i += 1) code.push(lines[i]);
        box.appendChild(el('pre', { class: 'dc-pre' }, [el('code', { text: code.join('\n') })]));
        state.list = null; quote = null;
        continue;
      }
      if (/^>>> /.test(line)) { // the rest of the message is quoted
        quote = el('blockquote');
        box.appendChild(quote);
        var rest = [line.slice(4)].concat(lines.slice(i + 1));
        rest.forEach(function (l) { mdLine(l, quote, state); });
        return;
      }
      var q = /^> (.*)$/.exec(line) || (line === '>' ? [line, ''] : null);
      if (q) {
        if (!quote) { quote = el('blockquote'); box.appendChild(quote); state.list = null; }
        mdLine(q[1], quote, state);
        continue;
      }
      quote = null;
      mdLine(line, box, state);
    }
  }
  function mention(text) { return el('span', { class: 'dc-mention', text: text }); }

  function annPreview() {
    var kind = annKind(annChosenKind());
    var title = $('ann-title').value.trim();
    var text = $('ann-text').value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    var ping = annPing();
    $('ann-title-count').textContent = String($('ann-title').value.length);
    $('ann-text-count').textContent = String($('ann-text').value.length);
    $('ann-card').style.setProperty('--accent-c', kind ? kind.color : '#ff9f43');
    // Banner on top, then the title and the text.
    var banner = $('ann-banner-img');
    var bannerSrc = $('ann-banner').checked && kind && kind.banner ? '/api/admin/announcements/banner/' + kind.id : '';
    if (!bannerSrc) banner.hidden = true;
    else if (banner.getAttribute('src') !== bannerSrc) { banner.hidden = false; banner.src = bannerSrc; }
    else banner.hidden = banner.dataset.bad === bannerSrc;
    var md = $('ann-md');
    md.textContent = '';
    var h1 = el('h1', { class: title ? '' : 'dc-ghost' });
    inline(title || 'Tytuł ogłoszenia', h1);
    md.appendChild(h1);
    if (text) markdown(text, md);
    else md.appendChild(el('div', { class: 'dc-line dc-ghost', text: 'Tu pojawi się treść ogłoszenia…' }));
    // The picture under the text – loaded a moment after typing stops.
    var image = $('ann-image').value.trim();
    clearTimeout(ann.imageTimer);
    if (!isHttps(image)) {
      $('ann-image-img').hidden = true;
      $('ann-image-bad').textContent = 'Link do obrazka musi zaczynać się od https://';
      $('ann-image-bad').hidden = !image || 'https://'.indexOf(image.toLowerCase()) === 0 || /^https:\/\/\S*$/i.test(image); // empty, or still being typed
    } else ann.imageTimer = setTimeout(function () {
      var img = $('ann-image-img');
      $('ann-image-bad').hidden = true;
      if (img.getAttribute('src') !== image) { img.hidden = true; img.src = image; } else img.hidden = false;
    }, 350);
    // The footer: the kind, who sent it, the brand – and the ping.
    var footer = $('ann-footer');
    footer.textContent = '';
    footer.appendChild(document.createTextNode((kind ? kind.emoji + ' ' + kind.label : '📢 Ogłoszenie') + ' · '));
    footer.appendChild(mention('@' + ((me.user && me.user.name) || 'Ty')));
    footer.appendChild(document.createTextNode(' · ' + ((ann.info && ann.info.brand) || ann.brand)));
    if (ping !== 'none') {
      footer.appendChild(document.createTextNode(' · '));
      footer.appendChild(mention(ping === 'everyone' ? '@everyone' : '@' + (ann.info && ann.info.role ? ann.info.role.name : '📢 Ogłoszenia')));
    }
    $('ann-msg').classList.toggle('dc-ping', ping !== 'none');
    var label = $('ann-btn-label').value.trim();
    $('ann-buttons').hidden = !label;
    $('ann-btn-text').textContent = label;
    $('ann-time').textContent = 'Dzisiaj o ' + new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }
  $('ann-banner-img').addEventListener('error', function () { this.dataset.bad = this.getAttribute('src'); this.hidden = true; });
  $('ann-image-img').addEventListener('load', function () { this.hidden = false; $('ann-image-bad').hidden = true; });
  $('ann-image-img').addEventListener('error', function () { this.hidden = true; $('ann-image-bad').textContent = 'Nie da się wczytać obrazka – sprawdź link.'; $('ann-image-bad').hidden = false; });
  $('ann-avatar').addEventListener('error', function () { if (this.dataset.fallback) { this.src = this.dataset.fallback; delete this.dataset.fallback; } });
  $('ann-form').addEventListener('input', function () { annError(''); annPreview(); }); // what was wrong is being fixed
  $('ann-form').addEventListener('change', annPreview);

  // Formatting buttons: around the selected text, or at the start of the selected lines.
  function annWrap(before, after, sample) {
    var t = $('ann-text');
    var s = t.selectionStart, e = t.selectionEnd, v = t.value;
    var chosen = v.slice(s, e) || sample;
    t.value = v.slice(0, s) + before + chosen + after + v.slice(e);
    t.focus();
    t.setSelectionRange(s + before.length, s + before.length + chosen.length);
    annPreview();
  }
  function annPrefix(prefix, sample) {
    var t = $('ann-text');
    var v = t.value;
    var s = v.lastIndexOf('\n', t.selectionStart - 1) + 1;
    var e = v.indexOf('\n', t.selectionEnd);
    if (e < 0) e = v.length;
    var out = (v.slice(s, e) || sample).split('\n').map(function (l) { return prefix + l; }).join('\n');
    t.value = v.slice(0, s) + out + v.slice(e);
    t.focus();
    t.setSelectionRange(s, s + out.length);
    annPreview();
  }
  var TOOLS = { bold: ['**', '**', 'pogrubienie'], italic: ['*', '*', 'kursywa'], underline: ['__', '__', 'podkreślenie'], strike: ['~~', '~~', 'przekreślenie'], link: ['[', '](https://)', 'tekst linku'] };
  document.querySelectorAll('[data-md]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.md;
      if (TOOLS[k]) annWrap(TOOLS[k][0], TOOLS[k][1], TOOLS[k][2]);
      else if (k === 'list') annPrefix('- ', 'punkt listy');
      else if (k === 'heading') annPrefix('## ', 'Nagłówek');
    });
  });

  function annError(text) { $('ann-error').textContent = text; $('ann-error').hidden = !text; }
  function annFields() {
    return {
      kind: annChosenKind(), title: $('ann-title').value.trim(), text: $('ann-text').value, image: $('ann-image').value.trim(),
      buttonLabel: $('ann-btn-label').value.trim(), buttonUrl: $('ann-btn-url').value.trim(), ping: annPing(), banner: $('ann-banner').checked,
    };
  }
  /** The same checks as the server, said before anything is sent → [message, field] or null. */
  function annCheck(f) {
    var L = ann.limits;
    if (!f.title) return ['Wpisz tytuł ogłoszenia.', 'ann-title'];
    if (f.title.length > L.title) return ['Tytuł może mieć najwyżej ' + L.title + ' znaków.', 'ann-title'];
    if (!f.text.trim()) return ['Wpisz treść ogłoszenia.', 'ann-text'];
    if (f.text.trim().length > L.text) return ['Treść może mieć najwyżej ' + L.text + ' znaków.', 'ann-text'];
    if (f.image && !isHttps(f.image)) return ['Obrazek: adres musi zaczynać się od https://', 'ann-image'];
    if (f.buttonLabel && !f.buttonUrl) return ['Przycisk: wpisz też link (https://…) – albo usuń napis.', 'ann-btn-url'];
    if (f.buttonUrl && !f.buttonLabel) return ['Przycisk: wpisz też napis na przycisku – albo usuń link.', 'ann-btn-label'];
    if (f.buttonUrl && !isHttps(f.buttonUrl)) return ['Link w przycisku: adres musi zaczynać się od https://', 'ann-btn-url'];
    return null;
  }
  function annReset(all) {
    ['ann-title', 'ann-text', 'ann-image', 'ann-btn-label', 'ann-btn-url'].forEach(function (id) { $(id).value = ''; });
    document.querySelector('input[name="ann-ping"][value="none"]').checked = true;
    if (all) $('ann-result').hidden = true;
    annError('');
    annPreview();
  }
  $('ann-clear').addEventListener('click', function () { annReset(true); $('ann-title').focus(); });

  function annHistory(list) {
    var box = $('ann-history');
    box.textContent = '';
    list.slice(0, 20).forEach(function (a) {
      var kind = annKind(a.kind);
      var dot = el('i', { class: 'ann-dot' });
      dot.style.setProperty('--c', kind ? kind.color : '#ffa94d');
      // Two lines: the kind and the title – then who, when, and what can be done with it.
      box.appendChild(el('div', { class: 'item ann-item' + (a.deletedAt ? ' ann-gone' : '') }, [
        el('div', { class: 'row' }, [
          el('span', { class: 'pill ann-pill' }, [dot, kind ? kind.label : a.kind]),
          a.ping === 'everyone' ? el('span', { class: 'pill warn', text: '@everyone' }) : a.ping === 'role' ? el('span', { class: 'pill', text: 'ping roli' }) : null,
          a.deletedAt ? el('span', { class: 'pill bad', text: 'usunięte' }) : null,
          el('span', { class: 'title grow', text: a.title }),
        ]),
        el('div', { class: 'row' }, [
          el('span', { class: 'muted small grow', text: 'Autor: ' + ((a.by && a.by.name) || (a.by && a.by.id) || '—') + ' · ' + when(a.at) + (a.deletedAt ? ' · usunięte z Discorda ' + when(a.deletedAt) + (a.deletedBy && a.deletedBy.name ? ' (' + a.deletedBy.name + ')' : '') : '') }),
          a.deletedAt ? null : el('a', { class: 'btn small', href: a.url, target: '_blank', rel: 'noopener', text: 'Zobacz na Discordzie' }),
          a.deletedAt ? null : el('button', { class: 'btn small danger', type: 'button', text: 'Usuń z Discorda', onclick: function () {
            confirmBox('Usunąć ogłoszenie z Discorda?', '„' + a.title + '” zniknie z kanału ogłoszeń. Tego nie da się cofnąć (u serwerów, które obserwują kanał, kopia może zostać).').then(function (yes) {
              if (yes) api('DELETE', 'announcements/' + encodeURIComponent(a.id)).then(function (r) { toast(r.gone ? 'Tej wiadomości już nie było na Discordzie.' : 'Usunięto z Discorda.'); return loaders.ogloszenia(); }).catch(oops);
            });
          } }),
        ]),
      ]));
    });
    if (!list.length) box.appendChild(el('p', { class: 'empty', text: 'Nie wysłano jeszcze żadnego ogłoszenia z panelu.' }));
  }

  loaders.ogloszenia = function () {
    return api('GET', 'announcements').then(function (r) {
      ann.info = r;
      if (r.limits) ann.limits = r.limits;
      // The kinds: a colored chip each (the card's accent on Discord).
      var chosen = annChosenKind();
      var chips = $('ann-kinds');
      chips.textContent = '';
      r.kinds.forEach(function (k) {
        var input = el('input', { type: 'radio', name: 'ann-kind', value: k.id });
        input.checked = k.id === chosen;
        var chip = el('label', { class: 'ann-kind' }, [input, el('i', { class: 'ann-dot' }), k.emoji + ' ' + k.label]);
        chip.style.setProperty('--c', k.color);
        chips.appendChild(chip);
      });
      if (r.kinds.length && !document.querySelector('input[name="ann-kind"]:checked')) chips.querySelector('input').checked = true;
      $('ann-channel').textContent = r.channel ? '#' + r.channel.name : '#📢 ogłoszenia';
      var problem = !r.kinds.length ? 'Bot nie jest teraz połączony z Discordem – ogłoszenie wyślesz, gdy wróci.'
        : !r.channel ? 'Na serwerze nie ma kanału #📢 ogłoszenia – dodaj go na Discordzie komendą /zbuduj tylko:update.' : '';
      $('ann-setup').textContent = problem;
      $('ann-setup').hidden = !problem;
      // Pings: the role only where the server has it, @everyone only for the owner.
      var roleInput = document.querySelector('input[name="ann-ping"][value="role"]');
      var everyoneInput = document.querySelector('input[name="ann-ping"][value="everyone"]');
      roleInput.disabled = !r.role;
      everyoneInput.disabled = !r.canEveryone;
      $('ann-ping-role').classList.toggle('off', !r.role);
      $('ann-ping-role').title = r.role ? '' : 'Na serwerze nie ma roli 📢 Ogłoszenia.';
      $('ann-ping-everyone').classList.toggle('off', !r.canEveryone);
      $('ann-ping-everyone').title = r.canEveryone ? '' : 'Ping @everyone może wysłać tylko właściciel serwera.';
      if ((roleInput.checked && roleInput.disabled) || (everyoneInput.checked && everyoneInput.disabled)) document.querySelector('input[name="ann-ping"][value="none"]').checked = true;
      if (r.bot) {
        $('ann-bot').textContent = r.bot.name;
        if (r.bot.avatar && $('ann-avatar').getAttribute('src') !== r.bot.avatar) { $('ann-avatar').dataset.fallback = $('ann-avatar').getAttribute('src'); $('ann-avatar').src = r.bot.avatar; }
      }
      annHistory(r.history);
      annPreview();
    });
  };
  $('ann-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var f = annFields();
    var wrong = annCheck(f);
    if (wrong) { annError(wrong[0]); $(wrong[1]).focus(); return; }
    annError('');
    var where = ann.info && ann.info.channel ? '#' + ann.info.channel.name : '#📢 ogłoszenia';
    var everyone = f.ping === 'everyone';
    var members = ann.info && ann.info.members;
    confirmBox(
      everyone ? 'Wysłać z pingiem @everyone?' : 'Wysłać ogłoszenie?',
      everyone ? 'Powiadomienie dostanie każdy na serwerze' + (members ? ' (' + people(members) + ')' : '') + '. Używaj tego tylko do naprawdę ważnych ogłoszeń.'
        : '„' + f.title + '” pojawi się na ' + where + (f.ping === 'role' ? ' z pingiem roli 📢 Ogłoszenia.' : ' bez pingu.'),
      everyone ? 'Tak, powiadom wszystkich' : 'Wyślij'
    ).then(function (yes) {
      if (!yes) return null;
      if (everyone) f.confirmEveryone = true;
      return busy(event.target, api('POST', 'announcements', f)).then(function (r) {
        toast('Ogłoszenie jest na Discordzie.');
        var box = $('ann-result');
        box.textContent = '';
        box.appendChild(el('p', { class: 'notice ok' }, ['Wysłane na ' + where + ' – „' + r.item.title + '”. ', el('a', { href: r.url, target: '_blank', rel: 'noopener', text: 'Zobacz na Discordzie' })]));
        annReset(false);
        box.hidden = false;
        return loaders.ogloszenia();
      });
    }).catch(function (err) { annError(err.message); oops(err); });
  });

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
