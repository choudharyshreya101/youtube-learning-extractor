// YouTube Learning Extractor Frontend Application
(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------
  let loadedVideos = [];
  let uploadedFiles = [];
  let currentSyllabus = null;
  let videoDetailsMap = new Map();
  let selectedVideoIds = new Set();

  const SESSION_STORAGE_KEY = 'yt_active_learning_track';

  // --------------------------------------------------------------------------
  // DOM Elements
  // --------------------------------------------------------------------------
  const htmlEl = document.documentElement;
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const iconThemeSun = document.getElementById('icon-theme-sun');
  const iconThemeMoon = document.getElementById('icon-theme-moon');

  const topicInput = document.getElementById('topic-input');
  const dateCutoffSelect = document.getElementById('date-cutoff');
  const includeShortsCheckbox = document.getElementById('include-shorts');
  const videoPoolBadge = document.getElementById('video-pool-badge');
  const filteredCountEl = document.getElementById('filtered-count');

  const dropzone = document.getElementById('takeout-dropzone');
  const fileInput = document.getElementById('file-input');
  const fileList = document.getElementById('file-list');
  const howToToggle = document.getElementById('how-to-toggle');
  const howToContent = document.getElementById('how-to-content');
  const howToChevron = document.getElementById('how-to-chevron');

  const playlistInput = document.getElementById('playlist-url');
  const btnLoadPlaylist = document.getElementById('btn-load-playlist');

  const btnExtract = document.getElementById('btn-extract');
  const btnDemoMode = document.getElementById('btn-demo-mode');
  const btnDemoModeInline = document.getElementById('btn-demo-mode-inline');

  const emptyState = document.getElementById('empty-state');
  const loadingState = document.getElementById('loading-state');
  const loadingTitle = document.getElementById('loading-title');
  const loadingSubtitle = document.getElementById('loading-subtitle');
  const syllabusContainer = document.getElementById('syllabus-container');
  const syllabusTopicTitle = document.getElementById('syllabus-topic-title');
  const badgeTotalVideos = document.getElementById('badge-total-videos');
  const subtopicsList = document.getElementById('subtopics-list');
  const refineInput = document.getElementById('refine-input');
  const btnRefine = document.getElementById('btn-refine');
  const btnCopyNotebookLM = document.getElementById('btn-copy-notebooklm');
  const notebooklmCountEl = document.getElementById('notebooklm-count');
  const outputActions = document.getElementById('output-actions');
  const toastContainer = document.getElementById('toast-container');

  // FAQ Drawer Elements
  const btnFaqTrigger = document.getElementById('btn-faq-trigger');
  const faqDrawer = document.getElementById('faq-drawer');
  const btnFaqClose = document.getElementById('btn-faq-close');
  const faqChatBody = document.getElementById('faq-chat-body');

  const YOUTUBE_ID_RE = /(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|\/shorts\/)([a-zA-Z0-9_-]{11})/;

  // --------------------------------------------------------------------------
  // Theme Management: Light Mode Default on First Load + Working Toggle
  // --------------------------------------------------------------------------
  function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      htmlEl.classList.add('dark');
      iconThemeSun.style.display = 'block';
      iconThemeMoon.style.display = 'none';
      btnThemeToggle.setAttribute('title', 'Switch to Light Theme');
    } else {
      htmlEl.classList.remove('dark');
      iconThemeSun.style.display = 'none';
      iconThemeMoon.style.display = 'block';
      btnThemeToggle.setAttribute('title', 'Switch to Dark Theme');
    }
    localStorage.setItem('theme', theme);
  }

  btnThemeToggle.addEventListener('click', () => {
    const isDark = htmlEl.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
  });

  // --------------------------------------------------------------------------
  // Session Persistence (sessionStorage)
  // Keeps results intact on refresh; tab close wipes automatically.
  // --------------------------------------------------------------------------
  function saveSessionState() {
    if (!currentSyllabus) return;
    const state = {
      syllabus: currentSyllabus,
      videos: Array.from(videoDetailsMap.entries()),
      selectedIds: Array.from(selectedVideoIds),
      loadedVideos: loadedVideos,
      topic: topicInput.value,
    };
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save sessionStorage state:', e);
    }
  }

  function restoreSessionState() {
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state && state.syllabus) {
        if (Array.isArray(state.videos)) {
          videoDetailsMap = new Map(state.videos);
        }
        if (Array.isArray(state.loadedVideos)) {
          loadedVideos = state.loadedVideos;
          updateVideoCounts();
        }
        if (state.topic) {
          topicInput.value = state.topic;
        }
        currentSyllabus = state.syllabus;
        if (Array.isArray(state.selectedIds)) {
          selectedVideoIds = new Set(state.selectedIds);
        }
        renderSyllabus(currentSyllabus, false);
      }
    } catch (e) {
      console.warn('Failed to restore sessionStorage state:', e);
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 4500);
  }

  function formatNumber(num) {
    if (num == null || isNaN(num)) return null;
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toLocaleString();
  }

  function formatDuration(iso) {
    if (!iso) return '';
    const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
    if (!match) return iso;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);
    const pad = (n) => String(n).padStart(2, '0');
    if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    return `${minutes}:${pad(seconds)}`;
  }

  function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    try {
      const pubDate = new Date(dateStr);
      if (isNaN(pubDate.getTime())) return '';
      const diffMs = new Date() - pubDate;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays < 1) return 'today';
      if (diffDays === 1) return 'yesterday';
      if (diffDays < 30) return `${diffDays}d ago`;
      const diffMonths = Math.floor(diffDays / 30);
      if (diffMonths < 12) return `${diffMonths}m ago`;
      const diffYears = Math.floor(diffDays / 365);
      return `${diffYears}y ago`;
    } catch {
      return '';
    }
  }

  function isOlderThanTwoYears(dateStr) {
    if (!dateStr) return false;
    try {
      const pub = new Date(dateStr);
      return new Date() - pub > 2 * 365.25 * 24 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Collapsible Micro-Guide: How to get this file
  // --------------------------------------------------------------------------
  howToToggle.addEventListener('click', (e) => {
    e.preventDefault();
    const isHidden = howToContent.style.display === 'none';
    howToContent.style.display = isHidden ? 'block' : 'none';
    howToChevron.style.transform = isHidden ? 'rotate(180deg)' : 'none';
  });

  // --------------------------------------------------------------------------
  // Video Pool & Filtering
  // --------------------------------------------------------------------------
  function getFilteredVideos() {
    const cutoffVal = dateCutoffSelect.value;
    const includeShorts = includeShortsCheckbox.checked;
    const now = new Date();

    return loadedVideos.filter((v) => {
      if (!includeShorts && v.isShort) return false;
      if (cutoffVal !== 'all' && v.watchDate) {
        const daysAgo = (now - v.watchDate) / (1000 * 60 * 60 * 24);
        if (daysAgo > parseInt(cutoffVal, 10)) return false;
      }
      return true;
    });
  }

  function updateVideoCounts() {
    const total = loadedVideos.length;
    videoPoolBadge.textContent = `${total} video${total === 1 ? '' : 's'} loaded`;
    const filtered = getFilteredVideos();
    filteredCountEl.textContent = filtered.length;
    btnExtract.disabled = filtered.length === 0;
  }

  // --------------------------------------------------------------------------
  // File Dropzone: JSON & CSV Parsing (100% In-Browser)
  // --------------------------------------------------------------------------
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files?.length) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files?.length) {
      handleFiles(Array.from(e.target.files));
    }
  });

  async function handleFiles(files) {
    const validFiles = files.filter((f) => f.name.endsWith('.json') || f.name.endsWith('.csv'));
    if (!validFiles.length) {
      showToast('Please upload .json or .csv files exported from Google Takeout.', 'error');
      return;
    }

    for (const file of validFiles) {
      try {
        const text = await file.text();
        const sourceLabel = file.name.replace(/\.(json|csv)$/i, '');
        let count = 0;

        if (file.name.endsWith('.json')) {
          const json = JSON.parse(text);
          if (!Array.isArray(json)) {
            showToast(`File ${file.name} is not a valid Takeout JSON array.`, 'error');
            continue;
          }

          for (const item of json) {
            let title = item.title || '';
            if (title.startsWith('Watched ')) {
              title = title.substring(8).trim();
            }
            if (!title || title.includes('Deleted video') || title.includes('Private video')) {
              continue;
            }

            const url = item.titleUrl || '';
            const match = url.match(YOUTUBE_ID_RE);
            if (!match) continue;

            const videoId = match[1];
            const isShort = url.includes('/shorts/') || title.toLowerCase().includes('#shorts');

            let watchDate = null;
            if (item.time) {
              const d = new Date(item.time);
              if (!isNaN(d.getTime())) watchDate = d;
            }

            const channelName = item.subtitles?.[0]?.name || '';

            const existingIdx = loadedVideos.findIndex((v) => v.videoId === videoId);
            if (existingIdx === -1) {
              loadedVideos.push({
                videoId,
                title,
                watchDate,
                channelName,
                source: sourceLabel,
                isShort,
              });
              count++;
            }
          }
        } else if (file.name.endsWith('.csv')) {
          const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
          if (lines.length > 1) {
            const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
            const idCol = header.findIndex((h) => h.includes('video id') || h === 'id');
            const titleCol = header.findIndex((h) => h.includes('title'));
            const channelCol = header.findIndex((h) => h.includes('channel'));

            for (let i = 1; i < lines.length; i++) {
              const row = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
              let videoId = idCol !== -1 ? row[idCol] : '';
              if (!videoId || videoId.length !== 11) {
                const match = lines[i].match(YOUTUBE_ID_RE);
                if (match) videoId = match[1];
              }
              if (!videoId || videoId.length !== 11) continue;

              const title = titleCol !== -1 ? row[titleCol] : `Video (${videoId})`;
              const channelName = channelCol !== -1 ? row[channelCol] : '';

              if (!loadedVideos.some((v) => v.videoId === videoId)) {
                loadedVideos.push({
                  videoId,
                  title: title || `Video (${videoId})`,
                  watchDate: new Date(),
                  channelName,
                  source: sourceLabel,
                  isShort: false,
                });
                count++;
              }
            }
          }
        }

        uploadedFiles.push({ name: file.name, count, label: sourceLabel });
        renderFileList();
        showToast(`Loaded ${count} videos from ${file.name}`, 'success');
      } catch (err) {
        console.error(err);
        showToast(`Failed to parse ${file.name}: ${err.message}`, 'error');
      }
    }

    updateVideoCounts();
    saveSessionState();
  }

  function renderFileList() {
    fileList.innerHTML = '';
    uploadedFiles.forEach((f) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <span class="file-item-name">${f.name}</span>
        <span class="file-item-badge">${f.count} videos</span>
      `;
      fileList.appendChild(item);
    });
  }

  // --------------------------------------------------------------------------
  // Playlist Input
  // --------------------------------------------------------------------------
  btnLoadPlaylist.addEventListener('click', async () => {
    const url = playlistInput.value.trim();
    if (!url) {
      showToast('Please enter a YouTube playlist URL.', 'error');
      return;
    }

    btnLoadPlaylist.disabled = true;
    btnLoadPlaylist.textContent = 'Fetching...';

    try {
      const resp = await fetch('/api/youtube/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to fetch playlist.');
      }

      const items = await resp.json();
      let added = 0;
      items.forEach((item) => {
        if (!loadedVideos.some((v) => v.videoId === item.videoId)) {
          loadedVideos.push({
            videoId: item.videoId,
            title: item.title,
            watchDate: new Date(),
            channelName: item.channelName,
            source: 'Playlist',
            thumbnailUrl: item.thumbnailUrl,
            isShort: false,
          });
          added++;
        }
      });

      uploadedFiles.push({ name: 'Playlist Import', count: items.length, label: 'Playlist' });
      renderFileList();
      updateVideoCounts();
      playlistInput.value = '';
      showToast(`Added ${added} new playlist items to video pool.`, 'success');
      saveSessionState();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnLoadPlaylist.disabled = false;
      btnLoadPlaylist.textContent = 'Fetch';
    }
  });

  dateCutoffSelect.addEventListener('change', () => {
    updateVideoCounts();
    saveSessionState();
  });

  includeShortsCheckbox.addEventListener('change', () => {
    updateVideoCounts();
    saveSessionState();
  });

  // --------------------------------------------------------------------------
  // Extract Learning Track
  // --------------------------------------------------------------------------
  btnExtract.addEventListener('click', async () => {
    const topic = topicInput.value.trim();
    if (!topic) {
      showToast('Please enter a target topic, keywords, or channel.', 'error');
      topicInput.focus();
      return;
    }

    const filtered = getFilteredVideos();
    if (!filtered.length) {
      showToast('No videos match your current filter settings.', 'error');
      return;
    }

    const inputVideos = filtered.slice(0, 500).map((v) => ({
      videoId: v.videoId,
      title: v.title,
      channel: v.channelName || '',
    }));

    showLoading('Extracting & Clustering with Gemini...', 'Organizing videos into foundational, building-block, and application sub-topics.');

    try {
      const extractResp = await fetch('/api/ai/extract-syllabus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, videos: inputVideos }),
      });

      if (!extractResp.ok) {
        const err = await extractResp.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to extract learning track.');
      }

      const syllabus = await extractResp.json();

      const allIds = [];
      syllabus.subTopics.forEach((st) => {
        st.videoIds.forEach((id) => {
          if (!allIds.includes(id)) allIds.push(id);
        });
      });

      if (allIds.length > 0) {
        showLoading('Enriching Video Details...', `Fetching metadata & chapters for ${allIds.length} videos`);
        const enrichResp = await fetch('/api/youtube/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoIds: allIds }),
        });

        if (enrichResp.ok) {
          const enrichData = await enrichResp.json();
          enrichData.videos.forEach((v) => {
            const original = loadedVideos.find((lv) => lv.videoId === v.videoId);
            if (original && original.source) v.source = original.source;
            videoDetailsMap.set(v.videoId, v);
          });
        }
      }

      currentSyllabus = syllabus;
      renderSyllabus(syllabus);
      saveSessionState();
      showToast('Curated learning track extracted successfully!', 'success');
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
      showEmpty();
    }
  });

  // --------------------------------------------------------------------------
  // Refine Learning Track
  // --------------------------------------------------------------------------
  btnRefine.addEventListener('click', async () => {
    const refinement = refineInput.value.trim();
    if (!refinement) {
      showToast('Please enter refinement instructions.', 'error');
      return;
    }

    if (!currentSyllabus) return;

    btnRefine.disabled = true;
    btnRefine.textContent = 'Refining...';

    const filtered = getFilteredVideos();
    const inputVideos = filtered.slice(0, 500).map((v) => ({
      videoId: v.videoId,
      title: v.title,
      channel: v.channelName || '',
    }));

    try {
      const resp = await fetch('/api/ai/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: currentSyllabus.topic,
          refinement,
          videos: inputVideos,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to refine learning track.');
      }

      const refined = await resp.json();
      currentSyllabus = refined;
      renderSyllabus(refined);
      refineInput.value = '';
      saveSessionState();
      showToast('Learning track refined successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnRefine.disabled = false;
      btnRefine.textContent = 'Refine with AI';
    }
  });

  // --------------------------------------------------------------------------
  // Sample Demo Mode (Sync Counters Automatically)
  // --------------------------------------------------------------------------
  async function loadDemoMode() {
    showLoading('Loading Sample Demo Data...', 'Testing complete learning track with bundled dataset');

    try {
      const resp = await fetch('/api/demo/sample-data');
      if (!resp.ok) throw new Error('Failed to load demo data.');

      const data = await resp.json();

      videoDetailsMap.clear();
      loadedVideos = [];
      uploadedFiles = [{ name: 'Sample Demo Dataset', count: data.totalVideos || 16, label: 'Demo' }];

      data.subTopics.forEach((st) => {
        if (st.videos && Array.isArray(st.videos)) {
          st.videos.forEach((v) => {
            videoDetailsMap.set(v.videoId, v);
            loadedVideos.push({
              videoId: v.videoId,
              title: v.title,
              watchDate: new Date(v.publishedAt || Date.now()),
              channelName: v.channelName,
              source: v.source || 'Account 2 (Study)',
              isShort: false,
            });
          });
        }
      });

      topicInput.value = data.topic || 'English & Communication';
      renderFileList();
      updateVideoCounts();

      currentSyllabus = data;
      renderSyllabus(data);
      saveSessionState();
      showToast('Loaded Sample Demo Mode (English & Communication)', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      showEmpty();
    }
  }

  btnDemoMode.addEventListener('click', loadDemoMode);
  if (btnDemoModeInline) {
    btnDemoModeInline.addEventListener('click', loadDemoMode);
  }

  // --------------------------------------------------------------------------
  // Render Learning Track
  // - Chevron inline to the left of the title
  // - Default state: expand only the first subtopic; keep others collapsed
  // - Fixed-width 180px 16:9 horizontal card thumbnail
  // - Selection checkbox does not navigate away
  // --------------------------------------------------------------------------
  function renderSyllabus(syllabus, shouldResetSelection = true) {
    emptyState.style.display = 'none';
    loadingState.style.display = 'none';
    syllabusContainer.style.display = 'block';
    outputActions.style.display = 'block';

    syllabusTopicTitle.textContent = syllabus.topic;

    const allIds = [];
    syllabus.subTopics.forEach((st) => {
      st.videoIds.forEach((id) => {
        if (!allIds.includes(id)) allIds.push(id);
      });
    });

    if (shouldResetSelection) {
      selectedVideoIds = new Set(allIds);
    }
    badgeTotalVideos.textContent = `${allIds.length} videos`;
    updateNotebookLMCount();

    // Render Subtopic Accordions
    subtopicsList.innerHTML = '';
    syllabus.subTopics.forEach((st, idx) => {
      const accordion = document.createElement('div');
      // Expand ONLY the first subtopic by default; collapse all others
      const isFirst = idx === 0;
      accordion.className = `subtopic-accordion ${isFirst ? 'open' : ''}`;

      const totalVideosCount = st.videoIds.length;
      const limitInitial = isFirst && totalVideosCount > 2;

      accordion.innerHTML = `
        <div class="subtopic-header">
          <div class="subtopic-header-left">
            <div class="subtopic-title-row">
              <svg class="subtopic-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m6 9 6 6 6-6"/>
              </svg>
              <h4>${st.name}</h4>
            </div>
            <p class="subtopic-brief">${st.brief}</p>
          </div>
          <div class="subtopic-header-right">
            <span class="badge">${totalVideosCount} video${totalVideosCount === 1 ? '' : 's'}</span>
            <button type="button" class="btn-select-toggle" data-st-idx="${idx}">Select all / Deselect</button>
          </div>
        </div>
        <div class="subtopic-videos-wrap">
          <div class="subtopic-cards-container" id="st-cards-${idx}"></div>
          ${limitInitial ? `<button type="button" class="btn-show-more" data-st-idx="${idx}">Show ${totalVideosCount - 2} more videos</button>` : ''}
        </div>
      `;

      // Header click toggles open/collapsed smoothly without triggering select-toggle
      const headerEl = accordion.querySelector('.subtopic-header');
      headerEl.addEventListener('click', (e) => {
        if (e.target.closest('.btn-select-toggle')) return;
        accordion.classList.toggle('open');
      });

      // Select all / Deselect handler
      const selectToggleBtn = accordion.querySelector('.btn-select-toggle');
      selectToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const allSelected = st.videoIds.every((id) => selectedVideoIds.has(id));
        if (allSelected) {
          st.videoIds.forEach((id) => selectedVideoIds.delete(id));
        } else {
          st.videoIds.forEach((id) => selectedVideoIds.add(id));
        }
        accordion.querySelectorAll('.video-card-cb').forEach((cb) => {
          cb.checked = !allSelected;
        });
        updateNotebookLMCount();
        saveSessionState();
      });

      // Show more button handler
      const showMoreBtn = accordion.querySelector('.btn-show-more');
      if (showMoreBtn) {
        showMoreBtn.addEventListener('click', () => {
          renderVideoCards(st, accordion.querySelector(`#st-cards-${idx}`), false);
          showMoreBtn.remove();
        });
      }

      renderVideoCards(st, accordion.querySelector(`#st-cards-${idx}`), limitInitial);
      subtopicsList.appendChild(accordion);
    });
  }

  function renderVideoCards(subTopic, container, limitToTwo = false) {
    container.innerHTML = '';
    const vidsToRender = limitToTwo ? subTopic.videoIds.slice(0, 2) : subTopic.videoIds;

    vidsToRender.forEach((vidId) => {
      const detail = videoDetailsMap.get(vidId) || {
        videoId: vidId,
        title: `Video (${vidId})`,
        thumbnailUrl: `https://i.ytimg.com/vi/${vidId}/mqdefault.jpg`,
        channelName: '',
        duration: '',
        publishedAt: '',
        viewCount: null,
        likeCount: null,
        chapters: [],
        source: '',
      };

      const durationText = formatDuration(detail.duration);
      const viewsText = formatNumber(detail.viewCount) ? `${formatNumber(detail.viewCount)} views` : '';
      const likesText = formatNumber(detail.likeCount) ? `${formatNumber(detail.likeCount)} likes` : '';
      const relativeTime = formatRelativeTime(detail.publishedAt);
      const sourceText = detail.source || '';

      const metaParts = [viewsText, likesText, relativeTime, sourceText].filter(Boolean);
      const metaRowHtml = metaParts.join(' · ');

      // Recency notice: shown only if topic is time sensitive and video is older than 2 years
      let recencyNoticeHtml = '';
      if (currentSyllabus && currentSyllabus.isTimeSensitive && isOlderThanTwoYears(detail.publishedAt)) {
        recencyNoticeHtml = `<div class="video-recency-note">⚠️ Uploaded &gt;2 years ago; topic details may have evolved</div>`;
      }

      // Monospace Chapters Grid (omitted when a video has no timestamps)
      let chaptersHtml = '';
      if (detail.chapters && detail.chapters.length > 0) {
        const chapterItems = detail.chapters
          .map(
            (c) =>
              `<a href="https://www.youtube.com/watch?v=${vidId}&t=${timeToSeconds(c.time)}s" target="_blank" rel="noopener" class="chapter-item">
                <span class="chapter-time">${c.time}</span>
                <span>${c.label}</span>
              </a>`
          )
          .join('');

        chaptersHtml = `
          <div class="chapters-accordion">
            <button type="button" class="chapters-trigger" onclick="const g = this.nextElementSibling; g.style.display = g.style.display === 'none' ? 'grid' : 'none';">
              <span>Chapters (${detail.chapters.length})</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <div class="chapters-grid" style="display: none;">
              ${chapterItems}
            </div>
          </div>
        `;
      }

      const card = document.createElement('div');
      card.className = 'video-card';
      const isChecked = selectedVideoIds.has(vidId);

      card.innerHTML = `
        <div class="video-checkbox-col">
          <input type="checkbox" class="video-card-cb" data-vid="${vidId}" ${isChecked ? 'checked' : ''}>
        </div>
        <a href="https://www.youtube.com/watch?v=${vidId}" target="_blank" rel="noopener" class="video-thumb-link">
          <img src="${detail.thumbnailUrl || `https://i.ytimg.com/vi/${vidId}/mqdefault.jpg`}" alt="" class="video-thumb" loading="lazy">
          ${durationText ? `<span class="video-duration">${durationText}</span>` : ''}
        </a>
        <div class="video-content">
          <a href="https://www.youtube.com/watch?v=${vidId}" target="_blank" rel="noopener" class="video-title-link">
            ${detail.title}
          </a>
          ${detail.channelName ? `<div class="video-channel">${detail.channelName}</div>` : ''}
          ${metaRowHtml ? `<div class="video-meta-row">${metaRowHtml}</div>` : ''}
          ${recencyNoticeHtml}
          ${chaptersHtml}
        </div>
      `;

      // Checkbox click stops propagation (does not open YouTube link)
      const cb = card.querySelector('.video-card-cb');
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cb.checked) {
          selectedVideoIds.add(vidId);
        } else {
          selectedVideoIds.delete(vidId);
        }
        updateNotebookLMCount();
        saveSessionState();
      });

      container.appendChild(card);
    });
  }

  function updateNotebookLMCount() {
    notebooklmCountEl.textContent = Math.min(selectedVideoIds.size, 50);
  }

  // --------------------------------------------------------------------------
  // NotebookLM Copy (With Specific Toast Reminder)
  // --------------------------------------------------------------------------
  btnCopyNotebookLM.addEventListener('click', async () => {
    let idsToCopy = Array.from(selectedVideoIds);
    if (!idsToCopy.length && currentSyllabus) {
      currentSyllabus.subTopics.forEach((st) => {
        st.videoIds.forEach((id) => {
          if (!idsToCopy.includes(id)) idsToCopy.push(id);
        });
      });
    }

    if (!idsToCopy.length) {
      showToast('No videos selected in current learning track.', 'error');
      return;
    }

    const count = Math.min(idsToCopy.length, 50);
    const links = idsToCopy
      .slice(0, 50)
      .map((id) => `https://www.youtube.com/watch?v=${id}`)
      .join('\n');

    try {
      await navigator.clipboard.writeText(links);
      showToast(`Copied ${count} links — in NotebookLM, open Add sources → Website and paste.`, 'success');
    } catch {
      showToast('Clipboard access was blocked. Please allow permissions.', 'error');
    }
  });

  // --------------------------------------------------------------------------
  // Chatbot-Style Guided FAQ & Feature Request Drawer (Zero AI Tokens)
  // --------------------------------------------------------------------------
  btnFaqTrigger.addEventListener('click', () => {
    const isHidden = faqDrawer.style.display === 'none';
    faqDrawer.style.display = isHidden ? 'flex' : 'none';
    if (isHidden && !faqChatBody.hasChildNodes()) {
      renderInitialFaq();
    }
  });

  btnFaqClose.addEventListener('click', () => {
    faqDrawer.style.display = 'none';
  });

  const FAQ_ITEMS = [
    {
      id: 'faq-1',
      question: 'How do I get my watch-history.json?',
      answer: `Open <a href="https://takeout.google.com/settings/takeout/custom/youtube" target="_blank" rel="noopener">Google Takeout (YouTube)</a> &rarr; Deselect all except <strong>history</strong> &rarr; Choose <strong>JSON</strong> format &rarr; Create export, download the zip, and drop <code>watch-history.json</code> into the upload area!`,
    },
    {
      id: 'faq-2',
      question: "Why can't I load my Watch Later playlist?",
      answer: `YouTube's public API restricts third-party access to private system playlists like 'Watch Later'. To include it, export your playlists from Google Takeout as CSV and drop <code>Watch later.csv</code> above!`,
    },
    {
      id: 'faq-3',
      question: 'Can I filter by a specific YouTube channel?',
      answer: `Yes! Enter the channel name in the top target input (e.g., <code>Career 247 channel</code> or <code>English with Lucy</code>). You can also combine channel and topic like <code>Python from Tech With Tim</code>.`,
    },
    {
      id: 'faq-4',
      question: 'How do I paste links into NotebookLM?',
      answer: `Click <strong>Copy for NotebookLM</strong> to copy your curated links. Then open <a href="https://notebooklm.google.com" target="_blank" rel="noopener">NotebookLM</a>, open your notebook, click <strong>Add sources &rarr; Website</strong>, and paste the links.`,
    },
    {
      id: 'faq-5',
      question: 'Is my watch history saved anywhere?',
      answer: `Your watch history stays on your device. All files are parsed <strong>100% locally in your browser</strong>. Zero database storage — only filtered video titles and channel names are sent transiently to Gemini to construct your learning track, and everything clears when you close this tab.`,
    },
    {
      id: 'faq-6',
      question: 'Something else / Request a feature',
      isFeatureRequest: true,
    },
  ];

  function renderInitialFaq() {
    faqChatBody.innerHTML = '';
    const botMsg = document.createElement('div');
    botMsg.className = 'faq-msg faq-msg-bot';
    botMsg.innerHTML = `
      <div class="faq-bubble">
        Hi there! How can I help you today? Pick a question below or submit a feature idea:
      </div>
      <div class="faq-chips-grid">
        ${FAQ_ITEMS.map((item) => `<button type="button" class="faq-chip" data-faq-id="${item.id}">${item.question}</button>`).join('')}
      </div>
    `;

    faqChatBody.appendChild(botMsg);

    botMsg.querySelectorAll('.faq-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const faqId = chip.getAttribute('data-faq-id');
        const item = FAQ_ITEMS.find((f) => f.id === faqId);
        if (item) handleFaqSelect(item);
      });
    });
  }

  function handleFaqSelect(item) {
    const userMsg = document.createElement('div');
    userMsg.className = 'faq-msg faq-msg-user';
    userMsg.innerHTML = `<div class="faq-bubble">${item.question}</div>`;
    faqChatBody.appendChild(userMsg);

    const botMsg = document.createElement('div');
    botMsg.className = 'faq-msg faq-msg-bot';

    if (item.isFeatureRequest) {
      botMsg.innerHTML = `
        <div class="faq-bubble">
          What would you like to ask or see in the next version?
          <div class="faq-input-form">
            <textarea id="faq-feedback-text" rows="3" placeholder="Share your question or feature idea..."></textarea>
            <div class="faq-input-note">Logged anonymously to improve v2 — don't include personal info</div>
            <button type="button" id="btn-submit-feedback" class="btn btn-primary btn-sm">Send</button>
          </div>
        </div>
      `;
      faqChatBody.appendChild(botMsg);
      faqChatBody.scrollTop = faqChatBody.scrollHeight;

      const submitBtn = botMsg.querySelector('#btn-submit-feedback');
      const textarea = botMsg.querySelector('#faq-feedback-text');
      submitBtn.addEventListener('click', async () => {
        const val = textarea.value.trim();
        if (!val) return;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';

        try {
          await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: val, timestamp: new Date().toISOString() }),
          });
        } catch (e) {
          console.warn('Feedback send failed:', e);
        }

        const replyMsg = document.createElement('div');
        replyMsg.className = 'faq-msg faq-msg-bot';
        replyMsg.innerHTML = `
          <div class="faq-bubble">
            Thank you! Your feedback has been logged anonymously to help shape v2.
          </div>
          <button type="button" class="btn-ask-another">Ask another question</button>
        `;
        faqChatBody.appendChild(replyMsg);
        replyMsg.querySelector('.btn-ask-another').addEventListener('click', renderInitialFaq);
        faqChatBody.scrollTop = faqChatBody.scrollHeight;
      });
    } else {
      botMsg.innerHTML = `
        <div class="faq-bubble">${item.answer}</div>
        <button type="button" class="btn-ask-another">Ask another question</button>
      `;
      faqChatBody.appendChild(botMsg);
      botMsg.querySelector('.btn-ask-another').addEventListener('click', renderInitialFaq);
    }

    faqChatBody.scrollTop = faqChatBody.scrollHeight;
  }

  // --------------------------------------------------------------------------
  // UI States
  // --------------------------------------------------------------------------
  function showLoading(title, subtitle) {
    emptyState.style.display = 'none';
    syllabusContainer.style.display = 'none';
    outputActions.style.display = 'none';
    loadingState.style.display = 'block';
    loadingTitle.textContent = title;
    loadingSubtitle.textContent = subtitle;
  }

  function showEmpty() {
    loadingState.style.display = 'none';
    syllabusContainer.style.display = 'none';
    outputActions.style.display = 'none';
    emptyState.style.display = 'block';
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  initTheme();
  updateVideoCounts();
  restoreSessionState();
})();
