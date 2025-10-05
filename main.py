import sys
import json
import os
import secrets
import subprocess
import time
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, make_response, session, send_file, redirect
from flask_socketio import SocketIO, emit, join_room, leave_room
from message_server import *
from session import *

_ME = "dtanh"
msg_cache_nb = 10
msg_cache = {}

app = Flask(__name__)
app.secret_key = 'your-super-secret-key-change-this-in-production'  # Change this in production!
socketio = SocketIO(app, cors_allowed_origins="*")


# Session configuration
app.config['SESSION_COOKIE_SECURE'] = False  # Set to True in production with HTTPS
app.config['SESSION_COOKIE_HTTPONLY'] = True  # Prevents XSS attacks
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # CSRF protection
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)  # Session expires in 7 days

# Load users from file if exists
if os.path.exists("data/super_duper_secret_user_db.json"):
    with open("data/super_duper_secret_user_db.json", "r", encoding='utf-8') as f:
        users = json.load(f)
        

@app.route('/api/login', methods=['POST'])
def api_login():
    try:
        # Get JSON data from request
        data = request.get_json()

        # 400                
        if not data:
            return jsonify({
                "success": False,
                "message": "No data provided"
            }), 400
        
        username = data.get('username').lower().strip() if data.get('username') else None
        password = data.get('password').strip() if data.get('password') else None
        
        # 400
        
        if not username or not password:
            return jsonify({
                "success": False,
                "message": "Nhập gì đó đi con chó :)"
            }), 400
        allowed_characters = set("abcdefghijklmnopqrstuvwxyz0123456789_-")
        if not all(c in allowed_characters for c in username):
            return jsonify({
                "success": False,
                "message": "Username chỉ được chứa chữ thường, số, gạch dưới và gạch ngang."
            }), 400
        
        # Check if user exists
        if username not in users:
            # Create new user account
            users[username] = {
            "password_hash": hash_password(password),
            "email": data.get("email", f"{username}@example.com"),
            "role": "user"
            }
            with open("data/super_duper_secret_user_db.json", "w", encoding='utf-8') as f:
                json.dump(users, f, indent=2)
            # Log account creation
            account_creation = {
            "username": username,
            "status": "created",
            "timestamp": datetime.now().isoformat(),
            "ip_address": request.remote_addr
            }
            save_login_info(account_creation)
        
        # Verify password
        password_hash = hash_password(password)
        if users[username]["password_hash"] != password_hash:
            # Log failed login attempt
            failed_login = {
                "username": username,
                "status": "failed",
                "reason": "invalid_password",
                "timestamp": datetime.now().isoformat(),
                "ip_address": request.remote_addr
            }
            save_login_info(failed_login)
            
            return jsonify({
                "success": False,
                "message": "Sai mật khẩu rồi nhé!"
            }), 401
        
        # Generate session token
        session_token = generate_session_token()
        
        # Prepare user session info
        session_info = {
            "username": username,
            "email": users[username]["email"],
            "role": users[username]["role"],
            "login_time": datetime.now().isoformat(),
            "ip_address": request.remote_addr
        }
        
        # Save successful login info
        login_record = {
            "username": username,
            "status": "success",
            "timestamp": datetime.now().isoformat(),
            "ip_address": request.remote_addr,
            "session_token": session_token,
            "email": users[username]["email"],
            "role": users[username]["role"]
        }
        save_login_info(login_record)
        
        # Update active sessions
        update_active_sessions(session_token, session_info)
        
        # Store session in local file
        store_session_local(session_token, {
            'username': username,
            'email': users[username]["email"],
            'role': users[username]["role"]
        })
        
        # Set session cookies
        session.permanent = True  # Makes session last for PERMANENT_SESSION_LIFETIME
        session['user_id'] = username
        session['user_email'] = users[username]["email"]
        session['user_role'] = users[username]["role"]
        session['session_token'] = session_token
        session['login_time'] = datetime.now().isoformat()
        
        # Create response with additional cookie settings
        response_data = {
            "success": True,
            "message": "Login successful",
            "data": {
                "username": username,
                "email": users[username]["email"],
                "role": users[username]["role"],
                "session_token": session_token
            }
        }
        
        response = make_response(jsonify(response_data), 200)
        
        # Set additional secure cookies
        response.set_cookie('logged_in', 'true', 
                          max_age=timedelta(days=7), 
                          httponly=False,  # Allow JS access for this one
                          secure=False,    # Set to True in production
                          samesite='Lax')
        
        return response
        
    except Exception as e:
        print(f"Login error: {e}")
        return jsonify({
            "success": False,
            "message": "Internal server error"
        }), 500

@app.route('/api/logout', methods=['POST'])
def api_logout():
    try:
        # Check if user is logged in via session
        if not is_logged_in():
            return jsonify({
                "success": False,
                "message": "Not logged in"
            }), 401
        
        # Get session info for logging
        username = session.get('user_id')
        session_token = session.get('session_token')
        
        # Get current login data and remove from active sessions
        login_data = get_login_data()
        if session_token and session_token in login_data.get("active_sessions", {}):
            del login_data["active_sessions"][session_token]
            
            # Log logout
            logout_record = {
                "username": username,
                "session_token": session_token,
                "status": "logout",
                "timestamp": datetime.now().isoformat(),
                "ip_address": request.remote_addr
            }
            login_data["login_history"].append(logout_record)
            
            # Save updated data
            with open(LOGIN_FILE, 'w') as f:
                json.dump(login_data, f, indent=2)
        
        # Delete session from local file
        if session_token:
            delete_session_local(session_token)
        
        # Clear server-side session
        session.clear()
        
        # Create response and clear ALL cookies
        response_data = {
            "success": True,
            "message": "Logout successful"
        }
        
        response = make_response(jsonify(response_data), 200)
        
        # Clear all login-related cookies
        response.set_cookie('logged_in', '', expires=0, path='/')
        response.set_cookie('user_info', '', expires=0, path='/')
        
        # Clear Flask session cookie (more thorough)
        response.set_cookie('session', '', expires=0, path='/')
        
        return response
        
    except Exception as e:
        print(f"Logout error: {e}")
        return jsonify({
            "success": False,
            "message": "Internal server error"
        }), 500

@app.route('/api/verify', methods=['POST'])
def api_verify():
    """Verify if a session token is valid"""
    try:
        data = request.get_json()
        session_token = data.get('session_token')
        
        if not session_token:
            return jsonify({
                "success": False,
                "message": "Session token required"
            }), 400
        
        # Get login data
        login_data = get_login_data()
        active_sessions = login_data.get("active_sessions", {})
        
        if session_token in active_sessions:
            user_data = active_sessions[session_token]
            return jsonify({
                "success": True,
                "message": "Session valid",
                "data": user_data
            }), 200
        
        return jsonify({
            "success": False,
            "message": "Invalid or expired session"
        }), 401
        
    except Exception as e:
        print(f"Verify error: {e}")
        return jsonify({
            "success": False,
            "message": "Internal server error"
        }), 500

@app.route('/api/login-history', methods=['GET'])
def api_login_history():
    """Get login history (admin only)"""
    try:
        # In a real app, you'd verify admin permissions here
        login_data = get_login_data()
        
        return jsonify({
            "success": True,
            "data": {
                "login_history": login_data.get("login_history", []),
                "active_sessions_count": len(login_data.get("active_sessions", {}))
            }
        }), 200
        
    except Exception as e:
        print(f"Login history error: {e}")
        return jsonify({
            "success": False,
            "message": "Internal server error"
        }), 500

def get_room(user_id):
    if user_id == _ME:
        room = users[_ME].get('room', _ME)
        return room
    return user_id

def is_logged_in():
    """Check if user is logged in via session cookie"""
    return 'user_id' in session and 'session_token' in session

def require_login():
    """Decorator to require login for protected routes"""
    def decorator(f):
        def wrapper(*args, **kwargs):
            if not is_logged_in():
                return jsonify({
                    "success": False,
                    "message": "Login required"
                }), 401
            return f(*args, **kwargs)
        wrapper.__name__ = f.__name__
        return wrapper
    return decorator

def is_me():
    def decorator(f):
        def wrapper(*args, **kwargs):
            if not is_logged_in() or session.get('user_id') != _ME:
                return jsonify({
                    "success": False,
                    "message": "Not authorized"
                }), 403
            return f(*args, **kwargs)
        wrapper.__name__ = f.__name__
        return wrapper
    return decorator


@app.route('/change')
@require_login()
@is_me()
def test_protected():
    return send_file('site/select.html')

@app.route('/api/chat_rooms', methods=['GET'])
@require_login()
@is_me()
def api_chat_rooms():
    """Get available chat rooms"""
    try:
        # get all user_ids
        user_ids = list(users.keys())
        
        return jsonify({
            "success": True,
            "data": {
                "rooms": user_ids
            }
        }), 200
    except Exception as e:
        print(f"Chat rooms error: {e}")
        return jsonify({
            "success": False,
            "message": "Internal server error"
        }), 500

@app.route('/join/<room_name>')
@require_login()
@is_me()
def join_chat_room(room_name):
    """Join a chat room"""
    if room_name not in users:
        return jsonify({
            "success": False,
            "message": "Chat room not found"
        }), 404

    # Add user to the chat room
    users[_ME]['room'] = room_name
    return redirect('/')

@app.route('/api/get-current-room', methods=['GET'])
@require_login()
def api_get_current_room():
    if session.get('user_id') == _ME:
        room = users[_ME].get('room', _ME)
    else:
        room = _ME
    return jsonify({
        "success": True,
        "data": {
            "room": room
        }
    }), 200

@app.route('/api/check-session', methods=['GET'])
def api_check_session():
    """Check if user has valid session cookie"""
    if is_logged_in():
        return jsonify({
            "success": True,
            "message": "Valid session",
            "data": {
                "username": session.get('user_id'),
                "email": session.get('user_email'),
                "role": session.get('user_role'),
                "login_time": session.get('login_time')
            }
        }), 200
    else:
        return jsonify({
            "success": False,
            "message": "No valid session"
        }), 401
        
        
@app.route('/files/<path:filename>')
def serve_file(filename):
    """Serve static files from the root directory"""
    try:
        return send_file(f'files/{filename}')
    except Exception as e:
        return jsonify({
            "success": False,
            "message": f"File not found: {filename}"
        }), 404
        
        
# Socket.IO Event Handlers
@socketio.on('connect')
@require_login()
def handle_connect():
    """Handle client connection"""
    print(f"Client connected: {request.sid}")
    
    # Join a general chat room
    # join_room('general_chat')
    try:
        user_id = session.get('user_id')
        room_id = get_room(user_id)
        join_room(room_id)  # Each user has their own room
        emit('status', {
            'type': 'connected',
            'message': 'Connected',
            'data': {'room': room_id}
        })
    except Exception as e:
        emit('error', {'message': 'Failed to join room'})
    
    # Send welcome message

@socketio.on('disconnect')  
def handle_disconnect():
    """Handle client disconnection"""
    print(f"Client disconnected: {request.sid}")
    
    # Leave room
    # leave_room('general_chat')
    try:
        user_id = session.get('user_id')
        room_id = get_room(user_id)
        leave_room(room_id)
    except Exception as e:
        emit('error', {'message': 'Failed to leave room'})

@socketio.on('send_message')
@require_login()
def handle_send_message(data):
    """Handle real-time message sending via Socket.IO"""
    try:
        # Validate message data
        if not data or not data.get('message'):
            emit('error', {'message': 'Message content required'})
            return
        message_text = data.get('message', '').strip()
        if len(message_text) > 1000:
            emit('error', {'message': 'Message too long (>1000 characters) this will not be sent'})
            return
        if not message_text:
            emit('error', {'message': 'Message cannot be empty'})
            return
        # For now, we'll use a default username if not authenticated
        username = data.get('username', 'Unknown')
        timestamp = datetime.now().isoformat()
        # Create message object
        message_data = {
            "id": secrets.token_hex(8),
            "username": username,
            "message": message_text
        }
        
        # Cache message in local file
        room = get_room(session.get('user_id'))
        cache_message_local(message_data, room)
        # Broadcast message to all clients in the room
        socketio.emit('new_message', message_data, room=room)
        
        if username != _ME:
            message_data_me = {
                "id": secrets.token_hex(8),
                "username": username,
                "message": f"<{username}>: {message_text}"
            }
            cache_message_local(message_data_me, _ME)
            socketio.emit('new_message', message_data_me, room=_ME)
        
        # Send confirmation to sender
        emit('message_sent', {
            'success': True,
            'message_id': message_data['id'],
            'timestamp': timestamp
        })
    except Exception as e:
        print(f"Socket.IO message error: {e}")
        emit('error', {'message': 'Failed to send message'})
        
@socketio.on('get_older_messages')
@require_login()
def handle_get_older_messages(data):
    """Load older messages from local file cache"""
    try:
        before_message_id = data.get('before_message_id')
        if not before_message_id:
            emit('error', {'message': 'before_message_id required'})
            return
        
        room = get_room(session.get('user_id'))
        recent_messages = get_recent_messages_local(room)

        # Find index of the message with the given ID
        index = next((i for i, msg in enumerate(recent_messages) if msg['id'] == before_message_id), None)
        if index is None:
            emit('error', {'message': 'Message ID not found'})
            return

        # Get older messages (up to 10)
        older_messages = recent_messages[index - 10:index] if index >= 10 else recent_messages[0:index]
        
        emit('older_messages', {
            'messages': older_messages,
            'count': len(older_messages)
        })
    
    except Exception as e:
        print(f"Socket.IO load older messages error: {e}")
        emit('error', {'message': 'Failed to load older messages'})

@socketio.on('get_recent_messages')
@require_login()
def handle_get_recent_messages():
    """Get recent messages from local file cache"""
    try:
        room = get_room(session.get('user_id'))
        recent_messages = get_recent_messages_local(room)
        emit('recent_messages', {
            'messages': recent_messages[len(recent_messages) - 30:],  # Send only the latest 30 messages
            'count': 30 if len(recent_messages) > 30 else len(recent_messages)
        })
    
    except Exception as e:
        print(f"Error getting recent messages: {e}")
        emit('error', {'message': 'Failed to get recent messages'})
        
@socketio.on('get_messages_since_reconnect')
@require_login()
def handle_get_messages_since_reconnect(data):
    """Get messages since last known message ID after reconnect"""
    try:
        print(data)
        last_message_id = data.get('last_message_id')
        if not last_message_id:
            emit('error', {'message': 'last_message_id required'})
            return
        
        room = get_room(session.get('user_id'))
        recent_messages = get_recent_messages_local(room)

        # Find index of the message with the given ID
        index = next((i for i, msg in enumerate(recent_messages) if msg['id'] == last_message_id), None)
        if index is None:
            emit('error', {'message': 'Message ID not found'})
            return

        # Get messages since that ID
        new_messages = recent_messages[index + 1:] if index + 1 < len(recent_messages) else []
        
        emit('messages_since_reconnect', {
            'messages': new_messages,
            'count': len(new_messages)
        })
    
    except Exception as e:
        print(f"Socket.IO get messages since reconnect error: {e}")
        emit('error', {'message': 'Failed to get messages since reconnect'})

@app.route('/login')
def login():
    return send_file('site/login.html')

@app.route('/debug-cookies')
def debug_cookies():
    """Debug endpoint to check cookies and session"""
    return jsonify({
        "cookies": dict(request.cookies),
        "session": dict(session),
        "logged_in": is_logged_in(),
        "user_agent": request.headers.get('User-Agent'),
        "remote_addr": request.remote_addr
    })

@app.route('/what')
def about():
    return send_file('site/about.html')

@app.route('/')
def hello():
    if not is_logged_in():
        return redirect('/login')
    if session.get('user_id') == _ME:
        return send_file('index2.html')
    return send_file('index.html')
    
# Define the port the Flask app will run on
FLASK_PORT = 13882

# --- Main Execution ---
if __name__ == '__main__':
    tunnel_process = None
    try:
        # command = ['./cloudflared', 'tunnel', 'run']
        # tunnel_process = subprocess.Popen(command)
        # time.sleep(3)
        app.run(port=FLASK_PORT, debug=False, host='0.0.0.0')

    except KeyboardInterrupt:
        # This block is executed when you press Ctrl+C
        print("\nShutting down servers...")

    finally:
        # 4. Clean up the background process
        if tunnel_process:
            print(f"Terminating Cloudflare Tunnel process (PID: {tunnel_process.pid})...")
            tunnel_process.terminate()
            tunnel_process.wait()
            print("Tunnel process terminated.")
        sys.exit(0)