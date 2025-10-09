from flask import Flask, redirect, session, request
from flask_socketio import SocketIO
from datetime import timedelta
import os

# Import our modules
from scripts.auth import require_login, is_logged_in, is_me, require_dtanh
from scripts.user_manager import load_users
from scripts.socket_handlers import (
    handle_connect, handle_disconnect, handle_send_message,
    handle_get_older_messages, handle_get_recent_messages,
    handle_get_messages_since_reconnect
)
from scripts.api_routes import register_api_routes

# Flask and SocketIO setup
app = Flask(__name__, static_folder='.', static_url_path='')
app.secret_key = 'your-super-secret-key-change-this-in-production'  # Change this in production!
socketio = SocketIO(app, cors_allowed_origins="*")

# Session configuration
app.config['SESSION_COOKIE_SECURE'] = False  # Set to True in production with HTTPS
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
    return app.send_static_file('site/select.html')

@app.route('/what')
def what_page():
    """Serve the what page"""
    return app.send_static_file('site/about.html')

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

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 13882))
    socketio.run(app, host='0.0.0.0', port=port, debug=True)