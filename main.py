from flask import Flask, redirect, session, request
from flask_socketio import SocketIO
from datetime import timedelta
import os
from dotenv import load_dotenv
load_dotenv()

# Import our modules
from scripts.auth import require_login, is_logged_in, require_dtanh
from scripts.user_manager import load_users
from scripts.socket_handlers import (
    handle_connect, handle_disconnect, handle_send_message,
    handle_get_older_messages, handle_get_recent_messages,
    handle_get_messages_since_reconnect, handle_nickname_changed_notify
)
from scripts.api_routes import register_api_routes

# Flask and SocketIO setup
app = Flask(__name__, static_folder='.', static_url_path='')
app.secret_key = os.getenv('FLASK_SECRET_KEY')
socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    ping_timeout=10,      # Server waits 10 seconds for client pong
    ping_interval=15,     # Server sends ping every 15 seconds
    max_http_buffer_size=1e6  # 1MB for image uploads
)

# Session configuration
app.config['SESSION_COOKIE_SECURE'] = True  # Ensures cookies are sent over HTTPS
app.config['SESSION_COOKIE_HTTPONLY'] = True  # Prevents XSS attacks
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # CSRF protection
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)  # Session expires in 7 days

# Load users at startup
users = load_users()

# Register API routes
register_api_routes(app)

# Static file routes
@app.route('/')
def index():
    if not is_logged_in():
        return redirect('/login')
    """Serve the main page"""
    if is_logged_in():
        if session.get('user_id') == 'dtanh':
            return app.send_static_file('site/index2.html')
    return app.send_static_file('site/index.html')

@app.route('/login')
def login_page():
    """Serve the login page"""
    return app.send_static_file('site/login.html')

@app.route('/change')
@require_dtanh
def change():
    """Serve the change page"""
    return app.send_static_file('site/change.html')

@app.route('/what')
def what_page():
    """Serve the what page"""
    return app.send_static_file('site/what.html')

@app.route('/<path:filename>')
def static_files(filename):
    """Serve static files"""
    return app.send_static_file(f"files/{filename}")

# Socket.IO event handlers
@socketio.on('connect')
def on_connect():
    """Handle client connection"""
    handle_connect(request, socketio)

@socketio.on('disconnect')
def on_disconnect():
    """Handle client disconnection"""
    handle_disconnect(request)

@socketio.on('send_message')
@require_login
def on_send_message(data):
    """Handle real-time message sending via Socket.IO"""
    handle_send_message(data, socketio)

@socketio.on('get_older_messages')
@require_login
def on_get_older_messages(data):
    """Load older messages"""
    handle_get_older_messages(data)

@socketio.on('get_recent_messages')
@require_login
def on_get_recent_messages():
    """Get recent messages"""
    handle_get_recent_messages()

@socketio.on('get_messages_since_reconnect')
@require_login
def on_get_messages_since_reconnect(data):
    """Get messages since last known message ID after reconnect"""
    handle_get_messages_since_reconnect(data)

@socketio.on('nickname_changed_notify')
@require_login
def on_nickname_changed_notify(data):
    """Broadcast nickname change to all clients"""
    handle_nickname_changed_notify(data, socketio)

def run_server():
    while True:
        #PRODUCTION
        # try:
        #     port = int(os.environ.get('PORT', 13882))
        #     print(f"Starting server on port {port}...")
        #     # Flask-SocketIO will auto-detect the best async mode
        #     print(f"Using async mode: {socketio.async_mode}")
        #     socketio.run(app, host='0.0.0.0', port=port, debug=False)
        #     break  # If we get here, server stopped normally
        # except Exception as e:
        #     print(f"Server crashed: {e}")
        #     print("Restarting in 3 seconds...")
        #     import time
        #     time.sleep(3)
        #DEBUG
        try:
            port = int(os.environ.get('PORT', 13882))
            print(f"Starting server on port {port}...")
            # Flask-SocketIO will auto-detect the best async mode
            print(f"Using async mode: {socketio.async_mode}")
            socketio.run(app, host='0.0.0.0', port=port, debug=True)
            break  # If we get here, server stopped normally
        except Exception as e:
            print(f"Server crashed: {e}")
            print("Restarting in 3 seconds...")
            import time
            time.sleep(3)
        

if __name__ == '__main__':
    run_server()