/*
  MUSD District Finder — withjuancarlos.com branded build
  Left rail (search + results) + persistent, pannable map showing
  all five MUSD trustee areas with borders at all times.

  Business logic (Census geocoding, ArcGIS resolution against the
  County's current District Look-up app) is unchanged from the
  original portable widget. Only presentation/layout and the
  "show all five areas before searching" behavior are new.
*/
class MusdDistrictFinder extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this.map = null;
    this.allAreasLayer = null;
    this.districtOutlineLayer = null;
    this.areaLabelsLayer = null;
    this.addressMarker = null;

    // Cached once the current official layer + all-five-area geometry
    // is resolved, so repeat lookups don't re-walk every County layer.
    this._workingLayer = null;
    this._baseGeojson = null;

    // Which area is highlighted because it matched a searched address,
    // and which area (if any) is being previewed by a tap/click.
    this._selectedAreaNumber = null;
    this._exploreAreaNumber = null;

    /*
      Current MUSD trustees as of September 2026.
    */
    this.MUSD_TRUSTEES = {
      1: 'Melissa "Missy" Bond',
      2: 'Franklin "Pete" Wood',
      3: 'Bianca Stoker',
      4: 'Christopher Curtis Claire',
      5: 'Roberta Joanna Meyers'
    };

    /*
      San Bernardino County ROV's "District Look-up by Address" page
      currently launches this ArcGIS Instant Apps Zone Lookup app.
      We resolve app -> Web Map -> operational layers at runtime.
    */
    this.COUNTY_ZONE_LOOKUP_APP_ID = "147ff78591d84f8fa440355f60583f8a";
    this._officialLookupLayers = null;

    this._suggestTimer = null;
    this._suggestRequestId = 0;
    this._activeSuggestion = -1;

    this.MUSD_2026 = {
      electionDate: "November 3, 2026",

      1: {
        contest: "Member, Governing Board Area 1 - Short Term",
        candidates: [
          { name: "Vadim Altschuler", surname: "Altschuler" },
          { name: 'Melissa "Missy" Bond', surname: "Bond" },
          { name: "Ruben Rodriguez", surname: "Rodriguez" }
        ]
      },

      2: { contest: null, candidates: [] },
      3: { contest: null, candidates: [] },
      4: { contest: null, candidates: [] },

      5: {
        contest: "Member, Governing Board Area 5",
        candidates: [
          { name: "Linda Hamilton", surname: "Hamilton" },
          { name: "Roberta Joanna Meyers", surname: "Meyers" },
          { name: "Juan Carlos Pineiro", surname: "Pineiro" }
        ]
      }
    };
  }

  connectedCallback() {
    this.render();
    this.cache();
    this.bind();

    // Draw all five trustee areas immediately, before any address
    // is entered, so people can orient themselves on the map.
    this.loadBaseAreas();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        crossorigin=""
      >

      <style>
        :host {
          --finder-font: "Source Sans 3", "Segoe UI", sans-serif;
          --finder-font-display: "Oswald", "Arial Narrow", sans-serif;
          --finder-font-condensed: "Barlow Condensed", "Arial Narrow", sans-serif;

          --finder-cream: #f9f1e3;
          --finder-cream-deep: #efe4d0;
          --finder-ink: #050505;
          --finder-navy: #102e52;
          --finder-navy-deep: #0a1f3a;
          --finder-white: #ffffff;
          --finder-muted: #445064;

          --finder-accent: var(--finder-navy);
          --finder-border: color-mix(in srgb, var(--finder-navy) 16%, transparent);
          --finder-line-muted: color-mix(in srgb, var(--finder-navy) 42%, transparent);

          display: block;
          width: 100%;
          height: 100%;
          min-height: 0;
          color: var(--finder-ink);
          font-family: var(--finder-font);
          line-height: 1.5;
        }

        * { box-sizing: border-box; }

        button, input { font: inherit; }

        button { -webkit-tap-highlight-color: transparent; }

        .app {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          min-height: 0;
        }

        @media (min-width: 900px) {
          .app { flex-direction: row; }
        }

        /* ---------- Rail ---------- */

        .rail {
          flex: 0 0 auto;
          background: var(--finder-cream);
          border-bottom: 1px solid var(--finder-border);
        }

        @media (min-width: 900px) {
          .rail {
            width: 400px;
            flex: 0 0 400px;
            height: 100%;
            overflow-y: auto;
            border-bottom: 0;
            border-right: 1px solid var(--finder-border);
          }
        }

        .rail-scroll {
          padding: clamp(22px, 4vw, 32px);
        }

        .rail-head {
          margin-bottom: 18px;
        }

        .eyebrow {
          margin: 0 0 0.4rem;
          font-family: var(--finder-font-condensed);
          font-weight: 700;
          font-size: 0.82rem;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--finder-navy);
        }

        h1, h2, h3, p, dl, dd, dt { margin-top: 0; }

        .rail-head h1 {
          margin: 0 0 0.6rem;
          font-family: var(--finder-font-display);
          font-weight: 700;
          font-size: clamp(1.7rem, 3vw, 2.15rem);
          line-height: 1.04;
          letter-spacing: 0.01em;
          text-transform: uppercase;
          color: var(--finder-ink);
        }

        .intro {
          margin: 0;
          max-width: 34rem;
          color: var(--finder-muted);
          font-size: 0.98rem;
        }

        .form {
          margin-top: 18px;
          display: grid;
          gap: 10px;
        }

        .input-shell {
          position: relative;
          min-width: 0;
        }

        .input {
          width: 100%;
          min-width: 0;
          min-height: 46px;
          padding: 11px 13px;
          border: 1px solid var(--finder-border);
          border-radius: 8px;
          outline: none;
          background: var(--finder-white);
          color: var(--finder-ink);
        }

        .input:focus {
          border-color: var(--finder-navy);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--finder-navy) 16%, transparent);
        }

        .suggestions {
          position: absolute;
          z-index: 3000;
          top: calc(100% + 5px);
          left: 0;
          right: 0;
          overflow: hidden;
          border: 1px solid var(--finder-border);
          border-radius: 8px;
          background: var(--finder-white);
          box-shadow: 0 12px 30px rgba(10, 20, 40, .16);
        }

        .suggestion {
          display: block;
          width: 100%;
          padding: 10px 12px;
          border: 0;
          border-bottom: 1px solid var(--finder-border);
          background: var(--finder-white);
          color: var(--finder-ink);
          cursor: pointer;
          text-align: left;
          line-height: 1.3;
        }

        .suggestion:last-child { border-bottom: 0; }

        .suggestion:hover,
        .suggestion.active {
          background: var(--finder-cream);
        }

        .suggestion-main {
          display: block;
          font-weight: 650;
        }

        .suggestion-note {
          display: block;
          margin-top: 2px;
          color: var(--finder-muted);
          font-size: .76rem;
        }

        .button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 48px;
          padding: 0.7rem 1.4rem;
          border: 2px solid var(--finder-navy);
          border-radius: 999px;
          background: var(--finder-navy);
          color: var(--finder-white);
          cursor: pointer;
          font-family: var(--finder-font-condensed);
          font-weight: 700;
          font-size: 1rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          transition: background .2s ease, transform .2s ease;
        }

        .button:hover { background: var(--finder-navy-deep); }

        .button:disabled {
          opacity: .55;
          cursor: wait;
          transform: none;
        }

        .help {
          margin: 10px 0 0;
          color: var(--finder-muted);
          font-size: 0.82rem;
        }

        .status {
          min-height: 1.25rem;
          margin-top: 8px;
          color: var(--finder-muted);
          font-size: 0.86rem;
        }

        .status.error { color: #a61b1b; }

        /* ---------- Results ---------- */

        .results {
          margin-top: 26px;
          padding-top: 22px;
          border-top: 1px solid var(--finder-border);
        }

        .address-bar {
          margin-bottom: 18px;
          padding: 10px 12px;
          border-radius: 8px;
          background: color-mix(in srgb, var(--finder-navy) 6%, var(--finder-cream));
          color: var(--finder-muted);
          font-size: 0.85rem;
          overflow-wrap: anywhere;
        }

        .address-bar strong { color: var(--finder-ink); }

        .answer-eyebrow {
          font-family: var(--finder-font-condensed);
          font-weight: 700;
          font-size: 0.78rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--finder-navy);
        }

        .area {
          margin: 0.2rem 0 0;
          font-family: var(--finder-font-display);
          font-weight: 700;
          font-size: clamp(2.4rem, 8vw, 3.1rem);
          line-height: 0.92;
          letter-spacing: -0.01em;
          text-transform: uppercase;
          color: var(--finder-navy-deep);
        }

        .incumbent {
          margin-top: 12px;
          color: var(--finder-muted);
          font-size: 0.92rem;
        }

        .incumbent-label { margin-right: 5px; }

        .incumbent strong {
          color: var(--finder-ink);
          font-weight: 700;
        }

        .candidates {
          margin-top: 22px;
          padding-top: 16px;
          border-top: 1px solid var(--finder-border);
        }

        .candidates h3 {
          margin-bottom: 6px;
          font-family: var(--finder-font-condensed);
          font-weight: 700;
          font-size: 1rem;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--finder-ink);
        }

        .candidate-list {
          margin: 10px 0 0;
          padding: 0;
          list-style: none;
          border-top: 1px solid var(--finder-border);
        }

        .candidate {
          padding: 8px 0;
          border-bottom: 1px solid var(--finder-border);
          font-weight: 600;
        }

        .contest-meta {
          margin: 8px 0 0;
          color: var(--finder-muted);
          font-size: 0.82rem;
        }

        .secondary {
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid var(--finder-border);
        }

        .secondary h3 {
          margin-bottom: 10px;
          font-family: var(--finder-font-condensed);
          font-weight: 700;
          font-size: 0.98rem;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--finder-ink);
        }

        .district-list {
          margin: 0;
          padding: 0;
          border-top: 1px solid var(--finder-border);
        }

        .district-row {
          display: grid;
          gap: 2px;
          padding: 9px 0;
          border-bottom: 1px solid var(--finder-border);
        }

        .district-row dt {
          color: var(--finder-navy);
          font-family: var(--finder-font-condensed);
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .district-row dd {
          font-weight: 650;
          font-size: 0.94rem;
        }

        details.sources {
          margin-top: 18px;
          color: var(--finder-muted);
          font-size: 0.8rem;
        }

        details.sources summary {
          width: fit-content;
          cursor: pointer;
          color: var(--finder-navy);
          font-weight: 650;
        }

        details.sources p {
          margin: 8px 0 0;
        }

        .hidden { display: none !important; }

        /* ---------- Map ---------- */

        .map-panel {
          position: relative;
          flex: 1 1 auto;
          min-width: 0;
          min-height: 62vh;
          background: #e9e4da;
        }

        @media (min-width: 900px) {
          .map-panel { min-height: 0; height: 100%; }
        }

        #map {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
        }

        .leaflet-container {
          width: 100%;
          height: 100%;
          background: #e9e4da;
          font-family: var(--finder-font);
        }

        .leaflet-tile {
          width: 256px !important;
          height: 256px !important;
          max-width: none !important;
          max-height: none !important;
        }

        .leaflet-interactive {
          transition: fill-opacity 150ms ease, stroke-width 150ms ease;
        }

        .address-pin-icon {
          background: transparent !important;
          border: 0 !important;
        }

        .address-pin {
          width: 18px;
          height: 18px;
          border: 3px solid var(--finder-cream);
          border-radius: 50%;
          background: var(--finder-navy);
          box-shadow:
            0 0 0 2px color-mix(in srgb, var(--finder-navy) 45%, transparent),
            0 3px 10px rgba(10, 20, 40, .35);
        }

        .map-key {
          padding: 6px 8px;
          border: 1px solid rgba(16, 46, 82, .16);
          border-radius: 7px;
          background: rgba(249, 241, 227, .95);
          box-shadow: 0 2px 8px rgba(16, 46, 82, .1);
          color: var(--finder-navy-deep);
          font: 600 12px/1.2 var(--finder-font);
        }

        .area-number-icon {
          background: transparent !important;
          border: 0 !important;
        }

        .area-number-label {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 46px;
          padding: 3px 7px;
          border: 1px solid color-mix(in srgb, var(--finder-navy) 35%, transparent);
          border-radius: 999px;
          background: color-mix(in srgb, var(--finder-cream) 92%, white);
          color: var(--finder-navy-deep);
          box-shadow: 0 1px 4px rgba(16, 46, 82, .1);
          font: 700 11px/1 var(--finder-font-condensed);
          letter-spacing: 0.03em;
          white-space: nowrap;
          cursor: pointer;
          pointer-events: auto;
          transition: background .15s ease, color .15s ease, border-color .15s ease;
        }

        .area-number-label.exploring {
          border-color: color-mix(in srgb, var(--finder-navy) 55%, transparent);
          background: color-mix(in srgb, var(--finder-navy) 18%, var(--finder-cream));
          color: var(--finder-navy-deep);
        }

        .area-number-label.selected {
          border-color: var(--finder-navy);
          background: var(--finder-navy);
          color: var(--finder-cream);
        }

        .map-loading {
          position: absolute;
          z-index: 600;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          max-width: calc(100% - 24px);
          padding: 7px 14px;
          border: 1px solid rgba(16, 46, 82, .14);
          border-radius: 999px;
          background: rgba(249, 241, 227, .96);
          color: var(--finder-navy-deep);
          font-family: var(--finder-font-condensed);
          font-weight: 650;
          font-size: 0.82rem;
          letter-spacing: 0.02em;
          text-align: center;
          box-shadow: 0 6px 18px rgba(16, 46, 82, .12);
        }

        .map-caption {
          position: absolute;
          z-index: 500;
          left: 10px;
          bottom: 10px;
          max-width: calc(100% - 20px);
          padding: 6px 9px;
          border: 1px solid rgba(16, 46, 82, .12);
          border-radius: 6px;
          background: rgba(249, 241, 227, .94);
          color: var(--finder-navy-deep);
          font-size: 11px;
          line-height: 1.3;
          pointer-events: none;
        }

        @media (max-width: 899px) {
          .rail-scroll { padding: 20px; }
        }
      </style>

      <div class="app">

        <aside class="rail">
          <div class="rail-scroll">

            <div class="rail-head">
              <p class="eyebrow">MUSD Trustee Area Locator</p>
              <h1>Find Your Trustee Area</h1>
              <p class="intro">
                Enter your home address to see your MUSD trustee area, current
                trustee, 2026 candidates, and the other districts that
                represent you.
              </p>
            </div>

            <form class="form" id="addressForm">
              <div class="input-shell">
                <input
                  class="input"
                  id="addressInput"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="1234 Example Rd, Joshua Tree, CA 92252"
                  aria-label="Home address"
                  aria-autocomplete="list"
                  aria-controls="addressSuggestions"
                  aria-expanded="false"
                  required
                >

                <div
                  class="suggestions hidden"
                  id="addressSuggestions"
                  role="listbox"
                  aria-label="Address suggestions"
                ></div>
              </div>

              <button class="button" id="lookupButton" type="submit">
                Find My Area
              </button>
            </form>

            <p class="help">Address is not stored by this page.</p>
            <div class="status" id="status" role="status" aria-live="polite"></div>

            <section class="results hidden" id="resultsSection">

              <div class="address-bar">
                Showing results for <strong id="normalizedAddress"></strong>
              </div>

              <div class="answer">
                <div class="answer-eyebrow">MUSD Trustee Area</div>
                <h2 class="area" id="areaValue">Area —</h2>

                <div class="incumbent">
                  <span class="incumbent-label">Current trustee</span>
                  <strong id="incumbentName">—</strong>
                </div>

                <section class="candidates">
                  <h3 id="candidateHeading">2026 candidates</h3>
                  <ul class="candidate-list" id="candidateList"></ul>
                  <p class="contest-meta" id="candidateNote"></p>
                </section>
              </div>

              <section class="secondary">
                <h3>Other districts</h3>

                <dl class="district-list">
                  <div class="district-row">
                    <dt>State · Lower</dt>
                    <dd id="stateLower">California Assembly · —</dd>
                  </div>

                  <div class="district-row">
                    <dt>State · Upper</dt>
                    <dd id="stateUpper">California Senate · —</dd>
                  </div>

                  <div class="district-row">
                    <dt>Federal · Lower</dt>
                    <dd id="federalLower">U.S. House · —</dd>
                  </div>

                  <div class="district-row">
                    <dt>Federal · Upper</dt>
                    <dd id="federalUpper">U.S. Senate · California statewide</dd>
                  </div>
                </dl>

                <details class="sources">
                  <summary>Data sources</summary>
                  <p>
                    Address matching and state/federal geography come from the
                    U.S. Census Bureau. MUSD trustee-area boundaries are
                    resolved from the current San Bernardino County Registrar
                    of Voters District Look-up app. Current trustee names are
                    based on MUSD and San Bernardino County public records.
                  </p>
                </details>
              </section>

            </section>

          </div>
        </aside>

        <div class="map-panel">
          <div
            id="map"
            aria-label="Map showing the Morongo Unified School District and its five trustee areas"
          ></div>

          <div class="map-loading hidden" id="mapLoading">
            Loading trustee area boundaries…
          </div>

          <div class="map-caption">
            Tap any area or its label to preview its boundary. After a
            search, your matched area stays highlighted and the dot marks
            your address.
          </div>
        </div>

      </div>
    `;
  }

  cache() {
    const $ = id => this.shadowRoot.getElementById(id);

    this.addressForm = $("addressForm");
    this.addressInput = $("addressInput");
    this.addressSuggestionsEl = $("addressSuggestions");
    this.lookupButton = $("lookupButton");
    this.statusEl = $("status");

    this.resultsSection = $("resultsSection");
    this.normalizedAddressEl = $("normalizedAddress");

    this.areaValueEl = $("areaValue");
    this.incumbentNameEl = $("incumbentName");
    this.candidateHeadingEl = $("candidateHeading");
    this.candidateListEl = $("candidateList");
    this.candidateNoteEl = $("candidateNote");

    this.stateLowerEl = $("stateLower");
    this.stateUpperEl = $("stateUpper");
    this.federalLowerEl = $("federalLower");
    this.federalUpperEl = $("federalUpper");

    this.mapEl = $("map");
    this.mapLoadingEl = $("mapLoading");
  }

  bind() {
    this.addressForm.addEventListener(
      "submit",
      event => this.handleLookup(event)
    );

    this.addressInput.addEventListener(
      "input",
      () => this.scheduleSuggestions()
    );

    this.addressInput.addEventListener(
      "keydown",
      event => this.handleSuggestionKeys(event)
    );

    this.addressInput.addEventListener(
      "blur",
      () => {
        // Keep the list alive long enough for a pointer click to land.
        setTimeout(() => this.hideSuggestions(), 140);
      }
    );
  }

  show(el) {
    el.classList.remove("hidden");
  }

  hide(el) {
    el.classList.add("hidden");
  }

  setStatus(message = "", isError = false) {
    this.statusEl.textContent = message;
    this.statusEl.classList.toggle("error", isError);
  }

  setBusy(isBusy) {
    this.lookupButton.disabled = isBusy;
    this.lookupButton.textContent = isBusy ? "Finding…" : "Find My Area";
    this.setAttribute("aria-busy", isBusy ? "true" : "false");
  }

  setMapLoading(isLoading, isError = false) {
    if (!this.mapLoadingEl) return;

    if (isLoading) {
      this.mapLoadingEl.textContent = "Loading trustee area boundaries…";
      this.show(this.mapLoadingEl);
      return;
    }

    if (isError) {
      this.mapLoadingEl.textContent =
        "Boundaries unavailable right now — you can still search your address.";
      this.show(this.mapLoadingEl);
      return;
    }

    this.hide(this.mapLoadingEl);
  }

  ensureCalifornia(address) {
    return /\bCA\b|\bCalifornia\b/i.test(address)
      ? address
      : `${address}, CA`;
  }

  /*
    U.S. Census browser-side geocoding using JSONP.
  */
  censusGeocode(address) {
    return new Promise((resolve, reject) => {
      const callback =
        "__census_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);

      const script = document.createElement("script");
      let timer;

      const cleanup = () => {
        clearTimeout(timer);
        try { delete window[callback]; } catch (_) {}
        script.remove();
      };

      window[callback] = data => {
        try {
          const matches = data?.result?.addressMatches || [];

          if (!matches.length) {
            cleanup();
            reject(new Error(
              "We couldn’t find that address. Try including the city and ZIP code."
            ));
            return;
          }

          const match = matches[0];
          const lat = Number(match.coordinates?.y);
          const lng = Number(match.coordinates?.x);

          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            cleanup();
            reject(new Error("The address matched, but its coordinates were unavailable."));
            return;
          }

          const result = {
            matchedAddress: match.matchedAddress || address,
            lat,
            lng,
            geographies: match.geographies || {}
          };

          cleanup();
          resolve(result);

        } catch (error) {
          cleanup();
          reject(error);
        }
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("The address service could not be reached."));
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error("The address lookup timed out. Please try again."));
      }, 15000);

      const params = new URLSearchParams({
        address: this.ensureCalifornia(address),
        benchmark: "Public_AR_Current",
        vintage: "Current_Current",
        format: "jsonp",
        callback
      });

      script.src =
        "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?" +
        params.toString();

      document.head.appendChild(script);
    });
  }

  /*
    Lightweight address proposals using the same Census geocoder.
  */
  censusAddressSuggestions(address) {
    return new Promise(resolve => {
      const callback =
        "__censusSuggest_" +
        Date.now() +
        "_" +
        Math.floor(Math.random() * 1000000);

      const script = document.createElement("script");
      let timer;

      const cleanup = () => {
        clearTimeout(timer);
        try { delete window[callback]; } catch (_) {}
        script.remove();
      };

      window[callback] = data => {
        const matches =
          data?.result?.addressMatches || [];

        cleanup();

        resolve(
          matches
            .slice(0, 5)
            .map(match => ({
              matchedAddress:
                match.matchedAddress || address,
              lat: Number(match.coordinates?.y),
              lng: Number(match.coordinates?.x)
            }))
            .filter(
              match =>
                match.matchedAddress &&
                Number.isFinite(match.lat) &&
                Number.isFinite(match.lng)
            )
        );
      };

      script.onerror = () => {
        cleanup();
        resolve([]);
      };

      timer = setTimeout(() => {
        cleanup();
        resolve([]);
      }, 7000);

      const params = new URLSearchParams({
        address: this.ensureCalifornia(address),
        benchmark: "Public_AR_Current",
        format: "jsonp",
        callback
      });

      script.src =
        "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" +
        params.toString();

      document.head.appendChild(script);
    });
  }

  scheduleSuggestions() {
    clearTimeout(this._suggestTimer);
    this._activeSuggestion = -1;

    const value = this.addressInput.value.trim();

    if (
      value.length < 7 ||
      !/\d/.test(value)
    ) {
      this.hideSuggestions();
      return;
    }

    const requestId = ++this._suggestRequestId;

    this._suggestTimer = setTimeout(
      async () => {
        const suggestions =
          await this.censusAddressSuggestions(value);

        if (requestId !== this._suggestRequestId) {
          return;
        }

        this.renderSuggestions(suggestions);
      },
      450
    );
  }

  renderSuggestions(suggestions) {
    this.addressSuggestionsEl.innerHTML = "";
    this._activeSuggestion = -1;

    const unique = [];
    const seen = new Set();

    for (const suggestion of suggestions) {
      const key =
        suggestion.matchedAddress.toUpperCase();

      if (seen.has(key)) continue;

      seen.add(key);
      unique.push(suggestion);
    }

    if (!unique.length) {
      this.hideSuggestions();
      return;
    }

    unique.forEach((suggestion, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion";
      button.setAttribute("role", "option");
      button.dataset.index = String(index);

      const main = document.createElement("span");
      main.className = "suggestion-main";
      main.textContent = suggestion.matchedAddress;

      const note = document.createElement("span");
      note.className = "suggestion-note";
      note.textContent = "Use this address";

      button.append(main, note);

      button.addEventListener(
        "mousedown",
        event => event.preventDefault()
      );

      button.addEventListener(
        "click",
        () => {
          this.addressInput.value =
            suggestion.matchedAddress;

          this.hideSuggestions();

          // Selecting a proposal is an explicit user choice, so run it.
          this.addressForm.requestSubmit();
        }
      );

      this.addressSuggestionsEl.appendChild(button);
    });

    this.show(this.addressSuggestionsEl);
    this.addressInput.setAttribute(
      "aria-expanded",
      "true"
    );
  }

  hideSuggestions() {
    this.hide(this.addressSuggestionsEl);
    this.addressSuggestionsEl.innerHTML = "";
    this.addressInput.setAttribute(
      "aria-expanded",
      "false"
    );
    this._activeSuggestion = -1;
  }

  suggestionButtons() {
    return [
      ...this.addressSuggestionsEl.querySelectorAll(
        ".suggestion"
      )
    ];
  }

  handleSuggestionKeys(event) {
    const buttons = this.suggestionButtons();

    if (!buttons.length) {
      return;
    }

    if (event.key === "Escape") {
      this.hideSuggestions();
      return;
    }

    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Enter"
    ) {
      return;
    }

    if (event.key === "Enter") {
      if (this._activeSuggestion >= 0) {
        event.preventDefault();
        buttons[this._activeSuggestion].click();
      }
      return;
    }

    event.preventDefault();

    const delta =
      event.key === "ArrowDown" ? 1 : -1;

    this._activeSuggestion =
      (
        this._activeSuggestion +
        delta +
        buttons.length
      ) % buttons.length;

    buttons.forEach((button, index) => {
      button.classList.toggle(
        "active",
        index === this._activeSuggestion
      );
    });
  }

  findGeographyGroup(geographies, predicate) {
    for (const [key, value] of Object.entries(geographies || {})) {
      if (predicate(key) && Array.isArray(value) && value.length) {
        return value[0];
      }
    }

    return null;
  }

  numberFromText(value) {
    if (!value) return null;
    const match = String(value).match(/\b(\d{1,3})\b/);
    return match ? match[1] : null;
  }

  legislativeInfo(geographies) {
    const state = this.findGeographyGroup(
      geographies,
      key => /^States$/i.test(key) || /\bStates\b/i.test(key)
    );

    const lower = this.findGeographyGroup(
      geographies,
      key =>
        /State Legislative District/i.test(key) &&
        /Lower/i.test(key)
    );

    const upper = this.findGeographyGroup(
      geographies,
      key =>
        /State Legislative District/i.test(key) &&
        /Upper/i.test(key)
    );

    const congress = this.findGeographyGroup(
      geographies,
      key => /Congressional District/i.test(key)
    );

    return {
      stateName: state?.NAME || "California",

      stateLower:
        lower?.BASENAME ||
        lower?.SLDLST ||
        this.numberFromText(lower?.NAME),

      stateUpper:
        upper?.BASENAME ||
        upper?.SLDUST ||
        this.numberFromText(upper?.NAME),

      congressional:
        congress?.BASENAME ||
        congress?.CD ||
        this.numberFromText(congress?.NAME)
    };
  }

  musdLabel(feature) {
    const props = feature?.properties || {};

    const explicitKeys = [
      "TrusteeArea",
      "TRUSTEE_AREA",
      "Trustee_Area",
      "trustee_area",
      "AREA",
      "Area",
      "area",
      "NAME",
      "Name",
      "name",
      "DISTRICT",
      "District",
      "district"
    ];

    for (const key of explicitKeys) {
      const value = props[key];

      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }

      if (
        typeof value === "number" &&
        /^(AREA|Area|area|DISTRICT|District|district)$/.test(key) &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 5
      ) {
        return String(value);
      }
    }

    for (const [key, value] of Object.entries(props)) {
      if (typeof value !== "string" || !value.trim()) continue;
      if (!/(trustee|district|area|name|label)/i.test(key)) continue;

      const s = value.trim();

      if (
        /\b(?:trustee\s*)?area\s*[1-5]\b/i.test(s) ||
        /\bdistrict\s*[1-5]\b/i.test(s) ||
        /^[1-5]$/.test(s)
      ) {
        return s;
      }
    }

    return null;
  }

  areaNumber(feature) {
    const label = this.musdLabel(feature);
    if (!label) return null;

    const patterns = [
      /\b(?:trustee\s*)?area\s*([1-5])\b/i,
      /\bdistrict\s*([1-5])\b/i,
      /^\s*([1-5])\s*$/
    ];

    for (const pattern of patterns) {
      const match = String(label).match(pattern);
      if (match) return Number(match[1]);
    }

    return null;
  }

  async fetchJson(url, label = "Request") {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `${label}: HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (data?.error) {
      throw new Error(
        `${label}: ` +
        (data.error.message || "ArcGIS error")
      );
    }

    return data;
  }

  collectArcgisItemIds(value, keyPath = "", out = []) {
    if (typeof value === "string") {
      if (/^[0-9a-f]{32}$/i.test(value)) {
        let score = 0;

        if (/web.?map/i.test(keyPath)) score += 20;
        if (/\bmap\b/i.test(keyPath)) score += 8;
        if (/item/i.test(keyPath)) score += 3;

        out.push({
          id: value,
          score,
          keyPath
        });
      }

      return out;
    }

    if (Array.isArray(value)) {
      value.forEach(
        (entry, index) =>
          this.collectArcgisItemIds(
            entry,
            `${keyPath}[${index}]`,
            out
          )
      );

      return out;
    }

    if (value && typeof value === "object") {
      Object.entries(value).forEach(
        ([key, entry]) =>
          this.collectArcgisItemIds(
            entry,
            keyPath ? `${keyPath}.${key}` : key,
            out
          )
      );
    }

    return out;
  }

  collectWebMapLayers(
    layers,
    parentTitle = "",
    parentUrl = "",
    out = []
  ) {
    for (const layer of layers || []) {
      const title =
        layer.title ||
        layer.name ||
        parentTitle ||
        "";

      let url =
        layer.url ||
        layer.serviceUrl ||
        "";

      if (
        !url &&
        parentUrl &&
        Number.isInteger(layer.id)
      ) {
        url =
          parentUrl.replace(/\/$/, "") +
          "/" +
          layer.id;
      }

      if (url) {
        out.push({
          title,
          parentTitle,
          url: url.replace(/\/$/, ""),
          definitionExpression:
            layer.layerDefinition
              ?.definitionExpression ||
            layer.definitionExpression ||
            ""
        });
      }

      if (layer.layers?.length) {
        this.collectWebMapLayers(
          layer.layers,
          title,
          url || parentUrl,
          out
        );
      }
    }

    return out;
  }

  async officialDistrictLayers() {
    if (this._officialLookupLayers) {
      return this._officialLookupLayers;
    }

    const appData = await this.fetchJson(
      `https://www.arcgis.com/sharing/rest/content/items/` +
      `${this.COUNTY_ZONE_LOOKUP_APP_ID}/data?f=json`,
      "County District Look-up app"
    );

    const candidates =
      this.collectArcgisItemIds(appData)
        .sort((a, b) => b.score - a.score);

    const seen = new Set();
    const webMapIds = [];

    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);

      try {
        const meta = await this.fetchJson(
          `https://www.arcgis.com/sharing/rest/content/items/` +
          `${candidate.id}?f=json`,
          "ArcGIS item"
        );

        if (meta.type === "Web Map") {
          webMapIds.push(candidate.id);
        }
      } catch (_) {}

      if (webMapIds.length >= 4) break;
    }

    if (!webMapIds.length) {
      throw new Error(
        "Could not resolve the current County District Look-up map."
      );
    }

    const layers = [];

    for (const webMapId of webMapIds) {
      const webMap = await this.fetchJson(
        `https://www.arcgis.com/sharing/rest/content/items/` +
        `${webMapId}/data?f=json`,
        "County District Look-up web map"
      );

      this.collectWebMapLayers(
        webMap.operationalLayers,
        "",
        "",
        layers
      );
    }

    const unique = [];
    const keys = new Set();

    for (const layer of layers) {
      const key =
        `${layer.url}|${layer.definitionExpression}`;

      if (keys.has(key)) continue;
      keys.add(key);
      unique.push(layer);
    }

    if (!unique.length) {
      throw new Error(
        "The County District Look-up map contained no queryable layers."
      );
    }

    unique.sort((a, b) => {
      const score = layer => {
        const text =
          `${layer.title} ${layer.parentTitle}`;

        let value = 0;

        if (/morongo/i.test(text)) value += 20;
        if (/school/i.test(text)) value += 8;
        if (/trustee|governing/i.test(text)) value += 8;
        if (/district/i.test(text)) value += 4;

        return value;
      };

      return score(b) - score(a);
    });

    this._officialLookupLayers = unique;
    return unique;
  }

  layerWhere(layer) {
    return layer.definitionExpression?.trim()
      ? `(${layer.definitionExpression})`
      : "1=1";
  }

  async queryLayerAtPoint(layer, lat, lng) {
    const params = new URLSearchParams({
      f: "geojson",
      where: this.layerWhere(layer),
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326"
    });

    return this.fetchJson(
      `${layer.url}/query?${params.toString()}`,
      layer.title || "County district layer"
    );
  }

  async queryLayerInMorongo(layer) {
    const envelope = {
      xmin: -117.05,
      ymin: 33.68,
      xmax: -115.25,
      ymax: 34.62,
      spatialReference: { wkid: 4326 }
    };

    const params = new URLSearchParams({
      f: "geojson",
      where: this.layerWhere(layer),
      geometry: JSON.stringify(envelope),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
      resultRecordCount: "2000"
    });

    return this.fetchJson(
      `${layer.url}/query?${params.toString()}`,
      layer.title || "County district layer"
    );
  }

  featureText(feature) {
    return Object.entries(
      feature?.properties || {}
    )
      .filter(
        ([, value]) =>
          value !== null &&
          value !== undefined
      )
      .map(
        ([key, value]) =>
          `${key}:${String(value)}`
      )
      .join(" ");
  }

  currentAreaNumber(feature) {
    const props = feature?.properties || {};

    const explicitKeys = [
      "TrusteeArea",
      "TRUSTEE_AREA",
      "Trustee_Area",
      "trustee_area",
      "AREA",
      "Area",
      "area",
      "DISTRICT",
      "District",
      "district",
      "DIVISION",
      "Division",
      "division",
      "NAME",
      "Name",
      "name",
      "LABEL",
      "Label",
      "label"
    ];

    const parse = value => {
      if (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 5
      ) {
        return value;
      }

      if (typeof value !== "string") {
        return null;
      }

      const patterns = [
        /\b(?:trustee\s*)?area\s*([1-5])\b/i,
        /\bdistrict\s*([1-5])\b/i,
        /\bdivision\s*([1-5])\b/i,
        /^\s*([1-5])\s*$/
      ];

      for (const pattern of patterns) {
        const match = value.match(pattern);
        if (match) return Number(match[1]);
      }

      return null;
    };

    for (const key of explicitKeys) {
      if (props[key] === undefined) continue;

      const value = parse(props[key]);

      if (value) return value;
    }

    for (const [key, value] of Object.entries(props)) {
      if (
        typeof value !== "string" ||
        !/(trustee|area|district|division|name|label)/i.test(key)
      ) {
        continue;
      }

      const parsed = parse(value);
      if (parsed) return parsed;
    }

    return null;
  }

  featureIsMorongo(feature, layer) {
    const titleText =
      `${layer.title || ""} ${layer.parentTitle || ""}`;

    if (/morongo/i.test(titleText)) {
      return true;
    }

    return /morongo\s+unified|morongo.*school/i.test(
      this.featureText(feature)
    );
  }

  /*
    Build a clean FeatureCollection with exactly the five validated
    trustee areas from a basin-wide query, or null if this layer
    doesn't actually contain all five MUSD areas.
  */
  buildCleanAreas(layer, basinData) {
    const clean = [];

    for (const original of basinData?.features || []) {
      const area = this.currentAreaNumber(original);

      if (!area) continue;

      if (!this.featureIsMorongo(original, layer)) {
        continue;
      }

      clean.push({
        type: "Feature",
        properties: {
          ...(original.properties || {}),
          __trusteeArea: area
        },
        geometry: original.geometry
      });
    }

    const present = new Set(
      clean.map(
        feature => Number(feature.properties.__trusteeArea)
      )
    );

    const hasAllFive =
      [1, 2, 3, 4, 5].every(area => present.has(area));

    if (!hasAllFive) return null;

    return {
      type: "FeatureCollection",
      features: clean
    };
  }

  /*
    Resolve the current official layer + all-five-area geometry once,
    independent of any address. Used to draw the base map immediately.
  */
  async resolveBaseAreas() {
    if (this._baseGeojson && this._workingLayer) {
      return { geojson: this._baseGeojson, layer: this._workingLayer };
    }

    const layers = await this.officialDistrictLayers();

    for (const layer of layers) {
      let basinData;

      try {
        basinData = await this.queryLayerInMorongo(layer);
      } catch (_) {
        continue;
      }

      const geojson = this.buildCleanAreas(layer, basinData);
      if (!geojson) continue;

      this._workingLayer = layer;
      this._baseGeojson = geojson;

      return { geojson, layer };
    }

    throw new Error(
      "Could not resolve the current MUSD trustee area boundaries."
    );
  }

  /*
    Resolve current MUSD trustee geometry AND the area for a specific
    point, directly from the same layers used by the County's current
    District Look-up app. Used as the robust fallback path.
  */
  async officialMusdAreasForPoint(lat, lng) {
    const layers = await this.officialDistrictLayers();

    for (const layer of layers) {
      let pointData;

      try {
        pointData = await this.queryLayerAtPoint(layer, lat, lng);
      } catch (_) {
        continue;
      }

      const pointHits =
        (pointData?.features || [])
          .map(feature => ({
            feature,
            area: this.currentAreaNumber(feature),
            morongo: this.featureIsMorongo(feature, layer)
          }))
          .filter(hit => hit.area && hit.morongo);

      if (!pointHits.length) {
        continue;
      }

      let basinData;

      try {
        basinData = await this.queryLayerInMorongo(layer);
      } catch (_) {
        continue;
      }

      const geojson = this.buildCleanAreas(layer, basinData);
      if (!geojson) continue;

      // Cache this as the working layer/geometry for future fast lookups.
      this._workingLayer = layer;
      this._baseGeojson = geojson;

      return {
        areaNumber: pointHits[0].area,
        geojson,
        sourceLayerTitle:
          layer.title || layer.parentTitle || "County district layer"
      };
    }

    throw new Error(
      "The current County District Look-up did not return an MUSD trustee area for this address."
    );
  }

  /*
    Fast path for an address once a working layer is already cached.
    Returns a trustee area number, or null if it can't be determined
    from the cached layer (caller should fall back to the full search).
  */
  async fastAreaNumberForPoint(lat, lng) {
    if (!this._workingLayer) return null;

    let pointData;

    try {
      pointData = await this.queryLayerAtPoint(this._workingLayer, lat, lng);
    } catch (_) {
      return null;
    }

    const hit = (pointData?.features || [])
      .map(feature => ({
        area: this.currentAreaNumber(feature),
        morongo: this.featureIsMorongo(feature, this._workingLayer)
      }))
      .find(entry => entry.area && entry.morongo);

    return hit ? hit.area : null;
  }

  async loadBaseAreas() {
    this.setMapLoading(true);

    try {
      const { geojson } = await this.resolveBaseAreas();
      this.renderMap(geojson, null, null, null, null);
      this.setMapLoading(false);
    } catch (error) {
      console.warn("Could not load base MUSD boundaries:", error);
      this.setMapLoading(false, true);
    }
  }

  renderIncumbent(areaNumber) {
    const trustee = this.MUSD_TRUSTEES[areaNumber];

    this.incumbentNameEl.textContent =
      trustee || "Information unavailable";
  }

  renderCandidates(areaNumber) {
    const info = this.MUSD_2026[areaNumber];

    this.candidateListEl.innerHTML = "";

    if (!info?.contest) {
      this.candidateHeadingEl.textContent = "2026 MUSD election";
      this.candidateNoteEl.textContent =
        "No MUSD trustee contest for this area is listed in the current November 3, 2026 candidate list.";
      return;
    }

    this.candidateHeadingEl.textContent = "2026 candidates";

    [...info.candidates]
      .sort((a, b) =>
        a.surname.localeCompare(b.surname, "en", { sensitivity: "base" })
      )
      .forEach(candidate => {
        const li = document.createElement("li");
        li.className = "candidate";
        li.textContent = candidate.name;
        this.candidateListEl.appendChild(li);
      });

    this.candidateNoteEl.textContent =
      `${info.contest} · ${this.MUSD_2026.electionDate}`;
  }

  renderLegislative(info) {
    this.stateLowerEl.textContent = info.stateLower
      ? `California Assembly · District ${info.stateLower}`
      : "California Assembly · unavailable";

    this.stateUpperEl.textContent = info.stateUpper
      ? `California Senate · District ${info.stateUpper}`
      : "California Senate · unavailable";

    this.federalLowerEl.textContent = info.congressional
      ? `U.S. House · District ${info.congressional}`
      : "U.S. House · unavailable";

    this.federalUpperEl.textContent =
      `U.S. Senate · ${info.stateName || "California"} statewide`;
  }

  initMap() {
    if (this.map) return;

    // Center on the Morongo Basin so tiles render immediately, even
    // before the trustee-area geometry has finished resolving.
    this.map = L.map(this.mapEl, {
      zoomControl: true,
      attributionControl: true
    }).setView([34.13, -116.35], 10);

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }
    ).addTo(this.map);

    // Tapping empty map area (not a trustee area, not a marker) clears
    // whatever area is currently being previewed.
    this.map.on("click", () => {
      if (this._exploreAreaNumber != null) {
        this._exploreAreaNumber = null;
        this.restyleAreas();
      }
    });
  }

  cssVar(name, fallback) {
    const value = getComputedStyle(this).getPropertyValue(name).trim();
    return value || fallback;
  }

  /*
    Compute the Leaflet path style for a given trustee area number,
    based on both the searched-address match (this._selectedAreaNumber)
    and the tap-to-preview state (this._exploreAreaNumber).

    - Your matched area (after a search): solid navy border + fill.
    - A tapped/previewed area: light navy wash (~85% transparent) so
      you can see exactly what's in vs. out of that area.
    - Everything else: border only, with a near-invisible fill so the
      whole shape (not just the thin border) stays tappable.
  */
  areaStyleFor(n) {
    const accent = this.cssVar("--finder-accent", "#102e52");
    const lineMuted = this.cssVar("--finder-line-muted", "#6d7d94");

    const isYourArea =
      this._selectedAreaNumber != null && n === this._selectedAreaNumber;

    const isPreviewed =
      !isYourArea &&
      this._exploreAreaNumber != null &&
      n === this._exploreAreaNumber;

    if (isYourArea) {
      return {
        color: accent,
        weight: 3.25,
        opacity: 1,
        fill: true,
        fillColor: accent,
        fillOpacity: .2
      };
    }

    if (isPreviewed) {
      return {
        color: accent,
        weight: 2,
        opacity: .95,
        fill: true,
        fillColor: accent,
        // "85% transparent" -> 15% opaque: very light, but visible.
        fillOpacity: .15
      };
    }

    return {
      color: lineMuted,
      weight: 1.25,
      opacity: .82,
      fill: true,
      fillColor: accent,
      // Nearly invisible, but keeps the whole shape (not just the
      // stroke) tappable so people can preview any area.
      fillOpacity: .02
    };
  }

  /*
    Toggle the tap-to-preview highlight for one trustee area. Tapping
    the already-previewed area (or empty map) clears the preview.
  */
  toggleExploreArea(n) {
    this._exploreAreaNumber =
      this._exploreAreaNumber === n ? null : n;

    this.restyleAreas();
  }

  /*
    Re-apply styles/labels in place, without rebuilding the layers.
    Keeps tap-to-preview snappy and avoids re-fetching anything.
  */
  restyleAreas() {
    if (this.allAreasLayer) {
      this.allAreasLayer.eachLayer(layer => {
        const n = Number(layer.feature?.properties?.__trusteeArea);
        layer.setStyle(this.areaStyleFor(n));
      });
    }

    if (this.areaLabelsLayer) {
      this.areaLabelsLayer.eachLayer(marker => {
        const n = marker.__musdArea;
        if (!n) return;

        marker.setIcon(this.areaLabelIcon(n));
        marker.setZIndexOffset(this.areaLabelZIndex(n));
      });
    }
  }

  areaLabelIcon(n) {
    const isYourArea =
      this._selectedAreaNumber != null && n === this._selectedAreaNumber;

    const isPreviewed =
      !isYourArea && this._exploreAreaNumber === n;

    const stateClass = isYourArea
      ? " selected"
      : isPreviewed
        ? " exploring"
        : "";

    return L.divIcon({
      className: "area-number-icon",
      html:
        `<div class="area-number-label${stateClass}" role="button" ` +
        `aria-pressed="${isPreviewed}" tabindex="-1">Area ${n}</div>`,
      iconSize: [52, 20],
      iconAnchor: [26, 10]
    });
  }

  areaLabelZIndex(n) {
    const isYourArea =
      this._selectedAreaNumber != null && n === this._selectedAreaNumber;

    if (isYourArea) return 4500;

    const isPreviewed = this._exploreAreaNumber === n;
    return isPreviewed ? 3000 : 1800;
  }

  /*
    Draw all five trustee areas with borders. If areaNumber is given,
    that area is also filled/highlighted. If lat/lng are given, an
    address marker is placed and popped up.
  */
  renderMap(trusteeGeojson, lat, lng, areaNumber, address) {
    this.initMap();

    if (this.allAreasLayer) this.allAreasLayer.remove();
    if (this.districtOutlineLayer) this.districtOutlineLayer.remove();
    if (this.areaLabelsLayer) this.areaLabelsLayer.remove();
    if (this.addressMarker) {
      this.addressMarker.remove();
      this.addressMarker = null;
    }

    this._selectedAreaNumber = areaNumber != null ? areaNumber : null;

    // A fresh address search takes priority over whatever was being
    // tap-previewed, so the "your area" highlight reads cleanly.
    if (this._selectedAreaNumber != null) {
      this._exploreAreaNumber = null;
    }

    /*
      Non-selected, non-previewed areas: border only (plus a nearly
      invisible fill so the whole shape stays tappable).
      Previewed area (tapped): light navy wash.
      Your matched area (after a search): solid navy border + fill.
    */
    this.allAreasLayer = L.geoJSON(trusteeGeojson, {
      style: feature =>
        this.areaStyleFor(Number(feature?.properties?.__trusteeArea)),
      onEachFeature: (feature, layer) => {
        const n = Number(feature?.properties?.__trusteeArea);
        if (!n) return;

        layer.on("click", event => {
          L.DomEvent.stopPropagation(event);
          this.toggleExploreArea(n);
        });
      }
    }).addTo(this.map);

    /*
      Slightly stronger outer MUSD border generated from the union of
      the five trustee areas. Still no fill.
    */
    try {
      const districtUnion = turf.union(
        turf.featureCollection(trusteeGeojson.features)
      );

      if (districtUnion) {
        this.districtOutlineLayer = L.geoJSON(districtUnion, {
          interactive: false,
          style: {
            color: this.cssVar("--finder-navy-deep", "#0a1f3a"),
            weight: 2.15,
            opacity: .92,
            fill: false,
            fillOpacity: 0
          }
        }).addTo(this.map);
      }
    } catch (error) {
      console.warn("Could not create MUSD outer outline:", error);
    }

    /*
      Exactly one "Area N" label per trustee area, always shown so
      people can orient themselves even before searching.
    */
    this.areaLabelsLayer = L.layerGroup().addTo(this.map);

    for (let n = 1; n <= 5; n++) {
      const group = trusteeGeojson.features.filter(
        feature => Number(feature.properties.__trusteeArea) === n
      );

      if (!group.length) continue;

      let labelPoint;

      try {
        labelPoint = turf.pointOnFeature(
          turf.featureCollection(group)
        );
      } catch (error) {
        console.warn(`Could not place Area ${n} label:`, error);
        continue;
      }

      const coords = labelPoint?.geometry?.coordinates;
      if (!coords) continue;

      const [labelLng, labelLat] = coords;

      const marker = L.marker([labelLat, labelLng], {
        icon: this.areaLabelIcon(n),
        interactive: true,
        keyboard: true,
        alt: `Area ${n}`,
        zIndexOffset: this.areaLabelZIndex(n)
      });

      marker.__musdArea = n;

      marker.on("click", event => {
        L.DomEvent.stopPropagation(event);
        this.toggleExploreArea(n);
      });

      marker.addTo(this.areaLabelsLayer);
    }

    /*
      Address marker: only when a specific address has been searched.
    */
    if (lat != null && lng != null) {
      const pinIcon = L.divIcon({
        className: "address-pin-icon",
        html: `<div class="address-pin" aria-hidden="true"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });

      this.addressMarker = L.marker([lat, lng], {
        icon: pinIcon,
        zIndexOffset: 10000,
        keyboard: true,
        title: address || ""
      }).addTo(this.map);

      if (address) {
        this.addressMarker.bindPopup(
          `<strong>${this.escapeHtml(address)}</strong>` +
          (areaNumber != null
            ? `<br>MUSD Trustee Area ${areaNumber}`
            : "")
        );
      }
    }

    const bounds = this.allAreasLayer.getBounds();

    requestAnimationFrame(() => {
      this.map.invalidateSize({ pan: false });

      requestAnimationFrame(() => {
        this.map.invalidateSize({ pan: false });

        if (bounds.isValid()) {
          this.map.fitBounds(bounds, {
            padding: [24, 24],
            maxZoom: 11
          });
        } else if (lat != null && lng != null) {
          this.map.setView([lat, lng], 10);
        }
      });
    });
  }

  escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async handleLookup(event) {
    event.preventDefault();

    const raw = this.addressInput.value.trim();
    if (!raw) return;

    try {
      this.hideSuggestions();
      this.setBusy(true);
      this.setStatus("Finding your districts…");

      const geocoded = await this.censusGeocode(raw);

      // Fast path: reuse the already-resolved current layer/geometry.
      let areaNumber = await this.fastAreaNumberForPoint(
        geocoded.lat,
        geocoded.lng
      );
      let trusteeGeojson = this._baseGeojson;

      // Fallback: walk every County layer from scratch if needed.
      if (areaNumber == null || !trusteeGeojson) {
        const officialMusd = await this.officialMusdAreasForPoint(
          geocoded.lat,
          geocoded.lng
        );

        areaNumber = officialMusd.areaNumber;
        trusteeGeojson = officialMusd.geojson;
      }

      const legislative = this.legislativeInfo(
        geocoded.geographies
      );

      this.normalizedAddressEl.textContent =
        geocoded.matchedAddress;

      this.areaValueEl.textContent =
        `Area ${areaNumber}`;

      this.renderIncumbent(areaNumber);
      this.renderCandidates(areaNumber);
      this.renderLegislative(legislative);

      // Put the normalized result back into the input.
      this.addressInput.value = geocoded.matchedAddress;

      this.show(this.resultsSection);

      this.renderMap(
        trusteeGeojson,
        geocoded.lat,
        geocoded.lng,
        areaNumber,
        geocoded.matchedAddress
      );

      this.setStatus("");

      this.resultsSection.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

    } catch (error) {
      console.error(error);
      this.setStatus(
        error.message || "We couldn’t complete the lookup.",
        true
      );

    } finally {
      this.setBusy(false);
    }
  }
}

customElements.define("musd-district-finder", MusdDistrictFinder);
