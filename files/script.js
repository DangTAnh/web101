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

  console.log('Original timestamp:', ts);
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const shortOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: userTimeZone
  };
  
  const pad = (n) => String(n).padStart(2, '0');
  const formatted = new Intl.DateTimeFormat('vi-VN', shortOptions).format(date);

  console.log('Formatted timestamp:', formatted);

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
    }, 800);
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
// MESSAGE SPACING HELPER
// ============================================================================

function applyMessageSpacing(messageDiv) {
  // Robust spacing: decide for the given message whether it should have
  // the 'consecutive-same-type' class by checking both previous and next
  // messages (handles older messages inserted at the top).
  const THRESHOLD_MINUTES = 1; // within 1 minute -> grouped

  function shouldBeClose(div) {
    if (!div) return false;
    const allMessages = Array.from(messageArea.querySelectorAll('.message:not(.system)'));
    const idx = allMessages.indexOf(div);
    if (idx === -1) return false;
    const currIsOutgoing = div.classList.contains('outgoing');
    const currTs = div.dataset.timestamp;

    // helper to check timestamp closeness
    const withinThreshold = (aTs, bTs) => {
      if (!aTs || !bTs) return false; // unknown timestamps -> don't group
      const a = new Date(aTs);
      const b = new Date(bTs);
      const diffMin = Math.abs(b - a) / (1000 * 60);
      return diffMin <= THRESHOLD_MINUTES;
    };

    // Check previous
    if (idx > 0) {
      const prev = allMessages[idx - 1];
      if (prev.classList.contains('outgoing') === currIsOutgoing) {
        if (withinThreshold(prev.dataset.timestamp, currTs)) return true;
      }
    }

    // Check next (important when inserting older messages at top)
    if (idx < allMessages.length - 1) {
      const next = allMessages[idx + 1];
      if (next.classList.contains('outgoing') === currIsOutgoing) {
        if (withinThreshold(currTs, next.dataset.timestamp)) return true;
      }
    }

    return false;
  }

  // Update spacing for the message and its neighbours to keep classes consistent
  const allMessages = Array.from(messageArea.querySelectorAll('.message:not(.system)'));
  const index = allMessages.indexOf(messageDiv);
  if (index === -1) return;

  const toUpdate = new Set();
  toUpdate.add(messageDiv);
  if (index > 0) toUpdate.add(allMessages[index - 1]);
  if (index < allMessages.length - 1) toUpdate.add(allMessages[index + 1]);

  toUpdate.forEach((el) => {
    if (!el) return;
    if (shouldBeClose(el)) el.classList.add('consecutive-same-type');
    else el.classList.remove('consecutive-same-type');
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
        // Scroll down image height - skeleton height
        messageArea.scrollTop += img.height - skeleton.offsetHeight; 
        // Remove the uploading system message
        const uploadingMsg = messageArea.querySelector('[data-uploading="true"]');
        if (uploadingMsg) {
          uploadingMsg.remove();
        }
      }
    });

    // Attach error handler to image
    img.addEventListener('error', () => {
      const skeleton = messageDiv.querySelector('.image-loading-skeleton');
      if (skeleton) {
        skeleton.remove(); // Remove skeleton if image fails
      }
      handleChatImageError(img);
    });

    // Insert image after skeleton (will be replaced on load)
    messageDiv.insertBefore(img, messageDiv.firstChild);
  } else {
    messageDiv.innerHTML = `<p>${escapeHTML(message)}</p>`;
  }

  // Attach metadata
  if (id) messageDiv.dataset.messageId = id;
  if (timestamp) messageDiv.dataset.timestamp = timestamp;

  // Track newest message ID
  if (timestamp) {
    if (!newestMessageId || new Date(timestamp) > new Date(newestMessageId)) {
      newestMessageId = id || newestMessageId;
    }
  }

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
          applyMessageSpacing(messageElement);
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
    // Check if sound is enabled
    const soundEnabled = localStorage.getItem('sound_enabled') !== 'false';
    const notificationsEnabled = localStorage.getItem('notifications_enabled') !== 'false';
    
    // Play sound if enabled
    if (soundEnabled) {
      // Try to play sound even in background using Web Audio API
      // This works better than HTMLMediaElement in background tabs
      fetch(soundFilePath)
        .then(response => response.arrayBuffer())
        .then(buffer => {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)();
          audioContext.decodeAudioData(buffer, (decodedBuffer) => {
            const source = audioContext.createBufferSource();
            const gainNode = audioContext.createGain();
            source.buffer = decodedBuffer;
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);
            gainNode.gain.value = 0.4; // 40% volume
            source.start(0);
          });
        })
        .catch(() => {
          // Fallback to HTMLAudioElement if Web Audio fails
          const audio = new Audio(soundFilePath);
          audio.volume = 0.4;
          audio.play().catch(() => {});
        });
    }
    
    // Show browser notification if enabled
    if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('New Message! 💬', {
        icon: '/files/favicon.ico',
        tag: 'new-message',
        requireInteraction: false
      });
    }
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
  messageInputField.value = '';
  messageArea.scrollTop = messageArea.scrollHeight;

  socket.emit('send_message', {
    message: messageText,
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

async function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDimension = 1024; // Max width/height
        let width = img.width;
        let height = img.height;

        // Scale down if larger than maxDimension
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to JPEG with 70% quality
        canvas.toBlob(resolve, 'image/jpeg', 0.7);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadImage() {
  const file = imageUploadInput.files[0];
  if (!file) {
    alert('Please select an image to upload.');
    return;
  }

  // Compress image before upload
  const compressedFile = await compressImage(file);

  // Show uploading system message
  const uploadingMsg = document.createElement('div');
  uploadingMsg.classList.add('message', 'system');
  uploadingMsg.setAttribute('data-uploading', 'true');
  uploadingMsg.innerHTML = `<p><em>📤 Uploading image...</em></p>`;
  messageArea.appendChild(uploadingMsg);
  messageArea.scrollTop = messageArea.scrollHeight;

  const formData = new FormData();
  formData.append('image', compressedFile);

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
        // Remove uploading message
        uploadingMsg.remove();
        return;
      }
    }

    if (response.ok && data?.success) {
      const imageUrl = data.data?.image_url || data.image_url || data.url;
      const caption = data.data?.message || data.message || '';
      if (!imageUrl) {
        alert('Image uploaded but server did not return a URL.');
        uploadingMsg.remove();
        return;
      }
      const messageContent = caption ? `![Image](${imageUrl})\n${caption}` : `![Image](${imageUrl})`;
      messageInputField.value = messageContent;
      const notiDiv = document.createElement('div');
      
      // Remove uploading message and send message
      uploadingMsg.remove();
      imageUploadInput.value = ''; // Clear file input
      sendMessage();
    } else {
      const errMsg = data?.message || `HTTP ${response.status}`;
      alert(`Image upload failed: ${errMsg}`);
      uploadingMsg.remove();
    }
  } catch (error) {
    console.error('uploadImage', error);
    alert('An error occurred while uploading the image.');
    uploadingMsg.remove();
  }
}

// Handle pasted images from clipboard
async function handlePastedImage(file) {
  // Compress image before upload
  const compressedFile = await compressImage(file);

  // Show uploading system message
  const uploadingMsg = document.createElement('div');
  uploadingMsg.classList.add('message', 'system');
  uploadingMsg.setAttribute('data-uploading', 'true');
  uploadingMsg.innerHTML = `<p><em>📤 Uploading image...</em></p>`;
  messageArea.appendChild(uploadingMsg);
  messageArea.scrollTop = messageArea.scrollHeight;

  const formData = new FormData();
  formData.append('image', compressedFile);

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
      const trimmed = raw?.trim().replace(/^"|"$/g, '') || '';
      const isLikelyId = /^[a-fA-F0-9]{20,64}$/.test(trimmed) || (trimmed.length > 0 && trimmed.length < 200);
      if (response.ok && isLikelyId) {
        const imageUrl = `/api/images/${encodeURIComponent(trimmed)}`;
        data = { success: true, data: { image_url: imageUrl } };
      }
    }

    if (response.ok && data?.success) {
      const imageUrl = data.data?.image_url || data.image_url || data.url;
      if (!imageUrl) {
        uploadingMsg.remove();
        return;
      }
      
      const messageContent = `![Image](${imageUrl})`;
      messageInputField.value = messageContent;
      
      // Remove uploading message after 1 second
      setTimeout(() => uploadingMsg.remove(), 1000);
      sendMessage();
    } else {
      uploadingMsg.remove();
    }
  } catch (error) {
    console.error('handlePastedImage', error);
    uploadingMsg.remove();
  }
}

// ============================================================================
// SOCKET.IO SETUP
// ============================================================================

function connectSocketIO() {
  socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    pingInterval: 15000,  // Send ping every 15 seconds (like messenger)
    pingTimeout: 10000,   // Wait 10 seconds for pong response
  });

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
      setTimeout(() => {
        statusMessage.remove();
      }, 1000);
    }
  });

  socket.on('new_message', function(data) {
    const currentUser = JSON.parse(localStorage.getItem('user_info') || '{}').username;
    const willScroll = messageArea.scrollTop - messageArea.scrollHeight + messageArea.clientHeight > -300;
    const incomingMessage = newMessageElement(
      data.message,
      data.username === currentUser,
      data.id,
      data.timestamp
    );
    messageArea.appendChild(incomingMessage);
    applyMessageSpacing(incomingMessage);
    if (willScroll) messageArea.scrollTop = messageArea.scrollHeight;
    if (data.username !== currentUser) {
      playNotificationSound('/files/newmsg.mp3');
    }
    newestMessageId = data.id || newestMessageId;
  });

  socket.on('recent_messages', function(data) {
    if (data.messages?.length > 0) {
      const currentUser = JSON.parse(localStorage.getItem('user_info') || '{}').username;
      data.messages.forEach((message) => {
        const msgEl = newMessageElement(
          message.message,
          message.username === currentUser,
          message.id,
          message.timestamp
        );
        messageArea.appendChild(msgEl);
        applyMessageSpacing(msgEl);
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
      statusMessage.remove();
    }, 1000);
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
      let hasNewMessages = false;
      data.messages.forEach((message) => {
        if (message.username !== currentUser) {
          const msgEl = newMessageElement(
            message.message,
            message.username === currentUser,
            message.id,
            message.timestamp
          );
          messageArea.appendChild(msgEl);
          applyMessageSpacing(msgEl);
          hasNewMessages = true;
        }
        // Update newestMessageId with all messages (not just incoming)
        newestMessageId = message.id || newestMessageId;
      });
      if (hasNewMessages) {
        playNotificationSound('/files/newmsg.mp3');
      }
      messageArea.scrollTop = messageArea.scrollHeight;
    }
  });

  // Listen for nickname changes from other users
  socket.on('nickname_changed', function(data) {
    console.log('Nickname changed:', data);
    
    // Fetch updated nicknames from server
    updateDisplayedNicknames();
    
    // Update input fields if modal is open
    if (nicknameModal && !nicknameModal.classList.contains('hidden')) {
      loadNicknames();
    }
  });

  // Listen for nickname broadcast success confirmation
  socket.on('nickname_broadcast_success', function(data) {
    console.log('Nickname broadcast successful:', data);
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

// Handle paste events - detect images in clipboard
messageInputField?.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  // Check for image files
  for (let item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        handlePastedImage(file);
      }
      return;
    }
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
        const tobeRestored = { username: data.data.username, email: data.data.email, role: data.data.role};
        localStorage.setItem('user_info', JSON.stringify(tobeRestored));
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
  setupMobileDropdown();
}

// ============================================================================
// MOBILE DROPDOWN MENU HANDLERS
// ============================================================================

function setupMobileDropdown() {
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const mobileDropdown = document.getElementById('mobile-header-dropdown');
  const mobileOverlay = document.getElementById('mobile-dropdown-overlay');
  const closeDropdownBtn = document.getElementById('close-dropdown-btn');
  const mobileSettingsBtn = document.getElementById('mobile-settings-btn');
  const mobileNicknameBtn = document.getElementById('mobile-nickname-btn');
  const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
  const mobileChangeRoomBtn = document.getElementById('mobile-change-room-btn');

  function openMobileDropdown() {
    if (mobileDropdown && mobileOverlay) {
      // Update mobile dropdown with current user info
      updateMobileDropdownInfo();
      
      mobileDropdown.classList.add('open');
      mobileOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeMobileDropdown() {
    if (mobileDropdown && mobileOverlay) {
      mobileDropdown.classList.remove('open');
      mobileOverlay.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  function updateMobileDropdownInfo() {
    const usernameDisplay = document.getElementById('username-display');
    const mobileUsernameDisplay = document.getElementById('mobile-username-display');

    if (usernameDisplay && mobileUsernameDisplay) {
      mobileUsernameDisplay.textContent = usernameDisplay.textContent;
    }
  }

  // Open dropdown
  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', openMobileDropdown);
  }

  // Close dropdown
  if (closeDropdownBtn) {
    closeDropdownBtn.addEventListener('click', closeMobileDropdown);
  }

  if (mobileOverlay) {
    mobileOverlay.addEventListener('click', closeMobileDropdown);
  }

  // Mobile action buttons
  if (mobileSettingsBtn) {
    mobileSettingsBtn.addEventListener('click', () => {
      closeMobileDropdown();
      if (settingsPopup) {
        settingsPopup.classList.remove('hidden');
      }
    });
  }

  if (mobileNicknameBtn) {
    mobileNicknameBtn.addEventListener('click', () => {
      closeMobileDropdown();
      loadNicknames();
      if (nicknameModal) {
        nicknameModal.classList.remove('hidden');
      }
    });
  }

  if (mobileLogoutBtn) {
    mobileLogoutBtn.addEventListener('click', () => {
      closeMobileDropdown();
      logout();
    });
  }

  if (mobileChangeRoomBtn) {
    mobileChangeRoomBtn.addEventListener('click', () => {
      closeMobileDropdown();
      location.href = '/change';
    });
  }

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileDropdown?.classList.contains('open')) {
      closeMobileDropdown();
    }
  });
}

// Update mobile dropdown when nicknames change
function updateMobileDropdownOnNicknameChange() {
  const usernameDisplay = document.getElementById('username-display');
  const mobileUsernameDisplay = document.getElementById('mobile-username-display');

  if (usernameDisplay && mobileUsernameDisplay) {
    mobileUsernameDisplay.textContent = usernameDisplay.textContent;
  }
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
  
  // Request notification permission for background notifications
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch (e) {
      console.log('Notification permission request failed:', e);
    }
  }
});

// ============================================================================
// SETTINGS POPUP HANDLERS
// ============================================================================

const settingsPopup = document.getElementById('settings-popup');
const roomSettingsBtn = document.getElementById('room-settings-btn');
const closeSettingsBtn = document.getElementById('close-settings');

// Open settings popup
if (roomSettingsBtn) {
  roomSettingsBtn.addEventListener('click', () => {
    if (settingsPopup) {
      settingsPopup.classList.remove('hidden');
    }
  });
}

// Close settings popup
if (closeSettingsBtn) {
  closeSettingsBtn.addEventListener('click', () => {
    if (settingsPopup) {
      settingsPopup.classList.add('hidden');
    }
  });
}

// Close popup when clicking outside
if (settingsPopup) {
  settingsPopup.addEventListener('click', (e) => {
    if (e.target === settingsPopup) {
      settingsPopup.classList.add('hidden');
    }
  });
  
  // Close popup with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !settingsPopup.classList.contains('hidden')) {
      settingsPopup.classList.add('hidden');
    }
  });
}

// ============================================================================
// NICKNAME EDITOR MODAL HANDLERS
// ============================================================================

const nicknameModal = document.getElementById('nickname-modal');
const editNicknamesBtn = document.getElementById('edit-nicknames-btn');
const closeNicknameBtn = document.getElementById('close-nickname-modal');
const cancelNicknameBtn = document.getElementById('cancel-nickname-btn');
const saveNicknameBtn = document.getElementById('save-nickname-btn');
const myNicknameInput = document.getElementById('my-nickname-input');
const theirNicknameInput = document.getElementById('their-nickname-input');

// Load nicknames from API
async function loadNicknames() {
  try {
    const response = await fetch('/api/get-nicknames', {
      method: 'GET',
      credentials: 'same-origin'
    });
    const data = await response.json();
    
    if (data.success) {
      const myNickname = data.data.me_nickname || '';
      const theirNickname = data.data.their_nickname || '';
      
      // Get original usernames for placeholders
      const usernameDisplay = document.getElementById('username-display');
      const roomnameDisplay = document.getElementById('roomname-display');
      
      const originalUsername = usernameDisplay?.getAttribute('data-original-username') || usernameDisplay?.textContent || '';
      const originalRoomname = roomnameDisplay?.getAttribute('data-original-roomname') || roomnameDisplay?.textContent || '';
    }
  } catch (error) {
    console.error('Failed to load nicknames:', error);
  }
}

// Save nicknames via API then notify via Socket.IO
async function saveNicknames() {
  const myNickname = myNicknameInput?.value.trim() || '';
  const theirNickname = theirNicknameInput?.value.trim() || '';
  
  try {
    // First, save to database via API
    const response = await fetch('/api/change-nickname', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        me_nickname: myNickname,
        their_nickname: theirNickname
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // After successful save, notify server via Socket.IO to broadcast change
      if (socket && socket.connected) {
        socket.emit('nickname_changed_notify', {
          me_nickname: myNickname,
          their_nickname: theirNickname
        });
      }
      
      // Update displayed usernames locally
      updateDisplayedNicknames();
    } else {
      console.error('Failed to save nicknames:', data.message);
      alert('Failed to save nicknames: ' + data.message);
    }
  } catch (error) {
    console.error('Error saving nicknames:', error);
    alert('Error saving nicknames. Please try again.');
  }
}

// Update the displayed usernames with nicknames from API
async function updateDisplayedNicknames() {
  try {
    const response = await fetch('/api/get-nicknames', {
      method: 'GET',
      credentials: 'same-origin'
    });
    const data = await response.json();
    
    if (data.success) {
      const myNickname = data.data.me_nickname || '';
      const theirNickname = data.data.their_nickname || '';
      
      // Update roomname display in header
      const roomnameDisplay = document.getElementById('roomname-display');
      if (roomnameDisplay) {
        const originalRoomname = roomnameDisplay.getAttribute('data-original-roomname') || roomnameDisplay.textContent;
        if (!roomnameDisplay.getAttribute('data-original-roomname')) {
          roomnameDisplay.setAttribute('data-original-roomname', originalRoomname);
        }
        roomnameDisplay.textContent = theirNickname || originalRoomname;
      }
      
      // Update mobile dropdown displays
      updateMobileDropdownOnNicknameChange();
    }
  } catch (error) {
    console.error('Failed to update nicknames:', error);
  }
}

// Open nickname modal
if (editNicknamesBtn) {
  editNicknamesBtn.addEventListener('click', () => {
    loadNicknames();
    if (nicknameModal) {
      nicknameModal.classList.remove('hidden');
    }
  });
}

// Close nickname modal
function closeNicknameModal() {
  if (nicknameModal) {
    nicknameModal.classList.add('hidden');
  }
}

if (closeNicknameBtn) {
  closeNicknameBtn.addEventListener('click', closeNicknameModal);
}

if (cancelNicknameBtn) {
  cancelNicknameBtn.addEventListener('click', closeNicknameModal);
}

// Save nicknames
if (saveNicknameBtn) {
  saveNicknameBtn.addEventListener('click', () => {
    saveNicknames();
    closeNicknameModal();
  });
}

// Close modal when clicking outside
if (nicknameModal) {
  nicknameModal.addEventListener('click', (e) => {
    if (e.target === nicknameModal) {
      closeNicknameModal();
    }
  });
  
  // Close modal with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !nicknameModal.classList.contains('hidden')) {
      closeNicknameModal();
    }
  });
}

// Load nicknames on page load
document.addEventListener('DOMContentLoaded', () => {
  updateDisplayedNicknames();
});

