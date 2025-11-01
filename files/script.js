// ============================================================================
// Chat Application - Refactored & Clean
// ============================================================================
// Organized in logical sections: State, Helpers, UI Components, Socket.IO,
// Event Wiring, and App Init. Same behavior as original; improved readability.

// ============================================================================
// STATE & ELEMENTS
// ============================================================================

// DOM references
const messageArea = document.getElementById('message-area');
const messageInputField = document.getElementById('message-input-field');
const sendButton = document.getElementById('send-button');
const switchThemeToggle = document.getElementById('ld_switch');
const userInfo = document.getElementById('user-info');
const usernameDisplay = document.getElementById('username-display');
const logoutBtn = document.getElementById('logout-btn');
const roomInfo = document.getElementById('room-info');
const roomnameDisplay = document.getElementById('roomname-display');
const imageUploadInput = document.getElementById('image-upload');

// Message state
let oldestMessageId = null;
let newestMessageId = null;
let isLoadingOlderMessages = false;
let scrollDebounceTimeout = null;

// Socket state
let socket = null;
let isConnected = false;

// ============================================================================
// UTILITIES & HELPERS
// ============================================================================

function escapeHTML(str = '') {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  return parts.length === 2 ? parts.pop().split(';').shift() : null;
}

// ============================================================================
// TIMESTAMP POPUP (HOVER + CLICK FALLBACK)
// ============================================================================

function showTimestampPopup(messageDiv) {
  const ts = messageDiv?.dataset?.timestamp;
  if (!ts) return;

  const date = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  const formatted = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

  // Remove existing popup
  const existing = document.getElementById('timestamp-popup');
  if (existing) existing.remove();

  // Create popup
  const popup = document.createElement('div');
  popup.id = 'timestamp-popup';
  popup.classList.add('timestamp-popup');
  popup.innerHTML = `<p>${formatted}</p>`;
  document.body.appendChild(popup);

  // Position near message
  const rect = messageDiv.getBoundingClientRect();
  popup.style.top = `${rect.bottom + window.scrollY}px`;
  popup.style.left = `${rect.left + window.scrollX}px`;

  requestAnimationFrame(() => {
    const pRect = popup.getBoundingClientRect();
    let left = rect.left + window.scrollX + (rect.width - pRect.width) / 2;
    left = Math.max(8 + window.scrollX, Math.min(left, window.scrollX + document.documentElement.clientWidth - pRect.width - 8));
    let top = rect.top + window.scrollY - pRect.height - 8;
    if (top < window.scrollY + 8) top = rect.bottom + window.scrollY + 8;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    popup.style.opacity = '1';
  });

  // Remove on next click
  function removePopup() {
    popup.classList.add('removing');
    setTimeout(() => popup.remove(), 300);
    document.removeEventListener('click', removePopup);
  }
  setTimeout(() => document.addEventListener('click', removePopup), 0);
}

function attachTimestampListeners(messageDiv) {
  if (!messageDiv) return;
  let hoverTimer = null;

  // Hover: show popup after 2s (non-touch only)
  messageDiv.addEventListener('mouseenter', () => {
    if (isTouchDevice()) return;
    hoverTimer = setTimeout(() => {
      showTimestampPopup(messageDiv);
      hoverTimer = null;
    }, 2000);
  });

  // Mouseleave: cancel timer and hide popup
  messageDiv.addEventListener('mouseleave', () => {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    const existing = document.getElementById('timestamp-popup');
    if (existing) {
      existing.classList.add('removing');
      setTimeout(() => existing.remove(), 300);
    }
  });

  // Click fallback on touch devices
  if (isTouchDevice()) {
    messageDiv.addEventListener('click', (e) => showTimestampPopup(e.currentTarget));
  }
}

// ============================================================================
// IMAGE HELPERS
// ============================================================================

async function handleChatImageError(img) {
  try {
    const res = await fetch(img.src, { method: 'HEAD', credentials: 'same-origin' });
    const placeholder = document.createElement('div');
    placeholder.className = 'chat-image-deleted';
    placeholder.textContent = res.status === 404 ? 'Image deleted' : 'Image not available';
    img.replaceWith(placeholder);
  } catch (err) {
    const placeholder = document.createElement('div');
    placeholder.className = 'chat-image-deleted';
    placeholder.textContent = 'Image not available';
    img.replaceWith(placeholder);
  }
}

function attachImageHandlers(img) {
  if (!img) return;
  img.addEventListener('error', () => handleChatImageError(img));
  img.addEventListener('dragstart', (e) => e.preventDefault());
  // Scroll down when image loads
  img.addEventListener('load', () => {
    messageArea.scrollTop = messageArea.scrollHeight;
  });
}

// ============================================================================
// MESSAGE ELEMENT BUILDER
// ============================================================================

function newMessageElement(message, isOutgoing, id = null, timestamp = null) {
  const messageDiv = document.createElement('div');
  messageDiv.classList.add('message', isOutgoing ? 'outgoing' : 'incoming');

  // Check if message is markdown image: ![alt](url)
  if (message.startsWith('![') && message.includes('](') && message.endsWith(')')) {
    const altStart = message.indexOf('![') + 2;
    const altEnd = message.indexOf(']', altStart);
    const urlStart = message.indexOf('](', altEnd) + 2;
    const urlEnd = message.indexOf(')', urlStart);
    const altText = message.substring(altStart, altEnd);
    const imageUrl = message.substring(urlStart, urlEnd);
    const caption = message.substring(urlEnd + 1).trim();

    // Create loading skeleton
    let imageHTML = `<div class="image-loading-skeleton"></div>`;
    if (caption) imageHTML += `<p>${escapeHTML(caption)}</p>`;
    messageDiv.innerHTML = imageHTML;

    // Create actual image element
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = altText;
    img.className = 'chat-image';
    img.draggable = false;
    img.style.display = 'none'; // Hidden until loaded

    // Replace skeleton with actual image when loaded
    img.addEventListener('load', () => {
      const skeleton = messageDiv.querySelector('.image-loading-skeleton');
      if (skeleton) {
        skeleton.replaceWith(img);
        img.style.display = 'block';
        messageArea.scrollTop = messageArea.scrollHeight;
      }
    });

    // Attach error handler to image
    attachImageHandlers(img);

    // Insert image after skeleton (will be replaced on load)
    messageDiv.insertBefore(img, messageDiv.firstChild);
  } else {
    messageDiv.innerHTML = `<p>${escapeHTML(message)}</p>`;
  }

  // Attach metadata
  if (id) messageDiv.dataset.messageId = id;
  if (timestamp) messageDiv.dataset.timestamp = timestamp;

  // Track newest message ID
  newestMessageId = id || messageDiv.dataset.messageId || newestMessageId;

  // Attach timestamp listener (hover + click fallback)
  attachTimestampListeners(messageDiv);

  return messageDiv;
}

// ============================================================================
// OLDER MESSAGES LOADER (PULL-TO-REFRESH)
// ============================================================================

function loadOlderMessages(beforeMessageId, loaderDiv, blankDiv) {
  if (!beforeMessageId || isLoadingOlderMessages) return;

  isLoadingOlderMessages = true;
  socket.emit('get_older_messages', { before_message_id: beforeMessageId });

  socket.once('older_messages', function(data) {
    setTimeout(() => {
      data.messages.reverse();
      if (data.messages?.length > 0) {
        data.messages.forEach((message) => {
          const currentUser = JSON.parse(localStorage.getItem('user_info') || '{}').username;
          const messageElement = newMessageElement(
            message.message,
            message.username === currentUser,
            message.id,
            message.timestamp
          );
          messageArea.insertBefore(messageElement, messageArea.firstChild);
        });
        oldestMessageId = data.messages[data.messages.length - 1].id || oldestMessageId;
      }

      // Remove loaders with animation
      if (blankDiv?.parentNode) {
        blankDiv.classList.add('removing');
        setTimeout(() => blankDiv.parentNode?.removeChild(blankDiv), 200);
      }
      if (loaderDiv?.parentNode) {
        loaderDiv.classList.add('pop-out');
        setTimeout(() => loaderDiv.parentNode?.removeChild(loaderDiv), 300);
      }

      messageArea.scrollTo({ top: 40 * data.messages.length, behavior: 'auto' });
      isLoadingOlderMessages = false;
    }, 500);
  });

  socket.once('error', function(data) {
    if (data.message?.includes('older messages')) isLoadingOlderMessages = false;
    if (blankDiv?.parentNode) {
      blankDiv.classList.add('removing');
      setTimeout(() => blankDiv.parentNode?.removeChild(blankDiv), 200);
    }
    if (loaderDiv?.parentNode) {
      loaderDiv.classList.add('pop-out');
      setTimeout(() => loaderDiv.parentNode?.removeChild(loaderDiv), 200);
    }
  });
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

function playNotificationSound(soundFilePath) {
  try {
    const audio = new Audio(soundFilePath);
    audio.volume = 0.4;
    audio.play().catch(() => {});
  } catch (e) {
    console.error('playNotificationSound', e);
  }
}

// ============================================================================
// SEND MESSAGE
// ============================================================================

function sendMessage() {
  const messageText = messageInputField.value.trim();
  if (!messageText) return;
  if (!socket || !isConnected) {
    console.error('Socket.IO not connected');
    return;
  }

  const nowTs = new Date().toISOString();
  const outgoingMessage = newMessageElement(messageText, true, '', nowTs);
  messageArea.appendChild(outgoingMessage);
  messageInputField.value = '';
  messageArea.scrollTop = messageArea.scrollHeight;

  const userInfoStored = JSON.parse(localStorage.getItem('user_info') || '{}');
  const username = userInfoStored.username || prompt('Enter your username:') || 'Anonymous';

  socket.emit('send_message', {
    message: messageText,
    username,
    timestamp: new Date().toISOString()
  });

  const sendTimeout = setTimeout(() => {
    outgoingMessage.classList.add('message-failed');
  }, 4000);

  socket.once('message_sent', function(data) {
    clearTimeout(sendTimeout);
    if (data.success) {
      outgoingMessage.classList.remove('message-failed');
      if (data.id) outgoingMessage.dataset.messageId = data.id;
    } else {
      console.error('Failed to send message:', data);
      outgoingMessage.classList.add('message-failed');
    }
  });
}

// ============================================================================
// UPLOAD IMAGE
// ============================================================================

async function uploadImage() {
  const file = imageUploadInput.files[0];
  if (!file) {
    alert('Please select an image to upload.');
    return;
  }

  const formData = new FormData();
  formData.append('image', file);

  try {
    const response = await fetch('/api/upload-image', {
      method: 'POST',
      body: formData,
      credentials: 'same-origin'
    });

    const raw = await response.text();
    let data = null;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('Upload: response not JSON, raw=', raw);
      const trimmed = raw?.trim().replace(/^"|"$/g, '') || '';
      const isLikelyId = /^[a-fA-F0-9]{20,64}$/.test(trimmed) || (trimmed.length > 0 && trimmed.length < 200);
      if (response.ok && isLikelyId) {
        const imageUrl = `/api/images/${encodeURIComponent(trimmed)}`;
        data = { success: true, data: { image_url: imageUrl } };
      } else {
        console.error('Upload: response invalid', { status: response.status, raw });
        alert('Image upload failed: server returned an unexpected response.');
        return;
      }
    }

    if (response.ok && data?.success) {
      const imageUrl = data.data?.image_url || data.image_url || data.url;
      const caption = data.data?.message || data.message || '';
      if (!imageUrl) {
        alert('Image uploaded but server did not return a URL.');
        return;
      }
      const messageContent = caption ? `![Image](${imageUrl})\n${caption}` : `![Image](${imageUrl})`;
      messageInputField.value = messageContent;
      const notiDiv = document.createElement('div');
      sendMessage();
    } else {
      const errMsg = data?.message || `HTTP ${response.status}`;
      alert(`Image upload failed: ${errMsg}`);
    }
  } catch (error) {
    console.error('uploadImage', error);
    alert('An error occurred while uploading the image.');
  }
}

// ============================================================================
// SOCKET.IO SETUP
// ============================================================================

function connectSocketIO() {
  socket = io();

  socket.on('connect', function() {
    isConnected = true;
    if (newestMessageId) {
      socket.emit('get_messages_since_reconnect', { last_message_id: newestMessageId });
    } else {
      socket.emit('get_recent_messages');
    }
  });

  socket.on('status', function(data) {
    if (data.type === 'connected') {
      const statusMessage = document.createElement('div');
      statusMessage.classList.add('message', 'system');
      statusMessage.innerHTML = `<p><em>${data.message}</em></p>`;
      messageArea.appendChild(statusMessage);
      messageArea.scrollTop = messageArea.scrollHeight;
    }
  });

  socket.on('new_message', function(data) {
    const currentUser = JSON.parse(localStorage.getItem('user_info') || '{}').username;
    if (data.username !== currentUser) {
      const willScroll = messageArea.scrollTop - messageArea.scrollHeight + messageArea.clientHeight > -300;
      const incomingMessage = document.createElement('div');
      incomingMessage.classList.add('message', 'incoming');
      incomingMessage.innerHTML = `<p>${escapeHTML(data.message)}</p>`;
      if (data.id) incomingMessage.dataset.messageId = data.id;
      if (data.timestamp) incomingMessage.dataset.timestamp = data.timestamp;
      messageArea.appendChild(incomingMessage);
      if (willScroll) messageArea.scrollTop = messageArea.scrollHeight;
      playNotificationSound('/files/newmsg.mp3');
      newestMessageId = data.id || newestMessageId;
    }
  });

  socket.on('recent_messages', function(data) {
    if (data.messages?.length > 0) {
      const currentUser = JSON.parse(localStorage.getItem('user_info') || '{}').username;
      data.messages.forEach((message) => {
        messageArea.appendChild(newMessageElement(
          message.message,
          message.username === currentUser,
          message.id,
          message.timestamp
        ));
      });
      messageArea.scrollTop = messageArea.scrollHeight;
      oldestMessageId = data.messages[0].id || null;
      newestMessageId = data.messages[data.messages.length - 1].id || null;
    }
  });

  socket.on('message_sent', function(data) {
    if (data.success) newestMessageId = data.id || newestMessageId;
  });

  socket.on('error', function(data) {
    console.error('Socket.IO Error:', data);
    const errorMessage = document.createElement('div');
    errorMessage.classList.add('message', 'system', 'error');
    errorMessage.innerHTML = `<p><em>❌ ${escapeHTML(data.message || 'Error')}</em></p>`;
    messageArea.appendChild(errorMessage);
    messageArea.scrollTop = messageArea.scrollHeight;
  });

  socket.on('disconnect', function(reason) {
    isConnected = false;
    const statusMessage = document.createElement('div');
    statusMessage.classList.add('message', 'system', 'error');
    statusMessage.innerHTML = `<p><em>Disconnected</em></p>`;
    messageArea.appendChild(statusMessage);
    messageArea.scrollTop = messageArea.scrollHeight;
    setTimeout(() => {
      if (!isConnected) socket.connect();
    }, 5000);
  });

  socket.on('reconnect', function() {
    isConnected = true;
    const statusMessage = document.createElement('div');
    statusMessage.classList.add('message', 'system');
    statusMessage.innerHTML = `<p><em>Reconnected</em></p>`;
    messageArea.appendChild(statusMessage);
    messageArea.scrollTop = messageArea.scrollHeight;
    socket.emit('get_messages_since_reconnect', { last_message_id: newestMessageId });
  });

  socket.on('messages_since_reconnect', function(data) {
    if (data.messages?.length > 0) {
      const currentUser = JSON.parse(localStorage.getItem('user_info') || '{}').username;
      data.messages.forEach((message) => {
        messageArea.appendChild(newMessageElement(
          message.message,
          message.username === currentUser,
          message.id,
          message.timestamp
        ));
      });
      playNotificationSound('/files/newmsg.mp3');
      messageArea.scrollTop = messageArea.scrollHeight;
    }
  });
}

// ============================================================================
// IMAGE MODAL (ZOOM / PAN / PINCH)
// ============================================================================

function openImageModal(url) {
  const existing = document.getElementById('image-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'image-modal';
  modal.className = 'image-modal';

  const img = document.createElement('img');
  img.src = url;
  img.alt = 'Image';
  img.className = 'image-modal-img';

  // Error handler for 404 / missing images
  img.addEventListener('error', async function onModalImgError() {
    img.removeEventListener('error', onModalImgError);
    try {
      const res = await fetch(url, { method: 'HEAD', credentials: 'same-origin' });
      const notice = document.createElement('div');
      notice.className = 'modal-image-deleted';
      notice.textContent = res.status === 404 ? 'Image deleted' : 'Image not available';
      img.style.display = 'none';
      modal.appendChild(notice);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    } catch (err) {
      const notice = document.createElement('div');
      notice.className = 'modal-image-deleted';
      notice.textContent = 'Image not available';
      img.style.display = 'none';
      modal.appendChild(notice);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    }
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'image-modal-close';
  closeBtn.innerHTML = '✕';

  modal.appendChild(img);
  modal.appendChild(closeBtn);
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  // ---- Zoom & Pan State ----
  let scale = 1;
  const minScale = 1;
  const maxScale = 4;
  let originX = 0;
  let originY = 0;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  const pointers = new Map();

  // RAF batching for smooth transforms
  let _rafId = null;
  let _needsRender = false;

  function renderTransform() {
    _needsRender = false;
    _rafId = null;
    const tx = Math.round(originX * 100) / 100;
    const ty = Math.round(originY * 100) / 100;
    img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  }

  function scheduleRender() {
    if (!_needsRender) {
      _needsRender = true;
      _rafId = requestAnimationFrame(renderTransform);
    }
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  // ---- Event Handlers ----
  function onWheel(e) {
    e.preventDefault();
    const delta = -e.deltaY;
    const zoomFactor = delta > 0 ? 1.1 : 0.9;
    const rect = img.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const prevScale = scale;
    scale = clamp(scale * zoomFactor, minScale, maxScale);
    
    // If zooming out to 1x, center the image
    if (scale === 1) {
      originX = 0;
      originY = 0;
    } else {
      originX -= (px / prevScale) * (scale - prevScale);
      originY -= (py / prevScale) * (scale - prevScale);
    }
    scheduleRender();
  }

  function onDblClick(e) {
    e.preventDefault();
    if (scale <= 1) {
      const rect = img.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const prevScale = scale;
      scale = 2;
      originX -= (px / prevScale) * (scale - prevScale);
      originY -= (py / prevScale) * (scale - prevScale);
    } else {
      // Zoom out to 1x: center the image
      scale = 1;
      originX = 0;
      originY = 0;
    }
    scheduleRender();
  }

  function onPointerDown(e) {
    e.preventDefault();
    img.setPointerCapture && img.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragging = true;
      startX = e.clientX - originX;
      startY = e.clientY - originY;
    }
  }

  function onPointerMove(e) {
    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pointers.size === 1 && dragging) {
      // Update immediately for responsive panning
      originX = e.clientX - startX;
      originY = e.clientY - startY;
      const tx = Math.round(originX * 100) / 100;
      const ty = Math.round(originY * 100) / 100;
      img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
    } else if (pointers.size === 2) {
      const pts = Array.from(pointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      if (!img._lastPinchDist) img._lastPinchDist = dist;
      const factor = dist / img._lastPinchDist;
      const prevScale = scale;
      scale = clamp(scale * factor, minScale, maxScale);
      img._lastPinchDist = dist;
      scheduleRender();
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    dragging = false;
    img._lastPinchDist = null;
  }

  // ---- Close Handler ----
  function removeModal() {
    if (_rafId) cancelAnimationFrame(_rafId);
    img.removeEventListener('wheel', onWheel);
    img.removeEventListener('dblclick', onDblClick);
    img.removeEventListener('pointerdown', onPointerDown);
    img.removeEventListener('dragstart', (ev) => ev.preventDefault());
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    modal.removeEventListener('touchmove', (ev) => ev.preventDefault());
    if (modal.parentNode) modal.parentNode.removeChild(modal);
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') removeModal();
  }

  closeBtn.addEventListener('click', removeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) removeModal();
  });
  document.addEventListener('keydown', onKey);

  // Attach listeners
  img.addEventListener('wheel', onWheel, { passive: false });
  img.addEventListener('dblclick', onDblClick);
  img.addEventListener('pointerdown', onPointerDown);
  img.addEventListener('dragstart', (ev) => ev.preventDefault());
  modal.addEventListener('touchmove', (ev) => ev.preventDefault(), { passive: false });
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  scheduleRender();
}

// ============================================================================
// EVENT WIRING & INITIALIZATION
// ============================================================================

// Prevent native dragstart on images inside messages
if (messageArea) {
  messageArea.addEventListener('dragstart', (e) => {
    if (e.target?.tagName === 'IMG' && e.target.closest('.message')) {
      e.preventDefault();
    }
  });
}

// Delegate click on images to open modal
if (messageArea) {
  messageArea.addEventListener('click', (e) => {
    const target = e.target;
    if (target?.tagName === 'IMG') {
      const msg = target.closest('.message');
      const avatar = target.closest('.avatar');
      if (msg && !avatar) openImageModal(target.src);
    }
  });
}

// Input event listeners
sendButton?.addEventListener('click', sendMessage);
messageInputField?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
  }
});
imageUploadInput?.addEventListener('change', uploadImage);

// ============================================================================
// SESSION & THEME MANAGEMENT
// ============================================================================

async function checkSession() {
  try {
    const response = await fetch('/api/check-session', {
      method: 'GET',
      credentials: 'same-origin'
    });
    const data = await response.json();
    if (data.success) {
      if (userInfo && usernameDisplay) {
        userInfo.style.display = 'block';
        usernameDisplay.textContent = data.data.username;
      }
      return true;
    }
    window.location.href = '/login';
    return false;
  } catch (error) {
    console.error('Session check failed:', error);
    window.location.href = '/login';
    return false;
  }
}

function checkUserInfo() {
  const userInfoStored = JSON.parse(localStorage.getItem('user_info') || '{}');
  if (userInfoStored.username && userInfo && usernameDisplay) {
    usernameDisplay.textContent = userInfoStored.username;
    userInfo.style.display = 'flex';
  }
}

function clearAllCookies() {
  const cookies = document.cookie.split(';');
  cookies.forEach((cookie) => {
    const name = cookie.split('=')[0].trim();
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${window.location.hostname}`;
  });
}

async function logout() {
  try {
    const response = await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    });
    const data = await response.json();
    localStorage.removeItem('user_info');
    localStorage.removeItem('session_token');
    sessionStorage.clear();
    clearAllCookies();
    if (!data.success) console.warn('Logout error:', data.message);
    window.location.href = '/login';
  } catch (error) {
    localStorage.clear();
    sessionStorage.clear();
    clearAllCookies();
    console.error('Logout failed:', error);
    window.location.href = '/login';
  }
}

logoutBtn?.addEventListener('click', logout);

// Theme toggle
if (switchThemeToggle) {
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    switchThemeToggle.checked = false;
  } else {
    document.body.classList.remove('dark-mode');
    switchThemeToggle.checked = true;
  }

  switchThemeToggle.addEventListener('change', () => {
    if (switchThemeToggle.checked) {
      document.body.classList.remove('dark-mode');
      localStorage.setItem('theme', 'light');
    } else {
      document.body.classList.add('dark-mode');
      localStorage.setItem('theme', 'dark');
    }
  });
}

// Load current room
if (roomInfo && roomnameDisplay) {
  fetch('/api/get-current-room', {
    method: 'GET',
    credentials: 'same-origin'
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success && data.data) {
        roomnameDisplay.textContent = data.data.room;
      }
    });
}

// ============================================================================
// APP INITIALIZATION
// ============================================================================

function initializeApp() {
  connectSocketIO();
  if (messageArea) {
    messageArea.addEventListener('scroll', function() {
      clearTimeout(scrollDebounceTimeout);
      scrollDebounceTimeout = setTimeout(() => {
        if (messageArea.scrollTop <= 0) {
          if (!isLoadingOlderMessages && oldestMessageId) {
            const blankDiv = document.createElement('div');
            blankDiv.classList.add('message-blank');
            messageArea.insertBefore(blankDiv, messageArea.firstChild);
            const loaderDiv = document.createElement('div');
            loaderDiv.classList.add('loader', 'pop-in');
            messageArea.insertBefore(loaderDiv, messageArea.firstChild);
            messageArea.scrollTo({ top: 0, behavior: 'smooth' });
            loadOlderMessages(oldestMessageId, loaderDiv, blankDiv);
          }
        }
      }, 200);
    });
  }
  checkUserInfo();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

window.addEventListener('load', async () => {
  const isLoggedIn = await checkSession();
  if (isLoggedIn && messageArea) {
    messageArea.scrollTop = messageArea.scrollHeight;
  }
});
