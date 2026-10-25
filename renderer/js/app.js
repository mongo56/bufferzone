// App shell: start-up, onboarding, profiles, icon rail, routing and shared helpers.
// Views live in views.js and settings.js; they register on Sofa.views and run with `this` = app.
(function () {
  const S = window.Sofa;
  const { Plex, Player, h, toast, icon, btn, pill } = S;
  S.views = S.views || {};

  // Content rating -> minimum age. Country prefixes such as "de/12" are removed first.
  const RATING_AGE = {
    'G': 0, 'TV-Y': 0, 'TV-G': 0, 'U': 0, 'APPROVED': 0, 'PASSED': 0,
    'TV-Y7': 7, 'TV-Y7-FV': 7, 'PG': 10, 'TV-PG': 10, '12A': 12, 'PG-13': 13, 'TV-14': 14,
    'R': 17, 'TV-MA': 17, 'NC-17': 18, 'X': 18
  };
  function ageOf(rating) {
    if (!rating) return null;
    const r = String(rating).replace(/^[a-z]{2}\//i, '').toUpperCase();
    if (r in RATING_AGE) return RATING_AGE[r];
    const n = parseInt(r, 10);
    return isNaN(n) ? null : n;
  }
  S.ageOf = ageOf;
  S.DEFAULT_RULES = { restrict: true, maxAge: 12, unrated: 'hide', libraries: null, pinToLeave: true, multiview: false };

  const STEPS = [
    ['Sign in with Plex', 'Use your Plex account'],
    ['Choose a server', 'Pick whose library to watch'],
    ['Pick libraries', 'Hide the ones you do not use'],
    ['Choose profile', 'Plex Home users on that server']
  ];

  class App {
    constructor() {
      this.main = document.getElementById('main');
      this.rail = document.getElementById('rail');
      this.history = [];
      this.homeUsers = [];
      this.profile = null;
    }

    async init() {
      this.settings = await sofa.getSettings();
      this.plex = new Plex(this.settings.clientId);
      this.player = new Player(this);
      this.multiview = new S.MultiView(this);
      this.palette = new S.Palette(this);
      document.addEventListener('keydown', (e) => this.onKey(e));

      const token = await sofa.getToken();
      if (!token) return this.onboarding(1);
      this.plex.token = this.plex.accountToken = token;
      try {
        this.user = await this.plex.user();
      } catch (e) {
        if (e.status === 401) { await sofa.setToken(null); return this.onboarding(1); }
        return this.showMessage('Cannot reach plex.tv', 'Check your internet connection.', () => this.init());
      }
      if (!this.settings.serverId) return this.onboarding(2);
      await this.reconnect();
    }

    saveSettings(patch) {
      Object.assign(this.settings, patch);
      sofa.setSettings(patch);
    }

    onKey(e) {
      if (document.body.classList.contains('playing') || document.body.classList.contains('bare')) return;
      if (this.palette.isOpen || this.multiview.isOpen || document.querySelector('.modal-bg')) return;
      const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
      if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (e.key === '/' && !typing)) {
        e.preventDefault();
        this.palette.open();
      } else if (e.key === 'Backspace' && !typing) {
        this.back();
      } else if (!sofa.tv && this.current?.name === 'home' && !typing && this.homeKeys) {
        this.homeKeys(e);
      }
    }

    // ---------- bare screens ----------
    bare(...children) {
      document.body.classList.add('bare');
      this.rail.replaceChildren();
      this.main.replaceChildren(...children);
    }

    showMessage(title, msg, retry) {
      this.bare(h('div.center', h('div.panel', h('h2', title), h('p.muted', msg), retry ? btn('Try again', { kind: 'primary', onclick: retry }) : null)));
    }

    lockup(size) {
      return h('div.lockup', { style: { fontSize: size + 'px', gap: Math.round(size * 0.43) + 'px' } },
        h('img', { src: 'assets/logo-mark.svg', alt: '', style: { width: Math.round(size * 1.6) + 'px', height: Math.round(size * 1.6) + 'px' } }),
        'Buffer Zone');
    }

    // ---------- onboarding ----------
    onboarding(step, state = {}) {
      this.onb = { ...(this.onb || {}), ...state, step };
      const left = h('div.onb-left',
        this.lockup(28),
        h('div.onb-tag', 'A clean player for your friend\'s Plex server.'),
        h('div.steps', STEPS.map(([t, d], i) => {
          const n = i + 1;
          const cls = n < step ? '.done' : n === step ? '.cur' : '';
          const detail = n === 1 && this.user ? `Signed in as ${this.user.username || this.user.email}` : d;
          return h('div.step' + cls, h('div.step-dot', n < step ? icon('check', { size: 14, stroke: 3 }) : String(n)), h('div', h('div.step-t', t), h('div.step-d', detail)));
        })),
        h('div.onb-note', 'You sign in on the Plex website. This app never sees your password.'));
      const right = h('div.onb-right');
      this.bare(h('div.onb', left, right));
      right.append(h('div.onb-step', `Step ${step} of 4`));
      ({ 1: () => this.onbSignIn(right), 2: () => this.onbServers(right), 3: () => this.onbLibraries(right), 4: () => this.onbProfiles(right) })[step]();
    }

    onbSignIn(right) {
      if (sofa.tv) return this.onbSignInTV(right);
      const status = h('p.muted');
      const b = btn('Sign in with Plex', { kind: 'primary', size: 'lg', icon: 'arrow-right', onclick: () => this.login(b, status) });
      right.append(h('h1', 'Sign in with Plex'), h('p.onb-help', 'Your browser opens the Plex website. Sign in there, then come back here.'), b, h('div', { style: { marginTop: '14px' } }, status));
    }

    // TV: no browser to open, so the TV shows a short code for plex.tv/link on a phone or computer.
    async onbSignInTV(right) {
      const code = h('div.link-code', '· · · ·');
      const status = h('p.muted', 'Getting a code…');
      const again = btn('Get a new code', { onclick: () => this.onboarding(1) });
      right.append(h('h1', 'Sign in with Plex'), h('p.onb-help', 'On your phone or computer, open the address below and type the code.'),
        h('div.link-url', 'plex.tv/link'), code, status, again);
      again.focus();
      const token = this.linkToken = Symbol();
      try {
        const pin = await this.plex.createPin(false);
        code.textContent = String(pin.code || '').toUpperCase().split('').join(' ');
        status.textContent = 'Waiting for you to enter the code…';
        const until = Date.now() + 14 * 60 * 1000;
        while (Date.now() < until && this.linkToken === token) {
          await new Promise(r => setTimeout(r, 2000));
          const t = await this.plex.checkPin(pin.id).catch(() => null);
          if (t && this.linkToken === token) {
            await sofa.setToken(t);
            this.plex.token = this.plex.accountToken = t;
            this.user = await this.plex.user();
            return this.onboarding(2);
          }
        }
        if (this.linkToken === token) status.textContent = 'The code expired. Get a new code.';
      } catch (e) {
        status.textContent = 'Sign-in failed: ' + e.message;
      }
    }

    async login(b, status) {
      b.disabled = true;
      try {
        const pin = await this.plex.createPin();
        sofa.openExternal(this.plex.authUrl(pin.code));
        status.textContent = 'Your browser opened. Sign in there, then come back here.';
        const until = Date.now() + 10 * 60 * 1000;
        while (Date.now() < until) {
          await new Promise(r => setTimeout(r, 2000));
          const token = await this.plex.checkPin(pin.id).catch(() => null);
          if (token) {
            await sofa.setToken(token);
            this.plex.token = this.plex.accountToken = token;
            this.user = await this.plex.user();
            return this.onboarding(2);
          }
        }
        status.textContent = 'Sign-in timed out. Try again.';
      } catch (e) {
        status.textContent = 'Sign-in failed: ' + e.message;
      }
      b.disabled = false;
    }

    async onbServers(right) {
      right.append(h('h1', 'Choose a server'), h('p.onb-help', 'Servers shared with your Plex account. Friends\' servers are listed first.'));
      const list = h('div', h('div.loading', 'Looking for servers…'));
      const cont = btn('Continue', { kind: 'primary', size: 'lg', onclick: () => this.onbConnect(cont) });
      cont.append(icon('arrow-right', { size: 18 }));
      right.append(list, h('p.muted.small', 'Server not listed? Ask the owner to share a library with your Plex account.'),
        h('div.onb-actions', btn('Back', { kind: 'ghost', onclick: () => this.onboarding(1) }), cont));
      let servers;
      try { servers = await this.plex.resources(); }
      catch (e) { list.replaceChildren(h('p.muted', 'Cannot load servers: ' + e.message)); return; }
      servers.sort((a, b) => (a.owned === b.owned ? a.name.localeCompare(b.name) : a.owned ? 1 : -1));
      if (!servers.length) { list.replaceChildren(h('p.muted', 'Your account has no access to a Plex server.')); return; }
      this.onb.servers = servers;
      this.onb.selected = this.onb.selected || (servers.find(s => s.clientIdentifier === this.settings.serverId) || servers[0]).clientIdentifier;
      const rows = servers.map(s => {
        const st = h('span', pill('Checking', '', { dot: true }));
        const detail = h('div.srv-detail', s.owned ? 'Your server' : `Shared by ${s.sourceTitle || 'a friend'}`);
        const row = h('div.srv', { onclick: () => { this.onb.selected = s.clientIdentifier; rows.forEach(r => r.classList.toggle('sel', r === row)); } },
          h('span.radio'), h('div.srv-icon', icon('server', { size: 20 })),
          h('div', { style: { flex: 1, minWidth: 0 } }, h('div.srv-name', s.name), detail), st);
        row.classList.toggle('sel', s.clientIdentifier === this.onb.selected);
        this.plex.probe(s).then(c => {
          const base = s.owned ? 'Your server' : `Shared by ${s.sourceTitle || 'a friend'}`;
          if (!c) { st.replaceChildren(pill('Offline')); row.classList.add('off'); detail.textContent = base; }
          else if (c.relay) { st.replaceChildren(pill('Relay', 'accent')); detail.textContent = `${base} · via Plex relay (limited speed)`; }
          else { st.replaceChildren(pill('Online', 'ok')); detail.textContent = `${base} · ${c.local ? 'local network' : 'direct connection'}`; }
        });
        return row;
      });
      list.replaceChildren(...rows);
    }

    async onbConnect(b) {
      const res = (this.onb.servers || []).find(s => s.clientIdentifier === this.onb.selected);
      if (!res) return;
      b.disabled = true;
      try {
        await this.connect(res);
      } catch (e) {
        b.disabled = false;
        return toast(e.message);
      }
      this.onboarding(3);
    }

    onbLibraries(right) {
      right.append(h('h1', 'Pick libraries'), h('p.onb-help', `Libraries on ${this.plex.server.name}. Hidden libraries do not show in the app. You can change this later in Settings.`));
      const card = h('div.s-card', h('div.s-checks', this.sections.map(sec => S.checkEl(!this.settings.hiddenLibraries.includes(sec.key), sec.title, (on) => {
        const hidden = new Set(this.settings.hiddenLibraries);
        if (on) hidden.delete(sec.key); else hidden.add(sec.key);
        this.saveSettings({ hiddenLibraries: [...hidden] });
      }))));
      const cont = btn('Continue', { kind: 'primary', size: 'lg', onclick: () => (this.homeUsers.length > 1 ? this.onboarding(4) : this.enterApp()) });
      cont.append(icon('arrow-right', { size: 18 }));
      right.append(card, h('div.onb-actions', btn('Back', { kind: 'ghost', onclick: () => this.onboarding(2) }), cont));
    }

    onbProfiles(right) {
      right.append(h('h1', 'Choose profile'), h('p.onb-help', 'Plex Home users on your account. Each profile has its own watch history.'));
      right.append(this.profileTiles());
    }

    // ---------- server ----------
    async reconnect() {
      this.bare(h('div.center', h('div.spinner'), h('p.muted', 'Connecting…')));
      let servers;
      try { servers = await this.plex.resources(); }
      catch (e) { return this.showMessage('Cannot load servers', e.message, () => this.reconnect()); }
      const saved = servers.find(s => s.clientIdentifier === this.settings.serverId);
      if (!saved) return this.onboarding(2);
      try { await this.connect(saved); }
      catch (e) { return this.showMessage('Cannot connect', e.message, () => this.onboarding(2)); }
      // Profiles: ask "Who's watching?" when the account has Plex Home users.
      const last = this.homeUsers.find(u => u.id === this.settings.profileId);
      if (this.homeUsers.length > 1 && (!last || last.protected || !last.admin)) return this.showProfiles();
      this.enterApp();
    }

    async connect(resource) {
      await this.plex.connect(resource);
      this.saveSettings({ serverId: resource.clientIdentifier });
      this.sections = await this.plex.sections();
      this.homeUsers = await this.plex.homeUsers().catch(() => []);
      if (!this.profile) this.profile = this.homeUsers.find(u => u.admin) || { id: this.user.id, title: this.user.username, admin: true };
    }

    enterApp() {
      document.body.classList.remove('bare');
      this.buildRail();
      this.history = [];
      this.go('home', {}, { root: true });
      this.loadWatchlist();
    }

    // ---------- profiles & parental rules ----------
    // Managed Plex Home users get the default rules until the admin changes them.
    get rules() {
      if (!this.profile || this.profile.admin) return null;
      const saved = this.settings.profileRules?.[this.profile.id];
      if (saved) return { ...S.DEFAULT_RULES, ...saved };
      return this.profile.restricted ? S.DEFAULT_RULES : null;
    }
    sectionAllowed(key) {
      const r = this.rules;
      return !r || !r.libraries || r.libraries.includes(String(key));
    }
    itemAllowed(item) {
      const r = this.rules;
      if (!r) return true;
      if (item.librarySectionID && !this.sectionAllowed(item.librarySectionID)) return false;
      if (!r.restrict) return true;
      const rating = item.contentRating || item.grandparentContentRating;
      const age = ageOf(rating);
      if (age === null) return r.unrated !== 'hide';
      return age <= Number(r.maxAge ?? 12);
    }
    allow(items) { return (items || []).filter(i => this.itemAllowed(i)); }
    get multiviewAllowed() { const r = this.rules; return !r || !!r.multiview; }

    visibleSections() {
      return (this.sections || []).filter(s => !this.settings.hiddenLibraries.includes(s.key) && this.sectionAllowed(s.key));
    }
    groups() {
      const secs = this.visibleSections();
      const kids = secs.filter(s => /kid/i.test(s.title));
      return {
        movie: secs.filter(s => s.type === 'movie' && !kids.includes(s)),
        show: secs.filter(s => s.type === 'show' && !kids.includes(s)),
        kids
      };
    }

    // ---------- watchlist & pins ----------
    // Callers at the same time share one request, so they all get the same item objects.
    loadWatchlist() {
      if (this.wlLoading) return this.wlLoading;
      this.wlLoading = (async () => {
        try {
          this.watchlist = await this.plex.watchlist();
          this.watchGuids = new Set(this.watchlist.map(w => w.guid));
        } catch (e) {
          sofa.log('watchlist failed', String(e));
          this.watchlist = [];
          this.watchGuids = new Set();
        }
        return this.watchlist;
      })().finally(() => { this.wlLoading = null; });
      return this.wlLoading;
    }
    inWatchlist(item) { return !!(item?.guid && this.watchGuids?.has(item.guid)); }
    async toggleWatchlist(item) {
      if (!item.guid || !item.guid.startsWith('plex://')) return toast('This title cannot be added to the watchlist.');
      try {
        if (this.inWatchlist(item)) {
          await this.plex.removeFromWatchlist(item.guid);
          this.watchGuids.delete(item.guid);
          toast('Removed from watchlist');
        } else {
          await this.plex.addToWatchlist(item.guid);
          this.watchGuids.add(item.guid);
          toast('Added to watchlist');
        }
        this.watchlist = null;
      } catch (e) { toast('Watchlist failed: ' + e.message); }
    }
    isPinned(item) { return (this.settings.pinned || []).some(p => p.key === String(item.ratingKey)); }
    togglePin(item) {
      const list = (this.settings.pinned || []).filter(p => p.key !== String(item.ratingKey));
      if (list.length === (this.settings.pinned || []).length) list.push({ key: String(item.ratingKey), title: item.title, type: item.type });
      this.saveSettings({ pinned: list });
      toast(this.isPinned(item) ? 'Pinned to the sidebar' : 'Unpinned');
      this.buildRail();
    }

    // ---------- icon rail ----------
    buildRail() {
      const g = this.groups();
      const lastLib = (type, list) => {
        const id = this.settings.lastLibrary?.[type];
        return list.find(s => s.key === id)?.key || list[0]?.key;
      };
      const item = (name, label, key, onclick) => {
        const el = h('button.rail-item', { title: label, onclick }, icon(name, { size: 18 }));
        el.dataset.key = key;
        return el;
      };
      const items = [
        item('house', 'Home', 'home', () => this.go('home', {}, { root: true })),
        item('search', 'Search (Ctrl+F)', 'search', () => this.palette.open()),
        g.movie.length ? item('film', 'Movies', 'movie', () => this.go('library', { id: lastLib('movie', g.movie) }, { root: true })) : null,
        g.show.length ? item('tv', 'Series', 'show', () => this.go('library', { id: lastLib('show', g.show) }, { root: true })) : null,
        g.kids.length ? item('smile', 'Kids', 'kids', () => this.go('library', { id: lastLib('kids', g.kids) }, { root: true })) : null,
        item('bookmark', 'Watchlist', 'watchlist', () => this.go('watchlist', {}, { root: true })),
        this.multiviewAllowed ? item('layout-grid', 'Multi-view', 'multiview', () => this.multiview.open()) : null
      ];
      const pins = (this.settings.pinned || []).map(p => item('pin', p.title, 'pin:' + p.key, () => this.open({ ratingKey: p.key, type: p.type })));
      const name = this.profile?.title || this.user?.username || '?';
      this.rail.replaceChildren(...[
        h('div.rail-logo', { title: 'Home', onclick: () => this.go('home', {}, { root: true }) }, h('img', { src: 'assets/logo-mark.svg', alt: 'Buffer Zone' })),
        ...items,
        pins.length ? h('div.rail-div') : null,
        h('div.rail-pins', pins),
        h('div.spacer'),
        item('settings', 'Settings', 'settings', () => this.go('settings', {}, { root: true })),
        h('div.rail-div'),
        h('button.avatar', { title: `${name} · switch profile`, onclick: () => (this.homeUsers.length > 1 ? this.showProfiles() : this.go('settings', { page: 'account' }, { root: true })) }, name[0].toUpperCase())
      ].filter(Boolean));
      this.markRail();
    }

    markRail() {
      const cur = this.current;
      let key = cur?.name;
      if (cur?.name === 'library') {
        const sec = this.sections?.find(s => s.key === cur.args.id);
        key = sec && /kid/i.test(sec.title) ? 'kids' : sec?.type;
      } else if (cur && ['show', 'movie', 'collection'].includes(cur.name) && this.isPinned({ ratingKey: cur.args.key })) {
        key = 'pin:' + cur.args.key;
      }
      for (const el of this.rail.querySelectorAll('.rail-item')) el.classList.toggle('active', el.dataset.key === key);
    }

    // ---------- navigation ----------
    go(name, args = {}, { replace = false, root = false } = {}) {
      // Leaving the settings opened from the player (other than with Back) forgets the video to return to.
      if (root || name !== 'settings') this.resumeAfter = null;
      if (root) this.history = [];
      else if (this.current && !replace) this.history.push({ ...this.current, scroll: this.main.scrollTop });
      this.current = { name, args };
      this.render();
    }

    back() {
      const resume = this.current?.name === 'settings' ? this.resumeAfter : null;
      this.resumeAfter = null;
      const prev = this.history.pop();
      if (!prev) return;
      this.current = prev;
      this.render(prev.scroll);
      // Settings opened from the player: Back continues the video.
      if (resume) this.player.play(resume.item, resume.opts);
    }

    async render(scroll = 0) {
      const { name, args } = this.current;
      this.markRail();
      this.homeKeys = null;
      const token = (this.renderToken = Symbol());
      const view = h('div.view');
      this.main.replaceChildren(view);
      this.main.scrollTop = 0;
      try {
        await S.views[name].call(this, view, args, () => token === this.renderToken);
        if (scroll) requestAnimationFrame(() => { this.main.scrollTop = scroll; });
      } catch (e) {
        sofa.log('view error', name, String(e?.stack || e));
        if (token === this.renderToken) view.replaceChildren(h('div.empty', h('h2', 'Something went wrong'), h('p.muted', e.message), btn('Try again', { onclick: () => this.render() })));
      }
    }

    backButton(label) {
      if (!this.history.length) return null;
      return label
        ? btn(label, { kind: 'ghost', icon: 'arrow-left', onclick: () => this.back() })
        : S.iconBtn('arrow-left', { title: 'Back (Backspace)', cls: 'boxed', onclick: () => this.back() });
    }

    open(item) {
      if (item.type === 'movie') this.go('movie', { key: item.ratingKey });
      else if (item.type === 'show') this.go('show', { key: item.ratingKey });
      else if (item.type === 'season') this.go('show', { key: item.parentRatingKey, season: item.ratingKey });
      else if (item.type === 'episode') this.go('show', { key: item.grandparentRatingKey, season: item.parentRatingKey, focus: item.ratingKey });
      else if (item.type === 'collection') this.go('collection', { key: item.ratingKey });
    }

    onPlayerExit() {
      if (this.current && !document.body.classList.contains('bare')) this.render(this.main.scrollTop);
    }

    // ---------- playback ----------
    // A series or season resolves to its next episode.
    async resolvePlayable(item) {
      if (item.type !== 'show' && item.type !== 'season') return item;
      const leaves = await this.plex.allLeaves(item.type === 'show' ? item.ratingKey : item.parentRatingKey).catch(() => []);
      const eps = item.type === 'season' ? leaves.filter(e => e.parentRatingKey === item.ratingKey) : leaves;
      return eps.find(e => e.viewOffset && !e.viewCount) || eps.find(e => !e.viewCount) || eps[0] || null;
    }

    async play(item, { resume = true, ...opts } = {}) {
      item = await this.resolvePlayable(item);
      if (!item) return toast('Nothing to play.');
      const startAt = resume && item.viewOffset ? item.viewOffset / 1000 : 0;
      this.player.play(item, { startAt, ...opts });
    }
  }

  S.App = App;
  window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    window.app = app;
    app.init().catch(e => {
      sofa.log('init error', String(e?.stack || e));
      app.showMessage('Start-up failed', e.message, () => location.reload());
    });
  });
})();
