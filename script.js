// script.js - Core OS Logic upgraded for PWA, IDB, & Dock

document.addEventListener('DOMContentLoaded', async () => {

  // --- 0. INDEXED DB WRAPPER (For saving large Blobs/Files) ---
  const DB_NAME = 'ObsidianOS_DB';
  function getDB() {
    return new Promise((resolve, reject) => {
      let req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => { e.target.result.createObjectStore('files'); };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e);
    });
  }
  async function saveFileDB(key, file) {
    let db = await getDB();
    db.transaction('files', 'readwrite').objectStore('files').put(file, key);
  }
  async function getFileDB(key) {
    let db = await getDB();
    return new Promise(res => {
      let req = db.transaction('files').objectStore('files').get(key);
      req.onsuccess = e => res(e.target.result);
      req.onerror = () => res(null);
    });
  }

  async function delFileDB(key) {
    let db = await getDB();
    return new Promise(res => {
      let req = db.transaction('files', 'readwrite').objectStore('files').delete(key);
      req.onsuccess = () => res(true);
      req.onerror = () => res(false);
    });
  }

  // --- 0.5 SYSTEM MODAL HELPER ---
  const modalEl = document.getElementById('os-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalMsg = document.getElementById('modal-message');
  const modalConfirmBtn = document.getElementById('modal-confirm');
  const modalCancelBtn = document.getElementById('modal-cancel');
  let currentModalAction = null;

  function showOSModal(title, message, onConfirm, confirmText = "Confirm") {
    if (!modalEl) return;
    modalTitle.textContent = title;
    modalMsg.textContent = message;
    modalConfirmBtn.textContent = confirmText;
    currentModalAction = onConfirm;
    modalEl.classList.add('open');
  }

  modalConfirmBtn?.addEventListener('click', () => {
    if (currentModalAction) currentModalAction();
    modalEl.classList.remove('open');
    currentModalAction = null;
  });

  modalCancelBtn?.addEventListener('click', () => {
    modalEl.classList.remove('open');
    currentModalAction = null;
  });

  // --- 1. STATE & LOCALSTORAGE ---
  const STORAGE_KEY = 'obsidian_os_state';
  let defaultState = {
    theme: 'default',
    globalFont: 'var(--font-body)',
    dockPosition: 'left',
    focusMode: 'all',
    bgUrl: '', // if URL
    hasDbBg: false, // Flag if we should look in IDB
    isBgVideo: false, // Track if current background is a video (crucial for blobs)
    profileUrl: 'https://via.placeholder.com/100.png?text=U',
    hasDbProfile: false,
    spotifyUrl: 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M',
    notepadText: '',
    notepadText: '',
    gridSnap: false,
    editMode: false,
    widgets: {}, // bounds & zIndex
    wifiVisible: true,
    is24Hour: true,
    cursorEffectsEnabled: true,
    clockFont: 'inherit',
    customFonts: [], // { name, family, blobKey }
    workspaces: [
      { id: 'w1', name: 'General', links: [
        { id:'l1', title:'GitHub', url:'https://github.com', iconType:'material', iconVal:'code', isFav:true },
        { id:'l2', title:'YouTube', url:'https://youtube.com', iconType:'auto', iconVal:'', isFav:true }
      ]}
    ],
    recentActivity: [],
    isPaused: false,
    bgVideoTime: 0,
    legibilityMode: false,
    linkTarget: '_self'
  };

  let state = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (!state) state = defaultState;
  
  // Patch old states
  if (!state.workspaces) state.workspaces = defaultState.workspaces;
  if (state.globalFont === undefined) state.globalFont = defaultState.globalFont;
  if (state.dockPosition === undefined) state.dockPosition = defaultState.dockPosition;
  if (state.recentActivity === undefined) state.recentActivity = [];
  if (state.wifiVisible === undefined) state.wifiVisible = defaultState.wifiVisible;
  if (state.is24Hour === undefined) state.is24Hour = defaultState.is24Hour;
  if (state.clockFont === undefined) state.clockFont = defaultState.clockFont;
  if (state.customFonts === undefined) state.customFonts = defaultState.customFonts;

  if (state.isPaused === undefined) state.isPaused = false;
  if (state.bgVideoTime === undefined) state.bgVideoTime = 0;
  if (state.legibilityMode === undefined) state.legibilityMode = false;
  if (state.linkTarget === undefined) state.linkTarget = '_self';

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderDock();
    renderWorkspaceLinks();
  }

  // --- 2. LOAD DB FILES & FONTS BEFORE UI BINDING ---
  const bgImgEl = document.getElementById('custom-bg-img');
  const bgVidEl = document.getElementById('custom-bg-video');
  const profileImgEl = document.getElementById('profile-icon-img');

  async function loadCustomFont(name, family, blob) {
    try {
      const fontFace = new FontFace(family, await blob.arrayBuffer());
      await fontFace.load();
      document.fonts.add(fontFace);
      
      const globalGrp = document.getElementById('global-custom-fonts-group');
      const clockGrp = document.getElementById('clock-custom-fonts-group');
      const managerSelect = document.getElementById('custom-font-manager-dropdown');
      
      const familyValue = `'${family}', cursive`;
      
      [globalGrp, clockGrp].forEach(grp => {
        if (!grp) return;
        const opt = document.createElement('option');
        opt.value = familyValue;
        opt.textContent = name;
        opt.dataset.family = family;
        grp.appendChild(opt);
      });

      if (managerSelect) {
        if (managerSelect.options[0]?.value === "") managerSelect.innerHTML = "";
        const opt = document.createElement('option');
        opt.value = family;
        opt.textContent = name;
        managerSelect.appendChild(opt);
      }
      console.log(`Loaded custom font: ${name}`);
    } catch (e) {
      console.error(`Failed to load font ${name}:`, e);
    }
  }

  const bgVidControlBtn = document.getElementById('bg-video-control');
  const legibilityToggleBtn = document.getElementById('legibility-toggle');

  function updateVideoControlUI() {
    if (!bgVidControlBtn) return;
    bgVidControlBtn.textContent = state.isPaused ? 'play_arrow' : 'pause';
    bgVidControlBtn.title = state.isPaused ? 'Play Background' : 'Pause Background';
  }

  function toggleVideoPlayback() {
    if (!bgVidEl) return;
    if (state.isPaused) {
      bgVidEl.play().catch(e => console.warn("Failed to play video:", e));
      state.isPaused = false;
    } else {
      bgVidEl.pause();
      state.isPaused = true;
      state.bgVideoTime = bgVidEl.currentTime; // Save current timestamp
    }
    updateVideoControlUI();
    saveState();
  }

  function toggleLegibility() {
    state.legibilityMode = !state.legibilityMode;
    document.body.classList.toggle('legibility-mode', state.legibilityMode);
    legibilityToggleBtn?.classList.toggle('active', state.legibilityMode);
    saveState();
  }

  // Initial Legibility Apply
  if (state.legibilityMode) {
    document.body.classList.add('legibility-mode');
    legibilityToggleBtn?.classList.add('active');
  }

  bgVidControlBtn?.addEventListener('click', toggleVideoPlayback);
  legibilityToggleBtn?.addEventListener('click', toggleLegibility);

  function applyBgUrl(url, forceVideo = false) {
    if (!url) {
      bgImgEl.style.opacity = 0; bgVidEl.style.opacity = 0; bgVidEl.src = ''; return;
    }
    
    // Sanitize local Windows paths if they are pasted as strings: F:\... -> file:///F:/...
    let sanitizedUrl = url;
    if (url.match(/^[a-zA-Z]:\\/) || url.includes('\\')) {
      sanitizedUrl = 'file:///' + url.replace(/\\/g, '/');
    }

    // Improved regex: check for video extensions before any query parameters
    const isVideo = forceVideo || sanitizedUrl.split('?')[0].match(/\.(mp4|webm|ogg|mov)$/i) || sanitizedUrl.startsWith('blob:video'); 
    
    if (isVideo) {
      document.body.classList.add('bg-video-active');
      bgImgEl.style.display = 'none'; // fully hide image element so video is definitely visible
      bgVidEl.style.display = 'block';
      if (bgVidControlBtn) bgVidControlBtn.style.display = 'flex';
      
      bgVidEl.src = sanitizedUrl; 
      bgVidEl.style.opacity = 1;

      // Handle persistence
      bgVidEl.onloadedmetadata = () => {
        if (state.bgVideoTime) bgVidEl.currentTime = state.bgVideoTime;
        if (state.isPaused) {
          bgVidEl.pause();
        } else {
          bgVidEl.play().catch(e => {
            console.warn('Video failed to play. Browsers block local file paths for security.', e);
          });
        }
        updateVideoControlUI();
      };
    } else {
      document.body.classList.remove('bg-video-active');
      bgVidEl.style.display = 'none';
      bgVidEl.src = ''; 
      if (bgVidControlBtn) bgVidControlBtn.style.display = 'none';
      bgImgEl.style.display = 'block';
      bgImgEl.style.backgroundImage = `url("${sanitizedUrl}")`; 
      bgImgEl.style.backgroundSize = 'cover';
      bgImgEl.style.backgroundPosition = 'center';
      bgImgEl.style.opacity = 1;
    }
  }

  // --- 2.5 CLEAR VIDEO STATE ON RESET ---
  const originalApplyBgUrl = applyBgUrl;
  // (No change needed to applyBgUrl above, but adding a reset handler for cleanliness)

  // Init Background
  if (state.hasDbBg) {
    getFileDB('background').then(f => {
       if (f) applyBgUrl(URL.createObjectURL(f), state.isBgVideo);
    });
  } else if (state.bgUrl) {
    applyBgUrl(state.bgUrl, state.isBgVideo);
    document.getElementById('bg-url-input').value = state.bgUrl;
  }

  // Init Profile
  if (state.hasDbProfile) {
    let f = await getFileDB('profile');
    if (f) profileImgEl.src = URL.createObjectURL(f);
  } else if (state.profileUrl) {
    profileImgEl.src = state.profileUrl;
    document.getElementById('profile-img-url').value = state.profileUrl;
  }

  // Init Custom Fonts
  for (const f of state.customFonts) {
    const blob = await getFileDB(f.blobKey);
    if (blob) await loadCustomFont(f.name, f.family, blob);
  }

  // --- 3. APPLY SETTINGS ---
  document.body.setAttribute('data-theme', state.theme);
  document.getElementById('theme-selector').value = state.theme;

  document.body.style.fontFamily = state.globalFont;
  document.getElementById('global-font-selector').value = state.globalFont;

  document.documentElement.style.setProperty('--font-clock', state.clockFont);
  document.getElementById('clock-font-selector').value = state.clockFont;

  const dockEl = document.getElementById('dynamic-dock');
  dockEl.className = `os-dock ${state.dockPosition}`;
  document.getElementById('dock-position').value = state.dockPosition;

  const spotifyEl = document.getElementById('spotify-iframe');
  if (state.spotifyUrl) {
    spotifyEl.src = state.spotifyUrl;
    document.getElementById('spotify-url-input').value = state.spotifyUrl;
  }

  const notepadEl = document.getElementById('notepad-input');
  if (state.notepadText) notepadEl.value = state.notepadText;

  document.getElementById('grid-snap-toggle').checked = state.gridSnap;
  
  document.getElementById('grid-snap-toggle').checked = state.gridSnap;

  // --- 4. WIDGET DRAGGING & FOCUS MODES ---
  const widgets = document.querySelectorAll('#workspace .glass-widget');
  let highestZ = 100;

  function applyWidgetVisibility() {
    widgets.forEach(widget => {
      const id = widget.id;
      
      // If no saved state, capture INITIAL rendered position before JS touches anything.
      if (!state.widgets[id]) {
        const rect = widget.getBoundingClientRect();
        state.widgets[id] = {
          top: rect.top + 'px',
          left: rect.left + 'px',
          transform: window.getComputedStyle(widget).transform, // capture initial transform (like 50% center)
          width: null,
          height: null,
          zIndex: highestZ++,
          visible: true
        };
      }

      // CRITICAL: Clear bottom/right properties to avoid "stretching" when top/left are applied.
      widget.style.bottom = 'auto';
      widget.style.right = 'auto';
      
      widget.style.top = state.widgets[id].top;
      widget.style.left = state.widgets[id].left;
      widget.style.zIndex = state.widgets[id].zIndex;
      
      // RESTORE TRANSFORM (fixes the jumping/offset issue on refresh)
      if (state.widgets[id].transform) {
          widget.style.transform = state.widgets[id].transform;
      } else {
          // Migration: if transform is missing but widget exists, capture it now
          state.widgets[id].transform = window.getComputedStyle(widget).transform;
      }
      
      // Restore saved dimensions if present
      if (state.widgets[id].width) widget.style.width = state.widgets[id].width;
      if (state.widgets[id].height) widget.style.height = state.widgets[id].height;
      
      // Check Focus Mode overrides
      let isVisible = state.widgets[id].visible;
      if (state.focusMode === 'study') {
        const allowed = ['widget-clock', 'widget-pomodoro', 'widget-notepad'];
        isVisible = allowed.includes(id) ? isVisible : false;
      } else if (state.focusMode === 'media') {
        const allowed = ['widget-clock', 'widget-spotify', 'widget-folders'];
        isVisible = allowed.includes(id) ? isVisible : false;
      } else if (state.focusMode === 'minimal') {
        const allowed = ['widget-clock', 'widget-search'];
        isVisible = allowed.includes(id) ? isVisible : false;
      }

      widget.style.display = isVisible ? 'flex' : 'none';
      const toggle = document.querySelector(`.widget-toggle[data-target="${id}"]`);
      if (toggle) toggle.checked = state.widgets[id].visible;

      if (state.widgets[id].zIndex > highestZ) highestZ = state.widgets[id].zIndex;
    });
  }
  applyWidgetVisibility();

  // --- ResizeObserver: persist widget size when resized in edit mode ---
  let resizeSaveTimer = null;
  const isObserverAvailable = typeof ResizeObserver !== 'undefined';
  if (isObserverAvailable) {
    const resizeObserver = new ResizeObserver(entries => {
      entries.forEach(entry => {
        const widget = entry.target;
        const id = widget.id;
        if (!state.widgets[id]) return;

        // RESPONSIVE FONT SCALING (For Clock) - Always run on resize/observation
        if (id === 'widget-clock') {
          const clockDisplay = document.getElementById('clock-display');
          if (clockDisplay) {
            const fontSize = Math.min(widget.offsetWidth / 3.5, widget.offsetHeight / 1.5);
            clockDisplay.style.fontSize = fontSize + 'px';
          }
        }

        if (!state.editMode) return; 
        
        // Capture pixel dimensions for persistence
        state.widgets[id].width = widget.offsetWidth + 'px';
        state.widgets[id].height = widget.offsetHeight + 'px';
      });
      // Debounce persistence by 250ms to prevent lag during active resize
      clearTimeout(resizeSaveTimer);
      resizeSaveTimer = setTimeout(() => saveState(), 250);
    });
    widgets.forEach(widget => resizeObserver.observe(widget));
  }

  document.getElementById('focus-mode-selector').value = state.focusMode;
  document.getElementById('focus-mode-selector').addEventListener('change', (e) => {
    state.focusMode = e.target.value;
    applyWidgetVisibility();
    saveState();
  });

  // Drag logic
  widgets.forEach(widget => {
    const id = widget.id;
    let isDragging = false, startX, startY, startLeft, startTop;
    widget.addEventListener('mousedown', (e) => {
      if (!state.editMode) return;
      
      // BROADEN DRAGGING AREA (FIXED)
      // Allow dragging from everywhere except the bottom-right corner (approx 20px) where the resize handle is.
      const rect = widget.getBoundingClientRect();
      const isResizeCorner = (e.clientX > rect.right - 25) && (e.clientY > rect.bottom - 25);
      if (isResizeCorner) return;

      // Do not trigger drag if clicking interactive elements
      const interactiveElements = ['button', 'input', 'textarea', 'select', 'a'];
      if (interactiveElements.includes(e.target.tagName.toLowerCase()) || 
          e.target.closest('.btn') || 
          e.target.closest('.calc-btn') ||
          e.target.closest('.obsidian-toggle') ||
          e.target.id === 'toggle-12-24') {
        return;
      }

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      
      const computed = window.getComputedStyle(widget);
      
      // CRITICAL FIX: Handle widgets that are centered via 'left: 50%' + 'transform: translateX(-50%)'
      // If we don't clear the transform, the widget will be offset by half its width once left is set in pixels.
      if (computed.transform !== 'none' && computed.transform.includes('matrix')) {
          const rect = widget.getBoundingClientRect();
          // Convert current absolute position to literal pixel left/top
          widget.style.left = rect.left + 'px';
          widget.style.top = rect.top + 'px';
          widget.style.transform = 'none'; // clear centering/offset transforms
          state.widgets[id].left = widget.style.left;
          state.widgets[id].top = widget.style.top;
          state.widgets[id].transform = 'none'; // PERSIST this removal
      }

      startLeft = parseInt(window.getComputedStyle(widget).left, 10);
      startTop = parseInt(window.getComputedStyle(widget).top, 10);
      
      highestZ += 1;
      widget.style.zIndex = highestZ;
      state.widgets[id].zIndex = highestZ;
      saveState();
      widget.style.transition = 'none';
      widget.style.willChange = 'left, top';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      let dx = e.clientX - startX;
      let dy = e.clientY - startY;
      let newLeft = startLeft + dx;
      let newTop = startTop + dy;
      if (state.gridSnap) {
        newLeft = Math.round(newLeft / 20) * 20;
        newTop = Math.round(newTop / 20) * 20;
      }
      widget.style.left = newLeft + 'px';
      widget.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        widget.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.3s ease, background-color 0.3s ease';
        widget.style.willChange = 'auto'; // cleanup
        state.widgets[id].left = widget.style.left;
        state.widgets[id].top = widget.style.top;
        saveState();
      }
    });

    // Initial Edit mode tag
    state.editMode ? widget.classList.add('edit-mode') : widget.classList.remove('edit-mode');
  });

  // --- 5. CONTROL CENTER TOGGLES ---
  const profileBtn = document.getElementById('profile-icon-img');
  const controlCenter = document.getElementById('control-center');

  profileBtn.addEventListener('click', () => controlCenter.classList.toggle('open'));
  document.getElementById('close-control-center').addEventListener('click', () => {
     controlCenter.classList.remove('open');
  });

  const editModeBtn = document.getElementById('edit-mode-toggle');
  function updateEditModeUI() {
    state.editMode ? editModeBtn.classList.add('active') : editModeBtn.classList.remove('active');
    document.querySelectorAll('.glass-widget').forEach(w => {
      state.editMode ? w.classList.add('edit-mode') : w.classList.remove('edit-mode');
    });
  }
  updateEditModeUI();
  editModeBtn.addEventListener('click', () => { state.editMode = !state.editMode; updateEditModeUI(); saveState(); });

  // Basic Toggles
  document.getElementById('theme-selector').addEventListener('change', (e) => {
    state.theme = e.target.value;
    document.body.setAttribute('data-theme', state.theme);
    saveState();
  });
  document.getElementById('global-font-selector').addEventListener('change', (e) => {
    state.globalFont = e.target.value;
    document.body.style.fontFamily = state.globalFont;
    saveState();
  });
  document.getElementById('dock-position').addEventListener('change', (e) => {
    state.dockPosition = e.target.value;
    dockEl.className = `os-dock ${state.dockPosition}`;
    saveState();
  });

  document.getElementById('clock-font-selector').addEventListener('change', (e) => {
    state.clockFont = e.target.value;
    document.documentElement.style.setProperty('--font-clock', state.clockFont);
    saveState();
  });

  // Custom Font Upload Logic
  const fontUploadInput = document.getElementById('custom-font-upload');
  const fontNameInput = document.getElementById('custom-font-name');
  const applyFontBtn = document.getElementById('apply-custom-font-btn');

  applyFontBtn.addEventListener('click', async () => {
    const file = fontUploadInput.files[0];
    const name = fontNameInput.value.trim() || file?.name?.split('.')[0] || 'Custom Font';
    if (!file) return alert("Select a font file first.");
    
    const family = 'CustomFont_' + Date.now();
    const blobKey = 'font_' + Date.now();
    
    await saveFileDB(blobKey, file);
    await loadCustomFont(name, family, file);
    
    state.customFonts.push({ name, family, blobKey });
    fontNameInput.value = '';
    fontUploadInput.value = '';
    saveState();
    alert(`Font "${name}" saved and loaded!`);
  });

  document.getElementById('delete-custom-font-btn').addEventListener('click', () => {
    const managerSelect = document.getElementById('custom-font-manager-dropdown');
    const familyToDelete = managerSelect.value;
    if (!familyToDelete) return showOSModal("Selection Error", "Please select a custom font from the dropdown to delete.", null, "Ok");
    
    const fontName = managerSelect.options[managerSelect.selectedIndex].text;
    
    showOSModal("Delete Font", `Are you sure you want to permanently delete "${fontName}"? This cannot be undone.`, async () => {
      const fontIdx = state.customFonts.findIndex(f => f.family === familyToDelete);
      if (fontIdx > -1) {
        const font = state.customFonts[fontIdx];
        await delFileDB(font.blobKey);
        state.customFonts.splice(fontIdx, 1);
        
        // Reset if being used
        const familyValue = `'${familyToDelete}', cursive`;
        if (state.globalFont === familyValue) {
          state.globalFont = defaultState.globalFont;
          document.body.style.fontFamily = state.globalFont;
          document.getElementById('global-font-selector').value = state.globalFont;
        }
        if (state.clockFont === familyValue) {
          state.clockFont = 'inherit';
          document.documentElement.style.setProperty('--font-clock', 'inherit');
          document.getElementById('clock-font-selector').value = 'inherit';
        }

        // Remove from all UI selectors
        document.querySelectorAll(`option[data-family="${familyToDelete}"], #custom-font-manager-dropdown option[value="${familyToDelete}"]`).forEach(opt => opt.remove());
        
        if (managerSelect.options.length === 0) {
          managerSelect.innerHTML = '<option value="">No fonts uploaded</option>';
        }

        saveState();
        // showOSModal("Font Deleted", `"${fontName}" has been successfully removed.`, null, "Close");
      }
    }, "Delete Font");
  });

  // Background Upload Handling
  document.getElementById('bg-url-input').addEventListener('change', (e) => {
    state.bgUrl = e.target.value;
    state.hasDbBg = false;
    
    // Explicitly update isBgVideo for URLs
    state.isBgVideo = state.bgUrl.split('?')[0].match(/\.(mp4|webm|ogg|mov)$/i) !== null;
    
    applyBgUrl(state.bgUrl, state.isBgVideo);
    saveState();
  });
  document.getElementById('bg-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      await saveFileDB('background', file);
      state.hasDbBg = true;
      state.bgUrl = ''; // Clear URL
      
      // Detected via MIME type
      state.isBgVideo = file.type.startsWith('video/');
      
      applyBgUrl(URL.createObjectURL(file), state.isBgVideo);
      document.getElementById('bg-url-input').value = '';
      saveState();
    }
  });

  const resetBgBtn = document.getElementById('reset-bg-btn');
  if (resetBgBtn) {
    resetBgBtn.addEventListener('click', async () => {
      state.bgUrl = '';
      state.hasDbBg = false;
      document.getElementById('bg-url-input').value = '';
      document.getElementById('bg-file-input').value = '';
      state.isBgVideo = false;
      applyBgUrl('');
      await delFileDB('background');
      saveState();
    });
  }

  // Profile Upload Handling
  document.getElementById('profile-img-url').addEventListener('change', (e) => {
    state.profileUrl = e.target.value;
    state.hasDbProfile = false;
    profileImgEl.src = state.profileUrl;
    saveState();
  });
  document.getElementById('profile-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      await saveFileDB('profile', file);
      state.hasDbProfile = true;
      state.profileUrl = '';
      profileImgEl.src = URL.createObjectURL(file);
      document.getElementById('profile-img-url').value = '';
      saveState();
    }
  });

  // Spotify
  document.getElementById('spotify-url-input').addEventListener('change', (e) => {
    let raw = e.target.value;
    // Auto-fix normal URIs/URLs to embed format if needed
    if(raw.includes('open.spotify.com') && !raw.includes('/embed/')) {
       raw = raw.replace('https://open.spotify.com/', 'https://open.spotify.com/embed/');
    }
    state.spotifyUrl = raw;
    spotifyEl.src = state.spotifyUrl;
    saveState();
  });

  document.getElementById('grid-snap-toggle').addEventListener('change', (e) => {
    state.gridSnap = e.target.checked; saveState();
  });

  const wifiVisibleToggle = document.getElementById('wifi-visible-toggle');
  const wifiIconEl = document.getElementById('wifi-icon');
  
  if (wifiVisibleToggle && wifiIconEl) {
    wifiVisibleToggle.checked = state.wifiVisible;
    wifiIconEl.style.display = state.wifiVisible ? 'inline-block' : 'none';
    wifiVisibleToggle.addEventListener('change', e => {
      state.wifiVisible = e.target.checked;
      wifiIconEl.style.display = state.wifiVisible ? 'inline-block' : 'none';
      saveState();
    });
  }

  const cursorToggle = document.getElementById('cursor-effects-toggle');
  if(cursorToggle) {
    cursorToggle.checked = state.cursorEffectsEnabled;
    const applyCursorStyle = () => {
       document.body.style.cursor = state.cursorEffectsEnabled ? 'none' : 'default';
       const dot = document.getElementById('custom-cursor-dot');
       if(dot) dot.style.display = state.cursorEffectsEnabled ? 'block' : 'none';
       
       if(!state.cursorEffectsEnabled) {
          const c = document.getElementById('trailCanvas');
          const ctx = c.getContext('2d');
          ctx.clearRect(0, 0, c.width, c.height);
       }
    };
    applyCursorStyle();
    cursorToggle.addEventListener('change', (e) => {
      state.cursorEffectsEnabled = e.target.checked;
      applyCursorStyle();
      saveState();
    });
  }

  document.getElementById('factory-reset-btn').addEventListener('click', () => {
     if(confirm("DANGER: Wiping all OS configurations, backgrounds, and custom profiles permanently. Are you sure?")) {
        localStorage.removeItem(STORAGE_KEY);
        indexedDB.deleteDatabase(DB_NAME);
        window.location.reload();
     }
  });

  document.querySelectorAll('.widget-toggle').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const targetId = e.target.getAttribute('data-target');
      state.widgets[targetId].visible = e.target.checked;
      applyWidgetVisibility();
      saveState();
    });
  });

  const linkTargetToggle = document.getElementById('link-target-toggle');
  if (linkTargetToggle) {
    linkTargetToggle.checked = (state.linkTarget === '_blank');
    linkTargetToggle.addEventListener('change', (e) => {
      state.linkTarget = e.target.checked ? '_blank' : '_self';
      saveState();
    });
  }

  notepadEl.addEventListener('input', (e) => { state.notepadText = e.target.value; saveState(); });


  // --- 6. EXPORT / IMPORT CONFIG ---
  document.getElementById('export-json-btn').addEventListener('click', () => {
    // Clone state, but exclude large local structures if needed. 
    // State only holds booleans for IDB, so JSON is incredibly tiny!
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = "obsidian_os_config.json";
    a.click();
  });

  document.getElementById('import-json-btn').addEventListener('click', () => {
    document.getElementById('import-json-input').click();
  });

  document.getElementById('import-json-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(evt) {
        try {
          const imported = JSON.parse(evt.target.result);
          if (imported && imported.theme) { // rough validation
            localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
            alert("Config imported! Reloading layout.");
            window.location.reload();
          }
        } catch(err) {
          alert("Invalid JSON config file.");
        }
      };
      reader.readAsText(file);
    }
  });


  // --- 7. WORKSPACE & LINK MANAGER (CRUD) ---
  const wsSelector = document.getElementById('active-workspace-selector');
  const wsListContainer = document.getElementById('link-list-container');
  const dockContainer = document.getElementById('dynamic-dock');
  const linkManagerOverlay = document.getElementById('link-manager-overlay');

  document.getElementById('open-link-manager').addEventListener('click', () => {
    linkManagerOverlay.classList.add('active');
    renderManager();
  });
  document.getElementById('close-link-manager').addEventListener('click', () => {
    linkManagerOverlay.classList.remove('active');
  });

  let activeWsIndex = 0;
  let managerSelectedWsId = state.workspaces[0].id;

  function logActivity(title, url) {
    state.recentActivity.unshift({title, url});
    if (state.recentActivity.length > 3) state.recentActivity.pop();
    saveState();
  }

  function launchLink(e, linkObj) {
    if(linkObj.url.startsWith('#')) return; // handled locally
    logActivity(linkObj.title, linkObj.url);
    if(linkObj.url.startsWith('file:///')) {
      alert("Local files cannot be launched directly by browsers for security reasons. Copy Path: " + linkObj.url);
    }
  }

  function renderDock() {
    dockContainer.innerHTML = '';
    let favs = [];
    state.workspaces.forEach(ws => {
      ws.links.forEach(l => {
        if(l.isFav) favs.push(l);
      });
    });
    // Strict Cap at 6
    favs = favs.slice(0, 6);

    favs.forEach(link => {
      const a = document.createElement('a');
      a.href = link.url;
      a.target = state.linkTarget;
      a.className = 'dock-icon';
      a.title = link.title;
      a.onclick = (e) => launchLink(e, link);

      if (link.iconType === 'auto') {
        const domain = (new URL(link.url.startsWith('http') ? link.url : 'http://' + link.url)).hostname;
        a.innerHTML = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=64">`;
      } else if (link.iconType === 'local' && link.iconVal) {
        a.innerHTML = `<img src="${link.iconVal}">`;
      } else {
        a.innerHTML = `<span class="material-symbols-outlined">${link.iconVal || 'web'}</span>`;
      }
      dockContainer.appendChild(a);
    });
  }

  function renderWorkspaceLinks() {
    // Dropdown
    wsSelector.innerHTML = '';
    state.workspaces.forEach((ws, idx) => {
      let opt = document.createElement('option');
      opt.value = idx; opt.innerText = ws.name;
      wsSelector.appendChild(opt);
    });
    wsSelector.value = activeWsIndex;

    // Links Array
    wsListContainer.innerHTML = '';
    const activeWs = state.workspaces[activeWsIndex];
    if(activeWs) {
      activeWs.links.forEach(link => {
        const a = document.createElement('a');
        a.href = link.url;
        a.target = state.linkTarget;
        a.className = 'link-item';
        a.onclick = (e) => launchLink(e, link);
        
        let iconHtml = '';
        if (link.iconType === 'auto') {
          const domain = (new URL(link.url.startsWith('http') ? link.url : 'http://' + link.url)).hostname;
          iconHtml = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" class="favicon">`;
        } else if (link.iconType === 'local' && link.iconVal) {
          iconHtml = `<img src="${link.iconVal}" class="favicon">`;
        } else {
          iconHtml = `<span class="material-symbols-outlined" style="font-size:16px;">${link.iconVal || 'web'}</span>`;
        }
        a.innerHTML = `${iconHtml} ${link.title}`;
        wsListContainer.appendChild(a);
      });
    }

    // Recent Activity Setup
    const ra = document.getElementById('recent-activity-list');
    ra.innerHTML = '';
    state.recentActivity.forEach(act => {
      let r = document.createElement('div');
      r.style.cssText = "font-size:10px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;";
      r.innerHTML = `<span style="color:var(--text-primary)">></span> ${act.title}`;
      ra.appendChild(r);
    });
  }

  wsSelector.addEventListener('change', (e) => {
    activeWsIndex = e.target.value;
    renderWorkspaceLinks();
  });

  // Manager UI Logic
  function renderManager() {
    const wsUl = document.getElementById('workspace-list');
    wsUl.innerHTML = '';
    state.workspaces.forEach(ws => {
      let li = document.createElement('li');
      if(ws.id === managerSelectedWsId) li.classList.add('selected');
      li.innerHTML = `<span>${ws.name}</span> <span class="material-symbols-outlined manager-action-icon" data-id="${ws.id}">delete</span>`;
      li.onclick = (e) => { if(e.target.tagName !== 'SPAN' || !e.target.classList.contains('manager-action-icon')) { managerSelectedWsId = ws.id; renderManager(); } };
      wsUl.appendChild(li);
    });

    // Handle Deletes
    wsUl.querySelectorAll('.manager-action-icon').forEach(icon => {
      icon.addEventListener('click', (e) => {
        e.stopPropagation();
        if(state.workspaces.length <= 1) return alert("Cannot delete last workspace.");
        state.workspaces = state.workspaces.filter(w => w.id !== icon.getAttribute('data-id'));
        managerSelectedWsId = state.workspaces[0].id;
        saveState(); renderManager();
      });
    });

    const lnkUl = document.getElementById('link-item-list');
    lnkUl.innerHTML = '';
    let selectedWs = state.workspaces.find(w => w.id === managerSelectedWsId);
    if(selectedWs) {
      selectedWs.links.forEach(l => {
        let li = document.createElement('li');
        li.innerHTML = `<span>${l.title} ${l.isFav?'★':''}</span> <span class="material-symbols-outlined manager-action-icon" data-id="${l.id}">delete</span>`;
        lnkUl.appendChild(li);
      });
    }

    lnkUl.querySelectorAll('.manager-action-icon').forEach(icon => {
      icon.addEventListener('click', (e) => {
        selectedWs.links = selectedWs.links.filter(k => k.id !== icon.getAttribute('data-id'));
        saveState(); renderManager();
      });
    });
  }

  document.getElementById('add-workspace-btn').addEventListener('click', () => {
    let raw = document.getElementById('new-workspace-name').value;
    if(raw) {
      state.workspaces.push({ id:'w'+Date.now(), name:raw, links:[] });
      document.getElementById('new-workspace-name').value = '';
      saveState(); renderManager();
    }
  });

  const linkLocalImg = document.getElementById('link-local-img');
  let tempLocalB64 = '';
  document.getElementById('link-icon-type').addEventListener('change', (e) => {
    linkLocalImg.style.display = (e.target.value === 'local') ? 'block' : 'none';
  });
  linkLocalImg.addEventListener('change', (e) => {
    let f = e.target.files[0];
    if(f) {
      let r = new FileReader();
      r.onload = ev => { tempLocalB64 = ev.target.result; };
      r.readAsDataURL(f);
    }
  });

  document.getElementById('save-link-btn').addEventListener('click', () => {
    let ws = state.workspaces.find(w => w.id === managerSelectedWsId);
    let title = document.getElementById('link-edit-title').value;
    let url = document.getElementById('link-edit-url').value;
    let iconType = document.getElementById('link-icon-type').value;
    let isFav = document.getElementById('link-is-favorite').checked;
    let iconVal = '';

    if(!title || !url) return alert("Title and URL required");
    
    if(iconType === 'material') {
      iconVal = document.getElementById('link-material-name').value || 'web';
    } else if (iconType === 'local') {
      iconVal = tempLocalB64;
    }

    if(isFav && dockContainer.children.length >= 6) {
      // Allow it to be saved, but physics renderDock() will slice to 6.
      alert("Note: Dock is limited to 6 favorites. First 6 scanned will be shown.");
    }

    ws.links.push({ id:'l'+Date.now(), title, url, iconType, iconVal, isFav });
    document.getElementById('link-edit-title').value = '';
    document.getElementById('link-edit-url').value = '';
    tempLocalB64 = '';
    
    saveState(); renderManager();
  });


  // --- 8. COMMAND PALETTE (Ctrl+K) & UNIVERSAL SEARCH (The Void) ---
  const cmdPalette = document.getElementById('command-palette');
  const cmdInput = document.getElementById('cmd-input');
  let cmdOpen = false;

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      cmdOpen = !cmdOpen;
      if (cmdOpen) { cmdPalette.classList.add('open'); cmdInput.focus(); } 
      else { cmdPalette.classList.remove('open'); cmdInput.blur(); }
    } else if (e.key === 'Escape') {
      cmdOpen = false; cmdPalette.classList.remove('open'); cmdInput.blur();
    }
  });

  function processVoidQuery(qInput, clearCb) {
      const q = qInput.value.trim();
      const lq = q.toLowerCase();
      if (!q) return;
      
      const target = state.linkTarget;
      
      if(lq.startsWith('/yt ')) {
         const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q.substring(4))}`;
         target === '_blank' ? window.open(url, '_blank') : window.location.href = url;
      } else if (lq.startsWith('/w ')) {
         const url = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q.substring(3))}`;
         target === '_blank' ? window.open(url, '_blank') : window.location.href = url;
      } else if (lq.startsWith('/g ')) {
         const url = `https://www.google.com/search?q=${encodeURIComponent(q.substring(3))}`;
         target === '_blank' ? window.open(url, '_blank') : window.location.href = url;
      } else {
         const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
         target === '_blank' ? window.open(url, '_blank') : window.location.href = url;
      }
      if(clearCb) clearCb();
  }

  cmdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      processVoidQuery(cmdInput, () => {
        cmdInput.value = ''; cmdOpen = false; cmdPalette.classList.remove('open');
      });
    }
  });

  const uniInput = document.getElementById('universal-search-input');
  if(uniInput) {
    uniInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        processVoidQuery(uniInput, () => { uniInput.value = ''; });
      }
    });
  }


  // --- 9. CLOCK & POMODORO (Editable) ---
  const clockDisplay = document.getElementById('clock-display');
  const dateDisplay = document.getElementById('date-display');
  
  function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    let minutes = now.getMinutes();
    if (!state.is24Hour) hours = hours % 12 || 12;
    const hStr = state.is24Hour ? hours.toString().padStart(2, '0') : hours.toString();
    const ampmStr = !state.is24Hour ? `<span class="ampm">${now.getHours()>=12?'PM':'AM'}</span>` : '';
    clockDisplay.innerHTML = `<span>${hStr}:${minutes.toString().padStart(2, '0')}</span>${ampmStr}`;
    
    const dStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    dateDisplay.innerText = dStr;
  }
  setInterval(updateClock, 1000); updateClock();

  const clkFormatToggle = document.getElementById('clock-format-toggle');
  if(clkFormatToggle) {
    clkFormatToggle.checked = state.is24Hour;
    clkFormatToggle.addEventListener('change', (e) => {
      state.is24Hour = e.target.checked;
      updateClock(); saveState();
    });
  }

  document.getElementById('toggle-12-24').addEventListener('click', () => { 
    state.is24Hour = !state.is24Hour; 
    if(clkFormatToggle) clkFormatToggle.checked = state.is24Hour;
    updateClock(); saveState();
  });

  let pomInterval = null;
  let remainingSecs = 0;
  const pomMinInput = document.getElementById('pomodoro-min-input');
  const pomSecDisplay = document.getElementById('pomodoro-sec-display');
  const pomStartBtn = document.getElementById('pomodoro-start');
  const pomResetBtn = document.getElementById('pomodoro-reset');

  function updatePomDisplay() {
    let m = Math.floor(remainingSecs / 60);
    let s = remainingSecs % 60;
    pomMinInput.value = m;
    pomSecDisplay.innerText = s.toString().padStart(2, '0');
  }

  pomStartBtn.addEventListener('click', () => {
    if (pomInterval) {
      clearInterval(pomInterval); pomInterval = null;
      pomStartBtn.innerText = 'Start';
    } else {
      // Read input
      let userMins = parseInt(pomMinInput.value) || 0;
      let curSecs = parseInt(pomSecDisplay.innerText) || 0;
      remainingSecs = (userMins * 60) + curSecs;
      
      pomStartBtn.innerText = 'Pause';
      pomInterval = setInterval(() => {
        if (remainingSecs > 0) {
          remainingSecs--; updatePomDisplay();
        } else {
          clearInterval(pomInterval); pomInterval = null;
          pomStartBtn.innerText = 'Start';
          alert('Pomodoro Time Complete!');
        }
      }, 1000);
    }
  });

  pomResetBtn.addEventListener('click', () => {
    clearInterval(pomInterval); pomInterval = null;
    pomStartBtn.innerText = 'Start';
    pomMinInput.value = 25; pomSecDisplay.innerText = "00";
  });


  // --- 10. CALCULATOR (Standard Math) ---
  const calcDisplay = document.getElementById('calc-display');
  let calcMemory = '';

  document.querySelectorAll('.calc-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      let val = e.target.getAttribute('data-val');
      if(val === 'C') { calcDisplay.value = ''; calcMemory = ''; }
      else if(val === '<-') { calcDisplay.value = calcDisplay.value.slice(0, -1); }
      else if(val === '=') {
        try { calcDisplay.value = eval(calcDisplay.value); } 
        catch(err) { calcDisplay.value = 'ERROR'; }
      } else {
        calcDisplay.value += val;
      }
    });
  });


  // --- 11. IMMERSIVE MEDIA HUB ---
  const hub = document.getElementById('media-viewer-hub');
  const btnTrigger = document.getElementById('floating-media-btn');
  const wSpace = document.getElementById('workspace');

  btnTrigger.addEventListener('click', () => {
    wSpace.style.display = 'none';
    hub.classList.add('active');
  });
  document.getElementById('close-media-viewer').addEventListener('click', () => {
    hub.classList.remove('active');
    wSpace.style.display = 'block';
    document.getElementById('video-display').pause();
  });

  document.getElementById('tab-image').addEventListener('click', () => {
    document.getElementById('panel-image').style.display = 'flex';
    document.getElementById('panel-video').style.display = 'none';
  });
  document.getElementById('tab-video').addEventListener('click', () => {
    document.getElementById('panel-image').style.display = 'none';
    document.getElementById('panel-video').style.display = 'flex';
  });

  // Hub Inputs
  const viewImgEl = document.getElementById('image-display');
  document.getElementById('image-url-input').addEventListener('change', e => viewImgEl.src = e.target.value);
  document.getElementById('image-file-input').addEventListener('change', e => {
    if(e.target.files[0]) viewImgEl.src = URL.createObjectURL(e.target.files[0]);
  });
  
  const viewVidEl = document.getElementById('video-display');
  document.getElementById('video-url-input').addEventListener('change', e => { viewVidEl.src = e.target.value; viewVidEl.play(); });
  document.getElementById('video-file-input').addEventListener('change', e => {
    if(e.target.files[0]) { viewVidEl.src = URL.createObjectURL(e.target.files[0]); viewVidEl.play(); }
  });
  // --- 12. DYNAMIC SSID RETRIEVAL (On Hover) ---
  const wifiIcon = document.getElementById('wifi-icon');
  
  async function updateWifiHoverText() {
    try {
      // 1. Primary: Try to fetch real SSID from local utility (network_utility.py)
      const res = await fetch('http://127.0.0.1:5501/api/ssid');
      if (res.ok) {
        const data = await res.json();
        if (data.ssid && data.ssid !== "Not Connected") {
          wifiIcon.title = `Network: ${data.ssid}`;
          return;
        }
      }
    } catch (err) {
      // Python utility is not running, move to browser-native fallback
    }

    // 2. Secondary Fallback: Use Browser-Native Network Information API
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!navigator.onLine) {
      wifiIcon.title = "Not Connected (Offline)";
    } else if (conn && (conn.type === 'wifi' || conn.effectiveType === 'wifi')) {
      wifiIcon.title = "Connected (Wi-Fi)";
    } else {
      wifiIcon.title = "Connected (Web)";
    }
  }

  if (wifiIcon) {
    wifiIcon.addEventListener('mouseenter', updateWifiHoverText);
  }

  // --- 12.1 BATTERY STATUS (Web Standard) ---
  const batteryIconEl = document.getElementById('battery-icon');
  const batteryPercentEl = document.getElementById('battery-percent');

  if (navigator.getBattery) {
    navigator.getBattery().then(bat => {
      let upd = () => {
        batteryPercentEl.innerText = Math.round(bat.level * 100) + '%';
        batteryIconEl.innerText = bat.charging ? 'battery_charging_full' : 'battery_full';
      };
      upd(); bat.addEventListener('chargingchange', upd); bat.addEventListener('levelchange', upd);
    });
  }

  // --- 13. ULTRA SMOOTH CURSOR PHYSICS (User Requested) ---
  const canvas = document.getElementById('trailCanvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  let cWidth, cHeight;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    cWidth = window.innerWidth;
    cHeight = window.innerHeight;
    canvas.width = cWidth * dpr;
    canvas.height = cHeight * dpr;
    ctx.scale(dpr, dpr);
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  const trailLength = 10; 
  const spring = 1.0;     // Instant follow
  const friction = 0.15;  // Low friction for high responsiveness

  
  let mouse = { x: cWidth / 2, y: cHeight / 2 };
  let points = [];
  for (let i = 0; i < trailLength; i++) {
    points.push({ x: mouse.x, y: mouse.y, vx: 0, vy: 0 });
  }

  // Cache theme color for high-performance frames
  let cachedRgb = '243, 187, 153'; 
  function updateCachedColor() {
    let rawColor = getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#f3bb99';
    if(rawColor.startsWith('#')) {
       let c = rawColor.replace('#', '');
       if(c.length===3) c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
       let val = parseInt(c, 16);
       cachedRgb = `${(val>>16)&255}, ${(val>>8)&255}, ${val&255}`;
    } else if (rawColor.startsWith('rgb')) {
       cachedRgb = rawColor.replace(/[rgba()]/g, '').split(',').slice(0,3).join(',');
    }
  }
  updateCachedColor();
  document.getElementById('theme-selector').addEventListener('change', () => setTimeout(updateCachedColor, 100));

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    
    // Move dot immediately for 0ms lag
    const dot = document.getElementById('custom-cursor-dot');
    if (dot && state.cursorEffectsEnabled) {
      dot.style.transform = `translate3d(${mouse.x}px, ${mouse.y}px, 0) translate3d(-50%, -50%, 0)`;
    }
  });

  function animateCursor() {
    if (!state.cursorEffectsEnabled) {
      requestAnimationFrame(animateCursor);
      return; 
    }
    ctx.clearRect(0, 0, cWidth, cHeight);

    // Physics
    let targetX = mouse.x;
    let targetY = mouse.y;
    for (let i = 0; i < trailLength; i++) {
      let p = points[i];
      p.vx += (targetX - p.x) * spring;
      p.vy += (targetY - p.y) * spring;
      p.vx *= friction;
      p.vy *= friction;
      p.x += p.vx;
      p.y += p.vy;
      targetX = p.x;
      targetY = p.y;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.5;

    // Drawing with QuadraticCurveTo through midpoints
    let lastX = points[0].x;
    let lastY = points[0].y;

    for (let i = 1; i < trailLength - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      
      const opacity = 1 - (i / (trailLength - 1));
      ctx.beginPath();
      ctx.moveTo(lastX, lastY); 
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      ctx.strokeStyle = `rgba(${cachedRgb}, ${opacity})`; 
      ctx.stroke();

      lastX = xc; lastY = yc;
    }

    // Cursor dot
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${cachedRgb}, 1)`;
    ctx.fill();

    requestAnimationFrame(animateCursor);
  }
  animateCursor();

  // Final flush render
  renderDock();
  renderWorkspaceLinks();

});
