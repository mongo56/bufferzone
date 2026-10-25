// Content views: home, library, collection, movie, series and watchlist.
// Each view runs with `this` = app; `alive()` turns false when the user navigates away.
(function () {
  const S = window.Sofa;
  const { h, fmtTime, fmtDuration, epCode, toast, debounce, icon, btn, iconBtn, pill, selectEl, switchEl, QUALITY } = S;
  const P = S.App.prototype;

  const SORTS = [
    ['addedAt:desc', 'Recently added'],
    ['titleSort', 'Title A–Z'],
    ['titleSort:desc', 'Title Z–A'],
    ['year:desc', 'Year (newest)'],
    ['year', 'Year (oldest)'],
    ['audienceRating:desc', 'Audience rating'],
    ['rating:desc', 'Critic rating'],
    ['lastViewedAt:desc', 'Recently watched'],
    ['originallyAvailableAt:desc', 'Release date']
  ];

  // ---------- shared pieces ----------
  P.progressOf = function (item) {
    if (!item.viewOffset || !item.duration) return 0;
    return Math.min(1, item.viewOffset / item.duration);
  };

  P.art = function (path, w, hgt, title, extra = []) {
    return h('div.art',
      path ? h('img', { src: this.plex.image(path, w, hgt), loading: 'lazy', decoding: 'async', alt: '' }) : h('div.noimg', title || ''),
      ...extra);
  };

  P.searchField = function () {
    return h('div.search-field', { onclick: () => this.palette.open() }, icon('search', { size: 15 }), 'Search  ·  Ctrl F');
  };

  P.posterCard = function (item) {
    const thumb = item.type === 'episode' ? item.grandparentThumb || item.parentThumb || item.thumb : item.type === 'season' ? item.thumb || item.parentThumb : item.thumb;
    const watched = item.type === 'movie' ? item.viewCount > 0 : item.leafCount && item.viewedLeafCount >= item.leafCount;
    const unwatchedEps = item.type === 'show' ? (item.leafCount || 0) - (item.viewedLeafCount || 0) : 0;
    const prog = this.progressOf(item);
    const title = item.type === 'episode' ? item.grandparentTitle : item.type === 'season' ? item.parentTitle : item.title;
    const sub = item.type === 'episode' ? `${epCode(item)} · ${item.title}` : item.type === 'season' ? item.title : item.type === 'collection' ? `${item.childCount || ''} titles` : item.year || '';
    return h('div.card.poster', { onclick: () => this.open(item), title },
      this.art(thumb, 300, 450, title, [
        watched ? h('span.badge.ok', icon('check', { size: 12, stroke: 3 })) : unwatchedEps > 0 && item.viewedLeafCount ? h('span.badge', String(unwatchedEps)) : null,
        prog ? h('div.prog', h('div', { style: { width: `${prog * 100}%` } })) : null
      ]),
      h('div.c-title', title),
      h('div.c-sub', sub));
  };

  P.toggleWatched = async function (item, isWatched = item.viewCount > 0) {
    try {
      if (isWatched) await this.plex.unscrobble(item.ratingKey); else await this.plex.scrobble(item.ratingKey);
      toast(isWatched ? 'Marked unwatched' : 'Marked watched');
      this.render(this.main.scrollTop);
    } catch (e) { toast('Failed: ' + e.message); }
  };

  function leftText(item) {
    if (!item.viewOffset || !item.duration) return '';
    return `${Math.max(1, Math.round((item.duration - item.viewOffset) / 60000))} min left`;
  }

  // "Watched today 21:26", "Watched yesterday 17:49", else "Watched 2026-10-21" (local time).
  function watchedText(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(new Date()) - day(d)) / 86400000);
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (diff === 0) return `Watched today ${time}`;
    if (diff === 1) return `Watched yesterday ${time}`;
    return `Watched ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ---------- home ----------
  S.views.home = async function (view, _args, alive) {
    const g = this.groups();
    const secs = this.visibleSections();
    const tabs = [{ id: 'all', label: 'All', secs }];
    if (g.movie.length) tabs.push({ id: 'movie', label: 'Movies', secs: g.movie });
    if (g.show.length) tabs.push({ id: 'show', label: 'Series', secs: g.show });
    if (g.kids.length) tabs.push({ id: 'kids', label: 'Kids', secs: g.kids });
    for (const s of secs) if (!/^(movies|tv shows)\b/i.test(s.title) && !g.kids.includes(s)) tabs.push({ id: 's' + s.key, label: s.title, secs: [s] });
    const tab = tabs.find(t => t.id === this.settings.homeTab) || tabs[0];
    const keys = new Set(tab.secs.map(s => String(s.key)));
    const inTab = (i) => tab.id === 'all' || keys.has(String(i.librarySectionID));

    const left = h('div.home-left', h('div.loading', 'Loading…'));
    const right = h('div.home-right');
    view.style.height = '100%';
    view.append(h('div.home',
      h('div.page-head',
        h('div.tabs', tabs.map(t => h('button.tab' + (t === tab ? '.active' : ''), { onclick: () => { this.saveSettings({ homeTab: t.id }); this.render(); } }, t.label))),
        h('div.spacer'), this.searchField()),
      h('div.home-body', left, right)));

    right.append(h('div.sec-head', h('h2', 'Watchlist')), h('div.loading', 'Loading watchlist…'));
    const wlPromise = this.watchlistRows().catch(() => []);
    const [cw, deck] = await Promise.all([
      this.plex.continueWatching().catch(() => []),
      this.plex.onDeck().catch(() => [])
    ]);
    if (!alive()) return;

    // Left: continue watching + next up. The same title can be in two libraries (e.g. Movies and Movies - 4K).
    const seenGuid = new Set();
    const once = (i) => { const k = i.guid || i.ratingKey; return seenGuid.has(k) ? false : seenGuid.add(k); };
    // The selected watchlist folders filter the left column too.
    const sel = this.wlSelection();
    const inSel = (i) => this.inSelection(this.titleGuid(i), sel);
    // Newest first by last watched time; the app sorts itself and does not rely on the server's order.
    const contAll = this.allow(cw).filter(inTab)
      .sort((a, b) => (b.lastViewedAt || 0) - (a.lastViewedAt || 0)).filter(once);
    // Titles in progress outside the selected folders are hidden, but a link can show them (until the app restarts).
    const outside = sel.length ? contAll.filter(i => !inSel(i)).length : 0;
    const showAll = !!this.cwShowAll && outside > 0;
    const cont = showAll ? contAll : contAll.filter(inSel);
    const cwKeys = new Set(cont.map(i => i.ratingKey));
    const next = this.allow(deck).filter(i => inTab(i) && inSel(i) && !i.viewOffset && !cwKeys.has(i.ratingKey)).filter(once);
    const selNames = sel.map(k => (k === 'none' ? 'No folder' : this.wlFolders().find(f => f.id === k)?.name)).filter(Boolean).join(', ');
    const rowsEls = [];
    const row = (item, isNext) => {
      const img = item.type === 'episode' ? item.thumb || item.grandparentArt : item.art || item.thumb;
      const prog = this.progressOf(item);
      const title = item.type === 'episode' ? item.grandparentTitle : item.title;
      const sub = item.type === 'episode' ? `${epCode(item)} · ${item.title}${isNext ? ' · new' : ''}` : [item.year, 'Movie'].filter(Boolean).join(' · ');
      const el = h('div.cw-row', { onclick: () => this.play(item) },
        this.art(img, 256, 144, title, [prog ? h('div.prog', h('div', { style: { width: `${prog * 100}%` } })) : null]),
        h('div.cw-text', h('div.cw-title', title), h('div.cw-sub', sub), h('div.cw-left', isNext ? (item.duration ? fmtDuration(item.duration) : '') : leftText(item)),
          item.lastViewedAt ? h('div.cw-when', watchedText(item.lastViewedAt)) : null),
        iconBtn('play', { cls: 'cw-play', title: 'Play', size: 16 }));
      rowsEls.push({ el, item });
      return el;
    };
    const more = outside ? h('button.cw-more', { onclick: () => { this.cwShowAll = !showAll; this.render(this.main.scrollTop); } },
      icon(showAll ? 'x' : 'plus', { size: 12 }),
      showAll ? `Hide the ${outside} outside the selected folders` : `${outside} more in progress outside these folders · Show`) : null;
    left.replaceChildren(...[
      h('div.sec-head', h('h2', 'Continue watching'), h('div.spacer'), cont.length ? h('span.muted', 'Space to play') : null),
      selNames ? h('div.sel-note', icon('folder', { size: 12 }), selNames) : null,
      ...(cont.length ? cont.map(i => row(i, false)) : [h('p.muted.small', selNames ? 'Nothing in progress in the selected folders.' : 'Nothing in progress.')]),
      more,
      next.length ? h('div.divider') : null,
      next.length ? h('div.eyebrow', { style: { margin: '0 8px 6px' } }, 'Next up') : null,
      ...next.slice(0, 12).map(i => row(i, true))
    ].filter(Boolean));

    let cur = 0;
    const mark = () => rowsEls.forEach((r, i) => r.el.classList.toggle('sel', i === cur));
    if (rowsEls.length) mark();
    this.homeKeys = (e) => {
      if (!rowsEls.length) return;
      if (e.key === 'ArrowDown') { cur = Math.min(rowsEls.length - 1, cur + 1); mark(); rowsEls[cur].el.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { cur = Math.max(0, cur - 1); mark(); rowsEls[cur].el.scrollIntoView({ block: 'nearest' }); e.preventDefault(); }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.play(rowsEls[cur].item); }
    };

    // Right: watchlist, newest first. Folder chips filter it; the library tabs filter it too.
    const wl = await wlPromise;
    if (!alive()) return;
    const inScope = wl.filter(r => this.watchGuids.has(r.w.guid) && (r.s ? inTab(r.s) : tab.id === 'all'));
    const drawWl = () => {
      const list = inScope.filter(r => this.inSelection(r.w.guid, sel));
      right.replaceChildren(...[
        h('div.sec-head', h('h2', 'Watchlist'), h('span.muted', `${list.length} titles`), h('div.spacer'),
          btn('Open watchlist', { kind: 'ghost', size: 'sm', onclick: () => this.go('watchlist', {}, { root: true }) })),
        // A new selection changes both columns, so the whole home view redraws.
        this.wlFolders().length ? h('div.folder-bar', this.folderChips(inScope, () => this.render(this.main.scrollTop), { drop: false, small: true })) : null,
        list.length ? h('div.grid', list.map(r => this.wlCard(r)))
          : h('p.muted', wl.length ? 'Nothing in this view.' : 'Your watchlist is empty. Add titles with the bookmark button on a movie or series.')
      ].filter(Boolean));
    };
    drawWl();
  };

  // ---------- library ----------
  S.views.library = async function (view, { id }, alive) {
    const sec = this.sections.find(s => s.key === id);
    if (!sec) return view.append(h('div.empty', 'This library is not available.'));
    const g = this.groups();
    const groupKey = g.kids.includes(sec) ? 'kids' : sec.type;
    const siblings = g[groupKey] || [sec];
    this.saveSettings({ lastLibrary: { ...(this.settings.lastLibrary || {}), [groupKey]: id } });

    const f = { sort: 'addedAt:desc', genre: '', unwatched: false, view: 'grid', ...(this.settings.libraryFilters?.[id] || {}) };
    const save = () => this.saveSettings({ libraryFilters: { ...(this.settings.libraryFilters || {}), [id]: f } });
    const count = h('span.muted');
    const content = h('div');
    const letters = h('div.letters');
    const genreWrap = h('span');
    const noun = sec.type === 'show' ? 'series' : 'movies';

    const setView = (v) => { f.view = v; save(); this.render(); };
    view.append(
      h('div.page-head',
        h('h1', sec.title), count,
        siblings.length > 1 ? h('div.tabs', { style: { marginLeft: '12px' } }, siblings.map(s => h('button.tab' + (s === sec ? '.active' : ''), { onclick: () => this.go('library', { id: s.key }, { replace: true }) }, s.title))) : null,
        h('div.spacer'), this.searchField()),
      h('div.toolbar',
        f.view === 'collections' ? null : selectEl(SORTS, f.sort, (v) => { f.sort = v; save(); reload(0); }),
        f.view === 'collections' ? null : genreWrap,
        f.view === 'collections' ? null : switchEl(f.unwatched, (on) => { f.unwatched = on; save(); reload(0); }),
        f.view === 'collections' ? null : h('span', { style: { fontSize: '13px' } }, 'Unwatched only'),
        h('div.spacer'),
        h('div.seg',
          iconBtn('layout-grid', { title: 'Grid', cls: f.view === 'grid' ? 'on' : '', onclick: () => setView('grid') }),
          iconBtn('list', { title: 'List', cls: f.view === 'list' ? 'on' : '', onclick: () => setView('list') }),
          iconBtn('folder', { title: 'Collections', cls: f.view === 'collections' ? 'on' : '', onclick: () => setView('collections') }))),
      h('div.lib-body', content, letters));

    if (f.view === 'collections') {
      content.append(h('div.loading', 'Loading…'));
      const cols = await this.plex.collections(id);
      if (!alive()) return;
      count.textContent = `${cols.length} collections`;
      content.replaceChildren(cols.length ? h('div.grid', cols.map(c => this.posterCard(c))) : h('div.empty', 'No collections.'));
      return;
    }

    this.plex.genres(id).then(gs => {
      if (!alive()) return;
      genreWrap.replaceChildren(selectEl([['', 'All genres'], ...gs.map(x => [x.key, x.title])], f.genre, (v) => { f.genre = v; save(); reload(0); }));
    }).catch(() => {});

    const container = f.view === 'list' ? h('div.list-rows') : h('div.grid');
    const sentinel = h('div.sentinel');
    content.append(container, sentinel);
    const listRow = (i) => h('div.list-row', { onclick: () => this.open(i) },
      this.art(i.thumb, 72, 108, ''),
      h('div', { style: { minWidth: 0 } }, h('div.cw-title', i.title), h('div.c-sub', (i.Genre || []).map(x => x.tag).slice(0, 3).join(', '))),
      h('span.muted.small', i.year || ''),
      h('span.muted.small', i.type === 'show' ? `${i.leafCount || 0} episodes` : i.duration ? fmtDuration(i.duration) : ''),
      h('span.muted.small', i.audienceRating ? `★ ${i.audienceRating.toFixed(1)}` : ''),
      (i.type === 'movie' ? i.viewCount : i.leafCount && i.viewedLeafCount >= i.leafCount) ? h('span', { style: { color: 'var(--ok)' } }, icon('check', { size: 16 })) : h('span'));

    let start = 0, total = Infinity, busy = false, gen = 0;
    const more = async () => {
      if (busy || start >= total) return;
      busy = true;
      const myGen = gen;
      try {
        const r = await this.plex.sectionItems(id, { sort: f.sort, genre: f.genre || undefined, unwatched: f.unwatched, start, size: 60 });
        if (!alive() || myGen !== gen) return;
        total = r.total;
        start += r.items.length;
        if (!r.items.length) total = start;
        count.textContent = `${total} ${noun}`;
        const items = this.allow(r.items);
        container.append(...items.map(i => (f.view === 'list' ? listRow(i) : this.posterCard(i))));
        if (!container.children.length && start >= total) container.append(h('div.empty', 'No matches.'));
      } finally { busy = false; }
      if (alive() && sentinel.getBoundingClientRect().top < window.innerHeight * 2) more();
    };
    const reload = (from) => { gen++; start = from; total = Infinity; busy = false; container.replaceChildren(); more(); };
    new IntersectionObserver((es) => { if (es[0].isIntersecting) more(); }, { root: this.main, rootMargin: '800px' }).observe(sentinel);

    // Letter rail: jumps in the title-sorted list.
    this.plex.firstCharacter(id).then(chars => {
      if (!alive()) return;
      let offset = 0;
      const map = chars.map(c => { const o = { key: c.title, start: offset, size: c.size }; offset += c.size; return o; });
      const btns = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(L => {
        const entry = map.find(m => m.key.toUpperCase() === L);
        const b = h('button', {
          disabled: !entry, title: entry ? `${entry.size}` : '',
          onclick: () => {
            if (f.sort !== 'titleSort') { f.sort = 'titleSort'; save(); view.querySelector('.toolbar select').value = 'titleSort'; }
            // Letter offsets are for the full list; filters change them, so the jump is only exact without filters.
            btns.forEach(x => x.classList.toggle('on', x === b));
            reload(entry.start);
            this.main.scrollTop = 0;
          }
        }, L);
        return b;
      });
      letters.replaceChildren(...btns);
    }).catch(() => {});

    await more();
  };

  // ---------- collection ----------
  S.views.collection = async function (view, { key }, alive) {
    const [meta, items] = await Promise.all([this.plex.metadata(key), this.plex.collectionItems(key)]);
    if (!alive()) return;
    const pinned = this.isPinned(meta);
    view.append(
      h('div.page-head', this.backButton(), h('h1', meta.title), h('span.muted', `${items.length} titles`), h('div.spacer'),
        btn(pinned ? 'Unpin' : 'Pin to sidebar', { icon: 'pin', onclick: () => { this.togglePin(meta); this.render(); } })),
      h('div.pad', h('div.grid', this.allow(items).map(i => this.posterCard(i)))));
  };

  // ---------- movie ----------
  S.views.movie = async function (view, { key }, alive) {
    const m = await this.plex.metadata(key);
    if (!alive()) return;
    if (!this.itemAllowed(m)) return view.append(h('div.empty', 'This title is not available for this profile.'));
    const sec = this.sections.find(s => String(s.key) === String(m.librarySectionID));
    const streams = m.Media?.[0]?.Part?.[0]?.Stream || [];
    const audios = streams.filter(s => s.streamType === 2);
    const subs = streams.filter(s => s.streamType === 3);
    const preset = { audio: 'auto', sub: 'auto', quality: this.settings.quality };
    const opts = () => ({
      audioId: preset.audio === 'auto' ? undefined : Number(preset.audio),
      subId: preset.sub === 'auto' ? undefined : preset.sub === 'off' ? null : Number(preset.sub),
      quality: preset.quality
    });
    const facts = [m.year, m.duration && fmtDuration(m.duration), m.contentRating, m.audienceRating ? `★ ${m.audienceRating.toFixed(1)}` : null].filter(Boolean).join(' · ');
    const watched = m.viewCount > 0;
    const left = h('div.movie-left',
      this.history.length ? h('div', btn(sec?.title || 'Back', { kind: 'ghost', icon: 'arrow-left', onclick: () => this.back() })) : null,
      h('div.art.poster', m.thumb ? h('img', { src: this.plex.image(m.thumb, 400, 600), alt: '' }) : h('div.noimg', m.title)),
      h('h1', m.title),
      h('div.facts', facts),
      m.viewOffset
        ? btn(`Resume from ${fmtTime(m.viewOffset / 1000)}`, { kind: 'primary', size: 'lg', full: true, icon: 'play', onclick: () => this.play(m, opts()) })
        : btn('Play', { kind: 'primary', size: 'lg', full: true, icon: 'play', onclick: () => this.play(m, opts()) }),
      m.viewOffset ? btn('Play from start', { size: 'lg', full: true, icon: 'rotate-ccw', onclick: () => this.play(m, { ...opts(), resume: false }) }) : null,
      h('div.btn-row',
        iconBtn(this.inWatchlist(m) ? 'bookmark-check' : 'bookmark', { cls: 'boxed' + (this.inWatchlist(m) ? ' on' : ''), title: this.inWatchlist(m) ? 'Remove from watchlist' : 'Add to watchlist', onclick: async () => { await this.toggleWatchlist(m); this.render(); } }),
        iconBtn('check', { cls: 'boxed' + (watched ? ' on' : ''), title: watched ? 'Mark unwatched' : 'Mark watched', onclick: () => this.toggleWatched(m) }),
        iconBtn('pin', { cls: 'boxed' + (this.isPinned(m) ? ' on' : ''), title: this.isPinned(m) ? 'Unpin' : 'Pin to sidebar', onclick: () => { this.togglePin(m); this.render(); } }),
        this.multiviewAllowed ? iconBtn('layout-grid', { cls: 'boxed', title: 'Add to Multi-view', onclick: () => this.multiview.add(m) }) : null));

    const people = (arr) => (arr || []).map(x => x.tag).join(', ');
    const label = (t, el) => h('label', t, el);
    const media = m.Media?.[0];
    const right = h('div.movie-right',
      this.art(m.art, 1200, 525, '', []),
      m.summary ? h('p.summary', { style: { marginTop: '18px' } }, m.summary) : null,
      m.Director ? h('div.credit', h('b', 'Director '), people(m.Director)) : null,
      m.Role ? h('div.credit', h('b', 'Cast '), people(m.Role.slice(0, 8))) : null,
      h('div.presets',
        label('Audio', selectEl([['auto', 'Automatic'], ...audios.map(a => [a.id, a.displayTitle || a.language])], 'auto', (v) => { preset.audio = v; })),
        label('Subtitles', selectEl([['auto', 'Automatic'], ['off', 'Off'], ...subs.map(s => [s.id, s.displayTitle || s.language])], 'auto', (v) => { preset.sub = v; })),
        label('Quality', selectEl(QUALITY.map(q => [q.id, q.label]), preset.quality, (v) => { preset.quality = v; }))),
      media ? h('div.tech',
        h('span.k', 'Video'), h('span', [media.videoResolution && `${media.videoResolution}${/^\d+$/.test(media.videoResolution) ? 'p' : ''}`, String(media.videoCodec || '').toUpperCase(), String(media.container || '').toUpperCase(), media.bitrate && `${(media.bitrate / 1000).toFixed(1)} Mbps`].filter(Boolean).join(' · ')),
        h('span.k', 'Audio'), h('span', audios.map(a => a.displayTitle).join(' · ') || '—'),
        h('span.k', 'Subtitles'), h('span', subs.map(s => s.displayTitle).join(' · ') || '—')) : null);
    right.firstChild.classList.add('backdrop');
    view.append(h('div.movie', left, right));
  };

  // ---------- series ----------
  S.views.show = async function (view, { key, season, focus }, alive) {
    const [show, seasons, leaves] = await Promise.all([this.plex.metadata(key), this.plex.children(key), this.plex.allLeaves(key)]);
    if (!alive()) return;
    if (!this.itemAllowed(show)) return view.append(h('div.empty', 'This series is not available for this profile.'));
    const upNext = leaves.find(e => e.viewOffset && !e.viewCount) || leaves.find(e => !e.viewCount) || leaves[0];
    const allWatched = leaves.length && leaves.every(e => e.viewCount);
    const facts = [show.year, show.childCount ? `${show.childCount} season${show.childCount === 1 ? '' : 's'}` : null, show.contentRating,
      show.audienceRating ? `★ ${show.audienceRating.toFixed(1)}` : null, (show.Genre || []).slice(0, 2).map(x => x.tag).join(', ')].filter(Boolean).join(' · ');
    const inWl = this.inWatchlist(show);
    view.append(h('div.hero',
      show.art ? h('div.hero-bg', { style: { backgroundImage: `url("${this.plex.image(show.art, 1600, 900)}")` } }) : null,
      h('div', this.backButton()),
      h('div.hero-body',
        show.thumb ? h('img.hero-poster', { src: this.plex.image(show.thumb, 352, 528), alt: '' }) : null,
        h('div.hero-info',
          h('h1', show.title),
          h('div.facts', facts),
          show.summary ? h('p.summary', show.summary) : null,
          h('div.btn-row',
            upNext ? btn(`${upNext.viewOffset && !upNext.viewCount ? 'Resume' : 'Play'} ${epCode(upNext)}`, { kind: 'primary', size: 'lg', icon: 'play', onclick: () => this.play(upNext) }) : null,
            btn(allWatched ? 'Mark series unwatched' : 'Mark series watched', { size: 'lg', icon: 'check', onclick: () => this.toggleWatched(show, allWatched) }),
            iconBtn(inWl ? 'bookmark-check' : 'bookmark', { cls: 'boxed' + (inWl ? ' on' : ''), title: inWl ? 'Remove from watchlist' : 'Add to watchlist', onclick: async () => { await this.toggleWatchlist(show); this.render(); } }),
            iconBtn('pin', { cls: 'boxed' + (this.isPinned(show) ? ' on' : ''), title: this.isPinned(show) ? 'Unpin' : 'Pin to sidebar', onclick: () => { this.togglePin(show); this.render(); } }))))));

    const tabs = h('div.tabs');
    const bar = h('div.season-bar');
    const list = h('div.episodes');
    const showSeason = (sk) => {
      for (const t of tabs.children) t.classList.toggle('active', t.dataset.key === String(sk));
      const s = seasons.find(x => x.ratingKey === String(sk));
      const eps = leaves.filter(e => e.parentRatingKey === String(sk));
      const watchedN = eps.filter(e => e.viewCount).length;
      const seasonWatched = eps.length && watchedN === eps.length;
      bar.replaceChildren(...[tabs, h('div.spacer'), h('span.muted', `${eps.length} episodes · ${watchedN} watched`),
        s ? btn(seasonWatched ? 'Mark season unwatched' : 'Mark season watched', { kind: 'ghost', size: 'sm', onclick: () => this.toggleWatched(s, seasonWatched) }) : null].filter(Boolean));
      list.replaceChildren(...eps.map(e => this.episodeRow(e, e.ratingKey === focus)));
      this.current.args.season = sk;
      const f = list.querySelector('.focus');
      if (f) requestAnimationFrame(() => f.scrollIntoView({ block: 'center' }));
    };
    tabs.append(...seasons.map(s => {
      const done = s.leafCount && s.viewedLeafCount >= s.leafCount;
      const t = h('button.tab', { onclick: () => showSeason(s.ratingKey) }, s.title, done ? h('span.tick', icon('check', { size: 12, stroke: 3 })) : null);
      t.dataset.key = s.ratingKey;
      return t;
    }));
    view.append(h('div', { style: { padding: '0 28px 60px' } }, bar, list));
    const cur = season || upNext?.parentRatingKey || seasons[0]?.ratingKey;
    if (cur) showSeason(cur);
  };

  P.episodeRow = function (e, focus) {
    const prog = this.progressOf(e);
    const watched = e.viewCount > 0;
    const inProgress = prog && !watched;
    return h('div.ep' + (inProgress ? '.current' : '') + (focus ? '.focus' : ''),
      h('div.art', { onclick: () => this.play(e) },
        e.thumb ? h('img', { src: this.plex.image(e.thumb, 384, 216), loading: 'lazy', alt: '' }) : null,
        h('div.play-ov', icon('play', { size: 30 })),
        prog ? h('div.prog', h('div', { style: { width: `${prog * 100}%` } })) : null),
      h('div.ep-body',
        h('div.ep-title', h('span.ep-code', epCode(e)), e.title),
        h('div.muted.small', [e.duration && fmtDuration(e.duration), e.originallyAvailableAt, inProgress ? `${fmtTime(e.viewOffset / 1000)} watched` : null].filter(Boolean).join(' · ')),
        e.summary ? h('p.ep-sum', e.summary) : null),
      h('div.ep-actions',
        inProgress ? btn('From start', { size: 'sm', onclick: () => this.play(e, { resume: false }) }) : null,
        h('button.watch' + (watched ? '.on' : ''), { title: watched ? 'Mark unwatched' : 'Mark watched', onclick: () => this.toggleWatched(e) }, watched ? icon('check', { size: 16, stroke: 3 }) : null)));
  };

  // ---------- watchlist ----------
  // Matches watchlist items to server items and reads their watchlist dates.
  // Both are cached by guid, because a reload of the watchlist gives new item objects.
  async function matchAll(app, items) {
    app.wlMatch = app.wlMatch || new Map();
    app.wlAdded = app.wlAdded || new Map();
    const todo = items.filter(w => !app.wlMatch.has(w.guid));
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const w = todo[i++];
        if (!app.wlAdded.has(w.guid)) app.wlAdded.set(w.guid, (await app.plex.watchlistState(w.ratingKey).catch(() => ({}))).watchlistedAt || 0);
        const found = await app.plex.findByGuid(w.guid).catch(() => []);
        const visible = found.filter(x => !app.settings.hiddenLibraries.includes(String(x.librarySectionID)));
        app.wlMatch.set(w.guid, visible[0] || found[0] || null);
      }
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    for (const w of items) w.watchlistedAt = app.wlAdded.get(w.guid) || w.watchlistedAt;
  }

  function wlStatus(s) {
    if (!s) return pill('Not on server', '', { sm: true });
    if (s.type === 'show') {
      if (s.leafCount && s.viewedLeafCount >= s.leafCount) return pill('Watched', 'ok', { sm: true });
      if (s.viewedLeafCount > 0) return pill('New episodes', 'accent', { sm: true });
      return pill('Unwatched', '', { sm: true });
    }
    if (s.viewCount > 0) return pill('Watched', 'ok', { sm: true });
    if (s.viewOffset > 0) return pill('In progress', 'info', { sm: true });
    return pill('Unwatched', '', { sm: true });
  }

  // ---------- watchlist folders ----------
  // Plex has no watchlist folders, so they live in settings on this computer: [{ id, name, guids: [] }].
  P.wlFolders = function () { return this.settings.watchlistFolders || []; };
  P.saveFolders = function (list) { this.saveSettings({ watchlistFolders: list }); };
  P.newFolder = async function () {
    const name = await S.askText('New folder', 'Watchlist titles can be in more than one folder.', '', 'Create');
    if (!name) return null;
    const folder = { id: 'f' + Date.now().toString(36), name, guids: [] };
    this.saveFolders([...this.wlFolders(), folder]);
    return folder;
  };
  P.setInFolder = function (folderId, guid, on) {
    this.saveFolders(this.wlFolders().map(f => (f.id !== folderId ? f
      : { ...f, guids: on ? [...new Set([...f.guids, guid])] : f.guids.filter(g => g !== guid) })));
  };
  P.inFolder = function (folderKey, guid) {
    if (folderKey === 'all') return true;
    if (folderKey === 'none') return !this.wlFolders().some(f => f.guids.includes(guid));
    return !!this.wlFolders().find(f => f.id === folderKey)?.guids.includes(guid);
  };

  // Matched watchlist rows [{ w, s }], newest first. `s` is the server item, or null when the server does not have it.
  P.watchlistRows = async function () {
    const items = this.watchlist || await this.loadWatchlist();
    await matchAll(this, items);
    return items.map(w => ({ w, s: this.wlMatch.get(w.guid) }))
      .filter(r => !r.s || this.itemAllowed(r.s))
      .sort((a, b) => (b.w.watchlistedAt || 0) - (a.w.watchlistedAt || 0));
  };

  // One folder selection, shared by home and the watchlist page and kept across restarts.
  // [] means all titles; otherwise folder ids and/or 'none' ("No folder"). A title matches when it is in any selected folder.
  P.wlSelection = function () {
    let sel = this.settings.wlSelected;
    if (!Array.isArray(sel)) {
      const old = this.settings.homeWlFolder; // selection of the first folder version
      sel = old && old !== 'all' ? [old] : [];
    }
    const ids = new Set(this.wlFolders().map(f => f.id));
    return sel.filter(k => k === 'none' || ids.has(k));
  };
  P.setWlSelection = function (sel) { this.saveSettings({ wlSelected: sel }); };
  P.inSelection = function (guid, sel = this.wlSelection()) {
    return !sel.length || sel.some(k => this.inFolder(k, guid));
  };
  // Folders hold series and movies; an episode or season belongs to its series.
  P.titleGuid = function (i) {
    return i.type === 'episode' ? i.grandparentGuid : i.type === 'season' ? i.parentGuid : i.guid;
  };

  // Folder chips. "All" clears the selection; a folder chip adds or removes that folder.
  // Titles can be dragged onto a folder chip.
  P.folderChips = function (rows, onChange, { drop = true, small = false } = {}) {
    const sel = this.wlSelection();
    const count = (key) => rows.filter(r => this.inFolder(key, r.w.guid)).length;
    const toggle = (key) => {
      if (key === 'all') this.setWlSelection([]);
      else this.setWlSelection(sel.includes(key) ? sel.filter(k => k !== key) : [...sel, key]);
      onChange();
    };
    const chip = (key, label) => {
      const active = key === 'all' ? !sel.length : sel.includes(key);
      const el = h('button.tab' + (active ? '.active' : ''), { onclick: () => toggle(key), title: key === 'all' ? 'Show all titles' : 'Click to add or remove this folder' },
        active && key !== 'all' ? icon('check', { size: 12, stroke: 3 }) : null, label, h('span.n', String(count(key))));
      if (drop && key !== 'all' && key !== 'none') {
        el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
        el.addEventListener('dragleave', () => el.classList.remove('drop'));
        el.addEventListener('drop', (e) => {
          e.preventDefault();
          el.classList.remove('drop');
          const guid = e.dataTransfer.getData('text/plain');
          if (!guid) return;
          this.setInFolder(key, guid, true);
          toast(`Added to ${label}`);
          onChange();
        });
      }
      return el;
    };
    const folders = this.wlFolders();
    return h('div.tabs' + (small ? '.sm' : ''),
      chip('all', 'All'),
      folders.map(f => chip(f.id, f.name)),
      folders.length ? chip('none', 'No folder') : null);
  };

  // Folder menu for one title: a check per folder, plus "New folder".
  P.folderMenu = function (anchor, guid, onChange) {
    document.querySelector('.menu-pop')?.remove();
    const r = anchor.getBoundingClientRect();
    const close = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); };
    const outside = (e) => { if (!pop.contains(e.target)) close(); };
    const items = this.wlFolders().map(f => {
      const on = f.guids.includes(guid);
      return h('button.t-item' + (on ? '.active' : ''), { onclick: () => { this.setInFolder(f.id, guid, !on); close(); onChange(); } },
        h('span.t-check', on ? icon('check', { size: 14, stroke: 2.5 }) : null), h('span', h('b', f.name)));
    });
    const pop = h('div.menu-pop', h('div.eyebrow', { style: { padding: '6px 10px' } }, 'Folders'),
      items.length ? items : h('div.muted.small', { style: { padding: '4px 10px 8px' } }, 'No folders yet.'),
      h('button.t-item', { onclick: async () => {
        close();
        const f = await this.newFolder();
        if (f) { this.setInFolder(f.id, guid, true); toast(`Added to ${f.name}`); onChange(); }
      } }, h('span.t-check', icon('plus', { size: 14 })), h('span', h('b', 'New folder…'))));
    document.body.append(pop);
    const w = pop.offsetWidth, ht = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
    pop.style.top = `${r.bottom + ht + 8 > window.innerHeight ? r.top - ht - 6 : r.bottom + 6}px`;
    setTimeout(() => document.addEventListener('mousedown', outside, true));
  };

  // Watchlist posters come as full-size originals (TMDB's are often 2000x3000), and decoding those stalls a TV.
  // TMDB has fixed smaller sizes; other hosts go through the server's image transcoder, which refuses TMDB.
  function wlPoster(app, url) {
    if (/^https:\/\/image\.tmdb\.org\/t\/p\/original\//.test(url)) return url.replace('/t/p/original/', '/t/p/w342/');
    return app.plex.image(url, 300, 450);
  }

  // Poster card for a watchlist row; titles the server does not have are dimmed.
  P.wlCard = function ({ w, s }) {
    if (s) return this.posterCard(s);
    const card = h('div.card.poster.off', { title: w.title, onclick: () => toast('This title is not on this server.') },
      h('div.art', w.thumb ? h('img', { src: wlPoster(this, w.thumb), loading: 'lazy', decoding: 'async', alt: '' }) : h('div.noimg', w.title)),
      h('div.c-title', w.title), h('div.c-sub', 'Not on server'));
    return card;
  };

  S.views.watchlist = async function (view, _args, alive) {
    const f = { type: 'all', sort: 'added', ...(this.settings.watchlistView || {}) };
    delete f.folder; // the folder selection is shared with home now, see wlSelection()
    const save = () => this.saveSettings({ watchlistView: f });
    const count = h('span.muted');
    const body = h('div', h('div.loading', `Matching titles on ${this.plex.server.name}…`));
    view.append(h('div.page-head', h('h1', 'Watchlist'), count, h('div.spacer'), this.searchField()), h('div.pad', body));
    const all = await this.watchlistRows();
    if (!alive()) return;

    const draw = () => {
      const sel = this.wlSelection();
      const items = all.filter(r => this.watchGuids.has(r.w.guid));
      let rows = items.filter(r => this.inSelection(r.w.guid, sel));
      if (f.type !== 'all') rows = rows.filter(r => r.w.type === f.type);
      if (f.sort === 'added') rows.sort((a, b) => (b.w.watchlistedAt || 0) - (a.w.watchlistedAt || 0));
      if (f.sort === 'title') rows.sort((a, b) => a.w.title.localeCompare(b.w.title));
      if (f.sort === 'length') rows.sort((a, b) => ((b.s?.duration || b.w.duration || 0) - (a.s?.duration || a.w.duration || 0)));
      count.textContent = `${items.length} titles`;
      const added = (w) => w.watchlistedAt ? new Date(w.watchlistedAt * 1000).toISOString().slice(0, 10) : '';
      // Rename and delete act on one folder, so they show when exactly one folder is selected.
      const folder = sel.length === 1 ? this.wlFolders().find(x => x.id === sel[0]) : null;
      const folderNames = (guid) => this.wlFolders().filter(x => x.guids.includes(guid)).map(x => x.name).join(', ');
      const row = ({ w, s }) => {
        const el = h('div.t-row', { draggable: true, title: 'Drag onto a folder to add it' },
          h('div.t-title', { onclick: () => (s ? this.open(s) : toast('This title is not on this server.')) },
            h('div.art', s?.thumb ? h('img', { src: this.plex.image(s.thumb, 128, 192), loading: 'lazy', alt: '' }) : w.thumb ? h('img', { src: w.thumb, loading: 'lazy', alt: '' }) : null),
            h('div', { style: { minWidth: 0 } },
              h('b', w.title),
              h('span.muted.small', [w.year, s?.type === 'show' && s.childCount ? `${s.childCount} season${s.childCount === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')),
              folderNames(w.guid) ? h('span.t-folders', icon('folder', { size: 12 }), folderNames(w.guid)) : null)),
          h('div.muted', s?.librarySectionTitle || '—'),
          h('div.muted.tnum', added(w)),
          h('div', wlStatus(s)),
          h('div.muted', s ? (s.type === 'show' ? `${s.leafCount || 0} eps` : s.duration ? fmtDuration(s.duration) : '') : ''),
          h('div.t-actions',
            iconBtn('folder', { title: 'Folders', size: 20, onclick: (e) => this.folderMenu(e.currentTarget, w.guid, draw) }),
            s ? iconBtn('play', { title: 'Play', size: 20, onclick: () => this.play(s) }) : h('span', { style: { width: '38px' } }),
            iconBtn('x', { title: 'Remove from watchlist', size: 20, onclick: async () => {
              try {
                await this.plex.removeFromWatchlist(w.guid);
                this.watchGuids.delete(w.guid);
                for (const x of this.wlFolders()) if (x.guids.includes(w.guid)) this.setInFolder(x.id, w.guid, false);
                toast('Removed from watchlist');
                draw();
              } catch (e) { toast('Failed: ' + e.message); }
            } })));
        el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', w.guid); el.classList.add('dragging'); });
        el.addEventListener('dragend', () => el.classList.remove('dragging'));
        return el;
      };
      body.replaceChildren(
        h('div.folder-bar',
          this.folderChips(items, draw),
          btn('New folder', { kind: 'ghost', size: 'sm', icon: 'plus', onclick: async () => { const nf = await this.newFolder(); if (nf) { this.setWlSelection([nf.id]); draw(); } } }),
          h('div.spacer'),
          folder ? btn('Rename', { kind: 'ghost', size: 'sm', onclick: async () => {
            const name = await S.askText('Rename folder', null, folder.name);
            if (name) { this.saveFolders(this.wlFolders().map(x => (x.id === folder.id ? { ...x, name } : x))); draw(); }
          } }) : null,
          folder ? btn('Delete folder', { kind: 'ghost', size: 'sm', onclick: async () => {
            if (!await S.askConfirm(`Delete "${folder.name}"?`, 'The titles stay on your watchlist. Only the folder goes away.')) return;
            this.saveFolders(this.wlFolders().filter(x => x.id !== folder.id));
            this.setWlSelection(sel.filter(k => k !== folder.id));
            draw();
          } }) : null),
        h('div.wl-tools',
          h('div.tabs', [['all', 'All'], ['movie', 'Movies'], ['show', 'Series']].map(([k, l]) => h('button.tab' + (f.type === k ? '.active' : ''), { onclick: () => { f.type = k; save(); draw(); } }, l))),
          h('div', { style: { width: '170px' } }, selectEl([['added', 'Date added'], ['title', 'Title A–Z'], ['length', 'Length']], f.sort, (v) => { f.sort = v; save(); draw(); }))),
        h('div.table',
          h('div.t-row.head', h('div', 'Title'), h('div', 'Library'), h('div', 'Added'), h('div', 'Status'), h('div', 'Length'), h('div')),
          rows.length ? rows.map(row) : h('div.empty', sel.length ? 'No titles in the selected folders. Drag titles onto a folder name, or use the folder button on a title.' : 'Nothing here.')));
    };
    draw();
  };

  S.SORTS = SORTS;
})();
