// Get references to the HTML elements we'll be interacting with
const messageArea = document.getElementById('message-area');
const messageInputField = document.getElementById('message-input-field');
const sendButton = document.getElementById('send-button');
const switchThemeToggle = document.getElementById('ld_switch');
const userInfo = document.getElementById('user-info');
const usernameDisplay = document.getElementById('username-display');
const logoutBtn = document.getElementById('logout-btn');
const roomInfo = document.getElementById('room-info');
const roomnameDisplay = document.getElementById('roomname-display');

let oldestMessageId = null; // To track the ID of the oldest loaded message
let newestMessageId = null; // To track the ID of the newest loaded message

if (roomInfo && roomnameDisplay) {
    fetch('/api/get-current-room', {
        method: 'GET',
        credentials: 'same-origin'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success && data.data) {
            roomnameDisplay.textContent = data.data.room;
        }
    });
}

function newMessageElement(username, message, type) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', type ? 'outgoing' : 'incoming');
    messageDiv.innerHTML = `<p>${escapeHTML(message)}</p>`;
    newestMessageId = messageDiv.dataset.messageId || newestMessageId;
    return messageDiv;
}

/**
 * Creates and appends a new message to the chat window.
 */

// function loadMessages() {
//     // Fetch recent messages from the server
//     fetch('/api/get-chat-history', {
//         method: 'GET',
//         credentials: 'same-origin'
//     })
//     .then(response => response.json())
//     .then(data => {
//         if (data.success && data.messages) {
//             data.messages.forEach(message => {
//                 const messageDiv = document.createElement('div');
//                 messageDiv.classList.add('message', message.type === 'outgoing' ? 'outgoing' : 'incoming');
//                 messageDiv.innerHTML = `<p><strong>${escapeHTML(message.username)}:</strong> ${escapeHTML(message.message)}</p>`;
//                 messageArea.appendChild(messageDiv);
//             });
//             messageArea.scrollTop = messageArea.scrollHeight;
//         }
//     })
//     .catch(error => {
//         console.error('Error fetching messages:', error);
//     });
// }

// if (messageArea) {
//     loadMessages();
//     messageArea.scrollTop = messageArea.scrollHeight;
// }

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
}

function switch_theme() {
    if (!switchThemeToggle) return;
    document.body.classList.toggle('dark-mode');
}

let socket = null;
let isConnected = false;

function connectSocketIO() {
    // Initialize Socket.IO connection
    socket = io();

    // Connection established
    socket.on('connect', function() {
        isConnected = true;
        if (newestMessageId) {
            socket.emit('get_messages_since_reconnect', { last_message_id: newestMessageId });
        }
        if (!newestMessageId) {
            socket.emit('get_recent_messages');
        }
    });

    // Handle connection status
    socket.on('status', function(data) {
        if (data.type === 'connected') {
            const statusMessage = document.createElement('div');
            statusMessage.classList.add('message', 'system');
            statusMessage.innerHTML = `<p><em>${data.message}</em></p>`;
            messageArea.appendChild(statusMessage);
            messageArea.scrollTop = messageArea.scrollHeight;
        }
    });

    // Handle incoming messages
    socket.on('new_message', function(data) {
        let willScroll = false;
        if (data.username != JSON.parse(localStorage.getItem('user_info') || '{}').username) {
            willScroll = messageArea.scrollTop - messageArea.scrollHeight + messageArea.clientHeight > -300;
            const incomingMessage = document.createElement('div');
            const nameElement = document.createElement('strong');
            incomingMessage.classList.add('message', 'incoming');
            incomingMessage.innerHTML = `<p>${escapeHTML(data.message)}</p>`;
            messageArea.appendChild(incomingMessage);
            if (willScroll) {
                messageArea.scrollTop = messageArea.scrollHeight;
            }
            playNotificationSound('/files/newmsg.mp3');
            newestMessageId = data.id || newestMessageId;
        }
    });

    // Handle recent messages
    socket.on('recent_messages', function(data) {
        
        if (data.messages && data.messages.length > 0) {
            data.messages.forEach(function(message) {
                messageArea.appendChild(newMessageElement(message.username, message.message, message.username === JSON.parse(localStorage.getItem('user_info') || '{}').username));
            });
            messageArea.scrollTop = messageArea.scrollHeight;
            oldestMessageId = data.messages[0].id || null;
            newestMessageId = data.messages[data.messages.length - 1].id || null;
        }
    });

    // Handle message sent confirmation
    socket.on('message_sent', function(data) {
                if (data.success) {
                    newestMessageId = data.id || newestMessageId;
                }
    });

    // Handle errors
    socket.on('error', function(data) {
        console.error('Socket.IO Error:', data);
        const errorMessage = document.createElement('div');
        errorMessage.classList.add('message', 'system', 'error');
        errorMessage.innerHTML = `<p><em>❌ ${data.message}</em></p>`;
        messageArea.appendChild(errorMessage);
        messageArea.scrollTop = messageArea.scrollHeight;
    });

    // Handle disconnection
    socket.on('disconnect', function(reason) {
        isConnected = false;
                
        const statusMessage = document.createElement('div');
        statusMessage.classList.add('message', 'system', 'error');
        statusMessage.innerHTML = `<p><em>Disconnected</em></p>`;
        messageArea.appendChild(statusMessage);
        messageArea.scrollTop = messageArea.scrollHeight;
        
        // Attempt to reconnect after a delay
        setTimeout(function() {
            if (!isConnected) {
                                socket.connect();
            }
        }, 5000);
    });

    // Handle reconnection
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
        if (data.messages && data.messages.length > 0) {
            data.messages.forEach(function(message) {
                messageArea.appendChild(newMessageElement(message.username, message.message, message.username === JSON.parse(localStorage.getItem('user_info') || '{}').username));
            });
            playNotificationSound('/files/newmsg.mp3');
            messageArea.scrollTop = messageArea.scrollHeight;
        }
    });
}

function loadOlderMessages(beforeMessageId) {
    if (!beforeMessageId) {
                return;
    }
    
    // Request older messages from the server
    socket.emit('get_older_messages', { before_message_id: beforeMessageId });
    
    // Handle older messages response
    socket.once('older_messages', function(data) {
        //reverse the messages to maintain chronological order
        data.messages.reverse();
        if (data.messages && data.messages.length > 0) {
            data.messages.forEach(function(message) {
                messageArea.insertBefore(newMessageElement(message.username, message.message, message.username === JSON.parse(localStorage.getItem('user_info') || '{}').username), messageArea.firstChild);
                //wait a bit for better UX
            });
            // Update the oldestMessageId
            oldestMessageId = data.messages[data.messages.length - 1].id || oldestMessageId;
        } else {
        }
    });
}

function playNotificationSound(soundFilePath) {
  const audio = new Audio(soundFilePath);
  audio.volume = 0.2; // Set volume to 20%
  audio.play()
    .catch(error => {
      console.error("Error playing sound:", error);
    });
}

function sendMessage() {
    const messageText = messageInputField.value.trim();

    // Don't send empty messages
    if (messageText === '') {
        return; 
    }

    // Check if Socket.IO is connected
    if (!socket || !isConnected) {
        console.error('Socket.IO not connected');
        return;
    }

    // Create a new message element for the outgoing message
    const outgoingMessage = document.createElement('div');
    outgoingMessage.classList.add('message', 'outgoing');
    outgoingMessage.innerHTML = `<p>${escapeHTML(messageText)}</p>`;
    messageArea.appendChild(outgoingMessage);

    // Clear the input field after sending
    messageInputField.value = '';

    // Scroll to the latest message
    messageArea.scrollTop = messageArea.scrollHeight;

    // Get username from stored user info or prompt
    const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
    const username = userInfo.username || prompt('Enter your username:') || 'Anonymous';

    // Send the message via Socket.IO
    socket.emit('send_message', {
        message: messageText,
        username: username,
        timestamp: new Date().toISOString()
    });

    // Handle potential send failures (add timeout)
    const sendTimeout = setTimeout(() => {
        console.error('Message send timeout');
        outgoingMessage.classList.add('message-failed');
    }, 4000);

    // Clear timeout when message is confirmed sent
    const originalHandler = socket._callbacks['$message_sent'];
    socket.once('message_sent', function(data) {
        clearTimeout(sendTimeout);
        if (data.success) {
                        // Remove any failed styling
            outgoingMessage.classList.remove('message-failed');
        } else {
            console.error('Failed to send message:', data);
            outgoingMessage.classList.add('message-failed');
        }
    });
}

/**
 * A helper function to prevent basic HTML injection.
 */
function escapeHTML(str) {
    return str.replace(/[&<>"']/g, function(match) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[match];
    });
}


// --- Event Listeners ---

// Send message when the send button is clicked
sendButton.addEventListener('click', sendMessage);
// Send message when the 'Enter' key is pressed in the input field
messageInputField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault(); // Prevents a new line from being added to the input
        sendMessage();
    }
});

// Check if user is logged in
async function checkSession() {
    try {
        const response = await fetch('/api/check-session', {
            method: 'GET',
            credentials: 'same-origin'
        });
        
        const data = await response.json();
        
        if (data.success) {
            // User is logged in, show user info
            if (userInfo && usernameDisplay) {
                userInfo.style.display = 'block';
                usernameDisplay.textContent = `${data.data.username}`;
            }
            return true;
        } else {
            // User not logged in, redirect to login
            window.location.href = '/login';
            return false;
        }
    } catch (error) {
        console.error('Session check failed:', error);
        window.location.href = '/login';
        return false;
    }
}


// Function to clear all cookies (client-side cleanup)
function clearAllCookies() {
    // Get all cookies
    const cookies = document.cookie.split(";");
    
    // Clear each cookie
    for (let cookie of cookies) {
        const eqPos = cookie.indexOf("=");
        const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
        
        // Clear cookie with different path combinations
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=${window.location.hostname}`;
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
}

// Logout function
async function logout() {
    try {
                
        // First, call server logout API  
        const response = await fetch('/api/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'same-origin' // Include session cookies
        });
        
        const data = await response.json();
        
        // Clear client-side data regardless of server response
        localStorage.removeItem('user_info');
        localStorage.removeItem('session_token');
        sessionStorage.clear();
        
        // Clear all cookies from client side
        clearAllCookies();
        
                
        if (data.success) {
                    } else {
            console.warn('Logout error from server, but local session cleared:', data.message);
        }
        
        // Redirect to login page
        window.location.href = '/login';
        
    } catch (error) {
        // Even if server call fails, clear local data
        localStorage.clear();
        sessionStorage.clear();
        clearAllCookies();
        
        console.error('Logout failed:', error);
        window.location.href = '/login';
    }
}

// Connect the theme toggle to the switch function
if (switchThemeToggle) {
    // Initialize theme based on saved preference
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        switchThemeToggle.checked = false;
    } else {
        document.body.classList.remove('dark-mode');
        switchThemeToggle.checked = true;
    }

    // Save theme preference on toggle
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

// Connect logout button
if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
}

// Initialize application when page loads
function initializeApp() {
        
    // Connect to Socket.IO
    connectSocketIO();
    
    // Setup send button event listener
    if (sendButton) {
        sendButton.addEventListener('click', sendMessage);
    }
    
    // Setup enter key event listener for message input
    if (messageInputField) {
        messageInputField.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    if (messageArea) {
        messageArea.addEventListener('scroll', function() {
            if (messageArea.scrollTop === 0) {
                loadOlderMessages(oldestMessageId);
                messageArea.scrollTop = 1; // Prevent multiple triggers
            }
        });
    }
    
    // Check and display user info
    checkUserInfo();
}

function checkUserInfo() {
    const userInfoStored = JSON.parse(localStorage.getItem('user_info') || '{}');
    if (userInfoStored.username && userInfo && usernameDisplay) {
        usernameDisplay.textContent = userInfoStored.username;
        userInfo.style.display = 'flex';
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// Scroll to the bottom of the chat on initial load and check session
window.addEventListener('load', async () => {
    const isLoggedIn = await checkSession();
    if (isLoggedIn && messageArea) {
        messageArea.scrollTop = messageArea.scrollHeight;
    }
})