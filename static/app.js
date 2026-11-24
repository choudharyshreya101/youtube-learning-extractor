// YouTube Learning Extractor Frontend Application
(function () {
  'use strict';

  // State
  let loadedVideos = [];
  let uploadedFiles = [];
  let currentSyllabus = null;
  let videoDetailsMap = new Map();

  // DOM Elements
  const dropzone = document.getElementById('takeout-dropzone');
  const fileInput = document.getElementById('file-input');
  const fileList = document.getElementById('file-list');
  const videoPoolBadge = document.getElementById('video-pool-badge');
  const playlistInput = document.getElementById('playlist-url');
  const btnLoadPlaylist = document.getElementById('btn-load-playlist');
  const dateCutoffSelect = document.getElementById('date-cutoff');
  const excludeShortsCheckbox = document.getElementById('exclude-shorts');
  const filteredCountEl = document.getElementById('filtered-count');
  const topicInput = document.getElementById('topic-input');
  const btnExtract = document.getElementById('btn-extract');
  const btnDemoMode = document.getElementById('btn-demo-mode');
  const emptyState = document.getElementById('empty-state');
  const loadingState = document.getElementById('loading-state');
  const loadingTitle = document.getElementById('loading-title');
  const loadingSubtitle = document.getElementById('loading-subtitle');
  const syllabusContainer = document.getElementById('syllabus-container');
  const syllabusTopicTitle = document.getElementById('syllabus-topic-title');
  const badgeTimeSensitivity = document.getElementById('badge-time-sensitivity');
  const badgeTotalVideos = document.getElementById('badge-total-videos');
  const subtopicsList = document.getElementById('subtopics-list');
  const refineInput = document.getElementById('refine-input');
  const btnRefine = document.getElementById('btn-refine');
  const btnCopyNotebookLM = document.getElementById('btn-copy-notebooklm');
  const notebooklmCountEl = document.getElementById('notebooklm-count');
  const outputActions = document.getElementById('output-actions');
  const toastContainer = document.getElementById('toast-container');

  // Regex Patterns
  const YOUTUBE_ID_RE = /(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|\/shorts\/)([a-zA-Z0-9_-]{11})/;

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
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
    if (hours > 0) {
      return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${minutes}:${pad(seconds)}`;
  }

  function parseDurationSeconds(iso) {
    if (!iso) return 0;
    const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
    if (!match) return 0;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);
    return hours * 3600 + minutes * 60 + seconds;
  }

  function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  function isRecentDate(dateStr) {
    if (!dateStr) return false;
    try {
      const pubDate = new Date(dateStr);
      const diffDays = (new Date() - pubDate) / (1000 * 60 * 60 * 24);
      return diffDays <= 365;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Video Pool & Filtering
  // --------------------------------------------------------------------------

  function getFilteredVideos() {
    const cutoffDays = dateCutoffSelect.value;
    const excludeShorts = excludeShortsCheckbox.checked;
    const now = new Date();

    return loadedVideos.filter((v) => {
      // Shorts check
      if (excludeShorts && v.isShort) return false;

      // Date cutoff check
      if (cutoffDays !== 'all' && v.watchDate) {
        const daysAgo = (now - v.watchDate) / (1000 * 60 * 60 * 24);
        if (daysAgo > parseInt(cutoffDays, 10)) return false;
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
  // File Dropzone & Parsing (Client-Side Privacy Guardrail)
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
    const jsonFiles = files.filter((f) => f.name.endsWith('.json'));
    if (!jsonFiles.length) {
      showToast('Please select .json files from Google Takeout.', 'error');
      return;
    }

    for (const file of jsonFiles) {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        if (!Array.isArray(json)) {
          showToast(`File ${file.name} is not a valid Takeout array format.`, 'error');
          continue;
        }

        const sourceLabel = file.name.replace(/\.json$/i, '');
        let count = 0;

        for (const item of json) {
          let title = item.title || '';
          if (title.startsWith('Watched ')) {
            title = title.substring(8).trim();
          }

          // Skip deleted/private or empty
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

          // Add or update
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

        uploadedFiles.push({ name: file.name, count, label: sourceLabel });
        renderFileList();
        showToast(`Loaded ${count} videos from ${file.name}`, 'success');
      } catch (err) {
        console.error(err);
        showToast(`Failed to parse ${file.name}: ${err.message}`, 'error');
      }
    }

    updateVideoCounts();
  }

  function renderFileList() {
    fileList.innerHTML = '';
    uploadedFiles.forEach((f) => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `
        <span class="file-item-name">📄 ${f.name}</span>
        <span class="file-item-badge">${f.count} items</span>
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
    btnLoadPlaylist.textContent = 'Loading...';

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
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnLoadPlaylist.disabled = false;
      btnLoadPlaylist.textContent = 'Fetch Playlist';
    }
  });

  dateCutoffSelect.addEventListener('change', updateVideoCounts);
  excludeShortsCheckbox.addEventListener('change', updateVideoCounts);

  // --------------------------------------------------------------------------
  // Extract Syllabus
  // --------------------------------------------------------------------------

  btnExtract.addEventListener('click', async () => {
    const topic = topicInput.value.trim();
    if (!topic) {
      showToast('Please enter a target learning topic.', 'error');
      topicInput.focus();
      return;
    }

    const filtered = getFilteredVideos();
    if (!filtered.length) {
      showToast('No videos matching your current filter settings.', 'error');
      return;
    }

    // Limit to 500 for model prompt capacity
    const inputVideos = filtered.slice(0, 500).map((v) => ({
      videoId: v.videoId,
      title: v.title,
    }));

    showLoading('Extracting & Clustering with Gemini 3.5...', 'Grouping videos into intuitive sub-topics with 1-line briefs');

    try {
      const extractResp = await fetch('/api/ai/extract-syllabus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, videos: inputVideos }),
      });

      if (!extractResp.ok) {
        const err = await extractResp.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to extract syllabus.');
      }

      const syllabus = await extractResp.json();

      // Collect all video IDs across subtopics to enrich
      const allIds = [];
      syllabus.subTopics.forEach((st) => {
        st.videoIds.forEach((id) => {
          if (!allIds.includes(id)) allIds.push(id);
        });
      });

      if (allIds.length > 0) {
        showLoading('Enriching Video Metadata...', `Fetching statistics, chapters, and like ratios for ${allIds.length} videos`);
        const enrichResp = await fetch('/api/youtube/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoIds: allIds }),
        });

        if (enrichResp.ok) {
          const enrichData = await enrichResp.json();
          enrichData.videos.forEach((v) => {
            // Inherit source from loadedVideos if available
            const original = loadedVideos.find((lv) => lv.videoId === v.videoId);
            if (original && original.source) v.source = original.source;
            videoDetailsMap.set(v.videoId, v);
          });
        }
      }

      currentSyllabus = syllabus;
      renderSyllabus(syllabus);
      showToast('Learning syllabus extracted successfully!', 'success');
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
      showEmpty();
    }
  });

  // --------------------------------------------------------------------------
  // Refine Syllabus
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
        throw new Error(err.detail || 'Failed to refine syllabus.');
      }

      const refined = await resp.json();
      currentSyllabus = refined;
      renderSyllabus(refined);
      refineInput.value = '';
      showToast('Syllabus refined successfully!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnRefine.disabled = false;
      btnRefine.textContent = 'Refine with AI';
    }
  });

  // --------------------------------------------------------------------------
  // Sample Demo Mode
  // --------------------------------------------------------------------------

  btnDemoMode.addEventListener('click', async () => {
    showLoading('Loading Sample Demo Dataset...', 'No API key needed — testing complete flow with pre-bundled data');

    try {
      const resp = await fetch('/api/demo/sample-data');
      if (!resp.ok) {
        throw new Error('Failed to load demo data.');
      }

      const data = await resp.json();

      // Pre-fill videoDetailsMap from demo data
      videoDetailsMap.clear();
      data.subTopics.forEach((st) => {
        if (st.videos && Array.isArray(st.videos)) {
          st.videos.forEach((v) => videoDetailsMap.set(v.videoId, v));
        }
      });

      topicInput.value = data.topic || 'English & Communication';
      currentSyllabus = data;
      renderSyllabus(data);
      showToast('Loaded Sample Demo Mode (English & Communication)!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
      showEmpty();
    }
  });

  // --------------------------------------------------------------------------
  // Render Syllabus
  // --------------------------------------------------------------------------

  function renderSyllabus(syllabus) {
    emptyState.style.display = 'none';
    loadingState.style.display = 'none';
    syllabusContainer.style.display = 'block';
    outputActions.style.display = 'block';

    syllabusTopicTitle.textContent = syllabus.topic;

    // Time sensitivity badge
    if (syllabus.isTimeSensitive) {
      badgeTimeSensitivity.className = 'pill-badge pill-timesensitive';
      badgeTimeSensitivity.textContent = '⚡ Fast-Changing Topic';
    } else {
      badgeTimeSensitivity.className = 'pill-badge pill-timeless';
      badgeTimeSensitivity.textContent = '📚 Timeless Topic';
    }

    // Collect all video IDs
    const allIds = [];
    syllabus.subTopics.forEach((st) => {
      st.videoIds.forEach((id) => {
        if (!allIds.includes(id)) allIds.push(id);
      });
    });

    badgeTotalVideos.textContent = `${allIds.length} Videos in Syllabus`;
    notebooklmCountEl.textContent = Math.min(allIds.length, 50);

    // Render Subtopics
    subtopicsList.innerHTML = '';
    syllabus.subTopics.forEach((st) => {
      const card = document.createElement('div');
      card.className = 'subtopic-card';

      const videosHtml = st.videoIds
        .map((vidId) => {
          const detail = videoDetailsMap.get(vidId) || {
            videoId: vidId,
            title: `Video (${vidId})`,
            thumbnailUrl: `https://i.ytimg.com/vi/${vidId}/mqdefault.jpg`,
            channelName: '',
            duration: '',
            chapters: [],
            likeRatio: null,
            hasHighEngagement: false,
            isRecent: false,
            source: '',
          };

          const durationText = formatDuration(detail.duration);
          const viewsText = formatNumber(detail.viewCount);
          const likesText = formatNumber(detail.likeCount);
          const subsText = formatNumber(detail.subscriberCount);
          const isRecent = detail.isRecent || isRecentDate(detail.publishedAt);

          let statsHtml = '';
          if (viewsText) statsHtml += `<span class="stat-pill">👁️ ${viewsText} views</span>`;
          if (likesText) statsHtml += `<span class="stat-pill">👍 ${likesText}</span>`;
          if (detail.likeRatio != null) {
            statsHtml += `<span class="stat-pill badge-ratio">📊 ${detail.likeRatio}% like ratio</span>`;
          }
          if (detail.hasHighEngagement) {
            statsHtml += `<span class="stat-pill badge-high-engagement">🔥 High Engagement</span>`;
          }
          if (isRecent) {
            statsHtml += `<span class="stat-pill badge-recent">✨ Recent</span>`;
          }
          if (detail.source) {
            statsHtml += `<span class="stat-pill badge-source">🏷️ ${detail.source}</span>`;
          }

          let chaptersHtml = '';
          if (detail.chapters && detail.chapters.length > 0) {
            const chapterPills = detail.chapters
              .map(
                (c) =>
                  `<a href="https://www.youtube.com/watch?v=${vidId}&t=${timeToSeconds(c.time)}s" target="_blank" rel="noopener" class="chapter-pill"><code>${c.time}</code> ${c.label}</a>`
              )
              .join('');

            chaptersHtml = `
              <div class="chapters-toggle">
                <button type="button" class="chapters-btn" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'flex' : 'none'">
                  📑 Chapters (${detail.chapters.length}) ▾
                </button>
                <div class="chapters-list" style="display: none;">
                  ${chapterPills}
                </div>
              </div>
            `;
          }

          return `
            <div class="video-card">
              <div class="video-thumb-wrap">
                <img src="${detail.thumbnailUrl || `https://i.ytimg.com/vi/${vidId}/mqdefault.jpg`}" alt="" class="video-thumb" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${vidId}/hqdefault.jpg'">
                ${durationText ? `<span class="video-duration">${durationText}</span>` : ''}
              </div>
              <div class="video-content">
                <div>
                  <a href="https://www.youtube.com/watch?v=${vidId}" target="_blank" rel="noopener" class="video-title">
                    ${detail.title}
                  </a>
                  <div class="video-channel">
                    <span>${detail.channelName || 'YouTube'}</span>
                    ${subsText ? `<span>• ${subsText} subscribers</span>` : ''}
                  </div>
                  <div class="video-stats">${statsHtml}</div>
                </div>
                ${chaptersHtml}
              </div>
            </div>
          `;
        })
        .join('');

      card.innerHTML = `
        <div class="subtopic-header">
          <div class="subtopic-title-row">
            <h4>${st.name}</h4>
            <span class="badge">${st.videoIds.length} video${st.videoIds.length === 1 ? '' : 's'}</span>
          </div>
          <p class="subtopic-brief">${st.brief}</p>
        </div>
        <div class="subtopic-videos">
          ${videosHtml || '<p class="text-muted">No videos assigned.</p>'}
        </div>
      `;

      subtopicsList.appendChild(card);
    });
  }

  // --------------------------------------------------------------------------
  // NotebookLM 50-Link Copy
  // --------------------------------------------------------------------------

  btnCopyNotebookLM.addEventListener('click', async () => {
    if (!currentSyllabus) return;

    const allIds = [];
    currentSyllabus.subTopics.forEach((st) => {
      st.videoIds.forEach((id) => {
        if (!allIds.includes(id)) allIds.push(id);
      });
    });

    if (!allIds.length) {
      showToast('No videos in current syllabus.', 'error');
      return;
    }

    // Google NotebookLM allows max 50 sources per notebook
    const notebookLinks = allIds
      .slice(0, 50)
      .map((id) => `https://www.youtube.com/watch?v=${id}`)
      .join('\n');

    try {
      await navigator.clipboard.writeText(notebookLinks);
      const count = Math.min(allIds.length, 50);
      showToast(
        `Copied ${count} link${count === 1 ? '' : 's'} to clipboard! (Ready to paste directly into Google NotebookLM sources)`,
        'success'
      );
    } catch {
      showToast('Clipboard access denied. Please allow clipboard permissions.', 'error');
    }
  });

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

  // Initialize
  updateVideoCounts();
})();
